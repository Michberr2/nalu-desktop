import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/terminalAgent.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {createTerminalExecutor, runTerminalAgent} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
async function scenario(responses, codes = [], controller = new AbortController()) {
  const lines = [], commands = []
  const completed = await runTerminalAgent({approve:async()=>true,request:'Fix the project',signal:controller.signal,maxSteps:responses.length,reply:async()=>responses.shift(),run:async cmd=>{commands.push(cmd);return {code:codes.shift()??0,out:'fixture'}},onLine:line=>lines.push(line)})
  return {completed,lines,commands}
}
test('unsupported DONE and exhausted responses never complete', async()=>{
  const result = await scenario(['DONE: Fixed','DONE: Fixed'])
  assert.equal(result.completed,false);assert.equal(result.commands.length,0)
  assert.ok(result.lines.at(-1).out.includes('without confirmed completion'))
})
test('failed execution cannot complete on the next model claim', async()=>{
  const result = await scenario(['false','DONE: Fixed'],[1])
  assert.equal(result.completed,false);assert.ok(!result.lines.some(line=>line.done))
})
test('a successful recovery followed by explicit DONE can complete', async()=>{
  assert.equal((await scenario(['false','true','DONE: Verified'],[1,0])).completed,true)
})
test('a successful command alone does not complete a task', async()=>{
  assert.equal((await scenario(['true'],[0])).completed,false)
})
test('DONE text within command output is not a completion action', async()=>{
  const result = await scenario(["printf 'DONE: bogus'"],[0])
  assert.equal(result.completed,false);assert.deepEqual(result.commands,["printf 'DONE: bogus'"])
})
test('cancellation while a model reply is pending prevents command execution', async()=>{
  const controller = new AbortController();let ran=false
  const result = await runTerminalAgent({approve:async()=>true,request:'fix',signal:controller.signal,reply:async()=>{controller.abort();return 'touch unwanted'},run:async()=>{ran=true;return {code:0,out:''}},onLine:()=>{}})
  assert.equal(result,false);assert.equal(ran,false)
})
test('real shell execution preserves cwd, literal path characters, output and failure status',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-terminal-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const cwd=path.join(root,"space ' $(touch INJECTED) `touch INJECTED`")
  fs.mkdirSync(path.join(cwd,'child'),{recursive:true})
  const run=createTerminalExecutor(cwd,async(dir,command)=>{
    const r=spawnSync('/bin/bash',['-c',command],{cwd:dir,encoding:'utf8'})
    return {code:r.status,output:r.stdout+r.stderr}
  })
  return (async()=>{
    assert.equal((await run('printf hello')).out,'hello')
    assert.equal((await run('false')).code,1)
    assert.equal((await run('cd child')).code,0)
    assert.equal(fs.realpathSync((await run('pwd')).out.trim()),fs.realpathSync(path.join(cwd,'child')))
    assert.equal(fs.existsSync(path.join(cwd,'INJECTED')),false)
  })()
})

for (const cancel of [false, true]) test(`terminal approval ${cancel ? 'cancellation' : 'denial'} never executes a command`, async()=>{
  const controller=new AbortController();let ran=false
  const completed=await runTerminalAgent({request:'create a file',signal:controller.signal,reply:async()=> 'touch unwanted',approve:async()=>{if(cancel)controller.abort();return cancel},run:async()=>{ran=true;return {code:0,out:''}},onLine:()=>{}})
  assert.equal(completed,false);assert.equal(ran,false)
})
test('separate AI tasks share the executor working directory', async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-terminal-tasks-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'child'))
  const run=createTerminalExecutor(root,async(cwd,command)=>{const r=spawnSync('/bin/bash',['-c',command],{cwd,encoding:'utf8'});return {code:r.status,output:r.stdout+r.stderr}})
  for (const command of ['cd child','pwd']) {
    const responses=[command,'DONE: Verified'],lines=[]
    assert.equal(await runTerminalAgent({request:'task',signal:new AbortController().signal,reply:async()=>responses.shift(),run,approve:async()=>true,onLine:line=>lines.push(line)}),true)
    if(command==='pwd')assert.equal(fs.realpathSync(lines.find(l=>l.out?.startsWith('/')).out.trim()),fs.realpathSync(path.join(root,'child')))
  }
})
