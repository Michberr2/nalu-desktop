import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig, parseArgs, workerRepos, runRemoteWorker, streamOnce, execTool } from './nalu.mjs'

const task = (overrides = {}) => ({ id: 'task-1', leaseToken: 'lease-1', request: { kind: 'ide', repo: 'train', prompt: 'Inspect the tests', target: 'desktop' }, ...overrides })
const options = () => ({ api: 'https://nalu.invalid', token: 'test-token', repos: { train: '/private/tmp' }, workerId: 'test-worker', once: true, yolo: false, signal: new AbortController().signal })
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
function backend(claimed, handler) {
  const calls = []
  const fetch = async (url, request) => {
    if(url==='https://nalu.invalid/api/task-attachments'){const b=JSON.parse(request.body);return response(b.action==='begin'?{attachment:{id:'fixture-attachment',parts:Math.max(1,Math.ceil(b.meta.size/786432))}}:{ok:true})}
    assert.equal(url, 'https://nalu.invalid/api/data')
    assert.equal(request.headers.Authorization, 'Bearer test-token')
    const body = JSON.parse(request.body)
    calls.push(body)
    if (handler) { const result = await handler(body); if (result) return result }
    return response({ ok: true, task: body.action === 'task-claim' ? claimed : { id: 'task-1', status: body.status }, cancelRequested: false })
  }
  return { calls, fetch }
}

test('Desktop login config is recognized; standalone settings override it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-config-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'cli.json'), JSON.stringify({ token: 'desktop-token', apiBase: 'https://desktop.invalid' }))
    assert.equal(loadConfig(path.join(dir, 'config.json')).token, 'desktop-token')
    assert.equal(loadConfig(path.join(dir, 'config.json')).api, 'https://desktop.invalid')
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ token: '', api: 'https://override.invalid' }))
    assert.equal(loadConfig(path.join(dir, 'config.json')).token, '')
    assert.equal(loadConfig(path.join(dir, 'config.json')).api, 'https://override.invalid')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('worker flags and -- preserve dash-prefixed prompts without turning them into options', () => {
  const args = parseArgs(['worker', '--repo', 'train=/tmp', '--repo', 'naludesktop=/tmp', '--yolo', '--once'])
  assert.equal(args.worker, true)
  assert.equal(args.repos.length, 2)
  assert.equal(args.yolo, true)
  assert.equal(parseArgs(['--print', '--', '--yolo malicious prompt']).yolo, false)
  assert.equal(parseArgs(['--print', '--', '--yolo malicious prompt']).prompt, '--yolo malicious prompt')
  assert.throws(() => parseArgs(['--repo']), /requires a value/)
  assert.throws(() => workerRepos(['train=/tmp', 'train=/tmp']), /Duplicate/)
  assert.throws(() => workerRepos(['missing-equals']), /requires name/)
})

test('worker claims with authentication, executes in registered cwd and publishes output', async () => {
  const mock = backend(task())
  let executed = false
  await runRemoteWorker(options(), { fetch: mock.fetch, execute: async (job, opts) => {
    executed = true
    assert.equal(job.id, 'task-1')
    assert.equal(opts.cwd, '/private/tmp')
    assert.equal(opts.yolo, false)
    return { code: 0, output: 'Tests pass' }
  } })
  assert.equal(executed, true)
  assert.deepEqual(mock.calls[0].repos, ['train'])
  assert.ok(mock.calls[0].kinds.includes('pipeline'))
  assert.equal(mock.calls.at(-1).status, 'done')
  assert.equal(mock.calls.at(-1).result, 'Tests pass')
  assert.equal(mock.calls.at(-1).leaseToken, 'lease-1')
})

test('worker refuses a task for an unregistered repository', async () => {
  const mock = backend(task({ request: { kind: 'ide', repo: '../../other', prompt: 'change files', target: 'desktop' } }))
  await assert.rejects(runRemoteWorker(options(), { fetch: mock.fetch, execute: async () => assert.fail('must not execute') }), /unregistered repository/)
  assert.equal(mock.calls.at(-1).status, 'failed')
})

