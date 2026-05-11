/**
 * src/utils/html-cleaner.js 单元测试
 * 覆盖：list/article 模式、压缩率、<a> 标签保留、script/style 移除、截断
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanHtml } from './html-cleaner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '..', '..', 'test', 'fixtures', 'cleaner')

function loadFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf-8')
}

describe('cleanHtml — list mode', () => {
  it('achieves significant compression on realistic news list', () => {
    const html = loadFixture('news-list-realistic.html')
    const { originalLength, cleanedLength } = cleanHtml(html, { mode: 'list' })
    const compression = (1 - cleanedLength / originalLength) * 100
    // fixture 较小，真实几百 KB 页面压缩率 >60%
    assert.ok(compression > 60, `compression only ${compression.toFixed(1)}%`)
  })

  it('preserves all <a> tags with href', () => {
    const html = loadFixture('news-list-realistic.html')
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    // Count <a href=...> in cleaned output
    const aMatches = cleaned.match(/<a\s[^>]*href=/g) || []
    // Original had 3 article links + nav links (nav is removed, so nav links gone)
    // After cleaning: nav is removed, so article links remain
    assert.ok(aMatches.length >= 3, `expected >=3 <a> tags, got ${aMatches.length}`)
  })

  it('removes script and style tags completely', () => {
    const html = loadFixture('news-list-realistic.html')
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.includes('<script'))
    assert.ok(!cleaned.includes('<style'))
  })

  it('removes header, footer, nav, aside in list mode', () => {
    const html = loadFixture('minimal-list.html')
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.toLowerCase().includes('footer content'))
    // But main content remains
    assert.ok(cleaned.includes('First Article Title'))
  })

  it('removes event attributes (on*)', () => {
    const html = '<div onclick="alert(1)" onmouseover="hover()"><a href="/test">link</a></div>'
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.includes('onclick'))
    assert.ok(!cleaned.includes('onmouseover'))
  })

  it('removes style attribute', () => {
    const html = '<p style="color:red;font-size:14px;">text</p>'
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.includes('style='))
  })

  it('removes data-* attributes', () => {
    const html = '<div data-track="list" data-promo-id="789">content</div>'
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.includes('data-track'))
    assert.ok(!cleaned.includes('data-promo-id'))
  })

  it('removes base64 inline resources', () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="test">'
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.includes('data:image'))
  })

  it('truncates to maxChars', () => {
    const html = '<p>' + 'x'.repeat(5000) + '</p>'
    const { cleaned, truncated } = cleanHtml(html, { mode: 'list', maxChars: 1000 })
    assert.ok(cleaned.length <= 1000)
    assert.strictEqual(truncated, true)
  })

  it('sets truncated=false when under maxChars', () => {
    const html = '<p>short text</p>'
    const { truncated } = cleanHtml(html, { mode: 'list' })
    assert.strictEqual(truncated, false)
  })

  it('removes empty divs and spans', () => {
    const html = '<body><div></div><span></span><p>content</p></body>'
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    assert.ok(!cleaned.includes('<div></div>'))
    assert.ok(!cleaned.includes('<span></span>'))
    assert.ok(cleaned.includes('content'))
  })

  it('truncates long class attributes', () => {
    const longClass = Array.from({ length: 10 }, (_, i) => 'class-' + i).join(' ')
    const html = `<div class="${longClass}">content</div>`
    const { cleaned } = cleanHtml(html, { mode: 'list' })
    // Should only keep first 3 classes
    const match = cleaned.match(/class="([^"]*)"/)
    if (match) {
      const classes = match[1].split(/\s+/)
      assert.ok(classes.length <= 3, `expected <=3 classes, got ${classes.length}: ${match[1]}`)
    }
  })
})

describe('cleanHtml — article mode', () => {
  it('achieves significant compression on realistic article', () => {
    const html = loadFixture('news-article-realistic.html')
    const { originalLength, cleanedLength } = cleanHtml(html, { mode: 'article' })
    const compression = (1 - cleanedLength / originalLength) * 100
    // fixture 较小，真实几百 KB 页面压缩率 >70%
    assert.ok(compression > 70, `compression only ${compression.toFixed(1)}%`)
  })

  it('finds and keeps <article> content', () => {
    const html = loadFixture('news-article-realistic.html')
    const { cleaned } = cleanHtml(html, { mode: 'article' })
    assert.ok(cleaned.includes('Iran nuclear deal talks resume'))
    assert.ok(cleaned.includes('Vienna'))
  })

  it('removes header/nav/footer content', () => {
    const html = loadFixture('news-article-realistic.html')
    const { cleaned } = cleanHtml(html, { mode: 'article' })
    assert.ok(!cleaned.includes('Related articles'))
    assert.ok(!cleaned.includes('Most Read'))
  })

  it('removes class and id attributes', () => {
    const html = '<div class="story-body" id="main-content"><p>text</p></div>'
    const { cleaned } = cleanHtml(html, { mode: 'article' })
    assert.ok(!cleaned.includes('class='))
    assert.ok(!cleaned.includes('id='))
  })

  it('extracts main when article is absent', () => {
    const html = '<!DOCTYPE html><html><head></head><body><header>nav</header><main><h1>Main Story</h1><p>Story content here.</p></main><footer>foot</footer></body></html>'
    const { cleaned } = cleanHtml(html, { mode: 'article' })
    assert.ok(cleaned.includes('Main Story'))
    assert.ok(cleaned.includes('Story content'))
    assert.ok(!cleaned.includes('nav'))
    assert.ok(!cleaned.includes('foot'))
  })

  it('falls back to text-heaviest div when no article/main', () => {
    const html = '<body><div>short</div><div><h1>The Title</h1><p>' + 'paragraph text. '.repeat(50) + '</p></div></body>'
    const { cleaned } = cleanHtml(html, { mode: 'article' })
    assert.ok(cleaned.includes('The Title'))
    assert.ok(cleaned.includes('paragraph text'))
  })
})
