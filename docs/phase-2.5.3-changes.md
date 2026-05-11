# Phase 2.5.3 变更说明

## 并发调度增强

### 按 type 分类的并发池

每种 source type 独立限制并发，不再用统一上限：

```yaml
filter:
  runtime:
    concurrency:
      rss: 8        # RSS 轻量，高并发
      html: 5
      api: 5
      playwright: 2
      web: 2        # web 重（浏览器+AI），严格限制
      default: 5
```

老格式 `concurrency: 5` 仍兼容（等价于所有 type 共享同一 pool）。

### 调度日志增强

启动时打印总计调度信息：源数量、类型分布、并发配置。每个源排队/完成有实时日志，流程结束汇总成功/失败统计。

### 全局源超时

```yaml
filter:
  runtime:
    sourceTimeoutMs: 180000   # 单个源最长 3 分钟，默认无限
```

超时源当作失败处理，在最终统计中列出，不影响其他源。

### 测试

- `src/fetch/index.test.js`：5 个子测试，覆盖 pool map 两种格式、未知类型、源超时、默认 type
