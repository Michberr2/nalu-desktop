import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../electron/gitWorkspace.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {parseGitStatus,workspaceStatus,workspaceDiff}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const git=async(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});return {ok:r.status===0,out:r.stdout+(r.status===0?'':r.stderr)}}
function repo(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-git-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));spawnSync('git',['init','-b','fixture-branch'],{cwd:dir});return dir}
test('Git status preserves spaces, Unicode, newlines and rename destinations',()=>{
  assert.deepEqual(parseGitStatus(' M a b.txt\0?? 雨\n.txt\0R  new name.txt\0old name.txt\0'),[
    {x:' ',y:'M',path:'a b.txt'},{x:'?',y:'?',path:'雨\n.txt'},{x:'R',y:' ',path:'new name.txt'}])
})
test('new repositories show their actual branch and untracked paths',async t=>{
  const dir=repo(t);fs.writeFileSync(path.join(dir,'a b.txt'),'new\n')
  const status=await workspaceStatus(git,dir)
  assert.equal(status.repo,true);assert.equal(status.branch,'fixture-branch');assert.equal(status.files[0].path,'a b.txt')
  assert.match(await workspaceDiff(git,dir,'a b.txt',false),/\+new/)
})
test('staged and unstaged reviews differ and unchanged tracked files stay empty',async t=>{
  const dir=repo(t), file=path.join(dir,'file.txt')
  fs.writeFileSync(file,'baseline\n');await git(dir,['add','file.txt']);await git(dir,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'])
  assert.equal(await workspaceDiff(git,dir,'file.txt',false),'')
  fs.writeFileSync(file,'staged\n');await git(dir,['add','file.txt']);fs.writeFileSync(file,'working\n')
  const staged=await workspaceDiff(git,dir,'file.txt',true), working=await workspaceDiff(git,dir,'file.txt',false)
  assert.match(staged,/\+staged/);assert.doesNotMatch(staged,/\+working/)
  assert.match(working,/-staged/);assert.match(working,/\+working/)
})
