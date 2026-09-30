import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = process.cwd();
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const curriculum = JSON.parse(await fs.readFile(path.join(root, 'fcc-javascript-v9.json'), 'utf8'));
const progress = JSON.parse(await fs.readFile(path.join(root, 'fcc-progress.json'), 'utf8'));

const jsdomErrors = [];
const consoleMessages = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', err => jsdomErrors.push(String(err?.stack || err)));
virtualConsole.on('error', msg => consoleMessages.push(String(msg)));

const dom = new JSDOM(html, {
  url: 'http://roadmap.test/index.html?qa-jsdom=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.open = () => null;
    window.confirm = () => true;
    window.alert = () => {};
    window.fetch = async input => {
      const url = String(input);
      if (url.includes('fcc-javascript-v9.json')) {
        return { ok: true, status: 200, json: async () => curriculum, text: async () => JSON.stringify(curriculum) };
      }
      if (url.includes('fcc-progress.json')) {
        return { ok: true, status: 200, json: async () => progress, text: async () => JSON.stringify(progress) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
  }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await sleep(1200);

const { window } = dom;
const { document } = window;
const failures = [];
const need = (name, ok) => { if (!ok) failures.push(name); };

need('14 phases', document.querySelectorAll('.phase').length === 14);
need('14 phase trackers', document.querySelectorAll('.phase-tracker').length === 14);
need('14 mastery summaries', document.querySelectorAll('.mastery-summary').length === 14);
need('160 roadmap units', document.querySelectorAll('input[data-roadmap-unit]').length === 160);
need('320 mastery controls', document.querySelectorAll('input[data-mastery]').length === 320);
need('FCC dashboard', !!document.querySelector('.fcc-v5-dashboard'));
need('1341 FCC lessons', document.querySelectorAll('.fcc-v5-lesson').length === 1341);
need('207 completed FCC tasks', document.getElementById('fccCompletedCount')?.textContent === '207');
need('FCC progress nonzero', document.getElementById('fccProgressPct')?.textContent !== '0%');
need('today mission populated', !['', 'Loading your next mission…'].includes(document.getElementById('missionTitle')?.textContent || ''));
need('14 career cards', document.querySelectorAll('.career-phase').length === 14);
need('no jsdom errors', jsdomErrors.length === 0);
need('no console errors', consoleMessages.length === 0);

const unitInputs = document.querySelectorAll('.phase-unit input[type="checkbox"][data-roadmap-unit]');
const first = unitInputs.item(0);
need('first roadmap unit exists', !!first);

if (first) {
  const key = first.dataset.phaseUnit;
  const getRow = () => document.querySelector('[data-phase-row="' + key + '"]');

  let row = getRow();
  need('mastery disabled before learning', row?.querySelectorAll('input[data-mastery][disabled]').length === 2);

  first.click();
  await sleep(30);

  row = getRow();
  const controls = row ? [...row.querySelectorAll('input[data-mastery]')] : [];
  need('mastery controls enable after learning', controls.length === 2 && controls.every(control => !control.disabled));

  controls[0]?.click();
  controls[1]?.click();
  await sleep(30);

  row = getRow();
  need('MASTERED state', row?.classList.contains('mastered'));
  need('MASTERED badge', row?.querySelector('.mastery-badge')?.textContent === 'MASTERED');
  need('global learned count stays at one', document.getElementById('done')?.textContent === '1');

  const stored = JSON.parse(window.localStorage.getItem('qaMasteryV1') || '{}');
  need('mastery persists', stored[key]?.recall === true && stored[key]?.apply === true);
}

if (failures.length) {
  console.error('QA_FAIL');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('QA_PASS');
console.log('14 phases');
console.log('160 roadmap units');
console.log('320 mastery controls');
console.log('1341 FCC lessons');
console.log('207 synced FCC completions');
console.log('Learned → Recall → Apply → MASTERED');
console.log('Mastery persistence OK');
