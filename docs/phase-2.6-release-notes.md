# Phase 2.6 版本发布日志

> 版本：0.2.6  
> 日期：2026-05-07  
> 分支：`feature/phase-2.6.*`（4 个子分支，已全部完成）  
> 前置依赖：Phase 2.5

---

## 概要

Phase 2.6 针对两个核心问题做了系统性改进：

1. **抓取广度不足** → 多 listUrl、分页、AI 穷尽提取、放开数量上限
2. **抓取过程黑盒** → 完整 JSONL 审计日志 + 查询 CLI

明确取舍：不在意 token 消耗和单次耗时，换取抓取覆盖度和可追溯性。

---

## 功能清单

### 2.6.1 — 多 listUrl + 分页支持

- 一个 source 可配置多个 `urls`（数组），覆盖多个版块
- `{page}` 占位符 + `pages` 实现分页抓取
- `url`（单）和 `urls`（数组）互斥，向后兼容
- 每个 URL 可带独立 `hint`；顶层 `hint` 作为默认值
- 页间延迟 `pageDelayMs` 防反爬
- 单 source 最多 20 个 URL 硬上限保护
- 新增 `url-expander.js` 模块

### 2.6.2 — AI 穷尽提取 + 放开数量

- 新增 `LIST_EXTRACT_DEEP_SYSTEM` 深度提取 prompt：穷尽列出所有候选，引入 `confidence`（high/medium/low）和 `section` 字段
- 候选按 confidence 排序后截取，low 不丢弃
- 详情新增 `deep` 策略：并行执行 Readability + AI，取正文更长者
- 默认值调整：`maxArticles` 10→50，`detailConcurrency` 2→3，`filter.maxItems` 40→80
- 候选池 500 条硬上限

### 2.6.3 — 审计日志 JSONL

- 每次运行生成完整 JSONL 审计日志（`logs/audit/{date}/`）
- 13 种事件类型覆盖全流程：run → source → list → candidates → detail → pipeline → llm → run
- 每个事件记录 candidates 完整列表、token 用量、耗时、过滤决策
- 运行结束自动生成 `summary.json` 汇总（source 统计、管线统计、成本估算）
- `llm.js` 新增 `callLLMForJsonWithMeta()`，返回 token 用量
- 终端日志增强：section 分布、confidence 统计、候选池流程、审计日志路径

### 2.6.4 — 审计日志查询 CLI

- `npm run audit -- list [topic]` — 列出最近 20 次运行
- `npm run audit -- show <runId>` — 单次运行完整详情
- `npm run audit -- candidates <runId> [source]` — 候选条目列表
- `npm run audit -- diff <id1> <id2>` — 对比两次运行
- `npm run audit -- query <id> <jq-filter>` — jq 查询
- `npm run audit -- prune [days]` — 清理旧日志
- 纯原生实现，无 CLI 框架依赖

---

## 配置变更

### 新增 YAML 字段

| 字段 | 级别 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `urls` | source | array | - | 多 URL 数组，与 `url` 互斥 |
| `pages` | source | number | - | 分页总数 |
| `pageStart` | source | number | 1 | 分页起始页码 |
| `pageDelayMs` | source | number | 1000 | 页间延迟（毫秒） |
| `extractDepth` | source | `normal\|deep` | `deep` | 列表提取深度 |
| `detailExtraction` | source | `auto\|readability\|ai\|deep` | `auto` | 详情提取策略 |

### 默认值调整

| 配置项 | 旧值 | 新值 |
|--------|------|------|
| `maxArticles` | 10 | 50 |
| `detailConcurrency` | 2 | 3 |
| `filter.maxItems` | 40 | 80 |

### 新增环境变量

```env
LLM_INPUT_PRICE_PER_1M_TOKENS=0.14   # 输入价格（元/百万 token）
LLM_OUTPUT_PRICE_PER_1M_TOKENS=0.28  # 输出价格（元/百万 token）
```

---

## 文件变更

### 新增文件（12 个）

```
src/fetch/web/url-expander.js           # URL 展开模块
src/fetch/web/url-expander.test.js      # 18 个单元测试
src/utils/auditor.js                    # 审计日志核心模块
src/utils/auditor.test.js               # 7 个单元测试
src/cli/audit.js                        # CLI 入口
src/cli/audit-commands/utils.js         # 共享工具
src/cli/audit-commands/list.js          # list 子命令
src/cli/audit-commands/show.js          # show 子命令
src/cli/audit-commands/candidates.js    # candidates 子命令
src/cli/audit-commands/diff.js          # diff 子命令
src/cli/audit-commands/query.js         # query 子命令
src/cli/audit-commands/prune.js         # prune 子命令
src/cli/audit.test.js                   # 5 个单元测试
config/topics/_test-multi-url.yaml      # 多 URL 测试配置
```

### 修改文件（12 个）

```
src/index.js               # 审计器创建/销毁，流水线总结
src/config.js               # validateSource() 校验
src/llm.js                  # callLLMForJsonWithMeta()
src/fetch.js                # 传递 auditor
src/fetch/index.js          # 传递 auditor 到 adapter + 过滤
src/fetch/web.js            # 多 URL 流程 + confidence 排序 + 审计接入
src/fetch/web/extract-list.js  # extractDepth + confidence + 审计
src/fetch/web/extract-detail.js # deep 策略 + 审计
src/fetch/web/prompts.js    # LIST_EXTRACT_DEEP_SYSTEM
src/fetch/common.js         # pipeline_filter 审计
src/summarize.js            # LLM 审计事件
package.json                # audit 脚本
.env.example                # 价格变量
```

### 文档新增（5 个）

```
docs/phase-2.6.1-changes.md
docs/phase-2.6.2-changes.md
docs/phase-2.6.3-changes.md
docs/phase-2.6.4-changes.md
docs/audit-log.md
docs/phase-2.6-release-notes.md  (本文档)
```

### 文档更新（1 个）

```
docs/source-types.md  # web 章节大幅更新
```

---

## 兼容性

- **向后兼容**：所有 Phase 2.5 的 YAML 配置零修改即可工作
- `url` 单数字段继续支持
- `extractDepth` 默认 `deep`，老配置自动走新 prompt
- `detailExtraction` 默认 `auto`，行为不变

---

## 测试

```bash
# 全量单测
npm test

# 验收
npm run brief us-iran                           # 老配置不退化
npm run brief _test-multi-url                   # 多 URL + 分页
npm run audit -- list                           # CLI 可用
npm run audit -- show <runId>
npm run audit -- prune 30 --yes
```
