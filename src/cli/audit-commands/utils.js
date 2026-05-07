/**
 * 审计 CLI 共享工具
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 获取审计日志根目录 */
export function getAuditDir() {
  return path.join(__dirname, '..', '..', '..', 'logs', 'audit')
}

/** 格式化持续时间 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = Math.round((ms % 60000) / 1000)
  return `${min}m${sec}s`
}

/** 格式化数字 */
export function fmt(n) {
  if (n == null) return '0'
  return Number(n).toLocaleString('en-US')
}

/** 格式化 token 数 */
export function fmtTokens(n) {
  if (n == null) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** 扫描所有运行记录，返回按时间排序的 runId 列表 */
export function scanRuns(auditDir) {
  const runs = []
  if (!fs.existsSync(auditDir)) return runs

  const dateDirs = fs.readdirSync(auditDir, { withFileTypes: true })
  for (const d of dateDirs) {
    if (!d.isDirectory()) continue
    const dirPath = path.join(auditDir, d.name)
    const files = fs.readdirSync(dirPath)
    for (const f of files) {
      if (!f.endsWith('.summary.json')) continue
      const runId = f.replace(/\.summary\.json$/, '').replace(/^[^-]+-/, '') // remove topic prefix
      const topic = f.replace(new RegExp(`-${runId}\\.summary\\.json$`), '')
      const summaryPath = path.join(dirPath, f)
      const jsonlPath = path.join(dirPath, f.replace('.summary.json', '.jsonl'))
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
        runs.push({
          runId: summary.runId || runId,
          topic: summary.topic || topic,
          startedAt: summary.startedAt || '',
          durationMs: summary.durationMs || 0,
          sources: summary.sources || [],
          pipeline: summary.pipeline || {},
          llm: summary.llm || {},
          totals: summary.totals || {},
          summaryPath,
          jsonlPath,
        })
      } catch {
        // 损坏的 summary 跳过
      }
    }
  }

  // 按时间倒序
  runs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
  return runs
}

/** 查找特定的 run */
export function findRun(runId, auditDir) {
  const runs = scanRuns(auditDir)
  return runs.find(r => r.runId === runId)
}

/** 解析 JSONL 文件，返回事件数组 */
export function parseJsonl(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return []
  const content = fs.readFileSync(jsonlPath, 'utf-8')
  const events = []
  for (const line of content.trim().split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // skip bad lines
    }
  }
  return events
}
