import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const root = process.cwd();
const html = await fs.readFile(path.join(root, 'index.html'));
const curriculum = await fs.readFile(path.join(root, 'fcc-javascript-v9.json'));
const progress = await fs.readFile(path.join(root, 'fcc-progress.json'));
const curriculumData = JSON.parse(curriculum);
const progressData = JSON.parse(progress);
const curriculumLessons = Array.isArray(curriculumData?.lessons) ? curriculumData.lessons : [];
const expectedCurriculumTotal = Number.isInteger(curriculumData?.total) ? curriculumData.total : curriculumLessons.length;
const completedSet = new Set(progressData?.completedChallengeIds || []);
const expectedJsCompleted = curriculumLessons.filter(lesson => completedSet.has(lesson.id)).length;
const expectedFccOverall = Number.isInteger(progressData?.completedCount) ? progressData.completedCount : completedSet.size;
if(expectedCurriculumTotal !== curriculumLessons.length) {
  throw new Error('FCC curriculum total does not match lesson count: '+expectedCurriculumTotal+' vs '+curriculumLessons.length);
}
if(expectedFccOverall < 0) throw new Error('FCC overall completion count is negative: '+expectedFccOverall);


const routes = new Map([
  ['/index.html', {type:'text/html; charset=utf-8', body:html}],
  ['/fcc-javascript-v9.json', {type:'application/json; charset=utf-8', body:curriculum}],
  ['/fcc-progress.json', {type:'application/json; charset=utf-8', body:progress}]
]);

const server = http.createServer((req,res)=>{
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  const entry = routes.get(pathname);
  if(!entry){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'content-type':entry.type,'cache-control':'no-store'});
  res.end(entry.body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port = server.address().port;

const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
const page = await context.newPage();

const pageErrors=[];
const consoleErrors=[];
page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));
page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});

const failures=[];
const need=(name,ok)=>{if(!ok)failures.push(name)};

try{
  await page.goto('http://127.0.0.1:'+port+'/index.html?qa=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction((expected)=>document.querySelector('#fccCompletedCount')?.textContent===String(expected),expectedJsCompleted,{timeout:10000});

  need('14 phases',await page.locator('.phase').count()===14);
  need('14 phase trackers',await page.locator('.phase-tracker').count()===14);
  need('14 mastery summaries',await page.locator('.mastery-summary').count()===14);
  need('160 roadmap units',await page.locator('input[data-roadmap-unit]').count()===160);
  need('320 mastery controls',await page.locator('input[data-mastery]').count()===320);
  need('FCC dashboard',await page.locator('.fcc-v5-dashboard').count()===1);
  need('FCC lesson count matches generated curriculum',await page.locator('.fcc-v5-lesson').count()===expectedCurriculumTotal);
  need('FCC overall count',await page.locator('#fccOverallCount').textContent()===String(expectedFccOverall));
  need('JS v9 completed count matches curriculum',await page.locator('#fccCompletedCount').textContent()===String(expectedJsCompleted));
  const expectedPct = expectedCurriculumTotal ? Math.round((expectedJsCompleted/expectedCurriculumTotal)*100) : 0;
  need('JS v9 progress matches curriculum',await page.locator('#fccProgressPct').textContent()===expectedPct+'%');
  need('mission populated',!['','Loading your next mission…'].includes((await page.locator('#missionTitle').textContent())||''));
  need('XP visible',(await page.locator('#motXp').textContent()).includes('XP'));
  need('14 career cards',await page.locator('.career-phase').count()===14);
  need('no page errors',pageErrors.length===0);
  need('no console errors',consoleErrors.length===0);

  const first=page.locator('.phase-unit input[data-roadmap-unit]').first();
  need('first learning checkbox exists',await first.count()===1);
  if(await first.count()){
    const key=await first.getAttribute('data-phase-unit');
    const row=()=>page.locator('[data-phase-row="'+key+'"]');

    need('recall disabled before learning',await row().locator('input[data-mastery="recall"][disabled]').count()===1);
    need('apply disabled before learning',await row().locator('input[data-mastery="apply"][disabled]').count()===1);

    await first.check();
    await page.waitForTimeout(100);

    need('recall enabled after learning',await row().locator('input[data-mastery="recall"]:not([disabled])').count()===1);
    need('apply enabled after learning',await row().locator('input[data-mastery="apply"]:not([disabled])').count()===1);

    await row().locator('input[data-mastery="recall"]').check();
    await row().locator('input[data-mastery="apply"]').check();
    await page.waitForTimeout(100);

    need('mastered state',await row().evaluate(el=>el.classList.contains('mastered')));
    need('mastered badge',await row().locator('.mastery-badge').textContent()==='MASTERED');
    need('global learned count is one',await page.locator('#done').textContent()==='1');

    const stored=await page.evaluate(()=>({
      phase:JSON.parse(localStorage.getItem('qaPhaseUnitsV1')||'{}'),
      mastery:JSON.parse(localStorage.getItem('qaMasteryV1')||'{}')
    }));
    need('learning persisted',stored.phase[key]===true);
    need('mastery persisted',stored.mastery[key]?.recall===true&&stored.mastery[key]?.apply===true);

    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('.phase').length===14,{timeout:10000});
    await page.waitForFunction(expected=>document.querySelectorAll('.fcc-v5-lesson').length===expected,expectedCurriculumTotal,{timeout:10000});
    need('mastered persists after reload',await row().locator('.mastery-badge').textContent()==='MASTERED');
  }

  if(failures.length){
    throw new Error('QA_FAIL\n'+failures.join('\n')+'\nPageErrors: '+JSON.stringify(pageErrors)+'\nConsoleErrors: '+JSON.stringify(consoleErrors));
  }

  console.log('QA_PASS');
  console.log('14 phases');
  console.log('160 roadmap units');
  console.log('320 mastery controls');
  console.log(expectedCurriculumTotal+' FCC lessons');
  console.log('FCC overall: '+expectedFccOverall);
  console.log('JS v9 completed: '+expectedJsCompleted);
  console.log('Learned → Recall → Apply → MASTERED');
  console.log('Persistence after reload OK');
} finally{
  await context.close();
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
