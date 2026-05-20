/**
 * src/output.js 单元测试
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { writeOutput } from './output.js'

describe('output markdown', () => {
  it('writes run statistics at the beginning of the brief', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-output-test-'))
    const items = [
      { source: 'Source A', title: 'A', url: 'https://example.test/a' },
      { source: 'Source B', title: 'B', url: 'https://example.test/b' },
    ]
    Object.defineProperty(items, '_runStats', {
      value: {
        crawledItemCount: 9,
        adoptedItemCount: 2,
      },
    })

    const report = {
      tldr: ['速读'],
      overview: '概览',
      keyDevelopments: [],
      briefs: [],
      timeline: [],
      signals: [],
      risks: [],
      unknowns: [],
      editorReview: '复盘',
    }
    Object.defineProperty(report, '_runStats', {
      value: {
        models: [
          {
            role: 'preprocess',
            stage: 'preprocess',
            model: 'deepseek-chat',
            tokens: { input: 1200, output: 300 },
          },
          {
            role: 'writer',
            stage: 'final_write',
            model: 'claude-opus-4.7',
            tokens: { input: 800, output: 500 },
          },
        ],
      },
    })

    const mdPath = await writeOutput(report, items, {
      id: 'test-topic',
      title: '测试简报',
      output: { dir: tmpDir },
      editorial: {},
    })

    const markdown = await fs.readFile(mdPath, 'utf-8')
    assert.match(markdown, /# 测试简报\n\n## 本期数据/)
    assert.match(markdown, /- 爬取文章：9 篇/)
    assert.match(markdown, /- 采用文章：2 篇/)
    assert.match(markdown, /deepseek-chat.*input 1,200.*output 300.*total 1,500/)
    assert.match(markdown, /claude-opus-4\.7.*input 800.*output 500.*total 1,300/)
  })
})
