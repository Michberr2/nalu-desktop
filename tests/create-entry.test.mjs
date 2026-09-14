import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../electron/createEntry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {createEntry}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('file creation preserves existing data and folder creation stays in its selected directory',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-create-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const folder=await createEntry(root,'folder with spaces','folder')
  const file=await createEntry(folder,'draft.js','file')
  fs.writeFileSync(file,'keep this')
  await assert.rejects(createEntry(folder,'draft.js','file'),/already exists/)
  assert.equal(fs.readFileSync(file,'utf8'),'keep this')
  await assert.rejects(createEntry(root,'folder with spaces','folder'),/already exists/)
  for(const name of ['','..','../escape','nested/file','nested\\file','bad\0name'])await assert.rejects(createEntry(root,name,'file'),/name without path separators/)
})
