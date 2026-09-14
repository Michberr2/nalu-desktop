import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/approval.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {awaitApproval}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('cancelling an approval wait resolves denial and ignores a late approval',async()=>{
  const controller=new AbortController();let click
  const pending=awaitApproval(controller.signal,resolve=>{click=resolve})
  controller.abort();click(true)
  assert.equal(await pending,false)
})
test('an already cancelled task never opens an approval prompt',async()=>{
  const controller=new AbortController();controller.abort()
  assert.equal(await awaitApproval(controller.signal,()=>assert.fail('must not display')),false)
})
test('an explicit approval completes once',async()=>{
  const controller=new AbortController()
  assert.equal(await awaitApproval(controller.signal,resolve=>{resolve(true);resolve(false)}),true)
})
