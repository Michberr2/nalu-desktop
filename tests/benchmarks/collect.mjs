import fs from 'node:fs'
import path from 'node:path'
const [destination,...reports]=process.argv.slice(2)
if(!destination||!reports.length)throw new Error('Usage: collect.mjs output.json report.json ...')
const runs=reports.map(file=>{
  const report=JSON.parse(fs.readFileSync(file,'utf8'))
  const regradeFile=path.join(report.output,'regrade-v2.json')
  const regrade=fs.existsSync(regradeFile)?JSON.parse(fs.readFileSync(regradeFile,'utf8')):null
  const auditFile=path.join(report.output,'generated-check-audit.json')
  const generatedCheckAudit=fs.existsSync(auditFile)?JSON.parse(fs.readFileSync(auditFile,'utf8')):null
  const firstLog=fs.readFileSync(path.join(report.output,report.cases[0].id,'cli.log'),'utf8')
  const model=report.tool==='codex'?firstLog.match(/^model: (.+)$/m)?.[1]:report.tool==='claude'?firstLog.match(/"model":"([^"]+)"/)?.[1]:'Nalu auto routing; backend model identifiers not exposed'
  return {...report,observedModel:model,regrade,generatedCheckAudit,cases:report.cases.map(item=>{
    const workspace=path.join(report.output,item.id,'workspace')
    const sources={},generatedChecks={}
    for(const name of fs.readdirSync(workspace))if(name.endsWith('.test.mjs') && name!=='public.test.mjs' && !name.startsWith('acceptance'))generatedChecks[name]=fs.readFileSync(path.join(workspace,name),'utf8')
    for(const name of fs.readdirSync(workspace))if((name.endsWith('.mjs')||name.endsWith('.py'))&&!name.includes('.test.')&&!name.startsWith('test_'))sources[name]=fs.readFileSync(path.join(workspace,name),'utf8')
    return {...item,finalPassed:regrade?.results.find(r=>r.id===item.id)?.passed??item.passed,sources,generatedChecks}
  })}
})
fs.writeFileSync(destination,JSON.stringify({scope:'Small coding fixtures, one attempt per tool/version; see each run suite and accompanying report for development versus holdout status. Not a general parity or speed benchmark.',runs},null,2)+'\n')
console.log(destination)
