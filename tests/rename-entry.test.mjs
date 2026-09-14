import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../electron/renameEntry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {renameEntry}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('rename preserves file and folder contents and refuses existing entries and dangling symlinks',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-rename-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const source=path.join(root,'source'),target=path.join(root,'target')
  fs.writeFileSync(source,'source data');fs.writeFileSync(target,'target data')
  await assert.rejects(renameEntry(source,target),/already exists/)
  assert.equal(fs.readFileSync(source,'utf8'),'source data');assert.equal(fs.readFileSync(target,'utf8'),'target data')
  const link=path.join(root,'dangling')
  fs.symlinkSync(path.join(root,'missing'),link)
  await assert.rejects(renameEntry(source,link),/already exists/)
  await renameEntry(source,path.join(root,'renamed'))
  assert.equal(fs.existsSync(source),false);assert.equal(fs.readFileSync(path.join(root,'renamed'),'utf8'),'source data')
  fs.mkdirSync(path.join(root,'folder'));fs.writeFileSync(path.join(root,'folder','child'),'child data')
  await renameEntry(path.join(root,'folder'),path.join(root,'new-folder'))
  assert.equal(fs.readFileSync(path.join(root,'new-folder','child'),'utf8'),'child data')
  await assert.rejects(renameEntry(target,path.join(root,'new-folder','target')),/same folder/)
})
