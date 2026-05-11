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
 *   - keyDevelopments 是对象数组，每条有 title/detail/importance
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

/**
 * 构建 Markdown 内容
 *
 * 结构（主编深加工版）：
 *   YAML frontmatter（Obsidian 属性）
 *   → 标题
 *   → 本期概览
 *   → 关键变化（每条含标题、详细分析、重要度）
 *   → 整体背景
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

  // keyDevelopments 现在是对象数组，每条有 title/detail/importance
  const keyDev = (report.keyDevelopments || []).map((d, i) => {
    const imp = d.importance === 'high' ? '🔴 高关注' : '🟡 中等'
    return `${i + 1}. **${d.title}** _[${imp}]_\n\n   ${d.detail}`
  }).join('\n\n') || '（无）'

  const timeline = (report.timeline || []).map(t => `- ${t.time} ${t.event}`).join('\n') || '（无）'
  const signals = (report.signals || []).map(s => `- ${s}`).join('\n') || '（无）'
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

## 本期概览

${report.overview || '（无）'}

## 关键变化

${keyDev}

## 整体背景

${report.context || '（无）'}

## 时间线

${timeline}

## 值得关注的信号

${signals}

## 风险判断

${risks}

## 信息缺口

${unknowns}

## 主编复盘

${report.editorReview || '（无）'}

## 来源

${sources}
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
