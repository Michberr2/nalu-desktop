import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=ts.transpileModule(fs.readFileSync(new URL('../src/lib/workspaceIndex.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {indexWorkspace,CONTEXT_INDEX_LIMIT}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const signal=()=>new AbortController().signal
test('context indexing reaches deeply nested files and reports unreadable subfolders',async()=>{
  const result=await indexWorkspace('/project',async dir=>{
    if(dir==='/project/bad')throw new Error('denied')
    if(dir==='/project')return [{name:'nested',path:dir+'/nested',dir:true},{name:'bad',path:dir+'/bad',dir:true},{name:'node_modules',path:dir+'/node_modules',dir:true}]
    if(dir.split('/').length<20)return [{name:'nested',path:dir+'/nested',dir:true}]
    return [{name:'終.txt',path:dir+'/終.txt',dir:false}]
  },signal())
  assert.ok(result.paths.at(-1).endsWith('終.txt'))
  assert.equal(result.unreadable,1)
  assert.equal(result.limited,false)
  assert.ok(!result.paths.some(p=>p.includes('node_modules')))
  await assert.rejects(indexWorkspace('/project',async()=>{throw new Error('root denied')},signal()),/root denied/)
})
test('context indexing is strictly bounded for a single huge directory',async()=>{
  const result=await indexWorkspace('C:\\project',async()=>Array.from({length:CONTEXT_INDEX_LIMIT+20},(_,i)=>({name:`file${i}`,path:`C:\\project\\file${i}`,dir:false})),signal())
  assert.equal(result.paths.length,CONTEXT_INDEX_LIMIT)
  assert.equal(result.paths[0],'file0')
  assert.equal(result.limited,true)
})
test('retiring a pending index prevents traversal into its returned directories',async()=>{
  const controller=new AbortController()
  let resolve,reads=0
  const task=indexWorkspace('/old',()=>{reads++;return new Promise(r=>{resolve=r})},controller.signal)
  controller.abort()
  resolve([{name:'nested',path:'/old/nested',dir:true}])
  await assert.rejects(task,{name:'AbortError'})
  assert.equal(reads,1)
})
