/* Splendor — a small MQTT 3.1.1 client over WebSocket.
 *
 * Online play needs a message bus, not a game server: GitHub Pages serves
 * static files, so the players talk to each other through a public MQTT broker.
 * Everything this game needs is QoS 0 publish/subscribe plus two broker
 * features that do a lot of work for us:
 *
 *   retained messages — a joining or reconnecting player is handed the current
 *                       room state by the broker, with nobody having to ask
 *   last will         — a player who drops off is announced by the broker
 *
 * mqtt.js would do this too, but its browser bundle is 369 KB, about twenty
 * times the size of the rest of the game. This is the subset we actually use,
 * in about two hundred lines, with no build step.
 *
 * Deliberately unsupported: QoS 1/2 (we re-sync from retained state instead of
 * chasing delivery guarantees), MQTT 5 properties, TLS options (the URL scheme
 * decides that). A page served over https must use a wss:// broker.
 */
(function (global) {
  'use strict';

  var CONNECT = 1, CONNACK = 2, PUBLISH = 3, PUBACK = 4, SUBSCRIBE = 8,
      SUBACK = 9, UNSUBSCRIBE = 10, PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;

  var CONNACK_ERRORS = {
    1: 'unacceptable protocol version',
    2: 'client id rejected',
    3: 'server unavailable',
    4: 'bad username or password',
    5: 'not authorised'
  };

  var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  function utf8(text) {
    return Array.prototype.slice.call(encoder.encode(String(text)));
  }

  function fromUtf8(bytes) {
    return decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  /* MQTT's "remaining length": 7 bits per byte, high bit means "more". */
  function encodeLength(value) {
    var out = [];
    do {
      var digit = value % 128;
      value = Math.floor(value / 128);
      if (value > 0) digit |= 0x80;
      out.push(digit);
    } while (value > 0 && out.length < 4);
    return out;
  }

  function decodeLength(bytes, offset) {
    var multiplier = 1;
    var value = 0;
    var index = offset;
    while (index < bytes.length) {
      var digit = bytes[index++];
      value += (digit & 0x7f) * multiplier;
      if ((digit & 0x80) === 0) return { value: value, length: index - offset };
      multiplier *= 128;
      if (multiplier > 128 * 128 * 128) return { error: 'malformed remaining length' };
    }
    return null;                       // not enough bytes yet
  }

  function encodeString(text) {
    var bytes = utf8(text);
    return [(bytes.length >> 8) & 0xff, bytes.length & 0xff].concat(bytes);
  }

  function packet(type, flags, body) {
    return Uint8Array.from([((type & 0x0f) << 4) | (flags & 0x0f)]
      .concat(encodeLength(body.length))
      .concat(body));
  }

  /* Does a subscription filter cover this topic? Supports + and #. */
  function matches(filter, topic) {
    var f = String(filter).split('/');
    var t = String(topic).split('/');
    for (var i = 0; i < f.length; i++) {
      if (f[i] === '#') return true;
      if (i >= t.length) return false;
      if (f[i] !== '+' && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }

  function randomId(prefix) {
    return (prefix || 'sp') + '-' + Math.random().toString(36).slice(2, 10);
  }

  function connect(url, options) {
    options = options || {};

    var client = {
      url: url,
      clientId: options.clientId || randomId('splendor'),
      connected: false,
      ended: false
    };

    var handlers = { connect: [], message: [], close: [], error: [], reconnect: [] };
    var socket = null;
    var buffer = new Uint8Array(0);
    var subscriptions = [];            // re-sent after a reconnect
    var packetId = 0;
    var keepalive = (options.keepalive || 45) * 1000;
    var pingTimer = null;
    var pongDeadline = null;
    var reconnectTimer = null;
    var attempt = 0;

    function emit(name, payload, extra) {
      handlers[name].forEach(function (fn) {
        try { fn(payload, extra); } catch (err) { /* a listener must not kill the socket */ }
      });
    }

    client.on = function (name, fn) {
      if (handlers[name]) handlers[name].push(fn);
      return client;
    };

    function send(bytes) {
      if (socket && socket.readyState === 1) socket.send(bytes);
    }

    function nextPacketId() {
      packetId = (packetId % 65535) + 1;
      return packetId;
    }

    function sendConnect() {
      var will = options.will;
      var flags = 0x02;                                     // clean session
      if (will) flags |= 0x04 | ((will.retain ? 1 : 0) << 5);
      if (options.username) flags |= 0x80;
      if (options.password) flags |= 0x40;

      var body = encodeString('MQTT')
        .concat([4, flags, (keepalive / 1000) >> 8, (keepalive / 1000) & 0xff])
        .concat(encodeString(client.clientId));
      if (will) {
        body = body.concat(encodeString(will.topic));
        var payload = utf8(will.payload == null ? '' : will.payload);
        body = body.concat([(payload.length >> 8) & 0xff, payload.length & 0xff]).concat(payload);
      }
      if (options.username) body = body.concat(encodeString(options.username));
      if (options.password) body = body.concat(encodeString(options.password));
      send(packet(CONNECT, 0, body));
    }

    client.subscribe = function (topic) {
      if (subscriptions.indexOf(topic) < 0) subscriptions.push(topic);
      if (!client.connected) return client;
      var id = nextPacketId();
      send(packet(SUBSCRIBE, 2, [(id >> 8) & 0xff, id & 0xff].concat(encodeString(topic)).concat([0])));
      return client;
    };

    client.unsubscribe = function (topic) {
      subscriptions = subscriptions.filter(function (t) { return t !== topic; });
      if (!client.connected) return client;
      var id = nextPacketId();
      send(packet(UNSUBSCRIBE, 2, [(id >> 8) & 0xff, id & 0xff].concat(encodeString(topic))));
      return client;
    };

    client.publish = function (topic, message, opts) {
      opts = opts || {};
      var flags = opts.retain ? 1 : 0;                      // QoS 0 only
      var body = encodeString(topic).concat(utf8(message == null ? '' : message));
      send(packet(PUBLISH, flags, body));
      return client;
    };

    client.end = function () {
      client.ended = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      if (socket && socket.readyState === 1) {
        send(packet(DISCONNECT, 0, []));
        try { socket.close(); } catch (err) { /* already gone */ }
      } else if (socket) {
        try { socket.close(); } catch (err) { /* already gone */ }
      }
      client.connected = false;
      return client;
    };

    /* ------------------------------------------------------ incoming data */

    function append(chunk) {
      var incoming = new Uint8Array(chunk);
      var merged = new Uint8Array(buffer.length + incoming.length);
      merged.set(buffer, 0);
      merged.set(incoming, buffer.length);
      buffer = merged;
    }

    /* A WebSocket frame can carry half a packet, or several at once. */
    function drain() {
      for (;;) {
        if (buffer.length < 2) return;
        var header = decodeLength(buffer, 1);
        if (!header) return;                                // length not complete
        if (header.error) { fail(header.error); return; }
        var start = 1 + header.length;
        var total = start + header.value;
        if (buffer.length < total) return;                  // body not complete
        handlePacket(buffer[0] >> 4, buffer[0] & 0x0f, buffer.subarray(start, total));
        buffer = buffer.subarray(total);
      }
    }

    function handlePacket(type, flags, body) {
      if (type === CONNACK) {
        var code = body.length > 1 ? body[1] : 0;
        if (code !== 0) { fail(CONNACK_ERRORS[code] || ('connection refused (' + code + ')')); return; }
        client.connected = true;
        attempt = 0;
        var resubscribe = subscriptions.slice();
        subscriptions = [];
        resubscribe.forEach(client.subscribe);
        startKeepalive();
        emit('connect');
        return;
      }
      if (type === PUBLISH) {
        var qos = (flags >> 1) & 0x03;
        var nameLength = (body[0] << 8) | body[1];
        var topic = fromUtf8(body.subarray(2, 2 + nameLength));
        var offset = 2 + nameLength;
        if (qos > 0) {
          var id = (body[offset] << 8) | body[offset + 1];
          offset += 2;
          if (qos === 1) send(packet(PUBACK, 0, [(id >> 8) & 0xff, id & 0xff]));
        }
        emit('message', topic, fromUtf8(body.subarray(offset)));
        return;
      }
      if (type === PINGRESP) { pongDeadline = null; return; }
      /* SUBACK / UNSUBACK / PUBACK need no action for QoS 0 traffic. */
    }

    function startKeepalive() {
      clearInterval(pingTimer);
      pingTimer = setInterval(function () {
        if (!client.connected) return;
        if (pongDeadline && Date.now() > pongDeadline) { fail('broker stopped responding'); return; }
        pongDeadline = Date.now() + keepalive;
        send(packet(PINGREQ, 0, []));
      }, keepalive);
    }

    function fail(reason) {
      emit('error', new Error(reason));
      if (socket) { try { socket.close(); } catch (err) { /* already gone */ } }
    }

    function scheduleReconnect() {
      if (client.ended || options.reconnect === false) return;
      attempt++;
      var delay = Math.min(500 * Math.pow(2, attempt - 1), 15000);
      emit('reconnect', { attempt: attempt, delay: delay });
      reconnectTimer = setTimeout(open, delay);
    }

    function open() {
      var WS = options.WebSocket || global.WebSocket;
      if (!WS) { emit('error', new Error('WebSocket is not available')); return; }
      buffer = new Uint8Array(0);
      try {
        socket = new WS(url, ['mqtt']);
      } catch (err) {
        emit('error', err);
        scheduleReconnect();
        return;
      }
      socket.binaryType = 'arraybuffer';
      socket.onopen = sendConnect;
      socket.onmessage = function (event) {
        if (typeof event.data === 'string') return;         // brokers must speak binary
        append(event.data);
        drain();
      };
      socket.onerror = function () { emit('error', new Error('websocket error')); };
      socket.onclose = function () {
        var wasConnected = client.connected;
        client.connected = false;
        clearInterval(pingTimer);
        pongDeadline = null;
        emit('close', { wasConnected: wasConnected });
        scheduleReconnect();
      };
    }

    open();
    return client;
  }

  global.MqttLite = {
    connect: connect,
    matches: matches,
    randomId: randomId,
    /* exported for the tests */
    _codec: { encodeLength: encodeLength, decodeLength: decodeLength, encodeString: encodeString, packet: packet, utf8: utf8, fromUtf8: fromUtf8 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
