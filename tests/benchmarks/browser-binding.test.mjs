import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { browserFingerprint, runModelFullstack } from './run-model-fullstack.mjs'
test('browser evidence binds both executable and actual worker bundle bytes', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-browser-binding-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.mkdirSync(path.join(dir,'dist-electron'))
  const worker=path.join(dir,'dist-electron','worker.js')
  fs.writeFileSync(worker,'original worker')
  const runtime={executable:process.execPath,appPath:dir},before=browserFingerprint(runtime)
  assert.ok(before.executableSha256)
  assert.ok(before.files['worker.js'])
  fs.writeFileSync(worker,'changed worker')
  assert.notDeepEqual(browserFingerprint(runtime),before)
  assert.equal(browserFingerprint(null),null)
})
test('missing browser bundle fails before opening the model proxy',async()=>{
  let samples=0
  await assert.rejects(runModelFullstack({model:'fixture',sample:async()=>{samples++},browserRuntime:{executable:'/nonexistent-nalu',appPath:'/nonexistent-nalu-app'}}),/ENOENT/)
  assert.equal(samples,0)
})
