/**
 * ============================================================
 * CLI 入口文件 — 新闻简报工作流的主调度器
 * ============================================================
 */

import 'dotenv/config'
import { loadTopic } from './config.js'
import { fetchAndFilter } from './fetch.js'
import { summarize } from './summarize.js'
import { writeOutput } from './output.js'
import { shutdownPlaywright } from './fetch/playwright.js'
import { createAuditor } from './utils/auditor.js'

async function main() {
  const topicId = process.argv[2]
  const noDedup = process.argv.includes('--no-dedup')

  if (!topicId) {
    console.error('用法: npm run brief <主题ID> [--no-dedup]')
    console.error('示例: npm run brief us-iran')
    process.exit(1)
  }

  // ── 审计日志 ──
  const auditor = createAuditor({ topic: topicId })

  const runStart = Date.now()

  // ── 步骤 1：加载配置 ──
  console.log(`[1/4] 加载配置 "${topicId}"...`)
  const config = await loadTopic(topicId)

  // ── 步骤 2：抓取与过滤 ──
  console.log(`[2/4] 抓取新闻 "${config.title}"...`)
  const items = await fetchAndFilter(config, { noDedup, auditor })
  console.log(`      过滤去重后共 ${items.length} 条`)

  if (items.length === 0) {
    console.error('没有可总结的新闻，中止。')
    auditor.event('run_completed', { totalSources: config.sources.length, succeeded: 0, failed: config.sources.length, durationMs: Date.now() - runStart })
    const { jsonlPath } = auditor.finalize()
    console.log(`审计日志: ${jsonlPath}`)
    process.exit(1)
  }

  // ── 步骤 3：LLM 总结 ──
  console.log('[3/4] LLM 总结中...')
  const report = await summarize(items, config, { auditor })

  // ── 步骤 4：输出文件 ──
  console.log('[4/4] 写入输出文件...')
  const { mdPath, jsonPath } = await writeOutput(report, items, config)
  console.log(`      ✓ ${mdPath}`)
  console.log(`      ✓ ${jsonPath}`)

  auditor.event('run_completed', {
    totalSources: config.sources.length,
    succeeded: config.sources.length,
    failed: 0,
    durationMs: Date.now() - runStart,
  })

  const { jsonlPath } = auditor.finalize()
  console.log(`\n审计日志: ${jsonlPath}`)
  console.log('完成。')
}

main()
  .catch(err => {
    console.error('运行失败:', err.message)
    console.error(err.stack)
    process.exit(1)
  })
  .finally(async () => {
    await shutdownPlaywright()
  })
