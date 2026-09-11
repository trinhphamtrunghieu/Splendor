/* Splendor — application controller: menus, turn loop, persistence.
 * Everything runs in the browser; there is no server of any kind. */
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
    net: null,                // the MQTT room, when playing online
    role: null,               // 'host' | 'guest'
    seat: -1,                 // my seat in an online game
    pending: false,           // an intent is in flight to the host
    settings: {
      lang: 'vi',
      speed: 'normal',
      privacy: true,
      count: { single: 2, multi: 2 },
      difficulty: 'normal',
      tutorialDone: false,
      broker: Net.BROKERS[0].url,
      onlineName: '',
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
    if (App.mode === 'tutorial') return;      // keep the player's real save intact
    if (App.mode === 'online') {
      // Only the host holds the real game; guests can always be re-sent theirs.
      if (App.role !== 'host') return;
      if (App.state.phase === 'gameover') { drop(ONLINE_KEY); return; }
      store(ONLINE_KEY, {
        role: 'host', room: App.net && App.net.room, brokerUrl: App.settings.broker,
        seats: App.net ? App.net.seats : [], state: App.state
      });
      return;
    }
    if (App.state.phase === 'gameover') { drop(SAVE_KEY); return; }
    store(SAVE_KEY, { mode: App.mode, state: App.state });
  }

  function clientId() {
    var id = load(CLIENT_KEY);
    if (!id) { id = 'p-' + Math.random().toString(36).slice(2, 10); store(CLIENT_KEY, id); }
    return id;
  }

  function saveSettings() { store(SETTINGS_KEY, App.settings); }

  /* ---------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

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

  function copyRoomCode() {
    var code = App.net && App.net.room;
    if (!code) return;
    var done = function () { UI.toast(t('net.copied', { code: code }), 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, done);
    } else {
      done();
    }
  }

  function renderOnlineSetup() {
    $('online-setup').hidden = false;
    $('setup').hidden = true;
    $('online-name').value = App.settings.onlineName || '';
    $('broker-url').value = App.settings.broker || Net.BROKERS[0].url;
    buildSeg($('broker-seg'), Net.BROKERS.map(function (b) { return b.id; }), brokerId(),
      function (id) {
        var found = Net.BROKERS.filter(function (b) { return b.id === id; })[0];
        return found ? found.label : id;
      },
      function (id) {
        var found = Net.BROKERS.filter(function (b) { return b.id === id; })[0];
        if (found) { App.settings.broker = found.url; saveSettings(); renderOnlineSetup(); }
      });
    Array.prototype.forEach.call(document.querySelectorAll('.mode-card'), function (card) {
      card.classList.toggle('is-on', card.dataset.mode === 'online');
    });
  }

  function brokerId() {
    var url = App.settings.broker;
    var found = Net.BROKERS.filter(function (b) { return b.url === url; })[0];
    return found ? found.id : null;
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
    Tutorial.stop();
    document.body.classList.remove('is-curtained');
    $('screen-game').classList.remove('is-active');
    $('screen-lobby').classList.remove('is-active');
    $('screen-menu').classList.add('is-active');
    if (App.mode === 'online') { App.mode = 'single'; }
    var saved = load(SAVE_KEY);
    $('resume-btn').hidden = !(saved && saved.state && saved.state.phase !== 'gameover');

    // First visit: point newcomers at the walkthrough rather than the board.
    var hosted = load(ONLINE_KEY);
    $('resume-online-btn').hidden = !(hosted && hosted.room &&
      (hosted.role === 'guest' || hosted.state));

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
    $('screen-menu').classList.remove('is-active');
    $('screen-game').classList.add('is-active');
    UI.closeModal();
    applyI18n();
    step();
  }

  /* ------------------------------------------------------------- online */

  function onlineName() {
    return (App.settings.onlineName || '').trim() || t('menu.you');
  }

  function attachNet(net) {
    App.net = net;
    App.role = net.role;

    net.on('status', function () { renderLobby(); renderNetChip(); });

    net.on('room', function (room) {
      if (room.closed && App.role === 'guest') {
        leaveOnline(t('net.hostClosed'));
        return;
      }
      App.seat = net.mySeat();
      renderLobby();
      renderNetChip();
      // A guest with no game yet sits in the lobby until the host starts.
      if (App.role === 'guest' && room.phase === 'lobby' && App.state) {
        App.state = null;
        showLobby();
      }
    });

    net.on('view', function (message) {
      if (App.role !== 'guest' || !message.state) return;
      App.seat = message.seat;
      App.state = message.state;
      App.pending = false;
      if ($('screen-game').classList.contains('is-active') === false) enterGame();
      syncGuest();
    });

    net.on('intent', function (message) {
      if (App.role !== 'host' || !App.state) return;
      var seat = net.seatOf(message.id);
      if (seat < 0 || seat !== App.state.current) return;      // not their turn
      var result = E.applyAction(App.state, message.action);
      if (!result.ok) { net.broadcast(App.state); return; }    // refused: re-sync them
      App.picked = [];
      step();
    });

    net.on('seated', function () { renderLobby(); });
    net.on('left', function (info) {
      var seat = App.net.seats[info.seat];
      if (seat) UI.toast(t('net.playerLeft', { p: seat.name }));
      renderLobby();
    });
    net.on('rejected', function (message) {
      leaveOnline(t(message.reason === 'full' ? 'net.roomFull' : 'net.roomInProgress'));
    });
  }

  /* A guest never runs the engine; it renders what the host sent and opens
     whichever prompt the state says is ours to answer. */
  function syncGuest() {
    var state = App.state;
    if (!state) return;
    render();
    if (state.phase === 'gameover') { UI.gameOverModal(state); return; }
    if (!UI.isModalOpen()) {
      if (state.phase === 'noble' && canAct()) UI.nobleModal(state);
      else if (state.phase === 'discard' && canAct()) {
        App.discardSel = {};
        UI.discardModal(state, App.discardSel);
      }
    }
  }

  function hostRoom(resume) {
    var net = Net.create({ clientId: clientId() });
    attachNet(net);
    App.mode = 'online';
    App.role = 'host';
    App.picked = [];
    App.pending = false;

    net.host({
      room: resume && resume.room,
      name: onlineName(),
      brokerUrl: App.settings.broker
    });
    if (resume && resume.seats && resume.seats.length) net.seats = resume.seats.slice();
    if (resume && resume.state) {
      App.state = resume.state;
      net.setState(App.state);
      App.seat = net.mySeat();
      enterGame();
      step();
      return;
    }
    App.state = null;
    App.seat = 0;
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
    net.join({ room: code, name: onlineName(), brokerUrl: App.settings.broker });
    store(ONLINE_KEY, { role: 'guest', room: Net.normaliseCode(code), brokerUrl: App.settings.broker });
    showLobby();
  }

  function startOnlineGame() {
    var net = App.net;
    if (!net || App.role !== 'host') return;
    if (net.seats.length < 2) { UI.toast(t('net.needTwo'), 'error'); return; }
    App.state = E.createGame({
      players: net.seats.map(function (seat) {
        return { name: seat.name, type: seat.type, difficulty: seat.difficulty };
      })
    });
    net.setState(App.state);
    App.seat = net.mySeat();
    App.picked = [];
    enterGame();
    step();
  }

  function leaveOnline(message) {
    if (App.net) App.net.leave();
    App.net = null;
    App.role = null;
    App.seat = -1;
    App.state = null;
    App.pending = false;
    drop(ONLINE_KEY);
    if (message) UI.toast(message, 'error');
    showMenu();
  }

  function showLobby() {
    clearTimeout(App.aiTimer);
    Tutorial.stop();
    $('screen-menu').classList.remove('is-active');
    $('screen-game').classList.remove('is-active');
    $('screen-lobby').classList.add('is-active');
    applyI18n();
    renderLobby();
  }

  function renderLobby() {
    if (!$('screen-lobby').classList.contains('is-active')) return;
    var net = App.net;
    if (!net) return;
    var st = net.status();

    $('room-code-value').textContent = st.room || '—';
    $('lobby-status').textContent = st.error
      ? t('net.error', { e: t('net.err.' + st.error) === 'net.err.' + st.error ? st.error : t('net.err.' + st.error) })
      : st.connected
        ? (App.role === 'host' ? t('net.hostWaiting') : t('net.guestWaiting'))
        : t('net.connecting');
    $('lobby-status').className = 'lobby-status' + (st.error ? ' is-error' : st.connected ? ' is-ok' : '');

    var seats = st.seats.length ? st.seats : [];
    $('seat-list').innerHTML = seats.map(function (seat, index) {
      var tags = [];
      if (seat.id === st.clientId) tags.push(t('game.you'));
      if (seat.id === net.hostId) tags.push(t('net.host'));
      if (seat.type === 'ai') tags.push(t('game.ai'));
      return '<div class="seat' + (seat.online ? '' : ' is-off') + '">' +
        '<span class="player-dot" style="background:' + UI.PLAYER_COLORS[index % 4] + '"></span>' +
        '<span class="seat-name">' + UI.escapeHtml(seat.name) + '</span>' +
        (tags.length ? '<span class="player-tag">' + tags.join(' · ') + '</span>' : '') +
        '<span class="seat-state">' + (seat.online ? '●' : '○') + '</span>' +
        (App.role === 'host' && seat.id !== st.clientId
          ? '<button type="button" class="seat-kick" data-kick="' + seat.id + '" aria-label="remove">×</button>'
          : '') +
        '</div>';
    }).join('') || '<p class="empty-note">—</p>';

    var actions = [];
    if (App.role === 'host') {
      if (seats.length < Net.MAX_SEATS) {
        actions.push('<button type="button" class="btn" data-lobby="bot">' + t('net.addBot') + '</button>');
      }
      actions.push('<button type="button" class="btn btn-primary" data-lobby="start"' +
        (seats.length >= 2 && st.connected ? '' : ' disabled') + '>' + t('net.start') + '</button>');
    }
    actions.push('<button type="button" class="btn btn-danger" data-lobby="leave">' +
      t(App.role === 'host' ? 'net.closeRoom' : 'net.leaveRoom') + '</button>');
    $('lobby-actions').innerHTML = actions.join('');
  }

  function renderNetChip() {
    var chip = $('net-chip');
    if (!chip) return;
    if (App.mode !== 'online' || !App.net) { chip.hidden = true; return; }
    var st = App.net.status();
    chip.hidden = false;
    chip.className = 'net-chip ' + (st.connected ? 'is-on' : 'is-off');
    chip.textContent = st.room + (st.connected ? '' : ' · ' + t('net.offline'));
  }

  /* ---------------------------------------------------------- drawing */

  /* Which seat the screen belongs to: mine when online, the player at the
     device otherwise. Drives affordability outlines and the tray. */
  function viewerSeat() {
    if (App.mode === 'online' && App.seat >= 0) return App.seat;
    return App.state ? App.state.current : 0;
  }

  function render() {
    var state = App.state;
    if (!state) return;
    var player = E.currentPlayer(state);
    var isHumanTurn = player.type === 'human' && state.phase !== 'gameover' && canAct();

    $('round-chip').textContent = t('game.round', { n: state.round });
    var dot = '<span class="dot" style="background:' + UI.PLAYER_COLORS[state.current % 4] + '"></span>';
    $('turn-name').innerHTML = dot + UI.escapeHtml(
      state.phase === 'gameover' ? t('modal.over.title')
        : player.type === 'ai' ? t('game.thinking', { p: player.name })
        : humanCount(state) > 1 ? t('game.turnOf', { p: player.name })
        : t('game.yourTurn'));
    $('final-chip').hidden = !state.finalRound || state.phase === 'gameover';

    var viewer = viewerSeat();
    UI.renderNobles($('nobles'), state, viewer);
    UI.renderTiers($('tiers'), state, null, viewer);
    UI.renderBank($('bank'), state, App.picked);
    UI.renderPlayers($('players'), state, {
      revealIndex: App.mode === 'online' ? viewer : (isHumanTurn ? state.current : -1),
      youIndex: App.mode === 'single' ? 0 : (App.mode === 'online' ? viewer : -1)
    });
    UI.renderTray($('tray'), state, App.picked, isHumanTurn, viewer);
    $('take-hint').textContent = t('action.takeHint');

    // Card nodes are replaced on every draw, so the coach marks have to be
    // re-anchored here rather than only when a turn ends.
    if (Tutorial.isActive()) Tutorial.refresh();
  }

  /* ------------------------------------------------------- turn cycle */

  function step() {
    var state = App.state;
    if (!state) return;
    if (App.mode === 'online' && App.role === 'host' && App.net) App.net.broadcast(state);
    saveGame();
    render();

    if (state.phase === 'gameover') {
      document.body.classList.remove('is-curtained');
      UI.gameOverModal(state);
      return;
    }


    var player = E.currentPlayer(state);

    if (state.phase === 'noble') {
      if (player.type === 'ai' && hostControls()) {
        E.chooseNoble(state, AI.chooseNoble(state));
        step();
      } else if (canAct()) {
        UI.nobleModal(state);
      }
      return;
    }

    if (state.phase === 'discard') {
      if (player.type === 'ai' && hostControls()) {
        AI.discard(state, profileFor(player));
        step();
      } else if (canAct()) {
        App.discardSel = {};
        UI.discardModal(state, App.discardSel);
      }
      return;
    }

    // Normal play.
    if (player.type === 'ai' && hostControls()) {
      document.body.classList.remove('is-curtained');
      clearTimeout(App.aiTimer);
      App.aiTimer = setTimeout(aiMove, SPEEDS[App.settings.speed] || SPEEDS.normal);
      return;
    }

    if (Tutorial.isActive()) return;          // solo board, no handover
    if (App.mode === 'online') { document.body.classList.remove('is-curtained'); return; }

    if (needsCurtain()) {
      document.body.classList.add('is-curtained');
      UI.curtainModal(player.name);
      return;
    }
    document.body.classList.remove('is-curtained');
  }

  /* Bots and turn resolution are the host's job; guests only render. */
  function hostControls() {
    return App.mode !== 'online' || App.role === 'host';
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
      // Should not happen, but never leave the game wedged on a bot's turn.
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
    if (!state) return false;
    if (App.mode !== 'online') return true;
    return App.seat >= 0 && state.current === App.seat && !App.pending;
  }

  /* Every move the local player makes goes through here: applied directly when
     offline or hosting, relayed to the host when a guest. */
  function perform(action) {
    var state = App.state;
    if (!state) return;
    if (!canAct()) { UI.toast(t('net.notYourTurn'), 'error'); return; }

    if (App.mode === 'online' && App.role === 'guest') {
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
    var picked = App.picked;
    var mine = picked.filter(function (c) { return c === color; }).length;
    var allSame = picked.length > 1 && picked.every(function (c) { return c === picked[0]; });

    if (mine === 0) {
      if (picked.length >= 3 || allSame) { UI.toast(t(picked.length >= 3 ? 'err.maxThree' : 'err.mixInvalid')); return; }
      if (state.tokens[color] <= 0) return;
      picked.push(color);
    } else if (mine === 1) {
      if (picked.length === 1 && state.tokens[color] >= 4) picked.push(color);   // second of a pair
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
      var saved = load(ONLINE_KEY);
      if (!saved || !saved.room) { showMenu(); return; }
      App.settings.broker = saved.brokerUrl || App.settings.broker;
      if (saved.role === 'host') hostRoom(saved);
      else joinRoom(saved.room);        // the retained view puts us straight back
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
    $('broker-url').addEventListener('change', function () {
      App.settings.broker = $('broker-url').value.trim();
      saveSettings();
      renderOnlineSetup();
    });
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

    $('screen-lobby').addEventListener('click', function (event) {
      var kick = event.target.closest('[data-kick]');
      if (kick) { App.net.removeSeat(kick.dataset.kick); renderLobby(); return; }
      if (event.target.closest('#copy-code')) { copyRoomCode(); return; }
      var action = event.target.closest('[data-lobby]');
      if (!action || action.disabled) return;
      if (action.dataset.lobby === 'bot') {
        App.net.addBot(t('menu.bot', { n: App.net.seats.length }), App.settings.difficulty);
        renderLobby();
      } else if (action.dataset.lobby === 'start') {
        startOnlineGame();
      } else if (action.dataset.lobby === 'leave') {
        leaveOnline(null);
      }
    });

    $('tutorial-btn').addEventListener('click', function () { startTutorial(); });
  }

  function wireGame() {
    $('screen-game').addEventListener('click', function (event) {
      var state = App.state;
      if (!state) return;

      // A modal owns the screen while it is open — the curtain and the
      // discard/noble prompts must not be replaceable from underneath.
      if (UI.isModalOpen()) return;
      if (event.target.closest('#menu-btn')) { UI.menuModal(state); return; }
      if (event.target.closest('#log-btn')) { UI.logModal(state); return; }

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
          startGame();
          break;
        case 'freshGame':
          UI.closeModal();
          drop(SAVE_KEY);
          startGame();
          break;
        case 'toMenu':
          UI.closeModal();
          App.state = null;
          drop(SAVE_KEY);
          showMenu();
          break;
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && UI.isModalOpen() && root.dataset.dismissable !== 'no') dismiss();
    });
  }

  /* ------------------------------------------------------------- boot */

  function init() {
    global.SplendorArt.inject();          // gem artwork must exist before any render
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

    wireMenu();
    wireGame();
    wireModal();
    showMenu();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.SplendorApp = App;
})(typeof window !== 'undefined' ? window : globalThis);
