import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
test('cancelling the outer model runner stops the detached harness, CLI, and provider request without starting qualification', {timeout:20000}, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-model-cancel-'))
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const marker=path.join(dir,'started'),report=path.join(dir,'result.json'),wrapper=path.join(dir,'wrapper.mjs')
 fs.writeFileSync(wrapper,`import fs from 'node:fs';import {runModelFullstack} from ${JSON.stringify(new URL('./run-model-fullstack.mjs',import.meta.url).href)};let aborted=false;const result=await runModelFullstack({model:'cancel-fixture',sample:async(_payload,signal)=>{fs.writeFileSync(${JSON.stringify(marker)},'started');return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'))},{once:true}))}});fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({result,aborted}));process.exitCode=result.passed?0:1;`)
 const child=spawn(process.execPath,[wrapper],{stdio:['ignore','pipe','pipe']})
 let stderr='';child.stderr.on('data',data=>{stderr+=data});child.stdout.resume()
 const exited=new Promise(resolve=>child.on('exit',resolve))
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')})
 for(let i=0;i<100&&!fs.existsSync(marker);i++)await delay(50)
 assert.equal(fs.existsSync(marker),true,stderr)
 child.kill('SIGTERM')
 const code=await Promise.race([exited,delay(8000).then(()=>{throw Error('Outer model runner did not stop')})])
 assert.equal(code,1,stderr)
 const {result,aborted}=JSON.parse(fs.readFileSync(report,'utf8'))
 assert.equal(aborted,true)
 assert.equal(result.passed,false)
 assert.equal(result.generation.cancelledBy,'SIGTERM')
 assert.equal(result.qualification.code,null)
 assert.equal(result.qualification.passed,false)
 const manifest=JSON.parse(fs.readFileSync(path.join(result.runDir,'manifest.json'),'utf8'))
 assert.throws(()=>process.kill(manifest.childPid,0),error=>error.code==='ESRCH')
 assert.equal(fs.readdirSync(result.runDir,{withFileTypes:true}).some(entry=>entry.isDirectory()&&entry.name.startsWith('qualification-')),false)
})
