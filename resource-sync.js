(function(root){
 function normalizeIds(ids){return [...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))]}
 function ensureState(raw){let parsed=null;try{parsed=typeof raw==='string'?JSON.parse(raw):raw}catch(_e){};const state=parsed&&typeof parsed==='object'?parsed:{version:1,observations:{}};state.version=1;state.observations=state.observations&&typeof state.observations==='object'?state.observations:{};return state}
 function observe(state,adapterId,snapshot){
  const next=ensureState(state),prev=next.observations[adapterId]||{observed:false,ids:[]},current=normalizeIds(snapshot?.ids);
  const observedBefore=!!prev.observed,added=observedBefore?current.filter(id=>!prev.ids.includes(id)):[],removed=observedBefore?prev.ids.filter(id=>!current.includes(id)):[];
  const firstProgress=!observedBefore&&current.length>0,detected=firstProgress||added.length>0;
  next.observations[adapterId]={observed:true,ids:current,lastSeen:snapshot?.observedAt||new Date().toISOString(),lastDetectedAt:detected?(snapshot?.observedAt||new Date().toISOString()):(prev.lastDetectedAt||null),lastAddedCount:added.length,source:String(snapshot?.source||prev.source||'snapshot')};
  return {state:next,observedBefore,firstProgress,detected,added,removed,addedCount:added.length,removedCount:removed.length}
 }
 root.QAResourceSync={normalizeIds,ensureState,observe};
})(window);