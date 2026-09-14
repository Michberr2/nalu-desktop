import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../electron/commitAndPush.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {commitAndPush}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
for(const failAt of ['add','commit'])test(`failed ${failAt} prevents later Git commands and push`,async()=>{
  const calls=[]
  await assert.rejects(commitAndPush(async args=>{calls.push(args[0]);return {ok:args[0]!==failAt,out:'fixture denied'}},'draft'),/fixture denied/)
  assert.deepEqual(calls,failAt==='add'?['add']:['add','commit'])
})
test('successful local commit retains a push failure and targets the actual branch',async()=>{
  const calls=[]
  const result=await commitAndPush(async args=>{calls.push(args);return {ok:args[0]!=='push',out:args[0]==='remote'?'origin\n':args[0]==='rev-parse'?'feature/branch\n':args[0]==='push'?'push denied':'committed'}},'draft')
  assert.equal(result.ok,false);assert.equal(result.commit,'committed');assert.equal(result.push,'push denied')
  assert.deepEqual(calls.at(-1),['push','-u','origin','HEAD:feature/branch'])
})
