// @vitest-environment happy-dom
//
// Gear memory — the archive compose form's camera / lens / medium fields.
//
// They were two hardcoded <option> lists (one photographer's two camera
// bodies), which made the engine's form wrong for every fork and wrong for this
// instance the moment it borrowed a lens. They are free text now, backed by a
// device-local MRU list per field (localStorage, `oaklens_gear_memory`) that
// feeds a <datalist> and prefills the next frame.
//
// What these tests pin, in order: the shell ships no gear of its own; typed
// values survive staging; remembering is honest in both directions (on = saved
// and prefilled, off = neither); and a blank field degrades to a shorter line
// rather than a dangling separator, in the console AND on the published page.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE, setPendingR2Deletes } = await import('../js/console-state.js');
const ui = await import('../js/console-ui.js');

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const GEAR_KEY = 'oaklens_gear_memory';

function seedDom() {
  document.body.innerHTML = `
    <div id="view-archive">
      <button class="btn-stage btn-full">▲ Stage to Archive</button>
    </div>
    <input id="arch-title"><input id="arch-sub"><input id="arch-loc">
    <input id="arch-cam"><datalist id="arch-cam-memory"></datalist>
    <input id="arch-lens"><datalist id="arch-lens-memory"></datalist>
    <input id="arch-med"><datalist id="arch-med-memory"></datalist>
    <input type="checkbox" id="arch-gear-remember" checked>
    <input id="arch-hash">
    <div id="archive-preview-wrap"></div><div id="archive-filename"></div>
    <div id="arch-tag-preview"></div>
    <div id="archive-display"></div><span id="archive-count"></span><span id="archive-stats"></span>
    <div id="buffer-display"></div><span id="buffer-count"></span><span id="buffer-stats"></span>
    <div id="wall-list"></div><span id="wall-stats"></span>
    <div id="library-display"></div><span id="library-count"></span><span id="library-stats"></span>
    <div id="upload-queue-panel"></div><div id="upload-queue-status"></div>
  `;
}

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;

/** Fill the compose form for a new frame and stage it. */
function stageFrame({ title = 'Frame', camera = '', lens = '', medium = '' } = {}) {
  $('arch-title').value = title;
  $('arch-cam').value = camera;
  $('arch-lens').value = lens;
  $('arch-med').value = medium;
  const view = $('view-archive');
  view.dataset.filename = `${title.toLowerCase().replace(/\s+/g, '-')}.webp`;
  view.dataset.uploadState = 'done';
  ui.archiveStage();
}

beforeEach(() => {
  localStorage.clear();
  seedDom();
  STATE.buffer = []; STATE.archive = []; STATE.posts = [];
  STATE.wallpapers = []; STATE.barrel = []; STATE.friends = []; STATE.library = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0 };
  setPendingR2Deletes([]);
  ui.archiveClear();   // also drops archiveEditId, which outlives a test otherwise
});

// ---------- the engine ships no gear of its own ----------

