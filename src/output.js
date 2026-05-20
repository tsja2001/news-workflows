/**
 * ============================================================
 * 输出模块 — 将简报写入 Markdown 文件
 * ============================================================
 *
 * 每次运行生成一个 Markdown 文件到配置中指定的目录：
 *   <日期>-<主题标题>.md → 给人看的 Markdown 格式（主编深加工版）
 *
 * 设计要点：
 *   - 文件名精确到秒 → 同一天多次运行不会互相覆盖
 *   - 字段缺失时显示"（无）"而不是报错 → LLM 偶尔会偷懒，要兜底
 *   - Markdown 有 YAML frontmatter → Obsidian 能识别为笔记属性
 *   - keyDevelopments 支持新旧两种格式：新版 what/why/editorTake，旧版 detail
 */

import fs from 'fs/promises'
import path from 'path'

function pad(n) { return String(n).padStart(2, '0') }

/**
 * 获取今天的日期字符串，格式 YYYY-MM-DD
 */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 获取精确到秒的时间戳，格式 YYYY-MM-DD-HHmmss
 * 用于文件名，保证同一天多次运行不覆盖
 */
function datetimeStr() {
  const d = new Date()
  return `${todayStr()}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US')
}

function formatModelUsage(models = []) {
  if (!models.length) return '- 模型用量：未记录'

  return models.map(m => {
    const input = Number(m.tokens?.input || 0)
    const output = Number(m.tokens?.output || 0)
    const total = input + output
    const label = [m.role, m.stage].filter(Boolean).join('/')
    const prefix = label ? `${label} ` : ''
    return `- ${prefix}${m.model || 'unknown'}：input ${formatNumber(input)} / output ${formatNumber(output)} / total ${formatNumber(total)} tokens`
  }).join('\n')
}

function buildRunStatsBlock(report, items) {
  const itemStats = items._runStats || {}
  const reportStats = report._runStats || {}
  const crawledItemCount = itemStats.crawledItemCount ?? items.length
  const adoptedItemCount = itemStats.adoptedItemCount ?? items.length

  return `## 本期数据

- 爬取文章：${formatNumber(crawledItemCount)} 篇
- 采用文章：${formatNumber(adoptedItemCount)} 篇
${formatModelUsage(reportStats.models)}`
}

/**
 * 构建 Markdown 内容
 *
 * 结构（私人内参版）：
 *   YAML frontmatter（含 itemsUsed/itemsDropped）
 *   → 标题
 *   → 30 秒速读（可选，TL;DR bullets）
 *   → 本期概览（合并了旧版整体背景）
 *   → 关键变化（每条三段：发生了什么/为什么重要/编辑怎么看）
 *   → 今日短讯（可选，低关注度合并）
 *   → 整体背景（仅 mergeContextIntoOverview=false 时显示）
 *   → 时间线
 *   → 值得关注的信号
 *   → 风险判断
 *   → 信息缺口
 *   → 主编复盘
 *   → 来源链接
 *
 * @param {object} report - LLM 返回的简报 JSON
 * @param {Array}  items  - 原始新闻条目（用于生成来源链接）
 * @param {object} config - 主题配置
 * @returns {string} 完整的 Markdown 文本
 */
function buildMarkdown(report, items, config) {
  const date = todayStr()
  const generatedAt = new Date().toISOString()
  const editorial = config.editorial || {}
  const mergeContext = editorial.mergeContextIntoOverview !== false

  // TL;DR 速读
  const tldrEnabled = editorial.tldr?.enabled !== false
  const tldr = (report.tldr || []).map(t => `- ${t}`).join('\n') || '（无）'

  // 关键变化：每条三段（兼容旧字段 detail）
  const keyDev = (report.keyDevelopments || []).map((d, i) => {
    const imp = d.importance === 'high' ? '🔴 高关注' : '🟡 中等'
    if (d.what || d.why || d.editorTake) {
      return `### ${i + 1}. ${d.title} ${imp}

**发生了什么**：${d.what || '（无）'}

**为什么重要**：${d.why || '（无）'}

**编辑怎么看**：${d.editorTake || '（无）'}`
    }
    return `### ${i + 1}. ${d.title} ${imp}

${d.detail || '（无）'}`
  }).join('\n\n---\n\n') || '（无）'

  // 短讯
  const briefs = (report.briefs || []).map(b => `- ${b}`).join('\n')

  const timeline = (report.timeline || []).map(t => `- ${t.time} ${t.event}`).join('\n') || '（无）'
  const signals = (report.signals || []).map(s => `- ${s}`).join('\n') || '（无）'
  const risks = (report.risks || []).map(r => `- ${r}`).join('\n') || '（无）'
  const unknowns = (report.unknowns || []).map(u => `- ${u}`).join('\n') || '（无）'

  const sources = items.map(item => `- [${item.source}: ${item.title}](${item.url})`).join('\n')

  // 拼装：可选段落用条件渲染
  const sections = []
  sections.push(`# ${config.title}`)
  sections.push(buildRunStatsBlock(report, items))
  if (tldrEnabled && report.tldr?.length) {
    sections.push(`## 30 秒速读\n\n${tldr}`)
  }
  sections.push(`## 本期概览\n\n${report.overview || '（无）'}`)
  sections.push(`## 关键变化\n\n${keyDev}`)
  if (briefs) {
    sections.push(`## 今日短讯\n\n${briefs}`)
  }
  if (!mergeContext && report.context) {
    sections.push(`## 整体背景\n\n${report.context}`)
  }
  sections.push(`## 时间线\n\n${timeline}`)
  sections.push(`## 值得关注的信号\n\n${signals}`)
  sections.push(`## 风险判断\n\n${risks}`)
  sections.push(`## 信息缺口\n\n${unknowns}`)
  sections.push(`## 主编复盘\n\n${report.editorReview || '（无）'}`)
  sections.push(`## 来源\n\n${sources}`)

  // frontmatter 增加 itemsUsed 字段
  const crawledItemCount = items._runStats?.crawledItemCount ?? items.length
  const itemsUsed = items._runStats?.adoptedItemCount ?? items.length
  const itemsDropped = Math.max(0, crawledItemCount - itemsUsed)

  return `---
topic: ${config.id}
title: ${config.title}
date: ${date}
generatedAt: ${generatedAt}
crawledItemCount: ${crawledItemCount}
adoptedItemCount: ${itemsUsed}
sourceCount: ${items._runStats?.sourceCount ?? config.sources?.length ?? 0}
itemsUsed: ${itemsUsed}
itemsDropped: ${itemsDropped}
---

${sections.join('\n\n')}
`
}

/**
 * 将简报写入 Markdown 文件
 *
 * @param {object} report - LLM 返回的简报 JSON
 * @param {Array}  items  - 原始新闻条目
 * @param {object} config - 主题配置（含 output.dir）
 * @returns {Promise<string>} 输出文件的路径
 */
export async function writeOutput(report, items, config) {
  // 确保输出目录存在（recursive: true → 父目录也会创建）
  await fs.mkdir(config.output.dir, { recursive: true })

  const ts = datetimeStr()

  // 文件名格式：2026-05-05-143052-美国伊朗局势速报
  const baseName = `${ts}-${config.title}`
  const mdPath = path.join(config.output.dir, `${baseName}.md`)

  // 生成并写入 Markdown 文件
  const markdown = buildMarkdown(report, items, config)
  await fs.writeFile(mdPath, markdown, 'utf-8')

  return mdPath
}
