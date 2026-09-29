import fs from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/freeCodeCamp/freeCodeCamp/main/';
const response = await fetch(BASE + 'curriculum/structure/superblocks/javascript-v9.json');
if (!response.ok) throw new Error('Failed to fetch JavaScript v9 superblock: ' + response.status);
const superblock = await response.json();

const modules = [];
const jobs = [];

for (const chapter of superblock.chapters ?? []) {
  if (chapter.dashedName !== 'javascript') continue;
  for (const module of chapter.modules ?? []) {
    if (module.moduleType === 'exam') continue;
    const entry = {
      name: module.dashedName,
      moduleType: module.moduleType ?? null,
      lessons: []
    };
    modules.push(entry);
    for (const block of module.blocks ?? []) jobs.push({ module: entry, block });
  }
}

let cursor = 0;
async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= jobs.length) return;

    const { module, block } = jobs[i];
    const r = await fetch(BASE + 'curriculum/structure/blocks/' + block + '.json');
    if (!r.ok) throw new Error('Failed to fetch block ' + block + ': ' + r.status);

    const data = await r.json();
    for (const challenge of data.challengeOrder ?? []) {
      module.lessons.push({
        id: challenge.id,
        title: challenge.title,
        block: data.dashedName ?? block,
        kind: data.blockLabel ?? 'lesson'
      });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(12, jobs.length) }, worker));

const seen = new Set();
const lessons = [];

for (const module of modules) {
  module.lessons = module.lessons.filter(lesson => {
    if (seen.has(lesson.id)) return false;
    seen.add(lesson.id);
    return true;
  });
  lessons.push(...module.lessons);
}

const payload = {
  source: 'freeCodeCamp/freeCodeCamp',
  curriculum: 'javascript-v9',
  ref: 'main',
  generatedAt: new Date().toISOString(),
  modules,
  lessons,
  total: lessons.length
};

await fs.writeFile('fcc-javascript-v9.json', JSON.stringify(payload, null, 2) + '\n');
console.log('Generated fcc-javascript-v9.json with ' + lessons.length + ' unique curriculum tasks across ' + modules.length + ' modules.');
