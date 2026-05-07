/**
 * ============================================================
 * 配置加载模块 — 读取和校验主题 YAML 配置文件
 * ============================================================
 *
 * 每个新闻主题对应 config/topics/ 下的一个 YAML 文件。
 * 这个模块负责：
 *   1. 根据主题ID找到对应的YAML文件
 *   2. 解析YAML内容为JS对象
 *   3. 校验必填字段（缺少字段时尽早报错，而不是跑到一半才挂）
 *
 * YAML 配置文件的结构示例：
 *   id: us-iran
 *   title: 美国伊朗局势速报
 *   sources:
 *     - name: Al Jazeera
 *       url: "https://..."
 *   filter:
 *     keywords: [Iran, sanctions]
 *     lookbackHours: 36
 *     maxItems: 40
 *   output:
 *     dir: "/path/to/output"
 */

import fs from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 校验单个 source 配置的合法性
 * @param {object} s - source 配置
 * @param {string} topicId - 主题 ID（用于错误信息）
 */
function validateSource(s, topicId) {
  const prefix = `Config ${topicId}/${s.name || 'unnamed'}`

  // type: web 必须有 url 或 urls
  if (s.type === 'web') {
    const hasUrl = typeof s.url === 'string' && s.url.length > 0
    const hasUrls = Array.isArray(s.urls) && s.urls.length > 0

    if (!hasUrl && !hasUrls) {
      throw new Error(`${prefix}: type=web 必须配置 'url' 或 'urls'`)
    }
    if (hasUrl && hasUrls) {
      throw new Error(`${prefix}: 'url' 和 'urls' 互斥，只能有一个`)
    }

    // 检查 {page} 和 pages 配对
    const checkTemplate = (url, pages) => {
      const hasTemplate = url.includes('{page}')
      if (hasTemplate && pages == null) {
        throw new Error(`${prefix}: URL "${url}" 包含 {page} 占位符但未配置 pages`)
      }
      if (!hasTemplate && pages != null) {
        throw new Error(`${prefix}: URL "${url}" 不含 {page} 占位符，不能配置 pages`)
      }
    }

    if (hasUrl) {
      checkTemplate(s.url, s.pages)
    } else {
      for (const entry of s.urls) {
        const u = typeof entry === 'string' ? entry : entry.url
        const p = typeof entry === 'string' ? s.pages : (entry.pages ?? s.pages)
        checkTemplate(u, p)
      }
    }
  }

  // maxArticles 硬上限
  if (s.maxArticles != null) {
    if (typeof s.maxArticles !== 'number' || s.maxArticles < 1 || s.maxArticles > 100) {
      throw new Error(`${prefix}: maxArticles 必须在 1-100 之间，当前为 ${s.maxArticles}`)
    }
  }
}

/**
 * 递归替换字符串中的 ${VAR} 为环境变量值
 * 未定义的变量明确报错，不静默替换为空字符串
 *
 * @param {any} value - 待处理的值（字符串、对象、数组）
 * @returns {any}
 */
export function resolveEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const envVal = process.env[varName]
      if (envVal === undefined) {
        throw new Error(`env 变量 "${varName}" 未定义，请检查 .env 或 yaml 配置`)
      }
      return envVal
    })
  }

  if (Array.isArray(value)) {
    return value.map(resolveEnvVars)
  }

  if (value && typeof value === 'object') {
    const result = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveEnvVars(v)
    }
    return result
  }

  return value
}

/**
 * 加载并校验一个主题配置
 * @param {string} topicId - 主题ID，对应 config/topics/<topicId>.yaml
 * @returns {Promise<object>} 解析并校验后的配置对象
 */
export async function loadTopic(topicId) {
  // 拼接配置文件路径：config/topics/<topicId>.yaml
  const filePath = path.join(__dirname, '..', 'config', 'topics', `${topicId}.yaml`)

  // 读取并解析 YAML
  const content = await fs.readFile(filePath, 'utf-8')
  let config = parse(content)

  // ${VAR} 替换为环境变量
  config = resolveEnvVars(config)

  // 校验必填字段
  if (!config.id) throw new Error(`Config ${topicId}: missing 'id'`)
  if (!config.title) throw new Error(`Config ${topicId}: missing 'title'`)
  if (!config.sources?.length) throw new Error(`Config ${topicId}: no sources`)
  if (!config.output?.dir) throw new Error(`Config ${topicId}: missing 'output.dir'`)

  // 校验每个 source 配置
  for (const s of config.sources) {
    validateSource(s, topicId)
  }

  return config
}
