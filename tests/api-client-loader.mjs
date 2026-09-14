import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Run the real client in an isolated browser-like context without account data.
export function loadApi(fetchImpl) {
  const storage = new Map(), synced = []
  const context = vm.createContext({
    fetch: fetchImpl, Response, TextDecoder, DOMException, AbortController,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,String(value)), removeItem: key => storage.delete(key) },
    window: { nalu: { cliSync: async data => { synced.push(data) } } },
  })
  const cache = new Map()
  function require(name) {
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name,module)
    const code = ts.transpileModule(fs.readFileSync(new URL(`../src/lib/${name.replace('./','')}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    vm.runInContext(`(function(require,module,exports){${code}\n})`,context)(require,module,module.exports)
    return module.exports
  }
  return { api: require('./naluApi'), intent: require('./taskIntent'), storage, synced }
}
