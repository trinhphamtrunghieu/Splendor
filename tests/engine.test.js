/* Splendor — rules tests. No dependencies: run with `node tests/engine.test.js`.
 * The browser modules attach to `window`, so we provide one. */
'use strict';

global.window = global;
require('../assets/js/data.js');
require('../assets/js/engine.js');
require('../assets/js/ai.js');
require('../assets/js/tutorial.js');
require('../assets/js/art.js');
require('../assets/js/mqtt-lite.js');
require('../assets/js/net.js');
var fetchArt = require('../tools/fetch-art.js');

var D = window.SplendorData;
var E = window.SplendorEngine;
var AI = window.SplendorAI;
var Tut = window.SplendorTutorial;
var Art = window.SplendorArt;
var M = window.MqttLite;
var Net = window.SplendorNet;

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

console.log('\nMQTT wire format');

check('remaining-length varints round-trip across every byte boundary', function () {
  [[0, 1], [1, 1], [127, 1], [128, 2], [16383, 2], [16384, 3], [2097151, 3], [2097152, 4]]
    .forEach(function (pair) {
      var encoded = M._codec.encodeLength(pair[0]);
      eq(encoded.length, pair[1], 'byte count for ' + pair[0]);
      var decoded = M._codec.decodeLength(Uint8Array.from([0].concat(encoded)), 1);
      eq(decoded.value, pair[0], 'decoded ' + pair[0]);
      eq(decoded.length, pair[1]);
    });
});

check('an incomplete varint reports "not yet", not a wrong answer', function () {
  eq(M._codec.decodeLength(Uint8Array.from([0x30, 0x80]), 1), null);
});

check('utf-8 survives the wire, including Vietnamese and emoji', function () {
  var text = 'Hiếu — Lượt của bạn 💎';
  eq(M._codec.fromUtf8(Uint8Array.from(M._codec.utf8(text))), text);
});

check('a string is length-prefixed with its byte count, not its character count', function () {
  var encoded = M._codec.encodeString('đá');      // 2 characters, 4 bytes
  eq([encoded[0], encoded[1]], [0, 4]);
  eq(encoded.length, 6);
});

check('the fixed header carries the type, flags and length', function () {
  var bytes = M._codec.packet(3, 1, [1, 2, 3]);   // PUBLISH, retain
  eq(bytes[0], 0x31);
  eq(bytes[1], 3);
  eq(bytes.length, 5);
});

check('topic filters match the way MQTT says they should', function () {
  assert(M.matches('a/b/c', 'a/b/c'), 'exact');
  assert(M.matches('a/+/c', 'a/b/c'), 'single level');
  assert(M.matches('a/#', 'a/b/c'), 'multi level');
  assert(M.matches('#', 'a/b'), 'bare hash');
  assert(!M.matches('a/+', 'a/b/c'), '+ is one level only');
  assert(!M.matches('a/b', 'a/b/c'), 'longer topic');
  assert(!M.matches('a/b/c', 'a/b'), 'shorter topic');
  assert(!M.matches('x/#', 'a/b'), 'different root');
});

console.log('\nonline rooms');

check('room codes avoid the characters people mistype', function () {
  for (var i = 0; i < 200; i++) {
    var code = Net.roomCode();
    eq(code.length, 5, 'length of ' + code);
    assert(!/[IO01]/.test(code), 'ambiguous character in ' + code);
    assert(Net.isValidCode(code), 'generated an invalid code: ' + code);
  }
});

check('codes are read leniently and validated strictly', function () {
  eq(Net.normaliseCode(' ab-c23 '), 'ABC23');
  eq(Net.normaliseCode('abc23xxxx'), 'ABC23');
  assert(Net.isValidCode('abc23'), 'lower case is fine');
  assert(!Net.isValidCode('ABC2'), 'too short');
  assert(!Net.isValidCode('ABCIO'), 'contains excluded letters');
  assert(!Net.isValidCode(''), 'empty');
});

check('topics are namespaced per room', function () {
  eq(Net.topic('ABC23', 'state'), 'splendor/v1/ABC23/state');
  eq(Net.topic('ABC23', 'view/p-1'), 'splendor/v1/ABC23/view/p-1');
});

