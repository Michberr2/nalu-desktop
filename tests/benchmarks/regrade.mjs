import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cases} from './cases.mjs'
for(const reportPath of process.argv.slice(2)){
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'))
  const results=[]
  for(const original of report.cases){
    const fixture=cases.find(c=>c.id===original.id)
    const cwd=path.join(report.output,original.id,'workspace')
    fs.writeFileSync(path.join(cwd,'acceptance-v2.test.mjs'),fixture.acceptanceTest)
    const result=spawnSync(process.execPath,['acceptance-v2.test.mjs'],{cwd,encoding:'utf8',timeout:15000})
    results.push({id:original.id,acceptanceCode:result.status,output:(result.stdout||'')+(result.stderr||''),caseSha256:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),passed:original.execution?.code===0&&original.publicUnchanged&&original.publicResult.code===0&&result.status===0})
  }
  const target=path.join(report.output,'regrade-v2.json')
  fs.writeFileSync(target,JSON.stringify({tool:report.tool,version:report.version,originalReport:reportPath,reason:'Added singleton and synchronous mapper coverage to async-pool after auditing a candidate implementation; all retained candidates receive the same checks.',results},null,2)+'\n')
  console.log(JSON.stringify({tool:report.tool,version:report.version,results:results.map(({id,passed,acceptanceCode})=>({id,passed,acceptanceCode})),report:target}))
}
