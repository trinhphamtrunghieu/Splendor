/* Splendor — interactive walkthrough for first-time players.
 *
 * The tutorial plays a real game on a scripted, solo board: nothing is faked,
 * so every instruction is carried out with the same buttons and the same rules
 * engine as a normal game. Steps that teach an action wait until the player has
 * actually performed it; the rest advance on a button.
 *
 * Loading this file touches no DOM, so the plan below can be exercised in the
 * test suite — which is what keeps the instructions honest if the card data
 * ever changes.
 */
(function (global) {
  'use strict';

  var D = global.SplendorData;
  var E = global.SplendorEngine;
  var t = function (key, params) { return global.SplendorI18n.t(key, params); };

  /* The scripted board and the moves the player is walked through. Tests assert
     that each of these is legal in sequence, in this order. */
  var PLAN = {
    seed: 20260911,
    firstTake: ['green', 'red', 'white'],
    secondTake: ['green', 'green'],
    buyCardId: 't1p4-black',        // costs 2 emerald + 1 ruby
    reserveCardId: 't3p3-blue'      // costs 3 sapphire + 7 onyx, worth 5 points
  };

  /* Put a specific card on a specific board slot, trading places with whatever
     was there so the deck keeps exactly the cards it should. */
  function placeCard(state, tier, slot, cardId) {
    var board = state.board[tier];
    var deck = state.decks[tier];

    for (var i = 0; i < board.length; i++) {
      if (board[i] && board[i].id === cardId) {
        var swap = board[slot];
        board[slot] = board[i];
        board[i] = swap;
        return true;
      }
    }
    for (var j = 0; j < deck.length; j++) {
      if (deck[j].id === cardId) {
        var card = deck[j];
        deck[j] = board[slot];      // trade places: board slot goes into the deck
        board[slot] = card;
        return true;
      }
    }
    return false;
  }

  function buildState(playerName) {
    var state = E.createGame({
      players: [{ name: playerName || t('tut.player'), type: 'human' }],
      seed: PLAN.seed
    });
    placeCard(state, 1, 0, PLAN.buyCardId);
    placeCard(state, 3, 0, PLAN.reserveCardId);
    state.isTutorial = true;
    return state;
  }

  function gemList(colors) {
    return colors.map(function (color) { return t('gem.' + color); }).join(', ');
  }

  /* ------------------------------------------------------------ the script */

  var STEPS = [
    { key: 'welcome' },
    { key: 'board', target: '#tiers' },
    {
      key: 'take3',
      target: '#bank',
      params: function () { return { gems: gemList(PLAN.firstTake) }; },
      check: function (state) { return state.turnCount >= 1; }
    },
    {
      key: 'take2',
      target: '#bank',
      params: function () { return { gem: t('gem.' + PLAN.secondTake[0]) }; },
      check: function (state) { return state.turnCount >= 2; }
    },
    {
      key: 'buy',
      target: function () { return '[data-card="' + PLAN.buyCardId + '"]'; },
      check: function (state) { return state.players[0].cards.length >= 1; }
    },
    { key: 'discount', target: '#tray .tray-group' },
    {
      key: 'reserve',
      target: function () { return '[data-card="' + PLAN.reserveCardId + '"]'; },
      check: function (state) { return state.players[0].reserved.length >= 1; }
    },
    { key: 'gold', target: '#bank .token--gold' },
    { key: 'nobles', target: '#nobles' },
    { key: 'limit', target: '#tray .tray-group:nth-child(2)' },
    { key: 'goal', target: '#players' },
    { key: 'done', final: true }
  ];

  /* ------------------------------------------------------------- runtime */

  var host = null;          // the app, injected on start()
  var active = false;
  var index = 0;
  var frame = null;
  var drawing = false;
  var scrolledFor = -1;

  function root() {
    return document.getElementById('coach-root');
  }

  function start(app) {
    host = app;
    active = true;
    index = 0;
    scrolledFor = -1;
    bind();
    render();
  }

  function stop() {
    active = false;
    index = 0;
    var node = root();
    if (node) node.hidden = true;
    document.body.classList.remove('is-coaching');
  }

  function isActive() { return active; }

  function currentStep() { return STEPS[index]; }

  function go(delta) {
    scrolledFor = -1;
    var next = index + delta;
    if (next < 0) next = 0;
    if (next >= STEPS.length) { finish(); return; }
    index = next;
    render();
  }

  function finish(mode) {
    stop();
    if (host && host.onTutorialEnd) host.onTutorialEnd(mode);
  }

  /* Called by the app after every re-render, and by our own listeners. */
  function refresh() {
    if (!active || drawing) return;
    var step = currentStep();
    if (step && step.check && host && step.check(host.state())) {
      index++;
      scrolledFor = -1;
      if (index >= STEPS.length) { finish(); return; }
    }
    render();
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      if (active) render();
    });
  }

  function bind() {
    if (bind.done) return;
    bind.done = true;
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    var table = document.getElementById('table');
    if (table) table.addEventListener('scroll', schedule, { passive: true });
    global.SplendorUI.onModalChange(schedule);   // stand aside for dialogs

    root().addEventListener('click', function (event) {
      var button = event.target.closest('[data-coach]');
      if (!button) return;
      var action = button.dataset.coach;
      if (action === 'next') go(1);
      else if (action === 'back') go(-1);
      else if (action === 'skip') finish();
      else if (action === 'single' || action === 'multi') finish(action);
    });
  }

  /* ------------------------------------------------------------ rendering */

  function targetElement(step) {
    if (!step.target) return null;
    var selector = typeof step.target === 'function' ? step.target() : step.target;
    return document.querySelector(selector);
  }

  function render() {
    var node = root();
    if (!node || !active) return;
    drawing = true;
    try { draw(node); } finally { drawing = false; }
  }

  function draw(node) {
    var step = currentStep();

    var modalOpen = global.SplendorUI.isModalOpen();
    if (modalOpen) {                       // let the game's own dialogs speak
      node.hidden = true;
      return;
    }
    node.hidden = false;
    document.body.classList.add('is-coaching');

    var params = step.params ? step.params() : {};
    var waiting = !!step.check;

    node.innerHTML =
      '<div class="coach-dim" data-edge="top"></div>' +
      '<div class="coach-dim" data-edge="right"></div>' +
      '<div class="coach-dim" data-edge="bottom"></div>' +
      '<div class="coach-dim" data-edge="left"></div>' +
      '<div class="coach-ring"></div>' +
      '<div class="coach-bubble" role="dialog" aria-live="polite">' +
        '<div class="coach-head">' +
          '<span class="coach-count">' + (index + 1) + '/' + STEPS.length + '</span>' +
          (step.final ? '' : '<button type="button" class="coach-skip" data-coach="skip">' +
            t('tut.skip') + '</button>') +
        '</div>' +
        '<h3 class="coach-title">' + t('tut.' + step.key + '.title') + '</h3>' +
        '<p class="coach-body">' + t('tut.' + step.key + '.body', params) + '</p>' +
        '<div class="coach-actions">' +
          (step.final
            ? '<button type="button" class="btn btn-primary btn-sm" data-coach="single">' +
                t('menu.single') + '</button>' +
              '<button type="button" class="btn btn-sm" data-coach="multi">' +
                t('menu.multi') + '</button>'
            : (index > 0 ? '<button type="button" class="btn btn-ghost btn-sm" data-coach="back">' +
                t('tut.back') + '</button>' : '') +
              (waiting
                ? '<span class="coach-wait">' + t('tut.waiting') + '</span>' +
                  '<button type="button" class="btn btn-ghost btn-sm" data-coach="next">' +
                    t('tut.skipStep') + '</button>'
                : '<button type="button" class="btn btn-primary btn-sm" data-coach="next">' +
                    t('tut.next') + '</button>')) +
        '</div>' +
      '</div>';

    layout(node, targetElement(step));
  }

  /* Four dim panels around the highlight leave a hole without ever capturing
     a click — the player keeps using the real board underneath. */
  function layout(node, target) {
    var ring = node.querySelector('.coach-ring');
    var bubble = node.querySelector('.coach-bubble');
    var edges = {};
    Array.prototype.forEach.call(node.querySelectorAll('.coach-dim'), function (panel) {
      edges[panel.dataset.edge] = panel;
    });

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var gap = 14;

    if (!target) {
      ring.style.display = 'none';
      edges.top.style.cssText = 'inset:0';
      ['right', 'bottom', 'left'].forEach(function (edge) { edges[edge].style.display = 'none'; });
      bubble.style.left = Math.max(12, (vw - bubble.offsetWidth) / 2) + 'px';
      bubble.style.top = Math.max(12, (vh - bubble.offsetHeight) / 2) + 'px';
      return;
    }

    // Only chase the target when the step changes, so selecting gems does not
    // make the board jump under the player's finger.
    if (scrolledFor !== index && target.scrollIntoView) {
      scrolledFor = index;
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    var box = target.getBoundingClientRect();
    var pad = 6;
    var hole = {
      top: Math.max(0, box.top - pad),
      left: Math.max(0, box.left - pad),
      right: Math.min(vw, box.right + pad),
      bottom: Math.min(vh, box.bottom + pad)
    };

    // A target that fills most of the screen is not worth dimming around: the
    // ring alone says what we mean, and the board stays readable.
    var broad = ((hole.right - hole.left) * (hole.bottom - hole.top)) / (vw * vh) > 0.42;
    Object.keys(edges).forEach(function (edge) {
      edges[edge].style.display = broad ? 'none' : '';
    });

    ring.style.display = '';
    ring.style.top = hole.top + 'px';
    ring.style.left = hole.left + 'px';
    ring.style.width = (hole.right - hole.left) + 'px';
    ring.style.height = (hole.bottom - hole.top) + 'px';

    if (!broad) {
    edges.top.style.cssText = 'top:0;left:0;right:0;height:' + hole.top + 'px';
    edges.bottom.style.cssText = 'top:' + hole.bottom + 'px;left:0;right:0;bottom:0';
    edges.left.style.cssText = 'top:' + hole.top + 'px;left:0;width:' + hole.left +
      'px;height:' + (hole.bottom - hole.top) + 'px';
    edges.right.style.cssText = 'top:' + hole.top + 'px;left:' + hole.right +
      'px;right:0;height:' + (hole.bottom - hole.top) + 'px';
    }

    var bw = bubble.offsetWidth;
    var bh = bubble.offsetHeight;
    var top;
    if (hole.bottom + gap + bh <= vh - 8) top = hole.bottom + gap;
    else if (hole.top - gap - bh >= 8) top = hole.top - gap - bh;
    else {
      // Nowhere clear to sit: a target this large (the whole card board, say)
      // is better read with the bubble pinned low than floating over its middle.
      top = Math.max(8, vh - bh - 10);
    }
    if (broad) top = Math.max(8, vh - bh - 10);

    var centre = (box.left + box.right) / 2 - bw / 2;
    var left = Math.max(12, Math.min(vw - bw - 12, centre));
    bubble.style.top = Math.round(top) + 'px';
    bubble.style.left = Math.round(left) + 'px';
  }

  global.SplendorTutorial = {
    PLAN: PLAN,
    STEPS: STEPS,
    buildState: buildState,
    placeCard: placeCard,
    start: start,
    stop: stop,
    refresh: refresh,
    isActive: isActive,
    stepCount: STEPS.length
  };
})(typeof window !== 'undefined' ? window : globalThis);
