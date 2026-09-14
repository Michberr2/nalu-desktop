import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const source = compile('../src/lib/naluApi.ts')
  .replace("'./settings'", JSON.stringify(url(compile('../src/lib/settings.ts'))))
  .replace("'./chatStream'", JSON.stringify(url(compile('../src/lib/chatStream.ts'))))
const { syncCliConfig } = await import(url(source))
test('desktop sync preserves standalone defaults until the user saves preferences, including explicit sign-out', () => {
  const originalWindow = globalThis.window, originalStorage = globalThis.localStorage
  const stored = new Map(), calls = []
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null }
  globalThis.window = { nalu: { cliSync: value => { calls.push(value); return Promise.resolve(true) } } }
  try {
    syncCliConfig()
    assert.equal(calls.length, 1)
    for (const key of ['reasoning', 'maxTokens', 'webSearch', 'token']) assert.equal(Object.hasOwn(calls[0], key), false)
    stored.set('nalu-model-settings', JSON.stringify({ reasoning: 'high', maxTokens: 16000, webSearch: false, streaming: false }))
    syncCliConfig()
    assert.equal(calls[1].reasoning, 'high'); assert.equal(calls[1].maxTokens, 16000); assert.equal(calls[1].webSearch, false)
    assert.equal(Object.hasOwn(calls[1], 'streaming'), false, 'renderer presentation preference is not a model option')
    syncCliConfig(true)
    assert.equal(calls[2].token, '')
    assert.equal(calls[2].reasoning, 'high')
  } finally { globalThis.window = originalWindow; globalThis.localStorage = originalStorage }
})
