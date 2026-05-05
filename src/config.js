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

// ES Modules 里没有 __dirname，需要自己算出来
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  const config = parse(content)

  // 校验必填字段 —— 配置写错了就在这里直接报错，方便排查
  if (!config.id) throw new Error(`Config ${topicId}: missing 'id'`)
  if (!config.title) throw new Error(`Config ${topicId}: missing 'title'`)
  if (!config.sources?.length) throw new Error(`Config ${topicId}: no sources`)
  if (!config.output?.dir) throw new Error(`Config ${topicId}: missing 'output.dir'`)

  return config
}
