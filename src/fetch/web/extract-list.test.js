/**
 * src/fetch/web/extract-list.js 单元测试
 * 覆盖：normalizeUrl 合法化逻辑
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { normalizeUrl, sortByConfidence } from './extract-list.js'

const BASE = 'https://www.bbc.com/news/world/middle_east'

describe('normalizeUrl', () => {
  it('resolves absolute URL as-is', () => {
    assert.strictEqual(
      normalizeUrl('https://www.bbc.com/news/article-123', BASE),
      'https://www.bbc.com/news/article-123'
    )
  })

  it('resolves relative path against baseUrl', () => {
    assert.strictEqual(
      normalizeUrl('/news/world-middle-east-123', BASE),
      'https://www.bbc.com/news/world-middle-east-123'
    )
  })

  it('resolves protocol-relative URL', () => {
    assert.strictEqual(
      normalizeUrl('//www.bbc.com/news/article', BASE),
      'https://www.bbc.com/news/article'
    )
  })

  it('returns null for javascript: protocol', () => {
    assert.strictEqual(normalizeUrl('javascript:void(0)', BASE), null)
  })

  it('returns null for mailto: protocol', () => {
    assert.strictEqual(normalizeUrl('mailto:test@example.com', BASE), null)
  })

  it('returns null for tel: protocol', () => {
    assert.strictEqual(normalizeUrl('tel:+1234567890', BASE), null)
  })

  it('returns null for invalid URL strings', () => {
    assert.strictEqual(normalizeUrl('', BASE), null)
    assert.strictEqual(normalizeUrl('   ', BASE), null)
    assert.strictEqual(normalizeUrl(null, BASE), null)
    assert.strictEqual(normalizeUrl(undefined, BASE), null)
  })

  it('handles URL with query params and hash', () => {
    const result = normalizeUrl('/article?id=123#section', BASE)
    assert.ok(result.includes('id=123'))
    assert.ok(result.includes('#section'))
  })
})

describe('sortByConfidence', () => {
  it('sorts high → medium → low', () => {
    const items = [
      { title: 'low1', url: 'https://a.com/1', confidence: 'low' },
      { title: 'high1', url: 'https://a.com/2', confidence: 'high' },
      { title: 'medium1', url: 'https://a.com/3', confidence: 'medium' },
      { title: 'low2', url: 'https://a.com/4', confidence: 'low' },
      { title: 'high2', url: 'https://a.com/5', confidence: 'high' },
    ]
    const sorted = sortByConfidence(items)
    assert.equal(sorted[0].confidence, 'high')
    assert.equal(sorted[1].confidence, 'high')
    assert.equal(sorted[2].confidence, 'medium')
    assert.equal(sorted[3].confidence, 'low')
    assert.equal(sorted[4].confidence, 'low')
  })

  it('treats unknown confidence as medium+ (after high)', () => {
    const items = [
      { title: 'unknown', url: 'https://a.com/1', confidence: 'whatever' },
      { title: 'high1', url: 'https://a.com/2', confidence: 'high' },
    ]
    const sorted = sortByConfidence(items)
    assert.equal(sorted[0].confidence, 'high')
  })

  it('returns empty array for empty input', () => {
    assert.equal(sortByConfidence([]).length, 0)
  })
})
