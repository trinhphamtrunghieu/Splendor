/* Splendor — interface strings. Vietnamese is the default, English optional. */
(function (global) {
  'use strict';

  var STRINGS = {
    vi: {
      'lang.name': 'Tiếng Việt',
      'app.title': 'Splendor',
      'app.tagline': 'Thương nhân thời Phục hưng — gom đá quý, mua mỏ, mời quý tộc.',

      'menu.single': 'Một người',
      'menu.single.desc': 'Bạn đấu với 1–3 máy. Chọn độ khó.',
      'menu.multi': 'Nhiều người',
      'menu.multi.desc': '2–4 người chơi trên cùng một thiết bị, luân phiên nhau.',
      'menu.players': 'Số người chơi',
      'menu.difficulty': 'Độ khó của máy',
      'menu.difficulty.easy': 'Dễ',
      'menu.difficulty.normal': 'Thường',
      'menu.difficulty.hard': 'Khó',
      'menu.names': 'Tên người chơi',
      'menu.start': 'Bắt đầu',
      'menu.resume': 'Tiếp tục ván đang chơi',
      'menu.rules': 'Luật chơi',
      'menu.privacy': 'Màn che khi đổi lượt',
      'menu.privacy.hint': 'Ẩn bàn chơi giữa hai lượt để không lộ thẻ đã giữ.',
      'menu.speed': 'Tốc độ máy',
      'menu.speed.fast': 'Nhanh',
      'menu.speed.normal': 'Vừa',
      'menu.speed.slow': 'Chậm',
      'menu.you': 'Bạn',
      'menu.bot': 'Máy {n}',
      'menu.player': 'Người chơi {n}',
      'menu.back': 'Quay lại',

      'game.round': 'Vòng {n}',
      'game.turnOf': 'Lượt của {p}',
      'game.yourTurn': 'Lượt của bạn',
      'game.thinking': '{p} đang suy nghĩ…',
      'game.bank': 'Ngân hàng đá quý',
      'game.nobles': 'Quý tộc',
      'game.tier': 'Cấp {n}',
      'game.deckLeft': 'còn {n}',
      'game.deckEmpty': 'hết thẻ',
      'game.players': 'Người chơi',
      'game.reserved': 'Thẻ đã giữ',
      'game.bonuses': 'Chiết khấu',
      'game.points': 'điểm',
      'game.point': 'điểm',
      'game.cards': 'thẻ',
      'game.log': 'Diễn biến',
      'game.menu': 'Menu',
      'game.rules': 'Luật',
      'game.newGame': 'Ván mới',
      'game.backToMenu': 'Về menu chính',
      'game.resumeGame': 'Tiếp tục ván',
      'game.finalRound': 'Vòng cuối!',
      'game.you': '(bạn)',
      'game.ai': 'Máy',
      'game.noReserved': 'Chưa giữ thẻ nào.',
      'game.hidden': 'Đã giữ {n} thẻ (ẩn)',

      'action.take': 'Lấy {n} đá quý',
      'action.takeEmpty': 'Chọn đá quý để lấy',
      'action.pass': 'Bỏ lượt (không còn nước đi)',
      'action.takeHint': 'Chọn 3 viên khác màu, hoặc 2 viên cùng màu (khi còn ≥ 4 viên).',
      'action.clear': 'Bỏ chọn',
      'action.buy': 'Mua',
      'action.reserve': 'Giữ thẻ',
      'action.reserveDeck': 'Giữ thẻ úp cấp {n}',
      'action.cancel': 'Đóng',
      'action.confirm': 'Xác nhận',
      'action.cost': 'Giá',
      'action.youPay': 'Bạn trả',
      'action.covered': 'Chiết khấu thẻ',
      'action.missing': 'Còn thiếu',
      'action.cannotBuy': 'Chưa đủ đá quý',
      'action.reserveFull': 'Đã giữ tối đa 3 thẻ',
      'action.withGold': 'dùng {n} vàng',

      'modal.discard.title': 'Trả lại đá quý',
      'modal.discard.body': 'Bạn chỉ được giữ tối đa 10 viên. Hãy chọn {n} viên để trả lại.',
      'modal.discard.selected': 'Đã chọn {a}/{b}',
      'modal.noble.title': 'Chọn quý tộc đến thăm',
      'modal.noble.body': 'Bạn đủ điều kiện với nhiều quý tộc. Chọn một người.',
      'modal.over.title': 'Kết thúc',
      'modal.over.winner': '{p} thắng!',
      'modal.over.tie': 'Hoà — {p} thắng nhờ mua ít thẻ hơn.',
      'modal.over.stalemate': 'Ván đấu bế tắc nên dừng lại.',
      'modal.over.again': 'Chơi lại',
      'modal.over.menu': 'Về menu',
      'modal.curtain.title': 'Đổi lượt',
      'modal.curtain.body': 'Hãy chuyển thiết bị cho {p}.',
      'modal.curtain.ready': 'Tôi đã sẵn sàng',
      'modal.confirmNew.title': 'Bắt đầu ván mới?',
      'modal.confirmNew.body': 'Ván đang chơi sẽ bị xoá.',

      'tut.title': 'Hướng dẫn cho người mới',
      'tut.subtitle': 'Chơi thử từng bước — mình chỉ chỗ, bạn tự bấm.',
      'tut.player': 'Người mới',
      'tut.next': 'Tiếp',
      'tut.back': 'Lùi lại',
      'tut.skip': 'Bỏ qua hướng dẫn',
      'tut.skipStep': 'Bỏ qua bước này',
      'tut.waiting': 'Đang chờ bạn thực hiện…',

      'tut.welcome.title': 'Chào mừng tới Splendor!',
      'tut.welcome.body': 'Bạn là thương nhân đá quý: gom đá để mua mỏ, mỏ cho bạn chiết khấu và điểm uy tín. Ai đạt 15 điểm trước sẽ kích hoạt vòng cuối. Mỗi lượt bạn chỉ được làm đúng MỘT việc — hướng dẫn này đi qua từng việc một, trên bàn chơi thật.',

      'tut.board.title': 'Đọc một thẻ phát triển',
      'tut.board.body': 'Ba hàng là ba cấp thẻ: hàng dưới rẻ nhất, hàng trên đắt và nhiều điểm nhất. Trên mỗi thẻ: số lớn góc trên trái là điểm uy tín, viên đá góc trên phải là màu đá thẻ cho bạn, còn dãy số tròn phía dưới là giá. Viền xanh nghĩa là bạn mua được ngay.',

      'tut.take3.title': 'Việc 1 — lấy 3 viên khác màu',
      'tut.take3.body': 'Bấm vào {gems} ở ngân hàng, rồi bấm nút xanh ở khay dưới để xác nhận. Bấm lại một viên đã chọn để bỏ chọn.',

      'tut.take2.title': 'Việc 2 — hoặc 2 viên cùng màu',
      'tut.take2.body': 'Thay vì 3 viên khác màu, bạn có thể lấy 2 viên cùng màu — nhưng chỉ khi chồng đó còn ít nhất 4 viên. Bấm {gem} hai lần rồi xác nhận.',

      'tut.buy.title': 'Việc 3 — mua thẻ',
      'tut.buy.body': 'Thẻ được khoanh sáng có giá đúng bằng số đá bạn vừa gom. Bấm vào thẻ để xem bảng giá, rồi bấm “Mua”. Nếu chưa đủ, cứ lấy thêm đá vài lượt rồi quay lại mua.',

      'tut.discount.title': 'Vì sao thẻ 0 điểm vẫn quý',
      'tut.discount.body': 'Thẻ đã mua nằm lại với bạn mãi mãi, ở ô “Chiết khấu” này. Mỗi viên chiết khấu trả thay bạn một viên đá cùng màu trong MỌI lần mua sau — và không bao giờ mất đi. Vì thế thẻ rẻ, 0 điểm vẫn rất đáng mua sớm: chúng làm cả ván sau này rẻ đi.',

      'tut.reserve.title': 'Việc 4 — giữ thẻ để dành',
      'tut.reserve.body': 'Thẻ được khoanh sáng đáng 5 điểm nhưng quá đắt lúc này. Bấm vào nó rồi bấm “Giữ thẻ”: thẻ về tay bạn, không ai mua được nữa, và bạn nhận 1 vàng. Giữ tối đa 3 thẻ.',

      'tut.gold.title': 'Vàng thay được mọi màu',
      'tut.gold.body': 'Vàng là viên duy nhất không lấy trực tiếp từ ngân hàng được — chỉ nhận khi giữ thẻ. Bù lại, khi mua thẻ, mỗi viên vàng thay cho một viên đá bất kỳ màu nào bạn còn thiếu.',

      'tut.nobles.title': 'Quý tộc — 3 điểm miễn phí',
      'tut.nobles.body': 'Quý tộc không mua được. Cuối mỗi lượt, nếu số thẻ chiết khấu của bạn đạt yêu cầu ghi trên một quý tộc, người đó tự đến thăm và tặng 3 điểm mà bạn không mất gì. Hãy ngắm trước xem mình sẽ đi theo quý tộc nào.',

      'tut.limit.title': 'Giới hạn 10 viên',
      'tut.limit.body': 'Ô này đếm số đá bạn đang giữ. Cuối lượt không được giữ quá 10 viên (tính cả vàng) — quá thì game sẽ bắt bạn trả lại cho đủ 10. Đừng gom quá nhiều mà không mua gì.',

      'tut.goal.title': 'Thắng thế nào',
      'tut.goal.body': 'Bảng này theo dõi điểm — ở ván hướng dẫn chỉ có bạn, còn ván thật sẽ có đủ đối thủ ở đây, kèm số thẻ và số đá họ đang giữ. Ai đạt 15 điểm trước sẽ kích hoạt vòng cuối — cả bàn được chơi hết vòng đó cho công bằng. Hết vòng, ai nhiều điểm nhất thắng; bằng điểm thì ai mua ít thẻ hơn thắng.',

      'tut.done.title': 'Vậy là xong!',
      'tut.done.body': 'Bạn đã biết cả 4 việc, chiết khấu, vàng và quý tộc — đủ để chơi thật. Trong ván thật còn có đối thủ: họ cũng nhắm thẻ bạn muốn, nên “giữ thẻ” là nước đi rất mạnh. Nút “Luật” trong menu luôn có bản luật đầy đủ.',

      'rules.title': 'Luật Splendor',
      'rules.goal.h': 'Mục tiêu',
      'rules.goal.p': 'Người đầu tiên đạt 15 điểm uy tín sẽ kích hoạt vòng cuối. Hết vòng đó, ai nhiều điểm nhất thì thắng; nếu bằng điểm, người mua ít thẻ hơn thắng.',
      'rules.turn.h': 'Mỗi lượt chọn đúng một việc',
      'rules.turn.1': 'Lấy 3 viên đá khác màu.',
      'rules.turn.2': 'Lấy 2 viên cùng màu — chỉ khi chồng đó còn ít nhất 4 viên.',
      'rules.turn.3': 'Giữ 1 thẻ (trên bàn hoặc thẻ úp trên chồng) và nhận 1 vàng nếu còn. Giữ tối đa 3 thẻ.',
      'rules.turn.4': 'Mua 1 thẻ trên bàn hoặc trong số thẻ bạn đang giữ.',
      'rules.pay.h': 'Thanh toán',
      'rules.pay.p': 'Mỗi thẻ đã mua cho bạn một viên đá vĩnh viễn (chiết khấu) của màu đó. Vàng thay thế được mọi màu. Đá quý dùng để mua sẽ trả lại ngân hàng.',
      'rules.limit.h': 'Giới hạn 10 viên',
      'rules.limit.p': 'Cuối lượt, nếu bạn giữ hơn 10 viên (tính cả vàng), phải trả lại cho đủ 10.',
      'rules.noble.h': 'Quý tộc',
      'rules.noble.p': 'Cuối lượt, nếu chiết khấu của bạn đạt yêu cầu của một quý tộc, người đó đến thăm và tặng 3 điểm. Mỗi lượt chỉ nhận một quý tộc và không mất gì cả.',
      'rules.setup.h': 'Chuẩn bị',
      'rules.setup.p': 'Số đá mỗi màu: 4 viên (2 người), 5 viên (3 người), 7 viên (4 người), cùng 5 vàng. Số quý tộc bằng số người chơi + 1.',

      'log.start': 'Bắt đầu ván {n} người.',
      'log.take': '{p} lấy {gems}.',
      'log.reserve': '{p} giữ một thẻ cấp {tier}.',
      'log.reserveGold': '{p} giữ một thẻ cấp {tier} và nhận 1 vàng.',
      'log.reserveDeck': '{p} giữ thẻ úp của chồng cấp {tier}.',
      'log.reserveDeckGold': '{p} giữ thẻ úp cấp {tier} và nhận 1 vàng.',
      'log.buy': '{p} mua thẻ {gem} (cấp {tier}).',
      'log.buyPoints': '{p} mua thẻ {gem} cấp {tier} (+{pts} điểm).',
      'log.noble': '{noble} đến thăm {p} (+{pts} điểm).',
      'log.discard': '{p} trả lại {n} viên.',
      'log.finalRound': '{p} đạt {target} điểm — vòng cuối!',
      'log.stalemate': 'Nhiều lượt không ai mua được thẻ — ván đấu dừng lại.',
      'log.win': '{p} thắng với {pts} điểm!',
      'log.pass': '{p} không còn nước đi hợp lệ và bỏ lượt.',

      'gem.white': 'Kim cương',
      'gem.blue': 'Lam ngọc',
      'gem.green': 'Lục bảo',
      'gem.red': 'Hồng ngọc',
      'gem.black': 'Hắc ngọc',
      'gem.gold': 'Vàng',

      'err.generic': 'Không thể thực hiện.',
      'err.notNow': 'Chưa tới lượt hành động.',
      'err.pickOne': 'Hãy chọn ít nhất một viên đá.',
      'err.pairNeedsFour': 'Chỉ lấy 2 viên cùng màu khi chồng đó còn ít nhất 4 viên.',
      'err.mixInvalid': 'Lấy 3 viên khác màu, hoặc 2 viên cùng màu.',
      'err.maxThree': 'Mỗi lượt lấy tối đa 3 viên.',
      'err.goldReserve': 'Vàng chỉ nhận được khi giữ thẻ.',
      'err.soldOut': 'Màu đá đó đã hết.',
      'err.threeDifferent': 'Hãy lấy 3 viên khác màu.',
      'err.reserveFull': 'Bạn đã giữ đủ 3 thẻ.',
      'err.cardGone': 'Thẻ này không còn trên bàn.',
      'err.deckEmpty': 'Chồng thẻ đã hết.',
      'err.cannotPay': 'Bạn chưa đủ đá quý để mua thẻ này.',
      'err.noNoble': 'Không có quý tộc nào để chọn.',
      'err.nobleIneligible': 'Quý tộc đó chưa đến thăm bạn được.',
      'err.nothingToReturn': 'Không cần trả lại gì.',
      'err.returnExactly': 'Hãy trả lại đúng {n} viên.',
      'err.notEnoughHeld': 'Bạn không giữ đủ số token đó.',
      'err.mustAct': 'Bạn vẫn còn nước đi hợp lệ.'
    },

    en: {
      'lang.name': 'English',
      'app.title': 'Splendor',
      'app.tagline': 'Renaissance merchants — collect gems, buy mines, attract nobles.',

      'menu.single': 'Single player',
      'menu.single.desc': 'Play against 1–3 bots. Pick their difficulty.',
      'menu.multi': 'Multiplayer',
      'menu.multi.desc': '2–4 players sharing one device, pass and play.',
      'menu.players': 'Players',
      'menu.difficulty': 'Bot difficulty',
      'menu.difficulty.easy': 'Easy',
      'menu.difficulty.normal': 'Normal',
      'menu.difficulty.hard': 'Hard',
      'menu.names': 'Player names',
      'menu.start': 'Start game',
      'menu.resume': 'Resume saved game',
      'menu.rules': 'How to play',
      'menu.privacy': 'Privacy screen on handover',
      'menu.privacy.hint': 'Hide the table between turns so reserved cards stay secret.',
      'menu.speed': 'Bot speed',
      'menu.speed.fast': 'Fast',
      'menu.speed.normal': 'Normal',
      'menu.speed.slow': 'Slow',
      'menu.you': 'You',
      'menu.bot': 'Bot {n}',
      'menu.player': 'Player {n}',
      'menu.back': 'Back',

      'game.round': 'Round {n}',
      'game.turnOf': "{p}'s turn",
      'game.yourTurn': 'Your turn',
      'game.thinking': '{p} is thinking…',
      'game.bank': 'Gem bank',
      'game.nobles': 'Nobles',
      'game.tier': 'Tier {n}',
      'game.deckLeft': '{n} left',
      'game.deckEmpty': 'empty',
      'game.players': 'Players',
      'game.reserved': 'Reserved',
      'game.bonuses': 'Discounts',
      'game.points': 'pts',
      'game.point': 'pt',
      'game.cards': 'cards',
      'game.log': 'Game log',
      'game.menu': 'Menu',
      'game.rules': 'Rules',
      'game.newGame': 'New game',
      'game.backToMenu': 'Main menu',
      'game.resumeGame': 'Resume game',
      'game.finalRound': 'Final round!',
      'game.you': '(you)',
      'game.ai': 'Bot',
      'game.noReserved': 'No reserved cards.',
      'game.hidden': '{n} reserved (hidden)',

      'action.take': 'Take {n} gem(s)',
      'action.takeEmpty': 'Pick gems to take',
      'action.pass': 'Pass (no legal move)',
      'action.takeHint': 'Pick 3 different gems, or 2 of one colour when at least 4 remain.',
      'action.clear': 'Clear',
      'action.buy': 'Buy',
      'action.reserve': 'Reserve',
      'action.reserveDeck': 'Reserve face-down tier {n}',
      'action.cancel': 'Close',
      'action.confirm': 'Confirm',
      'action.cost': 'Cost',
      'action.youPay': 'You pay',
      'action.covered': 'Card discount',
      'action.missing': 'Still missing',
      'action.cannotBuy': 'Not enough gems',
      'action.reserveFull': 'Already holding 3 cards',
      'action.withGold': 'uses {n} gold',

      'modal.discard.title': 'Return gems',
      'modal.discard.body': 'You may keep only 10 tokens. Choose {n} to return.',
      'modal.discard.selected': 'Selected {a}/{b}',
      'modal.noble.title': 'Choose a noble',
      'modal.noble.body': 'More than one noble would visit you. Pick one.',
      'modal.over.title': 'Game over',
      'modal.over.winner': '{p} wins!',
      'modal.over.tie': 'Tie on points — {p} wins with fewer cards.',
      'modal.over.stalemate': 'The game ended in a deadlock.',
      'modal.over.again': 'Play again',
      'modal.over.menu': 'Main menu',
      'modal.curtain.title': 'Pass the device',
      'modal.curtain.body': 'Hand the device to {p}.',
      'modal.curtain.ready': "I'm ready",
      'modal.confirmNew.title': 'Start a new game?',
      'modal.confirmNew.body': 'The game in progress will be discarded.',

      'tut.title': 'Tutorial for new players',
      'tut.subtitle': 'A guided first game — it points, you tap.',
      'tut.player': 'Newcomer',
      'tut.next': 'Next',
      'tut.back': 'Back',
      'tut.skip': 'Skip tutorial',
      'tut.skipStep': 'Skip this step',
      'tut.waiting': 'Waiting for your move…',

      'tut.welcome.title': 'Welcome to Splendor!',
      'tut.welcome.body': 'You are a gem merchant: collect gems to buy mines, and mines give you discounts and prestige points. The first player to 15 points triggers the final round. Each turn you do exactly ONE thing — this walkthrough covers them one at a time, on a real board.',

      'tut.board.title': 'Reading a development card',
      'tut.board.body': 'The three rows are the three tiers: the bottom row is cheapest, the top row costs most and scores most. On each card: the big number top-left is prestige points, the gem top-right is the gem that card gives you, and the circles along the bottom are its price. A green outline means you can afford it right now.',

      'tut.take3.title': 'Option 1 — take 3 different gems',
      'tut.take3.body': 'Tap {gems} in the bank, then press the green button in the tray below to confirm. Tap a selected gem again to unselect it.',

      'tut.take2.title': 'Option 2 — or 2 of one colour',
      'tut.take2.body': 'Instead of three different gems you may take two of one colour — but only while that pile still has 4 or more. Tap {gem} twice, then confirm.',

      'tut.buy.title': 'Option 3 — buy a card',
      'tut.buy.body': 'The highlighted card costs exactly the gems you just collected. Tap it to see the price breakdown, then press “Buy”. If you are short, spend a few more turns collecting and come back to it.',

      'tut.discount.title': 'Why a 0-point card is still good',
      'tut.discount.body': 'A card you buy stays with you forever, here under “Discounts”. Each discount pays for one gem of its colour on EVERY later purchase, and it is never spent. That is why cheap 0-point cards are worth buying early: they make the rest of the game cheaper.',

      'tut.reserve.title': 'Option 4 — reserve a card',
      'tut.reserve.body': 'The highlighted card is worth 5 points but is far too expensive right now. Tap it and press “Reserve”: it goes into your hand where nobody else can buy it, and you take a gold. Three reserved cards maximum.',

      'tut.gold.title': 'Gold is a wildcard',
      'tut.gold.body': 'Gold is the one token you can never take straight from the bank — you only get it by reserving a card. In exchange, when buying, each gold stands in for one gem of any colour you are missing.',

      'tut.nobles.title': 'Nobles — 3 free points',
      'tut.nobles.body': 'Nobles cannot be bought. At the end of any turn, if your card discounts meet the requirement printed on a noble, that noble visits you for 3 points and costs you nothing. Decide early which noble you are building towards.',

      'tut.limit.title': 'The 10-token limit',
      'tut.limit.body': 'This counter shows the gems you are holding. You may not end a turn with more than 10 tokens, gold included — the game will make you return the excess. Do not hoard without buying.',

      'tut.goal.title': 'How you win',
      'tut.goal.body': 'This panel tracks the score — in this walkthrough it is only you, but a real game lists every opponent here with the cards and gems they hold. The first to 15 points triggers the final round, which everyone plays out so all players get the same number of turns. Then the highest score wins, and a tie goes to whoever bought fewer cards.',

      'tut.done.title': 'That is all of it!',
      'tut.done.body': 'You now know the four actions, discounts, gold and nobles — enough to play for real. A real game adds opponents who want the same cards, which is what makes reserving so strong. The “Rules” button in the menu always has the full text.',

      'rules.title': 'How to play Splendor',
      'rules.goal.h': 'Goal',
      'rules.goal.p': 'The first player to reach 15 prestige points triggers the final round. When it ends, the highest score wins; on a tie, the player with fewer purchased cards wins.',
      'rules.turn.h': 'On your turn, do exactly one thing',
      'rules.turn.1': 'Take 3 gems of different colours.',
      'rules.turn.2': 'Take 2 gems of the same colour — only if that pile still has 4 or more.',
      'rules.turn.3': 'Reserve a card (from the table or the top of a deck) and take 1 gold if any is left. Max 3 reserved.',
      'rules.turn.4': 'Buy a card from the table or from the cards you reserved.',
      'rules.pay.h': 'Paying',
      'rules.pay.p': 'Every card you buy gives a permanent gem of its colour (a discount). Gold is a wildcard. Gems you spend go back to the bank.',
      'rules.limit.h': '10 token limit',
      'rules.limit.p': 'At the end of your turn, if you hold more than 10 tokens (gold included), return the excess.',
      'rules.noble.h': 'Nobles',
      'rules.noble.p': 'At the end of your turn, if your discounts meet a noble’s requirement, that noble visits you for 3 points — free, and at most one per turn.',
      'rules.setup.h': 'Setup',
      'rules.setup.p': 'Gems per colour: 4 (2 players), 5 (3 players), 7 (4 players), plus 5 gold. Nobles on the table: players + 1.',

      'log.start': 'New game with {n} players.',
      'log.take': '{p} took {gems}.',
      'log.reserve': '{p} reserved a tier {tier} card.',
      'log.reserveGold': '{p} reserved a tier {tier} card and took a gold.',
      'log.reserveDeck': '{p} reserved the top card of tier {tier}.',
      'log.reserveDeckGold': '{p} reserved the top tier {tier} card and took a gold.',
      'log.buy': '{p} bought a {gem} card (tier {tier}).',
      'log.buyPoints': '{p} bought a tier {tier} {gem} card (+{pts} pts).',
      'log.noble': '{noble} visits {p} (+{pts} pts).',
      'log.discard': '{p} returned {n} token(s).',
      'log.finalRound': '{p} reached {target} points — final round!',
      'log.stalemate': 'Nobody could buy a card for many turns — the game ends.',
      'log.win': '{p} wins with {pts} points!',
      'log.pass': '{p} had no legal move and passed.',

      'gem.white': 'Diamond',
      'gem.blue': 'Sapphire',
      'gem.green': 'Emerald',
      'gem.red': 'Ruby',
      'gem.black': 'Onyx',
      'gem.gold': 'Gold',

      'err.generic': 'That move is not allowed.',
      'err.notNow': 'Not your turn to act.',
      'err.pickOne': 'Pick at least one gem.',
      'err.pairNeedsFour': 'You may only take two of a colour when at least 4 remain.',
      'err.mixInvalid': 'Take 3 different gems, or 2 of the same colour.',
      'err.maxThree': 'You may take at most three gems.',
      'err.goldReserve': 'Gold can only be taken by reserving a card.',
      'err.soldOut': 'That gem is sold out.',
      'err.threeDifferent': 'Take three different gems.',
      'err.reserveFull': 'You already hold 3 reserved cards.',
      'err.cardGone': 'That card is no longer available.',
      'err.deckEmpty': 'That deck is empty.',
      'err.cannotPay': 'You cannot pay for that card yet.',
      'err.noNoble': 'No noble to choose.',
      'err.nobleIneligible': 'That noble will not visit you.',
      'err.nothingToReturn': 'Nothing to return.',
      'err.returnExactly': 'Return exactly {n} token(s).',
      'err.notEnoughHeld': 'You do not hold that many tokens.',
      'err.mustAct': 'You still have a legal move available.'
    }
  };

  var current = 'vi';

  function setLang(lang) {
    if (STRINGS[lang]) current = lang;
    return current;
  }

  function getLang() { return current; }

  function t(key, params) {
    var table = STRINGS[current] || STRINGS.vi;
    var text = table[key];
    if (text == null) text = (STRINGS.en[key] != null ? STRINGS.en[key] : key);
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return params[name] != null ? params[name] : match;
    });
  }

  /* Renders a structured engine log entry. */
  function logText(entry) {
    var params = {};
    Object.keys(entry.params).forEach(function (k) { params[k] = entry.params[k]; });
    if (params.gems) params.gems = params.gems.map(function (c) { return t('gem.' + c); }).join(', ');
    if (params.gem) params.gem = t('gem.' + params.gem);
    if (params.noble) params.noble = window.SplendorData.NOBLE_NAMES[params.noble] || params.noble;
    return t('log.' + entry.key, params);
  }

  global.SplendorI18n = { t: t, setLang: setLang, getLang: getLang, logText: logText, langs: Object.keys(STRINGS) };
})(typeof window !== 'undefined' ? window : globalThis);
