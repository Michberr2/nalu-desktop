import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
const compile=file=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const url=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const source=compile('../src/lib/workspaceSession.ts').replace("'./documentState'",JSON.stringify(url(compile('../src/lib/documentState.ts'))))
const {snapshotSession,parseSession,restoreSession}=await import(url(source))
const {SessionJournal}=await import(url(compile('../electron/sessionJournal.ts')))
const tab={path:'/project/a.js',name:'a.js',content:'draft',savedContent:'original',dirty:true}
test('durable recovery retains the project folder even when browser preferences were lost',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-project-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const file=path.join(dir,'workspace.json'),journal=new SessionJournal(file)
  await journal.write(JSON.stringify(snapshotSession([tab],tab.path,'/project')))
  const restored=await restoreSession(parseSession(await new SessionJournal(file).read()),async()=> 'original')
  assert.equal(restored.folder,'/project')
  assert.equal(restored.tabs[0].content,'draft')
  const empty=await restoreSession(snapshotSession([],null,null),async()=>{throw Error('no tabs')})
  assert.equal(empty.folder,null)
})
test('older recovery journals remain readable and malformed project folders are rejected',async()=>{
  const legacy=await restoreSession(parseSession(JSON.stringify({version:1,activePath:null,tabs:[]})),async()=> '')
  assert.equal(legacy.folder,undefined)
  for(const folder of [42,{},[],true,''])assert.throws(()=>parseSession(JSON.stringify({version:1,activePath:null,tabs:[],folder})))
})
test('recovery preserves dirty buffers and reads fresh clean tabs from disk',async()=>{
  const snapshot=snapshotSession([tab,{...tab,path:'/project/b.js',content:'old clean',dirty:false}],tab.path)
  assert.equal(snapshot.tabs[1].content,undefined)
  const result=await restoreSession(parseSession(JSON.stringify(snapshot)),async file=>file===tab.path?'original':'new disk')
  assert.equal(result.activePath,tab.path);assert.equal(result.tabs[0].content,'draft');assert.equal(result.tabs[0].recovered,true)
  assert.equal(result.tabs[1].content,'new disk');assert.equal(result.tabs[1].dirty,false)
})
test('external changes during downtime preserve both draft and disk versions',async()=>{
  const {tabs}=await restoreSession(snapshotSession([tab],tab.path),async()=> 'external')
  assert.equal(tabs[0].content,'draft');assert.equal(tabs[0].diskConflict,'external');assert.equal(tabs[0].recovered,true)
})
test('a write completed before a crash is recognized without a false conflict',async()=>{
  const {tabs}=await restoreSession(snapshotSession([tab],tab.path),async()=> 'draft')
  assert.equal(tabs[0].dirty,false);assert.equal(tabs[0].recovered,false)
})
test('missing files retain dirty recovery buffers but omit stale clean tabs',async()=>{
  const {tabs,activePath}=await restoreSession(snapshotSession([tab,{...tab,path:'/missing',dirty:false}],'/missing'),async()=>{throw new Error('ENOENT')})
  assert.equal(tabs.length,1);assert.equal(activePath,tab.path);assert.equal(tabs[0].content,'draft');assert.match(tabs[0].saveError,/ENOENT/)
})
test('trashed buffers survive recovery without adopting a replacement file at the old path',async()=>{
  const snapshot=snapshotSession([{...tab,detached:true}],tab.path)
  const restored=await restoreSession(parseSession(JSON.stringify(snapshot)),async()=>{throw new Error('Detached paths must not be read')})
  assert.equal(restored.tabs[0].content,'draft');assert.equal(restored.tabs[0].detached,true)
  assert.equal(restored.tabs[0].dirty,true)
  assert.throws(()=>parseSession(JSON.stringify({version:1,activePath:null,tabs:[{path:'/bad',name:'bad',detached:true}]})))
})
test('invalid or duplicate recovery entries are rejected',()=>{
  assert.throws(()=>parseSession('{broken'))
  assert.throws(()=>parseSession(JSON.stringify({version:1,activePath:null,tabs:[{path:'/x',name:'x',content:'missing baseline'}]})))
  assert.throws(()=>parseSession(JSON.stringify(snapshotSession([tab,tab],tab.path))))
})
test('large recovery limits concurrent reads and preserves tab order and drafts through out-of-order failures',async()=>{
  const entries=Array.from({length:24},(_,i)=>({...tab,path:`/project/${i}.js`,name:`${i}.js`,dirty:i===5}))
  const pending=[],started=[]
  let inFlight=0,peak=0
  const operation=restoreSession(snapshotSession(entries,entries[5].path),file=>{
    started.push(file);peak=Math.max(peak,++inFlight)
    return new Promise((resolve,reject)=>pending.push(()=>{
      inFlight--
      if(file===entries[5].path || file===entries[6].path)reject(new Error('unreadable fixture'))
      else resolve('disk '+file)
    }))
  })
  assert.equal(started.length,4)
  pending.pop()()
  await new Promise(setImmediate)
  assert.equal(started.length,5)
  while(pending.length){
    for(const finish of pending.splice(0).reverse())finish()
    await new Promise(setImmediate)
  }
  const result=await operation
  assert.equal(peak,4)
  assert.deepEqual(result.tabs.map(t=>t.path),entries.filter((_,i)=>i!==6).map(t=>t.path))
  assert.equal(result.activePath,entries[5].path)
  assert.equal(result.tabs[5].content,'draft')
  assert.match(result.tabs[5].saveError,/unreadable fixture/)
})
test('cancelled recovery stops scheduling remaining tabs after outstanding reads settle',async()=>{
  const entries=Array.from({length:12},(_,i)=>({...tab,path:`/project/${i}.js`,dirty:false}))
  const controller=new AbortController(),pending=[]
  let reads=0
  const operation=restoreSession(snapshotSession(entries,null),()=>{
    reads++
    return new Promise(resolve=>pending.push(resolve))
  },controller.signal)
  assert.equal(reads,4)
  controller.abort()
  const rejected=assert.rejects(operation,{name:'AbortError'})
  for(const resolve of pending)resolve('disk')
  await rejected
  await new Promise(setImmediate)
  assert.equal(reads,4)
  await assert.rejects(restoreSession(snapshotSession(entries,null),async()=>{throw new Error('must not read')},controller.signal),{name:'AbortError'})
})
test('queued journal writes survive reopening and preserve the newest snapshot',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const file=path.join(dir,'profile','recovery.json'), journal=new SessionJournal(file)
  assert.equal(await journal.read(),null)
  await Promise.all([journal.write('first'),journal.write('second'),journal.write('latest')]);await journal.flush()
  assert.equal(journal.busy,false);assert.equal(await new SessionJournal(file).read(),'latest')
  assert.equal(fs.statSync(file).mode & 0o777,0o600)
})
test('a failed journal write leaves the previous durable snapshot intact',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const file=path.join(dir,'recovery.json'), journal=new SessionJournal(file)
  await journal.write('saved');fs.mkdirSync(file+'.tmp')
  await assert.rejects(journal.write('failed'))
  assert.equal(fs.readFileSync(file,'utf8'),'saved');assert.equal(journal.busy,false)
  fs.rmdirSync(file+'.tmp');await journal.write('recovered');assert.equal(await journal.read(),'recovered')
})
