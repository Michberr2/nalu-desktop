import test from 'node:test'
import assert from 'node:assert/strict'
import { renderBanner, stripAnsi } from './nalu.mjs'

test('banner fits narrow and wide terminal windows', () => {
  for (const width of [1, 10, 20, 38, 43, 44, 45, 60, 80, 100, 118]) {
    const banner = stripAnsi(renderBanner('/tmp/project', 'main', [], width))
    for (const line of banner.split('\n')) assert.ok(line.length <= width, `width ${width}: ${line}`)
    assert.ok(banner.trim())
  }
})
