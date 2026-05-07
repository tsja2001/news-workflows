/**
 * npm run audit -- candidates <runId> [source]
 */

import { getAuditDir, findRun, parseJsonl } from './utils.js'

export async function cmdCandidates(runId, sourceFilter) {
  const auditDir = getAuditDir()
  const run = findRun(runId, auditDir)

  if (!run) {
    console.error(`未找到运行记录: ${runId}`)
    process.exit(1)
  }

  const events = parseJsonl(run.jsonlPath)
  const candidateEvents = events.filter(e => e.event === 'list_extracted'
    && (!sourceFilter || e.source === sourceFilter))

  if (candidateEvents.length === 0) {
    console.log(sourceFilter
      ? `没有找到源 "${sourceFilter}" 的候选条目`
      : '没有找到候选条目')
    return
  }

  let totalCandidates = 0
  let dist = { high: 0, medium: 0, low: 0 }

  for (const evt of candidateEvents) {
    const candidates = evt.data?.candidates || []
    totalCandidates += candidates.length

    const sourceLabel = evt.source
    console.log(`\n${sourceLabel} - 共 ${candidates.length} 条候选:`)
    console.log()

    for (const c of candidates) {
      const conf = `[${c.confidence || '?'}]`.padEnd(10)
      const section = c.section ? `[${c.section}] ` : ''
      console.log(`${conf} ${section}${c.title || '(无标题)'}`)
      console.log(`         ${c.url || '(无URL)'}`)
      if (c.publishedAt) console.log(`         ${c.publishedAt}`)
      console.log()

      if (dist[c.confidence] !== undefined) dist[c.confidence]++
    }
  }

  console.log(`汇总: high=${dist.high}, medium=${dist.medium}, low=${dist.low}`)
}
