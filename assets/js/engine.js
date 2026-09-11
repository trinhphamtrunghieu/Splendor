/* Splendor — rules engine.
 *
 * Pure game logic: no DOM, no timers. Every mutation goes through an action
 * so the UI and the AI can share exactly the same rule checks.
 *
 * Failures come back as { ok: false, error: <i18n key>, params } — the engine
 * never builds user-facing text itself.
 */
(function (global) {
  'use strict';

  var D = global.SplendorData;
  var COLORS = D.COLORS;

  /* ---------------------------------------------------------------- utils */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rnd) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function emptyPile(extra) {
    var pile = {};
    COLORS.forEach(function (c) { pile[c] = 0; });
    if (extra) pile.gold = 0;
    return pile;
  }

  function countTokens(pile) {
    return Object.keys(pile).reduce(function (sum, k) { return sum + pile[k]; }, 0);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* ---------------------------------------------------------------- setup */

  function createGame(options) {
    var players = options.players;
    var seed = options.seed != null ? options.seed : (Math.random() * 1e9) | 0;
    var rnd = mulberry32(seed);
    var decks = D.buildDeck();
    var perGem = D.TOKENS_BY_PLAYERS[players.length] || 7;

    var state = {
      seed: seed,
      createdAt: Date.now(),
      tokens: (function () {
        var bank = emptyPile(true);
        COLORS.forEach(function (c) { bank[c] = perGem; });
        bank.gold = D.GOLD_COUNT;
        return bank;
      })(),
      decks: { 1: shuffle(decks[1], rnd), 2: shuffle(decks[2], rnd), 3: shuffle(decks[3], rnd) },
      board: { 1: [], 2: [], 3: [] },
      nobles: shuffle(D.NOBLES.slice(), rnd).slice(0, players.length + D.NOBLE_BONUS).map(clone),
      players: players.map(function (p, i) {
        return {
          id: i,
          name: p.name,
          type: p.type || 'human',
          difficulty: p.difficulty || 'normal',
          tokens: emptyPile(true),
          bonuses: emptyPile(false),
          cards: [],
          reserved: [],
          nobles: [],
          points: 0
        };
      }),
      current: 0,
      round: 1,
      phase: 'play',            // play | discard | noble | gameover
      pendingNobles: [],
      finalRound: false,
      triggeredBy: null,
      winner: null,
      log: [],
      turnCount: 0,
      noBuyStreak: 0,
      stalemate: false
    };

    [1, 2, 3].forEach(function (tier) {
      for (var i = 0; i < D.BOARD_WIDTH; i++) {
        state.board[tier].push(state.decks[tier].pop() || null);
      }
    });

    log(state, 'start', { n: players.length });
    return state;
  }

  /* Log entries are structured so the UI can render them in any language. */
  function log(state, key, params) {
    state.log.push({ turn: state.turnCount, player: state.current, key: key, params: params || {} });
    if (state.log.length > 200) state.log.shift();
  }

  /* ------------------------------------------------------------- helpers */

  function currentPlayer(state) {
    return state.players[state.current];
  }

  function findBoardCard(state, cardId) {
    var found = null;
    [1, 2, 3].forEach(function (tier) {
      state.board[tier].forEach(function (card, index) {
        if (card && card.id === cardId) found = { card: card, tier: tier, index: index };
      });
    });
    return found;
  }

  /* What the player still has to pay after bonuses, and how much gold it costs. */
  function paymentFor(player, card) {
    var pay = {};
    var gold = 0;
    var ok = true;
    COLORS.forEach(function (color) {
      var need = (card.cost[color] || 0) - (player.bonuses[color] || 0);
      if (need <= 0) return;
      var have = player.tokens[color] || 0;
      var used = Math.min(have, need);
      if (used) pay[color] = used;
      gold += need - used;
    });
    if (gold > (player.tokens.gold || 0)) ok = false;
    if (gold) pay.gold = gold;
    return { ok: ok, pay: pay, gold: gold };
  }

  function canAfford(player, card) {
    return paymentFor(player, card).ok;
  }

  /* Gems the player is short of, ignoring gold — used by the UI and the AI. */
  function missingFor(player, card) {
    var missing = {};
    var total = 0;
    COLORS.forEach(function (color) {
      var need = (card.cost[color] || 0) - (player.bonuses[color] || 0) - (player.tokens[color] || 0);
      if (need > 0) { missing[color] = need; total += need; }
    });
    return { missing: missing, total: total, coveredByGold: Math.min(total, player.tokens.gold || 0) };
  }

  function refill(state, tier, index) {
    state.board[tier][index] = state.decks[tier].pop() || null;
  }

  /* ------------------------------------------------------------- actions */

  function legalTokenPicks(state) {
    var picks = [];
    var bank = state.tokens;
    var available = COLORS.filter(function (c) { return bank[c] > 0; });

    COLORS.forEach(function (c) {
      if (bank[c] >= 4) picks.push([c, c]);
    });
    // All combinations of three distinct colours (or fewer, when the bank is low).
    for (var i = 0; i < available.length; i++) {
      for (var j = i + 1; j < available.length; j++) {
        for (var k = j + 1; k < available.length; k++) {
          picks.push([available[i], available[j], available[k]]);
        }
      }
    }
    if (available.length < 3) {
      if (available.length === 2) picks.push([available[0], available[1]]);
      else if (available.length === 1) picks.push([available[0]]);
    }
    return picks;
  }

  function validateTokenPick(state, colors) {
    if (state.phase !== 'play') return 'err.notNow';
    if (!colors || !colors.length) return 'err.pickOne';
    var counts = {};
    colors.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    var distinct = Object.keys(counts);

    if (distinct.length === 1 && counts[distinct[0]] === 2) {
      if (state.tokens[distinct[0]] < 4) return 'err.pairNeedsFour';
      return null;
    }
    if (distinct.length !== colors.length) return 'err.mixInvalid';
    if (colors.length > 3) return 'err.maxThree';
    for (var i = 0; i < colors.length; i++) {
      if (colors[i] === 'gold') return 'err.goldReserve';
      if (state.tokens[colors[i]] < 1) return 'err.soldOut';
    }
    if (colors.length < 3) {
      // Only allowed when fewer than three colours are left in the bank.
      var availableColors = COLORS.filter(function (c) { return state.tokens[c] > 0; });
      if (availableColors.length >= 3) return 'err.threeDifferent';
    }
    return null;
  }

  function takeTokens(state, colors) {
    var error = validateTokenPick(state, colors);
    if (error) return { ok: false, error: error };   // error is an i18n key
    var player = currentPlayer(state);
    colors.forEach(function (c) {
      state.tokens[c]--;
      player.tokens[c]++;
    });
    log(state, 'take', { p: player.name, gems: colors.slice() });
    return endTurn(state);
  }

  function reserveCard(state, cardId) {
    if (state.phase !== 'play') return { ok: false, error: 'err.notNow' };
    var player = currentPlayer(state);
    if (player.reserved.length >= D.MAX_RESERVED) return { ok: false, error: 'err.reserveFull' };
    var hit = findBoardCard(state, cardId);
    if (!hit) return { ok: false, error: 'err.cardGone' };

    player.reserved.push(hit.card);
    refill(state, hit.tier, hit.index);
    var tookGold = false;
    if (state.tokens.gold > 0) {
      state.tokens.gold--;
      player.tokens.gold++;
      tookGold = true;
    }
    log(state, tookGold ? 'reserveGold' : 'reserve', { p: player.name, tier: hit.tier });
    return endTurn(state);
  }

  function reserveFromDeck(state, tier) {
    if (state.phase !== 'play') return { ok: false, error: 'err.notNow' };
    var player = currentPlayer(state);
    if (player.reserved.length >= D.MAX_RESERVED) return { ok: false, error: 'err.reserveFull' };
    if (!state.decks[tier].length) return { ok: false, error: 'err.deckEmpty' };

    player.reserved.push(state.decks[tier].pop());
    var tookGold = false;
    if (state.tokens.gold > 0) {
      state.tokens.gold--;
      player.tokens.gold++;
      tookGold = true;
    }
    log(state, tookGold ? 'reserveDeckGold' : 'reserveDeck', { p: player.name, tier: tier });
    return endTurn(state);
  }

  /* Last resort: an empty bank, three reserved cards and nothing affordable
     leaves a player with no move. Splendor has no pass action, so allow one
     only when literally nothing else is legal — otherwise the game deadlocks. */
  function passTurn(state) {
    if (state.phase !== 'play') return { ok: false, error: 'err.notNow' };
    if (hasRealAction(state)) return { ok: false, error: 'err.mustAct' };
    log(state, 'pass', { p: currentPlayer(state).name });
    return endTurn(state);
  }

  function buyCard(state, cardId) {
    if (state.phase !== 'play') return { ok: false, error: 'err.notNow' };
    var player = currentPlayer(state);
    var card = null;
    var source = null;
    var hit = findBoardCard(state, cardId);

    if (hit) { card = hit.card; source = 'board'; }
    else {
      for (var i = 0; i < player.reserved.length; i++) {
        if (player.reserved[i].id === cardId) { card = player.reserved[i]; source = 'reserve'; break; }
      }
    }
    if (!card) return { ok: false, error: 'err.cardGone' };

    var payment = paymentFor(player, card);
    if (!payment.ok) return { ok: false, error: 'err.cannotPay' };

    Object.keys(payment.pay).forEach(function (color) {
      player.tokens[color] -= payment.pay[color];
      state.tokens[color] += payment.pay[color];
    });

    if (source === 'board') refill(state, hit.tier, hit.index);
    else player.reserved = player.reserved.filter(function (c) { return c.id !== cardId; });

    player.cards.push(card);
    player.bonuses[card.bonus]++;
    player.points += card.points;
    state.noBuyStreak = -1;      // becomes 0 when the turn is handed over
    log(state, card.points ? 'buyPoints' : 'buy',
      { p: player.name, gem: card.bonus, pts: card.points, tier: card.tier });
    return endTurn(state);
  }

  /* ------------------------------------------------------- turn resolution */

  function eligibleNobles(state, player) {
    return state.nobles.filter(function (noble) {
      return Object.keys(noble.req).every(function (color) {
        return (player.bonuses[color] || 0) >= noble.req[color];
      });
    });
  }

  function endTurn(state) {
    var player = currentPlayer(state);

    var nobles = eligibleNobles(state, player);
    if (nobles.length === 1) {
      awardNoble(state, nobles[0].id);
    } else if (nobles.length > 1) {
      state.pendingNobles = nobles.map(function (n) { return n.id; });
      state.phase = 'noble';
      return { ok: true, needs: 'noble' };
    }

    return afterNobles(state);
  }

  function awardNoble(state, nobleId) {
    var player = currentPlayer(state);
    var index = -1;
    state.nobles.forEach(function (n, i) { if (n.id === nobleId) index = i; });
    if (index < 0) return false;
    var noble = state.nobles.splice(index, 1)[0];
    player.nobles.push(noble);
    player.points += noble.points;
    log(state, 'noble', { p: player.name, noble: noble.id, pts: noble.points });
    return true;
  }

  function chooseNoble(state, nobleId) {
    if (state.phase !== 'noble') return { ok: false, error: 'err.noNoble' };
    if (state.pendingNobles.indexOf(nobleId) < 0) return { ok: false, error: 'err.nobleIneligible' };
    awardNoble(state, nobleId);
    state.pendingNobles = [];
    state.phase = 'play';
    return afterNobles(state);
  }

  function afterNobles(state) {
    var player = currentPlayer(state);
    if (countTokens(player.tokens) > D.MAX_TOKENS) {
      state.phase = 'discard';
      return { ok: true, needs: 'discard' };
    }
    return advance(state);
  }

  function discardTokens(state, pile) {
    if (state.phase !== 'discard') return { ok: false, error: 'err.nothingToReturn' };
    var player = currentPlayer(state);
    var total = countTokens(player.tokens);
    var giving = countTokens(pile);
    if (total - giving !== D.MAX_TOKENS) {
      return { ok: false, error: 'err.returnExactly', params: { n: total - D.MAX_TOKENS } };
    }
    var bad = Object.keys(pile).some(function (c) { return pile[c] > (player.tokens[c] || 0); });
    if (bad) return { ok: false, error: 'err.notEnoughHeld' };

    Object.keys(pile).forEach(function (c) {
      player.tokens[c] -= pile[c];
      state.tokens[c] += pile[c];
    });
    log(state, 'discard', { p: player.name, n: giving });
    state.phase = 'play';
    return advance(state);
  }

  function advance(state) {
    var player = currentPlayer(state);
    state.noBuyStreak++;

    if (!state.finalRound && player.points >= D.WINNING_POINTS) {
      state.finalRound = true;
      state.triggeredBy = state.current;
      log(state, 'finalRound', { p: player.name, target: D.WINNING_POINTS });
    }

    state.turnCount++;

    // Safety valve: if nobody can buy anything for a very long stretch the
    // position is dead (everyone at the token limit with nothing affordable).
    // Rank on points rather than looping forever.
    if (state.noBuyStreak >= state.players.length * 8) {
      state.stalemate = true;
      log(state, 'stalemate', {});
      return finish(state);
    }

    var next = (state.current + 1) % state.players.length;

    // Reaching the target does not end the game on the spot: the round is
    // played out so every player has had the same number of turns. That is
    // exactly when the turn would return to the first seat.
    if (state.finalRound && next === 0) {
      return finish(state);
    }

    state.current = next;
    if (next === 0) state.round++;
    state.phase = 'play';
    return { ok: true, needs: null };
  }

  function finish(state) {
    state.phase = 'gameover';
    var ranked = state.players.slice().sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.cards.length - b.cards.length;   // fewer cards wins ties
    });
    state.winner = ranked[0].id;
    state.ranking = ranked.map(function (p) { return p.id; });
    log(state, 'win', { p: ranked[0].name, pts: ranked[0].points });
    return { ok: true, needs: 'gameover' };
  }

  /* --------------------------------------------------- derived information */

  function allVisibleCards(state) {
    var cards = [];
    [1, 2, 3].forEach(function (tier) {
      state.board[tier].forEach(function (card) { if (card) cards.push(card); });
    });
    return cards;
  }

  /* Every action except the fallback pass. */
  function realActions(state) {
    var player = currentPlayer(state);
    var actions = [];

    allVisibleCards(state).forEach(function (card) {
      if (canAfford(player, card)) actions.push({ type: 'buy', cardId: card.id, card: card, from: 'board' });
    });
    player.reserved.forEach(function (card) {
      if (canAfford(player, card)) actions.push({ type: 'buy', cardId: card.id, card: card, from: 'reserve' });
    });
    if (player.reserved.length < D.MAX_RESERVED) {
      allVisibleCards(state).forEach(function (card) {
        actions.push({ type: 'reserve', cardId: card.id, card: card });
      });
      [1, 2, 3].forEach(function (tier) {
        if (state.decks[tier].length) actions.push({ type: 'reserveDeck', tier: tier });
      });
    }
    legalTokenPicks(state).forEach(function (colors) {
      actions.push({ type: 'take', colors: colors });
    });
    return actions;
  }

  function hasRealAction(state) {
    return realActions(state).length > 0;
  }

  function legalActions(state) {
    var actions = realActions(state);
    if (!actions.length) actions.push({ type: 'pass' });
    return actions;
  }

  function applyAction(state, action) {
    switch (action.type) {
      case 'take': return takeTokens(state, action.colors);
      case 'buy': return buyCard(state, action.cardId);
      case 'reserve': return reserveCard(state, action.cardId);
      case 'reserveDeck': return reserveFromDeck(state, action.tier);
      case 'pass': return passTurn(state);
      default: return { ok: false, error: 'err.generic' };
    }
  }

  global.SplendorEngine = {
    createGame: createGame,
    currentPlayer: currentPlayer,
    takeTokens: takeTokens,
    reserveCard: reserveCard,
    reserveFromDeck: reserveFromDeck,
    buyCard: buyCard,
    discardTokens: discardTokens,
    passTurn: passTurn,
    hasRealAction: hasRealAction,
    chooseNoble: chooseNoble,
    eligibleNobles: eligibleNobles,
    legalActions: legalActions,
    legalTokenPicks: legalTokenPicks,
    applyAction: applyAction,
    validateTokenPick: validateTokenPick,
    canAfford: canAfford,
    paymentFor: paymentFor,
    missingFor: missingFor,
    countTokens: countTokens,
    allVisibleCards: allVisibleCards,
    findBoardCard: findBoardCard,
    clone: clone,
    mulberry32: mulberry32
  };
})(typeof window !== 'undefined' ? window : globalThis);
