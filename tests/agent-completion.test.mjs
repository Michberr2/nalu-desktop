import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
let code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/agent.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
code=code.replace(/^import .*from ['"]\.\/naluApi['"];?$/m, 'const streamChat = (...args) => globalThis.agentTestStream(...args); const imageMessage = (text) => ({role:"user",content:text});')
const execCode=ts.transpileModule(fs.readFileSync(new URL('../src/lib/execWithSignal.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
code=code.replace("'./execWithSignal'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(execCode).toString('base64')}`))
const {runAgent,isVerificationCommand}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const write={tool:'write_file',path:'fixture.js',content:'fixed'}
const done={tool:'done',summary:'All fixed and verified'}
async function scenario(t,actions,{codes=[],approve=async()=>true,signal,readFile=async()=> 'before'}={}) {
  const previousWindow=globalThis.window, previousStream=globalThis.agentTestStream
  t.after(()=>{globalThis.window=previousWindow;globalThis.agentTestStream=previousStream})
  const steps=[],writes=[],commands=[];let request=0
  globalThis.agentTestStream=async(_history,opts)=>opts.onDelta(JSON.stringify(actions[request++]||done))
  globalThis.window={nalu:{writeFile:async(...args)=>writes.push(args),exec:async(_cwd,command)=>{commands.push(command);return {code:codes.shift()??0,output:'fixture output'}},readFile,readDir:async()=>[]}}
  await runAgent({task:'Fix fixture.js',folder:'/fixture',maxSteps:actions.length+2,onStep:s=>steps.push(s),approve,signal})
  return {steps,writes,commands}
}
test('an immediate completion claim cannot finish a coding task',async t=>{
  const {steps}=await scenario(t,[done])
  assert.ok(steps.some(s=>s.kind==='error'));assert.ok(!steps.some(s=>s.kind==='done'))
})
test('repeated failing commands after an edit cannot trigger success',async t=>{
  const {steps}=await scenario(t,[write,{tool:'run',command:'npm test'},{tool:'run',command:'npm test'},done],{codes:[1,1]})
  assert.ok(!steps.some(s=>s.kind==='done'));assert.ok(steps.some(s=>s.kind==='error'))
})
test('a new edit invalidates an earlier successful test',async t=>{
  const {steps}=await scenario(t,[write,{tool:'run',command:'npm test'},write,done])
  assert.ok(!steps.some(s=>s.kind==='done'))
})
test('successful non-test commands do not verify a code edit',async t=>{
  const {steps}=await scenario(t,[write,{tool:'run',command:'echo tests passed'},done])
  assert.ok(!steps.some(s=>s.kind==='done'))
})
test('an edit followed by a successful project check can complete',async t=>{
  const {steps,writes}=await scenario(t,[write,{tool:'run',command:'node fixture.test.mjs'},done])
  assert.equal(writes.length,1);assert.equal(steps.at(-1).kind,'done')
})
test('cancellation during approval prevents a late-approved write',async t=>{
  const controller=new AbortController()
  const {steps,writes}=await scenario(t,[write],{signal:controller.signal,approve:async()=>{controller.abort();return true}})
  assert.deepEqual(writes,[]);assert.ok(!steps.some(s=>s.kind==='done'))
})
test('verification command classification rejects status-masking shell constructs',()=>{
  for(const command of ['npm test','npm run typecheck','node --test','node invoice.test.mjs','cd project && npm test']) assert.equal(isVerificationCommand(command),true,command)
  for(const command of ['echo npm test','ls -la','npm test || true','npm test; true','npm test | cat','npm test && touch changed.js']) assert.equal(isVerificationCommand(command),false,command)
})

test('file approvals receive the complete original and proposed contents',async t=>{
  const previews=[]
  const {writes}=await scenario(t,[{tool:'edit_file',path:'fixture.js',find:'before',replace:'after'}],{approve:async(_action,preview)=>{previews.push(preview);return true}})
  assert.deepEqual(previews[0],{path:'/fixture/fixture.js',before:'before',after:'after'})
  assert.deepEqual(writes,[['/fixture/fixture.js','after']])
})
test('a file changed during approval is not overwritten',async t=>{
  let disk='before'
  const {writes,steps}=await scenario(t,[write],{readFile:async()=>disk,approve:async()=>{disk='external';return true}})
  assert.deepEqual(writes,[]);assert.ok(steps.some(step=>step.text?.includes('File changed while awaiting approval')))
})
test('new-file approval cannot overwrite a file created while waiting',async t=>{
  let disk=null
  const {writes}=await scenario(t,[write],{readFile:async()=>{if(disk===null)throw new Error('ENOENT');return disk},approve:async(_action,preview)=>{assert.equal(preview.before,null);disk='created by someone else';return true}})
  assert.deepEqual(writes,[])
})
test('an unreadable original is not treated as a new file',async t=>{
  let approvals=0
  const {writes}=await scenario(t,[write],{readFile:async()=>{throw new Error('EACCES')},approve:async()=>{approvals++;return true}})
  assert.deepEqual(writes,[]);assert.equal(approvals,0)
})
