import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const model=createRequire(import.meta.url)('../extension/native-catalog.js');
const source=readFileSync('extension/injected.js','utf8');
const results=[];
const titleRule={id:'title',name:'Alpha',enabled:true,folderId:'folder:b',match:'all',conditions:[{field:'title',op:'contains',value:'Alpha'}]};
function fixture(){
 const storage=new Map(),metas=new Map(),scope='resort.invalid~7',key=`pena.automation.v1.${scope}.tasks`;
 const items=[{id:'folder:a',type:'folder',segmentId:'group:a'},{id:'folder:b',type:'folder',segmentId:'group:b'},{id:'chat1',taskId:'1',title:'Alpha',folderId:'folder:a'}];
 metas.set('chat1',{id:'chat1',taskId:'1',displayTitle:'Alpha',automationFacts:{title:'Alpha',responsibleId:'7'}});
 let enabled=true,quota=false;
 const context={window:{__PENA_NATIVE_CATALOG__:model},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(quota&&k.endsWith('.review'))throw new Error('QuotaExceededError');storage.set(k,v);},removeItem:k=>storage.delete(k)},
  document:{hidden:false,dispatchEvent(){},querySelectorAll:()=>[]},navigator:{onLine:true},Event:class{},setTimeout:()=>1,clearTimeout(){},
  _getDialogTimeIdentityScopeKey:()=>scope,_pMode:()=> 'tasks',_getDialogRecentMeta:id=>metas.get(id),_isPenaExtensionEnabled:()=>enabled,
  _getDialogRecentUniqueMeta:()=>[...metas.values()],_dialogRecentMeta:metas,_setDialogRecentMeta:(target,meta)=>target.set(meta.id,meta),_scheduleDialogRecentCacheWrite(){},
  _isDialogControlFolder:item=>item.type==='folder',_isDialogControlItemUnavailable:item=>!!item.unavailable,_getDialogControlItemsForMode:()=>items};
 const at=source.indexOf('\tlet _dialogAutomationTimer = null;'),end=source.indexOf('\tfunction _openDialogAutomation(',at);
 runInNewContext(source.slice(at,end)+'\nthis.api={apply:_applyDialogAutomation,tickets:_dialogAutomationTickets,exclude:_excludeDialogAutomationTransfers,dirty:_dialogAutomationDirtyTasks};',context);
 const config=(auto=false,rules=[titleRule])=>storage.set(key,JSON.stringify({version:1,rules,excludedIds:[],autoAcceptTransfers:auto}));config();
 return {items,item:items[2],metas,storage,key,scope,config,quota:value=>quota=value,enabled:value=>enabled=value,api:context.api,apply:()=>context.api.apply('tasks',items),tickets:()=>context.api.tickets('tasks')};
}
function check(name,run){try{run();results.push({name,passed:true});console.log('PASS '+name);}catch(error){results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}
check('Manual mode creates a proposal; enabling auto accepts it once and updates group',()=>{
 const f=fixture();assert.equal(f.apply(),0);assert.equal(f.tickets().length,1);assert.equal(f.item.folderId,'folder:a');
 f.config(true);assert.equal(f.apply(),1);assert.equal(f.item.folderId,'folder:b');assert.equal(f.item.segmentId,'group:b');assert.equal(f.tickets().length,0);assert.equal(f.apply(),0);
});
check('Disabling auto restores confirmation for subsequent changes',()=>{
 const f=fixture();f.config(true);f.apply();f.config(false,[{...titleRule,folderId:'folder:a'}]);assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:b');assert.equal(f.tickets().length,1);
});
check('Auto cannot move excluded dialogs, even after facts or priority changes',()=>{
 const f=fixture();f.apply();assert.equal(f.tickets().length,1);f.enabled(false);f.api.exclude('tasks',['chat1','folder:a','unknown']);
 assert.deepEqual(JSON.parse(f.storage.get(f.key+'.locks')),['chat1']);assert.equal(f.tickets().length,0);
 f.enabled(true);f.config(true);assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');f.metas.get('chat1').automationFacts.title='Alpha changed';assert.equal(f.apply(),0);
 // Explicit manual moves remain legal; the next rule pass preserves them.
 f.item.folderId='manual';assert.equal(f.apply(),0);assert.equal(f.item.folderId,'manual');
});
check('One-time dismissal survives auto enable; changing actual conditions permits the next move',()=>{
 const f=fixture();f.apply();const state=JSON.parse(f.storage.get(f.key+'.review'));state.records.chat1.dismissedSig=state.records.chat1.ticket.signature;state.records.chat1.ticket=null;f.storage.set(f.key+'.review',JSON.stringify(state));
 f.config(true);assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');f.metas.get('chat1').automationFacts.title='Alpha changed';assert.equal(f.apply(),1);
});
check('Pending higher-priority condition and dirty task data suspend auto acceptance',()=>{
 const f=fixture(),owner={...titleRule,id:'owner',conditions:[{field:'responsibleId',op:'eq',value:'8'}]};
 delete f.metas.get('chat1').automationFacts.responsibleId;f.config(true,[owner,titleRule]);assert.equal(f.apply(),0);assert.equal(f.tickets().length,0);
 f.metas.get('chat1').automationFacts.responsibleId='7';f.api.dirty.set(f.scope+':1',true);assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');f.api.dirty.clear();assert.equal(f.apply(),1);
});
check('Hydrating a label and canonical ID cannot reopen a dismissed move, including legacy journals',()=>{
 const f=fixture(),owner={...titleRule,conditions:[{field:'responsibleId',op:'eq',value:'7'}]};f.config(false,[owner]);f.apply();
 const state=JSON.parse(f.storage.get(f.key+'.review'));state.records.chat1.dismissedSig=state.records.chat1.ticket.signature;state.records.chat1.ticket=null;
 // Journal format written by the previous release contains complete conditions.
 state.rulesSig=JSON.stringify([{id:owner.id,enabled:true,folderId:owner.folderId,match:owner.match,conditions:owner.conditions}]);
 f.storage.set(f.key+'.review',JSON.stringify(state));
 f.config(true,[{...owner,conditions:[{field:'responsibleId',op:'eq',value:' 007 ',label:'Анна Иванова',required:false}]}]);
 assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');assert.equal(f.tickets().length,0);
});
check('Legacy skipped person facts survive scalar and member-order changes from REST',()=>{
 const f=fixture(),owner={...titleRule,conditions:[{field:'responsibleId',op:'eq',value:'7'},{field:'accomplices',op:'eq',value:'8'}]};
 f.metas.get('chat1').automationFacts.accomplices=['8','9'];f.config(false,[owner]);f.apply();
 const state=JSON.parse(f.storage.get(f.key+'.review')),record=state.records.chat1;
 const oldFacts=JSON.stringify({responsibleId:'7',accomplices:['8','9']});record.factsSig=oldFacts;
 const signature=JSON.parse(record.ticket.signature);signature[0]=oldFacts;record.dismissedSig=JSON.stringify(signature);record.ticket=null;
 state.factsOrderVersion=1;f.storage.set(f.key+'.review',JSON.stringify(state));
 f.metas.get('chat1').automationFacts.responsibleId={ID:7};f.metas.get('chat1').automationFacts.accomplices=[9,{id:8},'08'];
 f.config(true,[owner]);assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');assert.equal(f.tickets().length,0);
});
check('A dialog that stops matching is removed from its folder only under auto acceptance',()=>{
 const f=fixture();f.config(true);f.apply();f.config(false);f.metas.get('chat1').automationFacts.title='Beta';assert.equal(f.apply(),0);assert.equal(f.tickets()[0][1].ticket.to,'');
 f.config(true);assert.equal(f.apply(),1);assert.equal(f.item.folderId,'');assert.equal(f.tickets().length,0);assert.equal(f.apply(),0);
});
check('Disabled extension, unavailable dialog and non-boolean imported flag cannot auto-move',()=>{
 const f=fixture();f.config(true);f.enabled(false);assert.equal(f.apply(),0);f.enabled(true);f.item.unavailable=true;assert.equal(f.apply(),0);delete f.item.unavailable;f.config('true');assert.equal(f.apply(),0);assert.equal(f.tickets().length,1);
});
check('Imported person rule matches ID and produces a safe proposal before explicit auto opt-in',()=>{
 const f=fixture(),mode={segments:[],items:f.items,locks:[],automation:{version:1,rules:[{...titleRule,conditions:[{field:'responsibleId',op:'eq',value:'7',label:'Анна Иванова'}]}],excludedIds:[],autoAcceptTransfers:true}};
 const merged=model.mergeSortingTransfer(mode,mode);assert.equal(merged.automation.autoAcceptTransfers,false);
 f.storage.set(f.key,JSON.stringify(merged.automation));assert.equal(f.apply(),0);assert.equal(f.tickets()[0][1].ticket.to,'folder:b');
 f.storage.set(f.key,JSON.stringify({...merged.automation,autoAcceptTransfers:true}));assert.equal(f.apply(),1);assert.equal(f.item.folderId,'folder:b');
});
check('Journal quota leaves placement untouched and retry applies once after storage recovers',()=>{
 const f=fixture();f.apply();const before=f.storage.get(f.key+'.review');f.config(true);f.quota(true);
 assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');assert.equal(f.storage.get(f.key+'.review'),before);assert.equal(f.tickets().length,1);
 f.quota(false);assert.equal(f.apply(),1);assert.equal(f.item.folderId,'folder:b');assert.equal(f.apply(),0);
});
check('Persisted exclusion hides a stale ticket even if journal quota prevents clearing it',()=>{
 const f=fixture();f.apply();f.quota(true);f.enabled(false);assert.equal(f.api.exclude('tasks',['chat1']),true);assert.equal(f.tickets().length,0);
 assert.ok(JSON.parse(f.storage.get(f.key+'.review')).records.chat1.ticket,'The test actually retained a stale journal');
});
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-resorting.json',JSON.stringify(results,null,2));
if(results.some(result=>!result.passed))process.exitCode=1;
