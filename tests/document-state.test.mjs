import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source = fs.readFileSync(new URL('../src/lib/documentState.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {applyProposedContent,reconcileDisk,acknowledgeSave,acknowledgeSaveAs,relocateTabs,relocatedPath,detachDeletedTabs} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const tab = () => ({path:'/fixture.js',name:'fixture.js',content:'original',savedContent:'original',dirty:false})
test('clean tabs follow CLI disk changes',()=>{
  const next = reconcileDisk(tab(),'agent edit')
  assert.equal(next.content,'agent edit');assert.equal(next.savedContent,'agent edit');assert.equal(next.dirty,false)
})
test('agent writes preserve unsaved user edits and expose a conflict',()=>{
  const next = reconcileDisk({...tab(),content:'user edit',dirty:true},'agent edit')
  assert.equal(next.content,'user edit');assert.equal(next.dirty,true);assert.equal(next.diskConflict,'agent edit')
})
test('an unchanged disk never resets a pending user edit',()=>{
  const edited = {...tab(),content:'user edit',dirty:true}
  assert.equal(reconcileDisk(edited,'original'),edited)
})
test('saving an older snapshot leaves newer typing dirty',()=>{
  const next=acknowledgeSave({...tab(),content:'newer edit',dirty:true},'older edit')
  assert.equal(next.content,'newer edit');assert.equal(next.savedContent,'older edit');assert.equal(next.dirty,true)
})
test('matching disk contents acknowledge an already persisted edit',()=>{
  const next=reconcileDisk({...tab(),content:'user edit',dirty:true},'user edit')
  assert.equal(next.dirty,false);assert.equal(next.diskConflict,undefined)
})

test('Save As acknowledges only the written snapshot and clears recovery errors',()=>{
  const current={...tab(),content:'newer typing',dirty:true,recovered:true,saveError:'missing',diskConflict:'other'}
  const result=acknowledgeSaveAs(current,'/saved/recovered.ts','written snapshot')
  assert.equal(result.path,'/saved/recovered.ts');assert.equal(result.name,'recovered.ts')
  assert.equal(result.content,'newer typing');assert.equal(result.savedContent,'written snapshot');assert.equal(result.dirty,true)
  assert.equal(result.recovered,false);assert.equal(result.saveError,undefined);assert.equal(result.diskConflict,undefined)
})

test('folder rename preserves dirty buffers, conflicts and recovery state without touching similarly named siblings',()=>{
  const dirty={...tab(),path:'/project/src/a.js',name:'a.js',content:'draft',dirty:true,recovered:true,diskConflict:'agent edit',saveError:'denied'}
  const sibling={...tab(),path:'/project/src-old/a.js'}
  const result=relocateTabs([dirty,sibling],'/project/src','/project/lib')
  assert.deepEqual(result[0],{...dirty,path:'/project/lib/a.js'})
  assert.equal(result[1],sibling)
  assert.equal(relocatedPath('C:\\project\\src\\a.js','C:\\project\\src','C:\\project\\lib'),'C:\\project\\lib\\a.js')
})

test('file rename changes its tab name and refuses to merge another open buffer',()=>{
  assert.equal(relocateTabs([tab()],'/fixture.js','/renamed.ts')[0].name,'renamed.ts')
  assert.throws(()=>relocateTabs([tab(),{...tab(),path:'/renamed.ts'}],'/fixture.js','/renamed.ts'),/already open/)
})

test('trash closes clean descendants and preserves dirty children without stale disk actions',()=>{
  const dirty={...tab(),path:'/project/src/draft.js',content:'draft',dirty:true,diskConflict:'other',saveError:'denied'}
  const sibling={...tab(),path:'/project/src-other/keep.js'}
  const result=detachDeletedTabs([{...tab(),path:'/project/src/clean.js'},dirty,sibling],'/project/src')
  assert.equal(result.length,2);assert.equal(result[1],sibling)
  assert.equal(result[0].content,'draft');assert.equal(result[0].savedContent,'original')
  assert.equal(result[0].detached,true);assert.equal(result[0].recovered,true)
  assert.equal(result[0].diskConflict,undefined);assert.equal(result[0].saveError,undefined)
  assert.equal(reconcileDisk(result[0],'replacement file'),result[0])
  const saved=acknowledgeSaveAs(result[0],'/project/saved.js','draft')
  assert.equal(saved.detached,false);assert.equal(saved.dirty,false)
})

test('edit proposals preserve original path and saved snapshot, including empty replacements',()=>{
  const next=applyProposedContent(tab(),'original','')
  assert.equal(next.path,'/fixture.js');assert.equal(next.content,'');assert.equal(next.savedContent,'original');assert.equal(next.dirty,true)
  assert.equal(applyProposedContent({...tab(),content:'draft',dirty:true},'draft','original').dirty,false)
})
test('stale, conflicted and detached edit proposals cannot overwrite current work',()=>{
  for(const current of [{...tab(),content:'new typing'},{...tab(),diskConflict:'external change'},{...tab(),detached:true}])assert.equal(applyProposedContent(current,'original','replacement'),null)
})
