// The fake server runs in the browser, unlike Bitrix's real database. Filter
// references first and materialize only the response page, so fixture allocation
// does not turn a 50-row server reply into thousands of main-thread object copies.
export function selectStartupTaskPage(tasks, params = {}, overrides = {}) {
  const filter=params.filter || {}, after=Number(filter['>ID'] || 0);
  const upper=filter['<=ID']==null ? Infinity : Number(filter['<=ID']);
  const changed=String(filter['>=CHANGED_DATE'] || ''), changedAt=Date.parse(changed);
  const selected=filter.GROUP_ID ?? filter['=GROUP_ID'];
  const groups=selected==null ? null : new Set((Array.isArray(selected)?selected:[selected]).map(String));
  const groupOf=task=>String(overrides?.[String(task.ID ?? task.id)] ?? task.GROUP_ID ?? task.groupId ?? task.group?.id ?? '1');
  const entries=tasks.filter(task=>{
    const id=Number(task.id);
    if (!(id>after) || !(id<=upper) || (changed && !(Date.parse(task.changedDate)>=changedAt))) return false;
    if (!groups && filter['>GROUP_ID']==null) return true;
    const group=groupOf(task);
    return (!groups || groups.has(group)) && (filter['>GROUP_ID']==null || Number(group)>Number(filter['>GROUP_ID']));
  });
  if(params.order?.ID==='asc') entries.sort((a,b)=>Number(a.id)-Number(b.id));
  if(params.order?.ID==='desc') entries.sort((a,b)=>Number(b.id)-Number(a.id));
  const start=Math.max(0,Number(params.start)||0);
  const page=entries.slice(start,start+50).map(task=>({...task,GROUP_ID:groupOf(task)}));
  return {tasks:page,total:entries.length,next:start+page.length<entries.length?start+page.length:null};
}
