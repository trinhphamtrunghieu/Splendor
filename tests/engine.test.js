/* Splendor — rules tests. No dependencies: run with `node tests/engine.test.js`.
 * The browser modules attach to `window`, so we provide one. */
'use strict';

global.window = global;
require('../assets/js/data.js');
require('../assets/js/engine.js');
require('../assets/js/ai.js');

var D = window.SplendorData;
var E = window.SplendorEngine;
var AI = window.SplendorAI;

var passed = 0;
var failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + err.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function eq(actual, expected, message) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) throw new Error((message || 'mismatch') + ': got ' + a + ', want ' + b);
}

function game(playerCount, types) {
  var players = [];
  for (var i = 0; i < (playerCount || 2); i++) {
    players.push({ name: 'P' + i, type: (types && types[i]) || 'human', difficulty: 'normal' });
  }
  return E.createGame({ players: players, seed: 12345 });
}

console.log('\ndeck & setup');

check('deck has 40/30/20 development cards', function () {
  var decks = D.buildDeck();
  eq([decks[1].length, decks[2].length, decks[3].length], [40, 30, 20]);
});

check('every tier is balanced across the five bonus colours', function () {
  var decks = D.buildDeck();
  [1, 2, 3].forEach(function (tier) {
    var perColor = {};
    decks[tier].forEach(function (card) { perColor[card.bonus] = (perColor[card.bonus] || 0) + 1; });
    D.COLORS.forEach(function (color) {
      assert(perColor[color] === decks[tier].length / 5, 'tier ' + tier + ' ' + color + ': ' + perColor[color]);
    });
  });
});

check('card ids are unique', function () {
  var decks = D.buildDeck();
  var seen = {};
  [1, 2, 3].forEach(function (tier) {
    decks[tier].forEach(function (card) {
      assert(!seen[card.id], 'duplicate id ' + card.id);
      seen[card.id] = true;
    });
  });
});

check('point spread matches the published game', function () {
  var decks = D.buildDeck();
  function spread(tier) {
    var counts = {};
    decks[tier].forEach(function (c) { counts[c.points] = (counts[c.points] || 0) + 1; });
    return counts;
  }
  eq(spread(1), { 0: 35, 1: 5 }, 'tier 1');
  eq(spread(2), { 1: 10, 2: 15, 3: 5 }, 'tier 2');
  eq(spread(3), { 3: 5, 4: 10, 5: 5 }, 'tier 3');
});

check('ten noble tiles, 3 points each', function () {
  eq(D.NOBLES.length, 10);
  D.NOBLES.forEach(function (n) {
    eq(n.points, 3, 'noble ' + n.id);
    var total = Object.keys(n.req).reduce(function (s, k) { return s + n.req[k]; }, 0);
    assert(total === 9 || total === 8, 'noble ' + n.id + ' requires ' + total);
  });
});

check('token pool and nobles scale with the player count', function () {
  [[2, 4], [3, 5], [4, 7]].forEach(function (pair) {
    var state = game(pair[0]);
    D.COLORS.forEach(function (color) { eq(state.tokens[color], pair[1], pair[0] + 'p ' + color); });
    eq(state.tokens.gold, 5, 'gold');
    eq(state.nobles.length, pair[0] + 1, pair[0] + 'p nobles');
  });
});

check('four cards are face up in every tier', function () {
  var state = game(2);
  [1, 2, 3].forEach(function (tier) {
    eq(state.board[tier].length, 4);
    state.board[tier].forEach(function (card) { assert(card && card.tier === tier, 'tier ' + tier); });
  });
  eq(state.decks[1].length, 36);
  eq(state.decks[2].length, 26);
  eq(state.decks[3].length, 16);
});

console.log('\ntaking gems');

check('three different gems is legal', function () {
  var state = game(2);
  var result = E.takeTokens(state, ['white', 'blue', 'green']);
  assert(result.ok, result.error);
  var player = state.players[0];
  eq([player.tokens.white, player.tokens.blue, player.tokens.green], [1, 1, 1]);
  eq(state.tokens.white, 3);
  eq(state.current, 1, 'turn passes');
});

check('two of the same colour needs four in the pile', function () {
  var state = game(2);                       // 2 players start with 4 of each
  assert(E.takeTokens(state, ['red', 'red']).ok, 'pair with 4 left should pass');
  eq(state.tokens.red, 2);
  var second = E.takeTokens(state, ['red', 'red']);
  assert(!second.ok, 'pair with 2 left must fail');
  eq(second.error, 'err.pairNeedsFour');
});

