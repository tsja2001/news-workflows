/**
 * npm run audit -- show <runId>
 */

import { getAuditDir, findRun, formatDuration, fmtTokens } from './utils.js'

export async function cmdShow(runId) {
  const auditDir = getAuditDir()
  const run = findRun(runId, auditDir)

  if (!run) {
    console.error(`未找到运行记录: ${runId}`)
    console.error('提示: 用 npm run audit -- list 查看所有记录')
    process.exit(1)
  }

  console.log(`主题: ${run.topic}`)
  console.log(`Run ID: ${run.runId}`)
  console.log(`开始时间: ${run.startedAt ? run.startedAt.replace('T', ' ').slice(0, 19) : '?'}`)
  console.log(`耗时: ${formatDuration(run.durationMs)}`)
  console.log()

  // 源处理详情
  console.log('源处理详情:')
  for (const s of run.sources) {
    const statusIcon = s.status === 'failed' ? '✗' : '✓'
    const detailInfo = s.detailsFetched > 0 ? `详情 ${s.detailsSucceeded}/${s.detailsFetched}` : '无需详情'
    const tokenStr = s.tokens?.input ? `tokens ${fmtTokens(s.tokens.input + (s.tokens.output || 0))}` : ''
    console.log(`  ${statusIcon} ${s.name} (${s.type}): 候选 ${s.candidatesTotal || '?'} → ${detailInfo} ${tokenStr}`)
  }
  console.log()

  // 过滤管线
  if (Object.keys(run.pipeline).length > 0) {
    const stages = ['time', 'keyword', 'url_dedup', 'truncate']
    const parts = []
    for (const stage of stages) {
      const p = run.pipeline[stage]
      if (p) {
        parts.push(`${stage} ${p.before}→${p.after}`)
      }
    }
    if (parts.length > 0) {
      console.log(`过滤管线: ${parts.join(' → ')}`)
      console.log()
    }
  }

  // LLM
  if (run.llm) {
    const tokens = (run.llm.inputTokens || 0) + (run.llm.outputTokens || 0)
    console.log('LLM:')
    console.log(`  模型: ${run.llm.model || '?'}`)
    console.log(`  Tokens: ${fmtTokens(run.llm.inputTokens || 0)} / ${fmtTokens(run.llm.outputTokens || 0)} (${run.totals.estimatedCost || '约 ¥0.00'})`)
    console.log()
  }

  // 文件路径
  console.log(`完整日志: ${run.jsonlPath || '?'}`)
}
