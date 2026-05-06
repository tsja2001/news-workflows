/**
 * ============================================================
 * 历史去重存储模块 — 持久化已见过的 URL，避免重复处理
 * ============================================================
 *
 * 数据文件：state/seen-urls.json（gitignore 掉）
 *
 * 文件结构：
 *   {
 *     "topic-id": {
 *       "url": "2026-05-04T10:23:00Z",
 *       ...
 *     }
 *   }
 *
 * 关键设计：
 *   - 原子写入（.tmp → rename），防止并发或崩溃损坏文件
 *   - 文件不存在时自动创建空结构
 *   - 所有导出函数的 storePath 参数有默认值，测试可传自定义路径
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_STORE_PATH = path.join(__dirname, '..', '..', 'state', 'seen-urls.json')

async function readStore(storePath) {
  try {
    const raw = await fs.readFile(storePath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

async function writeStore(data, storePath) {
  await fs.mkdir(path.dirname(storePath), { recursive: true })
  const tmpPath = storePath + '.tmp'
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, storePath)
}

/**
 * 加载指定 topic 的已见 URL 集合
 * @param {string} topicId
 * @param {string} [storePath] - 自定义存储路径（测试用）
 * @returns {Promise<Map<string, string>>} Map<url, isoTimestamp>
 */
export async function loadSeen(topicId, storePath = DEFAULT_STORE_PATH) {
  const store = await readStore(storePath)
  const entries = store[topicId] || {}
  const map = new Map()
  for (const [url, ts] of Object.entries(entries)) {
    map.set(url, ts)
  }
  return map
}

/**
 * 批量标记 URL 为已见
 * @param {string} topicId
 * @param {string[]} urls
 * @param {string} [storePath] - 自定义存储路径（测试用）
 */
export async function markSeen(topicId, urls, storePath = DEFAULT_STORE_PATH) {
  if (!urls || urls.length === 0) return

  const store = await readStore(storePath)
  if (!store[topicId]) store[topicId] = {}

  const now = new Date().toISOString()
  for (const url of urls) {
    if (url) store[topicId][url] = now
  }

  await writeStore(store, storePath)
}

/**
 * 清理超过 retentionDays 天的旧记录
 * @param {string} topicId
 * @param {number} retentionDays - 保留天数，默认 7
 * @param {string} [storePath] - 自定义存储路径（测试用）
 */
export async function pruneOldEntries(topicId, retentionDays = 7, storePath = DEFAULT_STORE_PATH) {
  const store = await readStore(storePath)
  if (!store[topicId]) return

  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000
  const entries = store[topicId]
  let pruned = 0

  for (const [url, ts] of Object.entries(entries)) {
    if (new Date(ts).getTime() < cutoff) {
      delete entries[url]
      pruned++
    }
  }

  if (pruned > 0) {
    await writeStore(store, storePath)
    console.log(`  清理 ${topicId} 过期去重记录 ${pruned} 条`)
  }
}