check('mixed or oversized picks are rejected', function () {
  var state = game(2);
  eq(E.takeTokens(state, ['white', 'white', 'blue']).error, 'err.mixInvalid');
  eq(E.takeTokens(state, ['white', 'blue', 'green', 'red']).error, 'err.maxThree');
  eq(E.takeTokens(state, ['gold']).error, 'err.goldReserve');
  eq(E.takeTokens(state, ['white', 'blue']).error, 'err.threeDifferent');
  eq(state.current, 0, 'illegal picks do not end the turn');
});

check('fewer than three gems is legal once the bank runs dry', function () {
  var state = game(2);
  D.COLORS.forEach(function (c) { state.tokens[c] = 0; });
  state.tokens.white = 1;
  state.tokens.blue = 1;
  assert(E.takeTokens(state, ['white', 'blue']).ok, 'two colours left');
});

check('a sold-out gem cannot be taken', function () {
  var state = game(2);
  state.tokens.green = 0;
  eq(E.takeTokens(state, ['white', 'blue', 'green']).error, 'err.soldOut');
});

console.log('\nreserving');

check('reserving takes a gold and refills the slot', function () {
  var state = game(2);
  var card = state.board[1][0];
  assert(E.reserveCard(state, card.id).ok);
  var player = state.players[0];
  eq(player.reserved.length, 1);
  eq(player.reserved[0].id, card.id);
  eq(player.tokens.gold, 1);
  eq(state.tokens.gold, 4);
  assert(state.board[1][0] && state.board[1][0].id !== card.id, 'slot refilled');
});

check('a fourth reservation is refused', function () {
  var state = game(2);
  for (var i = 0; i < 3; i++) {
    state.current = 0;
    assert(E.reserveCard(state, state.board[1][i].id).ok, 'reserve ' + i);
  }
  state.current = 0;
  eq(E.reserveCard(state, state.board[1][3].id).error, 'err.reserveFull');
});

check('reserving from the deck draws the hidden top card', function () {
  var state = game(2);
  var top = state.decks[2][state.decks[2].length - 1];
  assert(E.reserveFromDeck(state, 2).ok);
  eq(state.players[0].reserved[0].id, top.id);
  eq(state.decks[2].length, 25);
});

check('reserving with no gold left still works', function () {
  var state = game(2);
  state.tokens.gold = 0;
  assert(E.reserveCard(state, state.board[1][0].id).ok);
  eq(state.players[0].tokens.gold, 0);
});

console.log('\nbuying');

check('gems are spent and returned to the bank', function () {
  var state = game(2);
  var card = { id: 'x1', tier: 1, bonus: 'red', points: 0, cost: { white: 2, blue: 1 } };
  state.board[1][0] = card;
  var player = state.players[0];
  player.tokens.white = 2;
  player.tokens.blue = 1;
  assert(E.buyCard(state, 'x1').ok);
  eq([player.tokens.white, player.tokens.blue], [0, 0]);
  eq(state.tokens.white, 6, 'bank got the gems back');
  eq(player.bonuses.red, 1, 'bonus gained');
  eq(player.cards.length, 1);
});

check('card bonuses act as a permanent discount', function () {
  var state = game(2);
  state.board[1][0] = { id: 'x2', tier: 1, bonus: 'blue', points: 0, cost: { white: 3 } };
  var player = state.players[0];
  player.bonuses.white = 2;
  player.tokens.white = 1;
  assert(E.buyCard(state, 'x2').ok, 'discount should cover 2 of the 3');
  eq(player.tokens.white, 0);
});

check('gold substitutes for any missing gem', function () {
  var state = game(2);
  state.board[1][0] = { id: 'x3', tier: 1, bonus: 'green', points: 0, cost: { black: 2, red: 1 } };
  var player = state.players[0];
  state.tokens.gold -= 2;                    // the two golds came from the bank
  player.tokens.gold = 2;
  player.tokens.red = 1;
  var payment = E.paymentFor(player, state.board[1][0]);
  eq(payment.gold, 2);
  assert(E.buyCard(state, 'x3').ok);
  eq(player.tokens.gold, 0);
  eq(state.tokens.gold, 5, 'gold returns to the bank');
});

check('an unaffordable card is refused', function () {
  var state = game(2);
  state.board[1][0] = { id: 'x4', tier: 1, bonus: 'red', points: 0, cost: { white: 4 } };
  state.players[0].tokens.white = 3;
  eq(E.buyCard(state, 'x4').error, 'err.cannotPay');
  eq(state.players[0].cards.length, 0);
});

