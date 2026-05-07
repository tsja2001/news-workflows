# Phase 2.6.4: 审计日志查询 CLI

## 变更摘要

提供 `npm run audit` 命令，方便查询历史审计日志，无需手写 `jq`。

## 命令清单

### `npm run audit -- list [topic]`

列出最近 20 次运行记录，包含时间、主题、源数、详情数、LLM tokens、耗时、状态。

### `npm run audit -- show <runId>`

显示单次运行的完整详情：源处理情况、过滤管线、LLM 统计、文件路径。

### `npm run audit -- candidates <runId> [source]`

列出某次运行的所有候选条目，带 confidence 和 section 标注。

### `npm run audit -- diff <runId1> <runId2>`

对比两次运行：新增/消失的条目，各源详情数变化。

### `npm run audit -- query <runId> <jq-filter>`

用 jq 表达式直接查询 JSONL 文件。需要系统安装 `jq`。

### `npm run audit -- prune [days] [--yes]`

清理超过 N 天（默认 30 天）的审计日志目录。

## 新增文件

```
src/cli/
├── audit.js                           # 入口，命令路由
└── audit-commands/
    ├── utils.js                       # 共享工具（scanRuns、findRun、parseJsonl）
    ├── list.js
    ├── show.js
    ├── candidates.js
    ├── diff.js
    ├── query.js
    └── prune.js
```

## 修改文件

- `package.json` — 新增 `"audit": "node src/cli/audit.js"` 脚本

## 设计约束

- 不引入 commander/yargs 等 CLI 框架，原生 `process.argv` 解析
- JSONL 解析失败的行跳过并 warn
- runId 不存在时友好提示

## 测试

```bash
npm run audit -- list
npm run audit -- show <runId>
npm run audit -- candidates <runId>
npm run audit -- prune 30
npm test
```
