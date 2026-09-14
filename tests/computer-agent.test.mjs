import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const transpile = file => ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
let code=transpile('../src/lib/agent.ts')
code=code.replace(/^import .*from ['"]\.\/naluApi['"];?$/m,'const streamChat = (...args) => globalThis.pcTestStream(...args); const imageMessage = text => ({role:"user",content:text});')
code=code.replace("'./execWithSignal'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(transpile('../src/lib/execWithSignal.ts')).toString('base64')}`))
const {runComputer}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const done={tool:'done',summary:'Verified'}
async function scenario(t, actions, {approve=async()=>true, replyHook=()=>{}, pc={}, signal}={}) {
  const previousWindow=globalThis.window,previousStream=globalThis.pcTestStream
  t.after(()=>{globalThis.window=previousWindow;globalThis.pcTestStream=previousStream})
  const calls=[],steps=[]
  globalThis.window={nalu:{pc:{browserCancel:async()=>{},webShot:async()=>'',open:async target=>{calls.push(target);return true},...pc}}}
  globalThis.pcTestStream=async(_history,options)=>{replyHook();const action=actions.shift()??done;options.onDelta(typeof action==='string'?action:JSON.stringify(action))}
  await runComputer({task:'Open my email',signal,maxSteps:5,approve,onStep:step=>steps.push(step)})
  return {calls,steps}
}
test('invalid planner replies cannot bypass approval through guessed website actions',async t=>{
  const {calls,steps}=await scenario(t,['not JSON','not JSON','not JSON'])
  assert.deepEqual(calls,[]);assert.equal(steps.at(-1).kind,'error')
})
test('unknown tools and missing required fields are rejected before execution',async t=>{
  const {calls,steps}=await scenario(t,[{tool:'open'},{tool:'bogus'},{tool:'click',x:'100',y:200}])
  assert.deepEqual(calls,[]);assert.equal(steps.at(-1).kind,'error')
})
test('an unsupported completion claim cannot finish a PC task',async t=>{
  const {steps}=await scenario(t,[done]);assert.ok(!steps.some(s=>s.kind==='done'))
})
test('denial ends the task without a substitute action',async t=>{
  const {calls,steps}=await scenario(t,[{tool:'open',target:'Mail'}],{approve:async()=>false})
  assert.deepEqual(calls,[]);assert.match(steps.at(-1).text,/denied/)
})
for(const during of ['planning','approval'])test(`Stop during ${during} prevents a late action`,async t=>{
  const controller=new AbortController()
  const {calls,steps}=await scenario(t,[{tool:'open',target:'Mail'}],{signal:controller.signal,replyHook:()=>{if(during==='planning')controller.abort()},approve:async()=>{controller.abort();return true}})
  assert.deepEqual(calls,[]);assert.ok(!steps.some(s=>s.kind==='done'))
})
for(const [tool,action,result] of [
  ['type',{tool:'type',text:'hello'},false],['key',{tool:'key',combo:'cmd+t'},false],
  ['webClickSel',{tool:'click_el',selector:'#missing'},{ok:false,out:'element not found'}],
  ['webType',{tool:'type_text',text:'hello'},{ok:false,out:'no browser'}],
  ['webKey',{tool:'press',key:'Return'},{ok:false,out:'no browser'}],
])test(`${tool} failures cannot become successful completion`,async t=>{
  const {steps}=await scenario(t,[action,done],{pc:{[tool]:async()=>result}})
  assert.ok(steps.some(s=>s.text?.startsWith('ERROR:')));assert.ok(!steps.some(s=>s.kind==='done'))
})
test('a successful action followed by explicit completion can finish',async t=>{
  const {calls,steps}=await scenario(t,[{tool:'open',target:'Calculator'},done])
  assert.deepEqual(calls,['Calculator']);assert.equal(steps.at(-1).kind,'done')
})
test('a concrete blocker stays incomplete',async t=>{
  const {steps}=await scenario(t,[{tool:'blocked',summary:'Please sign in in the browser.'}])
  assert.equal(steps.at(-1).kind,'error');assert.match(steps.at(-1).text,/sign in/)
})
