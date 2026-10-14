/* Splendor — online play over MQTT.
 *
 * There is no game server: GitHub Pages serves static files. Instead one
 * player's browser is the referee ("host") and the others send it their
 * intended moves through a public MQTT broker. The host owns the only
 * authoritative game state, applies every move with the same rules engine the
 * offline game uses, and publishes the result.
 *
 * Topics, all under splendor/v1/<room>/
 *
 *   room              retained  the lobby: who is seated, whose turn, phase
 *   view/<clientId>   retained  that player's view of the game state
 *   join                        guest -> host: "seat me", with a name
 *   intent                      guest -> host: "I want to play this move"
 *   rename                      guest -> host: "call me this instead"
 *   chat                        everyone -> everyone: table talk
 *   reject/<clientId>           host -> guest: why a join was refused
 *   bye/<clientId>              the broker's last will for a dropped player
 *
 * Chat is the one topic the host does not referee: it needs no rules, and
 * routing it through the host would silence the table whenever the host's
 * connection hiccuped. It is also the one topic deliberately not retained —
 * this is a public broker, and a room's chatter should not outlive the room.
 *
 * Retained messages do the heavy lifting: a player who joins late, reloads the
 * page or comes back from a tunnel is handed the current room and their own
 * view by the broker, with nobody having to ask for a resend.
 *
 * Hidden information is kept hidden. Each player's view is redacted before it
 * is published: the decks become counts, and other players' reserved cards
 * become blanks. A player only ever receives what Splendor's rules let them
 * see, so a curious opponent cannot read the deck order out of devtools.
 *
 * No DOM here — this module is protocol plus engine, which is what lets the
 * whole thing be tested headlessly against a real broker.
 */
