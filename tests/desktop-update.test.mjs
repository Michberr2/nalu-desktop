import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../electron/updateController.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {UpdateController}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
function fixture() {
 const transport=new EventEmitter(), events=[], state={now:100000,reason:null,checks:0,installs:0,flush:async()=>events.push('saved')}
 transport.checkForUpdates=async()=>{state.checks++}
 transport.quitAndInstall=()=>{events.push('installed');state.installs++}
 const controller=new UpdateController(transport,{now:()=>state.now,blocked:()=>state.reason,flush:()=>state.flush(),prepareQuit:()=>events.push('quit allowed'),broadcast:s=>events.push(s.phase)})
 return {transport,events,state,controller}
}
test('only a completely downloaded update can restart, after saving and a full countdown',async()=>{
 const {transport,events,state,controller}=fixture()
 transport.emit('update-available',{version:'0.1.29'});transport.emit('download-progress',{percent:48.4})
 await controller.tick();assert.equal(state.installs,0);assert.equal(controller.state.percent,48)
 transport.emit('update-downloaded',{version:'0.1.29'});await controller.tick()
 state.now+=14999;await controller.tick();assert.equal(state.installs,0)
 state.now++;await controller.tick();await controller.tick();assert.equal(state.installs,1)
 assert.deepEqual(events.slice(-4),['saved','installing','quit allowed','installed'])
})
test('work, drafts, terminals or stale renderer cancel the countdown; idle starts a new one',async()=>{
 const {transport,state,controller}=fixture();transport.emit('update-downloaded',{version:'0.1.29'})
 for(const reason of ['task running','unsaved draft','terminal open','renderer stale']) {
  state.reason=null;await controller.tick();state.now+=10000;state.reason=reason;await controller.tick()
  assert.equal(controller.state.restartAt,undefined);state.now+=20000;await controller.tick();assert.equal(state.installs,0)
 }
 state.reason=null;await controller.tick();assert.equal(controller.state.restartAt,state.now+15000)
})
test('new activity during journal flush prevents restart and concurrent ticks cannot double install',async()=>{
 const {transport,state,controller}=fixture();transport.emit('update-downloaded',{version:'0.1.29'});await controller.tick();state.now+=15000
 let finish;state.flush=()=>new Promise(resolve=>{finish=resolve})
 const pending=controller.tick();await controller.tick();state.reason='new task';finish();await pending
 assert.equal(state.installs,0);assert.equal(controller.state.restartAt,undefined)
})
test('save failure and transport failure keep the app open and allow retry',async()=>{
 const {transport,state,controller}=fixture();transport.emit('update-downloaded',{version:'0.1.29'});await controller.tick();state.now+=15000
 state.flush=async()=>{throw Error('disk full')};await controller.tick();assert.equal(state.installs,0);assert.equal(controller.state.phase,'error')
 await controller.check();assert.equal(state.checks,1)
 transport.emit('error',Error('signature rejected'));assert.equal(controller.state.phase,'error');assert.equal(state.installs,0)
})
test('checks cannot replace a ready update or start overlapping requests',async()=>{
 const {transport,state,controller}=fixture();let finish;transport.checkForUpdates=()=>{state.checks++;return new Promise(resolve=>{finish=resolve})}
 const pending=controller.check();await controller.check();assert.equal(state.checks,1);finish();await pending
 transport.emit('update-downloaded',{version:'0.1.29'});await controller.check();assert.equal(state.checks,1)
})
test('a transport error during journal flush prevents the pending restart',async()=>{
 const {transport,state,controller}=fixture();transport.emit('update-downloaded',{version:'0.1.29'});await controller.tick();state.now+=15000
 let finish;state.flush=()=>new Promise(resolve=>{finish=resolve});const pending=controller.tick()
 transport.emit('error',Error('staged update no longer available'));finish();await pending
 assert.equal(state.installs,0);assert.equal(controller.state.phase,'error')
})
test('the separate automatic download promise is caught and the updater can retry',async()=>{
 const {transport,state,controller}=fixture();transport.checkForUpdates=async()=>({downloadPromise:Promise.reject(Error('checksum mismatch'))})
 await controller.check();assert.equal(controller.state.phase,'error');assert.equal(state.installs,0)
 transport.checkForUpdates=async()=>{state.checks++;return null};await controller.check();assert.equal(state.checks,1)
})
