# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

基于 RSS + LLM 的新闻简报生成工具。从多个 RSS 源拉取新闻 → 时间/关键词过滤 → LLM 总结为结构化简报 → 输出 Markdown + JSON 文件。

## 常用命令

```bash
npm run brief <topic-id>    # 生成简报，如 npm run brief us-iran
```

目前没有 `npm test`（PLAN.md Phase 1 计划加入，使用 Node 内置 `node:test`）。

## 架构：4 阶段流水线

```
index.js (CLI入口, 4步调度)
  → config.js   (1. 加载 config/topics/<id>.yaml)
  → fetch.js    (2. 并发拉RSS → 时间过滤 → 关键词过滤 → URL去重 → 排序截断)
  → summarize.js (3. 拼prompt → llm.js 调LLM用 JsonOutputParser)
  → output.js   (4. 写 .md 和 .json 到 output.dir)
```

- `llm.js` 是唯一接触 LangChain SDK 的地方，使用 `ChatOpenAI` 类连接任意 OpenAI 兼容服务（DeepSeek、通义千问等），模型/provider 通过 `.env` 配置，不写死在代码里
- `fetch.js` 单源失败返回空数组不中断整体流程；统一产出 `{title, url, source, publishedAt, summary}` 格式
- `output.js` 以日期-主题标题命名文件，同一天多次运行会幂等覆盖

## 配置

- **主题配置**: `config/topics/<topic-id>.yaml` — 定义 sources、filter（keywords/lookbackHours/maxItems）、output.dir
- **环境变量**: `.env` — `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`（.env.example 有模板）
- YAML 中 `sources[].type` 当前只有 RSS（默认），PLAN.md Phase 2 将扩展 html/playwright/api

## 开发规范（来自 PLAN.md）

- ES Module (`import`/`export`)，不混入 CommonJS
- 纯 JS + JSDoc 类型注释，不使用 TypeScript
- 中文注释
- camelCase 变量，kebab-case 文件名
- 不要硬编码路径、API key、模型名，都走 yaml 或 `.env`
- 不要重写现有能跑通的代码，只做必要重构
- 遇到不确定的设计决策停下来问人类

## 升级计划

PLAN.md 定义了 4 个阶段的升级路线，严格按顺序执行，每个 Phase 独立可交付：

1. **Phase 1** — 基础设施重构：fetch 改为适配器模式（`src/fetch/` 目录）、历史去重（`src/state/seen-store.js`）、并发控制+重试
2. **Phase 2** — 抓取扩展：HTML 爬虫、Playwright、API 适配器、正文提取（readability）
3. **Phase 3** — LLM 加固：调用日志、token 统计、自动重试、Zod schema 校验
4. **Phase 4** — 进阶增强（可选）：多语言、聚类、周报、健康监控

当前代码库处于初始基线状态（Phase 1 尚未开始）。
