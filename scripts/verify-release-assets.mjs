import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),yaml=require('js-yaml')
assert.ok(process.argv[2],'Supply the release directory')
const directory=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)))
const feed=yaml.load(fs.readFileSync(path.join(directory,'latest-mac.yml'),'utf8'))
assert.equal(feed.version,manifest.version)
assert.ok(feed.stagingPercentage===undefined||feed.stagingPercentage===100,'Release must reach every eligible user')
const archive=`Nalu-${manifest.version}-mac-universal.zip`,entry=feed.files.find(file=>file.url===archive)
assert.ok(entry,'Universal automatic-update ZIP missing from feed')
const assets={}
for(const name of ['Nalu-mac.dmg',archive,archive+'.blockmap','latest-mac.yml']){
 const bytes=fs.readFileSync(path.join(directory,name));assert.ok(bytes.length>0)
 assets[name]={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
 if(name===archive){assert.equal(bytes.length,entry.size);assert.equal(createHash('sha512').update(bytes).digest('base64'),entry.sha512)}
}
const config=yaml.load(fs.readFileSync(path.join(directory,'mac-universal/Nalu.app/Contents/Resources/app-update.yml'),'utf8'))
assert.equal(config.provider,'github');assert.equal(config.owner,'Michberr2');assert.equal(config.repo,'nalu-desktop');assert.ok(config.updaterCacheDirName)
if(process.argv.includes('--public')){
 const signature=JSON.parse(fs.readFileSync(path.join(directory,'signature-verification.json')))
 assert.equal(signature.signed,true,'Developer ID verification required')
 assert.equal(signature.gatekeeperAccepted,true,'Apple notarization has not passed Gatekeeper')
 assert.equal(signature.stapleValidated,true,'Stapled Apple ticket required')
 for(const receipt of ['runtime-verification.json','startup-verification.json','updater-verification.json'])assert.equal(JSON.parse(fs.readFileSync(path.join(directory,receipt))).passed,true,receipt)
}
const receipt={checkedAt:new Date().toISOString(),version:manifest.version,assets,publicChecks:process.argv.includes('--public')}
fs.writeFileSync(path.join(directory,'asset-verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2))
