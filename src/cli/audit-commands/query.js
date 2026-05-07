/**
 * npm run audit -- query <runId> <jq-filter>
 */

import { spawn } from 'child_process'
import { getAuditDir, findRun } from './utils.js'

export async function cmdQuery(runId, jqFilter) {
  const auditDir = getAuditDir()
  const run = findRun(runId, auditDir)

  if (!run) {
    console.error(`未找到运行记录: ${runId}`)
    process.exit(1)
  }

  // 检查 jq 是否可用
  const check = spawn('which', ['jq'], { stdio: 'pipe' })
  const jqAvailable = await new Promise(resolve => {
    check.on('close', code => resolve(code === 0))
  })

  if (!jqAvailable) {
    console.error('未找到 jq 命令，请先安装: brew install jq')
    process.exit(1)
  }

  // 流式传给 jq
  const child = spawn('jq', ['-c', jqFilter, run.jsonlPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { process.stderr.write(chunk) })

  await new Promise(resolve => child.on('close', resolve))

  if (output.trim()) {
    console.log(output.trim())
  }
}
