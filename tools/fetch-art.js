#!/usr/bin/env node
/* Splendor — download real images for the board.
 *
 * The repository ships drawn artwork only. This script fetches photographs and
 * paintings that are genuinely free to redistribute, writes them into
 * assets/img/, and rewrites assets/img/manifest.js so the game picks them up.
 *
 *    node tools/fetch-art.js              # nobles + gems
 *    node tools/fetch-art.js --nobles     # portraits only
 *    node tools/fetch-art.js --gems       # gem photographs only
 *    node tools/fetch-art.js --dry-run    # show what would be downloaded
 *
 * Sources are Wikipedia and Wikimedia Commons. Every candidate's licence is
 * read from the Commons API and anything that is not public domain or a free
 * CC/GFDL licence is refused — so nothing lands in the repository that cannot
 * be published with it. Credits are written to ATTRIBUTION.md.
 *
 * NOTE: the ten nobles of Splendor are named after real historical figures, so
 * portraits painted centuries ago are in the public domain. The retail game's
 * own card art is NOT: never add it here.
 *
 * Requires Node 18+ (for global fetch) and outbound HTTPS.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets', 'img');

// User-Agent chuẩn chỉ kèm URL/contact giúp tránh bị Wikimedia CDN chặn
const UA = process.env.SPLENDOR_UA ||
  'SplendorWebFanProject/1.1 (https://github.com/trinhphamtrunghieu/Splendor; mailto:contact@splendorfan.local)';

/* Candidate Wikipedia titles per noble, most specific first. The first one
   that resolves to a page with a lead image wins. */
const NOBLES = {
  n1: { name: 'Mary Stuart', titles: ['Mary, Queen of Scots'] },
  n2: { name: 'Charles V', titles: ['Charles V, Holy Roman Emperor'] },
  n3: { name: 'Machiavelli', titles: ['Niccolò Machiavelli'] },
  n4: { name: 'Isabella I', titles: ['Isabella I of Castile'] },
  n5: { name: 'Suleiman', titles: ['Suleiman the Magnificent'] },
  n6: { name: 'Catherine de Medici', titles: ['Catherine de\' Medici'] },
  n7: { name: 'Anne of Brittany', titles: ['Anne of Brittany', 'Anne, Duchess of Brittany'] },
  n8: {
    name: 'Elisabeth of Austria',
    titles: ['Elisabeth of Austria, Queen of France', 'Elisabeth of Austria (1554–1592)']
  },
  n9: { name: 'Francis I of France', titles: ['Francis I of France'] },
  n10: { name: 'Henry VIII', titles: ['Henry VIII'] }
};

/* Where to look for each gem. Free-text search was a mistake here: a search for
   "ruby gemstone" happily returns scanned nineteenth-century books *about*
   gemstones, whose cover pages Commons renders as perfectly valid JPEGs. These
   categories are curated by Commons editors and contain photographs of the
   actual stones; the search terms are only a fallback. */
const GEM_SOURCES = {
  white: { categories: ['Diamonds', 'Cut diamonds'], search: 'cut diamond gemstone photograph' },
  blue: { categories: ['Sapphires', 'Cut sapphires'], search: 'cut sapphire gemstone photograph' },
  green: { categories: ['Emeralds', 'Cut emeralds'], search: 'cut emerald gemstone photograph' },
  red: { categories: ['Rubies', 'Cut rubies'], search: 'cut ruby gemstone photograph' },
  black: { categories: ['Onyx', 'Black gemstones'], search: 'onyx polished gemstone photograph' },
  gold: { categories: ['Gold coins', 'Ducats'], search: 'gold ducat coin obverse' }
};

/* Kept for the tests and for anyone reading the old option name. */
const GEM_QUERIES = Object.keys(GEM_SOURCES).reduce((out, key) => {
  out[key] = GEM_SOURCES[key].search;
  return out;
}, {});

/* ------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Commons reports licences as short names: "Public domain", "CC BY-SA 4.0",
   "CC0", "GFDL", "Fair use". Accept only what may be redistributed, and
   refuse the non-commercial and no-derivatives variants too. */
function isFreeLicense(shortName) {
  if (!shortName) return false;
  const s = String(shortName).toLowerCase();
  if (/fair use|non-free|nonfree|all rights reserved|copyright/.test(s)) return false;
  if (/\bnc\b|non-commercial|noncommercial|\bnd\b|no-?deriv/.test(s)) return false;
  return /public domain|^pd|\bpd\b|cc0|cc[- ]?by|gfdl|free art|copyleft/.test(s);
}

