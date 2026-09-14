import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runRemoteGoal } from './nalu.mjs'

for (const [prompt, flags, expected] of [
  ['Fix fixture.js and verify the requirements', [], true],
  ['Fix fixture.js and verify the requirements', ['--read-only'], false],
  ['Fix fixture.js. Do not run tests.', [], false],
  ['Fix fixture.js. Do not add tests; run existing tests.', [], false],
  ["Fix fixture.js. Don't write new tests.", [], false],
  ['Fix fixture.js. Do not modify any test files.', [], false],
  ['Fix fixture.js. Do not create/modify tests. Run existing checks.', [], false],
  ['Fix fixture.js. Work only in this project, do not install dependencies, contact external services, or create/modify tests. Use node --check fixture.js.', [], false],
  ["Fix fixture.js. Don't install dependencies or add new tests. Use existing checks.", [], false],
  ['Fix fixture.js. Do not modify configuration; add tests for the change.', [], true],
  ['Fix fixture.js. Do not install dependencies, but add tests for the change.', [], true],
  ['Inspect the project', [], false],
]) test(`contract checks are requested before implementation only when appropriate: ${prompt} ${flags}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-contract-first-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'fixture.js'), 'export const value = 1')
  const mock = path.join(dir, 'fetch.mjs'), record = path.join(dir, 'requests.jsonl')
  fs.writeFileSync(mock, `import fs from 'node:fs'; let count = 0;
    globalThis.fetch = async (_url, options) => {
      fs.appendFileSync(${JSON.stringify(record)}, options.body + '\\n');
      const n = count++;
      const text = n === 0 ? JSON.stringify({name:'read_file',arguments:{path:'fixture.js'}})
        : n === 2 ? JSON.stringify({name:'bash',arguments:{command:'node --check fixture.js'}}) : 'Finished.';
      return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
    }`)
  const result = spawnSync(process.execPath, ['--import', mock, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', '--yolo', ...flags, prompt], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: {...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1'},
  })
  assert.equal(result.status, 0, result.stderr)
  const requests = fs.readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(requests[0].messages[0].content, prompt)
  for (const request of requests) {
    const guidance = request.messages.filter(message => String(message.content).startsWith('For this coding task, after reading'))
    assert.equal(guidance.length, expected ? 1 : 0)
    if (expected) assert.match(guidance[0].content, /only if.*permitted by the (?:user|original request)/i)
    assert.ok(request.messages.every(message => !Object.hasOwn(message, 'naluInternal')))
    if (!expected && !flags.length && !/do not run|^Inspect/i.test(prompt)) {
      for (const message of request.messages.filter(message => String(message.content).startsWith('Before completing,'))) {
        assert.doesNotMatch(message.content, /add and execute focused checks/)
        assert.match(message.content, /Use existing verification without creating or modifying tests/)
      }
    }
  }
})

test('repeated action announcements exit unsuccessfully instead of pretending work happened', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-stalled-completion-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const marker = path.join(dir, 'requests')
  const wire = 'event: delta\ndata: {"text":"Let me read the project files."}\n\nevent: done\ndata: {"ok":true}\n\n'
  fs.writeFileSync(fixture, `import fs from 'node:fs'; globalThis.fetch = async () => {
    fs.appendFileSync(${JSON.stringify(marker)}, 'request\\n');
    return new Response(${JSON.stringify(wire)});
  }`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', 'Inspect the project'], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /described actions without performing them/)
  assert.equal(fs.readFileSync(marker, 'utf8').trim().split('\n').length, 4)
})

test('AutoPilot does not clear failure state when interrupted during verification', async () => {
  const state = { messages: [], interrupted: false, hadError: false }
  await runRemoteGoal(state, 'fixture goal', {
    turn: async () => { state.messages.push({ role: 'assistant', content: 'report' }) },
    verify: async () => { state.interrupted = true; state.hadError = true; return '{"status":"achieved","reason":"verified"}' },
  })
  assert.equal(state.interrupted, true)
  assert.equal(state.hadError, true)
})

test('AutoPilot gives its verifier real tool output and continues when verification requires more work', async () => {
  const state = { messages: [], interrupted: false, hadError: false }
  let rounds = 0
  await runRemoteGoal(state, 'fixture goal', {
    maxRounds: 2,
    turn: async () => {
      rounds++
      state.messages.push({ role: 'tool', content: 'exit code: 0\nfixture passed' }, { role: 'assistant', content: 'report' })
    },
    verify: async prompt => {
      assert.match(prompt, /fixture passed/)
      return JSON.stringify({ status: rounds === 1 ? 'continue' : 'achieved', reason: rounds === 1 ? 'More tests must pass' : 'All checks passed' })
    },
  })
  assert.equal(rounds, 2)
  assert.equal(state.hadError, false)
})

test('AutoPilot rejects an ambiguous completion verdict', async () => {
  const state = { messages: [], interrupted: false, hadError: false }
  await runRemoteGoal(state, 'fixture goal', {
    turn: async () => {},
    verify: async () => 'ACHIEVED if more tests pass',
  })
  assert.equal(state.hadError, true)
})

for (const [prompt,expected] of [['Fix fixture.js and run tests','code'],['Inspect the project',null]])
test(`turn routing remains consistent across tool results: ${prompt}`,t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-routing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'fixture.js'),'export const value=1')
  const mock=path.join(dir,'fetch.mjs'),record=path.join(dir,'routes.jsonl')
  fs.writeFileSync(mock,`import fs from 'node:fs';let count=0;globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);fs.appendFileSync(${JSON.stringify(record)},JSON.stringify(body.specialist??null)+'\\n');const n=count++;const text=n===0?JSON.stringify({name:'read_file',arguments:{path:'fixture.js'}}):n===2?JSON.stringify({name:'bash',arguments:{command:'node --check fixture.js'}}):'Finished.';return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')}`)
  const result=spawnSync(process.execPath,['--import',mock,fileURLToPath(new URL('./nalu.mjs',import.meta.url)),'-p','--no-stdin','--yolo',prompt],{cwd:dir,encoding:'utf8',timeout:5000,env:{...process.env,NALU_REMOTE_TASK:'',NALU_NO_TRAINING_DATA:'1',NO_COLOR:'1'}})
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(fs.readFileSync(record,'utf8').trim().split('\n').map(JSON.parse),expected==='code'?[expected,expected,expected,expected]:[expected,expected])
})

