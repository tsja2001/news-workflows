/**
 * ============================================================
 * src/fetch/html.js 单元测试
 * ============================================================
 * 用 fixture HTML 测试链接提取和选择器提取
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractLinks, extractWithSelectors } from '../fetch/html.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function loadFixture(name) {
  return fs.readFile(
    path.join(__dirname, '..', '..', 'test', 'fixtures', name),
    'utf-8'
  )
}

describe('html adapter', () => {
  describe('extractLinks', () => {
    it('extracts links from a list page using CSS selector', async () => {
      const html = await loadFixture('news-list.html')
      const links = extractLinks(html, '.dataList li a', 'https://example.com', 10)
      assert.strictEqual(links.length, 4)
      // 相对链接转为绝对链接
      assert.ok(links[0].startsWith('https://example.com/world/article-1.html'))
      // 已经是绝对链接的不加前缀
      assert.ok(links[2].startsWith('https://external.com/article-3.html'))
    })

    it('respects maxArticles limit', async () => {
      const html = await loadFixture('news-list.html')
      const links = extractLinks(html, '.dataList li a', 'https://example.com', 2)
      assert.strictEqual(links.length, 2)
    })

    it('skips elements without href', async () => {
      const html = '<div class="links"><span>text</span></div>'
      const links = extractLinks(html, '.links span', 'https://x.com', 10)
      assert.strictEqual(links.length, 0)
    })
  })

  describe('extractWithSelectors', () => {
    it('extracts title, content, and publishedAt using selectors', async () => {
      const html = await loadFixture('news-detail.html')
      const result = extractWithSelectors(html, {
        title: 'h1.article-title',
        content: 'div.article-body',
        publishedAt: 'span.pub-time',
      })
      assert.ok(result.title.includes('Iran'))
      assert.ok(result.content.includes('Vienna'))
      assert.ok(result.content.includes('Oil markets'))
      assert.ok(result.publishedAt.includes('May 5'))
    })

    it('extracts publishedAt from attribute when specified', async () => {
      const html = await loadFixture('news-detail.html')
      const result = extractWithSelectors(html, {
        publishedAt: 'span.pub-time',
        publishedAtAttr: 'datetime',
      })
      assert.strictEqual(result.publishedAt, '2026-05-05T10:30:00Z')
    })

    it('returns empty strings for missing selectors', () => {
      const html = '<div><p>Some text</p></div>'
      const result = extractWithSelectors(html, {
        title: 'h1',
        content: '.nonexistent',
      })
      assert.strictEqual(result.title, '')
      assert.strictEqual(result.content, '')
    })
  })
})
