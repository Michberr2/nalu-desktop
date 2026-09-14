import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {createRequire} from 'node:module'
const source=fs.readFileSync(new URL('../electron/rendererSecurity.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mod={exports:{}}
new Function('exports','require','module',compiled)(mod.exports,createRequire(import.meta.url),mod)
const {isRendererEntry,isExternalWebUrl,isTrustedRenderer,trustedIpc}=mod.exports
const entry='file:///Applications/Nalu.app/Contents/Resources/app.asar/dist/index.html'
function fixture() {
  const frame={url:entry},sender={mainFrame:frame},window={webContents:sender,isDestroyed:()=>false}
  return {frame,sender,window,event:{sender,senderFrame:frame}}
}

test('only the exact renderer entry and its hash routes are trusted',()=>{
  for(const candidate of [entry,entry+'#settings'])assert.equal(isRendererEntry(candidate,entry),true)
  for(const candidate of ['about:blank','https://n4lu.com',entry+'?different=1',entry+'/other','file:///tmp/index.html','not a URL'])assert.equal(isRendererEntry(candidate,entry),false,candidate)
  assert.equal(isRendererEntry('http://localhost:5173/#ide','http://localhost:5173'),true)
  assert.equal(isRendererEntry('http://localhost:5173.evil.test/','http://localhost:5173'),false)
})

test('IPC rejects other windows, frames, destroyed windows and navigated pages',()=>{
  const f=fixture()
  assert.equal(isTrustedRenderer(f.event,f.window,entry),true)
  assert.equal(isTrustedRenderer({...f.event,sender:{...f.sender}},f.window,entry),false)
  assert.equal(isTrustedRenderer({...f.event,senderFrame:{url:entry}},f.window,entry),false)
  assert.equal(isTrustedRenderer({...f.event,senderFrame:null},f.window,entry),false)
  assert.equal(isTrustedRenderer(f.event,{...f.window,isDestroyed:()=>true},entry),false)
  assert.equal(isTrustedRenderer(f.event,null,entry),false)
  f.frame.url='https://example.com'
  assert.equal(isTrustedRenderer(f.event,f.window,entry),false)
})

test('rejected IPC never reaches file/shell handlers or cancellation listeners',()=>{
  const handlers=new Map(),listeners=new Map(),f=fixture()
  const ipc=trustedIpc({handle:(c,fn)=>handlers.set(c,fn),on:(c,fn)=>listeners.set(c,fn)},()=>f.window,()=>entry)
  let executions=0,cancellations=0
  ipc.handle('sys:exec',(_event,command)=>{executions++;return command})
  ipc.on('sys:cancel',()=>{cancellations++})
  const invalid={...f.event,senderFrame:{url:entry}}
  assert.throws(()=>handlers.get('sys:exec')(invalid,'command'),/Untrusted/)
  listeners.get('sys:cancel')(invalid)
  assert.equal(executions,0);assert.equal(cancellations,0)
  assert.equal(handlers.get('sys:exec')(f.event,'command'),'command')
  listeners.get('sys:cancel')(f.event)
  assert.equal(executions,1);assert.equal(cancellations,1)
})

test('external window links require actual HTTP or HTTPS URLs',()=>{
  for(const url of ['https://example.com/path','http://localhost:5173'])assert.equal(isExternalWebUrl(url),true)
  for(const url of ['httpjunk:payload','javascript:alert(1)','file:///tmp/index.html','data:text/html,hi','not a URL'])assert.equal(isExternalWebUrl(url),false)
})
