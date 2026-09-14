import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
const code = ts.transpileModule(fs.readFileSync(new URL('../electron/cliInstall.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {installDesktopCli} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-desktop-install-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const sourcePath=path.join(dir,'bundled.mjs'),binDir=path.join(dir,"bin's $(literal)")
  fs.writeFileSync(sourcePath,"const VERSION = '1.10.14'\nconsole.log(JSON.stringify(process.argv.slice(2)))\n")
  return {sourcePath,binDir,runtime:process.execPath}
}
test('fresh install launches the full bundled CLI without node on PATH and preserves arguments',t=>{
  const options=setup(t), result=installDesktopCli(options)
  const run=spawnSync(result.launcher,['space here',"quote's",'$(literal)'],{env:{...process.env,PATH:'/nonexistent'},encoding:'utf8'})
  assert.equal(run.status,0,run.stderr)
  assert.deepEqual(JSON.parse(run.stdout),['space here',"quote's",'$(literal)'])
  assert.equal(result.version,'1.10.14')
  assert.equal(fs.readFileSync(result.script,'utf8'),fs.readFileSync(options.sourcePath,'utf8'))
})
test('desktop updates older CLI versions but preserves a valid newer standalone CLI',t=>{
  const options=setup(t);fs.mkdirSync(options.binDir)
  const installed=path.join(options.binDir,'nalu.mjs')
  fs.writeFileSync(installed,"const VERSION = '1.9.99'\n")
  assert.equal(installDesktopCli(options).version,'1.10.14')
  const newer="const VERSION = '2.0.0'\nconsole.log('newer')\n";fs.writeFileSync(installed,newer)
  assert.equal(installDesktopCli(options).version,'2.0.0')
  assert.equal(fs.readFileSync(installed,'utf8'),newer)
})
test('invalid staged bundle preserves the working installation and leaves no temporary files',t=>{
  const options=setup(t), result=installDesktopCli(options)
  const original=fs.readFileSync(result.script,'utf8')
  fs.writeFileSync(options.sourcePath,"const VERSION = '1.10.15'\ninvalid syntax !!!!")
  assert.throws(()=>installDesktopCli(options),/syntax check/)
  assert.equal(fs.readFileSync(result.script,'utf8'),original)
  assert.deepEqual(fs.readdirSync(options.binDir).sort(),['nalu','nalu.mjs'])
})
test('a corrupt newer local CLI is repaired and Windows receives a cmd launcher',t=>{
  const options=setup(t);fs.mkdirSync(options.binDir)
  fs.writeFileSync(path.join(options.binDir,'nalu.mjs'),"const VERSION = '99.0.0'\nsyntax !!!")
  const result=installDesktopCli({...options,platform:'win32'})
  assert.equal(result.version,'1.10.14');assert.ok(result.launcher.endsWith('nalu.cmd'))
  assert.match(fs.readFileSync(result.launcher,'utf8'),/ELECTRON_RUN_AS_NODE=1/)
})
test('desktop release manifest includes the full CLI resource',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
  assert.ok(pkg.build.extraResources.some(r=>r.from==='cli/nalu.mjs'&&r.to==='cli/nalu.mjs'))
})
test('desktop launcher supplies browser runtime paths without shell interpolation',t=>{
  const options=setup(t),appPath=path.join(options.binDir,"app's $(literal)")
  fs.writeFileSync(options.sourcePath,"const VERSION = '1.11.0'\nconsole.log(JSON.stringify([process.env.NALU_DESKTOP_RUNTIME,process.env.NALU_DESKTOP_APP]))\n")
  const result=installDesktopCli({...options,appPath})
  const run=spawnSync(result.launcher,[],{env:{...process.env,PATH:'/nonexistent'},encoding:'utf8'})
  assert.equal(run.status,0,run.stderr)
  assert.deepEqual(JSON.parse(run.stdout),[process.execPath,appPath])
})