test('worker reports CLI failure instead of marking a failed command done', async () => {
  const mock = backend(task())
  await runRemoteWorker(options(), { fetch: mock.fetch, execute: async () => ({ code: 1, output: 'partial output', error: 'response stream failed' }) })
  assert.equal(mock.calls.at(-1).status, 'failed')
  assert.equal(mock.calls.at(-1).detail, 'response stream failed')
})

test('cancellation before execution does not start a child', async () => {
  const mock = backend(task(), (body) => body.action === 'task-update' && body.status === 'running' ? response({ ok: true, cancelRequested: true }) : null)
  await runRemoteWorker(options(), { fetch: mock.fetch, execute: async () => assert.fail('must not execute cancelled task') })
  assert.equal(mock.calls.at(-1).status, 'cancelled')
})

test('heartbeat cancellation aborts the running child and publishes cancellation', async () => {
  const mock = backend(task(), (body) => body.action === 'task-update' && body.status === 'running' && !body.event ? response({ ok: true, cancelRequested: true }) : null)
  await runRemoteWorker(options(), { fetch: mock.fetch, heartbeatMs: 5, execute: async (_job, opts) => new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve({ code: 1, output: 'stopped' }), { once: true })) })
  assert.equal(mock.calls.at(-1).status, 'cancelled')
})

test('lost lease stops execution rather than continuing without ownership', async () => {
  const mock = backend(task(), (body) => body.action === 'task-update' && body.status === 'running' && !body.event ? response({ ok: false, error: 'lease expired' }, 409) : null)
  await assert.rejects(runRemoteWorker(options(), { fetch: mock.fetch, heartbeatMs: 5, execute: async (_job, opts) => new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve({ code: 1, output: '' }), { once: true })) }), /lease expired/)
  assert.equal(mock.calls.at(-1).status, 'failed')
})

test('pipeline tasks await flow completion and never execute a local shell', async () => {
  const mock = backend(task({ request: { kind: 'pipeline', flowId: 'flow-1', mode: 'run', repo: '', prompt: '', target: 'cloud' } }), (body) => body.action === 'flow-run' ? response({ ok: true, status: 'done', step: 3, total: 3 }) : null)
  await runRemoteWorker(options(), { fetch: mock.fetch, execute: async () => assert.fail('pipeline must use backend engine') })
  assert.equal(mock.calls.find((body) => body.action === 'flow-run').flowId, 'flow-1')
  assert.equal(mock.calls.at(-1).status, 'done')
})

test('cancelled pipelines request server stop before reporting cancellation', async () => {
  const mock = backend(task({ request: { kind: 'pipeline', flowId: 'flow-1', mode: 'run', repo: '', prompt: '', target: 'cloud' } }), (body) => {
    if (body.action === 'task-update' && body.status === 'running' && !body.event) return response({ ok: true, cancelRequested: true })
    if (body.action === 'flow-run' && body.mode === 'stop') return response({ ok: true, status: 'stopped' })
    return null
  })
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body)
    if (body.action === 'flow-run' && body.mode === 'run') return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    return mock.fetch(url, request)
  }
  await assert.rejects(runRemoteWorker(options(), { fetch, heartbeatMs: 5 }), /cancelled/)
  assert.ok(mock.calls.some((body) => body.action === 'flow-run' && body.mode === 'stop'))
  assert.equal(mock.calls.at(-1).status, 'cancelled')
})

test('worker requires sign-in and rejects authentication errors immediately', async () => {
  await assert.rejects(runRemoteWorker({ ...options(), token: '' }), /Sign in/)
  const mock = backend(null, () => response({ ok: false, error: 'Session expired' }, 401))
  await assert.rejects(runRemoteWorker({ ...options(), once: false }, { fetch: mock.fetch }), /Session expired/)
  assert.equal(mock.calls.length, 1)
})

test('chat streams include bearer auth and partial transport errors are surfaced', async () => {
  const originalFetch = globalThis.fetch
  const state = { api: 'https://nalu.invalid', token: 'test-token', messages: [], workerAborts: new Set(), interrupted: false }
  let captured
  try {
    globalThis.fetch = async (_url, request) => {
      captured = request
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode('event: delta\ndata: {"text":"partial answer"}\n\n')) },
        pull(controller) { controller.error(new Error('connection reset')) },
      }))
    }
    const result = await streamOnce(state, { feed() {}, flush() {} }, { quiet: true })
    assert.equal(captured.headers.Authorization, 'Bearer test-token')
    assert.equal(result.text, 'partial answer')
    assert.match(result.error, /response stream failed/)
  } finally { globalThis.fetch = originalFetch }
})

