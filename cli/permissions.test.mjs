import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { recoverToolCalls, isProjectScratchPath } from './nalu.mjs'

test('shell examples stay answer content even with short or action-oriented prose', () => {
  for (const answer of [
    'Try this:\n```bash\nnpm test\n```',
    '```sh\nrm -rf build\n```',
    'I will run this:\n```bash\necho example\n```',
    'bash\necho example',
  ]) {
    const result = recoverToolCalls(answer)
    assert.deepEqual(result.calls, [])
    assert.match(result.cleaned, /npm test|rm -rf build|echo example/)
  }
})

test('explicit shell calls still work', () => {
  for (const answer of [
    'bash({"command":"npm test"})',
    '{"name":"bash","arguments":{"command":"npm test"}}',
    'bash{"arguments":{"command":"npm test"}}',
  ]) {
    const result = recoverToolCalls(answer)
    assert.equal(result.calls.length, 1)
    assert.equal(JSON.parse(result.calls[0].function.arguments).command, 'npm test')
  }
})

test('scratch approval checks actual destinations including nonexistent children', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-scratch-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo')
  const outside = path.join(dir, 'outside')
  fs.mkdirSync(repo)
  fs.mkdirSync(outside)
  assert.equal(isProjectScratchPath('.nalu/plans/new.md', repo), true)
  assert.equal(isProjectScratchPath('.nalu/../code.js', repo), false)
  assert.equal(isProjectScratchPath('.nalu-other/file', repo), false)
  fs.mkdirSync(path.join(repo, '.nalu'))
  fs.writeFileSync(path.join(repo, '.nalu', 'notes.md'), 'notes')
  assert.equal(isProjectScratchPath('.nalu/notes.md', repo), true)
  fs.symlinkSync(outside, path.join(repo, '.nalu', 'escape'))
  assert.equal(isProjectScratchPath('.nalu/escape/new.md', repo), false)
  fs.symlinkSync(path.join(outside, 'missing'), path.join(repo, '.nalu', 'dangling'))
  assert.equal(isProjectScratchPath('.nalu/dangling', repo), false)
  const linkedRepo = path.join(dir, 'linked-repo')
  fs.symlinkSync(repo, linkedRepo)
  assert.equal(isProjectScratchPath('.nalu/notes.md', linkedRepo), true)
})

test('a symlink replacing the scratch directory does not grant outside write approval', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-scratch-root-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo')
  const outside = path.join(dir, 'outside')
  fs.mkdirSync(repo)
  fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(repo, '.nalu'))
  assert.equal(isProjectScratchPath('.nalu/new.md', repo), false)
})


test('print mode with --yolo does not execute a shell example', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-example-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const answer = 'Example command:\n```bash\nprintf example > must-not-exist\n```'
  const wire = `event: delta\ndata: ${JSON.stringify({ text: answer })}\n\nevent: done\ndata: {"ok":true}\n\n`
  fs.writeFileSync(fixture, `globalThis.fetch = async () => new Response(${JSON.stringify(wire)})`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', '--yolo', 'Show a shell example'], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /printf example/)
  assert.equal(fs.existsSync(path.join(dir, 'must-not-exist')), false)
})

for (const allowed of [false, true]) test(`transport-marker recovery preserves shell permission and executes once: ${allowed}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-marker-permission-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fixture = path.join(dir, 'fetch.mjs')
  const answer = 'bashbashbashbashbashbash<|content_text|>'+JSON.stringify({command:'printf executed >> executions'})
  const wire = text => `event: delta\ndata: ${JSON.stringify({text})}\n\nevent: done\ndata: {"ok":true}\n\n`
  fs.writeFileSync(fixture, `let requests=0; globalThis.fetch=async()=>new Response(++requests===1?${JSON.stringify(wire(answer))}:${JSON.stringify(wire('Finished responding.'))})`)
  const result = spawnSync(process.execPath, ['--import', fixture,
    fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin',
    ...(allowed ? ['--yolo'] : []), 'Inspect the project'], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: {...process.env, NALU_REMOTE_TASK:'', NALU_NO_TRAINING_DATA:'1', NO_COLOR:'1'},
  })
  assert.equal(result.error, undefined)
  const marker = path.join(dir, 'executions')
  if (allowed) {
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readFileSync(marker,'utf8'), 'executed')
  } else assert.equal(fs.existsSync(marker), false)
})
