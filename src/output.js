/**
 * ============================================================
 * 输出模块 — 将简报写入 Markdown 和 JSON 文件
 * ============================================================
 *
 * 每次运行生成两个文件到配置中指定的目录：
 *   1. <日期>-<主题标题>.md   → 给人看的 Markdown 格式
 *   2. <日期>-<主题标题>.json → 给程序读的 JSON 格式
 *
 * 设计要点：
 *   - 用日期作文件名 → 同一天跑多次会覆盖，天然幂等（结果一致）
 *   - 字段缺失时显示"（无）"而不是报错 → LLM 偶尔会偷懒，要兜底
 *   - Markdown 有 YAML frontmatter → Obsidian 能识别为笔记属性
 */

import fs from 'fs/promises'
import path from 'path'

/**
 * 获取今天的日期字符串，格式 YYYY-MM-DD
 * 用于文件名和 frontmatter
 */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 构建 Markdown 内容
 *
 * 结构：
 *   YAML frontmatter（Obsidian 属性）
 *   → 标题
 *   → 一句话概览
 *   → 关键变化
 *   → 时间线
 *   → 风险与观察
 *   → 信息缺口
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

  // 将报告各字段转为 Markdown 列表格式
  // 每个字段都做了兜底：没内容就显示"（无）"
  const keyDev = (report.keyDevelopments || []).map((d, i) => `${i + 1}. ${d}`).join('\n') || '（无）'
  const timeline = (report.timeline || []).map(t => `- ${t.time} ${t.event}`).join('\n') || '（无）'
  const risks = (report.risks || []).map(r => `- ${r}`).join('\n') || '（无）'
  const unknowns = (report.unknowns || []).map(u => `- ${u}`).join('\n') || '（无）'

  // 生成来源列表，用 Markdown 链接格式 [源名称: 标题](URL)
  const sources = items.map(item => `- [${item.source}: ${item.title}](${item.url})`).join('\n')

  return `---
topic: ${config.id}
title: ${config.title}
date: ${date}
generatedAt: ${generatedAt}
sourceCount: ${items.length}
---

# ${config.title}

## 一句话概览

${report.summary || '（无）'}

## 关键变化

${keyDev}

## 时间线

${timeline}

## 风险与观察

${risks}

## 信息缺口

${unknowns}

## 来源

${sources}
`
}

/**
 * 将简报写入文件（Markdown + JSON）
 *
 * @param {object} report - LLM 返回的简报 JSON
 * @param {Array}  items  - 原始新闻条目
 * @param {object} config - 主题配置（含 output.dir）
 * @returns {Promise<{mdPath: string, jsonPath: string}>} 输出文件的路径
 */
export async function writeOutput(report, items, config) {
  // 确保输出目录存在（recursive: true → 父目录也会创建）
  await fs.mkdir(config.output.dir, { recursive: true })

  const date = todayStr()

  // 文件名格式：2026-05-05-美国伊朗局势速报
  const baseName = `${date}-${config.title}`
  const mdPath = path.join(config.output.dir, `${baseName}.md`)
  const jsonPath = path.join(config.output.dir, `${baseName}.json`)

  // 生成 Markdown 内容
  const markdown = buildMarkdown(report, items, config)

  // 构建 JSON 数据：元信息 + LLM 报告 + 原始来源
  const jsonData = {
    topic: config.id,
    title: config.title,
    date,
    generatedAt: new Date().toISOString(),
    ...report,        // 展开 LLM 返回的所有字段
    sources: items,   // 附上原始新闻条目供后续追问
  }

  // 同时写入两个文件
  await fs.writeFile(mdPath, markdown, 'utf-8')
  await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8')

  return { mdPath, jsonPath }
}
