# Phase 1 变更说明

## 概述

将 `fetch.js` 重构为可扩展的适配器模式，加入历史去重、并发控制、重试机制。

## 文件变更

### 新增

| 文件 | 用途 |
|------|------|
| `src/fetch/index.js` | 抓取调度器，按 `source.type` 路由到对应 adapter，集成 p-limit 并发控制 |
| `src/fetch/rss.js` | RSS 适配器，从原 `fetch.js` 迁移，增加 p-retry 网络重试 |
| `src/fetch/common.js` | 共用过滤管线：时间过滤、关键词过滤、URL 去重、排序截断 |
| `src/fetch/types.js` | JSDoc 类型定义（NewsItem 结构） |
| `src/fetch/common.test.js` | 过滤管线单元测试（10 个用例） |
| `src/state/seen-store.js` | 历史去重存储：加载、标记、过期清理，原子写入（.tmp → rename） |
| `src/state/seen-store.test.js` | 历史去重单元测试（7 个用例） |

### 修改

| 文件 | 变更 |
|------|------|
| `src/fetch.js` | 改为薄壳 re-export，保留 `fetchAndFilter(config)` 签名，内部集成历史去重逻辑 |
| `src/index.js` | 增加 `--no-dedup` CLI 参数解析 |
| `package.json` | 新增依赖 `p-limit`、`p-retry`；新增 `npm test` 脚本 |
| `.gitignore` | 增加 `/state/`、`/logs/` 目录 |

## 新增 YAML 字段

所有新增字段都有默认值，老配置不修改也能正常运行。

```yaml
# 历史去重（opt-in，默认关闭）
dedup:
  enabled: true          # 开启后同 URL 在 retentionDays 内不再重复处理
  retentionDays: 7       # 保留天数，默认 7

# 运行时参数（可选，有默认值）
runtime:
  concurrency: 5         # 并发抓取上限，默认 5
  fetchTimeoutMs: 15000  # 单次请求超时（毫秒）
  retries: 3             # 网络请求重试次数，默认 3
```

## CLI 变更

```bash
npm run brief us-iran                 # 正常运行
npm run brief us-iran -- --no-dedup   # 临时禁用历史去重
npm test                              # 运行所有单元测试
```

## 验收结果

- `npm run brief us-iran` — 老配置正常产出 8 条简报
- `npm test` — 18 个测试全部通过
- 历史去重生效：开启 dedup 后首次 8 条，第二次 0 条
- `--no-dedup` 可绕过历史去重

## 向后兼容

- 现有 `config/topics/us-iran.yaml` 不修改也能跑
- `source.type` 缺失时默认按 `rss` 处理
- `dedup.enabled` 默认 `false`，不影响现有行为
- `fetchAndFilter(config)` 签名不变，现有调用方 `index.js` 无需改动
