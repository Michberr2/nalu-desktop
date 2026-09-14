import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/editProposal.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {extractProposedFile}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('complete replacements include empty files and embedded shorter fences',()=>{
 assert.equal(extractProposedFile('```text\nhello\n```'),'hello')
 assert.equal(extractProposedFile('```\n```'),'')
 assert.equal(extractProposedFile('````md\n```js\ncode\n```\n````'),'```js\ncode\n```')
 assert.equal(extractProposedFile('```text\nhello\n\n```'),'hello\n')
})
test('partial, ambiguous and multiple-file responses cannot become a replacement',()=>{
 for(const text of ['plain text','```js\npartial','```js\none\n```\n```js\ntwo\n```','```js\nfirst\n```\nleftover','text before\n```js\nfirst\n```'])assert.equal(extractProposedFile(text),null,text)
})
