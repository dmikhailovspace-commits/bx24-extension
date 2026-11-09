import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {verifyAutomationConditionMatrix} from './lib/automation-condition-matrix.mjs';
const model=createRequire(import.meta.url)('../extension/native-catalog.js');
const scope='portal.test~7',folders=new Set(['folder:1','folder:2']);
const rule=(conditions,match='any')=>({id:'rule:1',name:'Правило',enabled:true,folderId:'folder:1',match,conditions});
const fallback={...rule([{field:'title',op:'contains',value:'Проект'}]),id:'rule:2',folderId:'folder:2'};
const all=values=>values.includes(false)?false:values.includes(null)?null:true;
const any=values=>values.includes(true)?true:values.includes(null)?null:false;
let assertions=verifyAutomationConditionMatrix(model).assertions;
for(const requiredCount of [0,1,2,3])for(const match of ['all','any'])for(const a of [true,false,null])for(const b of [true,false,null])for(const c of [true,false,null]){
 const values=[a,b,c],fields=['responsibleId','createdBy','groupId'],facts={title:'Проект'};
 const conditions=fields.map((field,index)=>{if(values[index]!==null)facts[field]=values[index]?'12':'13';return {field,op:'eq',value:'12',...(index<requiredCount?{required:true}:{})};});
 const optional=values.slice(requiredCount),expected=all([all(values.slice(0,requiredCount)),optional.length?(match==='any'?any(optional):all(optional)):true]);
 const actual=model.automationDecision([rule(conditions,match),fallback],facts,'tasks',folders);
 assert.deepEqual(actual,expected===null?{pending:true}:expected?{ruleId:'rule:1',folderId:'folder:1'}:{ruleId:'rule:2',folderId:'folder:2'},JSON.stringify({requiredCount,match,values}));assertions++;
}
for(const field of ['responsibleId','createdBy','accomplices','auditors','groupId'])for(const value of [12,'12',' 0012 ',{id:'0012'},{ID:12}]){
 assert.equal(model.normalizeAutomationId(value),'12');
 const condition={field,op:'eq',value,label:'Другое имя'};
 assert.equal(model.automationCondition(condition,{[field]:field==='auditors'||field==='accomplices'?[{ID:'0012'}]:{id:'00012'}},'tasks'),true);
 assert.equal(model.automationCondition({...condition,op:'neq'},{[field]:{}},'tasks'),null);
 assertions+=3;
}
for(const invalid of [null,undefined,{},[],0,-12,1.2,Number.MAX_SAFE_INTEGER+1,'12 person','Иван','user12','0']){
 assert.equal(model.normalizeAutomationId(invalid),'');assertions++;
}
assert.equal(model.normalizeAutomationId('000',true),'0');assertions++;
for(const field of ['responsibleId','createdBy','accomplices','auditors','groupId']){
 const expected=model.automationFactsSignature({[field]:['7','12']});
 for(const actual of [[7,12],['0012','7','7'],[{ID:12},{id:'0007'}]]){
  assert.equal(model.automationFactsSignature({[field]:actual}),expected);assertions++;
 }
 for(const actual of [7,'007',{id:7},{ID:'0007'},['7']]){
  assert.equal(model.automationFactsSignature({[field]:actual}),model.automationFactsSignature({[field]:['7']}));assertions++;
 }
 for(const actual of [null,undefined,{},[null],[{},7],[],{id:null},'']){
  const signature=model.automationFactsSignature({[field]:actual});
  assert.equal(model.automationFactsSignature(JSON.parse(signature)),signature,'Legacy/canonical signatures stay idempotent');assertions++;
  if(!Array.isArray(actual)||actual.length)assert.notEqual(signature,model.automationFactsSignature({[field]:[]}),'Unknown IDs cannot become a known empty list');
 }
 assert.equal(JSON.parse(model.automationFactsSignature({[field]:null}))[field],null);
}
assert.equal(model.automationFactsSignature({title:' ПРОЕКТ\u00a0 А ',priority:2,status:3,kind:'GROUP'}),model.automationFactsSignature({status:'3',kind:'group',title:'проект а',priority:'2'}));assertions++;
assert.equal(model.automationFactsSignature({groupId:0}),model.automationFactsSignature({groupId:'000'}));assertions++;
assert.notEqual(model.automationFactsSignature({responsibleId:[7,{}]}),model.automationFactsSignature({responsibleId:[7]}));assertions++;
const mode=()=>({segments:[],items:[{id:'folder:1',type:'folder',title:'Команда'},{id:'chat1',type:'chat',title:'Проект'}],automation:{version:1,rules:[],excludedIds:[]},locks:[]});
const payload={format:'bx24-chat-sorter',version:1,scope,modes:{chats:mode(),tasks:mode()}};
payload.modes.tasks.automation={version:1,autoAcceptTransfers:true,excludedIds:[],rules:[rule([
 {field:'responsibleId',op:'eq',value:{ID:'00012'},label:'  Иван   Петров ',required:true,private:'discard'},
 {field:'createdBy',op:'eq',value:12,label:'Иван Петров',required:true},
 {field:'accomplices',op:'eq',value:'0012',label:'Иван Петров',required:false},
 {field:'auditors',op:'eq',value:' 12 ',label:'Иван Петров'},
 {field:'title',op:'contains',value:'Проект',label:'discard'}
 ])]};
