import fs from 'node:fs/promises';

const config=JSON.parse(await fs.readFile('fcc-config.json','utf8'));
const username=String(config.username||'').trim().replace(/^@+/,'');
if(!username)throw new Error('fcc-config.json has no username');

const url='https://api.freecodecamp.org/users/get-public-profile?username='+encodeURIComponent(username);
const response=await fetch(url,{
  headers:{
    accept:'application/json',
    'user-agent':'Mozilla/5.0 (compatible; QA-Automation-Roadmap/1.0)'
  }
});
if(!response.ok)throw new Error('freeCodeCamp profile request failed: HTTP '+response.status);

const data=await response.json();
const users=data?.entities?.user;
const key=users&&Object.keys(users).find(k=>k.toLowerCase()===username.toLowerCase());
if(!key)throw new Error('freeCodeCamp user not found: '+username);

const user=users[key];
if(user?.profileUI?.showTimeLine===false)throw new Error('freeCodeCamp public timeline is hidden');
const ids=Array.isArray(user.completedChallenges)
  ? user.completedChallenges.map(x=>x?.id).filter(Boolean)
  : [];
const completed=[...new Set(ids)];

const payload={
  username:user.username||key,
  completedChallengeIds:completed,
  completedCount:completed.length,
  syncedAt:new Date().toISOString()
};
await fs.writeFile('fcc-progress.json',JSON.stringify(payload,null,2)+'\n');
console.log('freeCodeCamp progress synced: '+payload.completedCount+' completed challenges.');
