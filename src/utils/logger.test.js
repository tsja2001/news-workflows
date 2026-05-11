/**
 * src/utils/logger.js 单元测试
 * 覆盖：truncate / formatUrl / formatBytes / formatNumber / 长度限制 / LOG_LEVEL 过滤
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  truncate,
  formatUrl,
  formatBytes,
  formatNumber,
  createLogger,
} from './logger.js'

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    assert.strictEqual(truncate('hello', 10), 'hello')
  })

  it('truncates long strings with suffix', () => {
    const result = truncate('12345678901234567890', 10)
    assert.ok(result.length <= 10)
    assert.ok(result.endsWith('...'))
  })

  it('returns empty string for falsy input', () => {
    assert.strictEqual(truncate('', 10), '')
    assert.strictEqual(truncate(null, 10), null)
  })
})

describe('formatUrl', () => {
  it('keeps short URLs intact', () => {
    assert.strictEqual(formatUrl('https://example.com', 80), 'https://example.com')
  })

  it('truncates long URLs preserving protocol+host+tail', () => {
    const long = 'https://www.bbc.com/news/world/middle_east/very/long/path/that/goes/on/forever/article-123456789'
    const result = formatUrl(long, 60)
    assert.ok(result.length <= 60)
    assert.ok(result.startsWith('https://'))
    assert.ok(result.includes('bbc.com'))
  })

  it('falls back to generic truncate for invalid URLs', () => {
    const result = formatUrl('not-a-url-'.repeat(20), 80)
    assert.ok(result.length <= 80)
  })

  it('handles empty input', () => {
    assert.strictEqual(formatUrl('', 80), '')
    assert.strictEqual(formatUrl(null, 80), null)
  })
})

describe('formatBytes', () => {
  it('shows B for small values', () => {
    assert.strictEqual(formatBytes(500), '500B')
  })

  it('shows KB for medium values', () => {
    assert.ok(formatBytes(187234).includes('KB'))
  })

  it('shows MB for large values', () => {
    assert.ok(formatBytes(5 * 1024 * 1024).includes('MB'))
  })

  it('handles null', () => {
    assert.strictEqual(formatBytes(null), '0B')
  })
})

describe('formatNumber', () => {
  it('formats with commas', () => {
    assert.strictEqual(formatNumber(1842), '1,842')
    assert.strictEqual(formatNumber(1000000), '1,000,000')
  })

  it('handles zero', () => {
    assert.strictEqual(formatNumber(0), '0')
  })

  it('handles null', () => {
    assert.strictEqual(formatNumber(null), '0')
  })
})

describe('createLogger', () => {
  let origLogLevel
  let output = ''

  beforeEach(() => {
    origLogLevel = process.env.LOG_LEVEL
    // Capture console.log
    output = ''
    const origLog = console.log
    console.log = (...args) => { output += args.join(' ') + '\n' }
  })

  afterEach(() => {
    process.env.LOG_LEVEL = origLogLevel
    console.log = console._origLog || console.log
  })

  it('prints step with context and timestamp', () => {
    process.env.LOG_LEVEL = 'verbose'
    const log = createLogger('test/unit')
    log.step('打开页面', { url: 'https://example.com/page' })
    assert.ok(output.includes('[test/unit]'))
    assert.ok(output.includes('▶'))
    assert.ok(output.includes('打开页面'))
    assert.ok(output.includes('url='))
  })

  it('prints success with detail', () => {
    process.env.LOG_LEVEL = 'verbose'
    const log = createLogger('test/unit')
    log.success('完成', { ms: 2843, bytes: 187234 })
    assert.ok(output.includes('✓'))
    assert.ok(output.includes('完成'))
    assert.ok(output.includes('2843ms'))
    assert.ok(output.includes('KB'))
  })

  it('prints warn and error at default level', () => {
    process.env.LOG_LEVEL = 'info'
    const log = createLogger('test/unit')
    log.warn('warning message')
    log.error('error message')
    assert.ok(output.includes('⚠'))
    assert.ok(output.includes('✗'))
  })

  it('suppresses verbose at info level', () => {
    process.env.LOG_LEVEL = 'info'
    const log = createLogger('test/unit')
    log.step('should not appear')
    log.success('should not appear')
    assert.strictEqual(output, '')
  })

  it('suppresses all but errors at quiet level', () => {
    process.env.LOG_LEVEL = 'quiet'
    const log = createLogger('test/unit')
    log.step('step')
    log.info('info')
    log.warn('warn')
    log.error('error')
    assert.ok(output.includes('✗'))
    assert.ok(!output.includes('▶'))
    assert.ok(!output.includes('⚠'))
  })

  it('enforces 250 char max line length', () => {
    process.env.LOG_LEVEL = 'verbose'
    const log = createLogger('test/unit')
    log.step('title ' + 'x'.repeat(300))
    // The line should be truncated to ≤ 250 chars
    const lines = output.trim().split('\n')
    for (const line of lines) {
      // Strip ANSI codes for length check
      const stripped = line.replace(/\x1b\[\d+m/g, '')
      assert.ok(stripped.length <= 250, `line too long: ${stripped.length} chars`)
    }
  })

  it('renders detail string differently from object', () => {
    process.env.LOG_LEVEL = 'verbose'
    const log = createLogger('test/unit')
    log.step('message', 'some detail string')
    assert.ok(output.includes('some detail string'))
  })

  it('handles undefined detail', () => {
    process.env.LOG_LEVEL = 'verbose'
    const log = createLogger('test/unit')
    log.step('message only')
    // Should not throw
    assert.ok(output.includes('message only'))
  })

  it('timing helper works', () => {
    process.env.LOG_LEVEL = 'verbose'
    const log = createLogger('test/unit')
    log.timing('AI 调用', 5234)
    assert.ok(output.includes('AI 调用'))
    assert.ok(output.includes('5234ms'))
  })
})
