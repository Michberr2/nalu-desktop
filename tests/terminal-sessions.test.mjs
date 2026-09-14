import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code = ts.transpileModule(fs.readFileSync(new URL('../electron/terminalSessions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { TerminalSessions } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const fake = () => ({ killed: 0, writes: [], sizes: [], kill() { this.killed++ }, write(d) { this.writes.push(d) }, resize(c,r) { this.sizes.push([c,r]) }, onData(cb) { this.data = cb }, onExit(cb) { this.exit = cb } })

test('closing a tab during startup terminates the late process', async () => {
  const sessions = new TerminalSessions(), proc = fake()
  let finish
  const pending = sessions.create('1:tab', () => new Promise(resolve => { finish = resolve }), () => assert.fail('closed terminal emitted output'))
  sessions.kill('1:tab'); finish(proc)
  assert.equal(await pending, false)
  assert.equal(proc.killed, 1)
})

test('late exit and output from a replaced process cannot affect the new shell', async () => {
  const sessions = new TerminalSessions(), old = fake(), current = fake(), events = []
  await sessions.create('1:tab', async () => old, (...event) => events.push(event))
  await sessions.create('1:tab', async () => current, (...event) => events.push(event))
  old.data('stale'); old.exit({ exitCode: 1 })
  sessions.input('1:tab', 'nalu\r'); current.data('ready')
  assert.deepEqual(current.writes, ['nalu\r'])
  assert.deepEqual(events, [['data', 'ready']])
  assert.equal(old.killed, 1)
})

test('window cleanup isolates owners, cancels pending startup, and validates resize', async () => {
  const sessions = new TerminalSessions(), first = fake(), second = fake()
  await sessions.create('1:tab', async () => first, () => {})
  await sessions.create('2:tab', async () => second, () => {})
  sessions.killOwner(1)
  sessions.input('1:tab', 'ignored'); sessions.input('2:tab', 'retained')
  sessions.resize('2:tab', 0, 1); sessions.resize('2:tab', 80.5, 24); sessions.resize('2:tab', 120, 40)
  assert.equal(first.killed, 1)
  assert.deepEqual(first.writes, [])
  assert.deepEqual(second.writes, ['retained'])
  assert.deepEqual(second.sizes, [[120, 40]])
  sessions.killAll(); assert.equal(second.killed, 1)
})

test('spawn failure allows an explicit retry', async () => {
  const sessions = new TerminalSessions(), proc = fake()
  await assert.rejects(sessions.create('1:tab', async () => { throw new Error('missing shell') }, () => {}), /missing shell/)
  await sessions.create('1:tab', async () => proc, () => {})
  sessions.input('1:tab', 'retry'); assert.deepEqual(proc.writes, ['retry'])
})
