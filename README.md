# Splendor

A fan-made, dependency-free implementation of the board game **Splendor**, playable in any
modern browser and deployed on **Vercel**. Zero npm dependencies, no build step, no accounts —
static HTML, CSS and plain JavaScript paired with a single Vercel Serverless Function
(`api/room.js`) as the authoritative referee for online rooms.

*(Tiếng Việt bên dưới — the game interface itself defaults to Vietnamese and has an EN/VI switch.)*

## Three ways to play

| Mode | What it is |
| --- | --- |
| **Single player** | You against 1–3 computer opponents, at easy / normal / hard. |
| **Multiplayer (pass-and-play)** | 2–4 people sharing one phone, tablet or computer, taking turns. An optional privacy screen blanks the board between turns so nobody sees the reserved cards of the player before them. |
| **Online** | 2–4 people on their own devices, anywhere. One player creates a room, the others type the 5-character code or open the invite link. The Vercel server (`api/room.js`) is the referee, so the game keeps running even if the room creator disconnects. Bots can fill empty seats. |

Single player and pass-and-play run entirely on the device. Online play runs through
`/api/room` on Vercel — see [Online play](#online-play) for how the server-authoritative
protocol works.

## Features

- **Interactive tutorial for new players.** A 12-step guided first game on a scripted solo
  board: it spotlights the real bank, cards and tray, and the steps that teach an action
  (take 3 gems, take a pair, buy, reserve) wait until you have actually made the move with
  the same buttons a normal game uses. Skippable at any point, and it never touches your
  saved game.
- **Server-authoritative online play on Vercel**: `api/room.js` owns the true game state,
  validates every move with `engine.js`, runs AI turns immediately with `ai.js`, and sends
  each player only what Splendor's rules let them see (`viewFor`) — even the room creator
  cannot inspect deck order or opponents' reserved cards in DevTools.
- **Host failover & mid-game bot takeover**: once a game starts, the host has no special
  technical role; if the host drops, the other players keep playing without interruption and
  host privileges (`hostId`) automatically transfer to the next connected human player (and
  stay with the new host even when the old host reconnects). If a player is offline when their
  turn arrives, the current host can press **Let bot play** so an AI takes their turn until
  they reconnect and automatically reclaim their seat.
- **Change your name in the lobby**, as often as you like, right up until the host deals —
  after that the name is written into the game and its log, so it stays put.
- **Room chat**, in the lobby and during the game: a panel under the seats while you wait, and
  a button in the top bar with an unread count once the cards are out. Who joined, who
  reconnected, who became the new host and when the game started are noted in the same stream.
- Complete Splendor ruleset: 90 development cards, 10 noble tiles, gold wildcards, the
  10-token limit, reserving from the deck, the final round after 15 points and the
  fewest-cards tiebreak.
- Gems are drawn as cut stones — a round brilliant, a cushion, a step cut, an oval, a
  polished cabochon and a struck coin — as one SVG sprite instantiated everywhere, so the
  board costs one copy of the geometry. **Real photographs and paintings drop in on top**:
  `node tools/fetch-art.js` installs public-domain portraits of the ten historical figures
  the nobles are named after, plus free-licensed photos of cut stones.
- **The whole board fits on one phone screen, with nothing to scroll.** All three card rows,
  the bank and your tray are visible at once from 320px up.
- Three bot strengths. The bots evaluate every legal move one ply deep, weighing prestige
  points, permanent discounts, progress towards nobles and what they hand the opponent.
- Interface in **Vietnamese and English**, switchable at any time.
- Games are saved to `localStorage` (offline) and `sessionStorage` (online room code), so a
  reloaded or reopened tab can resume.

## Running locally

To run the full app (including the `/api/room` online server) locally with Node.js:

```bash
node api/room.js              # then visit http://localhost:8000
```

## Online play (Vercel Server-Authoritative)

`api/room.js` is a zero-dependency Vercel Serverless Function that shares the exact same
`data.js`, `engine.js` and `ai.js` modules as the browser:

```
  player 0 (host) ──POST /api/room──►┐                        ┌──► player 0 (redacted view)
  player 1 (guest)──POST /api/room──►├── Vercel /api/room.js ─┼──► player 1 (redacted view)
  player 2 (guest)──POST /api/room──►┘   (engine + AI + KV)   └──► player 2 (redacted view)
```

- **Hidden information stays on the server.** Every player (host included) receives a view
  redacted by `viewFor(state, seat)`: decks become counts (`[null, ...]`) and other players'
  reserved cards become `{ hidden: true }`.
- **Instant updates via Long-Polling.** Clients hold a `GET /api/room?wait=1&since=<seq>`
  request for up to 4.5 seconds. The moment any player moves, chats or changes the roster,
  the server resolves all waiting requests immediately.
- **Dual-mode storage (RAM + optional Upstash Redis Write-on-Move).** Active rooms live in
  warm serverless memory (`globalThis.__SPLENDOR_ROOMS__`, pinned to `sin1` in `vercel.json`)
  so long-polls cost **0 Redis commands**. If `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` and
  token environment variables are present, the server writes to Redis **only when a move or
  roster change happens** (~50–80 commands for an entire game) and reads from Redis **only on
  a cold start**.
- **Automatic host failover.** If the current host disconnects or leaves, `hostId` transfers
  to the next online human player and stays with the new host even if the original host
  reconnects later.

## Development

```
index.html                 markup shell — menu screen, lobby and game screen
vercel.json                Vercel region (sin1) and function timeout config
api/room.js                Vercel Serverless authoritative room server + local dev server
assets/css/style.css       all styling, phone-first with a few breakpoints
assets/js/data.js          the 90 cards and 10 nobles, generated from cost patterns
assets/js/engine.js        rules engine — pure state machine, no DOM
assets/js/ai.js            computer opponents (one-ply search + evaluation)
assets/js/i18n.js          Vietnamese and English strings
assets/js/net.js           online client: HTTP POST actions + Long-Polling sync
assets/js/art.js           gem artwork (SVG sprite) + the optional photo layer
assets/img/manifest.js     which real image files are installed, if any
assets/js/tutorial.js      the guided walkthrough (scripted board + coach marks)
assets/js/ui.js            rendering and dialogs
assets/js/app.js           controller — menus, turn loop, persistence
tools/fetch-art.js         downloads free-licensed portraits and gem photographs
tests/engine.test.js       rules, artwork and room redaction tests (no dependencies)
tests/net.test.mjs         end-to-end online play against a real HTTP server (no dependencies)
```

Run the tests with:

```bash
node tests/engine.test.js    # rules, UI invariants, artwork and redaction
node tests/net.test.mjs      # online play, host failover, bot takeover & Redis write-on-move
```

---

# Splendor (Tiếng Việt)

Bản cài đặt mã nguồn mở của board game **Splendor**, chạy trực tiếp trong trình duyệt và
deploy trên **Vercel**. Không cần build, không cần thư viện ngoài, không cần đăng nhập.

## Ba chế độ

- **Một người** — bạn đấu với 1–3 máy, ba mức độ khó: Dễ / Thường / Khó.
- **Nhiều người** — 2–4 người chơi luân phiên trên cùng một thiết bị. Có thể bật *màn che khi
  đổi lượt* để người sau không thấy thẻ mà người trước đang giữ.
- **Chơi qua mạng** — 2–4 người ở xa nhau, mỗi người một máy. Một người tạo phòng, những người
  khác nhập mã 5 ký tự hoặc mở link mời. Máy chủ Vercel (`api/room.js`) làm trọng tài trực tiếp
  nên không còn phụ thuộc vào máy chủ phòng hay broker MQTT công cộng.

## Chơi qua mạng (Server-Authoritative trên Vercel)

- **Server làm trọng tài (`api/room.js`)**: Server trực tiếp giữ bộ bài gốc, kiểm tra mọi nước
  đi bằng `engine.js`, tự động đánh lượt của Máy (`ai.js`) và chỉ gửi về từng trình duyệt phần
  thông tin hợp lệ (`viewFor`). Kể cả chủ phòng cũng không thể mở DevTools xem thứ tự bộ bài
  hay thẻ úp của người khác.
- **Không còn phụ thuộc vào chủ phòng**: Khi ván đã bắt đầu, chủ phòng mất mạng thì những người
  chơi khác vẫn đánh tiếp bình thường. Quyền quản trị phòng (`hostId`) tự động chuyển sang người
  chơi đang online kế tiếp và **giữ nguyên cho chủ phòng mới** kể cả khi chủ phòng cũ quay lại.
- **Máy đánh thay khi rớt mạng & tự trả lại ghế**: Nếu tới lượt một người đang mất kết nối, chủ
  phòng hiện tại có thể bấm **Cho Máy đi thay** để bàn cờ không bị kẹt; ngay khi người đó có
  mạng trở lại, hệ thống tự động trả lại quyền điều khiển ghế và bài cho họ.
- **Đồng bộ tức thì & tiết kiệm lệnh Redis (Dual-mode)**: Server giữ state trong RAM kết hợp
  **Long-Polling** (0 lệnh đọc Redis khi đang chơi). Nếu bật Upstash Redis / Vercel KV trên
  Vercel Hobby, server chỉ ghi (`SET`) xuống Redis khi có nước đi thật sự (**Write-on-Move**,
  ~50–80 lệnh cho cả ván) và chỉ đọc (`GET`) từ Redis khi tiến trình serverless cold-start.

## Chạy thử trên máy

```bash
node api/room.js              # mở http://localhost:8000 (hỗ trợ đầy đủ cả chế độ Online)
```

Chạy bộ kiểm thử:

```bash
node tests/engine.test.js
node tests/net.test.mjs
```

---

## Giấy phép / License

Source code: MIT (see `LICENSE`).

Splendor is a game designed by Marc André and published by Space Cowboys. This is an
unofficial fan project for learning and personal play; it is not affiliated with or endorsed by
the publisher, and it ships no artwork or text from the retail game.
