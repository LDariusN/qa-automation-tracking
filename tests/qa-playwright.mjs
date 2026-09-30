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
if(expectedCurriculumTotal !== curriculumLessons.length) throw new Error('FCC curriculum total does not match lesson count.');
if(expectedFccOverall < 0) throw new Error('FCC overall completion count is negative.');

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

await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
const page = await context.newPage();

const pageErrors=[];
const consoleErrors=[];
page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));
page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())});

const failures=[];
const need=(name,ok)=>{if(!ok)failures.push(name)};
const url='http://127.0.0.1:'+port+'/index.html?qa=1';
const expectedNextFCC=curriculumLessons.find(lesson=>!completedSet.has(lesson.id));

try{
  await page.addInitScript(()=>{
    localStorage.setItem('qaLastActiveUnit',JSON.stringify({
      type:'fcc',
      title:'What Is ASCII, and How Does It Work with charCodeAt() and fromCharCode()?',
      id:'stale-fcc-resume',
      url:'https://www.freecodecamp.org/learn/javascript-v9/old-stale-target',
      desc:'stale cached FCC target'
    }));
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(expected=>document.querySelector('#fccCompletedCount')?.textContent===String(expected),expectedJsCompleted,{timeout:10000});

  need('14 phases',await page.locator('.phase').count()===14);
  need('14 phase trackers',await page.locator('.phase-tracker').count()===14);
  need('14 mastery summaries',await page.locator('.mastery-summary').count()===14);
  need('160 roadmap units',await page.locator('input[data-roadmap-unit]').count()===160);
  need('320 mastery controls',await page.locator('input[data-mastery]').count()===320);
  need('FCC dashboard',await page.locator('.fcc-v5-dashboard').count()===1);
  need('FCC lesson DOM is lazy',await page.locator('.fcc-v5-lesson').count()<expectedCurriculumTotal);
  need('FCC overall count',await page.locator('#fccOverallCount').textContent()===String(expectedFccOverall));
  need('JS v9 completed count matches curriculum',await page.locator('#fccCompletedCount').textContent()===String(expectedJsCompleted));
  const expectedPct=expectedCurriculumTotal?Math.round(expectedJsCompleted/expectedCurriculumTotal*100):0;
  need('JS v9 progress matches curriculum',await page.locator('#fccProgressPct').textContent()===expectedPct+'%');
  const expectedFirstFccTitles=[
    'What Is JavaScript, and How Does It Work with HTML and CSS?',
    'What Is a Data Type, and What Are the Different Data Types in JavaScript?',
    'What Are Variables, and What Are Guidelines for Naming JavaScript Variables?',
    'How Do let and const Work Differently When It Comes to Variable Declaration, Assignment, and Reassignment?',
    'What Is a String in JavaScript, and What Is String Immutability?',
    'What Is String Concatenation, and How Can You Concatenate Strings with Variables?',
    'What Is console.log Used For, and How Does It Work?',
    'What Is the Role of Semicolons in JavaScript, and Programming in General?',
    'What Are Comments in JavaScript, and When Should You Use Them?',
    'Step 1'
  ];
  const actualFirstFccTitles=curriculumLessons.slice(0,expectedFirstFccTitles.length).map(lesson=>lesson.title);
  need('FCC lesson order matches source canary',JSON.stringify(actualFirstFccTitles)===JSON.stringify(expectedFirstFccTitles));
  need('mission populated',!['','Loading your next mission…'].includes((await page.locator('#missionTitle').textContent())||''));
  need('resume follows current FCC next lesson',expectedNextFCC && (await page.locator('#resumeBtn').textContent())===('Resume: '+expectedNextFCC.title));
  need('resume does not use stale FCC target',!(await page.locator('#resumeBtn').textContent()).includes('ASCII, and How Does It Work with charCodeAt()'));
  need('FCC mission metadata has module name',!(await page.locator('#missionMeta').textContent()).includes('undefined'));
  need('XP visible',(await page.locator('#motXp').textContent()).includes('XP'));
  need('14 career cards',await page.locator('.career-phase').count()===14);
  need('skip link',await page.locator('.skip-link').count()===1);
  need('FCC status is live region',await page.locator('#fccStatus[role="status"][aria-live="polite"]').count()===1);
  need('search input',await page.locator('#globalSearch').count()===1);
  need('focus button',await page.locator('#focusBtn').count()===1);

  // Load every FCC module on demand and verify all generated lessons.
  await page.locator('details[data-fcc-module]').evaluateAll(ds=>ds.forEach(d=>{d.open=true}));
  await page.waitForFunction(expected=>document.querySelectorAll('.fcc-v5-lesson').length===expected,expectedCurriculumTotal,{timeout:10000});
  need('all FCC lessons render after module expansion',await page.locator('.fcc-v5-lesson').count()===expectedCurriculumTotal);

  const first=page.locator('.phase-unit input[data-roadmap-unit]').first();
  const key=await first.getAttribute('data-phase-unit');
  const row=()=>page.locator('[data-phase-row="'+key+'"]');
  need('first learning checkbox exists',await first.count()===1);
  need('recall disabled before learning',await row().locator('input[data-mastery="recall"][disabled]').count()===1);
  need('apply disabled before learning',await row().locator('input[data-mastery="apply"][disabled]').count()===1);
  await row().evaluate(el=>el.dataset.qaIdentity='stable');
  await first.check();
  await page.waitForTimeout(50);
  need('no full phase rerender on learning change',await row().getAttribute('data-qa-identity')==='stable');
  need('recall enabled after learning',await row().locator('input[data-mastery="recall"]:not([disabled])').count()===1);
  need('apply enabled after learning',await row().locator('input[data-mastery="apply"]:not([disabled])').count()===1);

  await row().locator('input[data-mastery="recall"]').check();
  await row().locator('input[data-mastery="apply"]').check();
  need('mastery evidence fields appear',await row().locator('input[data-mastery-evidence]:not(.hidden)').count()===2);
  need('not mastered without evidence',await row().locator('.mastery-badge').textContent()==='IN PROGRESS');
  await row().locator('input[data-mastery-evidence="recall"]').fill('I can explain this concept clearly.');
  await row().locator('input[data-mastery-evidence="apply"]').fill('I used it in a coding exercise.');
  need('MASTERED after evidence',await row().evaluate(el=>el.classList.contains('mastered')));
  need('mastered badge',await row().locator('.mastery-badge').textContent()==='MASTERED');

  const stored=await page.evaluate(()=>({
    phase:JSON.parse(localStorage.getItem('qaPhaseUnitsV1')||'{}'),
    mastery:JSON.parse(localStorage.getItem('qaMasteryV1')||'{}')
  }));
  need('learning persisted',stored.phase[key]===true);
  need('mastery persisted',stored.mastery[key]?.recall===true&&stored.mastery[key]?.apply===true);
  need('recall evidence persisted',stored.mastery[key]?.recallEvidence==='I can explain this concept clearly.');
  need('apply evidence persisted',stored.mastery[key]?.applyEvidence==='I used it in a coding exercise.');

  // Product interactions.
  await page.locator('#globalSearch').fill('playwright');
  need('search returns results',await page.locator('.search-result').count()>0);
  await page.locator('#globalSearch').fill('');
  await page.locator('#focusBtn').click();
  need('focus mode opens',await page.locator('#focusOverlay.open').count()===1);
  await page.locator('#focusOverlay button', {hasText:'Exit focus mode'}).click();
  await page.locator('button', {hasText:'Start 10-question mock interview'}).click();
  need('interview mode opens',await page.locator('#interviewOverlay.open').count()===1);
  need('interview question shown',await page.locator('#interviewQuestion').textContent().then(x=>String(x).length>0));
  await page.locator('#interviewReveal').click();
  await page.locator('#interviewKnown').click();
  await page.locator('button', {hasText:'Next question'}).click();
  need('interview advances',await page.locator('#interviewProgress').textContent().then(x=>x.startsWith('Question 2 /')));
  await page.locator('#interviewOverlay button', {hasText:'Finish'}).click();

  await page.screenshot({path:path.join(root,'artifacts','desktop.png'),fullPage:true});

  // Mobile layout/accessibility smoke.
  const mobile=await context.newPage();
  const mobileErrors=[];
  mobile.on('pageerror',e=>mobileErrors.push(String(e?.stack||e)));
  mobile.on('console',msg=>{if(msg.type()==='error')mobileErrors.push(msg.text())});
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(url,{waitUntil:'domcontentloaded'});
  await mobile.waitForFunction(expected=>document.querySelector('#fccCompletedCount')?.textContent===String(expected),expectedJsCompleted,{timeout:10000});
  need('mobile no horizontal overflow',await mobile.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  need('mobile search visible',await mobile.locator('#globalSearch').isVisible());
  need('mobile no runtime/console errors',mobileErrors.length===0);
  await mobile.screenshot({path:path.join(root,'artifacts','mobile.png'),fullPage:true});

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('.phase').length===14,{timeout:10000});
  await page.waitForFunction(expected=>document.querySelectorAll('.fcc-v5-lesson').length>0,expectedCurriculumTotal,{timeout:10000});
  need('mastered persists after reload',await row().locator('.mastery-badge').textContent()==='MASTERED');

  need('desktop no runtime/console errors',pageErrors.length===0&&consoleErrors.length===0);
  if(failures.length) throw new Error('QA_FAIL\n'+failures.join('\n')+'\nDesktopErrors: '+JSON.stringify(pageErrors)+'\nConsoleErrors: '+JSON.stringify(consoleErrors));

  console.log('QA_PASS');
  console.log('14 phases');
  console.log('160 roadmap units');
  console.log('320 mastery controls');
  console.log(expectedCurriculumTotal+' FCC lessons generated');
  console.log(expectedJsCompleted+' JS v9 completions');
  console.log('Lazy FCC rendering OK');
  console.log('Learned → Recall → Apply → evidence → MASTERED');
  console.log('Search, focus mode and interview mode OK');
  console.log('Desktop + mobile visual smoke artifacts created');
  console.log('Persistence after reload OK');
} finally{
  await context.close();
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
