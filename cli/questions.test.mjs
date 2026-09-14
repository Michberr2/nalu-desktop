import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { askRemoteUser } from './nalu.mjs'
const session = () => ({ api: 'https://nalu.invalid', token: 'test-token', workerAborts: new Set(), remoteTask: { id: 'task-1', workerId: 'worker-1', leaseToken: 'lease-1' } })
const response = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('remote questions poll for a real answer and reuse durable question IDs', async () => {
  const state = session()
  const requests = []
  let polls = 0
  const dependencies = {
    pause: async () => {},
    fetch: async (url, options) => {
      assert.equal(url, 'https://nalu.invalid/api/data')
      assert.equal(options.headers.Authorization, 'Bearer test-token')
      const body = JSON.parse(options.body)
      requests.push(body)
      assert.equal(body.leaseToken, 'lease-1')
      if (body.action === 'task-question-status' && ++polls >= 2)
        return response({ ok: true, question: { status: 'answered', answer: 'Use blue' } })
      return response({ ok: true, question: { status: 'pending' } })
    },
  }
  assert.equal(await askRemoteUser(state, 'Which color?', 'call-1', dependencies), 'The task owner answered: Use blue')
  const firstId = requests[0].questionId
  assert.match(firstId, /^q_/)
  assert.equal(new Set(requests.map(r => r.questionId)).size, 1)
  assert.deepEqual(requests.map(r => r.action), ['task-ask', 'task-notification-deliver', 'task-question-status', 'task-question-status'])
  await askRemoteUser(state, 'Which color?', 'call-1', dependencies)
  assert.equal(requests.at(-1).questionId, firstId)
  assert.equal(state.workerAborts.size, 0)
})

test('remote question cancellation and lost leases fail without invented answers', async () => {
  for (const cancelled of [true, false]) {
    const state = session()
    await assert.rejects(askRemoteUser(state, 'Which color?', 'call-1', {
      fetch: async () => cancelled
        ? response({ ok: true, cancelRequested: true })
        : response({ ok: false, error: 'Lease expired' }, 409),
    }), cancelled ? /cancelled/ : /Lease expired/)
    assert.equal(state.hadError, true)
    assert.equal(state.workerAborts.size, 0)
  }
})

test('already cancelled tasks never send a question or notification', async () => {
  const state = { ...session(), interrupted: true }
  await assert.rejects(askRemoteUser(state, 'Which color?', 'call-1', {
    fetch: async () => assert.fail('must not send after cancellation'),
  }), /interrupted/)
  assert.equal(state.workerAborts.size, 0)
})


test('cancelling a question exits the CLI with the normal interrupt status', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-question-cancel-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const wire = 'event: tool_call_delta\ndata: '+JSON.stringify({index:0,id:'call-1',name:'ask_user',arguments:'{"question":"Which color?"}'})+'\n\nevent: done\ndata: {"ok":true}\n\n'
  fs.writeFileSync(fixture, `globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/chat')) return new Response(${JSON.stringify(wire)});
    if (JSON.parse(options.body).action === 'task-ask') process.stderr.write('WAITING_FOR_OWNER\\n');
    return new Response(JSON.stringify({ok:true,question:{status:'pending'}}));
  }`)
  const child = spawn(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', 'Ask the owner'], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1', NALU_REMOTE_TASK: JSON.stringify({id:'task-1',workerId:'worker-1',leaseToken:'a'.repeat(64),kind:'ide'}) },
  })
  t.after(() => child.kill('SIGKILL'))
  let error = '', stopped = false
  child.stderr.on('data', data => {
    error += data
    if (!stopped && error.includes('WAITING_FOR_OWNER')) { stopped = true; child.kill('SIGINT') }
  })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  assert.equal(code, 130, error)
})
