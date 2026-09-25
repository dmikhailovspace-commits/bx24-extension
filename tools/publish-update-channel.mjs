import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function validateUpdatePublication({local, published, release, latest, current}) {
  const version=local.version, tag=`v${version}`;
  assert.match(version,/^\d+\.\d+\.\d+$/);
  assert.deepEqual(published,local,'Publish metadata from the exact tested tag');
  assert.equal(release.tag_name,tag);assert.equal(latest.tag_name,tag,'Only the latest release may advance the channel');
  assert.equal(release.draft,false);assert.equal(release.prerelease,false);
  const cmp=version.split('.').map(Number),prev=String(current.version).split('.').map(Number);
  assert.equal(prev.length,3);
  const first=cmp.findIndex((part,i)=>part!==prev[i]);assert.ok(first<0||cmp[first]>prev[first],'Never downgrade the update channel');
  assert.equal(local.distribution,'github');assert.ok(local.raw_base_url.endsWith('/'+tag));
  assert.ok(local.extension_files.includes('manifest.json'));
  for(const name of [`PENA_Agency_Windows_v${version}.exe`,`PENA_Agency_macOS_Universal_v${version}.dmg`,`BX24_Chat_Sorter_Chrome_v${version}.zip`]) {
    for(const file of [name,name+'.sha256']) {
      const matches=release.assets.filter(asset=>asset.name===file);
      assert.equal(matches.length,1,`Missing/duplicate release asset: ${file}`);
      assert.ok(matches[0].size>0);assert.match(matches[0].digest,/^sha256:[0-9a-f]{64}$/);
    }
  }
}
export function publishUpdateChannel() {
  const repo='dmikhailovspace-commits/bx24-extension';
  const api=(path,body)=>JSON.parse(execFileSync('gh',['api',`repos/${repo}/${path}`,...(body?['--method','PUT','--input','-']:[])],{encoding:'utf8',windowsHide:true,input:body?JSON.stringify(body):undefined}));
  const local=JSON.parse(readFileSync(new URL('../update.json',import.meta.url),'utf8'));
  const decode=file=>JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
  const currentFile=api('contents/update.json?ref=main'),current=decode(currentFile);
  const published=decode(api(`contents/update.json?ref=v${local.version}`));
  validateUpdatePublication({local,published,current,release:api(`releases/tags/v${local.version}`),latest:api('releases/latest')});
  if(JSON.stringify(current)===JSON.stringify(local)){console.log(`Update channel already at ${local.version}`);return;}
  const result=api('contents/update.json',{message:`Point desktop update channel to verified v${local.version}`,branch:'main',sha:currentFile.sha,content:Buffer.from(JSON.stringify(local,null,2)+'\n').toString('base64')});
  assert.deepEqual(decode(api('contents/update.json?ref=main')),local,'Read back update channel');
  console.log(`Update channel ${local.version}: ${result.commit.sha}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))publishUpdateChannel();
