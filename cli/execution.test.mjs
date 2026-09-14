import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runBash, streamOnce, recoverToolCalls } from './nalu.mjs'

const shellOptions = { skip: process.platform === 'win32', timeout: 5000 }

test('piped test failures retain failure status and prevent success-only follow-up', shellOptions, async () => {
  const result = await runBash(`(printf 'test failed\\n'; exit 7) 2>&1 | tail -n 1 && printf 'incorrect success'`, 1000, {})
  assert.match(result, /exit code: 7\n/)
  assert.match(result, /test failed/)
  assert.doesNotMatch(result, /incorrect success/)
})

test('successful pipelines remain successful', shellOptions, async () => {
  const result = await runBash(`printf 'first\\nlast\\n' | tail -n 1`, 1000, {})
  assert.match(result, /exit code: 0\nlast/)
})

test('explicit shell recovery remains under command control', shellOptions, async () => {
  const result = await runBash(`(exit 7) | cat || printf 'handled failure'`, 1000, {})
  assert.match(result, /exit code: 0\nhandled failure/)
})

test('shell commands receive EOF on stdin and return their real exit status', shellOptions, async () => {
  const state = {}
  const result = await runBash('cat; printf "stdin closed"; exit 7', 1000, state)
  assert.match(result, /exit code: 7\nstdin closed/)
  assert.doesNotMatch(result, /timed out/)
  assert.equal(state.currentChild, null)
})

test('signal termination is never reported as shell success', shellOptions, async () => {
  const result = await runBash('kill -TERM $$', 1000, {})
  assert.match(result, /terminated by SIGTERM/)
  assert.match(result, /exit code: 1/)
})

test('timed-out shell commands report failure', shellOptions, async () => {
  const result = await runBash('sleep 20', 1000, {})
  assert.match(result, /timed out after 1000ms/)
  assert.match(result, /exit code: 1/)
})

function event(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}
async function stream(wire) {
  const original = globalThis.fetch
  const state = { api: 'https://nalu.invalid', messages: [], workerAborts: new Set() }
  try {
    // Byte-by-byte transport also exercises split UTF-8 and SSE field boundaries.
    const bytes = new TextEncoder().encode(wire)
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }))
    return await streamOnce(state, {}, { quiet: true })
  } finally {
    globalThis.fetch = original
    assert.equal(state.workerAborts.size, 0)
  }
}

test('fragmented streams preserve Unicode and assembled tool arguments', async () => {
  const result = await stream(event('delta', { text: '🌊' }) +
    event('tool_call_delta', { index: 0, id: 'call-1', name: 'read_file', arguments: '{"path":' }) +
    event('tool_call_delta', { index: 0, arguments: '"README.md"}' }) +
    event('finish', { reason: 'tool_calls' }) + event('done', { ok: true }))
  assert.equal(result.error, '')
  assert.equal(result.text, '🌊')
  assert.equal(result.toolCalls[0].function.arguments, '{"path":"README.md"}')
})

test('output-limit and filtered finishes cannot be mistaken for complete answers', async () => {
  for (const reason of ['length', 'content_filter']) {
    const result = await stream(event('delta', { text: 'Partial' }) + event('finish', { reason }) + event('done', { ok: true }))
    assert.match(result.error, /incomplete|before completion/)
  }
})

test('malformed events and invalid tool fragments fail even with a done marker', async () => {
  for (const malformed of [
    'event: delta\ndata: {broken}\n\n',
    event('delta', null),
    event('tool_call_delta', { index: '__proto__', name: 'bash' }),
    event('tool_call_delta', { index: -1, name: 'bash' }),
    event('tool_call_delta', { name: 'bash', arguments: { command: 'echo bad' } }),
  ]) {
    const result = await stream(event('delta', { text: 'Partial' }) + malformed + event('done', { ok: true }))
    assert.match(result.error, /malformed|invalid/)
  }
})

test('event names do not leak into subsequent unnamed SSE messages', async () => {
  const result = await stream(event('delta', { text: 'Answer' }) + 'data: {"text":"unrelated"}\n\n' + event('done', { ok: true }))
  assert.equal(result.text, 'Answer')
  assert.equal(result.error, '')
})


