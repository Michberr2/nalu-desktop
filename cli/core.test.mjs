import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnSync } from 'node:child_process'
import { parseArgs, readPipedInput, globToRegex } from './nalu.mjs'

test('print prompts preserve all words and literal subcommand names', () => {
  assert.equal(parseArgs(['-p', 'explain', 'this', 'repo']).prompt, 'explain this repo')
  assert.equal(parseArgs(['first', '-p', 'second']).prompt, 'first second')
  for (const name of ['worker', 'update']) {
    const args = parseArgs(['-p', name])
    assert.equal(args.prompt, name)
    assert.equal(args[name], false)
    assert.equal(parseArgs(['--', name])[name], false)
    assert.equal(parseArgs([name])[name], true)
  }
  assert.equal(parseArgs(['-p', '--', '--yolo']).prompt, '--yolo')
  assert.equal(parseArgs(['-p', '--', '--yolo']).yolo, false)
})

test('invalid flags and missing values fail with actionable errors', () => {
  assert.throws(() => parseArgs(['--pritn', 'hello']), /Unknown option.*--help/)
  for (const flag of ['--api', '--repo', '--worker-id', '--model']) {
    assert.throws(() => parseArgs([flag]), /requires a value/)
    assert.throws(() => parseArgs([flag, '-p']), /requires a value/)
  }
})

test('piped input waits for slow producers and preserves split Unicode', async () => {
  const bytes = Buffer.from('🌊 slow input')
  const input = Readable.from((async function* () {
    await delay(350)
    yield bytes.subarray(0, 2)
    yield bytes.subarray(2)
  })())
  assert.equal(await readPipedInput(input), '🌊 slow input')
})

test('piped input rejects overflow and read failures instead of returning partial input', async () => {
  await assert.rejects(readPipedInput(Readable.from(['123', '456']), 5), /exceeds 5 bytes/)
  await assert.rejects(readPipedInput(Readable.from((async function* () {
    yield 'partial'
    throw new Error('producer failed')
  })())), /producer failed/)
  assert.equal(await readPipedInput(Readable.from([])), '')
})

test('CLI invalid options exit nonzero with clean stdout', () => {
  const result = spawnSync(process.execPath, ['cli/nalu.mjs', '--pritn'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Unknown option/)
})

test('no-stdin permits automation to explicitly skip input', () => {
  assert.equal(parseArgs(['-p', '--no-stdin', 'hello']).noStdin, true)
  const result = spawnSync(process.execPath, ['cli/nalu.mjs', '-p', '--no-stdin'], {
    encoding: 'utf8', input: 'should be ignored', timeout: 2000,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /nothing to do/)
})


test('glob filters handle nested paths, zero-depth globstars, and literal punctuation', () => {
  const re = globToRegex('src/**/*.ts')
  assert.equal(re.test('src/main.ts'), true)
  assert.equal(re.test('src/lib/main.ts'), true)
  assert.equal(re.test('other/main.ts'), false)
  assert.equal(globToRegex('*.ts').test('src/main.ts'), false)
  assert.equal(globToRegex('a?b').test('a/b'), false)
  assert.equal(globToRegex('[a].ts').test('[a].ts'), true)
})