function reviewedTask(t, actions, flags=[],prompt='Fix fixture.js and verify the requirements') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'fixture.js'),'original')
  const mock=path.join(dir,'fetch.mjs')
  fs.writeFileSync(mock,`let index=0;const actions=${JSON.stringify(actions)};globalThis.fetch=async()=>{const value=actions[index++]??'Finished.';const text=typeof value==='string'?value:JSON.stringify(value);return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')}`)
  return spawnSync(process.execPath,['--import',mock,fileURLToPath(new URL('./nalu.mjs',import.meta.url)),'-p','--no-stdin','--yolo',...flags,prompt],{cwd:dir,encoding:'utf8',timeout:5000,env:{...process.env,NALU_REMOTE_TASK:'',NALU_NO_TRAINING_DATA:'1',NO_COLOR:'1'}})
}
const inspect={name:'read_file',arguments:{path:'fixture.js'}}
const check={name:'bash',arguments:{command:'node --check fixture.js'}}
const edit={name:'write_file',arguments:{path:'fixture.js',content:'changed'}}
test('repeated malformed tool labels request repair without poisoning subsequent model context', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-repeated-tool-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'fixture.js'), 'export const value = 1')
  const malformed = 'Re-issuing the write.' + 'write_file'.repeat(200) + 'writewrite_file{"path":"fixture.js","content":"export const value = 2"}'
  const mock = path.join(dir, 'fetch.mjs'), record = path.join(dir, 'requests.jsonl')
  const actions = [inspect, malformed, {name:'write_file',arguments:{path:'fixture.js',content:'export const value = 2'}}, 'Finished.', check, 'Finished.']
  fs.writeFileSync(mock, `import fs from 'node:fs'; let index=0; const actions=${JSON.stringify(actions)}; globalThis.fetch=async(_url,options)=>{
    fs.appendFileSync(${JSON.stringify(record)},options.body+'\\n');
    const value=actions[index++]??'Finished.'; const text=typeof value==='string'?value:JSON.stringify(value);
    return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
  }`)
  const result = spawnSync(process.execPath, ['--import',mock,fileURLToPath(new URL('./nalu.mjs',import.meta.url)),'-p','--no-stdin','--yolo','Fix fixture.js and verify it'], {cwd:dir,encoding:'utf8',timeout:5000,env:{...process.env,NALU_REMOTE_TASK:'',NALU_NO_TRAINING_DATA:'1',NO_COLOR:'1'}})
  assert.equal(result.status,0,result.stderr)
  const requests=fs.readFileSync(record,'utf8').trim().split('\n').map(JSON.parse)
  assert.match(requests[2].messages.at(-1).content,/tool call was malformed and was NOT executed/)
  for(const request of requests.slice(2)) assert.ok(!request.messages.some(message=>String(message.content).includes('write_file'.repeat(8))))
  assert.equal(fs.readFileSync(path.join(dir,'fixture.js'),'utf8'),'export const value = 2')
})
test('unrepaired repeated tool labels cannot enter completion review', t => {
  const malformed='write_file'.repeat(100)+'writewrite_file{"path":"fixture.js","content":"changed"}'
  const result=reviewedTask(t,[inspect,malformed,malformed,malformed,malformed])
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/repeatedly returned malformed tool calls/)
  assert.doesNotMatch(result.stderr,/Reviewing requirements/)
})
test('a check that prints a console.assert failure cannot establish completion evidence',t=>{
  const createCheck={name:'write_file',arguments:{path:'edge.test.mjs',content:"console.assert(false, 'edge case failed'); console.log('checks passed')"}}
  const runCheck={name:'bash',arguments:{command:'node edge.test.mjs'}}
  const result=reviewedTask(t,[inspect,'Finished.',createCheck,runCheck,'Finished.'])
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/Assertion failed: edge case failed/)
  assert.match(result.stderr,/Reviewing a failed assertion despite a zero exit status/)
  assert.match(result.stderr,/No successful verification followed/)
  const repaired=reviewedTask(t,[inspect,'Finished.',createCheck,runCheck,
    {name:'write_file',arguments:{path:'edge.test.mjs',content:"import assert from 'node:assert/strict'; assert.equal(1+1,2)"}},runCheck,'Finished.'])
  assert.equal(repaired.status,0,repaired.stderr)
})
test('a verified depth-first implementation report can finish the actual CLI review loop',t=>{
  const report='Implemented and verified a stable depth-first order. Dependencies appear first, then dependents.'
  const result=reviewedTask(t,[inspect,check,report,check,report])
  assert.equal(result.status,0,result.stderr)
  assert.match(result.stderr,/Reviewing requirements/)
  assert.doesNotMatch(result.stderr,/repeatedly described actions/)
})
test('coding completion cannot reuse verification from before the requirements review',t=>{
  const result=reviewedTask(t,[inspect,check,'Finished.','Finished.'])
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/No successful verification followed/)
})
test('edits after a review check require another successful check',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,edit,'Finished.'])
  assert.equal(result.status,1,result.stderr)
})
const shellEdit={name:'bash',arguments:{command:'node -e "require(\'fs\').writeFileSync(\'fixture.js\', \'const = broken\')"'}}
test('a shell command after verification immediately tells the model to rerun its final check',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-review-refresh-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'fixture.js'),'export const value=1')
  const mock=path.join(dir,'fetch.mjs'),record=path.join(dir,'requests.jsonl')
  const actions=[inspect,'Finished.',check,{name:'bash',arguments:{command:'pwd'}}]
  fs.writeFileSync(mock,`import fs from 'node:fs';let i=0;const actions=${JSON.stringify(actions)};globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);fs.appendFileSync(${JSON.stringify(record)},options.body+'\\n');
    const last=body.messages.at(-1);const reminder=last?.role==='user'&&last.content.startsWith('Verification needs refreshing:');
    const value=actions[i++]??(reminder?${JSON.stringify(check)}:'Finished.');
    const text=typeof value==='string'?value:JSON.stringify(value);
    return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
  }`)
  const result=spawnSync(process.execPath,['--import',mock,fileURLToPath(new URL('./nalu.mjs',import.meta.url)),'-p','--no-stdin','--yolo','Fix fixture.js and verify the requirements'],{cwd:dir,encoding:'utf8',timeout:5000,env:{...process.env,NALU_REMOTE_TASK:'',NALU_NO_TRAINING_DATA:'1',NO_COLOR:'1'}})
  assert.equal(result.status,0,result.stderr)
  const requests=fs.readFileSync(record,'utf8').trim().split('\n').map(JSON.parse)
  assert.match(requests[4].messages.at(-1).content,/Verification needs refreshing:/)
  assert.match(requests[4].messages.at(-1).content,/cleanup.*before.*final check/)
  assert.match(requests[5].messages.at(-1).content,/exit code: 0/)
})
test('successful shell edits cannot reuse a previous passing review check',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,shellEdit,'Finished.'])
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/No successful verification followed/)
})
test('shell edits followed by repair and a fresh check can complete',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,shellEdit,edit,check,'Finished.'])
  assert.equal(result.status,0,result.stderr)
})
test('safe file inspection preserves fresh review verification',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,inspect,'Finished.'])
  assert.equal(result.status,0,result.stderr)
})
for (const alias of ['cmd','script','shell_command'])
test(`a fresh successful check using the supported ${alias} alias can complete`,t=>{
  const result=reviewedTask(t,[inspect,'Finished.',{name:'bash',arguments:{[alias]:'node --check fixture.js'}},'Finished.'])
  assert.equal(result.status,0,result.stderr)
})
test('a failed check invalidates earlier review verification',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,{name:'bash',arguments:{command:'node -e "process.exit(1)"'}},'Finished.'])
  assert.equal(result.status,1,result.stderr)
})
test('reviewed edits followed by a fresh successful check can complete',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,edit,check,'Finished.'])
  assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Reviewing requirements/)
})
test('read-only coding inspection does not demand a mutating verification workflow',t=>{
  const result=reviewedTask(t,[inspect,'Finished.'],['--read-only'])
  assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stderr,/Reviewing requirements/)
})

test('an explicit instruction not to run tests is not overridden by completion review',t=>{
  const result=reviewedTask(t,[inspect,'Finished.'],[],'Fix fixture.js. Do not run tests.')
  assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stderr,/Reviewing requirements/)
})

test('successful tool execution resets the bounded malformed-call repair window',t=>{
  const malformed='bashbashedit_fileedit_file{"arguments":{"path":"x.py","old_string":"old","new_string":"new"}}'
  const result=reviewedTask(t,[malformed,malformed,malformed,inspect,malformed,malformed,malformed,inspect,'Finished.'],[],'Inspect the project')
  assert.equal(result.status,0,result.stderr)
})

test('a successful diagnostic command after a failed check cannot complete review',t=>{
  const result=reviewedTask(t,[inspect,'Finished.',check,{name:'bash',arguments:{command:'node -e "process.exit(1)"'}},{name:'bash',arguments:{command:'node -e "console.log(1)"'}},'Finished.'])
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/No successful verification followed/)
})