test('CLI refuses to execute tools from a response cut off by the output limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-incomplete-'))
  try {
    const wire = event('tool_call_delta', {
      index: 0, id: 'call-1', name: 'write_file',
      arguments: JSON.stringify({ path: 'must-not-exist.txt', content: 'unsafe partial response' }),
    }) + event('finish', { reason: 'length' }) + event('done', { ok: true })
    const fixture = path.join(dir, 'fetch.mjs')
    fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(wire)})`)
    const result = spawnSync(process.execPath, ['--import', fixture,
      fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--yolo', '--no-stdin', 'Write a file'], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /output limit/)
    assert.equal(fs.existsSync(path.join(dir, 'must-not-exist.txt')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('HTTP errors have actionable guidance and permanent errors are not retried', async () => {
  const original = globalThis.fetch
  try {
    for (const [status, retryable, guidance] of [
      [401, false, /NALU_TOKEN/], [403, false, /access/],
      [404, false, /API base URL/], [429, true, /Wait/], [503, true, /503/],
    ]) {
      let cancelled = false
      globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { status })
      const state = { api: 'https://nalu.invalid', messages: [], workerAborts: new Set() }
      const result = await streamOnce(state, {}, { quiet: true })
      assert.equal(result.retryable, retryable)
      assert.match(result.error, guidance)
      assert.equal(cancelled, true, 'unused error body is cancelled')
      assert.equal(state.workerAborts.size, 0)
    }
  } finally { globalThis.fetch = original }
})

test('CLI stops after the first authentication failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-auth-error-'))
  try {
    const fixture = path.join(dir, 'fetch.mjs')
    fs.writeFileSync(fixture, `let calls = 0; globalThis.fetch = async () => {
      if (++calls > 1) throw new Error('must not retry authentication');
      return new Response('', {status: 401});
    }`)
    const result = spawnSync(process.execPath, ['--import', fixture,
      fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', 'hello'], {
      cwd: dir, encoding: 'utf8', timeout: 2000,
      env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /HTTP 401.*NALU_TOKEN/)
    assert.doesNotMatch(result.stderr, /retrying/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})


test('live-model name-prefixed calls unwrap the arguments envelope', () => {
  const result = recoverToolCalls('Let me see the project first.bash{"arguments":{"command":"ls -la"}}')
  assert.equal(result.calls.length, 1)
  assert.equal(result.calls[0].function.arguments, '{"command":"ls -la"}')
})

for (const malformed of ['bashbash<|content_text|>node edge.test.mjs && node public.test.mjs\nexit code: 0', 'bashbashedit_fileedit_file{"arguments":{"path":"x.py","old_string":"old","new_string":"new"}}', '{"name":"bash","arguments":"command":"ls -la"}}', 'Now run the test to confirm.bashbash{"arguments":{"command":"node total.test.mjs"}'])
test(`repeated malformed tool responses fail instead of reporting success: ${malformed}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-malformed-'))
  try {
    const fixture = path.join(dir, 'fetch.mjs')
    const wire = event('delta', { text: malformed }) + event('done', { ok: true })
    fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(wire)})`)
    const result = spawnSync(process.execPath, ['--import', fixture,
      fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', 'Inspect the project'], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /repeatedly returned malformed tool calls/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('background descendants holding pipes do not keep the CLI process alive', { skip: process.platform === 'win32', timeout: 6000 }, () => {
  const moduleUrl = new URL('./nalu.mjs', import.meta.url).href
  const script = `import { runBash } from ${JSON.stringify(moduleUrl)}; process.stdout.write(await runBash('sleep 30 & echo SHELL=$$ BG=$!', 10000, {}));`
  let shellPid
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 4000 })
    shellPid = Number(/SHELL=(\d+)/.exec(result.stdout || '')?.[1])
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.match(result.stdout, /exit code: 0/)
    assert.ok(shellPid > 0)
  } finally {
    if (shellPid) { try { process.kill(-shellPid, 'SIGKILL') } catch {} }
  }
})

for (const coding of [true, false]) test(`tool evidence guard distinguishes file work from explanations: ${coding}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-unverified-code-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const wire = event('delta', { text: 'Fixed both modules and verified. All tests now pass.' }) + event('done', { ok: true })
  fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(wire)})`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', coding ? 'Fix the invoice.mjs module and run tests' : 'Explain how quantity multiplication works'], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  assert.equal(result.status, coding ? 1 : 0, result.stderr)
  if (coding) assert.match(result.stderr, /no successful tool evidence/)
})

test('live malformed argument labels recover only complete adjacent JSON', () => {
  const recovered = recoverToolCalls('Re-reading.read_filearguments":{"path":"price.mjs"}}')
  assert.equal(recovered.calls.length, 1)
  assert.equal(recovered.calls[0].function.name, 'read_file')
  assert.deepEqual(JSON.parse(recovered.calls[0].function.arguments), {path:'price.mjs'})
  assert.equal(recoverToolCalls('read_filearguments":{"path":"price.mjs"').calls.length, 0)
  assert.equal(recoverToolCalls('read_filearguments": prose {"path":"price.mjs"}').calls.length, 0)
})

test('duplicated live-model tool labels recover one complete call',()=>{
  for(const name of ['bash','read_file']) {
    const args=name==='bash'?{command:'node public.test.mjs'}:{path:'pool.mjs'}
    const result=recoverToolCalls(`Retrying.${name}${name}${JSON.stringify({arguments:args})}`)
    assert.equal(result.calls.length,1);assert.equal(result.calls[0].function.name,name)
    assert.deepEqual(JSON.parse(result.calls[0].function.arguments),args)
  }
  assert.equal(recoverToolCalls('bashbash{"arguments":{"command":"node test.mjs"}').calls.length,0)
  assert.equal(recoverToolCalls('foobashbash{"arguments":{"command":"node test.mjs"}}').calls.length,0)
})

test('mixed tool-name tokens remain unexecuted rather than guessing an action',()=>{
  assert.equal(recoverToolCalls('Fixing it.bashbashedit_fileedit_file{"arguments":{"path":"x.py","old_string":"old","new_string":"new"}}').calls.length,0)
})

test('repeated labels and leaked transport markers recover complete JSON exactly once',()=>{
  const command='node edge.test.mjs && node public.test.mjs'
  for (const count of [1, 3, 4, 6, 20]) for (const marker of ['', '<|content_text|>']) {
    const result=recoverToolCalls(`Re-run.${'bash'.repeat(count)}${marker}${JSON.stringify({command})}`)
    assert.equal(result.calls.length,1)
    assert.equal(result.calls[0].function.name,'bash')
    assert.deepEqual(JSON.parse(result.calls[0].function.arguments),{command})
  }
  for (const malformed of [
    'bashbash<|content_text|>node edge.test.mjs\nexit code: 0',
    'bashbash<|content_text|>{"command":"node edge.test.mjs"',
    'bashbash<|content_text|>{command:"node edge.test.mjs"}',
    'foobashbash<|content_text|>{"command":"node edge.test.mjs"}',
    'bashbashedit_file<|content_text|>{"path":"x","content":"y"}',
  ]) assert.equal(recoverToolCalls(malformed).calls.length,0,malformed)
})
