import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const model=createRequire(import.meta.url)('../extension/native-catalog.js');
const scope='example.bitrix24.ru~7';
const empty=()=>({segments:[],items:[],automation:{version:1,rules:[],excludedIds:[]},locks:[]});
const sample=()=>({format:'bx24-chat-sorter',version:1,scope,modes:{chats:{segments:[{id:'segment:1',title:'Работа',private:'removed'}],items:[{id:'folder:1',type:'folder',title:'Клиенты',segmentId:'segment:1'},{id:'chat1',type:'chat',title:'Проект',folderId:'folder:1',segmentId:'segment:1',taskId:'',token:'private',messages:['private']}],automation:{version:1,rules:[{id:'rule:1',name:'Проекты',enabled:true,folderId:'folder:1',match:'all',conditions:[{field:'title',op:'contains',value:'Проект',private:'removed'}]}],excludedIds:['chat1','chat1']},locks:['chat1','chat1']},tasks:{...empty(),items:[{id:'chat2',type:'chat',title:'Задача',taskId:123}]}}});
let checkpoints=0;
const original=sample(),raw=JSON.stringify(original);
const synchronous=model.sortingTransfer(original,scope);
const asynchronous=await model.sortingTransferAsync(original,scope,{yieldControl:async()=>{checkpoints++;}});
assert.deepEqual(asynchronous,synchronous);assert.equal(JSON.stringify(original),raw);assert.ok(checkpoints>=12);
assert.ok(!JSON.stringify(asynchronous).includes('private'));assert.deepEqual(asynchronous.modes.chats.locks,['chat1']);assert.equal(asynchronous.modes.tasks.items[0].taskId,'123');
const invalid=[
 x=>{x.scope='foreign~9';},x=>{x.version=2;},x=>{delete x.modes.tasks;},
 x=>{x.modes.chats.items.push({...x.modes.chats.items[1]});},
 x=>{x.modes.chats.items[1].folderId='missing';},x=>{x.modes.chats.items[1].segmentId='missing';},
 x=>{x.modes.chats.items[1].taskId='invalid';},x=>{x.modes.chats.items[1].id='__proto__';},
 x=>{x.modes.chats.items[1].title='x'.repeat(501);},x=>{x.modes.chats.items[1]=null;},
 x=>{x.modes.chats.automation.rules[0].enabled='yes';},
 x=>{x.modes.chats.automation.rules[0].conditions[0].field='responsibleId';},
 x=>{x.modes.chats.automation.rules[0].conditions[0].op='unsupported';},
 x=>{x.modes.chats.locks=['constructor'];},x=>{x.modes.chats.segments=[];},
 x=>{x.modes.tasks.items=Array.from({length:50001},()=>({id:'chat1'}));}
];
for(const change of invalid){const value=sample();change(value);let expected;try{model.sortingTransfer(value,scope);}catch(error){expected={name:error.name,message:error.message};}assert.ok(expected);await assert.rejects(model.sortingTransferAsync(value,scope,{yieldControl:async()=>{}}),error=>error.name===expected.name&&error.message===expected.message);}
const big=sample();big.modes.chats={...empty(),items:Array.from({length:50000},(_,i)=>({id:`chat${i+1}`,title:`Диалог ${i+1}`,type:'chat'})),locks:Array.from({length:50000},(_,i)=>`chat${i+1}`)};
let cancelledAt=0;const sentinel=new Error('closed or scope changed');await assert.rejects(model.sortingTransferAsync(big,scope,{yieldControl:async()=>{if(++cancelledAt===4)throw sentinel;}}),error=>error===sentinel);assert.equal(cancelledAt,4);
let previous=performance.now(),budgetStart=previous,maxCheckpointMs=0,yields=0,heartbeat=0;const itemProgress=[];
const timer=setInterval(()=>heartbeat++,0);
const large=await model.sortingTransferAsync(big,scope,{
 onProgress(progress){if(progress.mode==='chats'&&progress.phase==='items')itemProgress.push(progress.processed);},
 async yieldControl(){const now=performance.now();maxCheckpointMs=Math.max(maxCheckpointMs,now-previous);if(now-budgetStart>=8){yields++;await new Promise(resolve=>setImmediate(resolve));budgetStart=performance.now();}previous=performance.now();}
});clearInterval(timer);
assert.deepEqual(large,model.sortingTransfer(big,scope));assert.ok(yields>0);assert.ok(heartbeat>0);assert.equal(itemProgress.at(-1),50000);assert.ok(itemProgress.every((v,i)=>v-(itemProgress[i-1]||0)<=128));
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/transfer-model-async.json',JSON.stringify({passed:true,parityCases:invalid.length+2,cancellation:true,inputUnchanged:true,closedSchema:true,itemCheckpointLimit:128,yields,heartbeat,maxCheckpointMs},null,2));
console.log(`PASS async transfer model: ${invalid.length+2} parity cases, cancellation, closed schema, 50,000-item cooperative validation (${yields} yields)`);
