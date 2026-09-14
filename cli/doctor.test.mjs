import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { doctorReport, validateApiBase, parseArgs } from './nalu.mjs'

test('doctor checks setup without revealing credentials', () => {
  const report = doctorReport({ api: 'https://nalu.invalid/', token: 'secret-test-token', shellAvailable: true })
  assert.equal(report.ok, true)
  assert.doesNotMatch(JSON.stringify(report), /secret-test-token/)
  assert.match(JSON.stringify(report), /validity not tested/)
  const bad = doctorReport({ api: 'https://user:private@nalu.invalid', token: {}, shellAvailable: false, nodeVersion: '16.0.0' })
  assert.equal(bad.ok, false)
  assert.doesNotMatch(JSON.stringify(bad), /private/)
  assert.ok(bad.checks.filter(check => !check.ok).length >= 4)
})

test('API configuration normalizes valid bases and rejects ambiguous or unsafe values', () => {
  assert.equal(validateApiBase('https://nalu.invalid///'), 'https://nalu.invalid')
  assert.equal(validateApiBase('http://localhost:3000'), 'http://localhost:3000')
  for (const value of [{}, 'no-url', 'file:///tmp/api', 'https://user:secret@nalu.invalid', 'https://nalu.invalid?token=secret', 'https://nalu.invalid#fragment'])
    assert.throws(() => validateApiBase(value), /API base/)
})

test('doctor is a standalone command and remains usable as a literal prompt', () => {
  assert.equal(parseArgs(['doctor']).doctor, true)
  assert.equal(parseArgs(['-p', 'doctor']).prompt, 'doctor')
  assert.equal(parseArgs(['--', 'doctor']).doctor, false)
})

test('doctor CLI diagnoses invalid configuration without a model request', () => {
  const result = spawnSync(process.execPath, ['cli/nalu.mjs', 'doctor', '--api', 'invalid'], {
    encoding: 'utf8', timeout: 2000,
    env: { ...process.env, NALU_TOKEN: 'private-test-token' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Invalid API base URL/)
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-token|retrying/)
})
