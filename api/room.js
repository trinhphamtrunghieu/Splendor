/* Splendor — Vercel Serverless authoritative room server (/api/room).
 *
 * Replaces the old peer-to-peer public MQTT broker + host-browser referee with
 * a server-authoritative model:
 *
 *   1. The server owns the true game state, validates every player action with
 *      the same pure engine (`assets/js/engine.js`), runs AI turns immediately
 *      (`assets/js/ai.js`), and sends each player only their redacted view
 *      (`viewFor`) so deck order and opponents' reserved cards never leave the
 *      server.
 *   2. Dual-mode storage designed for Vercel Hobby limits:
 *      - Active rooms live in process memory (`globalThis.__SPLENDOR_ROOMS__`)
 *        and wake waiting long-poll requests (`GET /api/room?wait=1`) the
 *        instant a move, chat line, or roster change happens (0 Redis reads).
 *      - When Upstash Redis / Vercel KV environment variables are present
 *        (`KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL`), the server writes to
 *        Redis ONLY on real state-changing operations (Write-on-Move) and reads
 *        from Redis ONLY on a cold start when the room is not yet in memory.
 *   3. Host resilience:
 *      - Once a game starts, the host has no special referee role — if the host
 *        drops, the other players keep playing without interruption.
 *      - Whenever the current host goes offline or leaves, host privileges
 *        (`hostId`) automatically transfer to the next connected human player
 *        and stay with the new host even if the old host later reconnects.
 *      - If any human player is offline when their turn arrives, the current
 *        host can trigger `botTakeover` so a bot plays for that seat until the
 *        human reconnects (which automatically restores their seat control).
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

/* Load the shared game modules into globalThis so the server uses the exact
   same rules and AI as offline play. */
globalThis.window = globalThis;
if (!globalThis.SplendorData) require('../assets/js/data.js');
if (!globalThis.SplendorEngine) require('../assets/js/engine.js');
if (!globalThis.SplendorAI) require('../assets/js/ai.js');

var D = globalThis.SplendorData;
var E = globalThis.SplendorEngine;
var AI = globalThis.SplendorAI;

var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var CODE_LENGTH = 5;
var MAX_SEATS = 4;
var MAX_NAME = 16;
var MAX_CHAT = 240;
var CHAT_HISTORY = 120;

var DEFAULT_OFFLINE_MS = 12000;   // seat marked offline if unseen for 12s
var DEFAULT_WAIT_MS = 4500;       // long-poll hold duration (< Vercel 10s limit)
var ROOM_TTL_SECONDS = 14400;     // 4 hours in Redis / memory cleanup
var ROOM_MAX_IDLE_MS = 14400000;

/* ---------------------------------------------------------- sanitizers */

function clean(text, limit) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function cleanName(text) { return clean(text, MAX_NAME); }
function cleanChat(text) { return clean(text, MAX_CHAT); }

function roomCode() {
  var out = '';
  for (var i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return out;
}

function normaliseCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function isValidCode(text) {
  var code = normaliseCode(text);
  if (code.length !== CODE_LENGTH) return false;
  for (var i = 0; i < code.length; i++) {
    if (CODE_ALPHABET.indexOf(code.charAt(i)) < 0) return false;
  }
  return true;
}

/* Redacts hidden information for a single seat: deck cards become nulls (count
   only) and other players' reserved cards become `{ hidden: true }`. */
function viewFor(state, seat) {
  if (!state) return null;
  var view = E.clone(state);
  [1, 2, 3].forEach(function (tier) {
    view.decks[tier] = view.decks[tier].map(function () { return null; });
  });
  view.players.forEach(function (player, index) {
    if (index !== seat) {
      player.reserved = player.reserved.map(function () { return { hidden: true }; });
    }
  });
  return view;
}

/* ----------------------------------------------------- storage drivers */

function createUpstashAdapter(config) {
  var url = (config && config.url) ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL || '';
  var token = (config && config.token) ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN || '';
  var fetchFn = (config && config.fetch) || globalThis.fetch;

  if (!url || !token || typeof fetchFn !== 'function') return null;
  url = url.replace(/\/+$/, '');

  async function command(args) {
    try {
      var res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(args)
      });
      if (!res.ok) return null;
      var data = await res.json();
      return data ? data.result : null;
    } catch (err) {
      return null;
    }
  }

  return {
    get: async function (code) {
      var raw = await command(['GET', 'splendor:room:' + code]);
      if (!raw) return null;
      try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (err) { return null; }
    },
    set: async function (code, room) {
      await command(['SET', 'splendor:room:' + code, JSON.stringify(room), 'EX', ROOM_TTL_SECONDS]);
    },
    del: async function (code) {
      await command(['DEL', 'splendor:room:' + code]);
    }
  };
}

