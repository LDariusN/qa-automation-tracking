import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const root = process.cwd();
const html = await fs.readFile(path.join(root, 'index.html'));
const curriculum = await fs.readFile(path.join(root, 'fcc-javascript-v9.json'));
const progress = await fs.readFile(path.join(root, 'fcc-progress.json'));
const resourceSync = await fs.readFile(path.join(root, 'resource-sync.js'));
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
  ['/fcc-progress.json', {type:'application/json; charset=utf-8', body:progress}],
  ['/resource-sync.js', {type:'application/javascript; charset=utf-8', body:resourceSync}]
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
const context = await browser.newContext({timezoneId:'Europe/Bucharest'});
const page = await context.newPage();
await page.route('https://api.github.com/**',async route=>{
  const u=route.request().url();
  if(u.includes('/actions/runs')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({workflow_runs:[]})});
  if(u.includes('/users/')&&u.includes('/repos')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
});

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
    localStorage.setItem('qaRoadmapFCCSyncV5',JSON.stringify({username:'',auto:false,lastSync:null,lastAttemptAt:null,lastSyncSource:null,lastError:null,completedIds:[]}));
    localStorage.setItem('qaLastActiveUnit',JSON.stringify({
      type:'fcc',
      title:'What Is ASCII, and How Does It Work with charCodeAt() and fromCharCode()?',
      id:'stale-fcc-resume',
      url:'https://www.freecodecamp.org/learn/javascript-v9/old-stale-target',
      desc:'stale cached FCC target'
    }));
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);
  const initialState=await page.evaluate(()=>({
    completed:document.querySelector('#fccCompletedCount')?.textContent||'?',
    overall:document.querySelector('#fccOverallCount')?.textContent||'?',
    source:document.querySelector('#fccSyncSource')?.textContent||'?',
    startupError:document.documentElement.getAttribute('data-roadmap-startup-error')||'',
    dashboard:!!document.querySelector('.fcc-v5-dashboard'),
    curriculumLoaded:document.querySelectorAll('details[data-fcc-module]').length,
    localSync:localStorage.getItem('qaRoadmapFCCSyncV5')||''
  }));
  if(initialState.completed!==String(expectedJsCompleted)){
    throw new Error('Initial FCC load mismatch: expected '+expectedJsCompleted+' got '+initialState.completed+'; '+JSON.stringify(initialState)+'\nPageErrors: '+JSON.stringify(pageErrors)+'\nConsoleErrors: '+JSON.stringify(consoleErrors));
  }

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
  need('resume target matches current FCC next lesson',expectedNextFCC && (await page.locator('#resumeBtn').textContent())===('Resume: '+expectedNextFCC.title));
  need('FCC mission metadata has module name',!(await page.locator('#missionMeta').textContent()).includes('undefined'));
  need('XP visible',(await page.locator('#motXp').textContent()).includes('XP'));
  need('14 career cards',await page.locator('.career-phase').count()===14);
  need('skip link',await page.locator('.skip-link').count()===1);
  need('FCC status is live region',await page.locator('#fccStatus[role="status"][aria-live="polite"]').count()===1);
  need('four primary UX destinations',await page.locator('[data-ux-nav]').count()===4);
  need('Today nav has current-page state',await page.locator('[data-ux-nav="today"][aria-current="page"]').count()===1);
  need('recent activity is announced politely',await page.locator('#recentActivityList[aria-live="polite"]').count()===1);
  need('overall progress exposes progressbar semantics',await page.locator('.progress .bar[role="progressbar"][aria-valuemin="0"][aria-valuemax="100"]').count()===1);
  need('14 phase learning progressbars',await page.locator('.phase-track-bar[role="progressbar"]').count()===14);
  need('14 phase mastery progressbars',await page.locator('.mastery-bar[role="progressbar"]').count()===14);
  need('dense sections use progressive disclosure',await page.locator('details.ux-collapsible').count()>=1);
  need('Today is default view',await page.locator('body[data-ux-view="today"]').count()===1);
  need('recent activity panel present',await page.locator('#recentActivityPanel').count()===1);
  await page.locator('[data-ux-nav="roadmap"]').click();
  need('Roadmap view activates',await page.locator('body[data-ux-view="roadmap"]').count()===1);
  need('14 phase navigation targets',await page.locator('[data-ux-phase]').count()===14);
  await page.locator('[data-ux-phase="4"]').click();
  need('phase jump keeps roadmap view',await page.locator('body[data-ux-view="roadmap"]').count()===1);
  need('phase five target exists',await page.locator('#phase4').count()===1);
  need('focused roadmap shows one phase',await page.locator('#app .phase:visible').count()===1);
  need('selected phase label updates',String(await page.locator('#uxSelectedPhaseLabel').textContent()).includes('Phase 4'));
  need('focus mode is active',await page.locator('[data-ux-phase-mode="focus"][aria-pressed="true"]').count()===1);
  await page.locator('[data-ux-phase-mode="all"]').click();
  need('all-phases mode shows every phase',await page.locator('#app .phase:visible').count()===14);
  need('all-phases mode persists in state',await page.evaluate(()=>JSON.parse(localStorage.getItem('qaUxV1')).phaseMode==='all'));
  await page.locator('[data-ux-phase-mode="focus"]').click();
  need('returning to focus hides other phases',await page.locator('#app .phase:visible').count()===1);
  await page.locator('[data-ux-nav="resources"]').click();
  need('Resources view activates',await page.locator('body[data-ux-view="resources"]').count()===1);
  need('resource panels visible',await page.locator('#resourceSyncPanel').isVisible()&&await page.locator('.fcc-sync').isVisible());
  await page.locator('[data-ux-nav="career"]').click();
  need('Career view activates',await page.locator('body[data-ux-view="career"]').count()===1);
  need('career readiness overview visible',await page.locator('#careerOverview').isVisible());
  need('career readiness metrics rendered',await page.locator('#uxCareerOverviewBody .ux-career-score').count()===1);
  need('career gate label rendered',await page.locator('#uxCareerGate').textContent()!=='');
  need('career phase visible',await page.locator('#phase13').isVisible());
  need('other roadmap phases hidden in career',await page.locator('#app .phase:not(#phase13):visible').count()===0);
  await page.locator('[data-ux-nav="today"]').click();
  need('Today restores',await page.locator('body[data-ux-view="today"]').count()===1);
  need('roadmap phases hidden on Today',await page.locator('#app .phase:visible').count()===0);
  need('14 resource adapters rendered',await page.locator('[data-resource-adapter]').count()===14);
  need('resource registry reports 14 adapters',await page.locator('#resourceAdapterCount').textContent()==='14');
  need('resource registry has two automatic progress adapters',await page.locator('[data-sync-mode="progress"]').count()===2);
  need('resource registry has one automatic activity adapter',await page.locator('[data-sync-mode="activity"]').count()===1);
  need('resource registry has two setup adapters',await page.locator('[data-sync-mode="configured"]').count()===2);
  need('resource registry has nine manual adapters',await page.locator('[data-sync-mode="manual"]').count()===9);
  const adapterContract=await page.evaluate(()=>{
    const empty={version:1,observations:{}};
    const first=QAResourceSync.observe(empty,'synthetic',{ids:['lesson-1','lesson-2'],source:'test',observedAt:'2026-10-08T10:00:00Z'});
    const repeat=QAResourceSync.observe(first.state,'synthetic',{ids:['lesson-1','lesson-2'],source:'test',observedAt:'2026-10-08T10:01:00Z'});
    const next=QAResourceSync.observe(repeat.state,'synthetic',{ids:['lesson-1','lesson-2','lesson-3'],source:'test',observedAt:'2026-10-08T10:02:00Z'});
    const removed=QAResourceSync.observe(next.state,'synthetic',{ids:['lesson-2','lesson-3'],source:'test',observedAt:'2026-10-08T10:03:00Z'});
    return {first:first.firstProgress&&first.detected,repeat:!repeat.detected&&repeat.addedCount===0,next:next.detected&&next.addedCount===1,removed:!removed.detected&&removed.removedCount===1};
  });
  need('generic adapter first progress detection',adapterContract.first);
  need('generic adapter idempotency',adapterContract.repeat);
  need('generic adapter delta detection',adapterContract.next);
  need('generic adapter handles progress removal',adapterContract.removed);
  const progressContract=await page.evaluate(()=>{
    const empty={version:2,observations:{}};
    const first=QAResourceSync.observeProgress(empty,'video',{value:30,total:1000,minimumValue:30,thresholds:[0.02,0.25,0.5,1],observedAt:'2026-10-08T10:00:00Z'});
    const repeat=QAResourceSync.observeProgress(first.state,'video',{value:40,total:1000,minimumValue:30,thresholds:[0.02,0.25,0.5,1],observedAt:'2026-10-08T10:00:05Z'});
    const q=QAResourceSync.observeProgress(repeat.state,'video',{value:250,total:1000,minimumValue:30,thresholds:[0.02,0.25,0.5,1],observedAt:'2026-10-08T10:01:00Z'});
    return {first:first.firstProgress&&first.detected,repeat:!repeat.detected,q:q.detected&&q.crossed.includes(0.25)};
  });
  need('numeric progress first detection',progressContract.first);
  need('numeric progress idempotency before milestone',progressContract.repeat);
  need('numeric progress milestone detection',progressContract.q);
  need('TypeScript YouTube URL parser',await page.evaluate(()=>QAResourceSync.youtubeVideoId('https://www.youtube.com/watch?v=SpwzRDUQ1GI')==='SpwzRDUQ1GI'));
  need('tracked TypeScript player is present',await page.locator('.youtube-tracker').count()===1);
  need('tracked TypeScript player load button',await page.locator('#youtubeLoadBtn').count()===1);
  need('FCC sync source visible',await page.locator('#fccSyncSource').count()===1);
  need('search input',await page.locator('#globalSearch').count()===1);
  need('focus button',await page.locator('#focusBtn').count()===1);

  // YouTube player regression: a real player callback should create learning activity
  // only after meaningful playback, and repeated samples must be idempotent.
  const ytResult=await page.evaluate(async()=>{
    motState.xp=0;motState.sessions=[];motState.activityLog=[];
    resourceSyncState=QAResourceSync.ensureState(null);
    window.__ytTime=0;window.__ytDuration=1000;
    window.YT={Player:class{constructor(_id,opts){this.opts=opts;setTimeout(()=>opts.events.onReady({target:this}),0)}getCurrentTime(){return window.__ytTime}getDuration(){return window.__ytDuration}}};
    await loadYouTubeTrackerV1();
    await new Promise(r=>setTimeout(r,20));
    onYouTubeStateChangeV1({data:1});
    window.__ytTime=40;
    sampleYouTubeProgressV1();
    const afterFirst={xp:motState.xp,events:motState.activityLog.length,pct:document.getElementById('youtubeProgressPct')?.textContent||''};
    sampleYouTubeProgressV1();
    const afterRepeat={xp:motState.xp,events:motState.activityLog.length};
    window.__ytTime=250;
    sampleYouTubeProgressV1();
    const afterMilestone={xp:motState.xp,events:motState.activityLog.length,pct:document.getElementById('youtubeProgressPct')?.textContent||''};
    stopYouTubeSamplingV1();
    return {afterFirst,afterRepeat,afterMilestone};
  });
  need('YouTube player first meaningful playback creates session',ytResult.afterFirst.xp===15&&ytResult.afterFirst.events===1);
  need('YouTube repeated playback sample is idempotent',ytResult.afterRepeat.xp===15&&ytResult.afterRepeat.events===1);
  need('YouTube milestone creates activity without second session',ytResult.afterMilestone.xp===15&&ytResult.afterMilestone.events===2&&ytResult.afterMilestone.pct==='25%');

  // Load every FCC module on demand and verify all generated lessons.
  await page.locator('details[data-fcc-module]').evaluateAll(ds=>ds.forEach(d=>{d.open=true}));
  await page.locator('details[data-fcc-workshop]').evaluateAll(ds=>ds.forEach(d=>{d.open=true}));
  await page.waitForFunction(expected=>document.querySelectorAll('.fcc-v5-lesson').length===expected,expectedCurriculumTotal,{timeout:10000});
  need('all FCC lessons render after module expansion',await page.locator('.fcc-v5-lesson').count()===expectedCurriculumTotal);

  await page.locator('[data-ux-nav="roadmap"]').click();
  need('Roadmap interaction view active',await page.locator('body[data-ux-view="roadmap"]').count()===1);
  await page.locator('[data-ux-phase="0"]').click();
  need('phase one selected for roadmap interaction test',await page.locator('#phase0').isVisible());
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

  // Regression: streaks must use the user's local calendar date, not UTC.
  const streakAtLocalMidnight=await page.evaluate(()=>{
    const RealDate=Date;
    const fixed=new RealDate('2026-10-07T21:30:00Z'); // 00:30 on 2026-10-08 in Europe/Bucharest.
    class FakeDate extends RealDate{
      constructor(...args){super(args.length?args[0]:fixed.getTime())}
      static now(){return fixed.getTime()}
    }
    window.Date=FakeDate;
    motState.sessions=['2026-10-08'];
    const result=motStreak();
    window.Date=RealDate;
    return result;
  });
  need('session streak uses local date',streakAtLocalMidnight===1);

  // Product interactions.
  await page.locator('#globalSearch').fill('playwright');
  need('search returns results',await page.locator('.search-result').count()>0);
  await page.locator('#globalSearch').fill('');
  await page.locator('[data-ux-nav="today"]').click();
  await page.locator('#focusBtn').click();
  need('focus mode opens',await page.locator('#focusOverlay.open').count()===1);
  await page.evaluate(()=>{if(document.getElementById('focusOverlay')?.classList.contains('open'))toggleFocusMode()});
  await page.locator('[data-ux-nav="career"]').click();
  await page.locator('button', {hasText:'Start 10-question mock interview'}).click();
  need('interview mode opens',await page.locator('#interviewOverlay.open').count()===1);
  need('interview question shown',await page.locator('#interviewQuestion').textContent().then(x=>String(x).length>0));
  await page.locator('#interviewReveal').click();
  await page.locator('#interviewKnown').click();
  await page.locator('button', {hasText:'Next question'}).click();
  need('interview advances',await page.locator('#interviewProgress').textContent().then(x=>x.startsWith('Question 2 /')));
  await page.locator('#interviewOverlay button', {hasText:'Finish'}).click();

  await page.screenshot({path:path.join(root,'artifacts','desktop.png'),fullPage:true});

  // Automatic FCC progress detection regression. A new published snapshot must create
  // the session event, advance the mission and update the streak without a start button.
  const syncContext=await browser.newContext({timezoneId:'Europe/Bucharest'});
  const syncPage=await syncContext.newPage();
  let progressFetches=0;
  await syncPage.addInitScript(()=>localStorage.setItem('qaMotivationV2',JSON.stringify({xp:0,sessions:[],manualCompletedAt:{},reviewHistory:{},missionClaimed:{},activityLog:[]})));
  await syncPage.route('**/fcc-progress.json**',async route=>{
    progressFetches++;
    const nextData={...progressData};
    if(progressFetches>=2){
      nextData.completedChallengeIds=[...completedSet,expectedNextFCC.id];
      nextData.completedCount=nextData.completedChallengeIds.length;
      nextData.syncedAt=new Date(Date.now()+1000).toISOString();
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(nextData)});
  });
  await syncPage.goto(url,{waitUntil:'domcontentloaded'});
  await syncPage.locator('[data-ux-nav="resources"]').click();
  await syncPage.locator('#fccUsername').fill(String(progressData.username));
  await syncPage.evaluate(()=>syncFCC());
  await syncPage.waitForFunction(expected=>document.querySelector('#fccCompletedCount')?.textContent===String(expected),expectedJsCompleted+1,{timeout:10000});
  need('manual start button removed',await syncPage.locator('#missionStartBtn').count()===0);
  need('manual mission completion removed',await syncPage.locator('#missionDoneBtn').count()===0);
  need('automatic FCC activity recorded',await syncPage.locator('#missionActivity').textContent().then(x=>x.includes('freeCodeCamp')));
  need('FCC activity creates session',await syncPage.locator('#motStreak').textContent()==='1');
  need('FCC mission auto-completed',await syncPage.locator('#motXp').textContent()==='55 XP');
  need('FCC sync source',await syncPage.locator('#fccSyncSource').textContent()==='Server snapshot');
  const genericFccState=await syncPage.evaluate(()=>JSON.parse(localStorage.getItem('qaResourceSyncV1')||'{}'));
  need('FCC sync is backed by generic resource adapter',Array.isArray(genericFccState.observations?.['freecodecamp-js-v9']?.ids)&&genericFccState.observations?.['freecodecamp-js-v9']?.ids.includes(expectedNextFCC.id));
  await syncPage.locator('[data-ux-nav="roadmap"]').click();
  await syncPage.locator('[data-ux-phase="1"]').click();
  need('TypeScript phase selected before activity test',await syncPage.locator('#phase1').isVisible());
  await syncPage.locator('input[data-phase-unit="p1u0"]').check();
  need('resource switch records activity',await syncPage.evaluate(()=>{const s=JSON.parse(localStorage.getItem('qaMotivationV2')||'{}');return s.activityLog.length>=3&&s.activityLog.some(e=>String(e?.resource||'').includes('freeCodeCamp — TypeScript full course'))}));
  need('resource switch stays in same daily session',await syncPage.locator('#motStreak').textContent()==='1');
  need('resource switch adds no second session XP',await syncPage.locator('#motXp').textContent()==='55 XP');
  const rollover=await syncPage.evaluate(()=>{
    const RealDate=Date;
    const fixed=new RealDate('2026-10-09T09:00:00Z');
    class FakeDate extends RealDate{constructor(...args){super(args.length?args[0]:fixed.getTime())}static now(){return fixed.getTime()}}
    window.Date=FakeDate;
    motState.sessions=['2026-10-08'];
    motState.xp=55;
    motState.missionClaimed={'2026-10-08':true};
    recordResourceActivityV1('fcc-typescript-youtube','Next calendar day test',false);
    const result={sessions:[...motState.sessions],xp:motState.xp,streak:motStreak()};
    window.Date=RealDate;
    return result;
  });
  need('next calendar day creates a new session',rollover.sessions.includes('2026-10-09')&&rollover.sessions.length===2);
  need('next calendar day awards session XP once',rollover.xp===70);
  need('next calendar day continues streak',rollover.streak===2);
  // External adapter simulations use mocked platform responses.
  const externalContext=await browser.newContext({timezoneId:'Europe/Bucharest'});
  const externalPage=await externalContext.newPage();
  await externalPage.addInitScript(()=>{
    const realFetch=window.fetch.bind(window);
    window.fetch=async (input,init)=>{
      const u=String(typeof input==='string'?input:input?.url||'');
      if(u.includes('api.github.com/repos/')&&u.includes('/actions/runs')) return {ok:true,json:async()=>({workflow_runs:[]})};
      if(u.includes('api.github.com/repos/example/skills-introduction-to-github')) return {ok:true,json:async()=>({full_name:'example/skills-introduction-to-github',pushed_at:'2026-10-08T10:00:00Z',updated_at:'2026-10-08T10:00:00Z',html_url:'https://github.com/example/skills-introduction-to-github'})};
      if(u.includes('api.postman.com/workspaces')) return {ok:true,json:async()=>({workspaces:[{id:'w1',name:'QA',updatedAt:'2026-10-08T10:00:00Z'}]})};
      if(u.includes('api.postman.com/collections')) return {ok:true,json:async()=>({collections:[{id:'c1',name:'QA API',updatedAt:'2026-10-08T10:00:00Z'}]})};
      return realFetch(input,init);
    };
  });
  await externalPage.addInitScript(()=>localStorage.setItem('qaMotivationV2',JSON.stringify({xp:0,sessions:[],manualCompletedAt:{},reviewHistory:{},missionClaimed:{},activityLog:[]})));
  await externalPage.goto(url,{waitUntil:'domcontentloaded'});
  const externalResults=await externalPage.evaluate(async()=>{
    const originalFetch=window.fetch;
    motState.xp=0;motState.sessions=[];motState.activityLog=[];resourceSyncState=QAResourceSync.ensureState(null);
    let ghActionsCall=0,ghSkillsCall=0,postmanCall=0;
    window.fetch=async (url,opts)=>{
      const u=String(url);
      if(u.includes('/actions/runs')){
        ghActionsCall++;
        return {ok:true,json:async()=>({workflow_runs:ghActionsCall===1?([{id:8999,name:'Deploy QA Automation Roadmap',event:'schedule',conclusion:'success',updated_at:'2026-10-08T10:04:00Z'}]):([{id:8999,name:'Deploy QA Automation Roadmap',event:'schedule',conclusion:'success',updated_at:'2026-10-08T10:04:00Z'},{id:9001,name:'Roadmap QA',event:'push',conclusion:'success',updated_at:'2026-10-08T10:05:00Z'}])})};
      }
      if(u.includes('/repos/example/skills-introduction-to-github')){
        ghSkillsCall++;
        return {ok:true,json:async()=>({full_name:'example/skills-introduction-to-github',pushed_at:ghSkillsCall===1?'2026-10-08T10:00:00Z':'2026-10-08T10:06:00Z',updated_at:ghSkillsCall===1?'2026-10-08T10:00:00Z':'2026-10-08T10:06:00Z',html_url:'https://github.com/example/skills-introduction-to-github'})};
      }
      if(u.includes('api.postman.com/workspaces')){
        postmanCall++;
        return {ok:true,json:async()=>({workspaces:[{id:'w1',name:'QA',updatedAt:postmanCall===1?'2026-10-08T10:00:00Z':'2026-10-08T10:07:00Z'}]})};
      }
      if(u.includes('api.postman.com/collections')){
        return {ok:true,json:async()=>({collections:[{id:'c1',name:'QA API',updatedAt:postmanCall===1?'2026-10-08T10:00:00Z':'2026-10-08T10:07:00Z'}]})};
      }
      return {ok:true,json:async()=>({})};
    };
    const actionsFirst=await syncGitHubActionsV1(),actionsSecond=await syncGitHubActionsV1();
    document.getElementById('githubSkillsRepo').value='example/skills-introduction-to-github';
    const skillsFirst=await syncGitHubSkillsV1(),skillsSecond=await syncGitHubSkillsV1();
    document.getElementById('postmanApiKey').value='test-key';
    const postFirst=await connectPostmanV1(),postSecond=await connectPostmanV1();
    window.fetch=originalFetch;
    return {actions:[actionsFirst.result.detected,actionsSecond.result.detected],skills:[skillsFirst.result.detected,skillsSecond.result.detected],postman:[postFirst.result.detected,postSecond.result.detected],events:motState.activityLog.length,xp:motState.xp};
  });
  need('GitHub Actions first observation is baseline',externalResults.actions[0]===false);
  need('GitHub Actions new successful run is activity',externalResults.actions[1]===true);
  need('GitHub Skills first repository observation is baseline',externalResults.skills[0]===false);
  need('GitHub Skills repository change is activity',externalResults.skills[1]===true);
  need('Postman first observation is baseline',externalResults.postman[0]===false);
  need('Postman collection change is activity',externalResults.postman[1]===true);
  need('external adapters share session/XP engine',externalResults.events===3&&externalResults.xp===15);

  await syncContext.close();

  // Roadmap activity regression: checking a roadmap unit also starts a session automatically.
  const localResourceContext=await browser.newContext({timezoneId:'Europe/Bucharest'});
  const localResourcePage=await localResourceContext.newPage();
  await localResourcePage.addInitScript(()=>localStorage.setItem('qaMotivationV2',JSON.stringify({xp:0,sessions:[],manualCompletedAt:{},reviewHistory:{},missionClaimed:{},activityLog:[]})));
  await localResourcePage.goto(url,{waitUntil:'domcontentloaded'});
  await localResourcePage.locator('[data-ux-nav="roadmap"]').click();
  await localResourcePage.locator('.phase-unit input[data-roadmap-unit]').first().check();
  need('roadmap activity creates session',await localResourcePage.locator('#motStreak').textContent()==='1');
  need('roadmap activity identifies resource',await localResourcePage.locator('#missionActivity').textContent().then(x=>x.length>0));
  await localResourceContext.close();

  // Progress already made before opening the dashboard should create today's session
  // on the first detection, but the initial historical baseline must not.
  const firstDetectionContext=await browser.newContext({timezoneId:'Europe/Bucharest'});
  const firstDetectionPage=await firstDetectionContext.newPage();
  await firstDetectionPage.addInitScript(()=>localStorage.setItem('qaMotivationV2',JSON.stringify({xp:0,sessions:[],manualCompletedAt:{},reviewHistory:{},missionClaimed:{},activityLog:[]})));
  await firstDetectionPage.addInitScript(()=>localStorage.setItem('qaRoadmapFCCSyncV5',JSON.stringify({username:'',auto:true,lastSync:null,lastAttemptAt:null,lastSyncSource:null,lastError:null,completedIds:[],observedIds:[],observedAt:null})));
  await firstDetectionPage.route('**/fcc-progress.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...progressData,completedChallengeIds:[...completedSet],completedCount:completedSet.size})}));
  await firstDetectionPage.goto(url,{waitUntil:'domcontentloaded'});
  await firstDetectionPage.locator('[data-ux-nav="resources"]').click();
  await firstDetectionPage.locator('#fccUsername').fill(String(progressData.username));
  await firstDetectionPage.waitForFunction(expected=>document.querySelector('#fccCompletedCount')?.textContent===String(expected),expectedJsCompleted,{timeout:10000});
  need('first detected FCC progress starts session',await firstDetectionPage.locator('#motStreak').textContent()==='1');
  need('first detected FCC progress awards session XP',await firstDetectionPage.locator('#motXp').textContent()==='15 XP');
  await firstDetectionPage.evaluate(()=>syncFCC());
  await firstDetectionPage.waitForFunction(expected=>document.querySelector('#fccCompletedCount')?.textContent===String(expected),expectedJsCompleted,{timeout:10000});
  need('repeat FCC snapshot keeps one daily session',await firstDetectionPage.locator('#motStreak').textContent()==='1');
  need('repeat FCC snapshot adds no session XP',await firstDetectionPage.locator('#motXp').textContent()==='15 XP');
  need('repeat FCC snapshot keeps one activity event',await firstDetectionPage.evaluate(()=>JSON.parse(localStorage.getItem('qaMotivationV2')).activityLog.length===1));
  await firstDetectionContext.close();

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
