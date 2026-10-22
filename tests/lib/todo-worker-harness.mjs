import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../extension/background.js',import.meta.url),'utf8');
export function createTodoWorker(data={},onChange=()=>{}) {
 let listener, failWrite=false;
 const context=vm.createContext({console,Date,Math,Map,Promise,URL,setTimeout,clearTimeout,encodeURIComponent,structuredClone,
  chrome:{storage:{local:{
   get(keys,callback){callback(Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in data).map(key=>[key,structuredClone(data[key])])));},
   set(values,callback){
    if(failWrite){context.chrome.runtime.lastError={message:'disk full'};callback();context.chrome.runtime.lastError=null;return;}
    Object.assign(data,structuredClone(values)); callback(); onChange(values);
   },
   remove(keys,callback){for(const key of keys)delete data[key];callback?.();}
  }},runtime:{lastError:null,onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}}}
 });
 vm.runInContext(source,context);
 return {data,failWrite(value){failWrite=value;},request(command,scope,payload={},senderHost=scope.portalHost){return new Promise((resolve,reject)=>{
  listener({channel:'pena.dialog.repository.v2',command,scope,payload},{url:`https://${senderHost}/`,tab:{id:1},frameId:0},response=>{
   if(response.ok)resolve(structuredClone(response.result)); else reject(Object.assign(new Error(response.error),{code:response.code}));
  });
 });}};
}
