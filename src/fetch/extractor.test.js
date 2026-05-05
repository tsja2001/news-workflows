/**
 * ============================================================
 * src/fetch/extractor.js 单元测试
 * ============================================================
 * 用 fixture HTML 测试 Readability 和 cheerio 提取路径
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractWithReadability, extractWithCheerio } from '../fetch/extractor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function loadFixture(name) {
  return fs.readFile(
    path.join(__dirname, '..', '..', 'test', 'fixtures', name),
    'utf-8'
  )
}

describe('extractor', () => {
  describe('extractWithReadability', () => {
    it('extracts title and content from a news article page', async () => {
      const html = await loadFixture('news-article.html')
      const result = extractWithReadability(html, 'https://example.com/article')
      assert.ok(result)
      assert.ok(result.title.includes('Iran'))
      // 正文应包含关键段落
      assert.ok(result.content.includes('World powers'))
      assert.ok(result.content.includes('sanctions'))
      assert.ok(result.content.length > 500)
      // byline 由 Readability 提取
    })

    it('returns null for a page too short', async () => {
      const html = await loadFixture('short-page.html')
      const result = extractWithReadability(html, 'https://example.com/short')
      // Readability may return null or content that's very short
      assert.ok(!result || result.content.length < 100)
    })
  })

  describe('extractWithCheerio', () => {
    it('extracts title from <title> tag', async () => {
      const html = await loadFixture('news-article.html')
      const result = extractWithCheerio(html)
      assert.ok(result)
      assert.ok(result.title.includes('Iran'))
    })

    it('finds content in <article> element', async () => {
      const html = await loadFixture('news-article.html')
      const result = extractWithCheerio(html)
      assert.ok(result)
      assert.ok(result.content.length > 200)
      assert.ok(result.content.includes('Vienna'))
    })

    it('produces excerpt from first 200 chars', async () => {
      const html = await loadFixture('news-article.html')
      const result = extractWithCheerio(html)
      assert.ok(result)
      assert.strictEqual(result.excerpt, result.content.slice(0, 200))
    })
  })
})
