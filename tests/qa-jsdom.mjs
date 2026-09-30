import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = process.cwd();
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const curriculum = await fs.readFile(path.join(root, 'fcc-javascript-v9.json'), 'utf8');
const progress = await fs.readFile(path.join(root, 'fcc-progress.json'), 'utf8');

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', err => errors.push(String(err?.stack || err)));

const dom = new JSDOM(html, {
  url: 'http://roadmap.test/index.html?qa-jsdom=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.open = () => null;
    window.alert = () => {};
    window.confirm = () => true;
    window.fetch = async input => {
      const url = String(input);
      const file = url.includes('fcc-javascript-v9.json')
        ? curriculum
        : url.includes('fcc-progress.json')
          ? progress
          : null;
      if (file === null) {
        return {
          ok: false,
          status: 404,
          json: async () => ({})
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(file),
        text: async () => file
      };
    };
  }
});

const { window } = dom;
const { document } = window;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await sleep(1200);

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
need('FCC progress is nonzero', document.getElementById('fccProgressPct')?.textContent !== '0%');
need('today mission populated', (document.getElementById('missionTitle')?.textContent || '') !== 'Loading your next mission…');
need('14 career cards', document.querySelectorAll('.career-phase').length === 14);
need('no jsdom errors', errors.length === 0);

const first = document.querySelector('.phase-unit input[data-roadmap-unit]');
if (!first) {
  failures.push('first roadmap unit exists');
} else {
  const key = first.dataset.phaseUnit;
  const getRow = () => document.querySelector('[data-phase-row="'+key+'"]');
  let row = getRow();
  need('mastery disabled before learning', row?.querySelectorAll('input[data-mastery][disabled]').length === 2);

  first.click();
  await sleep(20);
  row = getRow();
  const controls = row ? [...row.querySelectorAll('input[data-mastery]')] : [];
  need('mastery enables after learning', controls.length === 2 && controls.every(x => !x.disabled));

  controls[0]?.click();
  controls[1]?.click();
  await sleep(20);
  row = getRow();
  need('row becomes MASTERED', row?.classList.contains('mastered'));
  need('MASTERED badge shown', row?.querySelector('.mastery-badge')?.textContent === 'MASTERED');
  need('learned count remains one', document.getElementById('done')?.textContent === '1');

  const stored = JSON.parse(window.localStorage.getItem('qaMasteryV1') || '{}');
  need('mastery persisted', stored[key]?.recall === true && stored[key]?.apply === true);
}

if (failures.length) {
  console.error('QA_FAIL\n' + failures.join('\n'));
  process.exit(1);
}

console.log('QA_PASS');
console.log('14 phases');
console.log('160 roadmap units');
console.log('320 mastery controls');
console.log('1341 FCC lessons');
console.log('207 synced FCC completions');
console.log('Mastery: Learned → Recall → Apply → MASTERED');
console.log('Persistence: OK');
