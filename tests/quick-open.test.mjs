import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=ts.transpileModule(fs.readFileSync(new URL('../src/lib/quickOpen.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {matchFiles}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
test('quick open ranks filenames, paths and abbreviations while retaining Unicode and literal names',()=>{
  const paths=['other/index.ts','src/index.ts','index.test.ts','INDEX.ts','src/終-$&.ts']
  assert.deepEqual(matchFiles(paths,'index.ts'),['other/index.ts','src/index.ts','INDEX.ts','index.test.ts'])
  assert.deepEqual(matchFiles(paths,'src\\index'),['src/index.ts'])
  assert.deepEqual(matchFiles(paths,'sx'),['src/index.ts'])
  assert.deepEqual(matchFiles(paths,'終-$&'),['src/終-$&.ts'])
  assert.deepEqual(matchFiles(paths,'missing'),[])
})
test('quick open bounds rendered matches and preserves initial order',()=>{
  const paths=Array.from({length:5000},(_,i)=>`file-${i}.txt`)
  assert.deepEqual(matchFiles(paths,''),paths.slice(0,100))
})
