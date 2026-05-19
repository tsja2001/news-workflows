/**
 * ============================================================
 * 校验模块 — 最终 report 的结构和内容校验
 * ============================================================
 *
 * 两级校验：
 *   1. 代码级 schema 检查（始终运行）
 *   2. LLM 内容校验（validation.enabled=true 时启用）
 */

/**
 * 代码级 schema 检查，自动修复轻度问题
 *
 * @param {object} report - 最终 report JSON
 * @param {object} config - 主题配置
 * @returns {{ report: object, issues: string[], fixed: string[] }}
 */
function structuralCheck(report, config) {
  const issues = []
  const fixed = []

  // 必填字段检查
  const fields = ['overview', 'keyDevelopments', 'briefs', 'timeline', 'signals', 'risks', 'unknowns', 'editorReview']
  for (const f of fields) {
    if (!(f in report)) {
      issues.push(`缺少字段: ${f}`)
      if (f === 'keyDevelopments' || f === 'briefs' || f === 'timeline' || f === 'signals' || f === 'risks' || f === 'unknowns') {
        report[f] = []
        fixed.push(`补充空数组: ${f}`)
      } else {
        report[f] = ''
        fixed.push(`补充空字符串: ${f}`)
      }
    }
  }

  // keyDevelopments 字段检查
  for (const kd of report.keyDevelopments || []) {
    if (!kd.title) {
      issues.push('keyDevelopments 条目缺少 title')
      kd.title = '（未命名）'
      fixed.push('补充默认 title')
    }
    if (!kd.importance || !['high', 'medium'].includes(kd.importance)) {
      kd.importance = 'medium'
    }
    if (kd.what && !kd.detail) {
      // 新格式，允许
    }
  }

  // excludeTopics 检查
  const excludeTopics = config.editorial?.excludeTopics || []
  if (excludeTopics.length) {
    const kdText = JSON.stringify(report.keyDevelopments || []).toLowerCase()
    for (const topic of excludeTopics) {
      if (kdText.includes(topic.toLowerCase())) {
        issues.push(`keyDevelopments 可能包含排除话题: "${topic}"`)
      }
    }
  }

  return { report, issues, fixed }
}

/**
 * 校验最终 report
 *
 * @param {object} report      - 最终 report JSON
 * @param {object} config      - 主题配置
 * @param {object} [options]
 * @param {object} [options.auditor]
 * @returns {Promise<{ report: object, issues: string[], fixed: string[] }>}
 */
export async function validateReport(report, config, options = {}) {
  const { report: fixedReport, issues, fixed } = structuralCheck(report, config)

  // LLM 级校验（二期深度检查）
  const validationCfg = config.llmPipeline?.validation
  if (validationCfg?.enabled) {
    // 预留：未来用 LLM 做深度校验
    // const { callLLMForJsonWithMeta } = await import('../llm.js')
    // ...
  }

  if (options.auditor) {
    options.auditor.event('validation_completed', {
      issuesFound: issues.length,
      issuesFixed: fixed.length,
      issues: issues.length > 0 ? issues : undefined,
      fixed: fixed.length > 0 ? fixed : undefined,
    })
  }

  return { report: fixedReport, issues, fixed }
}