test('read-only sessions reject writes even in the normally auto-approved .nalu directory', async () => {
  const result = await execTool({ readOnly: true }, { function: { name: 'write_file', arguments: JSON.stringify({ path: '.nalu/do-not-write.txt', content: 'no' }) } })
  assert.match(result, /read-only/)
  assert.equal(fs.existsSync('.nalu/do-not-write.txt'), false)
})

test('CLI subprocess exits nonzero for partial server errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-print-test-'))
  try {
    const fixture = path.join(dir, 'fetch.mjs')
    fs.writeFileSync(fixture, `globalThis.fetch = async (_url, init) => { if (init.headers.Authorization !== 'Bearer test-token') throw new Error('missing auth'); return new Response('event: delta\\ndata: {"text":"Partial reply"}\\n\\nevent: error\\ndata: {"message":"upstream failed"}\\n\\n') }`)
    const child = spawn(process.execPath, ['--import', fixture, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '--print', 'Test'], { cwd: dir, env: { ...process.env, NALU_TOKEN: 'test-token', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { error += data })
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
    assert.equal(code, 1)
    assert.match(output, /Partial reply/)
    assert.match(error, /upstream failed/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('remote CLI executes recovered tool calls and returns only the final spoken answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-remote-answer-'))
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-project' }))
    const fixture = path.join(dir, 'fetch.mjs')
    fs.writeFileSync(fixture, `globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); const result = body.messages.find(m => m.role === 'tool');
      if (result && !result.content.includes('fixture-project')) throw new Error('The local file was not read');
      const text = result ? 'The package is fixture-project.' : JSON.stringify({name:'read_file',arguments:{path:'package.json'}});
      return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
    }`)
    const child = spawn(process.execPath, ['--import', fixture, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '--print', '--read-only', 'Read package.json'], {
      cwd: dir, env: { ...process.env, NALU_TOKEN: 'test-token', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1', NALU_REMOTE_TASK: JSON.stringify({ id: 'task-1', workerId: 'worker-1', leaseToken: 'a'.repeat(64), kind: 'chat' }) }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', error = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { error += data })
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
    assert.equal(code, 0, error)
    assert.equal(output.trim(), 'The package is fixture-project.')
    assert.match(error, /read_file/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('SIGTERM cancels the CLI and its detached shell process group', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-cancel-test-'))
  let child, shellPid
  try {
    const fixture = path.join(dir, 'fetch.mjs')
    const marker = path.join(dir, 'pid')
    const command = `echo $$ > '${marker}'; sleep 30`
    const event = { index: 0, id: 'call-1', name: 'bash', arguments: JSON.stringify({ command }) }
    const sse = `event: tool_call_delta\ndata: ${JSON.stringify(event)}\n\nevent: finish\ndata: {"reason":"tool_calls"}\n\nevent: done\ndata: {"ok":true}\n\n`
    fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(sse)})`)
    child = spawn(process.execPath, ['--import', fixture, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '--print', '--yolo', '--', 'Run cancellation fixture'], { cwd: dir, env: { ...process.env, NALU_TOKEN: 'test-token', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' }, stdio: 'ignore' })
    const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
    const deadline = Date.now() + 5000
    while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(fs.existsSync(marker), true, 'shell starts')
    shellPid = Number(fs.readFileSync(marker, 'utf8').trim())
    child.kill('SIGTERM')
    assert.equal(await closed, 143)
    let running = true
    for (let i = 0; i < 50 && running; i++) {
      try { process.kill(-shellPid, 0); await new Promise((resolve) => setTimeout(resolve, 20)) } catch { running = false }
    }
    assert.equal(running, false, 'shell group was terminated')
  } finally {
    child?.kill('SIGKILL')
    if (shellPid) { try { process.kill(-shellPid, 'SIGKILL') } catch {} }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