check('a reserved card can be bought later', function () {
  var state = game(2);
  var card = { id: 'x5', tier: 1, bonus: 'black', points: 1, cost: { white: 1 } };
  state.players[0].reserved.push(card);
  state.players[0].tokens.white = 1;
  assert(E.buyCard(state, 'x5').ok);
  eq(state.players[0].reserved.length, 0);
  eq(state.players[0].points, 1);
});

console.log('\nend of turn');

check('holding more than ten tokens forces a return', function () {
  var state = game(4);
  var player = state.players[0];
  D.COLORS.forEach(function (c) { player.tokens[c] = 2; });   // 10 already
  var result = E.takeTokens(state, ['white', 'blue', 'green']);
  eq(result.needs, 'discard');
  eq(state.phase, 'discard');
  eq(E.discardTokens(state, { white: 1 }).ok, false, 'must return the exact excess');
  assert(E.discardTokens(state, { white: 2, blue: 1 }).ok, 'returning 3 works');
  eq(E.countTokens(state.players[0].tokens), 10);
  eq(state.current, 1, 'turn passes after the discard');
});

check('a noble visits automatically when its requirement is met', function () {
  var state = game(2);
  state.nobles = [{ id: 'nx', points: 3, req: { red: 1 } }];
  state.board[1][0] = { id: 'x6', tier: 1, bonus: 'red', points: 0, cost: {} };
  assert(E.buyCard(state, 'x6').ok);
  eq(state.players[0].nobles.length, 1);
  eq(state.players[0].points, 3);
  eq(state.nobles.length, 0);
});

check('two eligible nobles pause the turn for a choice', function () {
  var state = game(2);
  state.nobles = [
    { id: 'na', points: 3, req: { red: 1 } },
    { id: 'nb', points: 3, req: { red: 1 } }
  ];
  state.board[1][0] = { id: 'x7', tier: 1, bonus: 'red', points: 0, cost: {} };
  var result = E.buyCard(state, 'x7');
  eq(result.needs, 'noble');
  eq(state.phase, 'noble');
  eq(E.chooseNoble(state, 'nc').ok, false, 'unknown noble refused');
  assert(E.chooseNoble(state, 'nb').ok);
  eq(state.players[0].nobles[0].id, 'nb');
  eq(state.nobles.length, 1, 'the other noble stays on the table');
  eq(state.current, 1);
});

check('nobles are free and cost no tokens', function () {
  var state = game(2);
  state.nobles = [{ id: 'ny', points: 3, req: { red: 1 } }];
  state.board[1][0] = { id: 'x8', tier: 1, bonus: 'red', points: 0, cost: {} };
  state.players[0].tokens.white = 3;
  E.buyCard(state, 'x8');
  eq(state.players[0].tokens.white, 3);
});

console.log('\nwinning');

check('reaching 15 points triggers one last round, not an instant win', function () {
  var state = game(3);
  state.players[0].points = 14;
  state.board[1][0] = { id: 'x9', tier: 1, bonus: 'red', points: 1, cost: {} };
  assert(E.buyCard(state, 'x9').ok);
  eq(state.players[0].points, 15);
  assert(state.finalRound, 'final round armed');
  eq(state.phase, 'play', 'game continues');
  eq(state.current, 1, 'the other players still get a turn');
  E.takeTokens(state, ['white', 'blue', 'green']);
  eq(state.phase, 'play');
  eq(state.current, 2);
  E.takeTokens(state, ['white', 'blue', 'green']);
  eq(state.phase, 'gameover', 'round completed, game ends');
  eq(state.winner, 0);
});

check('a rival can overtake during the final round', function () {
  var state = game(2);
  state.players[0].points = 15;
  state.players[1].points = 14;
  state.finalRound = true;
  state.triggeredBy = 0;
  state.current = 1;
  state.board[1][0] = { id: 'xa', tier: 1, bonus: 'red', points: 2, cost: {} };
  assert(E.buyCard(state, 'xa').ok);
  eq(state.phase, 'gameover');
  eq(state.winner, 1, 'higher score wins');
});

check('ties break towards fewer purchased cards', function () {
  var state = game(2);
  state.players[0].points = 15;
  state.players[0].cards = [1, 2, 3, 4, 5, 6, 7, 8];
  state.players[1].points = 15;
  state.players[1].cards = [1, 2, 3];
  state.finalRound = true;
  state.triggeredBy = 0;
  state.current = 1;
  E.takeTokens(state, ['white', 'blue', 'green']);
  eq(state.phase, 'gameover');
  eq(state.winner, 1);
  eq(state.ranking, [1, 0]);
});

