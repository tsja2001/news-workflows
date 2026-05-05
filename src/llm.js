/**
 * ============================================================
 * LLM 调用封装模块 — 统一的大模型交互层
 * ============================================================
 *
 * 这是整个项目最重要的扩展点。设计原则：
 *   1. 这里是唯一一处接触 LangChain / OpenAI SDK 的地方
 *   2. 所有 LLM 配置走环境变量，换模型/provider 只改 .env 不改代码
 *   3. 对外暴露统一的 callLLMForJson() 接口
 *
 * 未来如果要：
 *   - 换模型 → 改 .env 里的 LLM_MODEL
 *   - 换服务商 → 改 .env 里的 LLM_BASE_URL
 *   - 加重试机制 → 在这个文件里加
 *   - 加 token 统计 → 在这个文件里加
 *   - 多模型 fallback → 在这个文件里加
 *
 * 环境变量说明：
 *   LLM_API_KEY  - API 密钥（必填）
 *   LLM_BASE_URL - API 地址（如 https://api.deepseek.com/v1）
 *   LLM_MODEL    - 模型名称（如 deepseek-chat、gpt-4o-mini）
 */

import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { JsonOutputParser } from '@langchain/core/output_parsers'

/**
 * 创建 LLM 客户端实例
 *
 * 使用 ChatOpenAI 类但可以连接任何 OpenAI 兼容的服务
 * （DeepSeek、通义千问、Moonshot、智谱GLM等都兼容OpenAI接口格式）
 *
 * temperature=0.3 表示较低的随机性，保证新闻摘要相对稳定一致
 */
function createModel() {
  return new ChatOpenAI({
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',  // 默认用 gpt-4o-mini
    temperature: 0.3,
    configuration: {
      // 自定义 API 地址，这是能接各种国产模型的关键
      // 例如 DeepSeek: https://api.deepseek.com/v1
      baseURL: process.env.LLM_BASE_URL,
    },
  })
}

/**
 * 调用 LLM 并要求返回 JSON
 *
 * LangChain 的链式调用流程：
 *   ChatPromptTemplate（构建提示词）
 *     → ChatOpenAI（调用模型）
 *       → JsonOutputParser（解析JSON输出）
 *
 * @param {string} systemPrompt - 系统提示词（设定角色和规则）
 * @param {string} userPrompt  - 用户提示词（具体任务+数据）
 * @returns {Promise<object>} LLM 返回的 JSON 对象（已解析）
 */
export async function callLLMForJson(systemPrompt, userPrompt) {
  const model = createModel()
  const parser = new JsonOutputParser()

  // 构建对话模板：system消息定角色，user消息放具体内容
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    ['user', '{input}'],  // {input} 是占位符，invoke时会被替换
  ])

  // LangChain 的 pipe() 链式编排：提示词 → 模型 → JSON解析器
  // 数据像流水线一样从左到右依次经过每个环节
  const chain = prompt.pipe(model).pipe(parser)

  // invoke() 触发整条链的执行，{input: userPrompt} 填充占位符
  return await chain.invoke({ input: userPrompt })
}
