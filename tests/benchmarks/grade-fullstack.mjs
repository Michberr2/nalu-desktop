import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
const workspace = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw Error('Usage: node grade-fullstack.mjs workspace')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-api-grade-'))
const dataFile = path.join(scratch, 'data/tasks.json')
// Avoid grading an unrelated server already running on a fixed test port.
const reservation = net.createServer()
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}`
let child, serverLog = ''
const results = []
async function stop() {
  if (!child || child.exitCode !== null) return
  const current = child
  await new Promise(resolve => { current.once('exit', resolve); current.kill('SIGTERM'); const timer = setTimeout(() => current.kill('SIGKILL'), 1000); timer.unref() })
}
async function start() {
  child = spawn(process.execPath, ['server.mjs'], { cwd: workspace, env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', value => { serverLog += value }); child.stderr.on('data', value => { serverLog += value })
  child.on('error', error => { serverLog += error.message })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error(`Server exited ${child.exitCode}: ${serverLog}`)
    try { const response = await fetch(base + '/api/tasks', { signal: AbortSignal.timeout(500) }); if (response.ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw Error('Server did not become ready')
}
async function request(method, route, body, raw = false) {
  const response = await fetch(base + route, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(4000) })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null, text }
}
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }) }
  catch (error) { results.push({ name, passed: false, error: error.stack }) }
  console.log(JSON.stringify(results.at(-1)))
}
let id
try {
  await start()
  await check('empty initial collection', async () => { const result = await request('GET', '/api/tasks'); assert.equal(result.status, 200); assert.deepEqual(result.data.tasks, []) })
  await check('create trims title and supplies valid defaults', async () => {
    const result = await request('POST', '/api/tasks', { title: '  Launch website  ' })
    assert.equal(result.status, 201); const task = result.data.task; id = task.id
    assert.equal(task.title, 'Launch website'); assert.equal(task.description, ''); assert.equal(task.status, 'todo'); assert.equal(task.priority, 'medium')
    assert.equal(typeof id, 'string'); assert.ok(id.length); assert.ok(Number.isFinite(Date.parse(task.createdAt)))
  })
  await check('invalid input and malformed JSON leave data unchanged', async () => {
    const before = (await request('GET', '/api/tasks')).data
    for (const body of [{}, { title: ' ' }, { title: 12 }, { title: 'x'.repeat(121) }, { title: 'ok', description: null }, { title: 'ok', description: 'x'.repeat(2001) }, { title: 'ok', status: 'bad' }, { title: 'ok', priority: 'urgent' }]) {
      const result = await request('POST', '/api/tasks', body); assert.equal(result.status, 400, JSON.stringify(body)); assert.equal(typeof result.data.error, 'string')
    }
    assert.equal((await request('POST', '/api/tasks', '{', true)).status, 400)
    assert.deepEqual((await request('GET', '/api/tasks')).data, before)
  })
  await check('partial edits preserve identity and reject invalid fields', async () => {
    const before = (await request('GET', '/api/tasks')).data.tasks.find(task => task.id === id)
    const result = await request('PATCH', '/api/tasks/' + id, { status: 'doing', priority: 'high', description: 'Ready for QA' })
    assert.equal(result.status, 200)
    for (const [key, value] of Object.entries({ ...before, status: 'doing', priority: 'high', description: 'Ready for QA' })) assert.deepEqual(result.data.task[key], value)
    for (const body of [{ title: '' }, { status: '' }, { priority: null }, { id: 'other' }, { createdAt: 'yesterday' }, { unknown: true }]) assert.equal((await request('PATCH', '/api/tasks/' + id, body)).status, 400)
    assert.deepEqual((await request('GET', '/api/tasks')).data.tasks.find(task => task.id === id), result.data.task)
  })
  await check('404, 405 and oversized body handling do not crash server', async () => {
    for (const method of ['PATCH', 'DELETE']) assert.equal((await request(method, '/api/tasks/missing', method === 'PATCH' ? { title: 'X' } : undefined)).status, 404)
    assert.equal((await request('GET', '/api/unknown')).status, 404)
    assert.equal((await request('PUT', '/api/tasks', {})).status, 405)
    assert.equal((await request('POST', '/api/tasks', { title: 'x'.repeat(70000) })).status, 413)
    assert.equal((await request('GET', '/api/tasks')).status, 200)
  })
  await check('concurrent creates persist without loss after server restart', async () => {
    const creates = await Promise.all(Array.from({ length: 8 }, (_, index) => request('POST', '/api/tasks', { title: `Concurrent ${index}` })))
    creates.forEach(result => assert.equal(result.status, 201))
    const ids = creates.map(result => result.data.task.id); assert.equal(new Set(ids).size, 8)
    const before = (await request('GET', '/api/tasks')).data
    await stop(); await start()
    const after = (await request('GET', '/api/tasks')).data
    assert.deepEqual(after, before); for (const candidate of ids) assert.ok(after.tasks.some(task => task.id === candidate))
  })
  await check('delete returns empty 204 and persists across restart', async () => {
    const result = await request('DELETE', '/api/tasks/' + id); assert.equal(result.status, 204); assert.equal(result.text, '')
    assert.equal((await request('DELETE', '/api/tasks/' + id)).status, 404)
    await stop(); await start(); assert.ok(!(await request('GET', '/api/tasks')).data.tasks.some(task => task.id === id))
  })
} catch (error) { results.push({ name: 'server startup', passed: false, error: error.stack }) }
finally {
  await stop()
  const report = { workspace, scratch, results, serverLog, passed: results.length === 7 && results.every(result => result.passed) }
  fs.writeFileSync(path.join(workspace, '../api-grade.json'), JSON.stringify(report, null, 2))
  console.log('API_GRADE: ' + report.passed)
  process.exitCode = report.passed ? 0 : 1
}
