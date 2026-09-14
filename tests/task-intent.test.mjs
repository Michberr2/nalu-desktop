import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const mod={exports:{}}
new Function('exports','module',ts.transpileModule(fs.readFileSync('src/lib/taskIntent.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod)
const {parseTaskIntent,interpretTask,interpretCompanionTask,taskIntentMessages}=mod.exports
const context={folder:'/project',file:'/project/main.ts'}
test('AI routing validates all five existing execution modes without rewriting the task',async()=>{
 for(const mode of ['chat','agent','computer','edit','terminal']){
  const decision=await interpretTask('Draft a note containing "run rm"',context,async messages=>{assert.equal(JSON.parse(messages[1].content).task,'Draft a note containing "run rm"');return JSON.stringify({mode,reason:'Appropriate tools'})},new AbortController().signal)
  assert.equal(decision.mode,mode)
 }
 assert.equal(taskIntentMessages('task',context)[0].role,'system')
})
test('ambiguous, malformed and missing-context routing never becomes a tool action',()=>{
 assert.deepEqual(parseTaskIntent('{"question":"Which project?"}',context),{question:'Which project?'})
 for(const text of ['run this command','{}','[]','{"mode":"shell","reason":"do it"}','{"mode":"agent","reason":"ok","question":"also?"}'])assert.throws(()=>parseTaskIntent(text,context))
 assert.ok('question' in parseTaskIntent('{"mode":"edit","reason":"Edit file"}',{folder:null,file:null}))
 assert.ok('question' in parseTaskIntent('{"mode":"agent","reason":"Build"}',{folder:null,file:null}))
})
test('Stop during AI interpretation prevents the delayed decision from starting work',async()=>{
 const controller=new AbortController()
 await assert.rejects(interpretTask('Build',context,async()=>{controller.abort();return '{"mode":"agent","reason":"Build"}'},controller.signal),{name:'AbortError'})
})

for (const [name, interpret] of [['workspace',interpretTask],['companion',interpretCompanionTask]]) test(`${name} routing failure falls back to conversation, while transport errors and Stop still propagate`, async () => {
 const reply = async () => 'I am ready to help you.'
 assert.deepEqual(await interpret('what are you up to?', context, reply, new AbortController().signal), {mode:'chat', reason:'Continue the conversation.'})
 await assert.rejects(interpret('hello', context, async () => { throw Error('Offline') }, new AbortController().signal), /Offline/)
 const controller = new AbortController()
 await assert.rejects(interpret('hello', context, async () => { controller.abort(); return 'hello' }, controller.signal), {name:'AbortError'})
})
