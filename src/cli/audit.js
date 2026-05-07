/**
 * ============================================================
 * 审计日志查询 CLI — npm run audit
 * ============================================================
 *
 * 子命令：
 *   list [topic]               列出最近的运行记录
 *   show <runId>               显示单次运行详情
 *   candidates <runId> [source] 显示候选条目
 *   diff <runId1> <runId2>     对比两次运行
 *   query <runId> <jq-filter>  jq 查询
 *   prune [days]               清理旧日志
 */

import { cmdList } from './audit-commands/list.js'
import { cmdShow } from './audit-commands/show.js'
import { cmdCandidates } from './audit-commands/candidates.js'
import { cmdDiff } from './audit-commands/diff.js'
import { cmdQuery } from './audit-commands/query.js'
import { cmdPrune } from './audit-commands/prune.js'

const USAGE = `用法: npm run audit -- <command> [args]

命令:
  list [topic]               列出最近的运行记录
  show <runId>               显示单次运行详情
  candidates <runId> [source] 显示候选条目
  diff <runId1> <runId2>     对比两次运行
  query <runId> <jq-filter>  jq 查询
  prune [days] [--yes]       清理旧日志（默认 30 天）`

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    process.exit(0)
  }

  try {
    switch (cmd) {
      case 'list':
        await cmdList(args[1])
        break
      case 'show':
        if (!args[1]) { console.error('用法: npm run audit -- show <runId>'); process.exit(1) }
        await cmdShow(args[1])
        break
      case 'candidates':
        if (!args[1]) { console.error('用法: npm run audit -- candidates <runId> [source]'); process.exit(1) }
        await cmdCandidates(args[1], args[2])
        break
      case 'diff':
        if (!args[1] || !args[2]) { console.error('用法: npm run audit -- diff <runId1> <runId2>'); process.exit(1) }
        await cmdDiff(args[1], args[2])
        break
      case 'query':
        if (!args[1] || !args[2]) { console.error('用法: npm run audit -- query <runId> <jq-filter>'); process.exit(1) }
        await cmdQuery(args[1], args[2])
        break
      case 'prune': {
        const days = parseInt(args[1]) || 30
        const yes = args.includes('--yes')
        await cmdPrune(days, yes)
        break
      }
      default:
        console.error(`未知命令: ${cmd}`)
        console.log(USAGE)
        process.exit(1)
    }
  } catch (err) {
    console.error('错误:', err.message)
    process.exit(1)
  }
}

main()
