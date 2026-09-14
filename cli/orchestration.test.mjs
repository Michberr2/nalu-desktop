import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runWorker, validateTeamPlan, validateSwarmPlan } from './nalu.mjs'
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
const response = text => new Response(event('delta', { text }) + event('done', { ok: true }))
const session = () => ({ api: 'https://nalu.invalid', messages: [], workerAborts: new Set() })

test('a no-tools verifier cannot execute a recovered tool call', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => response('{"name":"read_file","arguments":{"path":"README.md"}}')
    const result = await runWorker(session(), { prompt: 'verify', tools: [], onStep: () => assert.fail('must not execute') })
    assert.match(result, /read_file is not available/)
  } finally { globalThis.fetch = original }
})

test('worker final-report request disables tools and surfaces partial errors', async () => {
  const original = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      if (++calls === 1) return response('{"name":"list_dir","arguments":{"path":"."}}')
      assert.deepEqual(body.tools, [])
      return new Response(event('delta', { text: 'Partial report' }) + event('error', { message: 'failed upstream' }))
    }
    const result = await runWorker(session(), { prompt: 'inspect', maxSteps: 1 })
    assert.equal(result, '(agent error: failed upstream)')
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})

test('worker final-report request rejects a tool call masquerading as a report', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => response('{"name":"list_dir","arguments":{"path":"."}}')
    const result = await runWorker(session(), { prompt: 'inspect', maxSteps: 1 })
    assert.equal(result, '(agent error: worker did not return a final report)')
  } finally { globalThis.fetch = original }
})


const teamPlan = () => ({ team: [{ member: 'Analyst', role: 'review', specialist: 'code' }], tasks: [
  { id: 1, title: 'Inspect', member: 'Analyst', depends_on: [] },
  { id: 2, title: 'Review', member: 'Analyst', depends_on: [1] },
] })

test('team plans reject malformed dependencies, unknown members, duplicate IDs, and cycles', () => {
  assert.equal(validateTeamPlan(teamPlan()).tasks.length, 2)
  for (const mutate of [
    p => { p.tasks = {} },
    p => { p.tasks[0].depends_on = '1' },
    p => { p.tasks[1].depends_on = [99] },
    p => { p.tasks[0].depends_on = [2] },
    p => { p.tasks[1].id = 1 },
    p => { p.tasks[0].member = 'Missing' },
  ]) {
    const plan = teamPlan()
    mutate(plan)
    assert.throws(() => validateTeamPlan(plan), /Team|Task|Each/)
  }
})

test('team mode gives the leader failed and blocked statuses instead of claiming all work completed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-team-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  fs.writeFileSync(fixture, `globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    let text;
    if (prompt.startsWith('You are a planner')) text = ${JSON.stringify(JSON.stringify(teamPlan()))};
    else if (prompt.startsWith('You are Analyst')) return new Response('', {status:401});
    else {
      if (!prompt.includes('status: failed') || !prompt.includes('status: blocked')) throw new Error('Incorrect team statuses');
      text = 'The prerequisites failed, so the task remains incomplete.';
    }
    return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
  }`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '/team inspect this fixture'], {
    cwd: dir, encoding: 'utf8', timeout: 6000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /task remains incomplete/)
  assert.doesNotMatch(result.stdout + result.stderr, /Incorrect team statuses/)
})


test('swarm plans reject malformed members and keep valid missions', () => {
  const plan = { agents: [{ name: 'Reader', mission: 'Inspect the API' }] }
  assert.equal(validateSwarmPlan(plan), plan)
  for (const invalid of [null, {agents:{}}, {agents:[]}, {agents:[null]}, {agents:[{name:'Reader'}]}, {agents:[...plan.agents,...plan.agents]}])
    assert.throws(() => validateSwarmPlan(invalid), /Swarm|Each swarm/)
})

test('malformed swarm planner output returns to the prompt instead of crashing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-swarm-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const wire = 'event: delta\ndata: '+JSON.stringify({text:'{"agents":{"name":"bad shape"}}'})+'\n\nevent: done\ndata: {"ok":true}\n\n'
  fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(wire)})`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '/swarm inspect this fixture'], {
    cwd: dir, encoding: 'utf8', timeout: 3000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Could not design the swarm/)
  assert.match(result.stdout, /bye/)
})