/* Commons renders the first page of a PDF or DjVu as a thumbnail, so a naive
   "not an svg" check lets book scans through — which is exactly how five book
   covers ended up being used as gemstones. Whitelist real bitmaps instead. */
const BITMAP_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function isBitmap(mime) {
  return BITMAP_TYPES.indexOf(String(mime || '').toLowerCase()) >= 0;
}

/* Titles that betray a scanned page, a diagram or a chart rather than a photo
   of the thing itself. */
const NOT_A_PHOTO = /\.(pdf|djvu|tif|tiff|svg)$|\b(book|cover|page|plate|folio|scan|frontispiece|title|catalogue|schedule|vocabulary|treatise|map|chart|diagram|drawing|engraving|illustration|logo|icon|stamp|banknote|graph)\b/i;

function looksLikeAPhotograph(file) {
  if (!isBitmap(file.mime)) return false;
  if (NOT_A_PHOTO.test(file.title || '')) return false;
  /* A gem photograph is roughly square; a book page is tall and narrow. */
  if (file.width && file.height) {
    const ratio = file.width / file.height;
    if (ratio < 0.55 || ratio > 1.9) return false;
    if (Math.min(file.width, file.height) < 200) return false;
  }
  return true;
}

function stripHtml(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extFromUrl(url) {
  const clean = String(url).split('?')[0];
  const match = /\.(jpe?g|png|webp|gif|svg)$/i.exec(clean);
  if (!match) return 'jpg';
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function renderManifest(images) {
  const group = (name) => {
    const keys = Object.keys(images[name] || {});
    if (!keys.length) return `  ${name}: {},`;
    const rows = keys.map((key) => `    ${key}: '${images[name][key]}'`).join(',\n');
    return `  ${name}: {\n${rows}\n  },`;
  };
  return `/* Generated by tools/fetch-art.js on ${new Date().toISOString().slice(0, 10)}.
 *
 * Real image files installed in this repository. Delete this file's entries (or
 * re-run the script) to go back to the drawn artwork. Credits: ATTRIBUTION.md
 */
window.SplendorImages = {
  version: 1,
${group('gems')}
${group('cards')}
${group('nobles')}
  credits: 'ATTRIBUTION.md'
};
`;
}

function renderAttribution(rows) {
  const header = `# Image credits

The code in this repository is MIT licensed (see \`LICENSE\`). The image files under
\`assets/img/\` are not ours: each is listed below with its source and licence, as
reported by the Wikimedia Commons API when \`tools/fetch-art.js\` downloaded it.

Re-running the script rewrites this file. If you replace an image by hand, please
add its credit here too.

| File | Depicts | Source | Author | Licence |
| --- | --- | --- | --- | --- |
`;
  const body = rows.map((r) =>
    `| \`${r.file}\` | ${r.subject} | [${r.sourceLabel}](${r.sourceUrl}) | ${r.author || '—'} | ${r.license} |`
  ).join('\n');
  const footer = `

## Not included

Splendor is designed by Marc André and published by Space Cowboys. The retail
game's card illustrations, noble portraits and logo are copyrighted and are
deliberately **not** used here — do not add them. Everything above is either
public domain or under a free licence that permits redistribution.
`;
  return header + body + footer + '\n';
}

/* --------------------------------------------------------------- network */

async function api(base, params, retries = 3) {
  const url = new URL(base);
  Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://en.wikipedia.org/',
          'Accept': 'application/json'
        }
      });

      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        const retryAfter = res.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
        await sleep(delay);
        continue;
      }

      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.pathname}`);

      await sleep(350); // Khoảng nghỉ tránh nghẽn quota
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
}

const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

/* The lead image of a Wikipedia article, at a usable width. */
async function leadImage(title, width) {
  const data = await api(WIKIPEDIA, {
    action: 'query',
    prop: 'pageimages',
    piprop: 'thumbnail|name',
    pithumbsize: width,
    titles: title,
    redirects: 1
  });
  const page = (data.query && data.query.pages && data.query.pages[0]) || null;
  if (!page || page.missing || !page.thumbnail) return null;
  return {
    title: page.title,
    url: page.thumbnail.source,
    fileName: page.pageimage ? `File:${page.pageimage}` : null
  };
}

/* Licence and authorship for a Commons file, straight from the API. */
async function fileCredit(fileTitle) {
  if (!fileTitle) return null;
  const data = await api(COMMONS, {
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'extmetadata|url',
    titles: fileTitle
  });
  const page = (data.query && data.query.pages && data.query.pages[0]) || null;
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const pick = (key) => (meta[key] && meta[key].value) || '';
  return {
    license: stripHtml(pick('LicenseShortName')) || 'unknown',
    author: stripHtml(pick('Artist')) || stripHtml(pick('Credit')),
    descriptionUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`
  };
}

