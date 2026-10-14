/* Splendor — rendering. Builds markup from state; all interaction is wired
 * with event delegation in app.js, so re-rendering never leaks listeners. */
(function (global) {
  'use strict';

  var D = global.SplendorData;
  var E = global.SplendorEngine;
  var Art = global.SplendorArt;
  var t = function (k, p) { return global.SplendorI18n.t(k, p); };

  var PLAYER_COLORS = ['#7c5cff', '#2fae72', '#e8b64c', '#e04b6b'];

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* Small contexts (pips, card badges, discount chips) always use the drawing. */
  function gemSvg(color, cls) {
    return Art.gemIcon(color, cls);
  }

  /* Token-sized contexts prefer an installed photograph. */
  function gemToken(color, cls) {
    return Art.gem(color, cls);
  }

  function pip(color, count, covered, small) {
    return '<span class="pip pip--' + color + (small ? ' pip--sm' : '') + (covered ? ' is-covered' : '') +
      '" title="' + escapeHtml(t('gem.' + color)) + '">' + count + '</span>';
  }

  /* ------------------------------------------------------------ cards */

  function costPips(card, player, small) {
    return D.COLORS.filter(function (c) { return card.cost[c]; }).map(function (color) {
      var covered = player ? (player.bonuses[color] || 0) >= card.cost[color] : false;
      return pip(color, card.cost[color], covered, small);
    }).join('');
  }

  function cardMarkup(card, player, opts) {
    opts = opts || {};
    var cls = ['card', 'card--' + card.bonus];
    if (opts.mini) cls = ['mini-card', 'card--' + card.bonus];
    if (player) {
      var gap = E.missingFor(player, card);
      var short = Math.max(0, gap.total - gap.coveredByGold);
      if (short === 0) cls.push('is-affordable');
      else if (short <= 2 && !opts.mini) cls.push('is-close');
    }
    if (opts.selected) cls.push('is-selected');

    var label = t('game.tier', { n: card.tier }) + ', ' + t('gem.' + card.bonus) +
      (card.points ? ', ' + card.points + ' ' + t('game.points') : '');

    return '<button type="button" class="' + cls.join(' ') + '"' +
      (opts.noAction ? '' : ' data-card="' + card.id + '" data-source="' + (opts.source || 'board') + '"') +
      ' aria-label="' + escapeHtml(label) + '">' +
      (opts.mini ? '' : Art.cardArt(card.bonus)) +
      '<span class="card-top">' +
        '<span class="card-pts">' + (card.points || '') + '</span>' +
        '<span class="card-gem">' + gemSvg(card.bonus, 'gem-ico') + '</span>' +
      '</span>' +
      '<span class="card-cost">' + costPips(card, player, opts.mini) + '</span>' +
      '</button>';
  }

  function hiddenCardMarkup() {
    return '<span class="mini-card card--black" aria-hidden="true" style="background:repeating-linear-gradient(135deg,#2a2142 0 6px,#241c3a 6px 12px)"></span>';
  }

  /* ------------------------------------------------------------ board */

  /* A noble's portrait if one is installed, otherwise the engraved monogram. */
  function nobleFace(noble) {
    var name = D.NOBLE_NAMES[noble.id] || '';
    var url = Art.nobleImage(noble.id);
    var points = '<span class="noble-pts">' + noble.points + '</span>';

    if (url) {
      return '<div class="noble-portrait">' +
        '<img src="' + url + '" alt="' + escapeHtml(name) + '" loading="lazy" decoding="async">' +
        points + '<span class="noble-caption">' + escapeHtml(name) + '</span></div>';
    }
    return '<div class="noble-head">' + points +
      '<span class="noble-crest" aria-hidden="true">' + escapeHtml(name.charAt(0)) + '</span>' +
      '<span class="noble-name">' + escapeHtml(name) + '</span></div>';
  }

  function renderNobles(root, state, viewer) {
    var player = state.players[viewer == null ? state.current : viewer];
    root.innerHTML = state.nobles.map(function (noble) {
      var ready = Object.keys(noble.req).every(function (c) { return (player.bonuses[c] || 0) >= noble.req[c]; });
      var reqs = Object.keys(noble.req).map(function (c) {
        return pip(c, noble.req[c], (player.bonuses[c] || 0) >= noble.req[c], true);
      }).join('');
      return '<div class="noble' + (ready ? ' is-ready' : '') + '">' +
        nobleFace(noble) +
        '<div class="noble-req">' + reqs + '</div></div>';
    }).join('') || '<p class="empty-note">—</p>';
  }

  function renderTiers(root, state, selectedCardId, viewer) {
    var player = state.players[viewer == null ? state.current : viewer];
    root.innerHTML = [3, 2, 1].map(function (tier) {
      var left = state.decks[tier].length;
      var deck = '<button type="button" class="deck" data-deck="' + tier + '"' + (left ? '' : ' disabled') + ' ' +
        'aria-label="' + escapeHtml(t('action.reserveDeck', { n: tier })) + '">' +
        '<span class="deck-tier">' + '★'.repeat(tier) + '</span>' +
        '<span class="deck-count">' + left + '</span>' +
        '<span class="deck-left">' + (left ? t('game.tier', { n: tier }) : t('game.deckEmpty')) + '</span>' +
        '</button>';

      var cards = state.board[tier].map(function (card) {
        if (!card) return '<span class="card card-empty" aria-hidden="true"></span>';
        return cardMarkup(card, player, { source: 'board', selected: card.id === selectedCardId });
      }).join('');

      return '<div class="tier-row">' + deck + '<div class="card-row">' + cards + '</div></div>';
    }).join('');
  }

  /* `enabled` is false when it is somebody else's turn: the gems are then not
     merely refused on confirm, they cannot be picked up at all. */
  function renderBank(root, state, picked, enabled) {
    var counts = {};
    picked.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    root.classList.toggle('is-locked', enabled === false);
    root.innerHTML = D.ALL_TOKENS.map(function (color) {
      var left = state.tokens[color] - (counts[color] || 0);
      var isGold = color === 'gold';
      var disabled = isGold || left <= 0 || enabled === false;
      return '<button type="button" class="token token--' + color + (counts[color] ? ' is-picked' : '') + '"' +
        ' data-token="' + color + '"' + (disabled ? ' disabled' : '') +
        ' aria-label="' + escapeHtml(t('gem.' + color)) + ': ' + left + '">' +
        gemToken(color, 'gem-ico') +
        '<span class="token-count">' + left + '</span>' +
        (counts[color] ? '<span class="token-picked-badge">+' + counts[color] + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function bonusRow(player) {
    var chips = D.COLORS.filter(function (c) { return player.bonuses[c]; }).map(function (color) {
      return '<span class="bonus-chip">' + gemSvg(color) + player.bonuses[color] + '</span>';
    }).join('');
    return chips || '<span class="empty-note">—</span>';
  }

  function tokenRow(player) {
    var chips = D.ALL_TOKENS.filter(function (c) { return player.tokens[c]; }).map(function (color) {
      return pip(color, player.tokens[color]);
    }).join('');
    return chips || '<span class="empty-note">—</span>';
  }

  function renderPlayers(root, state, options) {
    var best = Math.max.apply(null, state.players.map(function (p) { return p.points; }));
    root.innerHTML = state.players.map(function (player, index) {
      var isCurrent = index === state.current && state.phase !== 'gameover';
      var tag = player.type === 'ai' ? t('game.ai') + ' · ' + t('menu.difficulty.' + player.difficulty)
        : (options.youIndex === index && player.name !== t('menu.you') ? t('game.you') : '');
      // Reserved cards are secret in Splendor: only the player at the device sees theirs.
      var reserved = options.revealIndex === index
        ? player.reserved.map(function (c) { return cardMarkup(c, player, { mini: true, noAction: true }); }).join('')
        : player.reserved.map(hiddenCardMarkup).join('');

      return '<div class="player' + (isCurrent ? ' is-current' : '') + (player.points === best && best > 0 ? ' is-leader' : '') + '">' +
        '<div class="player-head">' +
          '<span class="player-dot" style="background:' + PLAYER_COLORS[index % 4] + '"></span>' +
          '<span class="player-name">' + escapeHtml(player.name) + '</span>' +
          (tag ? '<span class="player-tag">' + escapeHtml(tag) + '</span>' : '') +
          '<span class="player-pts">' + player.points + '</span>' +
        '</div>' +
        '<div class="player-stats">' +
          '<span>' + player.cards.length + ' ' + t('game.cards') + '</span>' +
          '<span>' + E.countTokens(player.tokens) + '/' + D.MAX_TOKENS + ' 💎</span>' +
          (player.nobles.length ? '<span>' + player.nobles.length + ' 👑</span>' : '') +
        '</div>' +
        '<div class="player-row">' + bonusRow(player) + '</div>' +
        (E.countTokens(player.tokens) ? '<div class="player-row">' + tokenRow(player) + '</div>' : '') +
        (player.reserved.length ? '<div class="player-row">' + reserved + '</div>' : '') +
        '</div>';
    }).join('');
  }

  /* `viewer` is whose tray this is — the local player online, the player at the
     device otherwise. It is not always the player whose turn it is. */
  function renderTray(root, state, picked, interactive, viewer) {
    var seat = viewer == null ? state.current : viewer;
    var player = state.players[seat];
    var pickCount = picked.length;
    var tokenError = pickCount ? E.validateTokenPick(state, picked) : 'empty';
    var stuck = interactive && state.phase === 'play' && seat === state.current && !E.hasRealAction(state);

    var reserved = player.reserved.length
      ? player.reserved.map(function (card) {
          return cardMarkup(card, player, { mini: true, source: 'reserve' });
        }).join('')
      : '<span class="empty-note">' + t('game.noReserved') + '</span>';

    /* Only the groups that have something in them: three columns of "—" is
       noise, and on a phone it is noise that costs the board real height. */
    var held = E.countTokens(player.tokens);
    var groups = [];
    if (player.cards.length) {
      groups.push('<div class="tray-group"><span class="tray-label">' + t('game.bonuses') + '</span>' +
        '<div class="tray-row">' + bonusRow(player) + '</div></div>');
    }
    if (held) {
      /* The ten-token limit makes this count worth showing at every size. */
      groups.push('<div class="tray-group"><span class="tray-count' +
        (held >= D.MAX_TOKENS ? ' is-full' : '') + '">💎 ' + held + '/' + D.MAX_TOKENS + '</span>' +
        '<div class="tray-row">' + tokenRow(player) + '</div></div>');
    }
    if (player.reserved.length) {
      groups.push('<div class="tray-group tray-reserved"><span class="tray-count">' +
        t('game.reserved') + ' ' + player.reserved.length + '/' + D.MAX_RESERVED + '</span>' +
        '<div class="tray-row">' + reserved + '</div></div>');
    }

    root.innerHTML =
      '<div class="tray-head">' +
        '<span class="player-dot" style="background:' + PLAYER_COLORS[seat % 4] + '"></span>' +
        '<span class="tray-title">' + escapeHtml(player.name) + '</span>' +
        (player.type === 'ai' ? '<span class="player-tag">' + t('game.ai') + '</span>' : '') +
        '<span class="tray-pts">' + player.points + ' ' + t('game.points') + '</span>' +
      '</div>' +
      '<div class="tray-groups">' +
        (groups.length ? groups.join('') : '<span class="empty-note">' + t('tray.empty') + '</span>') +
      '</div>' +
      (interactive && pickCount && tokenError && tokenError !== 'empty'
        ? '<p class="hint">' + escapeHtml(t(tokenError)) + '</p>' : '') +
      (interactive
        ? '<div class="tray-actions">' +
            (stuck
              ? '<button type="button" class="btn btn-danger" id="pass-btn">' + t('action.pass') + '</button>'
              : '<button type="button" class="btn btn-primary" id="take-btn"' + (tokenError ? ' disabled' : '') + '>' +
                  (pickCount ? t('action.take', { n: pickCount }) : t('action.takeEmpty')) + '</button>') +
            (pickCount ? '<button type="button" class="btn btn-ghost btn-sm" id="clear-btn">' + t('action.clear') + '</button>' : '') +
          '</div>'
        : '');
  }

  /* One line that always says whose turn it is, and what you may do about it.
     `opts`: { canAct, viewer, seatOfCurrent, waitingLabel } */
  function renderTurnLine(root, state, opts) {
    var current = state.players[state.current];
    var mine = !!opts.canAct;
    var colour = PLAYER_COLORS[state.current % 4];

    if (state.phase === 'gameover') {
      root.className = 'turn-line is-over';
      root.innerHTML = '<span class="turn-text">' + t('turn.over') + '</span>';
      return;
    }

    var label, hint = '';
    if (mine) {
      /* Around one device the name matters, because the wrong person could
         otherwise take the turn; on your own screen "you" is clearer. */
      label = opts.namedTurn ? t('turn.yoursNamed', { p: escapeHtml(current.name) }) : t('turn.yours');
      hint = state.phase === 'discard' ? t('turn.hint.discard')
        : state.phase === 'noble' ? t('turn.hint.noble')
        : t('turn.hint.play');
    } else if (current.type === 'ai') {
      label = t('turn.thinking', { p: escapeHtml(current.name) });
    } else if (state.phase === 'discard') {
      label = t('turn.discarding', { p: escapeHtml(current.name) });
    } else if (state.phase === 'noble') {
      label = t('turn.choosingNoble', { p: escapeHtml(current.name) });
    } else {
      label = t('turn.waiting', { p: escapeHtml(current.name) });
      hint = t('turn.hint.locked');
    }

    /* Online, "your turn" is only true while the room can still hear you: a
       player cut off from the referee would otherwise be told to move and have
       every move silently dropped. Trouble that does not block play — the host
       is its own referee — is said alongside the turn instead of replacing it. */
    var blocked = !!(opts.warning && opts.blocked);
    if (blocked) {
      label = opts.warning;
      hint = '';
      mine = false;
    } else if (opts.warning) {
      hint = opts.warning;
    }

    root.className = 'turn-line' + (blocked ? ' is-warning' : mine ? ' is-mine' : ' is-waiting');
    root.innerHTML =
      '<span class="turn-dot" style="background:' + (blocked ? 'var(--danger)' : colour) + '"></span>' +
      '<span class="turn-text">' + label + '</span>' +
      (hint ? '<span class="turn-hint' + (!blocked && opts.warning ? ' is-warning' : '') + '">' +
        hint + '</span>' : '') +
      scoreStrip(state, opts.viewer);
  }

  /* Every player's score in one tappable row: on a phone this replaces the
     side panel, so you can still see who is ahead without leaving the board. */
  function scoreStrip(state, viewer) {
    var chips = state.players.map(function (player, index) {
      var classes = ['score-chip'];
      if (index === state.current && state.phase !== 'gameover') classes.push('is-turn');
      if (index === viewer) classes.push('is-you');
      return '<span class="' + classes.join(' ') + '">' +
        '<i style="background:' + PLAYER_COLORS[index % 4] + '"></i>' + player.points + '</span>';
    }).join('');
    return '<button type="button" class="turn-scores" data-sheet="players" ' +
      'aria-label="' + escapeHtml(t('game.players')) + '">' + chips + '</button>';
  }

  /* The nobles at full size: on a phone the strip shows only points and
     requirements, so this is where the who and the how-far-off live. */
  function noblesModal(state, viewer) {
    var player = state.players[viewer == null ? state.current : viewer];
    var rows = state.nobles.map(function (noble) {
      var ready = Object.keys(noble.req).every(function (c) {
        return (player.bonuses[c] || 0) >= noble.req[c];
      });
      var needs = Object.keys(noble.req).map(function (color) {
        var have = Math.min(player.bonuses[color] || 0, noble.req[color]);
        return pip(color, have + '/' + noble.req[color], have >= noble.req[color], true);
      }).join('');
      var url = Art.nobleImage(noble.id);
      return '<div class="noble-row' + (ready ? ' is-ready' : '') + '">' +
        (url ? '<img class="noble-face" src="' + url + '" alt="" loading="lazy">'
             : '<span class="noble-face noble-face--blank">' +
               escapeHtml((D.NOBLE_NAMES[noble.id] || '?').charAt(0)) + '</span>') +
        '<span class="noble-row-main">' +
          '<b>' + escapeHtml(D.NOBLE_NAMES[noble.id] || '') + '</b>' +
          '<span class="noble-row-req">' + needs + '</span>' +
        '</span>' +
        '<span class="noble-row-pts">' + noble.points + '</span>' +
        '</div>';
    }).join('') || '<p class="empty-note">—</p>';

    return modal(
      '<h2 class="modal-title">' + t('game.nobles') + '</h2>' +
      '<p class="modal-body">' + t('rules.noble.p') + '</p>' +
      '<div class="noble-rows">' + rows + '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-primary" data-close="1">' +
        t('action.cancel') + '</button></div>');
  }

  /* Everyone's board, for when the phone has no room to show it beside the game. */
  function playersModal(state, viewer) {
    var best = Math.max.apply(null, state.players.map(function (p) { return p.points; }));
    var rows = state.players.map(function (player, index) {
      var tags = [];
      if (index === viewer) tags.push(t('game.you'));
      if (player.type === 'ai') tags.push(t('game.ai'));
      if (index === state.current && state.phase !== 'gameover') tags.push(t('turn.onTurn'));
      return '<div class="sheet-player' + (player.points === best && best > 0 ? ' is-leader' : '') + '">' +
        '<div class="player-head">' +
          '<span class="player-dot" style="background:' + PLAYER_COLORS[index % 4] + '"></span>' +
          '<span class="player-name">' + escapeHtml(player.name) + '</span>' +
          (tags.length ? '<span class="player-tag">' + tags.join(' · ') + '</span>' : '') +
          '<span class="player-pts">' + player.points + '</span>' +
        '</div>' +
        '<div class="player-stats">' +
          '<span>' + player.cards.length + ' ' + t('game.cards') + '</span>' +
          '<span>' + E.countTokens(player.tokens) + '/' + D.MAX_TOKENS + ' 💎</span>' +
          '<span>' + player.reserved.length + '/' + D.MAX_RESERVED + ' ' + t('game.reserved').toLowerCase() + '</span>' +
          (player.nobles.length ? '<span>' + player.nobles.length + ' 👑</span>' : '') +
        '</div>' +
        '<div class="player-row">' + bonusRow(player) + '</div>' +
        '<div class="player-row">' + tokenRow(player) + '</div>' +
        '</div>';
    }).join('');

    return modal(
      '<h2 class="modal-title">' + t('game.players') + '</h2>' +
      '<div class="sheet-players">' + rows + '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-primary" data-close="1">' +
        t('action.cancel') + '</button></div>');
  }

  /* ------------------------------------------------------------ modals */

  var modalRoot = null;
  var onCloseHandler = null;
  var modalListeners = [];
  var noticeTimer = null;

  /* Lets the tutorial coach marks step aside while a dialog owns the screen. */
  function onModalChange(fn) {
    modalListeners.push(fn);
  }

  function notifyModalChange() {
    modalListeners.forEach(function (fn) { fn(); });
  }

  function modal(html, options) {
    options = options || {};
    modalRoot = modalRoot || document.getElementById('modal-root');
    modalRoot.innerHTML = '<div class="modal' + (options.className ? ' ' + options.className : '') +
      '" role="dialog" aria-modal="true">' + html + '</div>';
    modalRoot.hidden = false;
    document.body.classList.add('has-modal');
    onCloseHandler = options.onClose || null;
    modalRoot.dataset.dismissable = options.dismissable === false ? 'no' : 'yes';
    var focusable = modalRoot.querySelector('button, input, [tabindex]');
    if (focusable && options.autofocus !== false) focusable.focus();
    notifyModalChange();
    return modalRoot.firstChild;
  }

  function closeModal() {
    modalRoot = modalRoot || document.getElementById('modal-root');
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
    document.body.classList.remove('has-modal');
    var handler = onCloseHandler;
    onCloseHandler = null;
    notifyModalChange();
    if (handler) handler();
  }

  function isModalOpen() {
    modalRoot = modalRoot || document.getElementById('modal-root');
    return !modalRoot.hidden;
  }

  /* Card detail sheet: cost breakdown plus the legal actions for this card. */
  function cardDetail(state, card, source) {
    var player = E.currentPlayer(state);
    var payment = E.paymentFor(player, card);
    var gap = E.missingFor(player, card);
    var canBuy = payment.ok;
    var canReserve = source === 'board' && player.reserved.length < D.MAX_RESERVED;

    var coveredPips = D.COLORS.filter(function (c) { return card.cost[c] && player.bonuses[c]; }).map(function (c) {
      return pip(c, Math.min(player.bonuses[c], card.cost[c]), false, true);
    }).join('') || '<span class="empty-note">—</span>';

    var payPips = Object.keys(payment.pay).length
      ? D.ALL_TOKENS.filter(function (c) { return payment.pay[c]; }).map(function (c) { return pip(c, payment.pay[c]); }).join('')
      : '<span class="empty-note">—</span>';

    var missingPips = Object.keys(gap.missing).map(function (c) { return pip(c, gap.missing[c], false, true); }).join('');
    var shortfall = Math.max(0, gap.total - gap.coveredByGold);

    var html =
      '<div class="detail">' +
        cardMarkup(card, player, { noAction: true }) +
        '<div class="detail-info">' +
          '<div class="detail-line"><span class="label">' + t('action.cost') + '</span>' + costPips(card, null) + '</div>' +
          '<div class="detail-line"><span class="label">' + t('action.covered') + '</span>' + coveredPips + '</div>' +
          (canBuy
            ? '<div class="detail-line"><span class="label">' + t('action.youPay') + '</span>' + payPips + '</div>' +
              (payment.gold ? '<p class="detail-ok">' + t('action.withGold', { n: payment.gold }) + '</p>' : '')
            : '<div class="detail-line"><span class="label">' + t('action.missing') + '</span>' + missingPips + '</div>' +
              '<p class="detail-warn">' + t('action.cannotBuy') + (shortfall ? ' (' + shortfall + ')' : '') + '</p>') +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-close="1">' + t('action.cancel') + '</button>' +
        (source === 'board'
          ? '<button type="button" class="btn btn-gold" data-do="reserve" data-card="' + card.id + '"' +
            (canReserve ? '' : ' disabled') + '>' + t('action.reserve') + '</button>'
          : '') +
        '<button type="button" class="btn btn-primary" data-do="buy" data-card="' + card.id + '"' +
          (canBuy ? '' : ' disabled') + '>' + t('action.buy') + '</button>' +
      '</div>';
    return modal(html);
  }

  function deckDetail(state, tier) {
    var player = E.currentPlayer(state);
    var canReserve = player.reserved.length < D.MAX_RESERVED && state.decks[tier].length > 0;
    return modal(
      '<h2 class="modal-title">' + t('action.reserveDeck', { n: tier }) + '</h2>' +
      '<p class="modal-body">' + t('rules.turn.3') + '</p>' +
      (canReserve ? '' : '<p class="detail-warn">' + t('action.reserveFull') + '</p>') +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-close="1">' + t('action.cancel') + '</button>' +
        '<button type="button" class="btn btn-gold" data-do="reserveDeck" data-tier="' + tier + '"' +
          (canReserve ? '' : ' disabled') + '>' + t('action.reserve') + '</button>' +
      '</div>');
  }

  function discardModal(state, selected) {
    var player = E.currentPlayer(state);
    var need = E.countTokens(player.tokens) - D.MAX_TOKENS;
    var chosen = E.countTokens(selected);
    var rows = D.ALL_TOKENS.filter(function (c) { return player.tokens[c]; }).map(function (color) {
      var left = player.tokens[color] - (selected[color] || 0);
      return '<button type="button" class="token token--' + color + (selected[color] ? ' is-picked' : '') + '"' +
        ' data-discard="' + color + '"' + (left <= 0 ? ' disabled' : '') + '>' +
        gemToken(color, 'gem-ico') + '<span class="token-count">' + left + '</span>' +
        (selected[color] ? '<span class="token-picked-badge">' + selected[color] + '</span>' : '') + '</button>';
    }).join('');

    return modal(
      '<h2 class="modal-title">' + t('modal.discard.title') + '</h2>' +
      '<p class="modal-body">' + t('modal.discard.body', { n: need }) + '</p>' +
      '<div class="bank">' + rows + '</div>' +
      '<p class="modal-body">' + t('modal.discard.selected', { a: chosen, b: need }) + '</p>' +
      '<div class="modal-actions">' +
        (chosen ? '<button type="button" class="btn btn-ghost" data-do="discardReset">' + t('action.clear') + '</button>' : '') +
        '<button type="button" class="btn btn-primary" data-do="discardConfirm"' + (chosen === need ? '' : ' disabled') + '>' +
          t('action.confirm') + '</button>' +
      '</div>', { dismissable: false });
  }

  function nobleModal(state) {
    var options = state.pendingNobles.map(function (id) {
      var noble = null;
      state.nobles.forEach(function (n) { if (n.id === id) noble = n; });
      if (!noble) return '';
      var reqs = Object.keys(noble.req).map(function (c) { return pip(c, noble.req[c], true, true); }).join('');
      return '<button type="button" class="noble" data-noble="' + noble.id + '" style="cursor:pointer">' +
        nobleFace(noble) +
        '<div class="noble-req">' + reqs + '</div></button>';
    }).join('');

    return modal(
      '<h2 class="modal-title">' + t('modal.noble.title') + '</h2>' +
      '<p class="modal-body">' + t('modal.noble.body') + '</p>' +
      '<div class="nobles">' + options + '</div>', { dismissable: false });
  }

  function gameOverModal(state) {
    var ranked = (state.ranking || []).map(function (id) { return state.players[id]; });
    var winner = state.players[state.winner];
    var tie = ranked.length > 1 && ranked[1].points === winner.points;
    var standings = ranked.map(function (player, index) {
      return '<div class="standing' + (index === 0 ? ' is-winner' : '') + '">' +
        '<span class="standing-rank">' + (index + 1) + '</span>' +
        '<span class="standing-name">' + escapeHtml(player.name) +
          '<span class="standing-detail"> · ' + player.cards.length + ' ' + t('game.cards') +
          (player.nobles.length ? ' · ' + player.nobles.length + ' 👑' : '') + '</span></span>' +
        '<span class="standing-pts">' + player.points + '</span></div>';
    }).join('');

    return modal(
      '<h2 class="modal-title">🏆 ' + (tie ? t('modal.over.tie', { p: escapeHtml(winner.name) })
                                          : t('modal.over.winner', { p: escapeHtml(winner.name) })) + '</h2>' +
      (state.stalemate ? '<p class="modal-body">' + t('modal.over.stalemate') + '</p>' : '') +
      '<div class="standings">' + standings + '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-do="toMenu">' + t('modal.over.menu') + '</button>' +
        '<button type="button" class="btn btn-primary" data-do="rematch">' + t('modal.over.again') + '</button>' +
      '</div>', { dismissable: false });
  }

  function curtainModal(playerName) {
    return modal(
      '<h2 class="modal-title">' + t('modal.curtain.title') + '</h2>' +
      '<div class="curtain-art">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 21 7v10l-9 5.5L3 17V7Z" fill="#7c5cff" stroke="#b07cff" stroke-width="1"/></svg>' +
      '</div>' +
      '<p class="modal-body">' + t('modal.curtain.body', { p: escapeHtml(playerName) }) + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-primary btn-block" data-do="curtainReady">' + t('modal.curtain.ready') + '</button>' +
      '</div>', { dismissable: false });
  }

  function rulesModal() {
    var blocks = [
      ['rules.goal.h', ['rules.goal.p']],
      ['rules.turn.h', null],
      ['rules.pay.h', ['rules.pay.p']],
      ['rules.limit.h', ['rules.limit.p']],
      ['rules.noble.h', ['rules.noble.p']],
      ['rules.setup.h', ['rules.setup.p']]
    ].map(function (block) {
      var body = block[1]
        ? block[1].map(function (k) { return '<p>' + t(k) + '</p>'; }).join('')
        : '<ol><li>' + t('rules.turn.1') + '</li><li>' + t('rules.turn.2') + '</li><li>' +
          t('rules.turn.3') + '</li><li>' + t('rules.turn.4') + '</li></ol>';
      return '<div class="rule-block"><h3>' + t(block[0]) + '</h3>' + body + '</div>';
    }).join('');

    return modal(
      '<h2 class="modal-title">' + t('rules.title') + '</h2>' +
      '<div class="rules">' + blocks + '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-primary" data-close="1">' +
        t('action.cancel') + '</button></div>');
  }

  function logModal(state) {
    var items = state.log.map(function (entry) {
      return '<p class="log-item">' + escapeHtml(global.SplendorI18n.logText(entry)) + '</p>';
    }).join('');
    return modal(
      '<h2 class="modal-title">' + t('game.log') + '</h2>' +
      '<div class="log-list">' + items + '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-primary" data-close="1">' +
        t('action.cancel') + '</button></div>');
  }

  function menuModal(state) {
    return modal(
      '<h2 class="modal-title">' + t('game.menu') + '</h2>' +
      '<div class="modal-actions" style="flex-direction:column">' +
        '<button type="button" class="btn btn-primary btn-block" data-close="1">' + t('game.resumeGame') + '</button>' +
        '<button type="button" class="btn btn-block" data-do="rules">' + t('game.rules') + '</button>' +
        '<button type="button" class="btn btn-block" data-do="tutorial">' + t('tut.title') + '</button>' +
        '<button type="button" class="btn btn-block" data-do="lang">' +
          (global.SplendorI18n.getLang() === 'vi' ? 'English' : 'Tiếng Việt') + '</button>' +
        '<button type="button" class="btn btn-danger btn-block" data-do="quit">' + t('game.backToMenu') + '</button>' +
      '</div>');
  }

  function confirmModal(titleKey, bodyKey, action) {
    return modal(
      '<h2 class="modal-title">' + t(titleKey) + '</h2>' +
      '<p class="modal-body">' + t(bodyKey) + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-close="1">' + t('action.cancel') + '</button>' +
        '<button type="button" class="btn btn-danger" data-do="' + action + '">' + t('action.confirm') + '</button>' +
      '</div>');
  }

  /* --------------------------------------------------- name and chat */

  function renameModal(current, limit) {
    var node = modal(
      '<h2 class="modal-title">' + t('net.renameTitle') + '</h2>' +
      '<p class="modal-body">' + t('net.renameBody') + '</p>' +
      '<form class="rename-form" id="rename-form">' +
        '<input type="text" class="text-input" id="rename-input" maxlength="' + limit + '" ' +
          'autocomplete="off" autocapitalize="words" spellcheck="false" ' +
          'value="' + escapeHtml(current) + '">' +
        '<p class="hint">' + t('net.nameLimit', { n: limit }) + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" data-close="1">' + t('action.cancel') + '</button>' +
          '<button type="submit" class="btn btn-primary" data-do="renameSave">' +
            t('net.renameSave') + '</button>' +
        '</div>' +
      '</form>', { autofocus: false });
    var input = document.getElementById('rename-input');
    if (input) { input.focus(); input.select(); }
    return node;
  }

  /* One line of chat. Everything in here was typed by somebody else's browser,
     so every part of it is escaped on the way onto the page. */
  function chatLine(line) {
    if (line.system) {
      return '<p class="chat-note">' + escapeHtml(line.text) + '</p>';
    }
    var colour = line.seat >= 0 ? PLAYER_COLORS[line.seat % 4] : 'var(--muted-2)';
    return '<div class="chat-line' + (line.mine ? ' is-mine' : '') + '">' +
      '<span class="chat-who" style="color:' + colour + '">' + escapeHtml(line.name) + '</span>' +
      '<span class="chat-text">' + escapeHtml(line.text) + '</span>' +
      '</div>';
  }

  function chatList(log) {
    if (!log || !log.length) return '<p class="empty-note">' + t('chat.empty') + '</p>';
    return log.map(chatLine).join('');
  }

  /* Draws the messages into an existing list and keeps it pinned to the newest
     line, the way a chat is expected to behave. */
  function renderChatList(root, log) {
    if (!root) return;
    root.innerHTML = chatList(log);
    root.scrollTop = root.scrollHeight;
  }

  function chatForm(limit, enabled) {
    return '<form class="chat-form" data-chat-form="1">' +
      '<input type="text" class="text-input chat-input" data-chat-input="1" ' +
        'maxlength="' + limit + '" autocomplete="off" ' +
        'placeholder="' + escapeHtml(t('chat.placeholder')) + '"' +
        (enabled ? '' : ' disabled') + '>' +
      '<button type="submit" class="btn btn-primary chat-send"' + (enabled ? '' : ' disabled') +
        '>' + t('chat.send') + '</button>' +
      '</form>';
  }

  /* The in-game chat sheet. On a phone the board fills the screen, so talking
     has to happen over the top of it rather than beside it. */
  function chatModal(log, limit, enabled) {
    var node = modal(
      '<h2 class="modal-title">' + t('chat.title') + '</h2>' +
      '<div class="chat-log" id="chat-log-modal"></div>' +
      chatForm(limit, enabled) +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="1">' +
        t('action.cancel') + '</button></div>', { autofocus: false, className: 'is-chat' });
    renderChatList(document.getElementById('chat-log-modal'), log);
    var input = node.querySelector('[data-chat-input]');
    if (input && enabled) input.focus();
    return node;
  }

  /* ------------------------------------------------------------ toasts */

  function toast(message, kind) {
    /* A dialog can fill a phone screen, so a floating toast would land on top
       of the very text it is commenting on. While one is open the message goes
       inside it instead, right where the tap that triggered it happened. */
    if (isModalOpen()) { modalNotice(message, kind); return; }
    var root = document.getElementById('toast-root');
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' is-' + kind : '');
    node.textContent = message;
    root.appendChild(node);
    setTimeout(function () {
      node.classList.add('is-out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
    }, kind === 'error' ? 2600 : 2000);
    while (root.children.length > 3) root.removeChild(root.firstChild);
  }

  /* One notice line at the top of the open dialog. Replaced, never stacked:
     the newest reason for a refused tap is the only one worth reading. */
  function modalNotice(message, kind) {
    var dialog = modalRoot && modalRoot.firstChild;
    if (!dialog) return;
    var node = dialog.querySelector('.modal-notice');
    if (!node) {
      node = document.createElement('div');
      node.className = 'modal-notice';
      node.setAttribute('role', 'status');
      dialog.insertBefore(node, dialog.firstChild);
    }
    node.className = 'modal-notice' + (kind ? ' is-' + kind : '');
    node.textContent = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, kind === 'error' ? 3200 : 2400);
  }

  global.SplendorUI = {
    PLAYER_COLORS: PLAYER_COLORS,
    nobleFace: nobleFace,
    escapeHtml: escapeHtml,
    gemSvg: gemSvg,
    gemToken: gemToken,
    renderNobles: renderNobles,
    renderTiers: renderTiers,
    renderBank: renderBank,
    renderTurnLine: renderTurnLine,
    noblesModal: noblesModal,
    playersModal: playersModal,
    renderPlayers: renderPlayers,
    renderTray: renderTray,
    cardDetail: cardDetail,
    deckDetail: deckDetail,
    discardModal: discardModal,
    nobleModal: nobleModal,
    gameOverModal: gameOverModal,
    curtainModal: curtainModal,
    rulesModal: rulesModal,
    logModal: logModal,
    menuModal: menuModal,
    confirmModal: confirmModal,
    renameModal: renameModal,
    chatModal: chatModal,
    chatForm: chatForm,
    chatList: chatList,
    renderChatList: renderChatList,
    modal: modal,
    closeModal: closeModal,
    isModalOpen: isModalOpen,
    onModalChange: onModalChange,
    toast: toast
  };
})(typeof window !== 'undefined' ? window : globalThis);
