import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runHeadlessCli, headlessArgs, extractDroppedPaths } from './nalu.mjs'
const state = () => ({ interrupted: false, workerAborts: new Set() })
function binary(t, code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-duo-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'fake-cli')
  fs.writeFileSync(file, `#!${process.execPath}\n${code}`, { mode: 0o755 })
  return file
}

test('duo rejects partial failed proposals and empty successful responses', async t => {
  for (const code of ["console.log('Partial proposal'); console.error('quota exceeded'); process.exit(2)", "process.exit(0)"]) {
    const s = state()
    const result = await runHeadlessCli(s, 'claude', 'fixture', { binary: binary(t, code) })
    assert.equal(result.ok, false)
    assert.match(result.error, /quota exceeded|empty proposal/)
    assert.equal(s.workerAborts.size, 0)
  }
})

test('duo preserves Unicode across external CLI output chunks', async t => {
  const result = await runHeadlessCli(state(), 'claude', 'fixture', { binary: binary(t,
    "const b=Buffer.from('🌊 proposal'); process.stdout.write(b.subarray(0,2)); setTimeout(()=>process.stdout.write(b.subarray(2)),20)") })
  assert.equal(result.ok, true)
  assert.equal(result.text, '🌊 proposal')
})

test('duo timeouts and cancellation terminate external proposals and clean up state', async t => {
  const executable = binary(t, 'setInterval(()=>{},1000)')
  const s = state()
  assert.match((await runHeadlessCli(s, 'claude', 'fixture', { binary: executable, timeoutMs: 30 })).error, /timed out/)
  assert.equal(s.workerAborts.size, 0)
  const pending = runHeadlessCli(s, 'claude', 'fixture', { binary: executable })
  s.interrupted = true
  for (const ac of s.workerAborts) ac.abort()
  assert.equal((await pending).error, 'interrupted')
  assert.equal(s.workerAborts.size, 0)
})

test('duo proposals request read-only operation', () => {
  assert.ok(headlessArgs('claude', 'test').includes('plan'))
  assert.ok(headlessArgs('codex', 'test').includes('read-only'))
})


function duoFixture(t, { claudeCode, codexCode, expected, rounds = 1, cancel = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-duo-workflow-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  for (const [name, code] of [['claude', claudeCode], ['codex', codexCode]])
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n${code}`, { mode: 0o755 })
  const fixture = path.join(dir, 'fetch.mjs')
  fs.writeFileSync(fixture, `globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/data')) {
      const entry = JSON.parse(options.body);
      if (entry.status === 'cancelled') console.log('DUO_CANCEL_VERIFIED');
      return new Response(JSON.stringify({task:{id:'fixture-duo'}}));
    }
    const prompt = JSON.parse(options.body).messages[0].content;
    ${expected}
    return new Response('event: delta\\ndata: {"text":"DUO_INTEGRATION_VERIFIED"}\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
  }`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '--read-only', `/duo --rounds ${rounds} Review this fixture`], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NALU_REMOTE_TASK: '', NALU_TOKEN: 'fixture-token', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, cancel ? /DUO_CANCEL_VERIFIED/ : /DUO_INTEGRATION_VERIFIED/)
  assert.doesNotMatch(result.stderr, /Assertion|Incorrect/)
  return result
}

test('duo integration excludes a partial failed proposal while using the successful member', t => {
  const result = duoFixture(t, {
    claudeCode: "console.log('CLAUDE_PARTIAL_DO_NOT_USE'); console.error('quota exceeded'); process.exit(2)",
    codexCode: "console.log('CODEX_VALID_PROPOSAL')",
    expected: "if (!prompt.includes('CODEX_VALID_PROPOSAL') || prompt.includes('CLAUDE_PARTIAL_DO_NOT_USE')) throw new Error('Incorrect proposal integration');",
  })
  assert.match(result.stdout, /claude unavailable/)
})

test('duo cross-critique carries forward an earlier good proposal after a later failure', t => {
  duoFixture(t, {
    rounds: 2,
    claudeCode: "const p=process.argv.join(' '); if(p.includes('CODEX_ROUND_ONE')) { console.error('later failure'); process.exit(2) } console.log('CLAUDE_ROUND_ONE')",
    codexCode: "console.log(process.argv.join(' ').includes('CLAUDE_ROUND_ONE') ? 'CODEX_ROUND_TWO' : 'CODEX_ROUND_ONE')",
    expected: "if (!prompt.includes('CLAUDE_ROUND_ONE') || !prompt.includes('CODEX_ROUND_TWO')) throw new Error('Incorrect cross-critique integration');",
  })
})


test('model proposal paths and comment markers do not become automatic attachments', t => {
  assert.deepEqual(extractDroppedPaths('// before\n// after'), [])
  const result = duoFixture(t, {
    claudeCode: "console.log('// before\\n/\\nCLAUDE_VALID')",
    codexCode: "console.log('CODEX_VALID')",
    expected: "if (prompt.includes('[attached folder:') || prompt.includes('[attached file:')) throw new Error('Incorrect automatic attachment');",
  })
  assert.doesNotMatch(result.stdout, /attached folder|attached file/)
  assert.match(result.stdout, /Nalu integrates read-only/)
})

for (const fallback of [false, true]) test(`duo cancellation records cancelled during ${fallback ? 'solo fallback' : 'integration'}`, t => {
  duoFixture(t, {
    cancel: true,
    claudeCode: fallback ? 'process.exit(2)' : "console.log('CLAUDE_VALID')",
    codexCode: fallback ? 'process.exit(2)' : "console.log('CODEX_VALID')",
    expected: "process.emit('SIGINT'); throw new DOMException('cancelled', 'AbortError');",
  })
})
