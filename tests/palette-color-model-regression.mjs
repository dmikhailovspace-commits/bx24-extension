import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.PENA_PALETTE_SOURCE||new URL('../extension/injected.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf(`\tfunction ${name}(`);assert(start>=0,name);const tail=/\n\t(?:async )?function /.exec(source.slice(start+1));return source.slice(start,start+1+tail.index);};
const colors=['#4d9dff','#5dc87e','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316','#94a3b8'];
let seed=0,reads=0;const items={chats:[],tasks:[]};
const context=vm.createContext({crypto:{getRandomValues:array=>{array[0]=seed;return array;}},_getDialogControlItemsForMode:mode=>{reads++;return items[mode];},_getDialogControlItems:()=>items.chats,_getDialogControlColors:()=>colors,_isDialogControlFolder:item=>item.type==='folder'});
for(const name of ['_isHexColor','_normalizeDialogControlColor','_hexToRgb','_rgbToHex','_hsvToRgb','_hsvToHex','_getDialogControlAssignedColor','_getDialogControlColorLab','_makeUnusedDialogControlColor'])if(source.includes(`\tfunction ${name}(`))vm.runInContext(extract(name),context);
const pick=current=>context._makeUnusedDialogControlColor(current);
const delta=(a,b)=>{const x=context._getDialogControlColorLab(a),y=context._getDialogControlColorLab(b);return Math.hypot(...x.map((v,i)=>v-y[i]));};
const report={phases:[]};const phase=(name,fn)=>{const began=performance.now();const detail=fn();report.phases.push({name,status:'PASS',ms:performance.now()-began,detail});};
try{
 phase('empty folder and inactive-mode assignments cannot be reused',()=>{
  items.chats=[{type:'folder',id:'folder:empty',color:'#c74c4c'}];items.tasks=[{type:'folder',id:'folder:other',color:'#c84c4c'}];
  const result=pick('#c94c4c');assert(!['#c74c4c','#c84c4c','#c94c4c',...colors].includes(result));
  assert.notEqual(result,'#c74b4b');return{result};
 });
 phase('Oklab conversion matches published primary red and neutral white',()=>{
  for(const [hex,expected] of [['#ffffff',[1,0,0]],['#ff0000',[.62795536,.22486306,.12584630]]]){
   const actual=context._getDialogControlColorLab(hex);actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<.00001));
  }
 });
 phase('visually close used tones are rejected, including the current draft',()=>{
  const assigned=['#c74c4c','#c74b4b','#c64c4c','#c84c4c'];
  items.chats=assigned.map((color,i)=>({id:'folder:'+i,type:'folder',color}));items.tasks=[];
  const result=pick('#d15c50');const distances=assigned.map(color=>delta(result,color));
  assert(Math.min(...distances)>.12);assert(delta(result,'#d15c50')>=.12);return{result,distances};
 });
 phase('all eight occupied hue families remain distinguishable',()=>{
  items.chats=colors.map((color,i)=>({id:'folder:'+i,type:'folder',color}));
  const result=pick('#4d9dff');const minimum=Math.min(...colors.map(color=>delta(result,color)));
  assert(minimum>=.08);return{result,minimum};
 });
 phase('successive random clicks change hue perceptually without saving swatches',()=>{
  const initialPalette=colors.slice();let previous='#c74c4c';const sequence=[];
  for(let i=0;i<18;i++){seed=(i*2654435761)>>>0;const result=pick(previous);assert(delta(result,previous)>=.12);assert(!items.chats.some(item=>item.color===result));sequence.push(result);previous=result;}
  assert(new Set(sequence).size>=10);assert.deepEqual(colors,initialPalette);return{distinct:new Set(sequence).size};
 });
 phase('4000 assignments have bounded cost and cannot return an occupied color',()=>{
  items.chats=Array.from({length:4000},(_,i)=>({id:'folder:'+i,type:'folder',color:'#'+(i*3971%0xffffff).toString(16).padStart(6,'0')}));items.tasks=[];reads=0;
  const began=performance.now();const result=pick('#4d9dff');const ms=performance.now()-began;
  assert(!new Set(items.chats.map(item=>item.color)).has(result));assert(delta(result,'#4d9dff')>=.12);assert.equal(reads,2);assert(ms<250);return{result,ms,reads};
 });
 phase('spatial acceleration preserves the exhaustive farthest-color result',()=>{
  const accelerated=context._makeUnusedDialogControlColor;
  const actual=pick('#4d9dff');
  vm.runInContext(extract('_makeUnusedDialogControlColor').replace('const cells=occupied.length>64 ? new Map() : null;','const cells=null;'),context);
  try{assert.equal(pick('#4d9dff'),actual);}finally{context._makeUnusedDialogControlColor=accelerated;}
 });
 phase('exhausted candidate set cannot fall back to an occupied preset',()=>{
  seed=0;items.chats=Array.from({length:512},(_,i)=>({type:'folder',color:context._hsvToHex(i*137.508%360,.55+i%6*.07,.68+Math.floor(i/6)%6*.058)}));items.tasks=[];
  assert.equal(pick('#4d9dff'),'');
 });
 console.log('PASS palette color model: '+report.phases.length+' phases');
}catch(error){report.error=String(error);throw error;}finally{writeFileSync('tests/artifacts/palette-color-model-report.json',JSON.stringify(report,null,2));}
