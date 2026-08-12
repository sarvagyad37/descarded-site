/* Injects shared partials into every page between named markers. Edit a
   partial once, then run:

     node build.mjs

   Zero dependencies, no bundler — this only stitches static HTML back into
   static HTML. Pages stay plain files; nothing renders client-side.

   Blocks:
     NAV      <!-- NAV:START -->      _partials/nav.html      (all 6 pages)
     PRESALE  <!-- PRESALE:START -->  _partials/presale-modal.html  (all 6 pages)

   404.html intentionally has its own simpler header and no presale modal
   markers — it's not part of this. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const NAV_TEMPLATE = readFileSync(join(DIR, '_partials/nav.html'), 'utf8');
const PRESALE_TEMPLATE = readFileSync(join(DIR, '_partials/presale-modal.html'), 'utf8');

// route -> which nav link gets aria-current="page"
const PAGES = {
  'index.html': 'home',
  'about.html': 'about',
  'artists.html': 'artists',
  'conduct.html': null,
  'privacy.html': null,
  'contact.html': null,
};

function renderNav(active) {
  return NAV_TEMPLATE
    .replaceAll('__HOME_CURRENT__', active === 'home' ? ' aria-current="page"' : '')
    .replaceAll('__ABOUT_CURRENT__', active === 'about' ? ' aria-current="page"' : '')
    .replaceAll('__ARTISTS_CURRENT__', active === 'artists' ? ' aria-current="page"' : '');
}

function injectBlock(html, blockName, rendered, file) {
  const start = `<!-- ${blockName}:START -->`;
  const end = `<!-- ${blockName}:END -->`;
  const startIdx = html.indexOf(start);
  const endIdx = html.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    console.warn(`skip ${file}: ${blockName} markers not found`);
    return html;
  }
  const before = html.slice(0, startIdx + start.length);
  const after = html.slice(endIdx);
  return `${before}\n${rendered}${after}`;
}

let changed = 0;
for (const [file, active] of Object.entries(PAGES)) {
  const path = join(DIR, file);
  const original = readFileSync(path, 'utf8');

  let next = injectBlock(original, 'NAV', renderNav(active), file);
  next = injectBlock(next, 'PRESALE', PRESALE_TEMPLATE, file);

  if (next !== original) {
    writeFileSync(path, next);
    console.log(`updated ${file}`);
    changed++;
  } else {
    console.log(`unchanged ${file}`);
  }
}
console.log(`done — ${changed} file(s) updated`);
