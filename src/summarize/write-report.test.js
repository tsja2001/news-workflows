import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  buildWriterPromptInput,
  buildWriterUserPrompt,
} from './write-report.js'

describe('writer editorialPacket mode', () => {
  it('uses only editorialPacket by default and omits raw source items', () => {
    const modelItems = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      source: `Source ${i + 1}`,
      publishedAt: '2026-05-19T00:00:00Z',
      title: `Raw title ${i + 1}`,
      summary: `Raw summary ${i + 1}`,
      url: `https://example.com/${i + 1}`,
    }))
    const editorialPacket = {
      meta: {
        sourceItemCount: 40,
        selectedItemCount: 2,
        droppedItemCount: 38,
        packetCharCount: 1200,
      },
      coreThesis: '压缩后的核心判断',
      recommendedOrder: ['主线一'],
      keyDevelopmentsDraft: [
        {
          title: '主线一',
          importance: 'high',
          whatHappened: '事实草稿',
          whyItMatters: '重要性草稿',
          suggestedEditorTake: '观点建议',
          evidence: [
            { itemId: 1, source: 'Reuters', url: 'https://example.com/1', fact: '事实一' },
            { itemId: 2, source: 'AP', url: 'https://example.com/2', fact: '事实二' },
          ],
        },
      ],
      briefsDraft: [],
      timelineDraft: [],
      signals: [],
      risks: [],
      unknowns: [],
      droppedSummary: [{ reason: '低价值', count: 38 }],
    }
    const config = {
      title: '测试主题',
      llmPipeline: {
        writer: {
          inputMode: 'editorialPacket',
          includeRawSourceItems: false,
          maxInputOutputRatio: 4,
          targetOutputChars: 2000,
        },
      },
      editorial: { persona: '私人内参编辑' },
    }

    const promptInput = buildWriterPromptInput(modelItems, editorialPacket, config)
    const prompt = buildWriterUserPrompt(promptInput, editorialPacket, config)

    assert.strictEqual(promptInput.inputMode, 'editorialPacket')
    assert.strictEqual(promptInput.includeRawSourceItems, false)
    assert.strictEqual(promptInput.sourceItemsCount, 0)
    assert.match(prompt, /editorialPacket/)
    assert.match(prompt, /不新增事实/)
    assert.doesNotMatch(prompt, /原始新闻素材/)
    assert.doesNotMatch(prompt, /Raw title 40/)
  })
})
