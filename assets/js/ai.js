/* Splendor — computer opponents.
 *
 * One-ply search: every legal action is applied to a cloned state and the
 * resulting position is scored with a hand-tuned evaluation. Difficulty is
 * expressed as evaluation noise plus how far ahead the bot is allowed to plan.
 */
(function (global) {
  'use strict';

  var D = global.SplendorData;
  var E = global.SplendorEngine;
  var COLORS = D.COLORS;

  var PROFILES = {
    easy:   { noise: 7.0, blunder: 0.28, nobleWeight: 2.0, denyWeight: 0.0, horizon: 0 },
    normal: { noise: 2.2, blunder: 0.06, nobleWeight: 5.0, denyWeight: 0.4, horizon: 1 },
    hard:   { noise: 0.5, blunder: 0.0,  nobleWeight: 8.0, denyWeight: 1.1, horizon: 1 }
  };

  /* How badly each gem colour is wanted, based on the cards still in sight. */
  function colorDemand(state, player) {
    var demand = {};
    COLORS.forEach(function (c) { demand[c] = 0; });

    E.allVisibleCards(state).concat(player.reserved).forEach(function (card) {
      var weight = 1 + card.points * 0.5 + (4 - card.tier) * 0.25;
      COLORS.forEach(function (color) {
        var need = (card.cost[color] || 0) - (player.bonuses[color] || 0);
        if (need > 0) demand[color] += need * weight;
      });
    });
    state.nobles.forEach(function (noble) {
      COLORS.forEach(function (color) {
        var need = (noble.req[color] || 0) - (player.bonuses[color] || 0);
        if (need > 0) demand[color] += need * 2.5;
      });
    });
    return demand;
  }

  function nobleProgress(state, player, weight) {
    var score = 0;
    state.nobles.forEach(function (noble) {
      var required = 0;
      var owned = 0;
      var complete = true;
      Object.keys(noble.req).forEach(function (color) {
        required += noble.req[color];
        var has = Math.min(player.bonuses[color] || 0, noble.req[color]);
        owned += has;
        if (has < noble.req[color]) complete = false;
      });
      if (complete) return;                       // already counted as points
      var ratio = required ? owned / required : 0;
      score += weight * ratio * ratio;
    });
    return score;
  }

  function evaluate(state, playerId, profile) {
    var player = state.players[playerId];
    var score = player.points * 12;

    var demand = colorDemand(state, player);
    var totalDemand = COLORS.reduce(function (s, c) { return s + demand[c]; }, 0) || 1;

    // Permanent bonuses: a discount every single turn, so worth far more than
    // the loose tokens spent to get them. Undervaluing this makes a bot hoard.
    COLORS.forEach(function (color) {
      var owned = player.bonuses[color] || 0;
      score += owned * 6;
      score += owned * (demand[color] / totalDemand) * 7;
      if (owned > 4) score -= (owned - 4) * 1.2;   // diminishing returns
    });

    // Tokens: useful, but hoarding is not a plan.
    var tokenTotal = 0;
    COLORS.forEach(function (color) {
      var held = player.tokens[color] || 0;
      tokenTotal += held;
      score += held * (0.35 + (demand[color] / totalDemand) * 1.1);
    });
    score += (player.tokens.gold || 0) * 1.2;
    tokenTotal += player.tokens.gold || 0;
    if (tokenTotal > D.MAX_TOKENS) score -= (tokenTotal - D.MAX_TOKENS) * 2.5;

    score += nobleProgress(state, player, profile.nobleWeight);
    score += player.cards.length * 1.5;
    score += player.reserved.length * 0.3;

    // Purchasing power right now: how much of the table is within reach.
    if (profile.horizon > 0) {
      var reach = 0;
      E.allVisibleCards(state).concat(player.reserved).forEach(function (card) {
        var gap = E.missingFor(player, card);
        var shortfall = Math.max(0, gap.total - gap.coveredByGold);
        if (shortfall === 0) reach += 1.5 + card.points;
        else if (shortfall <= 2) reach += (1.2 + card.points * 0.5) / shortfall;
      });
      score += reach * 0.8;
    }
    return score;
  }

  /* Penalty for handing the best rival an easy, high-value purchase. */
  function opponentThreat(state, playerId, weight) {
    if (!weight) return 0;
    var worst = 0;
    state.players.forEach(function (rival) {
      if (rival.id === playerId) return;
      E.allVisibleCards(state).forEach(function (card) {
        if (!card.points) return;
        if (E.canAfford(rival, card)) worst = Math.max(worst, card.points);
      });
    });
    return worst * weight;
  }

  /* Compact signature of a player's position, to spot no-op turns. */
  function fingerprint(player) {
    return D.ALL_TOKENS.map(function (c) { return player.tokens[c] || 0; }).join(',') + '|' +
      COLORS.map(function (c) { return player.bonuses[c]; }).join(',') + '|' +
      player.points + '|' + player.cards.length + '|' +
      player.reserved.map(function (c) { return c.id; }).sort().join('.');
  }

  function describe(action) {
    if (action.type === 'take') return 'take ' + action.colors.join('+');
    if (action.type === 'buy') return 'buy ' + action.cardId;
    if (action.type === 'reserve') return 'reserve ' + action.cardId;
    return 'reserve deck ' + action.tier;
  }

  function chooseAction(state, profile) {
    profile = profile || PROFILES.normal;
    var playerId = state.current;
    var actions = E.legalActions(state);
    if (!actions.length) return null;

    if (profile.blunder && Math.random() < profile.blunder) {
      return actions[Math.floor(Math.random() * actions.length)];
    }

    var before = fingerprint(state.players[playerId]);
    var best = null;
    var bestScore = -Infinity;

    actions.forEach(function (action) {
      var probe = E.clone(state);
      var result = E.applyAction(probe, action);
      if (!result.ok) return;

      // Resolve any forced follow-up so the evaluated position is legal.
      if (probe.phase === 'noble') E.chooseNoble(probe, probe.pendingNobles[0]);
      if (probe.phase === 'discard') discard(probe, profile);

      var score = evaluate(probe, playerId, profile) - opponentThreat(probe, playerId, profile.denyWeight);

      // Small nudges the evaluation cannot see.
      if (action.type === 'buy') score += 2.5 + action.card.points;
      if (action.type === 'reserveDeck') score -= 1.5;
      if (action.type === 'reserve' && action.card.points === 0) score -= 1.0;

      // Never burn a turn on a move that leaves us exactly where we were
      // (taking gems only to hand them straight back at the token limit).
      if (fingerprint(probe.players[playerId]) === before) score -= 100;

      score += (Math.random() - 0.5) * 2 * profile.noise;

      if (score > bestScore) { bestScore = score; best = action; }
    });

    return best || actions[0];
  }

  /* Return the tokens we want least, keeping gold and in-demand gems. */
  function discard(state, profile) {
    profile = profile || PROFILES.normal;
    var player = E.currentPlayer(state);
    var demand = colorDemand(state, player);
    var over = E.countTokens(player.tokens) - D.MAX_TOKENS;
    if (over <= 0) return { ok: true };

    var pool = [];
    COLORS.forEach(function (color) {
      for (var i = 0; i < (player.tokens[color] || 0); i++) {
        pool.push({ color: color, value: demand[color] + i * 0.01 });
      }
    });
    pool.sort(function (a, b) { return a.value - b.value; });

    var give = {};
    for (var i = 0; i < over && i < pool.length; i++) {
      give[pool[i].color] = (give[pool[i].color] || 0) + 1;
    }
    return E.discardTokens(state, give);
  }

  function chooseNoble(state) {
    return state.pendingNobles[0];
  }

  global.SplendorAI = {
    PROFILES: PROFILES,
    chooseAction: chooseAction,
    chooseNoble: chooseNoble,
    discard: discard,
    evaluate: evaluate,
    describe: describe
  };
})(typeof window !== 'undefined' ? window : globalThis);
