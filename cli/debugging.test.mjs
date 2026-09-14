import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {reviewRepeatedCheck, announcesIntent} from './nalu.mjs'

test('technical ordering descriptions are completion prose, not sequence-label promises',()=>{
  assert.equal(announcesIntent('Both modules are implemented and verified. planBuild produces a stable, iterative depth-first order with cycle/missing/invalid checks, and runBuild validates the full plan before executing, resolving dependencies in list order.'),false)
  assert.equal(announcesIntent('The implementation emits dependencies first, then dependents.'),false)
  assert.equal(announcesIntent('The next item is returned correctly. Verified.'),false)
  assert.equal(announcesIntent('First, read the file.'),true)
  assert.equal(announcesIntent('Next run the tests.'),true)
})

test('repeated failed checks trigger bounded reassessment and only a passing same check resets it',()=>{
  const failures=new Map(),command='node public.test.mjs'
  assert.equal(reviewRepeatedCheck(failures,command,'exit code: 1\nwrong result'),null)
  assert.match(reviewRepeatedCheck(failures,command,'exit code: 1\nwrong result'),/failed 2 times/)
  assert.equal(reviewRepeatedCheck(failures,'node -e "console.log(1)"','exit code: 0'),null)
  assert.equal(reviewRepeatedCheck(failures,command,'exit code: 1'),null)
  assert.equal(reviewRepeatedCheck(failures,command,'exit code: 1'),null)
  assert.match(reviewRepeatedCheck(failures,command,'exit code: 1'),/failed 5 times/)
  assert.equal(reviewRepeatedCheck(failures,command,'exit code: 1'),null)
  reviewRepeatedCheck(failures,command,'exit code: 0')
  assert.equal(reviewRepeatedCheck(failures,command,'exit code: 1'),null)
  assert.equal(reviewRepeatedCheck(failures,command,'error: permission denied'),null)
})
test('zero-exit assertion failures trigger immediate guidance and repeated-failure reassessment',()=>{
  const failures=new Map(),command='node edge.test.mjs',result='exit code: 0\nAssertion failed: long chain\nchecks passed'
  assert.match(reviewRepeatedCheck(failures,command,result),/console.assert does not make Node exit unsuccessfully/)
  assert.match(reviewRepeatedCheck(failures,command,result),/failed 2 times/)
  assert.equal(failures.get(command),2)
  assert.equal(reviewRepeatedCheck(failures,command,'exit code: 0\nAll assertions passed'),null)
  assert.equal(failures.has(command),false)
})

test('actual CLI supplies failed-check evidence for reassessment before the next model response',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-debug-review-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'public.test.mjs'),"console.error('ACTUAL_FAILURE');process.exit(1)")
  const mock=path.join(dir,'mock.mjs')
  fs.writeFileSync(mock,`import fs from 'node:fs';let n=0;globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);if(n===2){const note=body.messages.at(-1);if(!note.content.includes('Debugging reassessment')||!note.content.includes('ACTUAL_FAILURE'))throw new Error('Missing reassessment evidence');fs.writeFileSync('observed','yes')}const text=n++<2?JSON.stringify({name:'bash',arguments:{command:'node public.test.mjs'}}):'Incomplete: test still fails.';return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')}`)
  const result=spawnSync(process.execPath,['--import',mock,fileURLToPath(new URL('./nalu.mjs',import.meta.url)),'-p','--no-stdin','--yolo','Fix the module and run tests'],{cwd:dir,encoding:'utf8',timeout:5000,env:{...process.env,NALU_REMOTE_TASK:'',NALU_NO_TRAINING_DATA:'1',NO_COLOR:'1'}})
  assert.equal(fs.readFileSync(path.join(dir,'observed'),'utf8'),'yes')
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/Reassessing repeated verification failures/)
})
