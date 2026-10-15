/* Splendor — online play client for the Vercel authoritative server (/api/room).
 *
 * The Vercel function (`api/room.js`) owns the authoritative game state,
 * validates every move with `SplendorEngine`, runs AI turns (`SplendorAI`),
 * and redacts each player's view (`viewFor`) before sending it over the wire.
 *
 * Because the server is the referee:
 *   - No public MQTT broker is needed.
 *   - No player's browser holds secret deck order or other players' reserved
 *     cards.
 *   - If the player who created the room loses connection, the game continues
 *     for everyone else and host management privileges (`hostId`) automatically
 *     transfer to the next connected human player (and stay with the new host
 *     even if the old host reconnects).
 *
 * Synchronisation uses HTTP POST for actions and Long-Polling GET requests
 * (`/api/room?room=...&clientId=...&since=...&wait=1`) for instant state and
 * chat updates without burning database read commands.
 *
 * No DOM here — this module is pure protocol and state sync so it can be
 * tested headlessly against a local Node server.
 */
(function (global) {
  'use strict';

  var E = global.SplendorEngine;

  /* No I, O, 0 or 1: these codes get read out loud and typed in by hand. */
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LENGTH = 5;
  var MAX_SEATS = 4;

  var MAX_NAME = 16;
  var MAX_CHAT = 240;
  var CHAT_HISTORY = 120;
  var DEFAULT_API = '/api/room';

  function clean(text, limit) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function cleanName(text) { return clean(text, MAX_NAME); }
  function cleanChat(text) { return clean(text, MAX_CHAT); }

  function cleanTurnTimer(value, fallback) {
    var def = fallback != null ? fallback : 2;
    if (value == null || value === '') return def;
    var n = Number(value);
    if (!Number.isFinite(n)) return def;
    var mins = Math.round(n);
    if (mins < 1) return 1;
    if (mins > 60) return 60;
    return mins;
  }

  function randomId(prefix) {
    return (prefix || 'p') + '-' + Math.random().toString(36).slice(2, 10);
  }

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

  /* What one seat is allowed to know. */
  function viewFor(state, seat) {
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

  function create(options) {
    options = options || {};
    var fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(global) : null);

    var net = {
      role: null,               // 'host' | 'guest' (dynamically reflects net.hostId === net.clientId)
      room: null,
      clientId: options.clientId || randomId('p'),
      apiUrl: options.apiUrl || DEFAULT_API,
      connected: false,
      seats: [],
      phase: 'lobby',
      hostId: null,
      turnTimer: 2,
      seq: 0,
      joined: false,
      hostGone: false,          // kept for status compatibility (always false with server referee)
      lastError: null,
      notice: null,
      chat: []
    };

    var listeners = {};
    var wantsLeave = false;
    var pollAbort = null;
    var pollTimer = null;
    var connectTimer = null;
    var roomTimer = null;
    var retryCount = 0;
    var lastChatAt = 0;
    var lastChatSeq = 0;
    var lastViewSeq = -1;
    var lastTimeoutAt = 0;
    var wantedName = null;
    var wantedTimer = 2;
    var activeLoopId = 0;

    var CONNECT_TIMEOUT = options.connectTimeout || 6500;
    var ROOM_TIMEOUT = options.roomTimeout || 7000;
    var WAIT_MS = options.waitMs != null ? options.waitMs : undefined;
    var RETRY_BASE_MS = options.retryMs || 450;

    net.on = function (name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return net;
    };

    function emit(name, payload) {
      (listeners[name] || []).forEach(function (fn) {
        try { fn(payload); } catch (err) { report(err.message); }
      });
    }

    function report(code) {
      net.lastError = code || null;
      emit('status', status());
    }

    function notice(message) {
      net.notice = message || null;
      emit('status', status());
    }

    function clearError(code) {
      if (!code || net.lastError === code) {
        net.lastError = null;
        emit('status', status());
      }
    }

    function status() {
      return {
        role: net.role,
        room: net.room,
        clientId: net.clientId,
        connected: net.connected,
        phase: net.phase,
        joined: net.joined,
        hostId: net.hostId,
        turnTimer: net.turnTimer,
        hostGone: false,
        seats: net.seats.slice(),
        error: net.lastError,
        notice: net.notice,
        apiUrl: net.apiUrl
      };
    }
    net.status = status;

    function seatOf(clientId) {
      for (var i = 0; i < net.seats.length; i++) {
        if (net.seats[i].id === clientId) return i;
      }
      return -1;
    }
    net.seatOf = seatOf;
    net.mySeat = function () { return seatOf(net.clientId); };
    net.isHost = function () { return !!net.hostId && net.hostId === net.clientId; };

    /* ---------------------------------------------------- HTTP transport */

    async function postOp(payload, keepalive) {
      if (!fetchFn) throw new Error('fetch unavailable');
      var res = await fetchFn(net.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: !!keepalive
      });
      if (!res.ok) throw new Error('http-' + res.status);
      return await res.json();
    }

    async function getPoll(signal) {
      if (!fetchFn) throw new Error('fetch unavailable');
      var sep = net.apiUrl.indexOf('?') >= 0 ? '&' : '?';
      var url = net.apiUrl + sep +
        'room=' + encodeURIComponent(net.room) +
        '&clientId=' + encodeURIComponent(net.clientId) +
        '&since=' + encodeURIComponent(net.seq) +
        '&chatSince=' + encodeURIComponent(lastChatSeq) +
        '&wait=1' +
        (WAIT_MS != null ? '&waitMs=' + encodeURIComponent(WAIT_MS) : '');
      var res = await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: signal
      });
      if (!res.ok) throw new Error('http-' + res.status);
      return await res.json();
    }

    /* Applies a room/view/chat snapshot received from `/api/room`. */
    function ingest(data, forceView) {
      if (!data || wantsLeave) return;

      var wasConnected = net.connected;
      net.connected = true;
      net.notice = null;
      retryCount = 0;
      clearTimeout(connectTimer);
      clearError('server-unreachable');
      clearError('broker-unreachable');

      if (data.room) {
        var r = data.room;
        if (r.closed) {
          emit('room', r);
          return;
        }
        var prevSeats = net.seats.slice();
        var prevHostId = net.hostId;
        var wasJoined = net.joined;

        net.joined = true;
        clearTimeout(roomTimer);
        clearError('room-not-found');

        net.room = r.room || net.room;
        net.seq = r.seq != null ? r.seq : net.seq;
        net.phase = r.phase || 'lobby';
        net.hostId = r.hostId || net.hostId;
        if (r.turnTimer != null) net.turnTimer = cleanTurnTimer(r.turnTimer, net.turnTimer);
        net.role = net.hostId === net.clientId ? 'host' : 'guest';
        net.seats = (r.seats || []).map(function (s, idx) {
          return {
            id: s.id,
            name: s.name,
            type: s.type,
            humanOwner: !!s.humanOwner,
            botTakeover: !!s.botTakeover,
            left: !!s.left,
            difficulty: s.difficulty || null,
            online: s.online !== false,
            seat: idx
          };
        });

        /* Emit granular roster events for UI & tests. */
        if (wasJoined && prevSeats.length) {
          var prevById = {};
          prevSeats.forEach(function (s, idx) { prevById[s.id] = { seat: s, index: idx }; });

          net.seats.forEach(function (s, idx) {
            var old = prevById[s.id];
            if (!old) {
              emit('seated', { clientId: s.id, seat: idx, rejoined: false });
            } else {
              if (!old.seat.online && s.online) {
                emit('seated', { clientId: s.id, seat: idx, rejoined: true });
              } else if (old.seat.online && !s.online) {
                emit('left', { clientId: s.id, seat: idx, name: s.name });
              }
              if (old.seat.name !== s.name) {
                emit('renamed', { clientId: s.id, seat: idx, from: old.seat.name, to: s.name });
              }
            }
          });
        }

        if (prevHostId && net.hostId && prevHostId !== net.hostId) {
          var newHostIdx = seatOf(net.hostId);
          emit('hostChanged', {
            from: prevHostId,
            to: net.hostId,
            seat: newHostIdx,
            name: newHostIdx >= 0 ? net.seats[newHostIdx].name : ''
          });
        }

        if (r.lastTimeout && r.lastTimeout.at && r.lastTimeout.at !== lastTimeoutAt) {
          lastTimeoutAt = r.lastTimeout.at;
          emit('turnTimeout', r.lastTimeout);
        }

        emit('room', r);
      }

      if (data.chat && Array.isArray(data.chat)) {
        data.chat.forEach(function (item) {
          if (item.seq && item.seq <= lastChatSeq) return;
          if (item.seq) lastChatSeq = item.seq;
          receiveChat(item);
        });
      }

      if (data.view && data.view.state) {
        if (data.view.state.turnRemainingMs != null) {
          data.view.state.clientDeadline = Date.now() + Number(data.view.state.turnRemainingMs);
        } else {
          data.view.state.clientDeadline = null;
        }
        if (forceView || data.view.seq !== lastViewSeq) {
          lastViewSeq = data.view.seq;
          emit('view', data.view);
        }
      }

      if (!wasConnected || data.room) {
        emit('status', status());
      }
    }

    /* ---------------------------------------------------- sync / polling */

    function stopPolling() {
      activeLoopId++;
      clearTimeout(pollTimer);
      pollTimer = null;
      if (pollAbort) {
        try { pollAbort.abort(); } catch (err) { /* ignore */ }
        pollAbort = null;
      }
    }

    function startPolling() {
      stopPolling();
      var loopId = ++activeLoopId;

      async function stepPoll() {
        if (wantsLeave || loopId !== activeLoopId || !net.room) return;

        /* If not yet joined (e.g. waiting for a room to be created or recovering
           after a disconnect), try joining/rejoining first. */
        if (!net.joined) {
          try {
            var joinRes = await postOp({
              op: net.role === 'host' && !net.hostId ? 'host' : 'join',
              room: net.room,
              clientId: net.clientId,
              name: wantedName,
              turnTimer: wantedTimer,
              chatSince: lastChatSeq
            });
            if (wantsLeave || loopId !== activeLoopId) return;
            if (joinRes && joinRes.ok) {
              ingest(joinRes, true);
            } else if (joinRes && (joinRes.error === 'room-full' || joinRes.error === 'room-in-progress')) {
              net.connected = true;
              clearTimeout(connectTimer);
              clearTimeout(roomTimer);
              report(joinRes.error);
              emit('rejected', { reason: joinRes.reason || (joinRes.error === 'room-full' ? 'full' : 'in-progress') });
              return;
            } else if (joinRes && joinRes.error === 'room-not-found') {
              net.connected = true;
              clearTimeout(connectTimer);
              clearError('server-unreachable');
              emit('status', status());
            }
          } catch (err) {
            if (wantsLeave || loopId !== activeLoopId) return;
            onNetworkDrop();
          }
          if (!wantsLeave && loopId === activeLoopId) {
            pollTimer = setTimeout(stepPoll, RETRY_BASE_MS);
          }
          return;
        }

        pollAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        try {
          var res = await getPoll(pollAbort ? pollAbort.signal : undefined);
          if (wantsLeave || loopId !== activeLoopId) return;

          if (res && res.ok) {
            var Reconnected = !net.connected;
            ingest(res, Reconnected);
            pollTimer = setTimeout(stepPoll, 20);
            return;
          }

          if (res && (res.error === 'not-in-room' || res.error === 'room-not-found')) {
            /* If the server restarted or lost our seat in lobby, attempt rejoin. */
            if (res.room && res.room.phase === 'lobby') {
              net.joined = false;
              pollTimer = setTimeout(stepPoll, 100);
              return;
            }
            if (res.error === 'room-not-found') {
              net.joined = false;
              report('room-not-found');
              pollTimer = setTimeout(stepPoll, RETRY_BASE_MS);
              return;
            }
          }
        } catch (err) {
          if (wantsLeave || loopId !== activeLoopId) return;
          if (err && err.name === 'AbortError') return;
          onNetworkDrop();
          var delay = Math.min(3500, RETRY_BASE_MS * Math.pow(1.4, Math.min(retryCount, 5)));
          pollTimer = setTimeout(stepPoll, delay);
          return;
        }

        if (!wantsLeave && loopId === activeLoopId) {
          pollTimer = setTimeout(stepPoll, RETRY_BASE_MS);
        }
      }

      stepPoll();
    }

    function onNetworkDrop() {
      retryCount++;
      net.connected = false;
      notice('reconnect-' + retryCount);
    }

    function watchForConnect() {
      clearTimeout(connectTimer);
      connectTimer = setTimeout(function () {
        if (!net.connected && !wantsLeave) report('server-unreachable');
      }, CONNECT_TIMEOUT);
    }

    function watchForRoom() {
      clearTimeout(roomTimer);
      roomTimer = setTimeout(function () {
        if (!net.joined && net.connected && !wantsLeave) report('room-not-found');
      }, ROOM_TIMEOUT);
    }

    /* ------------------------------------------------------------- hosting */

    net.host = function (config) {
      config = config || {};
      wantsLeave = false;
      if (config.apiUrl) net.apiUrl = config.apiUrl;
      net.role = 'host';
      net.room = normaliseCode(config.room) || roomCode();
      net.hostId = net.clientId;
      net.phase = 'lobby';
      net.joined = false;
      net.connected = false;
      lastViewSeq = -1;
      lastTimeoutAt = 0;
      wantedName = cleanName(config.name) || 'Host';
      wantedTimer = cleanTurnTimer(config.turnTimer, 2);
      net.turnTimer = wantedTimer;
      net.seats = [{ id: net.clientId, name: wantedName, type: 'human', online: true, seat: 0 }];

      watchForConnect();
      postOp({
        op: 'host',
        room: net.room,
        clientId: net.clientId,
        name: wantedName,
        turnTimer: wantedTimer
      }).then(function (res) {
        if (wantsLeave) return;
        if (res && res.ok) {
          ingest(res, true);
        } else if (res && res.error) {
          report(res.error);
        }
        startPolling();
      }).catch(function () {
        if (wantsLeave) return;
        onNetworkDrop();
        startPolling();
      });

      return net;
    };

    /* ------------------------------------------------------------- joining */

    net.join = function (config) {
      config = config || {};
      wantsLeave = false;
      if (config.apiUrl) net.apiUrl = config.apiUrl;
      net.role = 'guest';
      net.room = normaliseCode(config.room);
      net.phase = 'lobby';
      net.joined = false;
      net.connected = false;
      lastViewSeq = -1;
      wantedName = cleanName(config.name) || 'Player';

      watchForConnect();
      watchForRoom();

      postOp({
        op: 'join',
        room: net.room,
        clientId: net.clientId,
        name: wantedName,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (wantsLeave) return;
        if (res && res.ok) {
          ingest(res, true);
          startPolling();
          return;
        }
        if (res && (res.error === 'room-full' || res.error === 'room-in-progress')) {
          net.connected = true;
          clearTimeout(connectTimer);
          clearTimeout(roomTimer);
          report(res.error);
          emit('rejected', { reason: res.reason || (res.error === 'room-full' ? 'full' : 'in-progress') });
          return;
        }
        if (res && res.error === 'room-not-found') {
          net.connected = true;
          clearTimeout(connectTimer);
          emit('status', status());
        }
        startPolling();
      }).catch(function () {
        if (wantsLeave) return;
        onNetworkDrop();
        startPolling();
      });

      return net;
    };

    /* ----------------------------------------------------- lobby & actions */

    net.addBot = function (name, difficulty) {
      if (net.seats.length >= MAX_SEATS) return false;
      postOp({
        op: 'addBot',
        room: net.room,
        clientId: net.clientId,
        name: cleanName(name) || ('Bot ' + net.seats.length),
        difficulty: difficulty || 'normal',
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, false);
      }).catch(function () { onNetworkDrop(); });
      return true;
    };

    net.removeSeat = function (targetId) {
      if (!targetId || targetId === net.clientId) return false;
      postOp({
        op: 'removeSeat',
        room: net.room,
        clientId: net.clientId,
        targetId: targetId,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, false);
      }).catch(function () { onNetworkDrop(); });
      return true;
    };

    net.startGame = function (opts) {
      opts = opts || {};
      postOp({
        op: 'start',
        room: net.room,
        clientId: net.clientId,
        seed: opts.seed,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, true);
        else if (res && res.error) emit('actionError', { error: res.error });
      }).catch(function () { onNetworkDrop(); });
    };

    net.rematch = function (opts) {
      opts = opts || {};
      postOp({
        op: 'rematch',
        room: net.room,
        clientId: net.clientId,
        seed: opts.seed,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, true);
        else if (res && res.error) emit('actionError', { error: res.error });
      }).catch(function () { onNetworkDrop(); });
    };

    net.sendIntent = function (action) {
      postOp({
        op: 'intent',
        room: net.room,
        clientId: net.clientId,
        action: action,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (!res) return;
        ingest(res, true);
        if (!res.ok && res.error) {
          emit('actionError', { error: res.error, params: res.params });
        }
      }).catch(function () {
        onNetworkDrop();
        emit('actionError', { error: 'net.offline' });
      });
    };

    net.botTakeover = function (targetSeat) {
      postOp({
        op: 'botTakeover',
        room: net.room,
        clientId: net.clientId,
        targetSeat: targetSeat,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, true);
        else if (res && res.error) emit('actionError', { error: res.error });
      }).catch(function () { onNetworkDrop(); });
    };

    net.setTimer = function (minutes) {
      var mins = cleanTurnTimer(minutes, net.turnTimer);
      wantedTimer = mins;
      net.turnTimer = mins;
      if (net.room && net.connected) {
        postOp({
          op: 'setTimer',
          room: net.room,
          clientId: net.clientId,
          turnTimer: mins,
          chatSince: lastChatSeq
        }).then(function (res) {
          if (res && res.ok) ingest(res, false);
        }).catch(function () { onNetworkDrop(); });
      }
      return mins;
    };

    net.checkTimeout = function () {
      if (!net.room || !net.connected) return;
      postOp({
        op: 'timeout',
        room: net.room,
        clientId: net.clientId,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, true);
      }).catch(function () { /* ignore transient error */ });
    };

    /* ------------------------------------------------------------ renaming */

    net.canRename = function () { return net.phase === 'lobby'; };

    net.rename = function (wanted) {
      var name = cleanName(wanted);
      if (!name || !net.canRename()) return null;
      wantedName = name;
      var myIdx = seatOf(net.clientId);
      var prevName = myIdx >= 0 ? net.seats[myIdx].name : null;
      if (myIdx >= 0 && prevName !== name) {
        net.seats[myIdx].name = name;
      }
      if (net.room && net.connected) {
        postOp({
          op: 'rename',
          room: net.room,
          clientId: net.clientId,
          name: name,
          chatSince: lastChatSeq
        }).then(function (res) {
          if (res && res.ok) {
            if (res.renamed && res.renamed.from !== res.renamed.to) {
              emit('renamed', {
                clientId: net.clientId,
                seat: res.renamed.seat,
                from: res.renamed.from,
                to: res.renamed.to
              });
            }
            ingest(res, false);
          }
        }).catch(function () { onNetworkDrop(); });
      }
      return name;
    };

    net.wantedName = function () { return wantedName; };

    /* ---------------------------------------------------------------- chat */

    function receiveChat(message) {
      if (!message) return;
      var text = cleanChat(message.text);
      if (!text) return;
      var seat = message.seat != null ? message.seat : seatOf(message.id);
      var line = {
        id: String(message.id || '').slice(0, 64),
        seat: seat,
        name: cleanName(message.name) || (seat >= 0 && net.seats[seat] ? net.seats[seat].name : '?'),
        text: text,
        mine: message.id === net.clientId,
        at: message.at || Date.now()
      };
      remember(line);
      emit('chat', line);
    }

    function remember(line) {
      net.chat.push(line);
      if (net.chat.length > CHAT_HISTORY) net.chat.splice(0, net.chat.length - CHAT_HISTORY);
    }

    net.note = function (text) {
      var body = cleanChat(text);
      if (!body) return null;
      var line = { system: true, text: body, at: Date.now() };
      remember(line);
      emit('chat', line);
      return line;
    };

    net.sendChat = function (text) {
      var body = cleanChat(text);
      if (!body || !net.room || !net.connected) return null;
      var now = Date.now();
      if (now - lastChatAt < 350) return null;
      lastChatAt = now;
      postOp({
        op: 'chat',
        room: net.room,
        clientId: net.clientId,
        text: body,
        chatSince: lastChatSeq
      }).then(function (res) {
        if (res && res.ok) ingest(res, false);
      }).catch(function () { onNetworkDrop(); });
      return body;
    };

    /* ------------------------------------------------- disconnect / leave */

    /* Simulates or notifies an abrupt connection drop without forfeiting the
       player's seat (used on pagehide or in tests). */
    net.disconnect = function () {
      stopPolling();
      clearTimeout(connectTimer);
      clearTimeout(roomTimer);
      var currentRoom = net.room;
      net.connected = false;
      emit('status', status());
      if (currentRoom && fetchFn) {
        postOp({ op: 'disconnect', room: currentRoom, clientId: net.clientId }, true)
          .catch(function () { /* ignore */ });
      }
    };

    /* Reconnects a previously disconnected client to the same room. */
    net.reconnect = function () {
      if (!net.room) return;
      wantsLeave = false;
      net.joined = false;
      startPolling();
    };

    net.leave = function () {
      wantsLeave = true;
      stopPolling();
      clearTimeout(connectTimer);
      clearTimeout(roomTimer);
      var currentRoom = net.room;
      var wasJoined = net.joined;
      net.joined = false;
      net.connected = false;
      net.role = null;
      net.room = null;
      net.hostId = null;
      net.seats = [];
      net.chat = [];
      lastChatSeq = 0;
      lastViewSeq = -1;
      if (currentRoom && wasJoined && fetchFn) {
        postOp({ op: 'leave', room: currentRoom, clientId: net.clientId }, true)
          .catch(function () { /* ignore */ });
      }
      emit('status', status());
    };

    return net;
  }

  global.SplendorNet = {
    create: create,
    DEFAULT_API: DEFAULT_API,
    MAX_SEATS: MAX_SEATS,
    roomCode: roomCode,
    normaliseCode: normaliseCode,
    isValidCode: isValidCode,
    viewFor: viewFor,
    cleanName: cleanName,
    cleanChat: cleanChat,
    cleanTurnTimer: cleanTurnTimer,
    MAX_NAME: MAX_NAME,
    MAX_CHAT: MAX_CHAT,
    CHAT_HISTORY: CHAT_HISTORY
  };
})(typeof window !== 'undefined' ? window : globalThis);
