import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const baseline=readFileSync(new URL('./fixtures/render-baseline-8.0.66.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('\tfunction '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n\tfunction ',start+2));};
const shared=['_getDialogControlItemFilterMeta','_matchesDialogControlGlobalFilters','_getDialogControlNotificationStatus','_isDialogControlUnreadMeta','matchByFilters'].map(extract).join('\n');
let reads=0, unique=false;
const groups=Array.from({length:40},(_,i)=>({id:'g'+i}));
const sandbox={Map,Set,Number,String,Array,Math,filters:{},_currentPanelMode:'chats',IS_OL_FRAME:false,window:{},
 normId:v=>String(v||''),_isDialogControlFolder:x=>x.type==='folder',_isDialogControlItemUnavailable:x=>!!x.unavailable,
 _getDialogRecentMeta:()=>null,_getDialogControlAssignedColor:x=>x.color||'',
 _getDialogControlItemLiveMeta:x=>{reads++;return x.meta;},_getDialogControlUniqueOnly:()=>unique,
 _getDialogControlViewPrefs:()=>({sortMode:'date',sortDirection:'desc',unreadOnly:false})};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../extension/native-catalog.js',import.meta.url),'utf8'),sandbox);
sandbox._getDialogControlPlacementIndex=items=>sandbox.window.__PENA_NATIVE_CATALOG__.createPlacementIndex(items,groups);
vm.runInContext(shared+'\n'+baseline+'\nconst baselineSort=_getDialogControlItemsForView;\n'+extract('_getDialogControlCounterProjection')+'\n'+extract('_getDialogControlItemsForView'),sandbox);
// Function declarations are hoisted: preserve the old sorter in a separate scope.
const oldSortContext=vm.createContext({...sandbox});
vm.runInContext(baseline,oldSortContext);
const serialize=result=>JSON.stringify({groups:[...result.groupStatuses],folders:[...result.folderStatuses],segment:result.segmentStatus});
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const report={scope:'Deterministic projection microbenchmark in Node; not device CPU percentage or live portal latency',runtimeSha256:createHash('sha256').update(source).digest('hex'),baselineCommit:'5b7bcc8205c8de7a3b415b40349522cc486809d5',cases:[]};
const measure=fn=>{const times=[];let output,readCount;for(let i=0;i<9;i++){reads=0;const start=performance.now();output=fn();const ms=performance.now()-start;readCount=reads;if(i>=2)times.push(ms);}return {output,ms:median(times),metaReads:readCount};};
for(const size of [1000,5000,10000]){
 const folders=Array.from({length:100},(_,i)=>({id:'f'+i,type:'folder',segmentId:'g'+i%40}));
 const dialogs=Array.from({length:size},(_,i)=>({id:'chat'+i,title:'Project '+i,segmentId:i%7===0?'missing':'g'+(i+9)%40,
  folderId:i%6===0?'orphan':i%5===0?'':'f'+i%100,color:i%3?'#00ff00':'',unavailable:i%97===0,
  meta:{title:'Project '+i,lastMessageTs:i%11===0?0:(i*7919)%100003,hasUnread:i%3===0,unreadCount:i%8,hasMention:i%13===0,hasLater:i%17===0}}));
 const items=[...folders,...dialogs], index=new Map();
 for(unique of [false,true]) for(const active of ['', 'g9']) for(const searching of [false,true]){
  sandbox.filters.query=searching?'':'Project 1';
  const tabs=[{id:'',isAll:true},...groups];
  const visibleFolders=sandbox._getDialogControlNativeFoldersForSegment(items,active);
  const args=[items,tabs,active,visibleFolders,index,searching,unique];
  const before=measure(()=>sandbox.baselineCounters(...args));
  const after=measure(()=>sandbox._getDialogControlCounterProjection(...args));
  assert.equal(serialize(after.output),serialize(before.output),`Counter output ${size}/${unique}/${active}/${searching}`);
  assert.ok(after.metaReads<=size,'Resolve at most one live metadata snapshot per dialog');
  report.cases.push({operation:'counters',size,unique,active,searching,beforeMs:before.ms,afterMs:after.ms,beforeReads:before.metaReads,afterReads:after.metaReads});
 }
 sandbox.filters.query='';
 for(const sortMode of ['date','color']) for(const sortDirection of ['asc','desc']) for(const unreadOnly of [false,true]){
  const prefs=()=>({sortMode,sortDirection,unreadOnly});sandbox._getDialogControlViewPrefs=prefs;oldSortContext._getDialogControlViewPrefs=prefs;
  const before=measure(()=>oldSortContext._getDialogControlItemsForView(items,index));
  const after=measure(()=>sandbox._getDialogControlItemsForView(items,index));
  assert.deepEqual(Array.from(after.output,x=>x.id),Array.from(before.output,x=>x.id));
  assert.ok(after.metaReads<=size);
  if(sortMode==='date'&&!unreadOnly&&sortDirection==='desc')report.cases.push({operation:'date-sort',size,beforeMs:before.ms,afterMs:after.ms,beforeReads:before.metaReads,afterReads:after.metaReads});
 }
 // A later projection must see in-place updates, not a stale persistent cache.
 dialogs[1].meta={...dialogs[1].meta,hasUnread:true,unreadCount:123};dialogs[1].folderId='f3';
 const args=[items,[{id:'',isAll:true},...groups],'',folders,index,false,unique];
 assert.equal(serialize(sandbox._getDialogControlCounterProjection(...args)),serialize(sandbox.baselineCounters(...args)));
}
// Exercise the actual batch helper and single-row logic with deterministic rows.
let preferenceReads=0;
sandbox._isDialogNativeLazyMode=()=>true;sandbox._getDialogControlViewPrefs=()=>{preferenceReads++;return {unreadOnly:unique};};
sandbox._getDialogRowFilterMeta=row=>row.meta;sandbox._matchesDialogControlNativeFilter=()=>true;
vm.runInContext(extract('_applyDialogControlRowFilter')+'\n'+extract('_applyDialogControlRowFilters'),sandbox);
const rows=Array.from({length:10000},(_,i)=>({meta:{title:'Project '+i,hasUnread:i%2===0},hidden:false,classList:{toggle(_key,value){rows[i].hidden=value;}}}));
for(unique of [false,true,false]){
 preferenceReads=0;const start=performance.now();for(const row of rows)sandbox._applyDialogControlRowFilter(row);const beforeMs=performance.now()-start,beforeReads=preferenceReads,expected=rows.map(x=>x.hidden);
 preferenceReads=0;const afterStart=performance.now();sandbox._applyDialogControlRowFilters(rows);const afterMs=performance.now()-afterStart;
 assert.deepEqual(rows.map(x=>x.hidden),expected);assert.equal(preferenceReads,1);assert.equal(beforeReads,rows.length);
 report.cases.push({operation:'row-filter-preferences',size:rows.length,unreadOnly:unique,beforeMs,afterMs,beforeReads,afterReads:preferenceReads});
}
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/render-performance.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS measured render projections: identical counters/order/visibility, fresh next batch, bounded metadata and preference reads');
console.log(JSON.stringify(report.cases.filter(x=>x.size===10000&&((x.operation==='counters'&&!x.unique&&x.active===''&&!x.searching)||x.operation==='date-sort'||x.operation==='row-filter-preferences')),null,2));
