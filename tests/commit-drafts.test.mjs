import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/commitDrafts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {CommitDrafts}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('project drafts survive a fresh store and clearing removes only the selected draft',()=>{
  const values=new Map(), storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
  const first=new CommitDrafts(()=>storage)
  first.write('/first','Unicode 🌊\nsecond line');first.write('/second','other draft')
  const reopened=new CommitDrafts(()=>storage)
  assert.equal(reopened.read('/first'),'Unicode 🌊\nsecond line')
  reopened.write('/first','')
  const restarted=new CommitDrafts(()=>storage)
  assert.equal(restarted.read('/first'),'');assert.equal(restarted.read('/second'),'other draft')
})
test('failed persistence keeps the live draft and reports the storage error',()=>{
  const store=new CommitDrafts(()=>({getItem:()=>null,setItem:()=>{throw new Error('quota')},removeItem:()=>{throw new Error('quota')}}))
  assert.throws(()=>store.write('/project','unsaved draft'),/quota/)
  assert.equal(store.read('/project'),'unsaved draft')
  assert.match(store.error('/project'),/quota/)
  const denied=new CommitDrafts(()=>{throw new Error('storage unavailable')})
  assert.throws(()=>denied.read('/project'),/storage unavailable/)
})
