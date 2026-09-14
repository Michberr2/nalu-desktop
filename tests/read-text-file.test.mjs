import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const code = ts.transpileModule(fs.readFileSync(new URL('../electron/readTextFile.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const { readTextFile, EDITOR_FILE_LIMIT } = await import(moduleUrl)
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-text-read-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('text reads preserve BOM, line endings and Unicode spanning read chunks', async t => {
  const dir = fixture(t), file = path.join(dir, 'text')
  for (const text of ['', '\ufeff' + 'a'.repeat(65532) + '🌊\r\n終\n', 'a'.repeat(EDITOR_FILE_LIMIT)]) {
    fs.writeFileSync(file, text)
    assert.equal(await readTextFile(file), text)
  }
  if (process.platform !== 'win32') {
    fs.symlinkSync(file, path.join(dir, 'link'))
    assert.equal((await readTextFile(path.join(dir, 'link'))).length, EDITOR_FILE_LIMIT)
  }
})

test('binary, malformed UTF-8, oversized and non-file inputs fail without changing bytes', async t => {
  const dir = fixture(t), file = path.join(dir, 'input')
  for (const bytes of [Buffer.from([65, 0, 66]), Buffer.from([0xff, 0xfe, 65, 0]), Buffer.from([65, 0xc3]), Buffer.from([0xc0, 0xaf])]) {
    fs.writeFileSync(file, bytes)
    await assert.rejects(readTextFile(file), /binary data or is not valid UTF-8/)
    assert.deepEqual(fs.readFileSync(file), bytes)
  }
  fs.truncateSync(file, EDITOR_FILE_LIMIT + 1)
  await assert.rejects(readTextFile(file), /10 MiB/)
  await assert.rejects(readTextFile(dir), /regular text files|EISDIR/)
  await assert.rejects(readTextFile(path.join(dir, 'missing')), /ENOENT/)
})

test('opening a FIFO without a writer does not block', { skip: process.platform === 'win32' }, t => {
  const dir = fixture(t), fifo = path.join(dir, 'pipe')
  const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const {readTextFile}=await import(${JSON.stringify(moduleUrl)});try{await readTextFile(${JSON.stringify(fifo)});process.exitCode=1}catch(e){if(!/regular text files/.test(e.message))throw e}`],
    { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})

test('a file growing after stat is still bounded during the read', async t => {
  const dir = fixture(t), file = path.join(dir, 'growing.txt')
  fs.writeFileSync(file, 'a')
  const open = fs.promises.open.bind(fs.promises)
  t.mock.method(fs.promises, 'open', async (...args) => {
    const handle = await open(...args), read = handle.read.bind(handle)
    let grew = false
    handle.read = async (...readArgs) => {
      if (!grew) { grew = true; fs.appendFileSync(file, Buffer.alloc(EDITOR_FILE_LIMIT, 65)) }
      return read(...readArgs)
    }
    return handle
  })
  await assert.rejects(readTextFile(file), /10 MiB/)
})
