import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

test('a CLI terminating the visual evaluation parent leaves a failed receipt and no live CLI', { timeout: 30000 }, async t => {
  const root = path.resolve(import.meta.dirname, '../..')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-visual-cancel-'))
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }))
  const cli = path.join(scratch, 'fixture.mjs')
  fs.writeFileSync(cli, `import fs from 'node:fs';fs.writeFileSync('cancellation-pid.json',JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);process.kill(process.ppid,'SIGTERM');`)
  const child = spawn(process.execPath, ['tests/benchmarks/run-visual-repair.mjs'], { cwd: root,
    env: { ...process.env, NALU_VISUAL_CLI: cli, NALU_NO_TRAINING_DATA: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') })
  let output = ''
  child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
  const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })) })
  assert.equal(result.code, 1, output)
  assert.equal(result.signal, null, 'parent handles termination rather than dying without a receipt')
  const run = output.match(/^VISUAL_REPAIR: (.+)$/m)?.[1]
  assert.ok(run, output)
  const receipt = JSON.parse(fs.readFileSync(path.join(run, 'result.json')))
  assert.equal(receipt.passed, false)
  assert.equal(receipt.cancelledBy, 'SIGTERM')
  assert.equal(receipt.requests.length, 0, 'test must not call the production API')
  assert.match(receipt.error, /cancelled/)
  assert.equal(receipt.outcomes, undefined, 'cancelled run must not start independent grading')
  const { pid } = JSON.parse(fs.readFileSync(path.join(run, 'workspace/cancellation-pid.json')))
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  console.log('VISUAL_CANCELLATION_EVIDENCE: ' + run)
})
