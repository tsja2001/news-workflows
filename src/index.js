/**
 * ============================================================
 * CLI 入口文件 — 新闻简报工作流的主调度器
 * ============================================================
 *
 * 这是整个项目的入口。它按照 4 个步骤依次执行：
 *   1. 加载配置 → 2. 抓取新闻 → 3. LLM 总结 → 4. 输出文件
 *
 * 使用方式：
 *   npm run brief <主题ID>
 *   例如：npm run brief us-iran
 *
 * 设计理念：
 *   - 每个步骤都有进度打印，方便看到跑到哪了
 *   - 如果抓取结果为空，直接退出，不污染昨天的输出
 *   - process.exit(1) 让外部调度系统（如 OpenClaw cron）能感知失败
 */

import 'dotenv/config'  // 加载 .env 文件中的环境变量（LLM_API_KEY 等）
import { loadTopic } from './config.js'      // 步骤1：加载主题配置
import { fetchAndFilter } from './fetch.js'  // 步骤2：抓取RSS + 过滤去重
import { summarize } from './summarize.js'   // 步骤3：调用LLM生成简报
import { writeOutput } from './output.js'    // 步骤4：写入Markdown和JSON文件
import { shutdownPlaywright } from './fetch/playwright.js'

async function main() {
  // 从命令行参数获取主题ID和选项
  // process.argv[0]=node, [1]=脚本路径, [2]=主题ID, 后续是选项
  const topicId = process.argv[2]
  const noDedup = process.argv.includes('--no-dedup')

  if (!topicId) {
    console.error('用法: npm run brief <主题ID> [--no-dedup]')
    console.error('示例: npm run brief us-iran')
    process.exit(1)
  }

  // ── 步骤 1：加载配置 ──────────────────────────────────────
  // 从 config/topics/<topicId>.yaml 读取主题配置
  // 配置里定义了新闻源、过滤关键词、输出目录等
  console.log(`[1/4] 加载配置 "${topicId}"...`)
  const config = await loadTopic(topicId)

  // ── 步骤 2：抓取与过滤 ────────────────────────────────────
  // 并发拉取所有RSS源 → 时间窗口过滤 → 关键词匹配 → URL去重 → 排序截断
  console.log(`[2/4] 抓取新闻 "${config.title}"...`)
  const items = await fetchAndFilter(config, { noDedup })
  console.log(`      过滤去重后共 ${items.length} 条`)

  // 如果没有抓到任何新闻，直接退出
  // 这很重要：不会用空内容覆盖昨天的输出文件
  if (items.length === 0) {
    console.error('没有可总结的新闻，中止。')
    process.exit(1)
  }

  // ── 步骤 3：LLM 总结 ──────────────────────────────────────
  // 把过滤后的新闻条目发给大模型，生成结构化的简报（JSON格式）
  console.log('[3/4] LLM 总结中...')
  const report = await summarize(items, config)

  // ── 步骤 4：输出文件 ──────────────────────────────────────
  // 同时生成 Markdown（人读）和 JSON（程序读）两个文件
  console.log('[4/4] 写入输出文件...')
  const { mdPath, jsonPath } = await writeOutput(report, items, config)
  console.log(`      ✓ ${mdPath}`)
  console.log(`      ✓ ${jsonPath}`)
  console.log('完成。')
}

// 启动主流程，统一捕获错误，确保 Playwright browser 被关闭
main()
  .catch(err => {
    console.error('运行失败:', err.message)
    console.error(err.stack)
    process.exit(1)
  })
  .finally(async () => {
    await shutdownPlaywright()
  })
