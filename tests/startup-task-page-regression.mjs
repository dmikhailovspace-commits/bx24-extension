import assert from 'node:assert/strict';
import {selectStartupTaskPage} from './lib/startup-task-page.mjs';
const rows=Array.from({length:4149},(_,i)=>({id:String(i*3+1),title:`Task ${i}`,groupId:String(i%4),changedDate:i%2?'2026-09-08T10:00:00Z':'2026-09-07T10:00:00Z',timeSpentInLogs:i%13===0?'60':null}));
const group=(task,overrides)=>({...task,GROUP_ID:String(overrides?.[String(task.ID??task.id)]??task.GROUP_ID??task.groupId??task.group?.id??'1')});
function legacy(tasks,params={},overrides={}) {
  const filter=params.filter||{},after=Number(filter['>ID']||0),changed=String(filter['>=CHANGED_DATE']||'');
  let entries=tasks.map(t=>group(t,overrides)).filter(task=>{
    const g=group(task,overrides).GROUP_ID,selected=filter.GROUP_ID??filter['=GROUP_ID'];
    return (selected==null||(Array.isArray(selected)?selected:[selected]).map(String).includes(g))&&
      (filter['>GROUP_ID']==null||Number(g)>Number(filter['>GROUP_ID']))&&Number(task.id)>after&&
      (!changed||Date.parse(task.changedDate)>=Date.parse(changed))&&(filter['<=ID']==null||Number(task.id)<=Number(filter['<=ID']));
  });
  if(params.order?.ID==='asc')entries=entries.slice().sort((a,b)=>Number(a.id)-Number(b.id));
  if(params.order?.ID==='desc')entries=entries.slice().sort((a,b)=>Number(b.id)-Number(a.id));
  const start=Math.max(0,Number(params.start)||0),page=entries.slice(start,start+50);
  return {tasks:page,total:entries.length,next:start+page.length<entries.length?start+page.length:null};
}
const before=structuredClone(rows),overrides={'1':'0','4':'3','7':'1','10':null};
let cases=0;
for(const filter of [{},{'>ID':300},{'>ID':300,'<=ID':601},{'<=ID':0},{GROUP_ID:['1','3']},{'=GROUP_ID':0},{'>GROUP_ID':0},{GROUP_ID:[]},{'>=CHANGED_DATE':'2026-09-08T00:00:00Z'},{'>=CHANGED_DATE':'invalid'},{GROUP_ID:['2'],'>ID':123,'<=ID':4800,'>GROUP_ID':0},{'<=ID':null}]) {
  for(const order of [{},{ID:'asc'},{ID:'desc'}]) for(const start of [0,50,5000]) {
    const params={filter,order,start};
    assert.deepEqual(selectStartupTaskPage(rows,params,overrides),legacy(rows,params,overrides)); cases++;
  }
}
overrides['1']='2';
assert.deepEqual(selectStartupTaskPage(rows,{filter:{GROUP_ID:'2'}},overrides),legacy(rows,{filter:{GROUP_ID:'2'}},overrides));
assert.deepEqual(rows,before,'Fake server must not mutate source tasks');
let copies=0;
const observed=rows.map(row=>new Proxy(row,{ownKeys(target){copies++;return Reflect.ownKeys(target);}}));
assert.equal(selectStartupTaskPage(observed,{filter:{'>ID':300,'<=ID':600},order:{ID:'asc'}}).tasks.length,50);
assert.equal(copies,50,'Only returned rows may be materialized on the browser main thread');
console.log(`PASS startup task-page fixture: ${cases+1} exact legacy comparisons; 50 copies for a 50-row reply, source unchanged`);