/* --------------------------------------------------- server instance */

function createRoomManager(options) {
  options = options || {};
  var rooms = options.rooms || new Map();
  var waiters = new Map();
  var offlineMs = options.offlineTimeout || DEFAULT_OFFLINE_MS;
  var waitMs = options.waitTimeout || DEFAULT_WAIT_MS;
  var kv = options.kv !== undefined ? options.kv : createUpstashAdapter(options.kvConfig);
  var nowFn = options.now || function () { return Date.now(); };

  /* Cold-start aware lookup: checks RAM first (0 KV commands), falls back to KV
     only when the room is not in RAM. */
  async function loadRoom(code) {
    var norm = normaliseCode(code);
    if (!isValidCode(norm)) return null;
    if (rooms.has(norm)) return rooms.get(norm);
    if (kv) {
      var fromKv = await kv.get(norm);
      if (fromKv && fromKv.code === norm) {
        rooms.set(norm, fromKv);
        return fromKv;
      }
    }
    return null;
  }

  /* Persists room state. `dirtyMove` is true only on real state transitions
     (host, join, rename, bot, start, intent, botTakeover, rematch, chat, leave)
     so heartbeats and long-polls never consume KV commands. */
  async function saveRoom(room, dirtyMove) {
    room.updated = nowFn();
    rooms.set(room.code, room);
    if (dirtyMove && kv) {
      await kv.set(room.code, room);
    }
    notifyWaiters(room);
  }

  async function removeRoom(code) {
    var norm = normaliseCode(code);
    var room = rooms.get(norm);
    rooms.delete(norm);
    if (kv) await kv.del(norm);
    if (room) {
      room.phase = 'closed';
      room.closed = true;
      room.seq++;
      notifyWaiters(room);
    }
    waiters.delete(norm);
  }

  function seatOf(room, clientId) {
    if (!room || !clientId) return -1;
    for (var i = 0; i < room.seats.length; i++) {
      if (room.seats[i].id === clientId) return i;
    }
    return -1;
  }

  /* Transfers `room.hostId` to the next connected human player if the current
     host is offline or has left. Once transferred, the new host keeps hostId
     even if the old host later reconnects. */
  function ensureActiveHost(room) {
    var hostIdx = seatOf(room, room.hostId);
    var currentHost = hostIdx >= 0 ? room.seats[hostIdx] : null;
    if (currentHost && currentHost.online && !currentHost.left && currentHost.humanOwner) {
      return false;
    }
    for (var i = 0; i < room.seats.length; i++) {
      var s = room.seats[i];
      if (!s.left && s.online && s.humanOwner) {
        if (room.hostId !== s.id) {
          var prevHost = room.hostId;
          room.hostId = s.id;
          room.lastHostTransfer = { from: prevHost, to: s.id, toName: s.name, at: nowFn() };
          return true;
        }
        return false;
      }
    }
    return false;
  }

  /* Marks human seats as offline if they have not polled/acted within
     `offlineMs`, and transfers host if the current host timed out. */
  function sweepPresence(room, touchingClientId) {
    if (!room) return false;
    var now = nowFn();
    var changed = false;

    if (touchingClientId) {
      var idx = seatOf(room, touchingClientId);
      if (idx >= 0) {
        var mySeat = room.seats[idx];
        if (!mySeat.left) {
          mySeat.lastSeen = now;
          if (!mySeat.online) {
            mySeat.online = true;
            changed = true;
          }
          /* If a bot was temporarily filling in while this human was offline,
             hand control of the seat straight back to the returning human. */
          if (mySeat.botTakeover && mySeat.humanOwner) {
            mySeat.botTakeover = false;
            mySeat.type = 'human';
            if (room.state && room.state.players[idx]) {
              room.state.players[idx].type = 'human';
            }
            changed = true;
          }
        }
      }
    }

    for (var i = 0; i < room.seats.length; i++) {
      var seat = room.seats[i];
      if (seat.humanOwner && !seat.left && seat.online) {
        if (now - (seat.lastSeen || 0) > offlineMs) {
          seat.online = false;
          changed = true;
        }
      }
    }

    if (ensureActiveHost(room)) {
      changed = true;
    }

    if (changed) {
      room.seq++;
      room.updated = now;
    }
    return changed;
  }

  /* Steps through any consecutive AI turns so the server is the sole referee
     for both human and bot players. */
  function runBotTurns(room) {
    var state = room.state;
    if (!state || state.phase === 'gameover') return false;
    var moved = false;
    var guard = 0;

    while (state.phase !== 'gameover' && guard++ < 200) {
      var currentIdx = state.current;
      var player = state.players[currentIdx];
      var seat = room.seats[currentIdx];
      var isBot = player.type === 'ai' || (seat && seat.botTakeover);
      if (!isBot) break;

      var profile = AI.PROFILES[player.difficulty] || AI.PROFILES.normal;
      if (state.phase === 'noble') {
        E.chooseNoble(state, AI.chooseNoble(state));
        moved = true;
        continue;
      }
      if (state.phase === 'discard') {
        var disc = AI.discard(state, profile);
        if (!disc.ok) break;
        moved = true;
        continue;
      }
      var action = AI.chooseAction(state, profile);
      var res = action ? E.applyAction(state, action) : { ok: false };
      if (!res.ok) {
        var fallback = E.legalActions(state)[0];
        if (!fallback || !E.applyAction(state, fallback).ok) break;
      }
      moved = true;
    }

    if (state.phase === 'gameover') {
      room.phase = 'ended';
    }
    return moved;
  }

  function roomSummary(room) {
    return {
      t: 'room',
      room: room.code,
      seq: room.seq,
      chatSeq: room.chatSeq,
      phase: room.phase,
      hostId: room.hostId,
      closed: !!room.closed,
      current: room.state ? room.state.current : 0,
      round: room.state ? room.state.round : 1,
      seats: room.seats.map(function (s, i) {
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          humanOwner: !!s.humanOwner,
          botTakeover: !!s.botTakeover,
          left: !!s.left,
          difficulty: s.difficulty || null,
          online: s.type === 'ai' && !s.humanOwner ? true : !!s.online,
          seat: i
        };
      }),
      updated: room.updated
    };
  }

  function buildPayload(room, clientId, chatSince) {
    var seat = seatOf(room, clientId);
    var sinceChat = Number(chatSince || 0);
    var chatLines = room.chat.filter(function (c) { return c.seq > sinceChat; });
    return {
      ok: true,
      seq: room.seq,
      chatSeq: room.chatSeq,
      seat: seat,
      room: roomSummary(room),
      view: room.state && seat >= 0 ? {
        t: 'view',
        seq: room.seq,
        seat: seat,
        state: viewFor(room.state, seat)
      } : null,
      chat: chatLines
    };
  }

  function notifyWaiters(room) {
    var list = waiters.get(room.code);
    if (!list || !list.length) return;
    waiters.set(room.code, []);
    list.forEach(function (w) {
      clearTimeout(w.timer);
      try { w.resolve(buildPayload(room, w.clientId, w.chatSince)); }
      catch (err) { /* ignore closed response */ }
    });
  }

  function waitForChange(room, clientId, since, chatSince, customWaitMs) {
    return new Promise(function (resolve) {
      var duration = customWaitMs != null ? customWaitMs : waitMs;
      var entry = {
        clientId: clientId,
        since: since,
        chatSince: chatSince,
        resolve: resolve,
        timer: setTimeout(function () {
          var list = waiters.get(room.code) || [];
          var idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
          if (sweepPresence(room, clientId)) {
            notifyWaiters(room);
          }
          resolve(buildPayload(room, clientId, chatSince));
        }, duration)
      };
      var list = waiters.get(room.code);
      if (!list) { list = []; waiters.set(room.code, list); }
      list.push(entry);
    });
  }

  /* Periodic cleanup of abandoned rooms in memory. */
  function pruneExpiredRooms() {
    var now = nowFn();
    rooms.forEach(function (room, code) {
      if (now - (room.updated || 0) > ROOM_MAX_IDLE_MS) {
        rooms.delete(code);
        waiters.delete(code);
      }
    });
  }

  /* ----------------------------------------------------------- operations */

  async function execute(body) {
    pruneExpiredRooms();
    var op = body && body.op;
    var clientId = String((body && body.clientId) || '').trim().slice(0, 64);
    if (!op || !clientId) return { ok: false, error: 'bad-request' };

    /* 1. Create or resume hosting a room */
    if (op === 'host') {
      var requested = normaliseCode(body.room);
      var code = isValidCode(requested) ? requested : roomCode();
      var existing = await loadRoom(code);
      var name = cleanName(body.name) || 'Host';
      var now = nowFn();

      if (existing && !existing.closed) {
        sweepPresence(existing, clientId);
        var existingSeat = seatOf(existing, clientId);
        if (existingSeat >= 0) {
          existing.seats[existingSeat].online = true;
          existing.seats[existingSeat].lastSeen = now;
          if (existing.phase === 'lobby' && name) {
            existing.seats[existingSeat].name = name;
          }
          ensureActiveHost(existing);
          existing.seq++;
          await saveRoom(existing, true);
          return buildPayload(existing, clientId, 0);
        }
        if (!requested) {
          code = roomCode();
        } else {
          return { ok: false, error: 'room-taken' };
        }
      }

      var room = {
        code: code,
        seq: 1,
        chatSeq: 0,
        phase: 'lobby',
        hostId: clientId,
        creatorId: clientId,
        seats: [{
          id: clientId,
          name: name,
          type: 'human',
          humanOwner: true,
          botTakeover: false,
          left: false,
          difficulty: null,
          online: true,
          lastSeen: now
        }],
        state: null,
        chat: [],
        lastChatByClient: {},
        created: now,
        updated: now
      };
      await saveRoom(room, true);
      return buildPayload(room, clientId, 0);
    }

    var code = normaliseCode(body.room);
    if (!isValidCode(code)) return { ok: false, error: 'bad-code' };
    var room = await loadRoom(code);
    if (!room || room.closed) return { ok: false, error: 'room-not-found', room: code };

    var presenceChanged = sweepPresence(room, op === 'disconnect' ? null : clientId);

    /* 2. Join or rejoin a room */
    if (op === 'join') {
      var name = cleanName(body.name) || 'Player';
      var idx = seatOf(room, clientId);
      var now = nowFn();

      if (idx >= 0) {
        var s = room.seats[idx];
        s.left = false;
        s.online = true;
        s.lastSeen = now;
        if (s.botTakeover && s.humanOwner) {
          s.botTakeover = false;
          s.type = 'human';
          if (room.state && room.state.players[idx]) {
            room.state.players[idx].type = 'human';
          }
        }
        if (room.phase === 'lobby' && name) {
          s.name = name;
        }
        ensureActiveHost(room);
        room.seq++;
        await saveRoom(room, true);
        return buildPayload(room, clientId, body.chatSince || 0);
      }

      if (room.phase !== 'lobby') {
        return { ok: false, error: 'room-in-progress', reason: 'in-progress' };
      }
      if (room.seats.length >= MAX_SEATS) {
        return { ok: false, error: 'room-full', reason: 'full' };
      }

      room.seats.push({
        id: clientId,
        name: name,
        type: 'human',
        humanOwner: true,
        botTakeover: false,
        left: false,
        difficulty: null,
        online: true,
        lastSeen: now
      });
      ensureActiveHost(room);
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince || 0);
    }

    var actorSeat = seatOf(room, clientId);
    if (actorSeat < 0) return { ok: false, error: 'not-in-room' };

    /* 3. Rename in lobby */
    if (op === 'rename') {
      if (room.phase !== 'lobby') return { ok: false, error: 'rename-locked' };
      var wanted = cleanName(body.name);
      if (!wanted) return { ok: false, error: 'rename-empty' };
      var was = room.seats[actorSeat].name;
      if (was !== wanted) {
        room.seats[actorSeat].name = wanted;
        room.seq++;
        await saveRoom(room, true);
      }
      var resPayload = buildPayload(room, clientId, body.chatSince);
      resPayload.renamed = { seat: actorSeat, from: was, to: wanted };
      return resPayload;
    }

    /* 4. Add bot (host only, lobby only) */
    if (op === 'addBot') {
      if (room.hostId !== clientId) return { ok: false, error: 'not-host' };
      if (room.phase !== 'lobby') return { ok: false, error: 'not-in-lobby' };
      if (room.seats.length >= MAX_SEATS) return { ok: false, error: 'room-full' };
      var botName = cleanName(body.name) || ('Bot ' + room.seats.length);
      var diff = ['easy', 'normal', 'hard'].indexOf(body.difficulty) >= 0 ? body.difficulty : 'normal';
      room.seats.push({
        id: 'bot-' + Math.random().toString(36).slice(2, 8),
        name: botName,
        type: 'ai',
        humanOwner: false,
        botTakeover: false,
        left: false,
        difficulty: diff,
        online: true,
        lastSeen: nowFn()
      });
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince);
    }

    /* 5. Remove/kick a seat (host only, lobby only) */
    if (op === 'removeSeat') {
      if (room.hostId !== clientId) return { ok: false, error: 'not-host' };
      if (room.phase !== 'lobby') return { ok: false, error: 'not-in-lobby' };
      var targetId = String(body.targetId || '');
      if (!targetId || targetId === clientId) return { ok: false, error: 'cannot-remove-self' };
      var beforeLen = room.seats.length;
      room.seats = room.seats.filter(function (s) { return s.id !== targetId; });
      if (room.seats.length !== beforeLen) {
        room.seq++;
        await saveRoom(room, true);
      }
      return buildPayload(room, clientId, body.chatSince);
    }

    /* 6. Start game or Rematch (host only) */
    if (op === 'start' || op === 'rematch') {
      if (room.hostId !== clientId) return { ok: false, error: 'not-host' };
      if (op === 'start' && room.phase !== 'lobby') return { ok: false, error: 'already-started' };
      if (room.seats.length < 2) return { ok: false, error: 'need-two' };

      room.seats.forEach(function (s) {
        if (s.humanOwner && !s.left && s.online) {
          s.type = 'human';
          s.botTakeover = false;
        }
      });

      var players = room.seats.map(function (s) {
        return {
          name: s.name,
          type: (s.type === 'ai' || s.botTakeover) ? 'ai' : 'human',
          difficulty: s.difficulty || 'normal'
        };
      });
      room.state = E.createGame({
        players: players,
        seed: body.seed != null ? Number(body.seed) : undefined
      });
      room.phase = 'playing';
      runBotTurns(room);
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince);
    }

    /* 7. Apply a game move (Server-Authoritative Referee) */
    if (op === 'intent') {
      if (!room.state || room.phase !== 'playing') {
        return { ok: false, error: 'not-playing', room: roomSummary(room) };
      }
      if (actorSeat !== room.state.current) {
        var syncOut = buildPayload(room, clientId, body.chatSince);
        syncOut.ok = false;
        syncOut.error = 'err.notNow';
        return syncOut;
      }
      var action = body.action || {};
      var result = E.applyAction(room.state, action);
      if (!result.ok) {
        var refused = buildPayload(room, clientId, body.chatSince);
        refused.ok = false;
        refused.error = result.error || 'err.generic';
        refused.params = result.params;
        if (presenceChanged) await saveRoom(room, false);
        return refused;
      }
      if (room.state.phase === 'gameover') {
        room.phase = 'ended';
      } else {
        runBotTurns(room);
      }
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince);
    }

    /* 8. Let a Bot take over an offline player's seat (Host action mid-game) */
    if (op === 'botTakeover') {
      if (room.hostId !== clientId) return { ok: false, error: 'not-host' };
      if (!room.state || room.phase !== 'playing') return { ok: false, error: 'not-playing' };
      var targetSeat = body.targetSeat != null ? Number(body.targetSeat) : room.state.current;
      var seatObj = room.seats[targetSeat];
      if (!seatObj) return { ok: false, error: 'invalid-seat' };
      if (seatObj.online && !seatObj.left && seatObj.type === 'human') {
        return { ok: false, error: 'player-still-online' };
      }
      seatObj.botTakeover = true;
      seatObj.type = 'ai';
      seatObj.difficulty = seatObj.difficulty || 'normal';
      if (room.state.players[targetSeat]) {
        room.state.players[targetSeat].type = 'ai';
        room.state.players[targetSeat].difficulty = seatObj.difficulty;
      }
      runBotTurns(room);
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince);
    }

    /* 9. Room chat */
    if (op === 'chat') {
      var text = cleanChat(body.text);
      if (!text) return { ok: false, error: 'empty-chat' };
      var now = nowFn();
      var lastAt = room.lastChatByClient[clientId] || 0;
      if (now - lastAt < 350) {
        return { ok: false, error: 'too-fast' };
      }
      room.lastChatByClient[clientId] = now;
      var line = {
        seq: ++room.chatSeq,
        id: clientId,
        seat: actorSeat,
        name: room.seats[actorSeat] ? room.seats[actorSeat].name : 'Player',
        text: text,
        at: now
      };
      room.chat.push(line);
      if (room.chat.length > CHAT_HISTORY) {
        room.chat.splice(0, room.chat.length - CHAT_HISTORY);
      }
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince);
    }

    /* 10. Abrupt disconnect notice (e.g. tab closed / connection dropped) */
    if (op === 'disconnect') {
      var dSeat = room.seats[actorSeat];
      if (dSeat && dSeat.online) {
        dSeat.online = false;
        dSeat.lastSeen = 0;
        ensureActiveHost(room);
        room.seq++;
        await saveRoom(room, true);
      }
      return { ok: true };
    }

    /* 11. Explicit leave room */
    if (op === 'leave') {
      if (room.phase === 'lobby') {
        room.seats.splice(actorSeat, 1);
        var remainingHumans = room.seats.filter(function (s) { return s.humanOwner && !s.left; });
        if (remainingHumans.length === 0) {
          await removeRoom(room.code);
          return { ok: true, closed: true };
        }
        ensureActiveHost(room);
        room.seq++;
        await saveRoom(room, true);
        return { ok: true };
      }

      /* Mid-game or ended: convert the leaving player's seat to an AI bot so
         the other players can finish the game without interruption. */
      var leavingSeat = room.seats[actorSeat];
      leavingSeat.left = true;
      leavingSeat.online = false;
      leavingSeat.botTakeover = true;
      leavingSeat.type = 'ai';
      leavingSeat.difficulty = leavingSeat.difficulty || 'normal';
      if (room.state && room.state.players[actorSeat]) {
        room.state.players[actorSeat].type = 'ai';
        room.state.players[actorSeat].difficulty = leavingSeat.difficulty;
      }

      var activeHumans = room.seats.filter(function (s) { return s.humanOwner && !s.left; });
      if (activeHumans.length === 0) {
        await removeRoom(room.code);
        return { ok: true, closed: true };
      }

      ensureActiveHost(room);
      if (room.phase === 'playing') {
        runBotTurns(room);
      }
      room.seq++;
      await saveRoom(room, true);
      return buildPayload(room, clientId, body.chatSince);
    }

    return { ok: false, error: 'unknown-op' };
  }

  /* Poll / Long-Poll handler for GET /api/room */
  async function poll(query) {
    pruneExpiredRooms();
    var code = normaliseCode(query && query.room);
    var clientId = String((query && query.clientId) || '').trim().slice(0, 64);
    if (!isValidCode(code) || !clientId) return { ok: false, error: 'bad-request' };

    var room = await loadRoom(code);
    if (!room || room.closed) return { ok: false, error: 'room-not-found', room: code };

    var seat = seatOf(room, clientId);
    if (seat < 0) return { ok: false, error: 'not-in-room', room: roomSummary(room) };

    var changed = sweepPresence(room, clientId);
    if (changed) {
      await saveRoom(room, false);
    }

    var since = Number(query.since || 0);
    var chatSince = Number(query.chatSince || 0);
    var wantWait = query.wait === '1' || query.wait === 'true';

    if (!wantWait || room.seq > since || room.chatSeq > chatSince) {
      return buildPayload(room, clientId, chatSince);
    }

    return await waitForChange(room, clientId, since, chatSince,
      query.waitMs != null ? Number(query.waitMs) : undefined);
  }

  return {
    execute: execute,
    poll: poll,
    loadRoom: loadRoom,
    rooms: rooms,
    waiters: waiters
  };
}