function describeFiles(pages, width) {
  return (pages || []).map((page) => {
    const info = (page.imageinfo && page.imageinfo[0]) || {};
    const meta = info.extmetadata || {};
    const pick = (key) => (meta[key] && meta[key].value) || '';
    return {
      title: page.title,
      url: info.thumburl || info.url,
      mime: info.mime || '',
      width: info.width || 0,
      height: info.height || 0,
      license: stripHtml(pick('LicenseShortName')) || 'unknown',
      author: stripHtml(pick('Artist')) || stripHtml(pick('Credit')),
      descriptionUrl: info.descriptionurl || ''
    };
  }).filter((f) => f.url);
}

/* Files in a curated Commons category. */
async function categoryFiles(category, width, limit) {
  const data = await api(COMMONS, {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:' + category,
    gcmtype: 'file',
    gcmlimit: limit || 30,
    prop: 'imageinfo',
    iiprop: 'extmetadata|url|size',
    iiurlwidth: width
  });
  return describeFiles(data.query && data.query.pages, width);
}

/* Free-licensed Commons files matching a search. */
async function searchFiles(query, width, limit) {
  const data = await api(COMMONS, {
    action: 'query',
    generator: 'search',
    gsrnamespace: 6,
    gsrsearch: query,
    gsrlimit: limit || 12,
    prop: 'imageinfo',
    iiprop: 'extmetadata|url|size',
    iiurlwidth: width
  });
  return describeFiles(data.query && data.query.pages, width);
}

/* Candidates for one gem, best first: curated categories, then search, with
   anything that is not a photograph of a stone filtered out. */
async function gemCandidates(color, width) {
  const source = GEM_SOURCES[color];
  const seen = {};
  const out = [];
  const consider = (files) => {
    files.forEach((file) => {
      if (seen[file.title]) return;
      seen[file.title] = true;
      if (!looksLikeAPhotograph(file)) return;
      if (!isFreeLicense(file.license)) return;
      out.push(file);
    });
  };
  for (const category of source.categories) {
    try { consider(await categoryFiles(category, width, 40)); } catch (err) { /* try the next */ }
  }
  if (out.length < 3) {
    try { consider(await searchFiles(source.search, width, 20)); } catch (err) { /* nothing else to try */ }
  }
  return out;
}

async function download(url, destination, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://commons.wikimedia.org/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });

      // Thử lại nếu gặp 403 Forbidden hoặc 429 Too Many Requests
      if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, buffer);

      await sleep(300); // Thư giãn cho CDN sau khi pull nhị phân
      return buffer.length;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
}

/* ------------------------------------------------------------------ main */

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && a.indexOf('=') < 0));
  const wantNobles = flags.has('--nobles') || !(flags.has('--gems'));
  const wantGems = flags.has('--gems') || !(flags.has('--nobles'));

  /* --pick red=File:Some ruby.jpg  forces one choice */
  const picks = {};
  argv.forEach((arg, i) => {
    const inline = /^--pick=(.+)$/.exec(arg);
    const value = inline ? inline[1] : (arg === '--pick' ? argv[i + 1] : null);
    if (!value) return;
    const split = value.indexOf('=');
    if (split > 0) picks[value.slice(0, split)] = value.slice(split + 1);
  });

  return {
    nobles: wantNobles,
    gems: wantGems,
    dryRun: flags.has('--dry-run'),
    review: flags.has('--review'),
    picks: picks,
    help: flags.has('--help') || flags.has('-h')
  };
}