const transferred=model.sortingTransfer(payload,scope);
assert.deepEqual(await model.sortingTransferAsync(payload,scope,{yieldControl:async()=>{}}),transferred);
const conditions=transferred.modes.tasks.automation.rules[0].conditions;
assert.ok(conditions.slice(0,4).every(c=>c.value==='12'&&c.label==='Иван Петров'));
assert.equal(conditions[0].required,true);assert.equal(conditions[2].required,false);
assert.equal(conditions[4].label,undefined);assert.equal(conditions[0].private,undefined);
assert.equal(transferred.modes.tasks.automation.autoAcceptTransfers,true);assert.equal(transferred.modes.chats.automation.autoAcceptTransfers,false);
assert.deepEqual(model.sortingTransfer(transferred,scope),transferred);
const merged=model.mergeSortingTransfer({items:[],segments:[],locks:[]},transferred.modes.tasks);
assert.equal(merged.automation.autoAcceptTransfers,false,'Import never enables automatic moves without explicit user activation');
assert.deepEqual(merged.automation.rules[0].conditions,conditions);
const facts=model.taskAutomationFacts({RESPONSIBLE_ID:{ID:'0012'},CREATED_BY:12,ACCOMPLICES:[{id:12}],AUDITORS:[12],TITLE:'Проект',SENSITIVE:'private'});
assert.equal(facts.SENSITIVE,undefined);
assert.deepEqual(model.automationDecision(merged.automation.rules,facts,'tasks',folders),{ruleId:'rule:1',folderId:'folder:1'});
// Old files have IDs but no labels: matching must not depend on directory loading.
const old=structuredClone(payload);for(const condition of old.modes.tasks.automation.rules[0].conditions)delete condition.label;
assert.deepEqual(model.automationDecision(model.sortingTransfer(old,scope).modes.tasks.automation.rules,facts,'tasks',folders),{ruleId:'rule:1',folderId:'folder:1'});
for(const mutate of [x=>{x.modes.tasks.automation.rules[0].conditions[0].value='Иван Петров';},x=>{x.modes.tasks.automation.rules[0].conditions[0].label='x'.repeat(301);},x=>{x.modes.tasks.automation.rules[0].conditions[0].required='true';},x=>{x.modes.tasks.automation.autoAcceptTransfers='true';}]){const bad=structuredClone(payload);mutate(bad);assert.throws(()=>model.sortingTransfer(bad,scope));await assert.rejects(model.sortingTransferAsync(bad,scope,{yieldControl:async()=>{}}));assertions+=2;}
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-required-transfer-model.json',JSON.stringify({passed:true,assertions,requiredTruthTableCases:216,personIdFields:5,labelsPreserved:true,legacyIdsWorkWithoutLabels:true,autoAcceptRequiresExplicitActivation:true,canonicalFactsSignatures:true},null,2));
console.log(`PASS required rule conditions, canonical IDs, labels, transfer and safe auto-accept (${assertions} assertions)`);