/* Singleton manager persisted across warm invocations on Vercel. */
function defaultManager() {
  if (!globalThis.__SPLENDOR_MANAGER__) {
    globalThis.__SPLENDOR_ROOMS__ = globalThis.__SPLENDOR_ROOMS__ || new Map();
    globalThis.__SPLENDOR_MANAGER__ = createRoomManager({
      rooms: globalThis.__SPLENDOR_ROOMS__
    });
  }
  return globalThis.__SPLENDOR_MANAGER__;
}

/* -------------------------------------------------------- HTTP handler */

function readJsonBody(req) {
  return new Promise(function (resolve) {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (err) { return resolve({}); }
    }
    var chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { resolve({}); }
    });
    req.on('error', function () { resolve({}); });
  });
}

function sendJson(res, statusCode, payload) {
  var body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(body);
}

function createHttpHandler(manager) {
  var mgr = manager || defaultManager();
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (req.method === 'GET') {
        var parsedUrl = new URL(req.url, 'http://localhost');
        var query = {};
        parsedUrl.searchParams.forEach(function (v, k) { query[k] = v; });
        var pollResult = await mgr.poll(query);
        sendJson(res, 200, pollResult);
        return;
      }

      if (req.method === 'POST') {
        var body = await readJsonBody(req);
        var execResult = await mgr.execute(body);
        sendJson(res, 200, execResult);
        return;
      }

      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err && err.message ? err.message : 'server-error' });
    }
  };
}

var mainHandler = createHttpHandler();
mainHandler.createRoomManager = createRoomManager;
mainHandler.createHttpHandler = createHttpHandler;
mainHandler.createUpstashAdapter = createUpstashAdapter;
mainHandler.viewFor = viewFor;

module.exports = mainHandler;

if (require.main === module) {
  var port = Number(process.env.PORT || 8000);
  var rootDir = path.resolve(__dirname, '..');
  var mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
  };
  var server = http.createServer(function (req, res) {
    var pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/room' || pathname === '/api/room/') {
      return mainHandler(req, res);
    }
    var rel = pathname === '/' ? '/index.html' : pathname;
    var filePath = path.join(rootDir, path.normalize(rel));
    if (filePath.indexOf(rootDir) !== 0 || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
  server.listen(port, function () {
    console.log('Splendor server running at http://localhost:' + port);
  });
}