check("a player's view hides what the rules say is secret", function () {
  var state = E.createGame({
    players: [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }],
    seed: 99
  });
  state.players[0].reserved.push(state.decks[3].pop());
  state.players[1].reserved.push(state.decks[2].pop());

  var view = Net.viewFor(state, 1);

  eq(view.decks[1].length, state.decks[1].length, 'the deck count stays visible');
  assert(view.decks[1].every(function (c) { return c === null; }), 'deck order must not leak');
  assert(view.decks[3].every(function (c) { return c === null; }), 'tier 3 deck must not leak');

  assert(view.players[1].reserved[0].cost, 'my own reserved card is mine to see');
  eq(view.players[0].reserved.length, 1, 'the count of a rival hand is public');
  eq(view.players[0].reserved[0], { hidden: true }, 'but not what it is');

  // everything Splendor plays face up must survive
  eq(view.tokens, state.tokens, 'bank');
  eq(view.board, state.board, 'cards on the table');
  eq(view.nobles, state.nobles, 'nobles');
  eq(view.players[0].bonuses, state.players[0].bonuses, 'rival discounts are public');
  eq(view.players[0].tokens, state.players[0].tokens, 'rival gems are public');
  eq(view.players[0].points, state.players[0].points, 'rival score is public');
});

check('redaction does not disturb the real game', function () {
  var state = E.createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 5 });
  var before = JSON.stringify(state);
  Net.viewFor(state, 0);
  Net.viewFor(state, 1);
  eq(JSON.stringify(state), before, 'viewFor must not mutate the state it redacts');
});

check('every action the network can relay is understood by the engine', function () {
  var state = E.createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 11 });
  eq(E.applyAction(state, { type: 'take', colors: ['white', 'blue', 'green'] }).ok, true);
  state.current = 0;
  var card = state.board[1][0];
  eq(E.applyAction(state, { type: 'reserve', cardId: card.id }).ok, true);
  state.current = 0;
  eq(E.applyAction(state, { type: 'reserveDeck', tier: 2 }).ok, true);
  state.current = 0;
  eq(E.applyAction(state, { type: 'nonsense' }).error, 'err.generic', 'unknown types are refused');
  // the two phase actions the protocol also has to carry
  eq(E.applyAction(state, { type: 'discard', pile: { white: 1 } }).error, 'err.nothingToReturn');
  eq(E.applyAction(state, { type: 'noble', nobleId: 'n1' }).error, 'err.noNoble');
});

