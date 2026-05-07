/**
 * npm run audit -- prune [days] [--yes]
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { getAuditDir, scanRuns } from './utils.js'

export async function cmdPrune(days = 30, skipConfirm = false) {
  const auditDir = getAuditDir()

  if (!fs.existsSync(auditDir)) {
    console.log('没有审计日志目录，无需清理。')
    return
  }

  const cutoff = Date.now() - days * 86400 * 1000
  const toDelete = []
  let totalFiles = 0
  let totalSize = 0

  const dateDirs = fs.readdirSync(auditDir, { withFileTypes: true })
  for (const d of dateDirs) {
    if (!d.isDirectory()) continue
    const dirPath = path.join(auditDir, d.name)
    const stat = fs.statSync(dirPath)
    if (stat.mtimeMs < cutoff) {
      const files = fs.readdirSync(dirPath)
      let dirSize = 0
      for (const f of files) {
        try {
          dirSize += fs.statSync(path.join(dirPath, f)).size
        } catch { /* ignore */ }
      }
      toDelete.push({ dir: dirPath, label: d.name, files: files.length, size: dirSize })
      totalFiles += files.length
      totalSize += dirSize
    }
  }

  if (toDelete.length === 0) {
    console.log(`没有 ${days} 天前的审计日志需要清理。`)
    return
  }

  console.log(`将删除 ${days} 天前的审计日志:\n`)
  for (const item of toDelete) {
    const sizeMB = (item.size / 1024 / 1024).toFixed(1)
    console.log(`  logs/audit/${item.label}/  (${item.files} 个文件, ${sizeMB}MB)`)
  }
  console.log(`\n共 ${totalFiles} 个文件, 总 ${(totalSize / 1024 / 1024).toFixed(1)}MB`)

  if (!skipConfirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise(resolve => {
      rl.question('\n确认删除? [y/N] ', ans => { rl.close(); resolve(ans.trim().toLowerCase()) })
    })
    if (answer !== 'y' && answer !== 'yes') {
      console.log('已取消。')
      return
    }
  }

  for (const item of toDelete) {
    fs.rmSync(item.dir, { recursive: true, force: true })
    console.log(`  已删除: ${item.label}`)
  }

  console.log(`\n清理完成，删除了 ${totalFiles} 个文件。`)
}
