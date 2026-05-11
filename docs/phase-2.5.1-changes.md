# Phase 2.5.1 变更说明

## 新增模块

### `src/utils/logger.js` — 步骤化日志器

统一抓取流程的步骤打印，带 ANSI 颜色、上下文标签、长度限制。

- `createLogger(context)` 创建带上下文的 logger 实例
- 方法：`step()`, `info()`, `warn()`, `error()`, `success()`, `timing()`
- 环境变量 `LOG_LEVEL` 控制输出级别：verbose / info（默认）/ warn / quiet
- 硬性限制：单行 ≤ 250 字符，URL ≤ 80 字符，文本 ≤ 60 字符
- 从不打印完整 HTML/JSON，只打印长度统计等元信息

### `src/utils/html-cleaner.js` — HTML 瘦身工具

用 cheerio 将页面 HTML 压缩为 LLM 友好格式。

- `cleanHtml(html, { mode, maxChars })` 支持 `list` 和 `article` 两种模式
- list 模式：保留 `<a>` 标签和 class/id，移除导航/侧栏
- article 模式：只保留主内容区（article > main > 文本量最大的 div）
- 移除 script/style/注释/base64/事件属性/data-*/style 属性
- 真实页面压缩率 > 70%

## 测试

- `src/utils/logger.test.js`：9 个子测试，覆盖所有级别和截断
- `src/utils/html-cleaner.test.js`：18 个子测试，覆盖 list/article 模式和所有清理规则
- 新增 `test/fixtures/cleaner/` 目录含 3 个 HTML 样本
