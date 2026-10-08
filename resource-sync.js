(function(root){
  function normalizeIds(ids){return [...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))]}
  function ensureState(raw){
    let parsed=null;try{parsed=typeof raw==='string'?JSON.parse(raw):raw}catch(_e){}
    const state=parsed&&typeof parsed==='object'?parsed:{version:2,observations:{}};
    state.version=2;
    state.observations=state.observations&&typeof state.observations==='object'?state.observations:{};
    return state;
  }
  function observe(state,adapterId,snapshot){
    const next=ensureState(state),prev=next.observations[adapterId]||{observed:false,ids:[]},current=normalizeIds(snapshot?.ids);
    const observedBefore=!!prev.observed,added=observedBefore?current.filter(id=>!prev.ids.includes(id)):[],removed=observedBefore?prev.ids.filter(id=>!current.includes(id)):[];
    const firstProgress=!observedBefore&&current.length>0,detected=firstProgress||added.length>0;
    const seenAt=snapshot?.observedAt||new Date().toISOString();
    next.observations[adapterId]={observed:true,ids:current,lastSeen:seenAt,lastDetectedAt:detected?seenAt:(prev.lastDetectedAt||null),lastAddedCount:added.length,lastRemovedCount:removed.length,source:String(snapshot?.source||prev.source||'snapshot')};
    return {state:next,observedBefore,firstProgress,detected,added,removed,addedCount:added.length,removedCount:removed.length};
  }
  function observeProgress(state,adapterId,snapshot){
    const next=ensureState(state),prev=next.observations[adapterId]||{observed:false,progress:0,milestones:[]};
    const value=Math.max(0,Number(snapshot?.value)||0),total=Math.max(0,Number(snapshot?.total)||0);
    const fraction=total>0?Math.min(1,value/total):null,percent=fraction==null?null:Math.round(fraction*100);
    const thresholds=Array.isArray(snapshot?.thresholds)&&snapshot.thresholds.length?snapshot.thresholds:[0.10,0.25,0.50,0.75,0.90,1];
    const previousFraction=Number(prev.fraction)||0,minimumValue=Math.max(0,Number(snapshot?.minimumValue)||0),minimumFraction=Math.max(0,Number(snapshot?.minimumFraction)||0);
    const previousMilestones=Array.isArray(prev.milestones)?prev.milestones:[];
    const crossed=fraction==null?[]:thresholds.filter(t=>fraction>=t&&!previousMilestones.includes(t));
    const firstProgress=!prev.observed&&((value>=minimumValue)||(fraction!=null&&fraction>=minimumFraction));
    const detected=firstProgress||crossed.length>0;
    const seenAt=snapshot?.observedAt||new Date().toISOString();
    const milestones=[...new Set([...previousMilestones,...crossed])].sort((a,b)=>a-b);
    next.observations[adapterId]={observed:true,value,total,fraction,percent,milestones,lastSeen:seenAt,lastDetectedAt:detected?seenAt:(prev.lastDetectedAt||null),lastAddedCount:crossed.length,source:String(snapshot?.source||prev.source||'progress')};
    return {state:next,observedBefore:!!prev.observed,firstProgress,detected,crossed,fraction,percent,value,total,milestones};
  }
  async function githubJson(url){
    const r=await fetch(url,{headers:{Accept:'application/vnd.github+json'}});
    if(!r.ok)throw new Error('GitHub API HTTP '+r.status);
    return r.json();
  }
  function parseRepo(raw){
    const s=String(raw||'').trim().replace(/^https?:\/\/github\.com\//,'').replace(/\.git$/,'').replace(/^\/+|\/+$/g,'');
    const parts=s.split('/');
    return parts.length>=2&&parts[0]&&parts[1]?parts[0]+'/'+parts[1]:null;
  }
  async function syncGitHubActions(repo,options={}){
    const name=parseRepo(repo);if(!name)throw new Error('Invalid GitHub repository');
    const workflowName=String(options?.workflowName||'Roadmap QA').trim();
    const data=await githubJson('https://api.github.com/repos/'+name+'/actions/runs?per_page=100&exclude_pull_requests=true');
    const runs=Array.isArray(data?.workflow_runs)?data.workflow_runs:[];
    const qualifying=runs.filter(x=>x?.conclusion==='success'&&(!workflowName||String(x?.name||'')===workflowName)&&x?.event!=='schedule');
    return {repo:name,workflowName,ids:qualifying.map(x=>'run:'+x.id),latest:qualifying[0]||null,successfulRuns:qualifying.length};
  }
  async function syncGitHubSkills(owner){
    const login=String(owner||'').trim();
    if(!login)throw new Error('GitHub owner is required');
    const repos=await githubJson('https://api.github.com/users/'+encodeURIComponent(login)+'/repos?per_page=100&sort=updated');
    const skills=(Array.isArray(repos)?repos:[]).filter(r=>/^skills[-_]/i.test(String(r?.name||''))||/skills[-_]/i.test(String(r?.full_name||''))).slice(0,12);
    const ids=skills.map(r=>'repo:'+r.full_name+':'+String(r.pushed_at||r.updated_at||''));
    return {owner:login,repositories:skills.map(r=>({name:r.full_name,pushedAt:r.pushed_at||null,updatedAt:r.updated_at||null,url:r.html_url})),ids};
  }
  async function syncPostman(apiKey,workspaceId){
    const key=String(apiKey||'').trim();if(!key)throw new Error('Postman API key is required');
    const headers={'X-API-Key':key,Accept:'application/json'};
    const wsUrl='https://api.postman.com/workspaces?limit=100';
    const wr=await fetch(wsUrl,{headers});if(!wr.ok)throw new Error('Postman workspaces HTTP '+wr.status);
    const wd=await wr.json(),workspaces=Array.isArray(wd?.workspaces)?wd.workspaces:[];
    const selected=workspaceId?workspaces.filter(w=>String(w?.id)===String(workspaceId)):(workspaces);
    const targetWorkspaceIds=selected.length?selected.map(w=>w.id):workspaces.map(w=>w.id);
    let collections=[];
    const queryWorkspace=workspaceId?'&workspace='+encodeURIComponent(workspaceId):'';
    const cr=await fetch('https://api.postman.com/collections?limit=100&offset=0'+queryWorkspace,{headers});
    if(!cr.ok)throw new Error('Postman collections HTTP '+cr.status);
    const cd=await cr.json();collections=Array.isArray(cd?.collections)?cd.collections:[];
    const ids=[
      ...selected.map(w=>'workspace:'+w.id+':'+String(w.updatedAt||w.createdAt||'')),
      ...collections.map(c=>'collection:'+c.id+':'+String(c.updatedAt||c.createdAt||''))
    ];
    return {workspaceIds:targetWorkspaceIds,workspaces:selected,collections,ids};
  }
  function youtubeVideoId(raw){
    const s=String(raw||'').trim();
    if(/^[A-Za-z0-9_-]{11}$/.test(s))return s;
    try{
      const u=new URL(s);
      if(u.hostname.includes('youtu.be'))return u.pathname.replace(/^\//,'').slice(0,11)||null;
      if(u.searchParams.get('v'))return u.searchParams.get('v');
      const m=u.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);return m?m[1]:null;
    }catch(_e){return null}
  }
  function loadYouTubeApi(){
    if(root.YT?.Player)return Promise.resolve(root.YT);
    return new Promise((resolve,reject)=>{
      const previous=root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady=()=>{try{if(typeof previous==='function')previous();}finally{resolve(root.YT)}};
      const existing=document.querySelector('script[data-youtube-iframe-api]');
      if(existing){const deadline=Date.now()+10000;(function poll(){if(root.YT?.Player)resolve(root.YT);else if(Date.now()<deadline)setTimeout(poll,50);else reject(new Error('YouTube IFrame API timed out'))})();return}
      const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.dataset.youtubeIframeApi='1';script.onerror=()=>reject(new Error('YouTube IFrame API failed to load'));document.head.appendChild(script);
    });
  }
  root.QAResourceSync={normalizeIds,ensureState,observe,observeProgress,parseRepo,githubJson,syncGitHubActions,syncGitHubSkills,syncPostman,youtubeVideoId,loadYouTubeApi};
})(window);