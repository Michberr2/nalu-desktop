import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
const compile=file=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const limits='data:text/javascript;base64,'+Buffer.from(compile('../src/lib/searchLimits.ts')).toString('base64')
const code=compile('../electron/fileSearch.ts').replace("'../src/lib/searchLimits'",JSON.stringify(limits))
const {searchFiles}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const fixture=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-search-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
test('search finds extensionless and arbitrary UTF-8 text but skips binary, large and ignored files',async t=>{
  const dir=fixture(t)
  for(const name of ['Makefile','Dockerfile','.env','module.unusual'])fs.writeFileSync(path.join(dir,name),'first\nNeEdLe café\n')
  fs.writeFileSync(path.join(dir,'binary.js'),Buffer.from('needle\0binary'))
  fs.writeFileSync(path.join(dir,'invalid'),Buffer.from([0xff,110,101,101,100,108,101]))
  fs.writeFileSync(path.join(dir,'large.txt'),'needle');fs.truncateSync(path.join(dir,'large.txt'),2_000_001)
  fs.mkdirSync(path.join(dir,'node_modules'));fs.writeFileSync(path.join(dir,'node_modules','hidden'),'needle')
  const hits=await searchFiles(dir,'NEEDLE')
  assert.deepEqual(hits.map(h=>h.rel).sort(),['.env','Dockerfile','Makefile','module.unusual'].sort())
  assert.ok(hits.every(h=>h.line===2&&h.text==='NeEdLe café'))
})
test('search is capped and does not follow file or directory symlinks',async t=>{
  const dir=fixture(t),outside=fixture(t)
  fs.writeFileSync(path.join(outside,'external'),'needle outside')
  fs.symlinkSync(outside,path.join(dir,'linked-dir'));fs.symlinkSync(path.join(outside,'external'),path.join(dir,'linked-file'))
  assert.deepEqual(await searchFiles(dir,'needle'),[])
  fs.writeFileSync(path.join(dir,'many'),'needle\n'.repeat(350))
  const hits=await searchFiles(dir,'needle')
  assert.equal(hits.length,300);assert.equal(hits[299].line,300)
})
test('search reports inaccessible roots and supports cancellation before and during traversal',async t=>{
  const dir=fixture(t);fs.writeFileSync(path.join(dir,'file'),'needle')
  await assert.rejects(searchFiles(path.join(dir,'missing'),'needle'),/ENOENT/)
  const before=new AbortController();before.abort()
  await assert.rejects(searchFiles(dir,'needle',before.signal),{name:'AbortError'})
  const during=new AbortController(),pending=searchFiles(dir,'needle',during.signal)
  during.abort()
  await assert.rejects(pending,{name:'AbortError'})
  assert.equal((await searchFiles(dir,'needle')).length,1)
})
