import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const source=readFileSync(process.env.PENA_COUNTER_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8');
const names=['_fetchDialogCounterSnapshot','_applyDialogCounterSnapshot','_getDialogControlNotificationStatus'];
if(source.includes('function _getPendingDialogNativeCounterAt(')) names.push('_getPendingDialogNativeCounterAt');
function extract(name) {
 const match=new RegExp('\\n\\t(?:async )?function '+name+'\\(').exec(source);
 assert.ok(match,name);
 const start=match.index+1,next=/\n\t(?:async )?function /.exec(source.slice(start+1));
 return source.slice(start,next?start+1+next.index:undefined);
}
let now=1000,release;
const context=vm.createContext({
 Date:{now:()=>now}, Map,Set,Math,Number,Object,
 _dialogRecentMeta:new Map(), _dialogRecentRepositoryReady:false,
 _dialogRecentCountersAt:0,_dialogRecentCountersError:'',
 _dialogNativeStatusRefreshRequest:null,
 _isDialogNativeSourceGenerationCurrent:()=>true,
 _getDialogNativeExpectedAuditScopeKey:()=>'testscope',
 normId:id=>String(id||''),
 _getDialogRecentMandatoryItems:()=>new Map(),_ensureDialogRecentMandatoryMeta:()=>{},
 _getDialogRecentUniqueMeta:target=>[...new Set(target.values())],
 _isDialogControlFolder:item=>item.type==='folder',_isDialogControlItemUnavailable:()=>false,
 _getDialogControlItemLiveMeta:item=>context._dialogRecentMeta.get(item.id),
 _getDialogNativeCounterMeta:()=>null,
 _callBxRestPageWithTimeout:()=>new Promise(resolve=>release=resolve),
 _parseDialogCounterSnapshot:data=>({...data,fetchedAt:now})
});
for(const name of names) vm.runInContext(extract(name),context);
const phases=[];
async function phase(name,run) {
 try { await run(); phases.push({name,status:'PASS'}); }
 catch(error) { phases.push({name,status:'FAIL',error:String(error.stack)}); }
}
function record(id,count,at,extra={}) {
 const value={id,entityKind:'chat',unreadCount:count,hasUnread:count>0,hasLater:false,hasMention:false,counterFetchedAt:at,counterConfirmedAt:at,...extra};
 context._dialogRecentMeta.set(id,value);return value;
}
function snapshot(count,extra={}) {
 return {complete:true,coverage:{chatCounts:true,chatManual:true},states:new Map([['chat1',{unreadCount:count,manualUnread:false,countSeen:true,manualSeen:true}]]),...extra};
}
await phase('queued native counter event fences an older API response only for that dialog',async()=>{
 context._dialogRecentMeta.clear();now=2000;
 const first=record('chat1',0,500),other=record('chat2',7,500);
 context._dialogNativeStatusRefreshRequest={scopeKey:'testscope',ids:new Set(['chat1']),observedById:new Map([['chat1',1500]]),observedAt:1500};
 try {
  const old=snapshot(9,{startedAt:1000,fetchedAt:2000});old.states.set('chat2',{unreadCount:2,countSeen:true,manualSeen:true});
  context._applyDialogCounterSnapshot(context._dialogRecentMeta,old);
  assert.equal(first.counterConfirmedAt,500);assert.equal(first.unreadCount,0);assert.equal(other.unreadCount,2);
  context._applyDialogCounterSnapshot(context._dialogRecentMeta,snapshot(0,{startedAt:1600,fetchedAt:2100}));
  assert.equal(first.counterConfirmedAt,2100,'A genuinely newer counter snapshot must still apply');
 } finally {context._dialogNativeStatusRefreshRequest=null;}
});
for(const invalid of ['identity','source']) await phase('queued event from another '+invalid+' cannot fence current counters',async()=>{
 context._dialogRecentMeta.clear();const item=record('chat1',0,500);
 context._dialogNativeStatusRefreshRequest={scopeKey:invalid==='identity'?'oldscope':'testscope',ids:new Set(['chat1']),observedById:new Map([['chat1',1500]]),observedAt:1500};
 context._isDialogNativeSourceGenerationCurrent=()=>invalid!=='source';
 try {context._applyDialogCounterSnapshot(context._dialogRecentMeta,snapshot(2,{startedAt:1000,fetchedAt:2000}));assert.equal(item.unreadCount,2);}
 finally {context._dialogNativeStatusRefreshRequest=null;context._isDialogNativeSourceGenerationCurrent=()=>true;}
});
for(const [name,before,live,reply] of [
 ['read during counter request cannot resurrect old notifications',9,0,9],
 ['new message during counter request cannot lose its notifications',0,4,0],
 ['new reminder during counter request survives an older empty response',0,0,0]
]) await phase(name,async()=>{
 context._dialogRecentMeta.clear(); now=1000;record('chat1',before,500);
 const pending=context._fetchDialogCounterSnapshot();
 now=1100;const newer=record('chat1',live,now,{hasLater:name.startsWith('new reminder')});
 now=2000;release({data:snapshot(reply)});const fetched=await pending;
 context._applyDialogCounterSnapshot(context._dialogRecentMeta,fetched);
 assert.equal(newer.unreadCount,live);assert.equal(newer.hasLater,name.startsWith('new reminder'));
 assert.equal(newer.counterFetchedAt,1100);
 const status=context._getDialogControlNotificationStatus([{id:'chat1'}],new Map());
 assert.equal(status.unreadCount,live||(newer.hasLater?1:0));
});
await phase('same millisecond read wins and unrelated stale dialogs still receive the snapshot',async()=>{
 context._dialogRecentMeta.clear(); now=3000;
 record('chat1',0,now);const old=record('chat2',7,500);
 const pending=context._fetchDialogCounterSnapshot();now=4000;
 const data=snapshot(8);data.states.set('chat2',{unreadCount:2,countSeen:true,manualSeen:true});
 release({data});context._applyDialogCounterSnapshot(context._dialogRecentMeta,await pending);
 assert.equal(context._dialogRecentMeta.get('chat1').unreadCount,0);assert.equal(old.unreadCount,2);
});
await phase('partial namespace cannot clear unspecified counters or reminders',async()=>{
 context._dialogRecentMeta.clear();record('chat1',3,100,{hasLater:true});
 const partial={complete:false,fetchedAt:500,startedAt:400,coverage:{chatCounts:true,chatManual:false},states:new Map()};
 context._applyDialogCounterSnapshot(context._dialogRecentMeta,partial);
 assert.equal(context._dialogRecentMeta.get('chat1').unreadCount,3);
 assert.equal(context._dialogRecentMeta.get('chat1').hasLater,true);
});
await phase('dedicated snapshot overrides provisional recent-list counts received during the same load',async()=>{
 context._dialogRecentMeta.clear();now=5000;
 const pending=context._fetchDialogCounterSnapshot();
 now=5100;record('chat1',99,now,{counterConfirmedAt:0});
 now=5200;release({data:snapshot(3)});
 context._applyDialogCounterSnapshot(context._dialogRecentMeta,await pending);
 assert.equal(context._dialogRecentMeta.get('chat1').unreadCount,3);
 assert.equal(context._dialogRecentMeta.get('chat1').counterConfirmedAt,5200);
});
await phase('out of order snapshots cannot roll back a newer counter or freshness watermark',async()=>{
 context._dialogRecentMeta.clear();record('chat1',5,6000);context._dialogRecentCountersAt=6000;
 context._applyDialogCounterSnapshot(context._dialogRecentMeta,snapshot(0,{startedAt:1000,fetchedAt:2000}));
 assert.equal(context._dialogRecentMeta.get('chat1').unreadCount,5);assert.equal(context._dialogRecentCountersAt,6000);
});
const report={sourceSha256:createHash('sha256').update(source).digest('hex'),phases};
mkdirSync('tests/artifacts',{recursive:true});
writeFileSync(process.env.PENA_COUNTER_REPORT||'tests/artifacts/notification-counter-race-regression.json',JSON.stringify(report,null,2)+'\n');
for(const result of phases) console.log(result.status+' '+result.name+(result.error?'\n'+result.error:''));
assert.ok(phases.every(x=>x.status==='PASS'));
