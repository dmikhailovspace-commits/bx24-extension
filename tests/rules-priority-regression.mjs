import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const model=createRequire(import.meta.url)('../extension/native-catalog.js');
const source=readFileSync('extension/injected.js','utf8');
const rule=(id,folderId,conditions,match='all',extra={})=>({id,folderId,conditions,match,enabled:true,...extra});
const eq=(field,value)=>({field,op:'eq',value});
const folders=new Set(['folder:a','folder:b']);
const results=[];
function check(name,run){try{const evidence=run();results.push({name,passed:true,evidence});}catch(error){results.push({name,passed:false,error:error.message});}}
const truth=(values,match)=>match==='any'?(values.includes(true)?true:values.includes(null)?null:false):(values.includes(false)?false:values.includes(null)?null:true);
check('All/all, all/any, any/all, any/any exhaust every true/false/unknown overlap',()=>{
 let count=0;
 for(const firstMatch of ['all','any'])for(const secondMatch of ['all','any'])for(const a of [true,false,null])for(const b of [true,false,null])for(const c of [true,false,null])for(const d of [true,false,null]){
  const facts={};for(const [field,value,yes,no] of [['responsibleId',a,'7','8'],['status',b,'3','5'],['createdBy',c,'9','10'],['priority',d,'2','1']])if(value!==null)facts[field]=value?yes:no;
  const rules=[rule('first','folder:a',[eq('responsibleId','7'),eq('status','3')],firstMatch),rule('second','folder:b',[eq('createdBy','9'),eq('priority','2')],secondMatch)];
  const first=truth([a,b],firstMatch),second=truth([c,d],secondMatch);
  const expected=first===true?{ruleId:'first',folderId:'folder:a'}:first===null?{pending:true}:second===true?{ruleId:'second',folderId:'folder:b'}:second===null?{pending:true}:null;
  assert.deepEqual(model.automationDecision(rules,facts,'tasks',folders),expected,JSON.stringify({firstMatch,secondMatch,a,b,c,d}));count++;
 }
 return {cases:count};
});
check('Disabled, missing-folder and empty higher rules cannot block a lower match',()=>{
 const fallback=rule('lower','folder:b',[eq('title','Alpha')]);
 for(const higher of [rule('disabled','folder:a',[eq('responsibleId','7')],'all',{enabled:false}),rule('deleted','deleted',[eq('responsibleId','7')]),rule('empty','folder:a',[])])
  assert.deepEqual(model.automationDecision([higher,fallback],{title:'Alpha'},'tasks',folders),{ruleId:'lower',folderId:'folder:b'});
});
check('Pending higher rule blocks lower match; a definitive all-false or any-true resolves immediately',()=>{
 const fallback=rule('lower','folder:b',[eq('title','Alpha')]);
 assert.deepEqual(model.automationDecision([rule('higher','folder:a',[eq('responsibleId','7')]),fallback],{title:'Alpha'},'tasks',folders),{pending:true});
 assert.equal(model.automationDecision([rule('higher','folder:a',[eq('responsibleId','7'),eq('title','Beta')]),fallback],{title:'Alpha'},'tasks',folders).ruleId,'lower');
 assert.equal(model.automationDecision([rule('higher','folder:a',[eq('responsibleId','7'),eq('title','Alpha')],'any'),fallback],{title:'Alpha'},'tasks',folders).ruleId,'higher');
});
function fixture(){
 const storage=new Map(),metas=new Map();const scope='priority.invalid~7',key=`pena.automation.v1.${scope}.tasks`;
 const items=[{id:'folder:a',type:'folder',segmentId:'group:a'},{id:'folder:b',type:'folder',segmentId:'group:b'},{id:'chat1',taskId:'1',title:'Alpha'}];
 metas.set('chat1',{id:'chat1',taskId:'1',displayTitle:'Alpha',automationFacts:{title:'Alpha'}});
 const context={window:{__PENA_NATIVE_CATALOG__:model},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  document:{hidden:false,dispatchEvent(){},querySelectorAll:()=>[]},navigator:{onLine:true},Event:class{},setTimeout:()=>1,clearTimeout(){},
  _getDialogTimeIdentityScopeKey:()=>scope,_pMode:()=> 'tasks',_getDialogRecentMeta:id=>metas.get(id),_isPenaExtensionEnabled:()=>true,
  _getDialogRecentUniqueMeta:()=>[...metas.values()],_dialogRecentMeta:metas,_setDialogRecentMeta:(target,meta)=>target.set(meta.id,meta),_scheduleDialogRecentCacheWrite(){},
  _isDialogControlFolder:item=>item.type==='folder',_isDialogControlItemUnavailable:()=>false,_getDialogControlItemsForMode:()=>items};
 const at=source.indexOf('\tlet _dialogAutomationTimer = null;'),end=source.indexOf('\tfunction _openDialogAutomation(',at);
 runInNewContext(source.slice(at,end)+'\nthis.api={apply:_applyDialogAutomation,tickets:_dialogAutomationTickets};',context);
 const rules=value=>storage.set(key,JSON.stringify({version:1,rules:value,excludedIds:[]}));
 const apply=()=>context.api.apply('tasks',items),tickets=()=>context.api.tickets('tasks');
 const skip=()=>{const journal=JSON.parse(storage.get(key+'.review'));const record=journal.records.chat1;record.dismissedSig=record.ticket.signature;record.ticket=null;storage.set(key+'.review',JSON.stringify(journal));};
 return {storage,key,items,item:items[2],metas,rules,apply,tickets,skip};
}
const alphaA=rule('alpha-a','folder:a',[eq('title','Alpha')]),alphaB=rule('alpha-b','folder:b',[eq('title','Alpha')]);
check('First matching rule places a fresh dialog; reordering only proposes its next move',()=>{
 const f=fixture();f.rules([alphaA,alphaB]);assert.equal(f.apply(),1);assert.equal(f.item.folderId,'folder:a');assert.equal(f.item.segmentId,'group:a');
 f.rules([alphaB,alphaA]);assert.equal(f.apply(),0);assert.equal(f.item.folderId,'folder:a');assert.equal(f.tickets().length,1);assert.equal(f.tickets()[0][1].ticket.to,'folder:b');
 f.apply();assert.equal(f.tickets().length,1,'Rescanning cannot duplicate tickets');
 f.rules([alphaA,alphaB]);f.apply();assert.equal(f.tickets().length,0,'Returning to current destination clears an obsolete proposal');
});
check('Changing the winning rule with the same destination produces no redundant ticket',()=>{
 const f=fixture(),other=rule('other','folder:a',[{field:'title',op:'contains',value:'Al'}]);
 f.rules([alphaA,other]);f.apply();f.rules([other,alphaA]);f.apply();assert.equal(f.item.folderId,'folder:a');assert.equal(f.tickets().length,0);
});
check('A skipped move stays skipped when a different winning rule proposes the same destination',()=>{
 const f=fixture(),other=rule('other','folder:a',[{field:'title',op:'contains',value:'Al'}]);f.item.folderId='manual';
 f.rules([alphaA,other]);f.apply();f.skip();
 f.rules([other,alphaA]);f.apply();assert.equal(f.item.folderId,'manual');assert.equal(f.tickets().length,0,'Changing the explanation alone cannot reopen the same skipped move');
});
check('A permanent manual exception remains protected through priority changes',()=>{
 const f=fixture();f.item.folderId='manual';f.storage.set(f.key+'.locks',JSON.stringify([f.item.id]));f.rules([alphaA,alphaB]);f.apply();f.rules([alphaB,alphaA]);f.apply();
 assert.equal(f.item.folderId,'manual');assert.equal(f.tickets().length,0);
});
check('A skipped proposal stays skipped on a harmless reorder of nonmatching lower rules',()=>{
 const f=fixture();f.item.folderId='manual';const beta=rule('beta','folder:b',[eq('title','Beta')]),gamma=rule('gamma','folder:b',[eq('title','Gamma')]);
 f.rules([alphaA,beta,gamma]);f.apply();f.skip();f.apply();assert.equal(f.tickets().length,0);
 f.rules([alphaA,gamma,beta]);f.apply();assert.equal(f.item.folderId,'manual');assert.equal(f.tickets().length,0,'Neither the winning rule, its inputs nor target changed');
});
check('A skipped proposal reopens when reordered rules choose a different destination',()=>{
 const f=fixture();f.item.folderId='manual';f.rules([alphaA,alphaB]);f.apply();f.skip();f.rules([alphaB,alphaA]);f.apply();
 assert.equal(f.item.folderId,'manual');assert.equal(f.tickets().length,1);assert.equal(f.tickets()[0][1].ticket.to,'folder:b');
});
check('Reordering lower rules with different input fields preserves a skipped proposal',()=>{
 const f=fixture();f.item.folderId='manual';Object.assign(f.metas.get('chat1').automationFacts,{responsibleId:'8',status:'5'});
 const responsible=rule('responsible','folder:b',[eq('responsibleId','7')]),status=rule('status','folder:b',[eq('status','3')]);
 f.rules([alphaA,responsible,status]);f.apply();f.skip();
 f.rules([alphaA,status,responsible]);f.apply();assert.equal(f.tickets().length,0,'Facts object key order cannot invalidate a skipped proposal');
});
check('Moving an unresolved rule above a match suspends its ticket until facts resolve',()=>{
 const f=fixture();f.item.folderId='manual';const pending=rule('pending','folder:b',[eq('responsibleId','7')]);
 f.rules([alphaA,pending]);f.apply();assert.equal(f.tickets().length,1);
 f.rules([pending,alphaA]);f.apply();assert.equal(f.item.folderId,'manual');assert.equal(f.tickets().length,0);
 f.metas.get('chat1').automationFacts.responsibleId='7';f.apply();assert.equal(f.item.folderId,'manual');assert.equal(f.tickets().length,1);assert.equal(f.tickets()[0][1].ticket.to,'folder:b');
});
check('Reordering unrelated rules cannot erase a pending removal confirmation',()=>{
 const f=fixture(),beta=rule('beta','folder:b',[eq('title','Beta')]);f.rules([alphaA,beta]);f.apply();
 f.metas.get('chat1').automationFacts.title='Gamma';f.apply();assert.equal(f.tickets().length,1);assert.equal(f.tickets()[0][1].ticket.to,'');
 f.rules([beta,alphaA]);f.apply();assert.equal(f.item.folderId,'folder:a');assert.equal(f.tickets().length,1,'The unchanged pending removal must survive priority-only edits');assert.equal(f.tickets()[0][1].ticket.to,'');
});
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-priority.json',JSON.stringify(results,null,2));
for(const result of results)console.log(`${result.passed?'PASS':'FAIL'} ${result.name}${result.evidence?' '+JSON.stringify(result.evidence):''}${result.error?'\n  '+result.error:''}`);
if(results.some(x=>!x.passed))process.exitCode=1;