check('a fully blocked player may pass, but only then', function () {
  var state = game(2);
  eq(E.passTurn(state).error, 'err.mustAct', 'passing is refused while moves exist');

  D.COLORS.forEach(function (c) { state.tokens[c] = 0; });   // bank drained
  state.tokens.gold = 0;
  var pricey = { id: 'xp', tier: 3, bonus: 'red', points: 5, cost: { white: 7 } };
  state.players[0].reserved = [pricey, pricey, pricey];      // no room to reserve
  [1, 2, 3].forEach(function (tier) {
    state.board[tier] = [pricey, pricey, pricey, pricey];    // nothing affordable
  });
  eq(E.legalActions(state), [{ type: 'pass' }]);
  assert(E.passTurn(state).ok, 'the blocked player can pass');
  eq(state.current, 1, 'the turn moves on');
});

console.log('\nderived helpers');

check('missingFor reports the gap and the gold cover', function () {
  var state = game(2);
  var card = { id: 'xb', tier: 2, bonus: 'red', points: 2, cost: { white: 3, blue: 2 } };
  var player = state.players[0];
  player.bonuses.white = 1;
  player.tokens.white = 1;
  player.tokens.gold = 1;
  var gap = E.missingFor(player, card);
  eq(gap.missing, { white: 1, blue: 2 });
  eq(gap.total, 3);
  eq(gap.coveredByGold, 1);
});

check('legalActions never offers an unaffordable purchase', function () {
  var state = game(3);
  state.players[0].tokens.white = 2;
  E.legalActions(state).forEach(function (action) {
    if (action.type === 'buy') assert(E.canAfford(state.players[0], action.card), 'offered ' + action.cardId);
  });
});

console.log('\nself-play (engine + AI invariants)');

check('200 bot games end cleanly with conserved tokens and points', function () {
  var sizes = [2, 3, 4];
  var difficulties = ['easy', 'normal', 'hard'];
  for (var g = 0; g < 200; g++) {
    var count = sizes[g % sizes.length];
    var players = [];
    for (var i = 0; i < count; i++) {
      players.push({ name: 'B' + i, type: 'ai', difficulty: difficulties[(g + i) % difficulties.length] });
    }
    var state = E.createGame({ players: players, seed: g * 7919 + 13 });
    var expected = D.TOKENS_BY_PLAYERS[count];
    var guard = 0;

    while (state.phase !== 'gameover') {
      assert(++guard < 3000, 'game ' + g + ' did not terminate');
      if (state.phase === 'noble') { E.chooseNoble(state, AI.chooseNoble(state)); continue; }
      if (state.phase === 'discard') {
        var discarded = AI.discard(state, AI.PROFILES[state.players[state.current].difficulty]);
        assert(discarded.ok, 'discard failed: ' + discarded.error);
        continue;
      }
      var action = AI.chooseAction(state, AI.PROFILES[state.players[state.current].difficulty]);
      assert(action, 'no legal action in game ' + g);
      var result = E.applyAction(state, action);
      assert(result.ok, 'illegal bot action in game ' + g + ': ' + result.error);

      var totals = {};
      D.ALL_TOKENS.forEach(function (c) { totals[c] = state.tokens[c]; });
      state.players.forEach(function (p) {
        D.ALL_TOKENS.forEach(function (c) {
          assert(p.tokens[c] >= 0, 'negative tokens');
          totals[c] += p.tokens[c];
        });
        assert(p.reserved.length <= D.MAX_RESERVED, 'too many reserved');
        if (state.phase !== 'discard') assert(E.countTokens(p.tokens) <= D.MAX_TOKENS, 'over the token limit');
        var points = p.cards.reduce(function (s, c) { return s + c.points; }, 0) + p.nobles.length * 3;
        assert(points === p.points, 'points drifted: ' + points + ' vs ' + p.points);
      });
      D.COLORS.forEach(function (c) { assert(totals[c] === expected, 'token leak in ' + c + ': ' + totals[c]); });
      assert(totals.gold === D.GOLD_COUNT, 'gold leak: ' + totals.gold);
    }
    assert(state.winner != null, 'no winner recorded');
    var winner = state.players[state.winner];
    state.players.forEach(function (p) {
      assert(p.points < winner.points ||
        (p.points === winner.points && p.cards.length >= winner.cards.length), 'wrong winner in game ' + g);
    });
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
