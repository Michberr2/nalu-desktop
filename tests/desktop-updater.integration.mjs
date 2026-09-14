// Exercise the real signed Mac updater against a local feed, in a disposable app.
// The fixture is re-signed as the previous version; no installed app/profile changes.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import {spawn,spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),asar=require('@electron/asar'),yaml=require('js-yaml')
const release=path.resolve(process.argv[2]),source=path.join(release,'mac-universal/Nalu.app')
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-updater-')),fixture=path.join(scratch,'Nalu.app'),home=path.join(scratch,'home'),profile=path.join(scratch,'profile')
fs.mkdirSync(home);fs.mkdirSync(profile)
const receipt={scratch,passed:false,checks:[],scope:'Real electron-updater download, checksum, Squirrel signature staging and automatic idle installation in a disposable signed app. Public GitHub and notarization are separate.'}
const record=s=>{receipt.checks.push(s);console.log('PASS: '+s)}
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:120000});assert.equal(r.status,0,`${cmd}: ${r.stderr||r.error||''}`);return r.stdout.trim()}
const wait=async(fn,label,timeout=120000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,250))}throw Error('Timed out: '+label)}
console.log('Fixture: '+scratch)
run('/usr/bin/ditto',[source,fixture])
const unpacked=path.join(scratch,'asar'),archive=path.join(fixture,'Contents/Resources/app.asar')
asar.extractAll(archive,unpacked)
const manifest=JSON.parse(fs.readFileSync(path.join(unpacked,'package.json'))),version=manifest.version
const parts=version.split('.').map(Number),previous=[parts[0],parts[1],parts[2]-1].join('.')
manifest.version=previous;fs.writeFileSync(path.join(unpacked,'package.json'),JSON.stringify(manifest))
await asar.createPackageWithOptions(unpacked,archive,{unpack:'**/node-pty/**'})
for(const key of ['CFBundleShortVersionString','CFBundleVersion'])run('/usr/libexec/PlistBuddy',['-c',`Set ${key} ${previous}`,path.join(fixture,'Contents/Info.plist')])
run('/usr/bin/codesign',['--force','--sign','Developer ID Application: Michael Berry II (98N9B637F3)','--options','runtime','--entitlements',path.resolve('build/entitlements.mac.plist'),fixture])
run('/usr/bin/codesign',['--verify','--deep','--strict',fixture])
record('Disposable previous-version app carries a valid Developer ID signature')
const meta=yaml.load(fs.readFileSync(path.join(release,'latest-mac.yml'),'utf8')),zip=meta.files.find(f=>f.url.endsWith('.zip'))
assert.equal(meta.version,version);assert.ok(zip)
const zipPath=path.join(release,zip.url),zipBytes=fs.readFileSync(zipPath)
assert.equal(createHash('sha512').update(zipBytes).digest('base64'),zip.sha512)
let corrupt=true,output='',child,inspector,sequence=0;const pending=new Map(),requests=[]
const server=http.createServer((req,res)=>{
 requests.push(req.url)
 if(req.url?.split('?')[0]==='/latest-mac.yml'){res.writeHead(200,{'Content-Type':'text/yaml'});res.end(yaml.dump({...meta,files:[zip],path:zip.url,sha512:zip.sha512}));return}
 if(req.url?.split('?')[0]==='/'+zip.url){res.writeHead(200,{'Content-Type':'application/zip','Content-Length':corrupt?3:zipBytes.length});if(corrupt)res.end('bad');else fs.createReadStream(zipPath).pipe(res);return}
 res.writeHead(404);res.end()
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const env=Object.fromEntries(['PATH','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
Object.assign(env,{HOME:home,GH_CONFIG_DIR:path.join(home,'gh'),GIT_CONFIG_GLOBAL:path.join(home,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',NALU_NO_TRAINING_DATA:'1'})
const evaluate=expression=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Inspector timeout')),30000);pending.set(id,{resolve:r=>{clearTimeout(timer);if(r.exceptionDetails)reject(Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text));else resolve(r.result.value)},reject});inspector.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))})
try {
 child=spawn(path.join(fixture,'Contents/MacOS/Nalu'),['--inspect=0','--user-data-dir='+profile],{cwd:scratch,env,detached:true,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d)
 await wait(()=>/Debugger listening on (ws:\/\/[^\s]+)/.test(output),'inspector',20000)
 inspector=new WebSocket(output.match(/Debugger listening on (ws:\/\/[^\s]+)/)[1]);await new Promise((resolve,reject)=>{inspector.addEventListener('open',resolve,{once:true});inspector.addEventListener('error',reject,{once:true})})
 inspector.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)})
 await wait(()=>evaluate(`!!process.mainModule && process.mainModule.require('electron').app.isReady()`),'ready',20000)
 await wait(()=>evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>!w.webContents.getURL().endsWith('#companion')&&!w.webContents.isLoading())`),'workspace loaded',20000)
 await evaluate(`globalThis.testUpdater=process.mainModule.require('electron-updater').autoUpdater;testUpdater.autoRunAppAfterInstall=false;testUpdater.disableDifferentialDownload=true;testUpdater.setFeedURL({provider:'generic',url:${JSON.stringify(`http://127.0.0.1:${server.address().port}`)}});globalThis.updateEvents=[];testUpdater.on('error',e=>updateEvents.push('error:'+e.message));process.mainModule.require('electron').autoUpdater.on('update-downloaded',()=>updateEvents.push('native-staged'));globalThis.checkFromApp=()=>process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().endsWith('#companion')).webContents.executeJavaScript('window.nalu.updates.check()');void checkFromApp()`)
 await wait(()=>evaluate(`updateEvents.some(e=>e.startsWith('error:') && /checksum|sha512/i.test(e))`),'bad checksum rejected',60000)
 assert.equal(child.exitCode,null)
 record('Corrupted update is rejected; the running app stays open')
 corrupt=false
 await evaluate(`void checkFromApp()`)
 await wait(()=>evaluate(`updateEvents.includes('native-staged')`),'Squirrel validated signed update',120000)
 record('Valid ZIP downloads from the feed and passes native Squirrel signature validation')
 // Release the inspector before quitting; Node otherwise waits for its client.
 inspector.close();inspector=null
 await wait(()=>child.exitCode!==null,'automatic idle restart',120000)
 await wait(()=>{
  try{return JSON.parse(asar.extractFile(archive,'package.json')).version===version}catch{return false}
 },'Squirrel applied new app',60000)
 run('/usr/bin/codesign',['--verify','--deep','--strict',fixture])
 const installedArchive=fs.readFileSync(archive),expectedArchive=fs.readFileSync(path.join(source,'Contents/Resources/app.asar'))
 assert.equal(createHash('sha256').update(installedArchive).digest('hex'),createHash('sha256').update(expectedArchive).digest('hex'))
 record('Idle countdown quits automatically; Squirrel installs the exact new signed app bytes')
 assert.doesNotMatch(output,/UnhandledPromiseRejection/,'Update failures must stay handled inside the application')
 receipt.passed=true;receipt.from=previous;receipt.to=version;receipt.requests=requests
} finally {
 inspector?.close();if(child?.exitCode===null)try{process.kill(-child.pid,'SIGTERM')}catch{}
 server.closeAllConnections();server.close();fs.writeFileSync(path.join(scratch,'app.log'),output);fs.writeFileSync(path.join(scratch,'verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2))
}
