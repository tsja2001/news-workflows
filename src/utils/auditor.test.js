/**
 * src/utils/auditor.js 单元测试
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('auditor', () => {
  let tmpDir
  let auditorModule

  before(async () => {
    auditorModule = await import('./auditor.js')
  })

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'))
  })

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates auditor and writes events', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-audit', logDir: tmpDir })

    assert.ok(auditor.runId)
    assert.ok(auditor.runId.length > 10)

    auditor.event('run_started', { topic: 'test-audit', sourcesPlanned: 2 })
    auditor.event('run_completed', { durationMs: 1000 })

    assert.ok(auditor.eventCount >= 2)

    const { jsonlPath } = auditor.finalize()

    // 验证 JSONL 文件存在
    assert.ok(fs.existsSync(jsonlPath))

    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')
    assert.ok(lines.length >= 2)

    // 验证每条都是合法 JSON
    for (const line of lines) {
      const evt = JSON.parse(line)
      assert.ok(evt.ts)
      assert.ok(evt.topic === 'test-audit')
      assert.ok(evt.runId)
      assert.ok(evt.event)
    }
  })

  it('scoped auditor inherits source context', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-scoped', logDir: tmpDir })

    const webAuditor = auditor.scoped('BBC News', 'web')
    webAuditor.event('source_started', { urls: ['https://bbc.com/news'] })
    webAuditor.event('list_extracted', { url: 'https://bbc.com/news', candidates: [{ title: 'Test', url: 'https://bbc.com/1' }], tokens: { input: 100, output: 50 } })

    const { jsonlPath } = auditor.finalize()

    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 2)

    const evt1 = JSON.parse(lines[0])
    assert.equal(evt1.source, 'BBC News')
    assert.equal(evt1.sourceType, 'web')
    assert.equal(evt1.event, 'source_started')
  })

  it('finalize generates summary.json', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-summary', logDir: tmpDir })

    const source = auditor.scoped('TestSource', 'web')
    source.event('source_started', { urls: ['https://a.com/'], maxArticles: 10 })
    source.event('list_extracted', { url: 'https://a.com/', candidates: [{ title: 'A', url: 'https://a.com/1' }], tokens: { input: 500, output: 100 } })
    source.event('detail_extracted', { url: 'https://a.com/1', strategy: 'readability', length: 2000 })
    source.event('source_completed', { totalCandidates: 1, detailsFetched: 1, detailsSucceeded: 1, durationMs: 5000 })

    auditor.event('pipeline_filter', { stage: 'time', before: 1, after: 1 })
    auditor.event('llm_input_prepared', { itemCount: 1 })
    auditor.event('llm_response_received', { tokens: { input: 300, output: 200 }, model: 'deepseek-chat', durationMs: 2000 })

    const { summaryPath } = auditor.finalize()

    assert.ok(fs.existsSync(summaryPath))
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
    assert.equal(summary.topic, 'test-summary')
    assert.ok(summary.sources.length >= 1)
    assert.equal(summary.sources[0].name, 'TestSource')
    assert.ok(summary.totals.tokensUsedAll > 0)
    assert.ok(summary.totals.estimatedCost.includes('¥'))
  })

  it('summary.json contains pipeline data', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-pipeline', logDir: tmpDir })

    auditor.event('pipeline_filter', { stage: 'time', before: 100, after: 80, dropped: [] })
    auditor.event('pipeline_filter', { stage: 'keyword', before: 80, after: 40, dropped: [] })
    auditor.event('pipeline_filter', { stage: 'url_dedup', before: 40, after: 38 })

    const { summaryPath } = auditor.finalize()

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
    assert.equal(summary.pipeline.time?.before, 100)
    assert.equal(summary.pipeline.time?.after, 80)
    assert.equal(summary.pipeline.keyword?.after, 40)
  })

  it('summary.json contains editorialPacket and writer input scale', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-hybrid-summary', logDir: tmpDir })

    auditor.event('preprocess_input_prepared', {
      totalItems: 60,
      modelItemsCount: 60,
      excerptChars: 700,
      outputMode: 'editorialPacket',
    })
    auditor.event('preprocess_completed', {
      model: 'deepseek-chat',
      tokens: { input: 12000, output: 3000 },
      durationMs: 100000,
      outputMode: 'editorialPacket',
      editorialPacket: {
        sourceItemCount: 60,
        selectedItemCount: 18,
        droppedItemCount: 42,
        packetCharCount: 7600,
        keyDevelopmentsDraftCount: 5,
        briefsDraftCount: 6,
      },
    })
    auditor.event('writer_input_prepared', {
      inputMode: 'editorialPacket',
      includeRawSourceItems: false,
      sourceItemsCount: 0,
      inputCharCount: 8200,
      targetOutputChars: 2000,
      maxInputOutputRatio: 4,
    })
    auditor.event('writer_completed', {
      model: 'claude-opus-4.7',
      tokens: { input: 5000, output: 1800 },
      durationMs: 240000,
      inputMode: 'editorialPacket',
      includeRawSourceItems: false,
      inputCharCount: 8200,
      targetOutputChars: 2000,
      maxInputOutputRatio: 4,
    })

    const { summaryPath } = auditor.finalize()
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))

    const preprocess = summary.llm.stages.find(s => s.stage === 'preprocess')
    const writer = summary.llm.stages.find(s => s.stage === 'final_write')

    assert.equal(preprocess.outputMode, 'editorialPacket')
    assert.equal(preprocess.editorialPacket.packetCharCount, 7600)
    assert.equal(preprocess.editorialPacket.selectedItemCount, 18)
    assert.equal(writer.inputMode, 'editorialPacket')
    assert.equal(writer.includeRawSourceItems, false)
    assert.equal(writer.inputCharCount, 8200)
    assert.equal(writer.maxInputOutputRatio, 4)
  })

  it('multiple scoped auditors write concurrently without corruption', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-concurrent', logDir: tmpDir })

    const src1 = auditor.scoped('Source1', 'web')
    const src2 = auditor.scoped('Source2', 'rss')

    // 模拟多源并发写入
    for (let i = 0; i < 20; i++) {
      src1.event('detail_extracted', { url: `https://a.com/${i}`, strategy: 'readability', length: 1000 + i })
      src2.event('detail_extracted', { url: `https://b.com/${i}`, strategy: 'rss', length: 500 + i })
    }

    const { jsonlPath } = auditor.finalize()

    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 40)

    // 每条都是合法 JSON
    for (const line of lines) {
      const evt = JSON.parse(line)
      assert.ok(evt.event === 'detail_extracted')
    }
  })

  it('finalize is idempotent', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-idempotent', logDir: tmpDir })

    auditor.event('run_started', { topic: 'test-idempotent' })
    const r1 = auditor.finalize()
    const r2 = auditor.finalize()
    assert.deepEqual(r1, r2)
  })

  it('handles circular references in data', () => {
    const { createAuditor } = auditorModule
    const auditor = createAuditor({ topic: 'test-circular', logDir: tmpDir })

    const obj = { a: 1 }
    obj.self = obj

    // 不应抛出异常
    auditor.event('test_event', obj)

    const { jsonlPath } = auditor.finalize()
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const evt = JSON.parse(content.trim().split('\n')[0])
    assert.ok(evt.data)
  })
})
