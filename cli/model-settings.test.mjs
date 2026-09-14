import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs, streamOnce, execTool, execWorkerTool } from './nalu.mjs'

test('reasoning and token flags validate explicit choices', () => {
  assert.equal(parseArgs(['--reasoning', 'high']).reasoning, 'high')
  assert.equal(parseArgs(['--max-tokens', '16384']).maxTokens, 16384)
  assert.equal(parseArgs(['--no-web-search']).webSearch, false)
  for (const value of ['highest', '', 'HIGH']) assert.throws(() => parseArgs(['--reasoning', value]), /reasoning/)
  for (const value of ['0', '255', '32001', '8192.5', '8e3', 'NaN']) assert.throws(() => parseArgs(['--max-tokens', value]), /maxTokens/)
  for (const flag of ['--reasoning', '--max-tokens']) assert.throws(() => parseArgs([flag]), /requires a value/)
})

test('requests preserve selected capacity and web limits while keywords raise saved reasoning', async () => {
  const original = globalThis.fetch, requests = []
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return new Response('event: delta\ndata: {"text":"Ready."}\n\nevent: done\ndata: {"ok":true}\n\n')
  }
  try {
    const state = { api: 'http://127.0.0.1', messages: [{ role: 'user', content: 'Reply Ready.' }], workerAborts: new Set(),
      modelSettings: { reasoning: 'low', maxTokens: 12345, webSearch: false } }
    for (const think of [0, 1, 2, 3]) {
      const result = await streamOnce(state, null, { quiet: true, think })
      assert.equal(result.error, '')
      assert.equal(requests.at(-1).reasoning, ['low', 'medium', 'high', 'high'][think])
      assert.equal(requests.at(-1).maxTokens, 12345)
      assert.equal(requests.at(-1).webSearch, false)
      assert.ok(requests.at(-1).tools.every(tool => !['web_search', 'fetch_url'].includes(tool.function.name)))
      assert.ok(requests.at(-1).tools.some(tool => tool.function.name === 'read_file'))
    }
    state.modelOverrides = { reasoning: 'none', maxTokens: 256 }
    await streamOnce(state, null, { quiet: true, think: 3 })
    assert.equal(requests.at(-1).reasoning, 'none')
    assert.equal(requests.at(-1).maxTokens, 256)
    assert.equal(requests.at(-1).webSearch, false)
  } finally { globalThis.fetch = original }
})

test('disabled web tools cannot run through recovered calls or worker execution', async () => {
  const state = { modelSettings: { webSearch: false } }
  for (const execute of [execTool, execWorkerTool]) for (const name of ['web_search', 'fetch_url']) {
    assert.match(await execute(state, { function: { name, arguments: '{}' } }), /Web tools are disabled/)
  }
})

test('actual CLI reads desktop preferences and gives explicit flags precedence over environment and saved settings', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-model-settings-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, '.nalu'))
  fs.writeFileSync(path.join(home, '.nalu/cli.json'), JSON.stringify({ reasoning: 'medium', maxTokens: 8192, webSearch: false }))
  const requests = path.join(home, 'request.json'), mock = path.join(home, 'fetch.mjs')
  fs.writeFileSync(mock, `import fs from 'node:fs';globalThis.fetch=async(_url,options)=>{fs.writeFileSync(${JSON.stringify(requests)},options.body);return new Response('event: delta\\ndata: {"text":"Ready."}\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')}`)
  const env = { ...process.env, HOME: home, NALU_REASONING: '', NALU_MAX_TOKENS: '', NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NALU_TOKEN: '', NO_COLOR: '1' }
  delete env.NALU_REASONING; delete env.NALU_MAX_TOKENS
  const run = (flags, extra = {}) => {
    const result = spawnSync(process.execPath, ['--import', mock, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', ...flags, 'Reply Ready.'], { cwd: home, env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(fs.readFileSync(requests))
  }
  let request = run([])
  assert.equal(request.reasoning, 'medium'); assert.equal(request.maxTokens, 8192); assert.equal(request.webSearch, false)
  request = run([], { NALU_REASONING: 'high', NALU_MAX_TOKENS: '14000' })
  assert.equal(request.reasoning, 'high'); assert.equal(request.maxTokens, 14000)
  request = run(['--reasoning', 'none', '--max-tokens', '2048'], { NALU_REASONING: 'high', NALU_MAX_TOKENS: '14000' })
  assert.equal(request.reasoning, 'none'); assert.equal(request.maxTokens, 2048)
})
