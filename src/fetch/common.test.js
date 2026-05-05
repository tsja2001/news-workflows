/**
 * ============================================================
 * src/fetch/common.js 单元测试
 * ============================================================
 * 覆盖：时间过滤、关键词过滤、URL 去重、排序截断、applyFilters 管线
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  filterByTime,
  filterByKeywords,
  dedupByUrl,
  sortAndTruncate,
  applyFilters,
} from '../fetch/common.js'

// ---- 测试用 fixture ----
function makeItems() {
  const now = Date.now()
  return [
    { title: 'Iran nuclear deal talks resume', url: 'https://example.com/1', source: 'Al Jazeera', publishedAt: new Date(now - 3600 * 1000).toISOString(), summary: 'Nuclear negotiations continue' },
    { title: 'Oil prices surge on supply fears', url: 'https://example.com/2', source: 'BBC', publishedAt: new Date(now - 7200 * 1000).toISOString(), summary: 'Oil market reacts to Middle East tensions' },
    { title: 'Sanctions impact Iranian economy', url: 'https://example.com/3', source: 'Reuters', publishedAt: new Date(now - 86400 * 1000).toISOString(), summary: 'Economic indicators show decline' },
    { title: 'Sport event draws crowds', url: 'https://example.com/4', source: 'ESPN', publishedAt: new Date(now - 1800 * 1000).toISOString(), summary: 'Big match today' },
    { title: 'Duplicate Iran article', url: 'https://example.com/1', source: 'AP', publishedAt: new Date(now - 600 * 1000).toISOString(), summary: 'Same story different source' },
  ]
}

describe('filterByTime', () => {
  it('keeps items within lookback window', () => {
    const items = makeItems()
    const result = filterByTime(items, 48)
    // items 1, 2, 4, 5 are within 48h (item 3 is 24h ago, also within 48h)
    assert.strictEqual(result.length, 5)
  })

  it('filters out items older than lookback', () => {
    const items = makeItems()
    const result = filterByTime(items, 12)
    // Only items from <12h ago should remain: 1 (1h), 2 (2h), 4 (0.5h), 5 (10min)
    // Item 3 is 24h ago, should be filtered
    assert.strictEqual(result.length, 4)
  })
})

describe('filterByKeywords', () => {
  it('matches case-insensitive keywords in title and summary', () => {
    const items = makeItems()
    const result = filterByKeywords(items, ['iran', 'sanctions'])
    // Item 1: Iran in title ✓, Item 3: Sanctions in title ✓, Item 5: Iran in title ✓
    assert.strictEqual(result.length, 3)
  })

  it('returns all items when keywords list is empty', () => {
    const items = makeItems()
    assert.strictEqual(filterByKeywords(items, []).length, 5)
    assert.strictEqual(filterByKeywords(items, null).length, 5)
  })
})

describe('dedupByUrl', () => {
  it('removes duplicate URLs, keeping first occurrence', () => {
    const result = dedupByUrl(makeItems())
    // URL https://example.com/1 appears twice (items 0 and 4)
    // First occurrence (Al Jazeera) should be kept
    assert.strictEqual(result.length, 4)
    assert.strictEqual(result[0].source, 'Al Jazeera')
  })

  it('respects existing seen set', () => {
    const existing = new Set(['https://example.com/3'])
    const result = dedupByUrl(makeItems(), existing)
    // Item 3's URL is already seen, so filtered out
    assert.strictEqual(result.length, 3)
    assert.ok(!result.find(i => i.url === 'https://example.com/3'))
  })

  it('skips items with empty URL', () => {
    const items = [
      ...makeItems(),
      { title: 'No URL', url: '', source: 'X', publishedAt: new Date().toISOString(), summary: '' },
    ]
    const result = dedupByUrl(items)
    assert.strictEqual(result.length, 4)
  })
})

describe('sortAndTruncate', () => {
  it('sorts by publishedAt descending', () => {
    const result = sortAndTruncate(makeItems(), 10)
    for (let i = 0; i < result.length - 1; i++) {
      assert.ok(new Date(result[i].publishedAt) >= new Date(result[i + 1].publishedAt))
    }
  })

  it('truncates to maxItems', () => {
    const result = sortAndTruncate(makeItems(), 2)
    assert.strictEqual(result.length, 2)
  })
})

describe('applyFilters', () => {
  it('runs full pipeline: time → keyword → URL dedup', () => {
    const items = makeItems()
    const config = { lookbackHours: 48, keywords: ['iran'] }
    const result = applyFilters(items, config)
    // Items with "iran": 1, 3, 5 (but 1 and 5 share URL, dedup keeps 1)
    assert.strictEqual(result.length, 2)
  })

  it('accepts seenUrls set for cross-source dedup', () => {
    const items = makeItems()
    const seen = new Set(['https://example.com/1'])
    const config = { lookbackHours: 48, keywords: [] }
    const result = applyFilters(items, config, seen)
    // Items 0 and 4 share URL already in seen set
    assert.strictEqual(result.length, 3)
  })
})
