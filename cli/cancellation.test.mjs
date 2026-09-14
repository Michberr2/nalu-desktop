import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { streamOnce, runWorker } from './nalu.mjs'

const state = () => ({ api: 'https://nalu.invalid', messages: [], workerAborts: new Set() })

test('already interrupted turns never start a request', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => assert.fail('must not request after cancellation')
    const result = await streamOnce({ ...state(), interrupted: true }, {}, { quiet: true })
    assert.equal(result.error, 'interrupted')
  } finally { globalThis.fetch = original }
})

test('read-only workers do not execute tool fragments from a failed stream', async () => {
  const original = globalThis.fetch
  try {
    const call = { index: 0, name: 'read_file', arguments: '{"path":"README.md"}' }
    globalThis.fetch = async () => new Response(`event: tool_call_delta\ndata: ${JSON.stringify(call)}\n\nevent: error\ndata: {"message":"incomplete"}\n\n`)
    const result = await runWorker(state(), { prompt: 'inspect', onStep: () => assert.fail('no tool may execute') })
    assert.equal(result, '(agent error: incomplete)')
  } finally { globalThis.fetch = original }
})

test('SIGINT during retry backoff exits promptly without another request', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-retry-cancel-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const marker = path.join(dir, 'requests')
  fs.writeFileSync(fixture, `import fs from 'node:fs'; globalThis.fetch = async () => {
    fs.appendFileSync(${JSON.stringify(marker)}, 'request\\n');
    return new Response('', { status: 503 });
  }`)
  const child = spawn(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', 'hello'], {
    cwd: dir, env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill('SIGKILL'))
  let error = '', sent = false
  child.stderr.on('data', chunk => {
    error += chunk
    if (!sent && error.includes('retrying')) { sent = true; child.kill('SIGINT') }
  })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  assert.equal(code, 130, error)
  assert.equal(fs.readFileSync(marker, 'utf8'), 'request\n')
})

test('SIGINT escalates when a shell ignores SIGTERM', { skip: process.platform === 'win32', timeout: 8000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-stubborn-shell-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const pidFile = path.join(dir, 'pid')
  const command = `trap '' TERM; echo $$ > '${pidFile}'; while :; do sleep 1; done`
  const call = { index: 0, name: 'bash', arguments: JSON.stringify({ command }) }
  const wire = `event: tool_call_delta\ndata: ${JSON.stringify(call)}\n\nevent: done\ndata: {"ok":true}\n\n`
  fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(wire)})`)
  const child = spawn(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', '--yolo', 'run fixture'], {
    cwd: dir, stdio: 'ignore',
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  let shellPid
  t.after(() => {
    child.kill('SIGKILL')
    if (shellPid) { try { process.kill(-shellPid, 'SIGKILL') } catch {} }
  })
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  const deadline = Date.now() + 3000
  while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(fs.existsSync(pidFile), 'shell started')
  shellPid = Number(fs.readFileSync(pidFile, 'utf8').trim())
  child.kill('SIGINT')
  assert.equal(await closed, 130)
  assert.throws(() => process.kill(-shellPid, 0), /ESRCH/)
})
