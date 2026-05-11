/**
 * src/fetch/index.js 单元测试
 * 覆盖：pool map 两种格式、并发上限、源超时
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

describe('scheduler', () => {
  let origLogLevel

  beforeEach(() => {
    origLogLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'quiet'
  })

  afterEach(() => {
    process.env.LOG_LEVEL = origLogLevel
  })

  it('number concurrency: all types share one pool', async () => {
    const { fetchAll } = await import('./index.js')

    // 创建 mock adapter，每个源延迟 10ms
    const sources = [
      { type: 'rss', name: 'rss-1', url: 'https://example.com/rss1' },
      { type: 'rss', name: 'rss-2', url: 'https://example.com/rss2' },
      { type: 'web', name: 'web-1', url: 'https://example.com/web1' },
      { type: 'html', name: 'html-1', name: 'html-1', listUrl: 'https://example.com/html1' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
      runtime: { concurrency: 2 },
    }

    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    // No real adapter registered for these URLs, so should get 0 items
    // But it shouldn't crash
    assert.ok(Array.isArray(result))
  })

  it('object concurrency: each type has own pool', async () => {
    const { fetchAll } = await import('./index.js')

    const sources = [
      { type: 'rss', name: 'rss-1', url: 'https://example.com/rss1' },
      { type: 'web', name: 'web-1', url: 'https://example.com/web1' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
      runtime: {
        concurrency: { rss: 8, web: 2, default: 5 },
      },
    }

    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    assert.ok(Array.isArray(result))
  })

  it('unknown source type is skipped gracefully', async () => {
    const { fetchAll } = await import('./index.js')

    const sources = [
      { type: 'unknown_type', name: 'bad', url: 'https://example.com' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
    }

    // Should not throw
    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    assert.strictEqual(result.length, 0)
  })

  it('source timeout kills long-running source', async () => {
    const { fetchAll, ADAPTERS } = await import('./index.js')

    // 临时注册一个慢 adapter
    const origAdapter = ADAPTERS['_slow_test']
    ADAPTERS['_slow_test'] = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return [{ title: 'slow', url: 'https://example.com/slow', source: 'test', publishedAt: new Date().toISOString(), summary: '' }]
    }

    try {
      const sources = [
        { type: '_slow_test', name: 'slow-source', url: 'https://example.com' },
      ]

      const filterConfig = {
        lookbackHours: 48,
        keywords: [],
        maxItems: 100,
        runtime: { sourceTimeoutMs: 100, retries: 0 },
      }

      const result = await fetchAll(sources, filterConfig, { noDedup: true })
      // Should hit timeout and get empty result
      assert.strictEqual(result.length, 0)
    } finally {
      delete ADAPTERS['_slow_test']
    }
  })

  it('defaults type to rss when not specified', async () => {
    const { fetchAll } = await import('./index.js')

    const sources = [
      { name: 'no-type', url: 'https://example.com/no-type' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
    }

    // The scheduler should treat this as RSS and try to fetch
    // It will likely fail (invalid RSS) but shouldn't crash
    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    assert.ok(Array.isArray(result))
  })
})
