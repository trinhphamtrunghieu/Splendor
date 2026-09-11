/* Splendor — application controller: menus, turn loop, persistence.
 * Everything runs in the browser; there is no server of any kind. */
(function (global) {
  'use strict';

  var D = global.SplendorData;
  var E = global.SplendorEngine;
  var AI = global.SplendorAI;
  var UI = global.SplendorUI;
  var I18n = global.SplendorI18n;
  var t = I18n.t;

  var SAVE_KEY = 'splendor.save.v1';
  var SETTINGS_KEY = 'splendor.settings.v1';
  var SPEEDS = { fast: 320, normal: 780, slow: 1500 };

  var App = {
    state: null,
    mode: 'single',
    picked: [],
    discardSel: {},
    curtainAck: null,
    aiTimer: null,
    settings: {
      lang: 'vi',
      speed: 'normal',
      privacy: true,
      count: { single: 2, multi: 2 },
      difficulty: 'normal',
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
    if (App.state.phase === 'gameover') { drop(SAVE_KEY); return; }
    store(SAVE_KEY, { mode: App.mode, state: App.state });
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
    document.body.classList.remove('is-curtained');
    $('screen-game').classList.remove('is-active');
    $('screen-menu').classList.add('is-active');
    var saved = load(SAVE_KEY);
    $('resume-btn').hidden = !(saved && saved.state && saved.state.phase !== 'gameover');
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

  function enterGame() {
    $('screen-menu').classList.remove('is-active');
    $('screen-game').classList.add('is-active');
    UI.closeModal();
    applyI18n();
    step();
  }

  /* ---------------------------------------------------------- drawing */

  function render() {
    var state = App.state;
    if (!state) return;
    var player = E.currentPlayer(state);
    var isHumanTurn = player.type === 'human' && state.phase !== 'gameover';

    $('round-chip').textContent = t('game.round', { n: state.round });
    var dot = '<span class="dot" style="background:' + UI.PLAYER_COLORS[state.current % 4] + '"></span>';
    $('turn-name').innerHTML = dot + UI.escapeHtml(
      state.phase === 'gameover' ? t('modal.over.title')
        : player.type === 'ai' ? t('game.thinking', { p: player.name })
        : humanCount(state) > 1 ? t('game.turnOf', { p: player.name })
        : t('game.yourTurn'));
    $('final-chip').hidden = !state.finalRound || state.phase === 'gameover';

    UI.renderNobles($('nobles'), state);
    UI.renderTiers($('tiers'), state, null);
    UI.renderBank($('bank'), state, App.picked);
    UI.renderPlayers($('players'), state, {
      revealIndex: isHumanTurn ? state.current : -1,
      youIndex: App.mode === 'single' ? 0 : -1
    });
    UI.renderTray($('tray'), state, App.picked, isHumanTurn);
    $('take-hint').textContent = t('action.takeHint');
  }

  /* ------------------------------------------------------- turn cycle */

  function step() {
    var state = App.state;
    if (!state) return;
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
      } else {
        UI.nobleModal(state);
      }
      return;
    }

    if (state.phase === 'discard') {
      if (player.type === 'ai') {
        AI.discard(state, profileFor(player));
        step();
      } else {
        App.discardSel = {};
        UI.discardModal(state, App.discardSel);
      }
      return;
    }

    // Normal play.
    if (player.type === 'ai') {
      document.body.classList.remove('is-curtained');
      clearTimeout(App.aiTimer);
      App.aiTimer = setTimeout(aiMove, SPEEDS[App.settings.speed] || SPEEDS.normal);
      return;
    }

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
      // Should not happen, but never leave the game wedged on a bot's turn.
      var fallback = E.legalActions(state)[0];
      if (fallback) E.applyAction(state, fallback);
    }
    state.log.slice(before).forEach(function (entry) { UI.toast(I18n.logText(entry)); });
    App.picked = [];
    step();
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
        afterHumanAction(E.takeTokens(state, App.picked.slice()));
        return;
      }
      if (event.target.closest('#pass-btn')) { afterHumanAction(E.passTurn(state)); return; }

      var human = E.currentPlayer(state).type === 'human' && state.phase === 'play';
      if (!human) return;

      var card = event.target.closest('[data-card]');
      if (card) {
        var found = E.findBoardCard(state, card.dataset.card);
        var target = found ? found.card : E.currentPlayer(state).reserved.filter(function (c) {
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
      if (noble) { UI.closeModal(); afterHumanAction(E.chooseNoble(state, noble.dataset.noble)); return; }

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
          afterHumanAction(E.buyCard(state, button.dataset.card));
          break;
        case 'reserve':
          afterHumanAction(E.reserveCard(state, button.dataset.card));
          break;
        case 'reserveDeck':
          afterHumanAction(E.reserveFromDeck(state, +button.dataset.tier));
          break;
        case 'discardReset':
          App.discardSel = {};
          UI.discardModal(state, App.discardSel);
          break;
        case 'discardConfirm':
          var result = E.discardTokens(state, App.discardSel);
          if (!result.ok) { UI.toast(t(result.error, result.params), 'error'); return; }
          App.discardSel = {};
          UI.closeModal();
          step();
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