check('the default brokers are all wss, or an https page could not use them', function () {
  assert(Net.BROKERS.length >= 1, 'at least one broker');
  Net.BROKERS.forEach(function (broker) {
    assert(/^wss:\/\//.test(broker.url), broker.id + ' must be wss: ' + broker.url);
    assert(broker.label && broker.id, 'broker needs a label and id');
  });
  eq(Net.MAX_SEATS, 4, 'Splendor seats at most four');
});

console.log('\nartwork');

check('every gem colour has a drawn stone in the sprite', function () {
  var sprite = require('fs').readFileSync(__dirname + '/../assets/js/art.js', 'utf8');
  D.ALL_TOKENS.forEach(function (color) {
    assert(sprite.indexOf('id="spg-' + color + '"') > 0, 'no symbol for ' + color);
    var markup = Art.gemIcon(color, 'gem-ico');
    assert(markup.indexOf('#spg-' + color) > 0, 'icon does not reference the symbol: ' + color);
    assert(markup.indexOf('<svg') === 0, 'icon should be inline svg');
  });
});

check('small gems stay drawn even when photographs are installed', function () {
  window.SplendorImages = { gems: { red: 'assets/img/gems/red.jpg' }, cards: {}, nobles: {} };
  try {
    assert(Art.gemIcon('red').indexOf('<svg') === 0, 'icons must not switch to photos');
    assert(Art.gem('red').indexOf('<img') === 0, 'token-size gems should use the photo');
    assert(Art.gem('blue').indexOf('<svg') === 0, 'a gem with no photo falls back to the drawing');
    assert(Art.cardArt('red').indexOf('card-photo') > 0, 'card art uses the photo when present');
    assert(Art.cardArt('blue').indexOf('card-art') > 0, 'card art falls back to the drawing');
    assert(Art.hasPhotos(), 'hasPhotos should see the installed file');
  } finally {
    window.SplendorImages = { gems: {}, cards: {}, nobles: {} };
  }
});

check('an empty manifest means everything is drawn', function () {
  assert(!Art.hasPhotos());
  assert(Art.nobleImage('n1') === null, 'no portrait installed');
  D.ALL_TOKENS.forEach(function (color) {
    assert(Art.gem(color).indexOf('<svg') === 0, color + ' should be drawn');
  });
});

console.log('\nimage fetch tool');

check('only redistributable licences are accepted', function () {
  ['Public domain', 'PD-old-100', 'CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'GFDL',
   'cc by-sa 4.0', 'Public Domain Mark'].forEach(function (ok) {
    assert(fetchArt.isFreeLicense(ok), 'should accept: ' + ok);
  });
  ['Fair use', 'All rights reserved', 'CC BY-NC 4.0', 'CC BY-ND 4.0',
   'CC BY-NC-SA 3.0', 'Non-free', '', null, undefined, 'Copyrighted free use?'].forEach(function (bad) {
    assert(!fetchArt.isFreeLicense(bad), 'should refuse: ' + bad);
  });
});

check('credit text is stripped of the API markup', function () {
  eq(fetchArt.stripHtml('<a href="/wiki/x" title="y">Hans  Holbein</a>'), 'Hans Holbein');
  eq(fetchArt.stripHtml('Jan &amp; Hubert &quot;van Eyck&quot;'), 'Jan & Hubert "van Eyck"');
  eq(fetchArt.stripHtml(null), '');
});

check('file extensions come from the download url', function () {
  eq(fetchArt.extFromUrl('https://x/y/Portrait.JPEG'), 'jpg');
  eq(fetchArt.extFromUrl('https://x/y/a.png?width=500'), 'png');
  eq(fetchArt.extFromUrl('https://x/y/a.webp'), 'webp');
  eq(fetchArt.extFromUrl('https://x/y/no-extension'), 'jpg');
});

check('the generated manifest is valid javascript with the right shape', function () {
  var code = fetchArt.renderManifest({
    gems: { white: 'assets/img/gems/white.jpg' },
    cards: {},
    nobles: { n1: 'assets/img/nobles/n1.jpg' }
  });
  var fake = {};
  new Function('window', code)(fake);
  eq(fake.SplendorImages.gems, { white: 'assets/img/gems/white.jpg' });
  eq(fake.SplendorImages.cards, {});
  eq(fake.SplendorImages.nobles, { n1: 'assets/img/nobles/n1.jpg' });
  eq(fake.SplendorImages.version, 1);
});

check('the committed manifest is empty, so the repository ships drawings only', function () {
  var code = require('fs').readFileSync(__dirname + '/../assets/img/manifest.js', 'utf8');
  var fake = {};
  new Function('window', code)(fake);
  ['gems', 'cards', 'nobles'].forEach(function (group) {
    eq(Object.keys(fake.SplendorImages[group]).length, 0, group + ' should be empty');
  });
});

check('attribution keeps the credits and the do-not-add warning', function () {
  var md = fetchArt.renderAttribution([
    { file: 'assets/img/nobles/n1.jpg', subject: 'Mary Stuart', sourceLabel: 'File:Mary.jpg',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mary.jpg', author: 'Anon', license: 'Public domain' }
  ]);
  assert(md.indexOf('assets/img/nobles/n1.jpg') > 0, 'lists the file');
  assert(md.indexOf('Public domain') > 0, 'records the licence');
  assert(md.indexOf('Space Cowboys') > 0, 'keeps the warning about the retail art');
});

check('the fetch list matches the game data exactly', function () {
  eq(Object.keys(fetchArt.NOBLES).sort(), D.NOBLES.map(function (n) { return n.id; }).sort(),
    'a noble without a portrait source, or a source for a noble that does not exist');
  eq(Object.keys(fetchArt.GEM_QUERIES).sort(), D.ALL_TOKENS.slice().sort(),
    'every token colour needs a photo query');
  Object.keys(fetchArt.NOBLES).forEach(function (id) {
    var entry = fetchArt.NOBLES[id];
    assert(entry.titles && entry.titles.length, id + ' has no candidate article');
    assert(D.NOBLE_NAMES[id], id + ' is missing from NOBLE_NAMES');
  });
});

check('argument parsing defaults to fetching both groups', function () {
  eq(fetchArt.parseArgs([]), { nobles: true, gems: true, dryRun: false, help: false });
  eq(fetchArt.parseArgs(['--nobles']), { nobles: true, gems: false, dryRun: false, help: false });
  eq(fetchArt.parseArgs(['--gems']), { nobles: false, gems: true, dryRun: false, help: false });
  eq(fetchArt.parseArgs(['--dry-run']).dryRun, true);
});

console.log('\ntutorial walkthrough');

/* The tutorial tells the player exactly which gems to take and which cards to
   buy and reserve. If the card data ever shifts, these assertions fail instead
   of the instructions quietly becoming wrong. */

check('the scripted board puts the named cards where the coach marks point', function () {
  var state = Tut.buildState('Learner');
  eq(state.players.length, 1, 'the tutorial is solo, so nothing moves unprompted');
  eq(state.board[1][0].id, Tut.PLAN.buyCardId, 'buy target on the tier 1 slot');
  eq(state.board[3][0].id, Tut.PLAN.reserveCardId, 'reserve target on the tier 3 slot');
});

check('placing a card keeps every tier at full size with no duplicates', function () {
  var state = Tut.buildState('Learner');
  var seen = {};
  [1, 2, 3].forEach(function (tier) {
    eq(state.board[tier].length, 4, 'tier ' + tier + ' board');
    state.board[tier].concat(state.decks[tier]).forEach(function (card) {
      assert(card, 'tier ' + tier + ' has a hole');
      assert(!seen[card.id], 'duplicate card ' + card.id);
      seen[card.id] = true;
      eq(card.tier, tier, 'card ' + card.id + ' in the wrong tier');
    });
  });
  eq(Object.keys(seen).length, 90, 'all 90 development cards still present');
});

check('the prescribed sequence of moves is legal, in order', function () {
  var state = Tut.buildState('Learner');

  var first = E.takeTokens(state, Tut.PLAN.firstTake);
  assert(first.ok, 'step "take 3 different": ' + first.error);

  var second = E.takeTokens(state, Tut.PLAN.secondTake);
  assert(second.ok, 'step "take 2 of one colour": ' + second.error);

  var target = state.board[1][0];
  assert(E.canAfford(state.players[0], target),
    'the buy step must be affordable after the two prescribed takes');
  var bought = E.buyCard(state, Tut.PLAN.buyCardId);
  assert(bought.ok, 'step "buy": ' + bought.error);

  var reserved = E.reserveCard(state, Tut.PLAN.reserveCardId);
  assert(reserved.ok, 'step "reserve": ' + reserved.error);
  eq(state.players[0].tokens.gold, 1, 'reserving teaches the gold reward');
  assert(!E.canAfford(state.players[0], state.players[0].reserved[0]),
    'the reserve target should be out of reach, which is the point of the step');
});

check('the pair the tutorial asks for is legal in a solo bank', function () {
  var state = Tut.buildState('Learner');
  var color = Tut.PLAN.secondTake[0];
  assert(state.tokens[color] >= 4, 'two of a colour needs 4 in the pile, has ' + state.tokens[color]);
  eq(Tut.PLAN.secondTake.length, 2);
  eq(Tut.PLAN.secondTake[0], Tut.PLAN.secondTake[1], 'the pair must be one colour');
  eq(Tut.PLAN.firstTake.length, 3);
  eq(new Set(Tut.PLAN.firstTake).size, 3, 'the first take must be three distinct colours');
});

check('every step either waits for a move or advances on a button', function () {
  var interactive = 0;
  Tut.STEPS.forEach(function (step, i) {
    assert(step.key, 'step ' + i + ' has no key');
    if (step.check) {
      interactive++;
      assert(typeof step.check === 'function', 'step ' + step.key + ' check');
    }
    if (step.target) {
      var kind = typeof step.target;
      assert(kind === 'string' || kind === 'function', 'step ' + step.key + ' target');
    }
  });
  assert(interactive >= 4, 'a walkthrough that never asks the player to act is just text');
  assert(Tut.STEPS[Tut.STEPS.length - 1].final, 'the last step should offer a real game');
});

console.log('\nself-play (engine + AI invariants)');

/* Each game is a few thousand evaluated positions, so the default stays small
   enough for CI. Raise it for a deeper soak: SPLENDOR_GAMES=500 node tests/... */
var SELF_PLAY_GAMES = Number(process.env.SPLENDOR_GAMES || 60);

check(SELF_PLAY_GAMES + ' bot games end cleanly with conserved tokens and points', function () {
  var sizes = [2, 3, 4];
  var difficulties = ['easy', 'normal', 'hard'];
  for (var g = 0; g < SELF_PLAY_GAMES; g++) {
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
