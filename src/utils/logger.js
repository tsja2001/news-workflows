/**
 * ============================================================
 * 步骤化日志器 — 统一抓取流程的步骤打印
 * ============================================================
 *
 * 设计目标：
 *   - 给所有抓取流程提供统一的步骤打印
 *   - 强制限制每条日志长度，避免网页/JSON 内容刷屏
 *   - 带时间戳和上下文标签
 *   - ANSI 颜色区分级别
 *
 * 环境变量 LOG_LEVEL 控制最低输出级别:
 *   verbose / info（默认）/ warn / quiet
 */

// —— ANSI 颜色 ——
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

const LEVEL_NUM = { verbose: 0, info: 1, warn: 2, quiet: 3 }

// —— 截断工具 ——

/**
 * 通用截断：超长时末尾加 suffix
 */
export function truncate(str, max, suffix = '...') {
  if (!str || str.length <= max) return str
  return str.slice(0, max - suffix.length) + suffix
}

/**
 * URL 截断：保留协议+域名+尾部路径，中间省略
 */
export function formatUrl(url, max = 80) {
  if (!url || url.length <= max) return url
  try {
    const u = new URL(url)
    const tail = u.pathname.length > 30 ? '...' + u.pathname.slice(-27) : u.pathname
    return `${u.protocol}//${u.host}${tail}`
  } catch {
    return truncate(url, max)
  }
}

/**
 * 字节数人性化显示
 */
export function formatBytes(bytes) {
  if (bytes == null) return '0B'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 整数显示带千位逗号
 */
export function formatNumber(n) {
  if (n == null) return '0'
  return Number(n).toLocaleString('en-US')
}

// —— detail 渲染 ——

/** 特殊 key：只展示格式化后的值，不展示 key */
const UNIT_KEYS = new Set(['ms', 'duration', 'bytes', 'size', 'length'])

function renderDetail(detail) {
  if (detail === undefined || detail === null) return ''

  if (typeof detail === 'string') {
    return ' ' + truncate(detail, 120)
  }

  if (typeof detail === 'object') {
    const parts = []
    for (const [key, val] of Object.entries(detail)) {
      if (val === undefined || val === null) continue
      let formatted
      if (key === 'url' || key === 'urls') {
        formatted = formatUrl(String(val))
      } else if (key === 'bytes' || key === 'size' || key === 'length') {
        formatted = formatBytes(val)
      } else if (key === 'ms' || key === 'duration') {
        formatted = `${val}ms`
      } else if (key === 'tokens') {
        formatted = formatNumber(val)
      } else {
        formatted = truncate(String(val), 60)
      }

      if (UNIT_KEYS.has(key)) {
        parts.push(formatted)
      } else {
        parts.push(`${key}=${formatted}`)
      }
    }
    if (parts.length === 0) return ''
    return ' (' + parts.join(', ') + ')'
  }

  return ' ' + truncate(String(detail), 120)
}

// —— Logger ——

/**
 * 创建一个带上下文的 logger 实例
 * @param {string} context - 上下文标签，如 "web/BBC News"
 * @returns {object} logger 实例
 */
export function createLogger(context) {
  const level = process.env.LOG_LEVEL || 'info'
  const minLevel = LEVEL_NUM[level] ?? LEVEL_NUM.info

  function shouldLog(levelName) {
    return (LEVEL_NUM[levelName] ?? 0) >= minLevel
  }

  function emit(levelName, icon, color, message, detail) {
    if (!shouldLog(levelName)) return

    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    let line = `[${ts}] [${context}] ${icon} ${message}`
    line += renderDetail(detail)

    // 硬性单行 250 字符限制
    if (line.length > 250) {
      line = line.slice(0, 247) + '…'
    }

    console.log(`${color}${line}${C.reset}`)
  }

  return {
    /** 打印一个步骤 */
    step: (msg, detail) => emit('info', '▶', C.cyan, msg, detail),
    /** 普通信息 */
    info: (msg, detail) => emit('info', 'ℹ', C.reset, msg, detail),
    /** 警告 */
    warn: (msg, detail) => emit('warn', '⚠', C.yellow, msg, detail),
    /** 错误 */
    error: (msg, detail) => emit('quiet', '✗', C.red, msg, detail),
    /** 成功 */
    success: (msg, detail) => emit('info', '✓', C.green, msg, detail),
    /** 耗时统计 */
    timing: (label, ms) => emit('verbose', '⏱', C.dim, label, { ms }),
  }
}
