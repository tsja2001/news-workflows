/**
 * npm run audit -- list [topic]
 */

import { getAuditDir, scanRuns, formatDuration, fmtTokens } from './utils.js'

export async function cmdList(topicFilter) {
  const auditDir = getAuditDir()
  const runs = scanRuns(auditDir)

  const filtered = topicFilter
    ? runs.filter(r => r.topic === topicFilter)
    : runs.slice(0, 20)

  if (filtered.length === 0) {
    console.log(topicFilter
      ? `没有找到主题 "${topicFilter}" 的运行记录`
      : '没有找到任何运行记录')
    return
  }

  console.log(`${topicFilter ? `主题 "${topicFilter}" 的` : '最近'}运行记录（${filtered.length} 条）:\n`)

  // 表头
  console.log('时间                | 主题        | 源数 | 详情      | LLM tokens | 耗时    | 状态')
  console.log('--------------------|-------------|------|-----------|------------|---------|-----')

  for (const r of filtered) {
    const ts = r.startedAt ? r.startedAt.replace('T', ' ').slice(0, 19) : '?'
    const topic = (r.topic || '?').padEnd(11).slice(0, 11)
    const srcCount = String(r.sources.length).padEnd(4)
    const succeeded = r.sources.filter(s => s.status !== 'failed').length
    const failed = r.sources.length - succeeded
    const totalDetails = r.sources.reduce((sum, s) => sum + (s.detailsSucceeded || 0), 0)
    const totalFetch = r.sources.reduce((sum, s) => sum + (s.detailsFetched || 0), 0)
    const detailStr = `${totalDetails}/${totalFetch}`.padEnd(9)
    const tokens = fmtTokens(r.totals.tokensUsedAll || 0).padEnd(10)
    const dur = formatDuration(r.durationMs).padEnd(7)
    const status = failed > 0 ? `⚠ ${failed} 源失败` : '✓'

    console.log(`${ts} | ${topic} | ${srcCount} | ${detailStr} | ${tokens} | ${dur} | ${status}`)
  }
}