describe('the console shell carries no hardcoded gear', () => {
  const shell = read('dev/field-console.html');

  it('camera / lens / medium are free-text inputs backed by a datalist', () => {
    for (const [id, list] of [
      ['arch-cam', 'arch-cam-memory'],
      ['arch-lens', 'arch-lens-memory'],
      ['arch-med', 'arch-med-memory'],
    ]) {
      expect(shell).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*list="${list}"`));
      expect(shell).toContain(`<datalist id="${list}"></datalist>`);
      // …and no <select> wearing the same id, which is what shipped before.
      expect(shell).not.toMatch(new RegExp(`<select[^>]*id="${id}"`));
    }
  });

  it('the datalists start empty — suggestions are earned, not seeded', () => {
    // A seeded list is instance identity in engine code by another name: the
    // first fork to install would inherit somebody else's camera.
    const gearMarkup = shell.slice(shell.indexOf('id="arch-cam"'), shell.indexOf('id="arch-hash"'));
    expect(gearMarkup).not.toContain('<option');
  });
});

// ---------- free text survives the round trip ----------

describe('staging free-text gear', () => {
  it('keeps whatever was typed, trimmed', () => {
    stageFrame({ title: 'Borrowed', camera: '  Mamiya RB67 ', lens: '90mm', medium: 'Film' });
    expect(STATE.archive[0]).toMatchObject({ camera: 'Mamiya RB67', lens: '90mm', medium: 'Film' });
  });

  it('accepts a frame with no gear at all', () => {
    stageFrame({ title: 'Untagged' });
    expect(STATE.archive[0]).toMatchObject({ camera: '', lens: '', medium: '' });
  });

  it('editing a frame with a blank field leaves it blank', () => {
    STATE.archive = [{ id: 'a1', title: 'Half', filename: 'half.webp', camera: 'Scanner', lens: '', medium: '' }];
    ui.archiveEdit('a1');
    expect(val('arch-cam')).toBe('Scanner');
    expect(val('arch-lens')).toBe('');
    expect(val('arch-med')).toBe('');
  });
});

// ---------- remembering, in both directions ----------

describe('remembering is on', () => {
  it('saves the staged gear and prefills the next frame with it', () => {
    stageFrame({ title: 'One', camera: 'Mamiya RB67', lens: '90mm', medium: 'Film' });
    expect(ui.gearMemory('camera')).toEqual(['Mamiya RB67']);
    // archiveStage → archiveClear: the form comes back carrying the same gear.
    expect(val('arch-cam')).toBe('Mamiya RB67');
    expect(val('arch-lens')).toBe('90mm');
    expect(val('arch-med')).toBe('Film');
    expect(val('arch-title')).toBe('');   // …but nothing frame-specific
  });

  it('orders most-recent-first and dedupes case-insensitively', () => {
    stageFrame({ title: 'One', camera: 'Rolleiflex' });
    stageFrame({ title: 'Two', camera: 'Mamiya RB67' });
    stageFrame({ title: 'Three', camera: 'rolleiflex' });
    // The newest spelling wins — it is the one just typed.
    expect(ui.gearMemory('camera')).toEqual(['rolleiflex', 'Mamiya RB67']);
  });

  it('caps the list at 12 so a suggestion list never becomes an archive', () => {
    for (let i = 0; i < 15; i++) stageFrame({ title: `F${i}`, camera: `Body ${i}` });
    const saved = ui.gearMemory('camera');
    expect(saved).toHaveLength(12);
    expect(saved[0]).toBe('Body 14');
  });

  it('remembers an update to an existing frame too', () => {
    STATE.archive = [{ id: 'a1', title: 'Old', filename: 'old.webp', camera: 'Scanner' }];
    ui.archiveEdit('a1');
    $('arch-cam').value = 'Epson V600';
    ui.archiveStage();
    expect(STATE.archive[0].camera).toBe('Epson V600');
    expect(ui.gearMemory('camera')).toEqual(['Epson V600']);
  });
});

describe('remembering is off', () => {
  beforeEach(() => { $('arch-gear-remember').checked = false; });

  it('saves nothing and blanks the fields for the next frame', () => {
    stageFrame({ title: 'Borrowed', camera: 'A friend’s Leica', lens: '35mm' });
    expect(STATE.archive[0].camera).toBe('A friend’s Leica');   // the frame still records it
    expect(ui.gearMemory('camera')).toEqual([]);                      // the device does not
    expect(val('arch-cam')).toBe('');
    expect(val('arch-lens')).toBe('');
  });

  it('survives a corrupt memory blob instead of throwing', () => {
    localStorage.setItem(GEAR_KEY, '{ not json');
    expect(() => ui.restoreGearMemory()).not.toThrow();
    expect(ui.gearMemory('camera')).toEqual([]);
  });
});

// ---------- the suggestion list ----------

describe('the suggestion lists', () => {
  it('offer saved values first, then gear the archive already uses', () => {
    STATE.archive = [
      { id: 'a1', title: 'A', camera: 'Zorki 4' },
      { id: 'a2', title: 'B', camera: 'Hasselblad 500' },
      { id: 'a3', title: 'C', camera: 'Zorki 4' },          // dupe — one option only
    ];
    localStorage.setItem(GEAR_KEY, JSON.stringify({ remember: true, camera: ['Mamiya RB67'] }));
    ui.refreshGearOptions();
    const options = [...$('arch-cam-memory').querySelectorAll('option')].map(o => o.value);
    expect(options).toEqual(['Mamiya RB67', 'Hasselblad 500', 'Zorki 4']);
  });

  it('escape their values — the list is built with innerHTML', () => {
    STATE.archive = [{ id: 'a1', title: 'A', camera: '<img src=x onerror=alert(1)>' }];
    ui.refreshGearOptions();
    const list = $('arch-cam-memory');
    expect(list.querySelectorAll('img')).toHaveLength(0);
    expect(list.querySelector('option').value).toBe('<img src=x onerror=alert(1)>');
  });

  it('archiveForgetGear drops the saved list, leaving what is typed alone', () => {
    localStorage.setItem(GEAR_KEY, JSON.stringify({ remember: true, camera: ['Rolleiflex'] }));
    $('arch-cam').value = 'Still typing this';
    globalThis.confirm = () => true;
    ui.archiveForgetGear();
    expect(ui.gearMemory('camera')).toEqual([]);
    expect($('arch-cam-memory').querySelectorAll('option')).toHaveLength(0);
    expect(val('arch-cam')).toBe('Still typing this');
  });

  it('forgetting cannot un-publish a frame — archive gear stays suggested', () => {
    stageFrame({ title: 'One', camera: 'Rolleiflex' });
    globalThis.confirm = () => true;
    ui.archiveForgetGear();
    expect(ui.gearMemory('camera')).toEqual([]);              // the saved list is gone
    const options = [...$('arch-cam-memory').querySelectorAll('option')].map(o => o.value);
    expect(options).toEqual(['Rolleiflex']);                  // …the frame's own gear is not
  });
});

// ---------- a blank field must not leave a dangling separator ----------

describe('the gear line degrades', () => {
  it('drops blank parts instead of rendering an empty pipe', () => {
    expect(ui.gearLine({ camera: 'Zorki 4', lens: '', medium: 'Film' }, ' | ')).toBe('Zorki 4 | Film');
    expect(ui.gearLine({ camera: '', lens: '', medium: '' }, ' | ')).toBe('');
    expect(ui.gearLine({ camera: 'Zorki 4' }, ' | ')).toBe('Zorki 4');
  });

  it('the archive card shows a dash when a frame carries no gear', () => {
    STATE.archive = [{ id: 'a1', title: 'Untagged', filename: 'x.webp', camera: '', lens: '', medium: '' }];
    ui.renderArchive();
    expect($('archive-display').querySelector('.tag').textContent.trim()).toBe('—');
  });

  it('the published page joins the same way (page-archive.js)', () => {
    const src = read('js/page-archive.js');
    expect(src).toMatch(/function gearLine\(entry\)/);
    // The old unconditional join is what left the dangling separator.
    expect(src).not.toMatch(/\$\{entry\.camera\}<span class="pipe">/);
  });
});
