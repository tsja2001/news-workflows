/**
 * ============================================================
 * src/state/seen-store.js 单元测试
 * ============================================================
 * 覆盖：加载空文件、标记后读取、跨 topic 隔离、过期清理、原子写入
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  loadSeen,
  markSeen,
  pruneOldEntries,
} from '../state/seen-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PATH = path.join(__dirname, '..', '..', 'state', '__test-seen-urls.json')

async function cleanup() {
  try { await fs.unlink(TEST_PATH) } catch {}
  try { await fs.unlink(TEST_PATH + '.tmp') } catch {}
}

describe('seen-store', () => {
  beforeEach(cleanup)

  it('loadSeen returns empty map when no file exists', async () => {
    const seen = await loadSeen('test-topic', TEST_PATH)
    assert.ok(seen instanceof Map)
    assert.strictEqual(seen.size, 0)
  })

  it('markSeen and loadSeen round-trip', async () => {
    await markSeen('test-topic', [
      'https://example.com/a',
      'https://example.com/b',
    ], TEST_PATH)

    const seen = await loadSeen('test-topic', TEST_PATH)
    assert.strictEqual(seen.size, 2)
    assert.ok(seen.has('https://example.com/a'))
    assert.ok(seen.has('https://example.com/b'))
  })

  it('markSeen skips empty/falsy URLs', async () => {
    await markSeen('test-topic', [
      'https://example.com/a',
      '',
      null,
      undefined,
    ], TEST_PATH)
    const seen = await loadSeen('test-topic', TEST_PATH)
    assert.strictEqual(seen.size, 1)
  })

  it('topics are isolated in the same store', async () => {
    await markSeen('topic-a', ['https://example.com/1'], TEST_PATH)
    await markSeen('topic-b', ['https://example.com/2'], TEST_PATH)

    const seenA = await loadSeen('topic-a', TEST_PATH)
    const seenB = await loadSeen('topic-b', TEST_PATH)
    assert.strictEqual(seenA.size, 1)
    assert.strictEqual(seenB.size, 1)
    assert.ok(!seenA.has('https://example.com/2'))
  })

  it('pruneOldEntries removes entries older than N days', async () => {
    // 手动写入含过期记录的数据
    const oldData = {
      'test-prune': {
        'https://example.com/old': '2020-01-01T00:00:00Z',
        'https://example.com/new': new Date(Date.now() - 3600 * 1000).toISOString(),
      },
    }
    await fs.mkdir(path.dirname(TEST_PATH), { recursive: true })
    await fs.writeFile(TEST_PATH, JSON.stringify(oldData, null, 2), 'utf-8')

    await pruneOldEntries('test-prune', 7, TEST_PATH)

    const store = JSON.parse(await fs.readFile(TEST_PATH, 'utf-8'))
    const entries = store['test-prune']
    // 旧记录应该被删，新记录保留
    assert.strictEqual(Object.keys(entries).length, 1)
    assert.ok('https://example.com/new' in entries)
    assert.ok(!('https://example.com/old' in entries))
  })

  it('pruneOldEntries is no-op for nonexistent topic', async () => {
    // 不应抛出异常
    await pruneOldEntries('nonexistent-topic', 7, TEST_PATH)
  })

  it('atomic write: no .tmp file remains after successful write', async () => {
    await markSeen('test-atomic', ['https://example.com/x'], TEST_PATH)
    try {
      await fs.access(TEST_PATH + '.tmp')
      assert.fail('.tmp file should not exist after rename')
    } catch (err) {
      if (err.code === 'ENOENT') return // expected
      throw err
    }
  })
})
