// The served HTML pages, as they exist in *this* checkout.
//
// Several guards sweep "every public page" — pre-paint script ordering, the
// shared site-common.js load, the strict-CSP inline-script ban. They each kept
// their own hardcoded list, which meant three lists to update whenever a page
// was added, and — the reason this file exists — three lists that break in the
// extracted `oaklens-os` tree, which deliberately drops the pages that are
// OAKLENS marketing rather than engine (`/os`, the `/dev` landing page).
//
// So the list is filtered by what is on disk. A page that is not shipped is
// not tested; a page that IS shipped cannot escape the sweep by being left out
// of somebody's array.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const present = (p) => existsSync(join(ROOT, p));

/**
 * Public pages carrying the full site chrome (nav, footer, subscribe).
 * These load site-common.js.
 */
export const CHROME_PAGES = [
  'index.html',
  'about/index.html',
  'os/index.html',
  'archive/index.html',
  'wall/index.html',
  'field-notes/index.html',
  'listen/index.html',
  // One composed card at its own address (/card/<id>). It carries the same full
  // chrome as the pages above — nav, footer, site-common.js — so it belongs in
  // the same sweep. It was parked in THEMED_PAGES only, with a comment citing
  // "the /listen reason"; /listen is right here, which a code review noticed
  // before anyone else did.
  'card/index.html',
  'support/index.html',
  '404.html',
].filter(present);

/**
 * Every served page with a themed <head> — the chrome pages plus the
 * sub-pages that render their own layout (buffer, single post) and the
 * `/dev` landing page where one is shipped.
 */
export const THEMED_PAGES = [
  ...CHROME_PAGES,
  'archive/buffer/index.html',
  'field-notes/post.html',
  'dev/index.html',
].filter(present);