(function (global) {
  'use strict';

  var E = global.SplendorEngine;
  var MQTT = global.MqttLite;

  /* Public brokers that speak MQTT over WebSocket. A page served over https
     must use wss://, or the browser blocks it as mixed content. */
  var BROKERS = [
    { id: 'emqx', label: 'EMQX (broker.emqx.io)', url: 'wss://broker.emqx.io:8084/mqtt' },
    { id: 'hivemq', label: 'HiveMQ (broker.hivemq.com)', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { id: 'mosquitto', label: 'Mosquitto (test.mosquitto.org)', url: 'wss://test.mosquitto.org:8081/mqtt' }
  ];

  /* No I, O, 0 or 1: these codes get read out loud and typed in by hand. */
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LENGTH = 5;
  var MAX_SEATS = 4;

  /* Names and chat lines arrive from other people's browsers, so every one of
     them is trimmed and cut to size on the way in as well as on the way out:
     a peer that sends a megabyte of text, or a name made of newlines, must not
     be able to wreck anyone else's table. */
  var MAX_NAME = 16;
  var MAX_CHAT = 240;
  var CHAT_HISTORY = 120;       // what one client keeps to show; older lines fall off

  /* Strips the characters that would break a line of text out of its place —
     controls, newlines, and the invisible direction overrides — then collapses
     the leftover whitespace. */
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

  function base(room) { return 'splendor/v1/' + room; }
  function topic(room, suffix) { return base(room) + '/' + suffix; }

  /* What one seat is allowed to know. */
  function viewFor(state, seat) {
    var view = E.clone(state);
    [1, 2, 3].forEach(function (tier) {
      view.decks[tier] = view.decks[tier].map(function () { return null; });   // count only
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
    var net = {
      role: null,               // 'host' | 'guest'
      room: null,
      clientId: options.clientId || MQTT.randomId('p'),
      brokerUrl: null,
      connected: false,
      seats: [],                // host's roster; guests get a copy via `room`
      phase: 'lobby',
      hostId: null,
      seq: 0,
      joined: false,            // a room message has actually arrived
      hostGone: false,          // the broker told us the host dropped
      lastError: null,          // a coded failure the UI must explain
      notice: null,             // transient chatter, e.g. "reconnecting"
      chat: []                  // what this client has heard said, oldest first
    };

    var client = null;
    var listeners = {};
    var state = null;           // host only: the authoritative game
    var wantsLeave = false;
    var connectTimer = null;    // the broker never answered
    var roomTimer = null;       // the broker answered but the room is not there
    var lastChatAt = 0;         // keeps a stuck key off a shared public broker
    var wantedName = null;      // what this player asked to be called, latest wins

    /* Long enough for a slow mobile connection, short enough that nobody sits
       watching "connecting" wondering whether it is broken. */
    var CONNECT_TIMEOUT = options.connectTimeout || 6500;
    var ROOM_TIMEOUT = options.roomTimeout || 7000;

    net.on = function (name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return net;
    };

    function emit(name, payload) {
      (listeners[name] || []).forEach(function (fn) {
        try { fn(payload); } catch (err) { report(err.message); }
      });
    }

    /* A coded reason the UI is expected to explain to the player. */
    function report(code) {
      net.lastError = code || null;
      emit('status', status());
    }

    /* Something worth showing but not a failure. */
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
        role: net.role, room: net.room, clientId: net.clientId,
        connected: net.connected, phase: net.phase, joined: net.joined,
        hostGone: net.hostGone,
        seats: net.seats.slice(), error: net.lastError, notice: net.notice,
        brokerUrl: net.brokerUrl
      };
    }
    net.status = status;

    function publish(suffix, message, retain) {
      if (!client) return;
      client.publish(topic(net.room, suffix), JSON.stringify(message), { retain: !!retain });
    }

    /* Clearing a retained topic means publishing an empty payload to it. */
    function clearRetained(suffix) {
      if (!client) return;
      client.publish(topic(net.room, suffix), '', { retain: true });
    }

    function seatOf(clientId) {
      for (var i = 0; i < net.seats.length; i++) {
        if (net.seats[i].id === clientId) return i;
      }
      return -1;
    }
    net.seatOf = seatOf;
    net.mySeat = function () { return seatOf(net.clientId); };

    function openSocket(url, will) {
      net.brokerUrl = url;
      client = MQTT.connect(url, {
        clientId: net.clientId + '-' + Math.random().toString(36).slice(2, 6),
        keepalive: 45,
        will: will
      });

      /* A broker that is blocked rather than absent leaves the socket sitting
         in CONNECTING with no error at all, so give up saying "connecting"
         after a while and tell the player. Reconnection continues underneath. */
      clearTimeout(connectTimer);
      connectTimer = setTimeout(function () {
        if (!net.connected) report('broker-unreachable');
      }, CONNECT_TIMEOUT);

      client.on('error', function () { /* the close/timeout paths report */ });
      client.on('close', function () {
        net.connected = false;
        emit('status', status());
      });
      client.on('reconnect', function (info) {
        notice('reconnect-' + info.attempt);
      });
      return client;
    }

    /* The host publishes the room as a retained message, so a room that exists
       answers within a moment. Silence means there is no such room (yet). */
    function watchForRoom() {
      clearTimeout(roomTimer);
      roomTimer = setTimeout(function () {
        if (!net.joined) report('room-not-found');
      }, ROOM_TIMEOUT);
    }

    /* ------------------------------------------------------------- hosting */

    net.host = function (config) {
      net.role = 'host';
      net.room = normaliseCode(config.room) || roomCode();
      net.hostId = net.clientId;
      net.phase = 'lobby';
      wantedName = cleanName(config.name) || 'Host';
      net.seats = [{ id: net.clientId, name: wantedName, type: 'human', online: true }];

      /* If the host's tab dies the guests would otherwise sit in front of a
         frozen board forever, so let the broker announce it for us. */
      openSocket(config.brokerUrl, {
        topic: topic(net.room, 'hostgone'),
        payload: JSON.stringify({ t: 'hostgone', id: net.clientId })
      });
      client.on('connect', function () {
        net.connected = true;
        net.joined = true;               // the host *is* the room
        net.notice = null;
        clearTimeout(connectTimer);
        clearError();
        client.publish(topic(net.room, 'hostgone'), '', { retain: true });
        client.subscribe(topic(net.room, 'join'));
        client.subscribe(topic(net.room, 'intent'));
        client.subscribe(topic(net.room, 'rename'));
        client.subscribe(topic(net.room, 'chat'));
        client.subscribe(topic(net.room, 'bye/+'));
        publishRoom();
        if (state) publishViews();
        emit('status', status());
      });
      client.on('message', onHostMessage);
      return net;
    };

    function publishRoom(extra) {
      var message = {
        t: 'room', seq: ++net.seq, phase: net.phase, hostId: net.hostId,
        seats: net.seats.map(function (s, i) {
          return { id: s.id, name: s.name, type: s.type, online: s.online, seat: i };
        }),
        updated: Date.now()
      };
      if (extra) Object.keys(extra).forEach(function (k) { message[k] = extra[k]; });
      publish('room', message, true);
      emit('room', message);
    }
    net.publishRoom = publishRoom;

    /* One redacted snapshot per seat, retained so a reload restores it. */
    function publishViews() {
      if (!state) return;
      net.seats.forEach(function (seat, index) {
        if (seat.type !== 'human') return;
        publish('view/' + seat.id, { t: 'view', seq: net.seq, seat: index, state: viewFor(state, index) }, true);
      });
    }
    net.publishViews = publishViews;

    /* The host tells the world the game changed: roster first, then views. */
    net.broadcast = function (nextState) {
      if (nextState) state = nextState;
      net.phase = state ? (state.phase === 'gameover' ? 'ended' : 'playing') : 'lobby';
      net.seq++;
      publishRoom(state ? { current: state.current, round: state.round } : null);
      publishViews();
    };

    net.setState = function (nextState) { state = nextState; };
    net.getState = function () { return state; };

    net.addBot = function (name, difficulty) {
      if (net.seats.length >= MAX_SEATS) return false;
      net.seats.push({
        id: MQTT.randomId('bot'), name: name, type: 'ai',
        difficulty: difficulty || 'normal', online: true
      });
      publishRoom();
      return true;
    };

    net.removeSeat = function (clientId) {
      if (clientId === net.clientId) return false;
      net.seats = net.seats.filter(function (s) { return s.id !== clientId; });
      clearRetained('view/' + clientId);
      publishRoom();
      return true;
    };

    function onHostMessage(topicName, payload) {
      var message = parse(payload);
      if (!message) return;

      if (MQTT.matches(topic(net.room, 'join'), topicName)) {
        var seat = seatOf(message.id);
        if (seat >= 0) {                                  // a known player came back
          net.seats[seat].online = true;
          var returning = cleanName(message.name);
          if (returning) net.seats[seat].name = returning;
          publishRoom();
          publishViews();
          emit('seated', { clientId: message.id, seat: seat, rejoined: true });
          return;
        }
        if (net.phase !== 'lobby') {
          publish('reject/' + message.id, { t: 'reject', reason: 'in-progress' });
          return;
        }
        if (net.seats.length >= MAX_SEATS) {
          publish('reject/' + message.id, { t: 'reject', reason: 'full' });
          return;
        }
        net.seats.push({
          id: message.id, name: cleanName(message.name) || 'Player', type: 'human', online: true
        });
        publishRoom();
        emit('seated', { clientId: message.id, seat: net.seats.length - 1, rejoined: false });
        return;
      }

      if (MQTT.matches(topic(net.room, 'intent'), topicName)) {
        emit('intent', message);
        return;
      }

      if (MQTT.matches(topic(net.room, 'rename'), topicName)) {
        applyRename(message.id, message.name);
        return;
      }

      if (MQTT.matches(topic(net.room, 'chat'), topicName)) {
        receiveChat(message);
        return;
      }

      if (MQTT.matches(topic(net.room, 'bye/+'), topicName)) {
        var gone = seatOf(message.id);
        if (gone >= 0) {
          net.seats[gone].online = false;
          publishRoom();
          emit('left', { clientId: message.id, seat: gone });
        }
      }
    }

    /* -------------------------------------------------------------- joining */

    net.join = function (config) {
      net.role = 'guest';
      net.room = normaliseCode(config.room);
      net.phase = 'lobby';
      wantedName = cleanName(config.name) || 'Player';

      openSocket(config.brokerUrl, {
        topic: topic(net.room, 'bye/' + net.clientId),
        payload: JSON.stringify({ t: 'bye', id: net.clientId })
      });

      client.on('connect', function () {
        net.connected = true;
        net.notice = null;
        clearTimeout(connectTimer);
        clearError('broker-unreachable');
        client.subscribe(topic(net.room, 'room'));
        client.subscribe(topic(net.room, 'view/' + net.clientId));
        client.subscribe(topic(net.room, 'reject/' + net.clientId));
        client.subscribe(topic(net.room, 'hostgone'));
        client.subscribe(topic(net.room, 'chat'));
        /* A reconnect runs this again, so it must carry the name the player
           has since chosen rather than the one they arrived with. */
        publish('join', { t: 'join', id: net.clientId, name: wantedName });
        watchForRoom();
        emit('status', status());
      });

      client.on('message', function (topicName, payload) {
        var message = parse(payload);
        if (!message) return;                              // '' clears a retained topic

        if (topicName === topic(net.room, 'hostgone')) {
          /* Not necessarily final: a host who lost signal reconnects and
             publishes the room again, which clears this. */
          net.hostGone = true;
          report('host-gone');
          emit('hostgone', message);
          return;
        }
        if (topicName === topic(net.room, 'room')) {
          net.joined = true;
          net.hostGone = false;
          clearTimeout(roomTimer);
          clearError('room-not-found');
          clearError('host-gone');
          net.seats = message.seats || [];
          net.phase = message.phase || 'lobby';
          net.hostId = message.hostId || null;
          emit('room', message);
          emit('status', status());
          return;
        }
        if (topicName === topic(net.room, 'chat')) {
          receiveChat(message);
          return;
        }
        if (topicName === topic(net.room, 'view/' + net.clientId)) {
          emit('view', message);
          return;
        }
        if (topicName === topic(net.room, 'reject/' + net.clientId)) {
          report(message.reason === 'full' ? 'room-full' : 'room-in-progress');
          emit('rejected', message);
        }
      });
      return net;
    };

    net.sendIntent = function (action) {
      publish('intent', { t: 'intent', id: net.clientId, action: action, at: Date.now() });
    };

    /* ---------------------------------------------------------- renaming */

    /* Names are settled in the lobby. Once the cards are dealt the engine's
       players carry their own copy of the name, and the log behind them is
       already written in it, so a later change would rewrite history. */
    net.canRename = function () { return net.phase === 'lobby'; };

    /* Host side: the roster is ours, so change it and tell the room. Returns
       the name that was actually taken, or null if nothing changed. */
    function applyRename(clientId, wanted) {
      if (!net.canRename()) return null;
      var seat = seatOf(clientId);
      var name = cleanName(wanted);
      if (seat < 0 || !name || net.seats[seat].name === name) return null;
      var was = net.seats[seat].name;
      net.seats[seat].name = name;
      publishRoom();
      emit('renamed', { clientId: clientId, seat: seat, from: was, to: name });
      return name;
    }
    net.applyRename = applyRename;

    /* What either side calls when the player asks to be called something else.
       A guest has to ask the host, which is also what makes the change stick
       across a reconnect: the host's roster is the one that is republished. */
    net.rename = function (wanted) {
      var name = cleanName(wanted);
      if (!name || !net.canRename()) return null;
      wantedName = name;
      if (net.role === 'host') return applyRename(net.clientId, name);
      publish('rename', { t: 'rename', id: net.clientId, name: name });
      return name;
    };
    net.wantedName = function () { return wantedName; };

    /* -------------------------------------------------------------- chat */

    /* Every line, ours included, arrives back through the broker: the table
       sees one order of messages, and a line that shows up is a line that was
       actually delivered rather than one we only hoped to send. */
    function receiveChat(message) {
      if (!message || message.t !== 'chat') return;
      var text = cleanChat(message.text);
      if (!text) return;
      var seat = seatOf(message.id);
      var line = {
        id: String(message.id || '').slice(0, 64),
        seat: seat,
        name: cleanName(message.name) || (seat >= 0 ? net.seats[seat].name : '?'),
        text: text,
        mine: message.id === net.clientId,
        at: Date.now()
      };
      remember(line);
      emit('chat', line);
    }

    /* The one way into the chat log, so its cap holds for everything that gets
       written there — said out loud or merely noted. */
    function remember(line) {
      net.chat.push(line);
      if (net.chat.length > CHAT_HISTORY) net.chat.splice(0, net.chat.length - CHAT_HISTORY);
    }

    /* Something that happened rather than something that was said. Worked out
       locally from the roster every client already has, so it is never sent and
       never forgeable. */
    net.note = function (text) {
      var body = cleanChat(text);
      if (!body) return null;
      var line = { system: true, text: body, at: Date.now() };
      remember(line);
      emit('chat', line);
      return line;
    };

    /* Returns the text that went out, or null when there was nothing to say,
       the room is not there, or the player is leaning on the send key. */
    net.sendChat = function (text) {
      var body = cleanChat(text);
      if (!body || !client || !net.room) return null;
      var now = Date.now();
      if (now - lastChatAt < 350) return null;
      lastChatAt = now;
      publish('chat', {
        t: 'chat', id: net.clientId, name: myName(), text: body, at: now
      });
      return body;
    };

    function myName() {
      var seat = seatOf(net.clientId);
      return seat >= 0 ? net.seats[seat].name : (wantedName || 'Player');
    }

    /* --------------------------------------------------------------- leaving */

    net.leave = function () {
      wantsLeave = true;
      clearTimeout(connectTimer);
      clearTimeout(roomTimer);
      net.joined = false;
      if (!client) return;
      if (net.role === 'host') {
        net.phase = 'closed';
        publishRoom({ closed: true });
        /* Do not leave the room's state sitting on a public broker. */
        clearRetained('room');
        net.seats.forEach(function (seat) { clearRetained('view/' + seat.id); });
      } else {
        publish('bye/' + net.clientId, { t: 'bye', id: net.clientId });
      }
      client.end();
      client = null;
      net.connected = false;
      net.role = null;
      net.room = null;
      state = null;
      net.chat = [];
      emit('status', status());
    };

    function parse(payload) {
      if (!payload) return null;
      try { return JSON.parse(payload); } catch (err) { return null; }
    }

    return net;
  }

  global.SplendorNet = {
    create: create,
    BROKERS: BROKERS,
    MAX_SEATS: MAX_SEATS,
    roomCode: roomCode,
    normaliseCode: normaliseCode,
    isValidCode: isValidCode,
    topic: topic,
    viewFor: viewFor,
    cleanName: cleanName,
    cleanChat: cleanChat,
    MAX_NAME: MAX_NAME,
    MAX_CHAT: MAX_CHAT,
    CHAT_HISTORY: CHAT_HISTORY
  };
})(typeof window !== 'undefined' ? window : globalThis);
