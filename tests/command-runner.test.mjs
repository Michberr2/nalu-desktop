import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../electron/commandRunner.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {runCommand}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const quote=value=>`'${value.replace(/'/g,`'"'"'`)}'`
function fixture(t,source){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-command-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const script=path.join(dir,'child.cjs');fs.writeFileSync(script,source);return {dir,command:`${quote(process.execPath)} ${quote(script)}`}}
async function until(check){const deadline=Date.now()+3000;while(Date.now()<deadline){if(check())return;await new Promise(r=>setTimeout(r,20))}assert.fail('condition did not become true')}
test('cancellation kills a descendant that ignores TERM',async t=>{
  const {dir,command}=fixture(t,"require('fs').writeFileSync('pid',String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)")
  const ctrl=new AbortController();const pending=runCommand(dir,`${command} & wait`,{signal:ctrl.signal,graceMs:80})
  await until(()=>fs.existsSync(path.join(dir,'pid')))
  const pid=Number(fs.readFileSync(path.join(dir,'pid'),'utf8'));ctrl.abort()
  assert.equal((await pending).code,130)
  await until(()=>{try{process.kill(pid,0);return false}catch{return true}})
})
test('timeout reports failure and removes the running process',async t=>{
  const {dir,command}=fixture(t,"setInterval(()=>{},1000)")
  const result=await runCommand(dir,command,{timeoutMs:100,graceMs:50})
  assert.equal(result.code,124);assert.match(result.output,/timed out/)
})
test('a cancelled request never starts its command',async t=>{
  const {dir,command}=fixture(t,"require('fs').writeFileSync('unexpected','bad')")
  const ctrl=new AbortController();ctrl.abort()
  assert.equal((await runCommand(dir,command,{signal:ctrl.signal})).code,130)
  assert.equal(fs.existsSync(path.join(dir,'unexpected')),false)
})
test('output is bounded and split Unicode is preserved',async t=>{
  const {dir,command}=fixture(t,"const b=Buffer.from('🌊');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.stdout.write('x'.repeat(50000))},20)")
  const result=await runCommand(dir,command)
  assert.equal(result.code,0);assert.ok(result.output.startsWith('🌊'));assert.equal(result.output.length,40000)
})
