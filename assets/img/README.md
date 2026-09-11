# Image files

The game ships **drawn artwork** — the gems are faceted SVG stones defined in
`assets/js/art.js`. Everything here is optional: drop real images in and the game
uses them instead.

## Installing images

Two ways:

1. **Automatically.** From the repository root:

   ```bash
   node tools/fetch-art.js            # nobles + gems
   node tools/fetch-art.js --dry-run  # see what it would take first
   ```

   It downloads public-domain portraits of the ten historical figures the noble
   tiles are named after, plus free-licensed photographs of cut stones, verifies
   every licence through the Wikimedia API, rewrites `manifest.js`, and records
   the credits in `../../ATTRIBUTION.md`.

2. **By hand.** Put your own files in these folders and list them in
   `manifest.js`:

   ```
   gems/<colour>.jpg      white, blue, green, red, black, gold
   cards/<colour>.jpg     card face art (optional; falls back to gems/)
   nobles/<id>.jpg        n1 … n10
   ```

   ```js
   window.SplendorImages = {
     version: 1,
     gems:   { white: 'assets/img/gems/white.jpg' },
     cards:  {},
     nobles: { n1: 'assets/img/nobles/n1.jpg' },
     credits: 'ATTRIBUTION.md'
   };
   ```

Anything you leave out keeps its drawing, so a partial set is fine.

## Sizes

| Use | Displayed at | Good source size |
| --- | --- | --- |
| `gems/` | 40–52px circles | 256×256, square, stone centred |
| `cards/` | 76–136px card faces | 400×540, portrait |
| `nobles/` | 62–84px tall frames, cropped to the face | 520px wide, face in the upper third |

Keep them small — this is a static site with no build step, so every byte is
downloaded as-is. A few tens of KB each is plenty.

## Licensing

Only add images you are allowed to redistribute: your own work, public domain,
or a free licence (CC0 / CC BY / CC BY-SA). Record the source in
`ATTRIBUTION.md` — `tools/fetch-art.js` does this for you, and refuses anything
non-free.

**Do not add the retail game's artwork.** Splendor's card illustrations, noble
portraits and logo are copyrighted by its publisher. This project deliberately
contains none of them.
