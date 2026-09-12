# Splendor

A fan-made, dependency-free implementation of the board game **Splendor**, playable in any
modern browser and hosted on GitHub Pages. No build step, no server, no accounts — the whole
game is static HTML, CSS and plain JavaScript.

*(Tiếng Việt bên dưới — the game interface itself defaults to Vietnamese and has an EN/VI switch.)*

## Three ways to play

| Mode | What it is |
| --- | --- |
| **Single player** | You against 1–3 computer opponents, at easy / normal / hard. |
| **Multiplayer (pass-and-play)** | 2–4 people sharing one phone, tablet or computer, taking turns. An optional privacy screen blanks the board between turns so nobody sees the reserved cards of the player before them. |
| **Online** | 2–4 people on their own devices, anywhere. One player creates a room, the others type the 5-character code. Still no server of ours: the browsers talk through a public MQTT broker. Bots can fill empty seats. |

Single player and pass-and-play run entirely on the device. Online play adds no server of ours
either — see [Online play](#online-play) for how a static page manages that, and what the
trade-offs are.

## Features

- **Interactive tutorial for new players.** A 12-step guided first game on a scripted solo
  board: it spotlights the real bank, cards and tray, and the steps that teach an action
  (take 3 gems, take a pair, buy, reserve) wait until you have actually made the move with
  the same buttons a normal game uses. Skippable at any point, and it never touches your
  saved game.
- **Online play with no server**: rooms over MQTT-on-WebSocket, host-authoritative, with
  hidden information actually hidden — each player is sent only what Splendor's rules let them
  see. Reconnects, refreshes and dropped players are handled.
- **Change your name in the lobby**, as often as you like, right up until the host deals —
  after that the name is written into the game and its log, so it stays put. The change
  travels through the host's roster, which is what makes it survive a reconnect, and the room
  is told who used to be who rather than a name silently changing on a seat.
- **Room chat**, in the lobby and during the game: a panel under the seats while you wait, and
  a button in the top bar with an unread count once the cards are out. Who joined, who
  renamed, who dropped and when the game started are noted in the same stream, so the room
  reads as one history.
- Complete Splendor ruleset: 90 development cards, 10 noble tiles, gold wildcards, the
  10-token limit, reserving from the deck, the final round after 15 points and the
  fewest-cards tiebreak.
- Gems are drawn as cut stones — a round brilliant, a cushion, a step cut, an oval, a
  polished cabochon and a struck coin — as one SVG sprite instantiated everywhere, so the
  board costs one copy of the geometry. **Real photographs and paintings drop in on top**:
  `node tools/fetch-art.js` installs public-domain portraits of the ten historical figures
  the nobles are named after, plus free-licensed photos of cut stones.
- A turn line above the tray always says whose turn it is — *Your turn*, *Waiting for Lan…*,
  *Bot 1 is thinking…* — and the gem bank is locked, visibly, whenever it is not yours, rather
  than letting you pick gems up and refusing them on confirm.
- **The whole board fits on one phone screen, with nothing to scroll.** All three card rows,
  the bank and your tray are visible at once from 320px up: the four face-up cards and the
  deck counter are sized from the viewport width, the rows share the leftover height, and
  the bank collapses to a single row of tokens. What does not fit on a phone moves behind a
  tap instead of being cut off — the crown button in the top bar opens the nobles, and the
  score chips on the turn line open a sheet with every player's gems, cards and nobles.
  A message arriving while a sheet is open (a bot's move, a player leaving) is printed
  inside the sheet rather than floating over the text you are reading.
- Three bot strengths. The bots evaluate every legal move one ply deep, weighing prestige
  points, permanent discounts, progress towards nobles and what they hand the opponent.
- Interface in **Vietnamese and English**, switchable at any time.
- Games are saved to `localStorage`, so a reloaded or reopened tab can resume.
- Installable as a PWA-style shortcut (web manifest + icon), and playable offline once loaded.
- Keyboard and touch friendly: 44px tap targets, `Esc` closes dialogs, visible focus rings,
  and `prefers-reduced-motion` is honoured.

## Play it

**https://trinhphamtrunghieu.github.io/Splendor/**

To run it locally, no tooling is needed — open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deploying to GitHub Pages

Pages is enabled on this repository with **GitHub Actions** as the source, and
`.github/workflows/pages.yml` handles the rest: it runs `tests/engine.test.js` on every push
and pull request, and publishes the repository root when the push is to the default branch
(whatever it is named) or when the workflow is run by hand from the Actions tab. The site is
plain static files, so there is nothing to build.

If you fork this repository, Pages has to be switched on once by a repository admin under
**Settings → Pages → Build and deployment → Source** — either *GitHub Actions* or *Deploy
from a branch* with the `/ (root)` folder. Until then the `deploy` job fails at
`configure-pages` with *"Create Pages site failed … Resource not accessible by integration"*:
the workflow asks for it with `enablement: true`, but the Actions token is not allowed to
create the site on its own. The `test` job runs and passes regardless.

If the deploy step is instead rejected because the `github-pages` environment only allows the
default branch, either merge into the default branch or add the branch under
**Settings → Environments → github-pages → Deployment branches**.

A `.nojekyll` file keeps GitHub from running Jekyll over the assets.

## Learning the game

New to Splendor? Press **Tutorial for new players** on the main menu (also in the in-game
menu). It plays a real game, on a board arranged so that every instruction is exact, and
teaches the four turn actions plus discounts, gold and nobles in about two minutes. The
**Rules** dialog is the full reference text in both languages.

## How to play (short version)

Each turn, do **exactly one** of:

1. Take **3 gems of different colours**.
2. Take **2 gems of the same colour** — only if that pile still has 4 or more.
3. **Reserve** a card (from the table or the top of a deck) and take 1 gold if any is left;
   you may hold at most 3 reserved cards.
4. **Buy** a card from the table or from the cards you reserved.

Every card you buy gives a permanent gem of its colour — a discount on every later purchase —
and gold is a wildcard. If you hold more than 10 tokens at the end of your turn, return the
excess. When your discounts meet a noble's requirement, that noble visits you for 3 points.
The first player to 15 points triggers the last round; when it finishes, the highest score
wins, and a tie goes to whoever bought fewer cards. The in-game **Rules** dialog has the full
text in both languages.

## Online play

There is no game server, and nothing to deploy beyond the static page. Instead:

- One player **hosts**. Their browser holds the only authoritative game state and applies every
  move with the same rules engine the offline game uses — it is the referee.
- The others **join** with a 5-character room code, or by opening the invite link the lobby
  shows (`…/index.html?room=ABC23`), and send the host their intended moves.
- Messages travel through a **public MQTT broker over WebSocket** (EMQX by default; HiveMQ and
  Mosquitto are offered, and you can point it at your own). A broker is a message bus, not a
  game server: it stores no game logic and knows nothing about Splendor.

```
 guest ──intent──►┐                        ┌──► guest   (redacted view)
                  ├── MQTT broker ── host ─┤
 guest ──intent──►┘   (relay only)  referee└──► guest   (redacted view)
```

**Hidden information stays hidden.** Each player's view is redacted before it is published: the
decks become counts, and other players' reserved cards become blanks. You receive only what the
rules let you see, so an opponent cannot read the deck order out of devtools. Everything
Splendor plays face up — the bank, the table, discounts, scores — is sent as-is.

**The referee refuses bad moves.** The host validates every incoming move against the engine:
out-of-turn messages and illegal moves change nothing and the sender is re-synced.

**Reconnecting works.** The room and each player's view are published as MQTT *retained*
messages, so the broker hands a returning player the current state with nobody having to ask.
Refresh the page and press "Back to your last room"; a host who reloads resumes the same room
with the game intact, because the host also saves it locally. Identity is per tab, so two tabs
on one machine are two players — handy for trying it out on your own.

**Nothing waits silently.** Each way this can fail says so, because a spinner that never
resolves is indistinguishable from a bug:

| What happened | What you see |
| --- | --- |
| The broker is blocked or down | *Could not reach broker.emqx.io:8084 … try a different one*, with a **Change broker** button |
| The room code does not exist | *No room ABC23 found. Check the code, and make sure both of you are on the same broker* — and it recovers by itself if the host turns up later |
| The host's tab dies | The broker publishes the host's *last will*, so everyone is told the game is paused; it resumes by itself the moment the host is back |
| Connection drops | The client reconnects with backoff and re-subscribes; the room chip in the top bar turns red while it is down |

### Limitations, stated plainly

- **The host must stay.** Their browser is the referee. If they close the tab the room ends —
  though the host can reload and resume, and everyone else reconnects to it.
- **A public broker is public.** Room codes are 5 characters from a 32-character alphabet
  (~34 million combinations), which is fine for playing with friends, but anyone who guessed a
  code could watch that room's traffic. Nothing sensitive is transmitted — names, gems and
  cards. Point the broker field at your own broker if you would rather not use a shared one.
- **No anti-cheat beyond redaction.** A determined host could inspect their own game state;
  they are the referee, after all. Play with people you like.
- **wss:// is required.** The published site is https, so a `ws://` broker is blocked by the
  browser as mixed content. All the built-in options are `wss://`.
- **Chat is not private and not kept.** It goes through the same public broker as the game,
  unencrypted, so treat it as talking across a table in a cafe. It is deliberately not
  retained: nothing is left sitting on the broker after the room ends, which also means a
  player who joins or reloads late sees only what is said from then on.

### How it is built

`assets/js/mqtt-lite.js` is a small MQTT 3.1.1 client over WebSocket — QoS 0, retained
messages, last will, keepalive and reconnect, in about two hundred lines. mqtt.js would do the
same, but its browser bundle is 369 KB, roughly twenty times the size of the rest of the game.

`assets/js/net.js` is the room protocol on top: topics under `splendor/v1/<room>/`, the seat
roster, per-player redacted views, and the join/intent/last-will messages. It touches no DOM,
which is what lets the whole thing be tested headlessly.

Tested against a real broker started in-process (`tests/net.test.mjs`, 37 checks) and, by hand,
in two real browsers playing each other — including two tabs of one browser, a shared invite
link, a room code that does not exist, an unreachable broker, and killing the host's connection
mid-game. Those browser runs are not in CI, which needs no browser download; the headless suite
covers the protocol and the wire format.

## Artwork, and using real images

What is installed right now:

| Element | Art |
| --- | --- |
| Ten noble tiles | **Real paintings** — Clouet's Mary Stuart, Titian's Charles V, Santi di Tito's Machiavelli and so on, all public domain, all credited in `ATTRIBUTION.md` |
| Gold token | **A photograph** of an 1881 gold ducat |
| The five gem stones | **Drawn** — a round brilliant, a cushion, a step cut, an oval and a polished cabochon, in `assets/js/art.js` |
| Card faces | The drawn stone, as a watermark behind the numbers |

Gems are drawn rather than photographed because photographs of *cut stones* are hard to find
automatically: a Commons search for "ruby gemstone" cheerfully returns scanned
nineteenth-century books *about* gemstones, and Commons renders a PDF's cover page as a
perfectly valid JPEG. The fetch script now looks in curated Commons categories, accepts only
real bitmaps, and rejects titles and aspect ratios that smell like a scanned page — and it has
a `--review` mode so you can see the candidates before anything is downloaded:

```bash
node tools/fetch-art.js --review --gems               # list candidates, download nothing
node tools/fetch-art.js --gems --pick red="File:Ruby cabochon.jpg"
```

Photographs win over drawings wherever they are installed. To install them:

```bash
node tools/fetch-art.js --dry-run   # show what it would download
node tools/fetch-art.js             # nobles + gems, then rewrite the manifest
```

The script pulls from Wikipedia and Wikimedia Commons, reads each candidate's licence from
the API and **refuses anything that is not public domain or a free CC/GFDL licence**, writes
the files into `assets/img/`, rewrites `assets/img/manifest.js`, and records every source,
author and licence in `ATTRIBUTION.md`. Portraits work especially well here because the ten
noble tiles are named after real people — Mary Stuart, Charles V, Machiavelli, Suleiman and
the rest — whose painted portraits are centuries out of copyright.

Prefer your own images? Drop them into `assets/img/{gems,cards,nobles}/` and list them in
`assets/img/manifest.js`; see `assets/img/README.md` for the filenames and recommended sizes.
Anything you leave out keeps its drawing, so a partial set is fine, and photographs are only
used where they have room to read — a 16px cost pip stays drawn either way.

**Keep them small.** A noble tile is at most 104px wide and a gem token 52px, so a 600 KB
source is bandwidth spent on pixels nobody sees. The installed portraits are 360px wide at
around 30 KB each; the whole image set is under 400 KB, and a test fails if it grows past
700 KB or if any single file goes over budget. The same test checks that every path the
manifest lists exists and is credited.

**Do not add the retail game's artwork.** Splendor's card illustrations, noble portraits and
logo are copyrighted by Space Cowboys; this project ships none of them and the fetch script
will not install them.

## Development

```
index.html                 markup shell — menu screen and game screen
assets/css/style.css       all styling, phone-first with a few breakpoints
assets/js/data.js          the 90 cards and 10 nobles, generated from cost patterns
assets/js/engine.js        rules engine — pure state machine, no DOM
assets/js/ai.js            computer opponents (one-ply search + evaluation)
assets/js/i18n.js          Vietnamese and English strings
assets/js/mqtt-lite.js     minimal MQTT-over-WebSocket client (no dependencies)
assets/js/net.js           online rooms: host/guest protocol, redacted views
assets/js/art.js           gem artwork (SVG sprite) + the optional photo layer
assets/img/manifest.js     which real image files are installed, if any
assets/js/tutorial.js      the guided walkthrough (scripted board + coach marks)
assets/js/ui.js            rendering and dialogs
assets/js/app.js           controller — menus, turn loop, persistence
tools/fetch-art.js         downloads free-licensed portraits and gem photographs
tests/engine.test.js       rules, artwork, MQTT codec and redaction (no dependencies)
tests/net.test.mjs         online play against a real broker (needs npm install)
```

The engine never touches the DOM and never produces user-facing text: failures come back as
`{ ok: false, error: '<i18n key>' }`, and log entries are structured events the UI renders in
the chosen language. The UI and the bots go through the same action functions, so they cannot
disagree about the rules.

Run the tests with:

```bash
node tests/engine.test.js    # everything that needs no network
npm install && npm run test:net   # online play, against a real broker
```

`npm install` pulls in `aedes` and `ws`. They are **dev-only**: the published page still loads
plain scripts with no build step and no runtime dependencies.

They cover deck composition, each turn action and its rejections, the token limit, noble
visits and choices, the final round, tiebreaks, and 60 bot-vs-bot games checking that tokens
and prestige points are conserved and that every game terminates. They also replay the
tutorial's scripted moves through the engine, so the walkthrough cannot quietly start giving
instructions that no longer work, and they check the MQTT wire format (varint boundaries, UTF-8
lengths, topic-filter matching) and the view redaction.

`tests/net.test.mjs` starts a real MQTT broker in-process and runs the real client and protocol
against it: retained messages, last-will on an abrupt drop, reconnect-and-resubscribe, a
four-seat game played to a finish over the wire, refusal of out-of-turn and illegal moves, and
that closing a room leaves nothing behind on the broker. For a deeper soak, raise
the game count:

```bash
SPLENDOR_GAMES=500 node tests/engine.test.js
```

## Cards

The deck is generated from cost *patterns* rather than a 90-line table. Splendor's card set is
symmetric under rotating the five gem colours, so each tier is a handful of patterns repeated
once per bonus colour (8 × 5 in tier 1, 6 × 5 in tier 2, 4 × 5 in tier 3). This keeps the data
compact and guarantees the colour balance of the printed game.

---

# Splendor (Tiếng Việt)

Bản cài đặt mã nguồn mở của board game **Splendor**, chạy trực tiếp trong trình duyệt và
host trên GitHub Pages. Không cần build, không cần server, không cần đăng nhập.

## Ba chế độ

- **Một người** — bạn đấu với 1–3 máy, ba mức độ khó: Dễ / Thường / Khó.
- **Nhiều người** — 2–4 người chơi luân phiên trên cùng một thiết bị. Có thể bật *màn che khi
  đổi lượt* để người sau không thấy thẻ mà người trước đang giữ.
- **Chơi qua mạng** — 2–4 người ở xa nhau, mỗi người một máy. Một người tạo phòng, những người
  khác nhập mã 5 ký tự. Vẫn không cần server riêng: các trình duyệt nói chuyện qua một broker
  MQTT công cộng. Có thể thêm máy vào chỗ còn trống.

Chế độ một người và nhiều người trên cùng máy chạy hoàn toàn trong máy bạn. Chế độ qua mạng
cũng không cần server nào của chúng ta — xem phần *Chơi qua mạng* bên dưới.

## Điểm nổi bật

- **Hướng dẫn tương tác cho người mới.** 12 bước chơi thử trên một bàn được dàn sẵn: hướng dẫn
  khoanh sáng đúng chỗ cần bấm (ngân hàng, thẻ, khay của bạn), và ở những bước dạy một nước đi
  (lấy 3 viên, lấy 2 viên cùng màu, mua thẻ, giữ thẻ) nó chờ tới khi bạn thật sự bấm xong mới
  đi tiếp. Bỏ qua lúc nào cũng được, và không ảnh hưởng ván đang lưu.
- Đầy đủ luật Splendor: 90 thẻ phát triển, 10 thẻ quý tộc, vàng thay mọi màu, giới hạn 10
  token, giữ thẻ úp từ chồng, vòng cuối sau khi có người đạt 15 điểm, và luật hoà (ai mua ít
  thẻ hơn thì thắng).
- Đá quý được vẽ thành khối đá thật có các mặt cắt (brilliant, cushion, emerald cut, oval,
  cabochon và đồng vàng dập nổi) bằng một sprite SVG dùng lại cho toàn bàn. **Muốn dùng ảnh
  thật thì chỉ cần bỏ ảnh vào**: chạy `node tools/fetch-art.js` để tải tranh chân dung
  public-domain của 10 nhân vật lịch sử mà thẻ quý tộc được đặt tên theo, kèm ảnh đá quý có
  giấy phép tự do.
- Một dòng ngay trên khay luôn cho biết đang là lượt của ai — *Lượt của bạn*, *Đang chờ Lan…*,
  *Máy 1 đang suy nghĩ…* — và ngân hàng đá quý bị khoá (mờ đi rõ ràng) khi chưa tới lượt bạn,
  thay vì cho chọn rồi mới báo lỗi lúc xác nhận. Khi mất kết nối, dòng này báo rõ và khoá bàn
  lại: người chơi không bị mời đi trong lúc nước đi của họ không tới được ai.
- **Đổi tên trong phòng chờ**, đổi bao nhiêu lần cũng được, cho tới đúng lúc chủ phòng bấm Bắt
  đầu — sau đó tên đã được ghi vào ván và vào diễn biến nên giữ nguyên. Tên mới đi qua danh
  sách của chủ phòng, nhờ vậy mạng chớp tắt rồi vào lại vẫn còn, và cả phòng được cho biết ai
  vừa là ai chứ không phải tự nhiên thấy tên trên ghế đổi khác.
- **Nhắn tin trong phòng**, cả lúc chờ và lúc đang chơi: một khung ngay dưới danh sách người
  chơi khi còn ở phòng chờ, và một nút trên thanh trên cùng kèm số tin chưa đọc khi đã vào ván.
  Ai vào, ai đổi tên, ai mất kết nối, ván bắt đầu lúc nào — đều được ghi cùng một dòng chảy để
  đọc lại thành một mạch.
- **Trên điện thoại cả bàn chơi nằm gọn trong một màn hình, không phải cuộn.** Từ màn hình
  rộng 320px trở lên, ba hàng thẻ, ngân hàng và khay của bạn đều hiện cùng lúc: bốn thẻ mở và
  ô đếm chồng thẻ được tính theo chiều rộng màn hình, ba hàng chia đều phần cao còn lại, và
  ngân hàng gom thành một hàng token. Thứ không đủ chỗ thì nằm sau một cú bấm chứ không bị
  cắt mất — nút vương miện trên thanh trên cùng mở danh sách quý tộc, còn các ô điểm trên dòng
  lượt chơi mở bảng xem đá quý, thẻ và quý tộc của từng người. Nếu có thông báo đến lúc đang
  mở bảng (máy vừa đi, có người rời phòng) thì nó hiện ngay trong bảng, không che chữ bạn
  đang đọc.
- Máy chơi ở ba mức độ, cân nhắc điểm uy tín, chiết khấu lâu dài, tiến độ tới quý tộc và cả
  việc để lộ thẻ tốt cho đối thủ.
- Giao diện **Tiếng Việt và English**, đổi lúc nào cũng được.
- Tự lưu ván đang chơi, mở lại trình duyệt vẫn tiếp tục được.
- Thêm được vào màn hình chính như một ứng dụng, chơi offline sau lần tải đầu.

## Chơi qua mạng

Không có game server, và không phải deploy gì thêm ngoài trang tĩnh:

- Một người **làm chủ phòng**. Máy của họ giữ state thật và áp dụng mọi nước đi bằng đúng bộ
  luật mà chế độ offline dùng — họ là trọng tài.
- Những người khác **vào phòng** bằng mã 5 ký tự, hoặc mở thẳng **link mời** mà phòng chờ hiện
  ra (`…/index.html?room=ABC23`), rồi gửi nước đi của mình cho chủ phòng.
- Tin nhắn đi qua **broker MQTT công cộng trên WebSocket** (mặc định EMQX; có thêm HiveMQ,
  Mosquitto, và bạn có thể trỏ sang broker riêng). Broker chỉ là đường truyền tin, không chứa
  logic game.

**Thông tin riêng được giữ riêng.** Trước khi gửi, state được lược bỏ theo từng người: bộ thẻ
chỉ còn số lượng, thẻ đã giữ của người khác thành ô trống. Bạn chỉ nhận đúng những gì luật cho
phép thấy, nên đối thủ không thể mở devtools ra đọc thứ tự bộ thẻ.

**Trọng tài từ chối nước đi sai.** Chủ phòng kiểm tra mọi nước đi: đi khi chưa tới lượt, hoặc
nước đi không hợp luật, đều không làm gì cả và người gửi được đồng bộ lại.

**Mất kết nối vẫn vào lại được.** Thông tin phòng và view của từng người được publish dạng
*retained*, nên broker tự trao lại state cho người quay lại. Refresh trang rồi bấm “Vào lại
phòng gần nhất”. Chủ phòng refresh cũng mở lại đúng phòng đó vì state được lưu trong máy.
Danh tính tính theo từng tab, nên mở 2 tab trên cùng máy là 2 người chơi — tiện để thử một mình.

**Không có chỗ nào chờ im lặng.** Mỗi kiểu lỗi đều nói rõ, vì một vòng xoay không bao giờ dừng
thì không phân biệt được với hỏng:

| Chuyện gì xảy ra | Bạn thấy gì |
| --- | --- |
| Broker bị chặn hoặc chết | *Không kết nối được tới broker.emqx.io:8084…* kèm nút **Đổi broker** |
| Mã phòng không tồn tại | *Không tìm thấy phòng ABC23…* — và tự khỏi nếu sau đó chủ phòng mở phòng |
| Tab chủ phòng chết | Broker gửi *last will* của chủ phòng, mọi người được báo ván tạm dừng; chủ phòng quay lại là ván chạy tiếp |
| Mạng chớp tắt | Client tự kết nối lại và đăng ký lại; chip mã phòng ở thanh trên chuyển đỏ khi đang mất kết nối |

### Hạn chế cần biết

- **Chủ phòng phải ở lại** — máy họ là trọng tài. Đóng tab là phòng dừng (nhưng mở lại và tiếp
  tục được, mọi người tự kết nối lại).
- **Broker công cộng là công cộng.** Mã phòng 5 ký tự từ bộ 32 ký tự (~34 triệu tổ hợp), đủ an
  toàn để chơi với bạn bè, nhưng ai đoán đúng mã thì xem được lưu lượng phòng đó. Không có gì
  quan trọng được truyền — chỉ tên, đá quý và thẻ. Muốn kín hơn thì trỏ sang broker riêng.
- **Không chống gian lận ngoài việc lược bỏ thông tin.** Chủ phòng vẫn xem được state của chính
  họ — họ là trọng tài mà. Hãy chơi với người bạn tin.
- **Phải dùng wss://** vì trang chạy trên https; broker `ws://` sẽ bị trình duyệt chặn.
- **Tin nhắn không riêng tư và không được lưu.** Nó đi qua đúng cái broker công cộng mà ván
  đang dùng, không mã hoá — cứ coi như đang nói chuyện ở bàn cà phê. Việc không lưu là có chủ
  ý: hết phòng là không còn gì đọng lại trên broker, đổi lại người vào muộn hoặc tải lại trang
  chỉ thấy những gì được nói từ lúc đó trở đi.

## Mới chơi lần đầu?

Bấm **Hướng dẫn cho người mới** ở menu chính (hoặc trong menu khi đang chơi). Hướng dẫn cho
bạn chơi thật một ván nhỏ, dạy đủ 4 việc trong một lượt cùng với chiết khấu, vàng và quý tộc
trong khoảng hai phút. Nút **Luật** luôn có bản luật đầy đủ để tra lại.

## Cách chơi nhanh

Mỗi lượt chọn **đúng một** việc: lấy 3 viên khác màu; lấy 2 viên cùng màu (khi chồng đó còn ≥ 4
viên); giữ 1 thẻ và nhận 1 vàng (giữ tối đa 3 thẻ); hoặc mua 1 thẻ trên bàn / trong số thẻ đã
giữ. Thẻ đã mua cho bạn một viên đá vĩnh viễn dùng làm chiết khấu. Cuối lượt nếu giữ quá 10
token thì phải trả lại. Đủ chiết khấu theo yêu cầu thì quý tộc đến thăm, tặng 3 điểm. Nút
**Luật** trong game có hướng dẫn đầy đủ.

## Dùng ảnh thật

Hiện tại repo đã có ảnh thật: **10 tranh chân dung** quý tộc (Clouet, Titian, Santi di Tito…,
đều public domain, ghi nguồn trong `ATTRIBUTION.md`) và **ảnh đồng ducat vàng 1881** cho token
vàng. Năm viên đá còn lại vẫn là hình vector — vì tìm ảnh đá quý đã cắt bằng máy rất dễ sai:
Commons search cho "ruby gemstone" trả về cả sách cổ *viết về* đá quý, và Commons render trang
bìa PDF thành ảnh JPEG hợp lệ. Script đã được sửa (tìm theo category, chỉ nhận ảnh bitmap thật,
loại tên và tỉ lệ giống trang sách) và có thêm chế độ xem trước:

```bash
node tools/fetch-art.js --review --gems       # chỉ liệt kê ứng viên, không tải
node tools/fetch-art.js --gems --pick red="File:Ruby cabochon.jpg"
```

Nếu muốn thay ảnh khác:

```bash
node tools/fetch-art.js --dry-run   # xem trước sẽ tải những gì
node tools/fetch-art.js             # tải rồi tự cập nhật manifest
```

Script lấy ảnh từ Wikipedia / Wikimedia Commons, đọc giấy phép qua API và **từ chối mọi file
không phải public domain hoặc giấy phép tự do (CC0/CC BY/CC BY-SA/GFDL)**, rồi ghi nguồn và
tác giả vào `ATTRIBUTION.md`. Tranh chân dung rất hợp ở đây vì 10 quý tộc trong Splendor đều
đặt theo người thật — Mary Stuart, Charles V, Machiavelli, Suleiman… — tranh vẽ họ đã hết bản
quyền từ lâu.

Muốn dùng ảnh của riêng bạn: bỏ file vào `assets/img/{gems,cards,nobles}/` rồi khai báo trong
`assets/img/manifest.js` (xem `assets/img/README.md` để biết tên file và kích thước gợi ý).
Thiếu ảnh nào thì chỗ đó vẫn dùng hình vẽ, nên bỏ vào từng phần cũng được.

**Không dùng ảnh gốc của bản board game bán ngoài hàng** — tranh thẻ, chân dung và logo của
Splendor thuộc bản quyền Space Cowboys; project này không chứa và script cũng không tải chúng.

## Chạy thử

Mở `index.html` bằng trình duyệt, hoặc:

```bash
python3 -m http.server 8000   # rồi vào http://localhost:8000
```

---

## Giấy phép / License

Source code: MIT (see `LICENSE`).

Splendor is a game designed by Marc André and published by Space Cowboys. This is an
unofficial fan project for learning and personal play; it is not affiliated with or endorsed by
the publisher, and it ships no artwork or text from the retail game — the card layout here is
drawn with CSS and the gem shapes are inline SVG.
