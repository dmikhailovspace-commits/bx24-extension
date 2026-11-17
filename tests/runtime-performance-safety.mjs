import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('extension/injected.js','utf8');
const extract=name=>{const start=source.indexOf('\tfunction '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n\tfunction ',start+2));};
const start=source.indexOf('\tconst normId = (raw) => {');
const sandbox={};vm.createContext(sandbox);
vm.runInContext(source.slice(start,source.indexOf('\n\tfunction ',start))+`
this.normalizeId=normId;
function _isDialogControlFolder(item){return item.type==='folder';}
`+['_normalizeDialogControlRestDialogId','_normalizeDialogControlTitle','_getDialogControlItemIdentityKeys'].map(extract).join('\n'),sandbox);
const oldId=raw=>{if(!raw)return '';const s=String(raw).toLowerCase();return /^chat\d+/.test(s)||/^user\d+/.test(s)?s:/^\d+$/.test(s)?'user'+s:s;};
const oldTitle=value=>String(value||'').replace(/\s+/g,' ').replace(/[«»"']/g,'').trim().toLowerCase();
for(const value of ['',null,undefined,0,NaN,123,'001','CHAT42tail',' user7 ','SG12',"«A»   'Б'",'x'.repeat(10000),...Array.from({length:17000},(_,i)=>'Chat'+i)]){
 assert.equal(sandbox.normalizeId(value),oldId(value));
 assert.equal(sandbox._normalizeDialogControlTitle(value),oldTitle(value));
}
assert.ok(sandbox.normalizeId._cache.size<=16384);
assert.ok(sandbox._normalizeDialogControlTitle._cache.size<=8192);
const item={id:'chat1',dialogId:'USER2'};
const keys=()=>Array.from(sandbox._getDialogControlItemIdentityKeys(item));
assert.deepEqual(keys(),['chat1','user2']);
for(const field of ['id','dialogId','rawDialogId','bitrixDialogId','restDialogId']){
 item[field]='chat999';assert.ok(keys().includes('chat999'),field+' invalidates cached aliases');
 item[field]='chat3';assert.ok(!keys().includes('chat999'),field+' drops old aliases');
}
item.type='folder';assert.deepEqual(keys(),[]);
console.log('PASS runtime memoization: normalization parity, bounded memory, in-place alias mutation');
