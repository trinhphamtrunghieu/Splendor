/* Splendor — static card data & constants
 *
 * The 90 development cards of Splendor are rotationally symmetric over the
 * five gem colours: every tier is built from a handful of cost "patterns",
 * each of which appears once per bonus colour. Encoding the deck that way
 * keeps the data short and guarantees the colour balance of the real game.
 *
 *   tier 1 : 8 patterns x 5 colours = 40 cards
 *   tier 2 : 6 patterns x 5 colours = 30 cards
 *   tier 3 : 4 patterns x 5 colours = 20 cards
 *
 * `own`  = cost paid in the card's own bonus colour
 * `rel`  = cost in the colours at offset +1..+4 from the bonus colour,
 *          following the cycle white -> blue -> green -> red -> black.
 */
(function (global) {
  'use strict';

  var COLORS = ['white', 'blue', 'green', 'red', 'black'];
  var ALL_TOKENS = COLORS.concat(['gold']);

  var PATTERNS = {
    1: [
      { own: 0, rel: [1, 1, 1, 1], pts: 0 },
      { own: 0, rel: [1, 2, 1, 1], pts: 0 },
      { own: 0, rel: [2, 2, 0, 1], pts: 0 },
      { own: 1, rel: [0, 0, 1, 3], pts: 0 },
      { own: 0, rel: [0, 0, 2, 1], pts: 0 },
      { own: 0, rel: [2, 0, 2, 0], pts: 0 },
      { own: 0, rel: [0, 0, 3, 0], pts: 0 },
      { own: 0, rel: [0, 4, 0, 0], pts: 1 }
    ],
    2: [
      { own: 0, rel: [3, 2, 2, 0], pts: 1 },
      { own: 2, rel: [0, 0, 3, 3], pts: 1 },
      { own: 0, rel: [0, 5, 0, 0], pts: 2 },
      { own: 3, rel: [5, 0, 0, 0], pts: 2 },
      { own: 2, rel: [0, 1, 4, 0], pts: 2 },
      { own: 6, rel: [0, 0, 0, 0], pts: 3 }
    ],
    3: [
      { own: 0, rel: [3, 3, 5, 3], pts: 3 },
      { own: 0, rel: [0, 0, 7, 0], pts: 4 },
      { own: 3, rel: [0, 0, 6, 3], pts: 4 },
      { own: 3, rel: [0, 0, 7, 0], pts: 5 }
    ]
  };

  function buildDeck() {
    var decks = { 1: [], 2: [], 3: [] };
    [1, 2, 3].forEach(function (tier) {
      PATTERNS[tier].forEach(function (pattern, pi) {
        COLORS.forEach(function (bonus, bi) {
          var cost = {};
          if (pattern.own) cost[bonus] = pattern.own;
          pattern.rel.forEach(function (amount, ri) {
            if (amount) cost[COLORS[(bi + ri + 1) % COLORS.length]] = amount;
          });
          decks[tier].push({
            id: 't' + tier + 'p' + pi + '-' + bonus,
            tier: tier,
            bonus: bonus,
            points: pattern.pts,
            cost: cost
          });
        });
      });
    });
    return decks;
  }

  /* The ten noble tiles, 3 prestige points each. */
  var NOBLES = [
    { id: 'n1', points: 3, req: { white: 3, blue: 3, green: 3 } },
    { id: 'n2', points: 3, req: { white: 3, blue: 3, black: 3 } },
    { id: 'n3', points: 3, req: { white: 3, red: 3, black: 3 } },
    { id: 'n4', points: 3, req: { blue: 3, green: 3, red: 3 } },
    { id: 'n5', points: 3, req: { green: 3, red: 3, black: 3 } },
    { id: 'n6', points: 3, req: { white: 4, blue: 4 } },
    { id: 'n7', points: 3, req: { blue: 4, green: 4 } },
    { id: 'n8', points: 3, req: { green: 4, red: 4 } },
    { id: 'n9', points: 3, req: { red: 4, black: 4 } },
    { id: 'n10', points: 3, req: { white: 4, black: 4 } }
  ];

  var NOBLE_NAMES = {
    n1: 'Mary Stuart',
    n2: 'Charles V',
    n3: 'Machiavelli',
    n4: 'Isabella I',
    n5: 'Suleiman',
    n6: 'Catherine de Medici',
    n7: 'Anne of Brittany',
    n8: 'Elisabeth of Austria',
    n9: 'Francis I of France',
    n10: 'Henry VIII'
  };

  var TOKENS_BY_PLAYERS = { 2: 4, 3: 5, 4: 7 };

  global.SplendorData = {
    COLORS: COLORS,
    ALL_TOKENS: ALL_TOKENS,
    NOBLES: NOBLES,
    NOBLE_NAMES: NOBLE_NAMES,
    TOKENS_BY_PLAYERS: TOKENS_BY_PLAYERS,
    GOLD_COUNT: 5,
    NOBLE_BONUS: 1,          // nobles on the table = players + 1
    WINNING_POINTS: 15,
    MAX_TOKENS: 10,
    MAX_RESERVED: 3,
    BOARD_WIDTH: 4,
    buildDeck: buildDeck
  };
})(typeof window !== 'undefined' ? window : globalThis);