const HELP = `Splendor art fetcher

  node tools/fetch-art.js [--nobles] [--gems] [--dry-run] [--review]

  --nobles    public-domain portraits for the ten noble tiles
  --gems      photographs of cut stones for the six gem tokens
  --dry-run   report what would be downloaded, write nothing
  --review    list the candidate files per gem and pick nothing, so you can
              eyeball them first (gem search is fuzzy by nature)
  --pick c=F  force one gem to a file you chose from --review, e.g.
              --pick red="File:Ruby cabochon.jpg"
  --help      this text

Only public-domain and free-licence (CC0/CC BY/CC BY-SA/GFDL) files are
accepted; anything else is skipped and reported. Credits land in
ATTRIBUTION.md, and assets/img/manifest.js is rewritten so the game uses the
images. Set SPLENDOR_UA to override the User-Agent sent to Wikimedia.
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return 0; }

  if (typeof fetch !== 'function') {
    console.error('This script needs Node 18 or newer (global fetch).');
    return 1;
  }

  const images = { gems: {}, cards: {}, nobles: {} };
  const credits = [];
  let failures = 0;

  if (opts.nobles) {
    console.log('\nNoble portraits (public-domain paintings)\n');
    for (const id of Object.keys(NOBLES)) {
      const noble = NOBLES[id];
      let done = false;
      for (const title of noble.titles) {
        try {
          const lead = await leadImage(title, 520);
          if (!lead) { console.log(`  -- ${noble.name}: no lead image on "${title}"`); continue; }
          const credit = await fileCredit(lead.fileName);
          const license = (credit && credit.license) || 'unknown';
          if (!isFreeLicense(license)) {
            console.log(`  !! ${noble.name}: refused "${license}" (${lead.fileName})`);
            continue;
          }
          const rel = `assets/img/nobles/${id}.${extFromUrl(lead.url)}`;
          if (opts.dryRun) {
            console.log(`  ok ${noble.name} -> ${rel} [${license}]`);
          } else {
            const bytes = await download(lead.url, path.join(ROOT, rel));
            console.log(`  ok ${noble.name} -> ${rel} (${Math.round(bytes / 1024)} KB) [${license}]`);
          }
          images.nobles[id] = rel;
          credits.push({
            file: rel, subject: noble.name,
            sourceLabel: lead.fileName || lead.title,
            sourceUrl: (credit && credit.descriptionUrl) || `https://en.wikipedia.org/wiki/${encodeURIComponent(lead.title)}`,
            author: credit && credit.author, license
          });
          done = true;
          break;
        } catch (err) {
          console.log(`  !! ${noble.name}: ${err.message}`);
        }
      }
      if (!done) failures++;
    }
  }

  if (opts.gems) {
    console.log('\nGem photographs (free-licence Commons files)\n');
    for (const color of Object.keys(GEM_SOURCES)) {
      try {
        const usable = await gemCandidates(color, 512);
        if (opts.review) {
          console.log(`  ${color}: ${usable.length} candidate(s)`);
          usable.slice(0, 6).forEach((f, i) => {
            console.log(`     ${i === 0 ? '*' : ' '} ${f.title}  [${f.license}] ${f.width}x${f.height}`);
          });
          if (!usable.length) failures++;
          continue;
        }
        if (!usable.length) {
          console.log(`  !! ${color}: no usable photograph found`);
          failures++;
          continue;
        }
        const forced = opts.picks[color];
        const pick = forced
          ? (usable.filter((f) => f.title === forced || f.title === 'File:' + forced)[0] || usable[0])
          : usable[0];
        const rel = `assets/img/gems/${color}.${extFromUrl(pick.url)}`;
        if (opts.dryRun) {
          console.log(`  ok ${color} -> ${rel} [${pick.license}] ${pick.title}`);
        } else {
          const bytes = await download(pick.url, path.join(ROOT, rel));
          console.log(`  ok ${color} -> ${rel} (${Math.round(bytes / 1024)} KB) [${pick.license}] ${pick.title}`);
        }
        images.gems[color] = rel;
        credits.push({
          file: rel, subject: color + ' gem',
          sourceLabel: pick.title,
          sourceUrl: pick.descriptionUrl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(pick.title)}`,
          author: pick.author, license: pick.license
        });
      } catch (err) {
        console.log(`  !! ${color}: ${err.message}`);
        failures++;
      }
    }
  }

  const installed = Object.keys(images.gems).length + Object.keys(images.nobles).length;
  if (opts.dryRun) {
    console.log(`\nDry run: ${installed} image(s) would be installed, ${failures} unresolved.`);
    return failures ? 1 : 0;
  }
  if (!installed) {
    console.log('\nNothing was installed, so the manifest is left alone.');
    return 1;
  }

  fs.writeFileSync(path.join(IMG_DIR, 'manifest.js'), renderManifest(images));
  fs.writeFileSync(path.join(ROOT, 'ATTRIBUTION.md'), renderAttribution(credits));
  console.log(`\nInstalled ${installed} image(s).`);
  console.log('  assets/img/manifest.js    rewritten');
  console.log('  ATTRIBUTION.md            rewritten');
  if (failures) console.log(`  ${failures} item(s) could not be resolved — the drawing is used for those.`);
  console.log('\nReload the game; gem tokens, card faces and noble tiles now use the images.');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('\nfetch-art failed:', err.message);
    console.error('If this is a network restriction, run the script somewhere with outbound HTTPS.');
    process.exit(1);
  });
}

module.exports = {
  NOBLES, GEM_QUERIES, GEM_SOURCES,
  isFreeLicense, isBitmap, looksLikeAPhotograph, NOT_A_PHOTO,
  stripHtml, extFromUrl, renderManifest, renderAttribution, parseArgs
};
