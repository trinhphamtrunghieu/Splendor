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
 *   reject/<clientId>           host -> guest: why a join was refused
 *   bye/<clientId>              the broker's last will for a dropped player
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
      notice: null              // transient chatter, e.g. "reconnecting"
    };

    var client = null;
    var listeners = {};
    var state = null;           // host only: the authoritative game
    var wantsLeave = false;
    var connectTimer = null;    // the broker never answered
    var roomTimer = null;       // the broker answered but the room is not there

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
      net.seats = [{ id: net.clientId, name: config.name || 'Host', type: 'human', online: true }];

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
          if (message.name) net.seats[seat].name = message.name;
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
        net.seats.push({ id: message.id, name: message.name || 'Player', type: 'human', online: true });
        publishRoom();
        emit('seated', { clientId: message.id, seat: net.seats.length - 1, rejoined: false });
        return;
      }

      if (MQTT.matches(topic(net.room, 'intent'), topicName)) {
        emit('intent', message);
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
        publish('join', { t: 'join', id: net.clientId, name: config.name || 'Player' });
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
    viewFor: viewFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
