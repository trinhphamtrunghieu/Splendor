/* Real image files installed in this repository.
 *
 * Empty by default: the game then draws its gems and noble tiles as vector
 * artwork. Run `node tools/fetch-art.mjs` to download public-domain portraits
 * and gem photographs and have this file rewritten, or fill it in by hand if
 * you are supplying your own images. Paths are relative to index.html.
 *
 *   gems   — keyed by gem colour: white, blue, green, red, black, gold
 *   cards  — card face art, keyed by the card's gem colour (falls back to gems)
 *   nobles — keyed by noble id: n1 … n10
 */
window.SplendorImages = {
  version: 1,
  gems: {},
  cards: {},
  nobles: {},
  credits: 'ATTRIBUTION.md'
};
