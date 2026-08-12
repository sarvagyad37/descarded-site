/* Injects the shared header/mobile-menu (_partials/nav.html) into every page
   between <!-- NAV:START --> and <!-- NAV:END -->. Edit the nav in ONE place
   (_partials/nav.html), then run:

     node build.mjs

   Zero dependencies, no bundler — this only stitches static HTML back into
   static HTML. Pages stay plain files; nothing renders client-side. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const NAV_TEMPLATE = readFileSync(join(DIR, '_partials/nav.html'), 'utf8');

// route -> which nav link(s) get aria-current="page"
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

const START = '<!-- NAV:START -->';
const END = '<!-- NAV:END -->';

let changed = 0;
for (const [file, active] of Object.entries(PAGES)) {
  const path = join(DIR, file);
  const html = readFileSync(path, 'utf8');
  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    console.warn(`skip ${file}: NAV markers not found`);
    continue;
  }
  const before = html.slice(0, startIdx + START.length);
  const after = html.slice(endIdx);
  const nav = renderNav(active);
  const next = `${before}\n${nav}${after}`;
  if (next !== html) {
    writeFileSync(path, next);
    console.log(`updated ${file}`);
    changed++;
  } else {
    console.log(`unchanged ${file}`);
  }
}
console.log(`done — ${changed} file(s) updated`);
