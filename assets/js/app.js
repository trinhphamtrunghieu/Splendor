/* Splendor — application controller: menus, turn loop, persistence.
 * Offline games run in the browser; online games are refereed by the Vercel
 * server (`/api/room`). */
(function (global) {
  'use strict';

  var D = global.SplendorData;
  var E = global.SplendorEngine;
  var AI = global.SplendorAI;
  var UI = global.SplendorUI;
  var Tutorial = global.SplendorTutorial;
  var Net = global.SplendorNet;
  var I18n = global.SplendorI18n;
  var t = I18n.t;

  var SAVE_KEY = 'splendor.save.v1';
  var SETTINGS_KEY = 'splendor.settings.v1';
  var CLIENT_KEY = 'splendor.client.v1';
  var ONLINE_KEY = 'splendor.online.v1';
  var SPEEDS = { fast: 320, normal: 780, slow: 1500 };

  var App = {
    state: null,
    mode: 'single',
    picked: [],
    discardSel: {},
    curtainAck: null,
    aiTimer: null,
    countdownTimer: null,
    lastTimeoutCheckAt: 0,
    net: null,                // the authoritative server room, when playing online
    role: null,               // 'host' | 'guest' (dynamically updated on host failover)
    seat: -1,                 // my seat in an online game
    pending: false,           // an intent is in flight to the server
    unread: 0,                // chat heard while the player was not looking
    roster: null,             // last seen seats, to report a name that changed
    roomPhase: null,          // last seen room phase, to notice the deal
    settings: {
      lang: 'vi',
      speed: 'normal',
      privacy: true,
      count: { single: 2, multi: 2 },
      difficulty: 'normal',
      tutorialDone: false,
      onlineName: '',
      turnTimer: 2,
      names: { single: [], multi: [] }
    }
  };

  /* ---------------------------------------------------------- storage */

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }
  function load(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
  }

  function saveGame() {
    if (!App.state) return;
    if (App.mode === 'tutorial') return;
    if (App.mode === 'online') {
      /* The server holds the authoritative game state; each tab only needs the
         room code to rejoin its seat after a reload. */
      if (App.state.phase === 'gameover') { session(ONLINE_KEY, null); return; }
      if (App.net && App.net.room) {
        session(ONLINE_KEY, { room: App.net.room });
      }
      return;
    }
    if (App.state.phase === 'gameover') { drop(SAVE_KEY); return; }
    store(SAVE_KEY, { mode: App.mode, state: App.state });
  }

  function session(key, value) {
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem(key));
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch (err) { /* private mode */ }
    return null;
  }

  function clientId() {
    var id = session(CLIENT_KEY);
    if (!id) { id = 'p-' + Math.random().toString(36).slice(2, 10); session(CLIENT_KEY, id); }
    return id;
  }

  function saveSettings() { store(SETTINGS_KEY, App.settings); }

  /* ---------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function showScreen(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (screen) {
      screen.classList.toggle('is-active', screen.id === id);
    });
  }

  function humanCount(state) {
    return state.players.filter(function (p) { return p.type === 'human'; }).length;
  }

  function profileFor(player) {
    return AI.PROFILES[player.difficulty] || AI.PROFILES.normal;
  }

  function applyI18n() {
    document.documentElement.lang = I18n.getLang();
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (btn) {
      btn.classList.toggle('is-on', btn.dataset.lang === I18n.getLang());
    });
  }

  /* ------------------------------------------------------------- menu */

  function buildSeg(container, values, current, labeller, onPick) {
    container.innerHTML = values.map(function (value) {
      return '<button type="button" class="seg-btn' + (value === current ? ' is-on' : '') +
        '" data-value="' + value + '">' + labeller(value) + '</button>';
    }).join('');
    container.onclick = function (event) {
      var btn = event.target.closest('.seg-btn');
      if (!btn) return;
      onPick(btn.dataset.value);
    };
  }

  function defaultName(mode, index) {
    if (mode === 'single') return index === 0 ? t('menu.you') : t('menu.bot', { n: index });
    return t('menu.player', { n: index + 1 });
  }

  function renderNames() {
    var count = App.settings.count[App.mode];
    var saved = App.settings.names[App.mode] || [];
    var rows = [];
    for (var i = 0; i < count; i++) {
      var isBot = App.mode === 'single' && i > 0;
      var value = saved[i] || defaultName(App.mode, i);
      rows.push('<label class="name-row">' +
        '<span class="name-tag">' + (isBot ? t('game.ai') : (App.mode === 'single' ? t('menu.you') : '#' + (i + 1))) + '</span>' +
        '<input type="text" maxlength="14" data-seat="' + i + '" value="' + UI.escapeHtml(value) + '">' +
        '</label>');
    }
    $('names').innerHTML = rows.join('');
    $('names').oninput = function (event) {
      var input = event.target.closest('input[data-seat]');
      if (!input) return;
      App.settings.names[App.mode][+input.dataset.seat] = input.value;
      saveSettings();
    };
  }

  function copyText(text, message) {
    var done = function () { UI.toast(message, 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  }

  function roomLink(code) {
    return location.origin + location.pathname + '?room=' + encodeURIComponent(code);
  }

  function roomFromUrl() {
    var match = /[?&]room=([^&#]+)/.exec(location.search) || /#room=([^&]+)/.exec(location.hash);
    if (!match) return null;
    var code = Net.normaliseCode(decodeURIComponent(match[1]));
    return Net.isValidCode(code) ? code : null;
  }

  function syncOnlineTimerUI(mins) {
    var timerInput = $('online-timer');
    if (timerInput && document.activeElement !== timerInput) {
      timerInput.value = String(mins);
    }
    var presets = $('online-timer-presets');
    if (presets) {
      Array.prototype.forEach.call(presets.querySelectorAll('.seg-btn'), function (btn) {
        btn.classList.toggle('is-on', +btn.dataset.mins === +mins);
      });
    }
  }

  function readOnlineTimerMinutes() {
    var timerInput = $('online-timer');
    if (!timerInput) return Net.cleanTurnTimer(App.settings.turnTimer, 2);
    var raw = String(timerInput.value || '').trim();
    if (!/^\d+$/.test(raw)) return null;
    var n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 60) return null;
    return n;
  }

  function renderOnlineSetup() {
    $('online-setup').hidden = false;
    $('setup').hidden = true;
    $('online-name').value = (App.settings.onlineName || '').trim() || t('menu.you');
    var mins = Net.cleanTurnTimer(App.settings.turnTimer, 2);
    App.settings.turnTimer = mins;
    if ($('online-timer')) $('online-timer').value = String(mins);
    syncOnlineTimerUI(mins);
    Array.prototype.forEach.call(document.querySelectorAll('.mode-card'), function (card) {
      card.classList.toggle('is-on', card.dataset.mode === 'online');
    });
  }

  function renderSetup() {
    var setup = $('setup');
    setup.hidden = false;
    $('setup-title').textContent = t(App.mode === 'single' ? 'menu.single' : 'menu.multi');

    buildSeg($('count-seg'), [2, 3, 4], App.settings.count[App.mode], function (n) { return n; }, function (value) {
      App.settings.count[App.mode] = +value;
      saveSettings();
      renderSetup();
    });

    $('difficulty-field').hidden = App.mode !== 'single';
    buildSeg($('difficulty-seg'), ['easy', 'normal', 'hard'], App.settings.difficulty,
      function (key) { return t('menu.difficulty.' + key); },
      function (value) { App.settings.difficulty = value; saveSettings(); renderSetup(); });

    buildSeg($('speed-seg'), ['fast', 'normal', 'slow'], App.settings.speed,
      function (key) { return t('menu.speed.' + key); },
      function (value) { App.settings.speed = value; saveSettings(); renderSetup(); });

    $('privacy-row').hidden = App.mode !== 'multi';
    $('privacy-toggle').checked = App.settings.privacy;
    renderNames();

    Array.prototype.forEach.call(document.querySelectorAll('.mode-card'), function (card) {
      card.classList.toggle('is-on', card.dataset.mode === App.mode);
    });
  }

  function showMenu() {
    clearTimeout(App.aiTimer);
    stopTurnCountdown();
    Tutorial.stop();
    document.body.classList.remove('is-curtained');
    showScreen('screen-menu');
    if (App.mode === 'online') { App.mode = 'single'; }
    var saved = load(SAVE_KEY);
    $('resume-btn').hidden = !(saved && saved.state && saved.state.phase !== 'gameover');

    var onlineSession = session(ONLINE_KEY);
    $('resume-online-btn').hidden = !(onlineSession && onlineSession.room);

    var suggest = !App.settings.tutorialDone;
    $('tutorial-btn').classList.toggle('is-suggested', suggest);
    $('learn-hint').hidden = !suggest;

    applyI18n();
    renderSetup();
  }

  /* ------------------------------------------------------- game start */

  function startGame() {
    var count = App.settings.count[App.mode];
    var names = App.settings.names[App.mode] || [];
    var players = [];
    for (var i = 0; i < count; i++) {
      var isBot = App.mode === 'single' && i > 0;
      players.push({
        name: (names[i] || '').trim() || defaultName(App.mode, i),
        type: isBot ? 'ai' : 'human',
        difficulty: isBot ? App.settings.difficulty : null
      });
    }
    App.state = E.createGame({ players: players });
    App.picked = [];
    App.discardSel = {};
    App.curtainAck = null;
    enterGame();
  }

  function startTutorial() {
    clearTimeout(App.aiTimer);
    App.mode = 'tutorial';
    App.state = Tutorial.buildState((App.settings.names.single || [])[0]);
    App.picked = [];
    App.discardSel = {};
    App.curtainAck = null;
    enterGame();
    Tutorial.start({
      state: function () { return App.state; },
      onTutorialEnd: function (mode) {
        App.settings.tutorialDone = true;
        saveSettings();
        App.state = null;
        if (mode === 'single' || mode === 'multi') App.mode = mode;
        showMenu();
        if (mode === 'single' || mode === 'multi') {
          $('setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  }

  function enterGame() {
    showScreen('screen-game');
    UI.closeModal();
    applyI18n();
    step();
  }

  /* ------------------------------------------------------------- online */

  function onlineName() {
    return (App.settings.onlineName || '').trim() || t('menu.you');
  }

  function chatOpen() {
    return $('screen-lobby').classList.contains('is-active') ||
      !!document.getElementById('chat-log-modal');
  }

  function systemNote(text) {
    if (App.net) App.net.note(text);
  }

  function rosterSnapshot(seats) {
    return (seats || []).map(function (seat) { return seat.id + '\u0000' + seat.name; });
  }

  function announceRosterChange(seats) {
    var before = App.roster || [];
    var after = rosterSnapshot(seats);
    if (before.length) {
      var wasById = {};
      before.forEach(function (entry) {
        var parts = entry.split('\u0000');
        wasById[parts[0]] = parts[1];
      });
      (seats || []).forEach(function (seat) {
        var was = wasById[seat.id];
        if (was === undefined) {
          if (seat.type === 'human' && seat.id !== App.net.clientId) {
            systemNote(t('chat.joined', { p: seat.name }));
          }
        } else if (was !== seat.name) {
          systemNote(t('chat.renamed', { a: was, b: seat.name }));
        }
      });
    }
    App.roster = after;
  }

  function renderChat() {
    var net = App.net;
    var log = net ? net.chat : [];
    if ($('screen-lobby').classList.contains('is-active')) {
      UI.renderChatList($('lobby-chat-log'), log);
      var canTalk = !!net && net.status().connected;
      var form = $('lobby-chat-form');
      if (form.dataset.enabled !== String(canTalk)) {
        form.innerHTML = UI.chatForm(Net.MAX_CHAT, canTalk);
        form.dataset.enabled = String(canTalk);
      }
    }
    UI.renderChatList(document.getElementById('chat-log-modal'), log);
    if (chatOpen()) App.unread = 0;
    renderChatBadge();
  }

  function renderChatBadge() {
    var button = $('chat-btn');
    if (!button) return;
    var on = App.mode === 'online' && !!App.net;
    button.hidden = !on;
    var badge = $('chat-badge');
    if (!badge) return;
    badge.hidden = !on || App.unread < 1;
    badge.textContent = App.unread > 9 ? '9+' : String(App.unread);
  }

  function sendChat(input) {
    var net = App.net;
    if (!net || !input) return;
    var text = input.value;
    if (!Net.cleanChat(text)) { input.value = ''; return; }
    if (!net.status().connected) { UI.toast(t('chat.offline'), 'error'); return; }
    if (net.sendChat(text) === null) { UI.toast(t('chat.tooFast')); return; }
    input.value = '';
  }

  function askRename() {
    var net = App.net;
    if (!net) return;
    if (!net.canRename()) { UI.toast(t('net.renameLocked'), 'error'); return; }
    var seat = net.mySeat();
    UI.renameModal(seat >= 0 ? net.seats[seat].name : onlineName(), Net.MAX_NAME);
  }

  function commitRename() {
    var net = App.net;
    var input = document.getElementById('rename-input');
    if (!net || !input) return;
    var wanted = Net.cleanName(input.value);
    if (!wanted) { UI.toast(t('net.renameEmpty'), 'error'); return; }
    if (!net.canRename()) { UI.toast(t('net.renameLocked'), 'error'); return; }
    if (!net.status().connected) {
      UI.toast(t('net.renameOffline'), 'error');
      return;
    }
    var seat = net.mySeat();
    if (seat >= 0 && net.seats[seat].name === wanted) {
      UI.closeModal();
      UI.toast(t('net.renameSame'));
      return;
    }
    net.rename(wanted);
    App.settings.onlineName = wanted;
    saveSettings();
    var nameField = $('online-name');
    if (nameField) nameField.value = wanted;
    UI.closeModal();
    UI.toast(t('net.renameDone', { p: wanted }), 'good');
  }

  function attachNet(net) {
    App.net = net;
    App.role = net.role;

    net.on('status', function () {
      App.role = net.role;
      renderLobby();
      renderNetChip();
      renderChatBadge();
      if (App.state && $('screen-game').classList.contains('is-active')) render();
    });

    net.on('chat', function (line) {
      if (!line.system && !line.mine && !chatOpen()) App.unread++;
      renderChat();
    });

    net.on('room', function (room) {
      if (room.closed) {
        leaveOnline(t('net.hostClosed'));
        return;
      }
      App.role = net.role;
      App.seat = net.mySeat();
      announceRosterChange(room.seats);
      if (App.roomPhase === 'lobby' && room.phase === 'playing') systemNote(t('chat.started'));
      App.roomPhase = room.phase;
      renderLobby();
      renderNetChip();
      if (room.phase === 'lobby' && App.state) {
        App.state = null;
        showLobby();
      } else if (App.state && $('screen-game').classList.contains('is-active')) {
        render();
      }
    });

    net.on('hostChanged', function (info) {
      App.role = net.role;
      if (info && info.name) {
        systemNote(t('chat.hostChanged', { p: info.name }));
      }
      if (info && info.to === net.clientId) {
        UI.toast(t('net.youAreHost'), 'good');
      }
      renderLobby();
      if (App.state && $('screen-game').classList.contains('is-active')) render();
    });

    net.on('turnTimeout', function (info) {
      if (info && info.name) {
        UI.toast(t('log.timeout', { p: info.name }), 'error');
        systemNote(t('chat.timeout', { p: info.name }));
      }
    });

    net.on('view', function (message) {
      if (!message || !message.state) return;
      var wasOver = App.state && App.state.phase === 'gameover';
      var prevTurnKey = App.state ? (App.state.turnCount + ':' + App.state.current) : null;
      var nextTurnKey = message.state.turnCount + ':' + message.state.current;
      var turnChanged = prevTurnKey !== null && prevTurnKey !== nextTurnKey;
      App.seat = message.seat;
      App.state = message.state;
      App.pending = false;
      if (turnChanged) {
        App.picked = [];
        App.discardSel = {};
      }
      saveGame();
      if (!$('screen-game').classList.contains('is-active')) {
        showScreen('screen-game');
        UI.closeModal();
        applyI18n();
      } else if ((wasOver && App.state.phase !== 'gameover') || (turnChanged && App.state.phase !== 'gameover' && !chatOpen())) {
        UI.closeModal();
      }
      syncOnlineBoard();
    });

    net.on('actionError', function (info) {
      App.pending = false;
      if (info && info.error) {
        UI.toast(t(info.error, info.params), 'error');
      }
      if (App.state) render();
    });

    net.on('seated', function (info) {
      if (info && info.rejoined && info.clientId !== net.clientId) {
        var seat = net.seats[info.seat];
        if (seat) {
          UI.toast(t('net.playerRejoined', { p: seat.name }), 'good');
          systemNote(t('chat.rejoined', { p: seat.name }));
        }
      }
      renderLobby();
    });

    net.on('left', function (info) {
      var seat = App.net && App.net.seats[info.seat];
      var name = (seat && seat.name) || info.name;
      if (name) {
        UI.toast(t('net.playerLeft', { p: name }));
        systemNote(t('chat.left', { p: name }));
      }
      renderLobby();
      if (App.state && $('screen-game').classList.contains('is-active')) render();
    });

    net.on('rejected', function (message) {
      leaveOnline(t(message.reason === 'full' ? 'net.roomFull' : 'net.roomInProgress'));
    });
  }

  /* Renders the authoritative state received from `/api/room` and opens any
     modal prompt (discard / noble / gameover) required for the local seat. */
  function syncOnlineBoard() {
    var state = App.state;
    if (!state) return;
    render();
    if (state.phase === 'gameover') {
      document.body.classList.remove('is-curtained');
      UI.gameOverModal(state, { online: true, isHost: App.net && App.net.isHost() });
      return;
    }
    if (!UI.isModalOpen()) {
      if (state.phase === 'noble' && canAct()) UI.nobleModal(state);
      else if (state.phase === 'discard' && canAct()) {
        App.discardSel = {};
        UI.discardModal(state, App.discardSel);
      }
    }
  }

  function hostRoom(resumeCode) {
    var mins = Net.cleanTurnTimer(App.settings.turnTimer, 2);
    if (!resumeCode) {
      var parsed = readOnlineTimerMinutes();
      if (parsed === null) {
        UI.toast(t('net.badTimer'), 'error');
        if ($('online-timer')) $('online-timer').focus();
        return;
      }
      mins = parsed;
      App.settings.turnTimer = mins;
      saveSettings();
    }

    var net = Net.create({ clientId: clientId() });
    attachNet(net);
    App.mode = 'online';
    App.role = 'host';
    App.picked = [];
    App.pending = false;
    App.state = null;
    App.seat = 0;

    net.host({
      room: resumeCode || null,
      name: onlineName(),
      turnTimer: mins
    });
    session(ONLINE_KEY, { room: net.room });
    showLobby();
  }

  function joinRoom(code) {
    var net = Net.create({ clientId: clientId() });
    attachNet(net);
    App.mode = 'online';
    App.role = 'guest';
    App.state = null;
    App.picked = [];
    App.pending = false;
    net.join({ room: code, name: onlineName() });
    session(ONLINE_KEY, { room: Net.normaliseCode(code) });
    showLobby();
  }

  function startOnlineGame() {
    var net = App.net;
    if (!net || !net.isHost()) return;
    if (net.seats.length < 2) { UI.toast(t('net.needTwo'), 'error'); return; }
    App.picked = [];
    net.startGame();
  }

  function leaveOnline(message) {
    stopTurnCountdown();
    if (App.net) App.net.leave();
    App.net = null;
    App.roster = null;
    App.roomPhase = null;
    App.unread = 0;
    App.role = null;
    App.seat = -1;
    App.state = null;
    App.pending = false;
    session(ONLINE_KEY, null);
    if (message) UI.toast(message, 'error');
    showMenu();
  }

  function showLobby() {
    clearTimeout(App.aiTimer);
    stopTurnCountdown();
    Tutorial.stop();
    showScreen('screen-lobby');
    applyI18n();
    renderLobby();
  }

  function lobbyStatus(st) {
    if (st.error === 'room-full') return { text: t('net.roomFull'), cls: 'is-error' };
    if (st.error === 'room-in-progress') return { text: t('net.roomInProgress'), cls: 'is-error' };
    if (st.error === 'server-unreachable' || st.error === 'broker-unreachable') {
      return { text: t('net.err.serverUnreachable'), cls: 'is-error' };
    }
    if (st.error === 'room-not-found') {
      return { text: t('net.err.roomNotFound', { code: st.room }), cls: 'is-error' };
    }
    if (!st.connected) {
      var retry = /^reconnect-(\d+)$/.exec(st.notice || '');
      if (retry) return { text: t('net.reconnecting', { n: retry[1] }), cls: '' };
      return { text: t('net.connecting'), cls: '' };
    }
    if (!st.joined) {
      return { text: t('net.searchingRoom', { code: st.room }), cls: '' };
    }
    var isHost = st.hostId === st.clientId;
    return { text: t(isHost ? 'net.hostWaiting' : 'net.guestWaiting'), cls: 'is-ok' };
  }

  function renderLobby() {
    if (!$('screen-lobby').classList.contains('is-active')) return;
    var net = App.net;
    if (!net) return;
    var st = net.status();
    var isHost = net.isHost();

    $('room-code-value').textContent = st.room || '—';
    var share = $('room-share');
    if (st.room && location.protocol !== 'file:') {
      share.hidden = false;
      $('room-link').textContent = roomLink(st.room);
    } else {
      share.hidden = true;
    }
    var line = lobbyStatus(st);
    $('lobby-status').textContent = line.text;
    $('lobby-status').className = 'lobby-status' + (line.cls ? ' ' + line.cls : '');
    var timerBadge = $('lobby-timer-badge');
    if (timerBadge) {
      timerBadge.textContent = '⏱ ' + t('net.lobbyTimer', { n: st.turnTimer || App.settings.turnTimer || 2 });
    }

    var seats = st.seats.length ? st.seats : [];
    $('seat-list').innerHTML = seats.map(function (seat, index) {
      var tags = [];
      if (seat.id === st.clientId) tags.push(t('game.you'));
      if (seat.id === st.hostId) tags.push(t('net.host'));
      if (seat.type === 'ai') tags.push(t('game.ai'));
      return '<div class="seat' + (seat.online ? '' : ' is-off') + '">' +
        '<span class="player-dot" style="background:' + UI.PLAYER_COLORS[index % 4] + '"></span>' +
        '<span class="seat-name">' + UI.escapeHtml(seat.name) + '</span>' +
        (tags.length ? '<span class="player-tag">' + tags.join(' · ') + '</span>' : '') +
        '<span class="seat-state">' + (seat.online ? '●' : '○') + '</span>' +
        (seat.id === st.clientId && net.canRename()
          ? '<button type="button" class="btn btn-sm seat-rename" data-lobby="rename">' +
            t('net.rename') + '</button>'
          : '') +
        (isHost && seat.id !== st.clientId
          ? '<button type="button" class="seat-kick" data-kick="' + seat.id + '" aria-label="remove">×</button>'
          : '') +
        '</div>';
    }).join('') || '<p class="empty-note">—</p>';

    var actions = [];
    if (isHost) {
      if (seats.length < Net.MAX_SEATS) {
        actions.push('<button type="button" class="btn" data-lobby="bot">' + t('net.addBot') + '</button>');
      }
      actions.push('<button type="button" class="btn btn-primary" data-lobby="start"' +
        (seats.length >= 2 && st.connected ? '' : ' disabled') + '>' + t('net.start') + '</button>');
    }
    var humanSeats = seats.filter(function (s) { return s.type === 'human'; });
    actions.push('<button type="button" class="btn btn-danger" data-lobby="leave">' +
      t(isHost && humanSeats.length <= 1 ? 'net.closeRoom' : 'net.leaveRoom') + '</button>');
    $('lobby-actions').innerHTML = actions.join('');
    renderChat();
  }

  function netWarning() {
    if (App.mode !== 'online' || !App.net) return null;
    var st = App.net.status();
    if (!st.connected) {
      var retry = /^reconnect-(\d+)$/.exec(st.notice || '');
      return retry ? t('net.reconnecting', { n: retry[1] }) : t('net.connecting');
    }
    return null;
  }

  function renderNetChip() {
    var chip = $('net-chip');
    if (!chip) return;
    if (App.mode !== 'online' || !App.net) { chip.hidden = true; return; }
    var st = App.net.status();
    chip.hidden = false;
    var healthy = st.connected;
    chip.className = 'net-chip ' + (healthy ? 'is-on' : 'is-off');
    chip.textContent = !st.connected ? t('net.offline') : st.room;
  }

  /* ---------------------------------------------------------- drawing */

  function viewerSeat() {
    if (App.mode === 'online' && App.seat >= 0) return App.seat;
    return App.state ? App.state.current : 0;
  }

  function isCurrentSeatOffline() {
    if (App.mode !== 'online' || !App.net || !App.state) return false;
    var seatInfo = App.net.seats[App.state.current];
    return !!(seatInfo && !seatInfo.online && !seatInfo.botTakeover && seatInfo.type === 'human');
  }

  function remainingTurnMs(state) {
    if (!state || state.phase === 'gameover' || !state.turnLimitMs) return null;
    var deadline = state.clientDeadline != null ? state.clientDeadline : state.turnDeadline;
    if (!deadline) return null;
    return Math.max(0, deadline - Date.now());
  }

  function turnTimerInfo(state) {
    var ms = remainingTurnMs(state);
    if (ms === null) return null;
    var cls = ms <= 10000 ? 'is-critical' : (ms <= 30000 ? 'is-low' : '');
    return {
      ms: ms,
      text: UI.formatTimer(ms),
      cls: cls
    };
  }

  function stopTurnCountdown() {
    if (App.countdownTimer) {
      clearInterval(App.countdownTimer);
      App.countdownTimer = null;
    }
  }

  function updateTurnTimerDOM() {
    var state = App.state;
    var topTimer = $('turn-timer');
    var info = turnTimerInfo(state);
    if (!info) {
      if (topTimer) topTimer.hidden = true;
      stopTurnCountdown();
      return;
    }
    if (topTimer) {
      topTimer.hidden = false;
      topTimer.textContent = '⏱ ' + info.text;
      topTimer.className = 'turn-timer' + (info.cls ? ' ' + info.cls : '');
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-turn-timer]'), function (el) {
      el.textContent = '⏱ ' + info.text;
      var base = el.classList.contains('player-timer') ? 'player-timer' : 'turn-line-timer';
      el.className = base + (info.cls ? ' ' + info.cls : '');
    });

    if (info.ms <= 0 && state && state.phase !== 'gameover') {
      var now = Date.now();
      if (App.mode === 'online' && App.net) {
        if (now - (App.lastTimeoutCheckAt || 0) > 1100) {
          App.lastTimeoutCheckAt = now;
          App.net.checkTimeout();
        }
      } else if (state.turnLimitMs > 0) {
        var timedOutName = E.currentPlayer(state).name;
        if (E.timeoutTurn(state).ok) {
          App.picked = [];
          App.discardSel = {};
          UI.closeModal();
          UI.toast(t('log.timeout', { p: timedOutName }), 'error');
          step();
        }
      }
    }
  }

  function ensureTurnCountdown() {
    var state = App.state;
    if (!state || state.phase === 'gameover' || !state.turnLimitMs) {
      stopTurnCountdown();
      var topTimer = $('turn-timer');
      if (topTimer) topTimer.hidden = true;
      return;
    }
    updateTurnTimerDOM();
    if (!App.countdownTimer) {
      App.countdownTimer = setInterval(updateTurnTimerDOM, 250);
    }
  }

  function render() {
    var state = App.state;
    if (!state) return;
    var player = E.currentPlayer(state);
    var isHumanTurn = player.type === 'human' && state.phase !== 'gameover' && canAct();
    var turnOffline = isCurrentSeatOffline();
    var canBotTakeover = turnOffline && App.net && App.net.isHost() && state.phase !== 'gameover';
    var timerInfo = turnTimerInfo(state);

    $('round-chip').textContent = t('game.round', { n: state.round });
    var dot = '<span class="dot" style="background:' + UI.PLAYER_COLORS[state.current % 4] + '"></span>';
    $('turn-name').innerHTML = dot + UI.escapeHtml(
      state.phase === 'gameover' ? t('modal.over.title')
        : player.type === 'ai' ? t('game.thinking', { p: player.name })
        : humanCount(state) > 1 ? t('game.turnOf', { p: player.name })
        : t('game.yourTurn'));
    $('final-chip').hidden = !state.finalRound || state.phase === 'gameover';

    var viewer = viewerSeat();
    var myTurn = canAct() && state.phase !== 'gameover';
    UI.renderNobles($('nobles'), state, viewer);
    UI.renderTiers($('tiers'), state, null, viewer);
    UI.renderBank($('bank'), state, App.picked, myTurn);
    UI.renderTurnLine($('turn-line'), state, {
      canAct: myTurn,
      viewer: viewer,
      namedTurn: App.mode === 'multi' && humanCount(state) > 1,
      warning: netWarning(),
      blocked: netBlocked(),
      turnOffline: turnOffline,
      timerText: timerInfo ? timerInfo.text : null,
      timerClass: timerInfo ? timerInfo.cls : ''
    });
    UI.renderPlayers($('players'), state, {
      revealIndex: App.mode === 'online' ? viewer : (isHumanTurn ? state.current : -1),
      youIndex: App.mode === 'single' ? 0 : (App.mode === 'online' ? viewer : -1),
      seats: App.mode === 'online' && App.net ? App.net.seats : null,
      hostId: App.mode === 'online' && App.net ? App.net.hostId : null,
      timerText: timerInfo ? timerInfo.text : null,
      timerClass: timerInfo ? timerInfo.cls : ''
    });
    UI.renderTray($('tray'), state, App.picked, isHumanTurn, viewer, {
      canBotTakeover: canBotTakeover
    });
    $('take-hint').textContent = t('action.takeHint');
    renderChatBadge();
    ensureTurnCountdown();

    if (Tutorial.isActive()) Tutorial.refresh();
  }

  /* ------------------------------------------------------- turn cycle */

  function step() {
    var state = App.state;
    if (!state) return;
    if (App.mode === 'online') {
      syncOnlineBoard();
      return;
    }
    saveGame();
    render();

    if (state.phase === 'gameover') {
      document.body.classList.remove('is-curtained');
      UI.gameOverModal(state);
      return;
    }

    var player = E.currentPlayer(state);

    if (state.phase === 'noble') {
      if (player.type === 'ai') {
        E.chooseNoble(state, AI.chooseNoble(state));
        step();
      } else if (canAct()) {
        UI.nobleModal(state);
      }
      return;
    }

    if (state.phase === 'discard') {
      if (player.type === 'ai') {
        AI.discard(state, profileFor(player));
        step();
      } else if (canAct()) {
        App.discardSel = {};
        UI.discardModal(state, App.discardSel);
      }
      return;
    }

    if (player.type === 'ai') {
      document.body.classList.remove('is-curtained');
      clearTimeout(App.aiTimer);
      App.aiTimer = setTimeout(aiMove, SPEEDS[App.settings.speed] || SPEEDS.normal);
      return;
    }

    if (Tutorial.isActive()) return;

    if (needsCurtain()) {
      document.body.classList.add('is-curtained');
      UI.curtainModal(player.name);
      return;
    }
    document.body.classList.remove('is-curtained');
  }

  function needsCurtain() {
    var state = App.state;
    if (!App.settings.privacy || humanCount(state) < 2) return false;
    return App.curtainAck !== turnKey();
  }

  function turnKey() {
    return App.state.turnCount + ':' + App.state.current;
  }

  function aiMove() {
    var state = App.state;
    if (!state || state.phase !== 'play') return;
    var player = E.currentPlayer(state);
    if (player.type !== 'ai') return;

    var before = state.log.length;
    var action = AI.chooseAction(state, profileFor(player));
    var result = action ? E.applyAction(state, action) : { ok: false };

    if (!result.ok) {
      var fallback = E.legalActions(state)[0];
      if (fallback) E.applyAction(state, fallback);
    }
    state.log.slice(before).forEach(function (entry) { UI.toast(I18n.logText(entry)); });
    App.picked = [];
    step();
  }

  /* Can the person at this screen act right now? */
  function canAct() {
    var state = App.state;
    if (!state || state.phase === 'gameover') return false;
    if (App.mode === 'online') {
      if (App.seat < 0 || state.current !== App.seat || App.pending) return false;
      return !netBlocked();
    }
    return E.currentPlayer(state).type === 'human';
  }

  /* True when this player's moves cannot reach the server referee. */
  function netBlocked() {
    if (App.mode !== 'online' || !App.net) return false;
    var st = App.net.status();
    return !st.connected || st.hostGone;
  }

  /* Every move the local player makes goes through here: applied directly when
     offline, sent to the Vercel server referee when online. */
  function perform(action) {
    var state = App.state;
    if (!state) return;
    if (!canAct()) { UI.toast(t('net.notYourTurn'), 'error'); return; }

    if (App.mode === 'online') {
      App.pending = true;
      App.net.sendIntent(action);
      App.picked = [];
      UI.closeModal();
      render();
      return;
    }
    afterHumanAction(E.applyAction(state, action));
  }

  function afterHumanAction(result) {
    if (!result.ok) { UI.toast(t(result.error || 'err.generic', result.params), 'error'); return; }
    App.picked = [];
    UI.closeModal();
    step();
  }

  /* ------------------------------------------------ token selection UX */

  function toggleToken(color) {
    var state = App.state;
    if (state.phase !== 'play' || E.currentPlayer(state).type !== 'human') return;
    if (!canAct()) {
      UI.toast(t('net.notYourTurn'), 'error');
      return;
    }
    var picked = App.picked;
    var mine = picked.filter(function (c) { return c === color; }).length;
    var allSame = picked.length > 1 && picked.every(function (c) { return c === picked[0]; });

    if (mine === 0) {
      if (picked.length >= 3 || allSame) { UI.toast(t(picked.length >= 3 ? 'err.maxThree' : 'err.mixInvalid')); return; }
      if (state.tokens[color] <= 0) return;
      picked.push(color);
    } else if (mine === 1) {
      if (picked.length === 1 && state.tokens[color] >= 4) picked.push(color);
      else picked.splice(picked.indexOf(color), 1);
    } else {
      App.picked = [];
    }
    render();
  }

  /* ---------------------------------------------------- event wiring */

  function wireMenu() {
    Array.prototype.forEach.call(document.querySelectorAll('.mode-card'), function (card) {
      card.addEventListener('click', function () {
        App.mode = card.dataset.mode;
        if (App.mode === 'online') {
          renderOnlineSetup();
          $('online-setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
        $('online-setup').hidden = true;
        renderSetup();
        $('setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (btn) {
      btn.addEventListener('click', function () {
        I18n.setLang(btn.dataset.lang);
        App.settings.lang = btn.dataset.lang;
        saveSettings();
        applyI18n();
        renderSetup();
      });
    });

    $('setup').addEventListener('submit', function (event) {
      event.preventDefault();
      var saved = load(SAVE_KEY);
      if (saved && saved.state && saved.state.phase !== 'gameover') {
        UI.confirmModal('modal.confirmNew.title', 'modal.confirmNew.body', 'freshGame');
      } else {
        startGame();
      }
    });

    $('setup-back').addEventListener('click', function () { $('setup').hidden = true; });

    $('privacy-toggle').addEventListener('change', function () {
      App.settings.privacy = $('privacy-toggle').checked;
      saveSettings();
    });

    $('resume-online-btn').addEventListener('click', function () {
      var saved = session(ONLINE_KEY);
      if (!saved || !saved.room) { showMenu(); return; }
      joinRoom(saved.room);
    });

    $('resume-btn').addEventListener('click', function () {
      var saved = load(SAVE_KEY);
      if (!saved || !saved.state) { showMenu(); return; }
      App.state = saved.state;
      App.mode = saved.mode || 'single';
      App.picked = [];
      App.curtainAck = null;
      enterGame();
    });

    $('rules-btn').addEventListener('click', function () { UI.rulesModal(); });

    /* ---- online setup ---- */
    $('online-name').addEventListener('input', function () {
      App.settings.onlineName = $('online-name').value;
      saveSettings();
    });
    if ($('online-timer')) {
      $('online-timer').addEventListener('input', function () {
        var parsed = readOnlineTimerMinutes();
        if (parsed !== null) {
          App.settings.turnTimer = parsed;
          saveSettings();
          syncOnlineTimerUI(parsed);
        } else {
          syncOnlineTimerUI(-1);
        }
      });
      $('online-timer').addEventListener('blur', function () {
        var parsed = readOnlineTimerMinutes();
        if (parsed === null) {
          var fallback = Net.cleanTurnTimer(App.settings.turnTimer, 2);
          $('online-timer').value = String(fallback);
          syncOnlineTimerUI(fallback);
        }
      });
    }
    if ($('online-timer-presets')) {
      $('online-timer-presets').addEventListener('click', function (event) {
        var btn = event.target.closest('.seg-btn');
        if (!btn) return;
        var mins = Net.cleanTurnTimer(btn.dataset.mins, 2);
        App.settings.turnTimer = mins;
        saveSettings();
        if ($('online-timer')) $('online-timer').value = String(mins);
        syncOnlineTimerUI(mins);
      });
    }
    $('join-code').addEventListener('input', function () {
      $('join-code').value = Net.normaliseCode($('join-code').value);
    });
    $('host-btn').addEventListener('click', function () { hostRoom(null); });
    $('join-btn').addEventListener('click', function () {
      var code = Net.normaliseCode($('join-code').value);
      if (!Net.isValidCode(code)) { UI.toast(t('net.badCode'), 'error'); return; }
      joinRoom(code);
    });
    $('online-back').addEventListener('click', function () { $('online-setup').hidden = true; });

    function submitOnline(event) {
      if (event) event.preventDefault();
      var raw = $('join-code').value.trim();
      if (!raw) { $('join-code').focus(); return; }
      var code = Net.normaliseCode(raw);
      if (!Net.isValidCode(code)) { UI.toast(t('net.badCode'), 'error'); return; }
      joinRoom(code);
    }

    $('online-setup').addEventListener('submit', submitOnline);
    $('online-setup').addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      if (!event.target.closest('input')) return;
      submitOnline(event);
    });

    $('screen-lobby').addEventListener('click', function (event) {
      var kick = event.target.closest('[data-kick]');
      if (kick) { App.net.removeSeat(kick.dataset.kick); renderLobby(); return; }
      if (event.target.closest('#copy-code')) {
        copyText(App.net.room, t('net.copied', { code: App.net.room }));
        return;
      }
      if (event.target.closest('#copy-link')) {
        copyText(roomLink(App.net.room), t('net.copiedLink'));
        return;
      }
      var action = event.target.closest('[data-lobby]');
      if (!action || action.disabled) return;
      if (action.dataset.lobby === 'rename') {
        askRename();
      } else if (action.dataset.lobby === 'bot') {
        App.net.addBot(t('menu.bot', { n: App.net.seats.length }), App.settings.difficulty);
        renderLobby();
      } else if (action.dataset.lobby === 'start') {
        startOnlineGame();
      } else if (action.dataset.lobby === 'leave') {
        leaveOnline(null);
      }
    });

    $('screen-lobby').addEventListener('submit', function (event) {
      var form = event.target.closest('[data-chat-form]');
      if (!form) return;
      event.preventDefault();
      sendChat(form.querySelector('[data-chat-input]'));
    });

    $('tutorial-btn').addEventListener('click', function () { startTutorial(); });
  }

  function wireGame() {
    $('screen-game').addEventListener('click', function (event) {
      var state = App.state;
      if (!state) return;

      if (UI.isModalOpen()) return;
      if (event.target.closest('#menu-btn')) { UI.menuModal(state); return; }
      if (event.target.closest('#nobles-btn')) { UI.noblesModal(state, viewerSeat()); return; }
      if (event.target.closest('#chat-btn')) { openChat(); return; }
      if (event.target.closest('#log-btn')) { UI.logModal(state); return; }

      var sheet = event.target.closest('[data-sheet]');
      if (sheet) { openSheet(sheet.dataset.sheet); return; }

      if (event.target.closest('#bot-takeover-btn')) {
        if (App.mode === 'online' && App.net && App.net.isHost()) {
          var targetPlayer = state.players[state.current];
          App.net.botTakeover(state.current);
          if (targetPlayer) {
            UI.toast(t('net.botTookOver', { p: targetPlayer.name }));
            systemNote(t('chat.botTakeover', { p: targetPlayer.name }));
          }
        }
        return;
      }

      var token = event.target.closest('[data-token]');
      if (token) { toggleToken(token.dataset.token); return; }

      if (event.target.closest('#clear-btn')) { App.picked = []; render(); return; }
      if (event.target.closest('#take-btn')) {
        perform({ type: 'take', colors: App.picked.slice() });
        return;
      }
      if (event.target.closest('#pass-btn')) { perform({ type: 'pass' }); return; }

      var human = E.currentPlayer(state).type === 'human' && state.phase === 'play' && canAct();
      if (!human) return;

      var card = event.target.closest('[data-card]');
      if (card) {
        var found = E.findBoardCard(state, card.dataset.card);
        var mine = state.players[viewerSeat()];
        var target = found ? found.card : mine.reserved.filter(function (c) {
          return c.id === card.dataset.card;
        })[0];
        if (target) UI.cardDetail(state, target, found ? 'board' : 'reserve');
        return;
      }

      var deck = event.target.closest('[data-deck]');
      if (deck) { UI.deckDetail(state, +deck.dataset.deck); return; }
    });

    $('screen-game').addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (UI.isModalOpen() || !App.state) return;
      var sheet = event.target.closest('[data-sheet]');
      if (!sheet) return;
      event.preventDefault();
      openSheet(sheet.dataset.sheet);
    });
  }

  function openSheet(name) {
    if (name === 'nobles') UI.noblesModal(App.state, viewerSeat());
    else UI.playersModal(App.state, viewerSeat(), {
      seats: App.mode === 'online' && App.net ? App.net.seats : null,
      hostId: App.mode === 'online' && App.net ? App.net.hostId : null
    });
  }

  function openChat() {
    var net = App.net;
    if (!net) return;
    UI.chatModal(net.chat, Net.MAX_CHAT, net.status().connected);
    App.unread = 0;
    renderChatBadge();
  }

  function wireModal() {
    var root = $('modal-root');

    function dismiss() {
      UI.closeModal();
      if (App.state) step();
    }

    root.addEventListener('click', function (event) {
      var state = App.state;

      if (event.target === root && root.dataset.dismissable !== 'no') { dismiss(); return; }
      if (event.target.closest('[data-close]')) { dismiss(); return; }

      var noble = event.target.closest('[data-noble]');
      if (noble) { UI.closeModal(); perform({ type: 'noble', nobleId: noble.dataset.noble }); return; }

      var discardToken = event.target.closest('[data-discard]');
      if (discardToken) {
        var color = discardToken.dataset.discard;
        var player = E.currentPlayer(state);
        var need = E.countTokens(player.tokens) - D.MAX_TOKENS;
        var chosen = E.countTokens(App.discardSel);
        if ((App.discardSel[color] || 0) < player.tokens[color] && chosen < need) {
          App.discardSel[color] = (App.discardSel[color] || 0) + 1;
        } else if (App.discardSel[color]) {
          App.discardSel[color]--;
          if (!App.discardSel[color]) delete App.discardSel[color];
        }
        UI.discardModal(state, App.discardSel);
        return;
      }

      var button = event.target.closest('[data-do]');
      if (!button || button.disabled) return;

      switch (button.dataset.do) {
        case 'buy':
          perform({ type: 'buy', cardId: button.dataset.card });
          break;
        case 'reserve':
          perform({ type: 'reserve', cardId: button.dataset.card });
          break;
        case 'reserveDeck':
          perform({ type: 'reserveDeck', tier: +button.dataset.tier });
          break;
        case 'discardReset':
          App.discardSel = {};
          UI.discardModal(state, App.discardSel);
          break;
        case 'discardConfirm':
          var pile = App.discardSel;
          App.discardSel = {};
          perform({ type: 'discard', pile: pile });
          break;
        case 'curtainReady':
          App.curtainAck = turnKey();
          document.body.classList.remove('is-curtained');
          UI.closeModal();
          step();
          break;
        case 'renameSave':
          break;
        case 'rules':
          UI.rulesModal();
          break;
        case 'tutorial':
          UI.closeModal();
          startTutorial();
          break;
        case 'lang':
          I18n.setLang(I18n.getLang() === 'vi' ? 'en' : 'vi');
          App.settings.lang = I18n.getLang();
          saveSettings();
          applyI18n();
          UI.closeModal();
          render();
          break;
        case 'quit':
          clearTimeout(App.aiTimer);
          UI.closeModal();
          if (App.net) { leaveOnline(null); break; }
          showMenu();
          break;
        case 'rematch':
          UI.closeModal();
          if (App.mode === 'online' && App.net) {
            if (App.net.isHost()) App.net.rematch();
            break;
          }
          startGame();
          break;
        case 'freshGame':
          UI.closeModal();
          drop(SAVE_KEY);
          startGame();
          break;
        case 'toMenu':
          UI.closeModal();
          if (App.net) { leaveOnline(null); break; }
          App.state = null;
          drop(SAVE_KEY);
          showMenu();
          break;
      }
    });

    root.addEventListener('submit', function (event) {
      var form = event.target.closest('form');
      if (!form) return;
      event.preventDefault();
      if (form.id === 'rename-form') { commitRename(); return; }
      if (form.dataset.chatForm) sendChat(form.querySelector('[data-chat-input]'));
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && UI.isModalOpen() && root.dataset.dismissable !== 'no') dismiss();
    });
  }

  /* ------------------------------------------------------------- boot */

  function init() {
    global.SplendorArt.inject();
    var saved = load(SETTINGS_KEY);
    if (saved) {
      Object.keys(App.settings).forEach(function (key) {
        if (saved[key] !== undefined) App.settings[key] = saved[key];
      });
    }
    if (!App.settings.names) App.settings.names = { single: [], multi: [] };
    if (!App.settings.names.single) App.settings.names.single = [];
    if (!App.settings.names.multi) App.settings.names.multi = [];
    if (!App.settings.count || typeof App.settings.count !== 'object') App.settings.count = { single: 2, multi: 2 };
    I18n.setLang(App.settings.lang || 'vi');

    var nameField = $('online-name');
    if (nameField) nameField.maxLength = Net.MAX_NAME;

    wireMenu();
    wireGame();
    wireModal();
    showMenu();

    /* Notify the server immediately when a tab is closed or reloaded so other
       players don't have to wait for the heartbeat timeout to see the drop. */
    global.addEventListener('pagehide', function () {
      if (App.mode === 'online' && App.net) {
        App.net.disconnect();
      }
    });

    var invited = roomFromUrl();
    if (invited) {
      var named = !!(App.settings.onlineName || '').trim();
      App.mode = 'online';
      renderOnlineSetup();
      $('join-code').value = invited;
      if (named) {
        joinRoom(invited);
      } else {
        $('online-setup').scrollIntoView({ block: 'nearest' });
        $('online-name').focus();
        UI.toast(t('net.invited', { code: invited }));
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.SplendorApp = App;
})(typeof window !== 'undefined' ? window : globalThis);
