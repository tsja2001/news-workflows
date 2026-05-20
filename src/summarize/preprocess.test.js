import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  validateEditorialPacketResult,
  getEditorialPacketStats,
} from './preprocess.js'

describe('editorialPacket preprocess mode', () => {
  it('normalizes packet fields and records packet stats', () => {
    const packet = validateEditorialPacketResult({
      meta: { sourceItemCount: 3 },
      coreThesis: '主线判断',
      keyDevelopmentsDraft: [
        {
          title: '主线一',
          importance: 'high',
          evidence: [
            { itemId: 1, source: 'Reuters', url: 'https://example.com/1', fact: '事实一' },
            { itemId: 2, source: 'AP', url: 'https://example.com/2', fact: '事实二' },
          ],
        },
      ],
      briefsDraft: [{ region: '中东', summary: '短讯', evidenceItemIds: [3] }],
      droppedSummary: [{ reason: '重复', count: 1 }],
    }, 8000)

    assert.strictEqual(packet.meta.sourceItemCount, 3)
    assert.strictEqual(packet.meta.selectedItemCount, 3)
    assert.strictEqual(packet.meta.droppedItemCount, 1)
    assert.strictEqual(typeof packet.meta.packetCharCount, 'number')
    assert.deepStrictEqual(packet.recommendedOrder, [])
    assert.deepStrictEqual(packet.timelineDraft, [])
    assert.deepStrictEqual(packet.signals, [])
    assert.deepStrictEqual(packet.risks, [])
    assert.deepStrictEqual(packet.unknowns, [])

    const stats = getEditorialPacketStats(packet)
    assert.strictEqual(stats.selectedItemCount, 3)
    assert.strictEqual(stats.droppedItemCount, 1)
    assert.strictEqual(stats.keyDevelopmentsDraftCount, 1)
    assert.strictEqual(stats.briefsDraftCount, 1)
  })

  it('compacts oversized editorialPacket before writer receives it', () => {
    const longText = '这是一段需要压缩的重复内容'.repeat(80)
    const packet = validateEditorialPacketResult({
      meta: { sourceItemCount: 8 },
      coreThesis: longText,
      recommendedOrder: ['主线一', '主线二'],
      keyDevelopmentsDraft: [
        {
          title: '主线一',
          importance: 'high',
          whatHappened: longText,
          whyItMatters: longText,
          suggestedEditorTake: longText,
          evidence: [
            { itemId: 1, source: 'Reuters', url: 'https://example.com/1', fact: longText },
            { itemId: 2, source: 'AP', url: 'https://example.com/2', fact: longText },
          ],
        },
        {
          title: '主线二',
          importance: 'medium',
          whatHappened: longText,
          whyItMatters: longText,
          suggestedEditorTake: longText,
          evidence: [
            { itemId: 3, source: 'BBC', url: 'https://example.com/3', fact: longText },
          ],
        },
      ],
      briefsDraft: Array.from({ length: 6 }, (_, i) => ({
        region: `地区${i}`,
        summary: longText,
        evidenceItemIds: [i + 1],
      })),
      timelineDraft: Array.from({ length: 8 }, (_, i) => ({
        time: '05-19 12:00',
        event: longText,
        itemId: i + 1,
      })),
      signals: [longText, longText],
      risks: [longText, longText],
      unknowns: [longText, longText],
      droppedSummary: [{ reason: '低价值', count: 4 }],
    }, 1800)

    assert.ok(packet.meta.packetCharCount <= 1800)
    assert.strictEqual(packet.meta.packetOverLimit, false)
    assert.ok(packet.keyDevelopmentsDraft.length >= 1)
    assert.ok(packet.keyDevelopmentsDraft[0].evidence.length >= 1)
  })
})
