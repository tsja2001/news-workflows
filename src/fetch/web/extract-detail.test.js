/**
 * src/fetch/web/extract-detail.js 单元测试
 * 覆盖：readability 策略成功/不足、auto 模式 readability 成功路径
 * 注意：auto 模式降级到 AI 的路径会触发真实 LLM 调用，不在单元测试覆盖
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

describe('extractDetail strategies', () => {
  let origLogLevel

  before(() => {
    origLogLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'quiet'
  })

  after(() => {
    process.env.LOG_LEVEL = origLogLevel
  })

  it('readability strategy returns content from article HTML', async () => {
    const { extractDetail } = await import('./extract-detail.js')
    const longText = 'article content paragraph. '.repeat(20)
    const html = `<html><head><title>Test Article</title></head><body><article><h1>Test</h1><p>${longText}</p></article></body></html>`
    const result = await extractDetail(html, 'https://example.com/article/1', 'readability')
    assert.ok(result.content.length >= 100)
  })

  it('readability strategy: short content returns as-is', async () => {
    const { extractDetail } = await import('./extract-detail.js')
    const html = '<html><body><article><h1>Brief</h1><p>tiny.</p></article></body></html>'
    const result = await extractDetail(html, 'https://example.com/article/2', 'readability')
    // Readability extracts the content even if short — strategy=readability returns what it gets
    assert.strictEqual(typeof result.title, 'string')
    assert.strictEqual(typeof result.content, 'string')
  })

  it('auto strategy: sufficient content uses readability successfully', async () => {
    const { extractDetail } = await import('./extract-detail.js')
    const longText = 'word '.repeat(200)
    const html = `<html><head><title>Long Article Title</title></head><body><article><p>${longText}</p></article></body></html>`
    const result = await extractDetail(html, 'https://example.com/article/3', 'auto')
    assert.ok(result.content.length >= 100, `content length ${result.content.length} < 100`)
    assert.ok(result.title.length > 0)
  })

  it('readability strategy works with real-world HTML structure', async () => {
    const { extractDetail } = await import('./extract-detail.js')
    const html = `<!DOCTYPE html><html><head><title>Real World</title></head><body>
      <header><nav>Menu</nav></header>
      <main><article>
        <h1>Breaking News Story</h1>
        <p class="lead">${'Lead paragraph content. '.repeat(5)}</p>
        <p>${'Body paragraph with more details. '.repeat(30)}</p>
        <div class="related">Related links</div>
      </article></main>
      <footer>Copyright</footer>
    </body></html>`
    const result = await extractDetail(html, 'https://example.com/article/4', 'readability')
    assert.ok(result.content.length >= 100)
    assert.ok(result.content.includes('Body paragraph'))
    assert.ok(!result.content.includes('Related links'))
  })

  it('deep strategy: runs both readability and AI, takes longer content', async () => {
    const { extractDetail } = await import('./extract-detail.js')
    // readability will succeed with long content, AI will fail without API key
    // deep mode should still return the readability result
    const longText = 'paragraph content here. '.repeat(30)
    const html = `<html><head><title>Deep Test</title></head><body><article><h1>Deep Article</h1><p>${longText}</p></article></body></html>`
    const result = await extractDetail(html, 'https://example.com/deep/1', 'deep')
    assert.ok(result.content.length >= 100)
    assert.ok(result._strategy.startsWith('deep_'))
    // _readabilityLen and _aiLen should be present
    assert.ok(typeof result._readabilityLen === 'number')
    assert.ok(typeof result._aiLen === 'number')
  })
})
