import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createModelProxy} from './model-proxy.mjs'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
test('stopping website harness cancels the real detached CLI and its request', {timeout:15000}, async()=>{
 let started,aborted=false
 const requestStarted=new Promise(resolve=>{started=resolve})
 const proxy=await createModelProxy({model:'cancellation-fixture',sample:async(_payload,signal)=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'))},{once:true}))}})
 const child=spawn(process.execPath,['tests/benchmarks/run-website.mjs','--fullstack'],{cwd:path.resolve(import.meta.dirname,'../..'),env:{...process.env,NODE_OPTIONS:'',NALU_API_URL:proxy.api,NALU_NO_TRAINING_DATA:'1'},stdio:['ignore','pipe','pipe']})
 let output='',runDir
 child.stdout.on('data',chunk=>{output+=chunk;runDir=output.match(/^WEBSITE_OUTPUT: (.+)$/m)?.[1]})
 child.stderr.resume()
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
 try{
  await Promise.race([requestStarted,delay(8000).then(()=>{throw Error('CLI did not request model')})])
  assert.ok(runDir)
  const manifest=JSON.parse(fs.readFileSync(path.join(runDir,'manifest.json'),'utf8'))
  assert.ok(manifest.childPid)
  child.kill('SIGTERM')
  const result=await Promise.race([exited,delay(5000).then(()=>{throw Error('Harness did not stop')})])
  assert.notEqual(result.code,0)
  const report=JSON.parse(fs.readFileSync(path.join(runDir,'report.json'),'utf8'))
  assert.equal(report.execution.cancelledBy,'SIGTERM');assert.equal(report.execution.timedOut,false)
  for(let i=0;i<30&&!aborted;i++)await delay(20)
  assert.equal(aborted,true)
  assert.throws(()=>process.kill(manifest.childPid,0),error=>error.code==='ESRCH')
 }finally{
  if(child.exitCode===null)child.kill('SIGTERM')
  await proxy.close()
 }
})
