import test from 'node:test'
import assert from 'node:assert/strict'
import readline from 'node:readline'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { askLine } from './nalu.mjs'

function terminal(t) {
  const input = new PassThrough()
  const output = new PassThrough()
  const rl = readline.createInterface({ input, output, terminal: false })
  t.after(() => { rl.close(); input.destroy(); output.destroy() })
  return { input, state: { rl, permAbort: null } }
}

test('permission prompts resolve on EOF and clean up their abort handle', async t => {
  const { input, state } = terminal(t)
  const pending = askLine(state, 'Allow? ')
  input.end()
  assert.equal(await pending, 'n')
  assert.equal(state.permAbort, null)
  assert.equal(state.rl.listenerCount('close'), 0)
  assert.equal(await askLine(state, 'Already closed? '), 'n')
})

test('cancelled permission prompts can be followed by a fresh prompt', async t => {
  const { input, state } = terminal(t)
  const baseline = state.rl.listenerCount('close')
  const cancelled = askLine(state, 'First? ')
  state.permAbort.abort()
  assert.equal(await cancelled, 'n')
  assert.equal(state.permAbort, null)
  const next = askLine(state, 'Second? ')
  input.write('yes\n')
  assert.equal(await next, 'yes')
  assert.equal(state.permAbort, null)
  assert.equal(state.rl.listenerCount('close'), baseline)
})

test('repeated answered prompts do not accumulate close listeners', async t => {
  const { input, state } = terminal(t)
  const baseline = state.rl.listenerCount('close')
  for (let i = 0; i < 20; i++) {
    const pending = askLine(state, 'Answer? ')
    input.write('hello\n')
    assert.equal(await pending, 'hello')
    assert.equal(state.rl.listenerCount('close'), baseline)
  }
})

test('interactive EOF exits cleanly, including during multiline input', { timeout: 5000 }, async () => {
  for (const multiline of [false, true]) {
    const child = spawn(process.execPath, ['cli/nalu.mjs'], {
      env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = '', error = '', sent = false, ended = false
    const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
    child.stderr.on('data', data => { error += data })
    child.stdout.on('data', data => {
      output += data
      if (!sent && output.includes('❯ ')) {
        sent = true
        if (multiline) child.stdin.write('unfinished prompt\\\n')
        else { ended = true; child.stdin.end() }
      }
      if (multiline && !ended && output.includes('… ')) { ended = true; child.stdin.end() }
    })
    try {
      assert.equal(await closed, 0, error)
      assert.match(output, /bye/)
      assert.equal(error, '')
    } finally { child.kill('SIGKILL') }
  }
})
