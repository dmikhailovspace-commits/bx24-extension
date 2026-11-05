import assert from 'node:assert/strict';

// A deterministic model contract, exercised by the ordinary automation suite.
// Values are synthetic; no portal state is read or written.
export function verifyAutomationConditionMatrix(model) {
 const now=Date.parse('2026-11-05T12:00:00Z');
 let assertions=0;
 const check=(field,op,value,facts,expected,mode='tasks')=>{
  assert.equal(model.automationCondition({field,op,value},facts,mode,now),expected,`${mode}/${field}/${op}: ${JSON.stringify(facts)}`);
  assertions++;
 };
 const textCases=[
  ['eq','Проект Альфа','  ПРОЕКТ\u00a0АЛЬФА ',true],['eq','Проект Альфа','Проект Альфа 2',false],
  ['neq','Проект Альфа','ПРОЕКТ АЛЬФА',false],['neq','Проект Альфа','Проект Бета',true],
  ['contains','АЛЬФА','Проект Альфа — задача',true],['contains','Альфа','Проект Бета',false],
  ['notContains','Альфа','Проект Альфа',false],['notContains','Альфа','Проект Бета',true],
  ['starts','Альфа','Альфа — проект',true],['starts','Альфа','Проект Альфа',false],
  ['ends','Альфа','Проект Альфа',true],['ends','Альфа','Альфа проект',false]
 ];
 for(const mode of ['chats','tasks']) {
  for(const [op,value,actual,expected] of textCases)check('title',op,value,{title:actual},expected,mode);
  for(const op of ['eq','neq','contains','notContains','starts','ends']) {
   for(const facts of [{},{title:null},{title:''},{title:'   '},{title:{name:'Альфа'}}])check('title',op,'Альфа',facts,null,mode);
   check('title',op,'   ',{title:'Альфа'},false,mode);
  }
 }
 // All selected enum values and every other enum value, in both directions.
 for(const [field,values,mode] of [
  ['kind',['personal','group'],'chats'],['status',['2','3','4','5','6','7'],'tasks'],['priority',['0','1','2'],'tasks']
 ])for(const value of values)for(const actual of values)for(const op of ['eq','neq'])
  check(field,op,value,{[field]:actual},op==='eq'?actual===value:actual!==value,mode);
 for(const [field,value,mode] of [['kind','group','chats'],['status','3','tasks'],['priority','2','tasks']])for(const op of ['eq','neq']) {
  for(const actual of ['',null,undefined,'invalid',{},[]])check(field,op,value,{[field]:actual},null,mode);
  check(field,op,'invalid',{[field]:value},false,mode);
 }
 for(const field of ['responsibleId','createdBy','accomplices','auditors','groupId']) {
  for(const op of ['eq','neq']) {
   for(const actual of [12,'12',{id:12}])check(field,op,'12',{[field]:actual},op==='eq');
   check(field,op,'2',{[field]:'12'},op==='neq');
   check(field,op,'12',{},null);
   check(field,op,'12',{[field]:null},null);
   check(field,op,'12',{[field]:12},false,'chats');
  }
 }
 for(const field of ['accomplices','auditors'])for(const op of ['eq','neq']) {
  for(const actual of [[12],['2',{id:'12'}],[{id:2},12]])check(field,op,'12',{[field]:actual},op==='eq');
  check(field,op,'12',{[field]:[]},op==='neq');
  check(field,op,'12',{[field]:[2]},op==='neq');
 }
 for(const [op,value,actual,expected] of [
  ['empty','','',true],['empty','','2026-11-04T12:00:00Z',false],
  ['present','','',false],['present','','2026-11-04T12:00:00Z',true],
  ['before','2026-11-05','2026-11-04T23:59:59Z',true],['before','2026-11-05','2026-11-05T00:00:00Z',false],
  ['after','2026-11-05','2026-11-05T00:00:00Z',false],['after','2026-11-05','2026-11-06T00:00:00Z',true]
 ])check('deadline',op,value,{deadline:actual},expected);
 for(const op of ['empty','present','overdue','before','after']) {
  check('deadline',op,'2026-11-05',{},null);
  check('deadline',op,'2026-11-05',{deadline:null},null);
 }
 for(const status of ['2','3','4','5','6','7'])for(const offset of [-1,0,1])
  check('deadline','overdue','',{deadline:new Date(now+offset).toISOString(),status},offset<0&&['2','3'].includes(status));
 for(const status of ['',null,undefined,'8','invalid',{},[]])check('deadline','overdue','',{deadline:new Date(now-1).toISOString(),status},null);
 // Losing required task metadata must not turn an exclusion into a match.
 for(const [field,api] of [['responsibleId','RESPONSIBLE_ID'],['createdBy','CREATED_BY'],['status','STATUS'],['priority','PRIORITY']]) {
  for(const raw of [null,undefined,'','  '])for(const key of [field,api]) {
   const facts=model.taskAutomationFacts({[key]:raw},{[field]:'2'});
   check(field,'eq','2',facts,null);
   check(field,'neq','2',facts,null);
  }
 }
 // Partly decoded member records are not proof that a person is absent.
 for(const field of ['responsibleId','createdBy','accomplices','auditors','groupId']) {
  for(const actual of [{}, {name:'Сотрудник'}, {id:null}, {id:''},[2,{}],[null]]) {
   check(field,'neq','12',{[field]:actual},null);
   check(field,'eq','12',{[field]:actual},null);
  }
  // An observed matching ID is conclusive even if another member is unknown.
  check(field,'eq','12',{[field]:[{},12]},true);
  check(field,'neq','12',{[field]:[{},12]},false);
 }
 // A configured value with unsupported semantics cannot block later rules.
 for(const field of Object.keys(model.automationFields))check(field,'not-an-operator','12',{},false);
 const folderIds=new Set(['a','b']);
 const rule=(id,conditions,match='all')=>({id,folderId:id,enabled:true,conditions,match});
 const fallback=rule('b',[{field:'title',op:'contains',value:'проект'}]);
 for(const field of ['responsibleId','createdBy','status','priority']) {
  const facts={...model.taskAutomationFacts({[field]:null}),title:'Проект'};
  const decision=model.automationDecision([rule('a',[{field,op:'neq',value:'2'}]),fallback],facts,'tasks',folderIds,now);
  assert.deepEqual(decision,{pending:true});assertions++;
 }
 return {assertions,fields:Object.keys(model.automationFields).length};
}
