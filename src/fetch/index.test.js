/**
 * src/fetch/index.js 单元测试
 * 覆盖：pool map 两种格式、并发上限、源超时
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

describe('scheduler', () => {
  let origLogLevel
  let origConsoleLog
  let origConsoleError
  let fetchModule
  let originalAdapters

  beforeEach(async () => {
    origLogLevel = process.env.LOG_LEVEL
    origConsoleLog = console.log
    origConsoleError = console.error
    process.env.LOG_LEVEL = 'quiet'
    console.log = () => {}
    console.error = () => {}

    fetchModule = await import('./index.js')
    originalAdapters = { ...fetchModule.ADAPTERS }
  })

  afterEach(() => {
    process.env.LOG_LEVEL = origLogLevel
    console.log = origConsoleLog
    console.error = origConsoleError
    for (const key of Object.keys(fetchModule.ADAPTERS)) {
      delete fetchModule.ADAPTERS[key]
    }
    Object.assign(fetchModule.ADAPTERS, originalAdapters)
  })

  function createItem(sourceName, suffix = '1') {
    return {
      title: `${sourceName} item ${suffix}`,
      url: `https://fixture.test/${sourceName}/${suffix}`,
      source: sourceName,
      publishedAt: new Date().toISOString(),
      summary: 'fixture summary',
    }
  }

  function registerMockAdapter(type = '_mock_test') {
    fetchModule.ADAPTERS[type] = async source => [createItem(source.name || type)]
  }

  it('number concurrency: all types share one pool', async () => {
    const { fetchAll } = fetchModule
    registerMockAdapter()

    const sources = [
      { type: '_mock_test', name: 'source-1', url: 'https://fixture.test/1' },
      { type: '_mock_test', name: 'source-2', url: 'https://fixture.test/2' },
      { type: '_mock_test', name: 'source-3', url: 'https://fixture.test/3' },
      { type: '_mock_test', name: 'source-4', url: 'https://fixture.test/4' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
      runtime: { concurrency: 2 },
    }

    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    assert.strictEqual(result.length, 4)
  })

  it('object concurrency: each type has own pool', async () => {
    const { fetchAll } = fetchModule
    registerMockAdapter('_mock_rss')
    registerMockAdapter('_mock_web')

    const sources = [
      { type: '_mock_rss', name: 'rss-1', url: 'https://fixture.test/rss1' },
      { type: '_mock_web', name: 'web-1', url: 'https://fixture.test/web1' },
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
    assert.strictEqual(result.length, 2)
  })

  it('unknown source type is skipped gracefully', async () => {
    const { fetchAll } = fetchModule

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
    const { fetchAll, ADAPTERS } = fetchModule

    ADAPTERS['_slow_test'] = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return [{ title: 'slow', url: 'https://example.com/slow', source: 'test', publishedAt: new Date().toISOString(), summary: '' }]
    }

    const sources = [
      { type: '_slow_test', name: 'slow-source', url: 'https://fixture.test' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
      runtime: { sourceTimeoutMs: 100, retries: 0 },
    }

    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    assert.strictEqual(result.length, 0)
  })

  it('defaults type to rss when not specified', async () => {
    const { fetchAll, ADAPTERS } = fetchModule
    ADAPTERS.rss = async source => [createItem(source.name || 'rss')]

    const sources = [
      { name: 'no-type', url: 'https://fixture.test/no-type' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
    }

    const result = await fetchAll(sources, filterConfig, { noDedup: true })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].source, 'no-type')
  })

  it('prints source URL and completion progress for live tracking', async () => {
    const { fetchAll, ADAPTERS } = fetchModule
    const logs = []
    process.env.LOG_LEVEL = 'info'
    console.log = line => logs.push(String(line))

    ADAPTERS['_progress_test'] = async source => [createItem(source.name || 'progress')]

    const sources = [
      { type: '_progress_test', name: 'progress-source', url: 'https://fixture.test/progress-feed' },
    ]

    const filterConfig = {
      lookbackHours: 48,
      keywords: [],
      maxItems: 100,
    }

    await fetchAll(sources, filterConfig, { noDedup: true })

    const output = logs.join('\n')
    assert.match(output, /url=https:\/\/fixture\.test\/progress-feed/)
    assert.match(output, /completed=1\/1/)
  })
})
