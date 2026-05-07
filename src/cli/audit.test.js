/**
 * src/cli/audit.js 单元测试
 *
 * 用临时文件创建 fixture 数据，测试各子命令不会崩溃。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

// 设置环境，让 utils 用临时目录
let origDir
let tmpDir

describe('audit CLI commands', () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-cli-test-'))
    // 创建 fixture: logs/audit/2026-05-05/
    const dateDir = path.join(tmpDir, '2026-05-05')
    fs.mkdirSync(dateDir, { recursive: true })

    const runId = '20260505-143052-abc12'
    const topic = 'test-topic'

    // 写 JSONL
    const jsonl = [
      { ts: '2026-05-05T14:30:52.123Z', topic, runId, source: 'BBC News', sourceType: 'web', event: 'source_started', data: { urls: ['https://bbc.com/news'], maxArticles: 10 } },
      { ts: '2026-05-05T14:30:54.123Z', topic, runId, source: 'BBC News', sourceType: 'web', event: 'list_extracted', data: { url: 'https://bbc.com/news', count: 3, candidates: [{ title: 'News 1', url: 'https://bbc.com/1', confidence: 'high', section: '头条' }, { title: 'News 2', url: 'https://bbc.com/2', confidence: 'medium', section: '侧栏' }, { title: 'News 3', url: 'https://bbc.com/3', confidence: 'low' }], tokens: { input: 500, output: 200 }, durationMs: 2000 } },
      { ts: '2026-05-05T14:30:55.123Z', topic, runId, source: '', sourceType: '', event: 'pipeline_filter', data: { stage: 'time', before: 3, after: 2, dropped: 1 } },
      { ts: '2026-05-05T14:30:56.123Z', topic, runId, source: '', sourceType: '', event: 'pipeline_filter', data: { stage: 'keyword', before: 2, after: 2, dropped: 0 } },
      { ts: '2026-05-05T14:30:57.123Z', topic, runId, source: 'BBC News', sourceType: 'web', event: 'detail_extracted', data: { url: 'https://bbc.com/1', title: 'News 1', strategy: 'readability', length: 2000 } },
      { ts: '2026-05-05T14:30:58.123Z', topic, runId, source: 'BBC News', sourceType: 'web', event: 'detail_extracted', data: { url: 'https://bbc.com/2', title: 'News 2', strategy: 'ai', length: 1500, tokens: { input: 300, output: 150 } } },
      { ts: '2026-05-05T14:30:59.123Z', topic, runId, source: 'BBC News', sourceType: 'web', event: 'detail_failed', data: { url: 'https://bbc.com/3', reason: 'timeout' } },
      { ts: '2026-05-05T14:31:00.123Z', topic, runId, source: 'BBC News', sourceType: 'web', event: 'source_completed', data: { totalCandidates: 3, detailsFetched: 3, detailsSucceeded: 2, detailsFailed: 1, durationMs: 8000 } },
      { ts: '2026-05-05T14:31:05.123Z', topic, runId, source: '', sourceType: '', event: 'llm_input_prepared', data: { itemCount: 2, items: [{ title: 'News 1', url: 'https://bbc.com/1', source: 'BBC News', contentLength: 2000 }, { title: 'News 2', url: 'https://bbc.com/2', source: 'BBC News', contentLength: 1500 }] } },
      { ts: '2026-05-05T14:31:10.123Z', topic, runId, source: '', sourceType: '', event: 'llm_response_received', data: { tokens: { input: 1000, output: 500 }, model: 'deepseek-chat', durationMs: 5000 } },
      { ts: '2026-05-05T14:31:10.456Z', topic, runId, source: '', sourceType: '', event: 'run_completed', data: { totalSources: 1, succeeded: 1, failed: 0, durationMs: 18333 } },
    ]
    fs.writeFileSync(path.join(dateDir, `${topic}-${runId}.jsonl`), jsonl.map(JSON.stringify).join('\n') + '\n')

    // 写 summary
    const summary = {
      topic,
      runId,
      startedAt: '2026-05-05T14:30:52.123Z',
      completedAt: '2026-05-05T14:31:10.456Z',
      durationMs: 18333,
      sources: [
        { name: 'BBC News', type: 'web', urls: ['https://bbc.com/news'], candidatesTotal: 3, detailsFetched: 3, detailsSucceeded: 2, detailsFailed: 1, tokens: { input: 800, output: 350 }, durationMs: 8000, status: 'ok' },
      ],
      pipeline: { time: { before: 3, after: 2 }, keyword: { before: 2, after: 2 } },
      llm: { model: 'deepseek-chat', inputTokens: 1000, outputTokens: 500, itemCount: 2, durationMs: 5000 },
      totals: { tokensUsedAll: 2650, estimatedCost: '约 ¥0.00' },
    }
    fs.writeFileSync(path.join(dateDir, `${topic}-${runId}.summary.json`), JSON.stringify(summary, null, 2))
  })

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('scanRuns finds fixture run', async () => {
    const { scanRuns } = await import('./audit-commands/utils.js')
    const runs = scanRuns(tmpDir)
    assert.ok(runs.length >= 1)
    assert.equal(runs[0].topic, 'test-topic')
    assert.equal(runs[0].runId, '20260505-143052-abc12')
    assert.equal(runs[0].sources.length, 1)
  })

  it('findRun locates specific run', async () => {
    const { findRun } = await import('./audit-commands/utils.js')
    const run = findRun('20260505-143052-abc12', tmpDir)
    assert.ok(run)
    assert.equal(run.topic, 'test-topic')
    assert.equal(run.sources[0].name, 'BBC News')
  })

  it('findRun returns undefined for missing runId', async () => {
    const { findRun } = await import('./audit-commands/utils.js')
    const run = findRun('nonexistent', tmpDir)
    assert.equal(run, undefined)
  })

  it('parseJsonl parses all events', async () => {
    const { scanRuns, parseJsonl } = await import('./audit-commands/utils.js')
    const runs = scanRuns(tmpDir)
    const events = parseJsonl(runs[0].jsonlPath)
    assert.ok(events.length >= 8)

    // 验证关键事件类型
    const eventTypes = events.map(e => e.event)
    assert.ok(eventTypes.includes('list_extracted'))
    assert.ok(eventTypes.includes('pipeline_filter'))
    assert.ok(eventTypes.includes('detail_extracted'))
    assert.ok(eventTypes.includes('detail_failed'))
    assert.ok(eventTypes.includes('llm_input_prepared'))
    assert.ok(eventTypes.includes('llm_response_received'))
  })

  it('formatDuration formats correctly', async () => {
    const { formatDuration } = await import('./audit-commands/utils.js')
    assert.equal(formatDuration(500), '500ms')
    assert.ok(formatDuration(5000).includes('5'))
    assert.ok(formatDuration(65000).includes('m'))
  })
})
