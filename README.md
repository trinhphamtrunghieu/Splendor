# Splendor

A fan-made, dependency-free implementation of the board game **Splendor**, playable in any
modern browser and hosted on GitHub Pages. No build step, no server, no accounts — the whole
game is static HTML, CSS and plain JavaScript.

*(Tiếng Việt bên dưới — the game interface itself defaults to Vietnamese and has an EN/VI switch.)*

## Two ways to play

| Mode | What it is |
| --- | --- |
| **Single player** | You against 1–3 computer opponents, at easy / normal / hard. |
| **Multiplayer (pass-and-play)** | 2–4 people sharing one phone, tablet or computer, taking turns. An optional privacy screen blanks the board between turns so nobody sees the reserved cards of the player before them. |

Both modes run entirely on the device. Because GitHub Pages only serves static files, there is
no networked lobby — "multiplayer" means everyone plays on the same screen, which is also how
the physical game is played.

## Features

- Complete Splendor ruleset: 90 development cards, 10 noble tiles, gold wildcards, the
  10-token limit, reserving from the deck, the final round after 15 points and the
  fewest-cards tiebreak.
- Responsive from a 320px phone to a wide desktop: on phones the board scrolls and the
  current player's tray is docked to the bottom; on desktop the whole board fits on screen.
- Three bot strengths. The bots evaluate every legal move one ply deep, weighing prestige
  points, permanent discounts, progress towards nobles and what they hand the opponent.
- Interface in **Vietnamese and English**, switchable at any time.
- Games are saved to `localStorage`, so a reloaded or reopened tab can resume.
- Installable as a PWA-style shortcut (web manifest + icon), and playable offline once loaded.
- Keyboard and touch friendly: 44px tap targets, `Esc` closes dialogs, visible focus rings,
  and `prefers-reduced-motion` is honoured.

## Play it

Once GitHub Pages is enabled for this repository (see below), the game is live at:

```
https://<your-username>.github.io/Splendor/
```

To run it locally, no tooling is needed — open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deploying to GitHub Pages

The site is plain static files at the repository root, so there is nothing to build. Pages
has to be switched on once by hand — that is the only manual step, and only a repository
admin can do it:

**Settings → Pages → Build and deployment → Source**, then either:

- **GitHub Actions** — the workflow in `.github/workflows/pages.yml` runs
  `tests/engine.test.js` on every push and publishes the repository root when the push is to
  the default branch (whatever it is named) or when you run the workflow by hand from the
  Actions tab. Until Pages is switched on, the `deploy` job fails at `configure-pages` with
  *"Create Pages site failed … Resource not accessible by integration"* — the workflow asks
  for it with `enablement: true`, but the Actions token is not allowed to create the site on
  its own. The `test` job runs and passes regardless.
- **Deploy from a branch** — pick the branch and the `/ (root)` folder. No Actions involved.

If the deploy step is instead rejected because the `github-pages` environment only allows the
default branch, either merge this branch into the default branch or add the branch under
**Settings → Environments → github-pages → Deployment branches**.

A `.nojekyll` file keeps GitHub from running Jekyll over the assets.

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

## Development

```
index.html                 markup shell — menu screen and game screen
assets/css/style.css       all styling, phone-first with a few breakpoints
assets/js/data.js          the 90 cards and 10 nobles, generated from cost patterns
assets/js/engine.js        rules engine — pure state machine, no DOM
assets/js/ai.js            computer opponents (one-ply search + evaluation)
assets/js/i18n.js          Vietnamese and English strings
assets/js/ui.js            rendering and dialogs
assets/js/app.js           controller — menus, turn loop, persistence
tests/engine.test.js       rules tests + 200-game self-play invariant check
```

The engine never touches the DOM and never produces user-facing text: failures come back as
`{ ok: false, error: '<i18n key>' }`, and log entries are structured events the UI renders in
the chosen language. The UI and the bots go through the same action functions, so they cannot
disagree about the rules.

Run the tests with:

```bash
node tests/engine.test.js
```

They cover deck composition, each turn action and its rejections, the token limit, noble
visits and choices, the final round, tiebreaks, and 60 bot-vs-bot games checking that tokens
and prestige points are conserved and that every game terminates. For a deeper soak, raise
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

## Hai chế độ

- **Một người** — bạn đấu với 1–3 máy, ba mức độ khó: Dễ / Thường / Khó.
- **Nhiều người** — 2–4 người chơi luân phiên trên cùng một thiết bị. Có thể bật *màn che khi
  đổi lượt* để người sau không thấy thẻ mà người trước đang giữ.

Vì GitHub Pages chỉ phục vụ file tĩnh nên không có chế độ chơi qua mạng: "nhiều người" nghĩa là
cùng chơi trên một máy — đúng như khi chơi bàn thật.

## Điểm nổi bật

- Đầy đủ luật Splendor: 90 thẻ phát triển, 10 thẻ quý tộc, vàng thay mọi màu, giới hạn 10
  token, giữ thẻ úp từ chồng, vòng cuối sau khi có người đạt 15 điểm, và luật hoà (ai mua ít
  thẻ hơn thì thắng).
- Giao diện tương thích cả điện thoại và máy tính: trên điện thoại bàn chơi cuộn được và khay
  của người đang chơi luôn nằm dưới cùng; trên máy tính toàn bộ bàn hiện trong một màn hình.
- Máy chơi ở ba mức độ, cân nhắc điểm uy tín, chiết khấu lâu dài, tiến độ tới quý tộc và cả
  việc để lộ thẻ tốt cho đối thủ.
- Giao diện **Tiếng Việt và English**, đổi lúc nào cũng được.
- Tự lưu ván đang chơi, mở lại trình duyệt vẫn tiếp tục được.
- Thêm được vào màn hình chính như một ứng dụng, chơi offline sau lần tải đầu.

## Cách chơi nhanh

Mỗi lượt chọn **đúng một** việc: lấy 3 viên khác màu; lấy 2 viên cùng màu (khi chồng đó còn ≥ 4
viên); giữ 1 thẻ và nhận 1 vàng (giữ tối đa 3 thẻ); hoặc mua 1 thẻ trên bàn / trong số thẻ đã
giữ. Thẻ đã mua cho bạn một viên đá vĩnh viễn dùng làm chiết khấu. Cuối lượt nếu giữ quá 10
token thì phải trả lại. Đủ chiết khấu theo yêu cầu thì quý tộc đến thăm, tặng 3 điểm. Nút
**Luật** trong game có hướng dẫn đầy đủ.

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
