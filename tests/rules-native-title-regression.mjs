import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/injected.js','utf8');
const section=(start,end)=>{const at=source.indexOf(start);assert.ok(at>=0,start);return source.slice(at,source.indexOf(end,at));};
const helper=section('\t\tconst nativeTitleSelector =','\n\t\tobs = new MutationObserver');
const title=section('\tfunction getChatTitleFromElement(', '\n\tfunction _normalizeDialogControlTitle');
const merge=section('\tfunction _mergeDialogNativeExpectedAuditMeta(', '\n\tfunction _mergeDialogNativeExpectedAuditTarget');
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
const report=[];
try{
 await page.setContent('<main id="fixture"></main>');
 const results=await page.evaluate(({helper,title,merge})=>{
  const results=[];
  function fixture(className='bx-im-chat-title__text',extra={}){
   const container=document.querySelector('#fixture');container.replaceChildren();
   const row=document.createElement('div');row.className='bx-im-list-recent-item__wrap';row.dataset.id='chat1';
   const name=document.createElement('span');name.className=className;name.textContent='Before';row.append(name);container.append(row);
   const items=[{id:'chat1',title:'Before'}],metas=new Map([['chat1',{id:'chat1',displayTitle:'Before',title:'before',recentListFetchedAt:100,...extra}]]);
   const counts={saves:0,reads:0,sets:0,wakes:0};
   const bindings={container,IS_OL_FRAME:false,_pMode:()=> 'chats',_isDialogControlNativeMode:()=>true,
    rowIdentityAttributes:new Set(['data-id','data-dialog-id','data-dialog-id-value','data-dialogid','data-chat-id','data-user-id','data-entity-id','href']),
    getMutationOwnerRow:m=>(m.target.nodeType===1?m.target:m.target.parentElement)?.closest('.bx-im-list-recent-item__wrap,.bx-im-list-item,.bx-messenger-cl-item'),
    _getDialogControlItemsForMode:()=>{counts.reads++;return items;},_isDialogControlFolder:x=>x.type==='folder',normId:x=>String(x||''),
    getChatIdFromElement:row=>row.dataset.id,_dialogRecentMeta:metas,_isDialogControlFallbackTitle:x=>x==='Диалог',
    _setDialogRecentMeta:(target,meta)=>{counts.sets++;target.set(meta.id,meta);},_saveDialogControlItemsForMode:()=>counts.saves++,
    _invalidateDialogControlDomReadCache(){},_scheduleDialogAutomation:()=>counts.wakes++,
    _mergeDialogRecentMessageState:(previous,meta)=>({...previous,...meta})};
   const api=new Function(...Object.keys(bindings),title+merge+helper+';return {sync:syncNativeChatTitles,merge:_mergeDialogNativeExpectedAuditMeta,getTitle:getChatTitleFromElement};')(...Object.values(bindings));
   const mutation=()=>({type:'childList',target:name,addedNodes:[name.firstChild],removedNodes:[]});
   return {container,row,name,items,metas,counts,api,mutation};
  }
  function check(name,run){try{const details=run();results.push({name,passed:true,...details});}catch(error){results.push({name,passed:false,error:error.message});}}
  const expect=(actual,expected,why)=>{if(actual!==expected)throw new Error(`${why}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);};
  check('Default native title change updates metadata and stored item once',()=>{
   const f=fixture();f.name.textContent='After';f.api.sync([f.mutation(),f.mutation()]);
   expect(f.metas.get('chat1').displayTitle,'After','meta');expect(f.items[0].title,'After','item');expect(f.counts.saves,1,'batch deduplication');return f.counts;
  });
  for(const className of ['bx-im-list-item__title','bx-im-list-item__name','bx-im-list-recent-item__title_text','bx-im-list-recent-item__title-text','bx-im-list-recent-item__name'])check('Supported native title selector '+className,()=>{
   const f=fixture(className);f.name.textContent='After';expect(f.api.getTitle(f.row),'After','existing title getter supports this row');f.api.sync([f.mutation()]);expect(f.metas.get('chat1').displayTitle,'After','rename must reach rules');
  });
  check('Identity recycling in the same mutation batch cannot rename either occupant',()=>{
   const f=fixture();f.metas.set('chat2',{id:'chat2',displayTitle:'Second'});f.row.dataset.id='chat2';f.name.textContent='Transient stale title';
   f.api.sync([{type:'attributes',attributeName:'data-id',target:f.row},f.mutation()]);expect(f.metas.get('chat1').displayTitle,'Before','old occupant');expect(f.metas.get('chat2').displayTitle,'Second','new occupant');expect(f.counts.saves,0,'no write');
  });
  for(const kind of ['remote','detached','task'])check('Ignore '+kind+' rows',()=>{
   const f=fixture('bx-im-chat-title__text',kind==='task'?{isTask:true}:{});if(kind==='remote')f.row.classList.add('pena-native-remote-row');if(kind==='detached')f.row.remove();
   f.name.textContent='After';f.api.sync([f.mutation()]);expect(f.metas.get('chat1').displayTitle,'Before','ignored metadata');expect(f.counts.saves,0,'no write');
  });
  check('A delayed catalog audit cannot revert a live native rename',()=>{
   const f=fixture();f.name.textContent='After';f.api.sync([f.mutation()]);
   const result=f.api.merge(f.metas.get('chat1'),{id:'chat1',displayTitle:'Before',title:'before',recentListFetchedAt:250},200);
   expect(result.displayTitle,'After','audit began before native rename');
  });
  check('A stale persisted title timestamp cannot erase the live rename fence',()=>{
   const f=fixture();f.name.textContent='After';f.api.sync([f.mutation()]);const observed=f.metas.get('chat1').titleObservedAt;
   const old={id:'chat1',displayTitle:'Before',title:'before',recentListFetchedAt:250,titleObservedAt:50};
   const first=f.api.merge(f.metas.get('chat1'),old,200);expect(first.displayTitle,'After','first delayed audit');
   expect(first.titleObservedAt,observed,'fresh title evidence must survive the merge');
   expect(f.api.merge(first,old,200).displayTitle,'After','second delayed audit');
  });
  check('Title freshness does not suppress newer counters or a genuinely later title read',()=>{
   const f=fixture('bx-im-chat-title__text',{unreadCount:1,counterFetchedAt:100});f.name.textContent='After';f.api.sync([f.mutation()]);
   const fresh=f.metas.get('chat1'),result=f.api.merge(fresh,{id:'chat1',displayTitle:'Before',unreadCount:5,counterFetchedAt:300},200);
   expect(result.displayTitle,'After','title');expect(result.unreadCount,5,'new counter');
   expect(f.api.merge(fresh,{id:'chat1',displayTitle:'Newest'},fresh.titleObservedAt+1).displayTitle,'Newest','later title snapshot');
  });
  check('No-op title repaint avoids storage writes',()=>{
   const f=fixture();f.api.sync([f.mutation()]);expect(f.counts.saves,0,'no-op writes');expect(f.counts.sets,0,'no-op metadata');expect(f.counts.reads,0,'no-op catalog scan');return f.counts;
  });
  return results;
 },{helper,title,merge});report.push(...results);
 const prepare=section('\tasync function _prepareDialogAutomationSnapshot(', '\n\tfunction _dialogAutomationFacts');
 const metas=new Map([['chat1',{id:'chat1',displayTitle:'After',title:'after',titleObservedAt:300,recentListFetchedAt:100}]]);
 const bindings={normId:x=>x,_mergeDialogRecentMessageState:(previous,meta)=>({...previous,...meta}),
  _dialogNativeSourceGenerations:new Map([['chats',{generation:1}]]),_syncDialogTaskCatalog:async()=>({complete:true}),
  _runDialogNativeExpectedCatalogAudit:async()=>({complete:true,startedAt:200,metadata:new Map([['chat1',{id:'chat1',displayTitle:'Before',title:'before',recentListFetchedAt:250}]])}),
  _dialogRecentMeta:metas,_getDialogRecentMeta:id=>metas.get(id),_setDialogRecentMeta:(target,meta)=>target.set(meta.id,meta),
  _commitDialogTaskCatalogResult(){},_hydrateAllDialogControlModesFromRecent(){},_getDialogRecentUniqueMeta:()=>[...metas.values()],
  _getDialogControlItemsForMode:()=>[],_isDialogControlFolder:()=>false};
 const activate=new Function(...Object.keys(bindings),merge+prepare+';return _prepareDialogAutomationSnapshot;')(...Object.values(bindings));
 await activate('chats',()=>true);
 assert.equal(metas.get('chat1').displayTitle,'After','Saving rules cannot revert a rename made during its audit');
 report.push({name:'Rule activation preserves a rename made during the snapshot request',passed:true});
}finally{await browser.close();mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-native-title.json',JSON.stringify(report,null,2));}
for(const result of report)console.log(`${result.passed?'PASS':'FAIL'} ${result.name}${result.error?'\n  '+result.error:''}`);
if(report.some(x=>!x.passed))process.exitCode=1;
