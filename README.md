# news-workflows

基于 **RSS + LLM** 的新闻简报自动生成工具。从 RSS 源拉取新闻，经过过滤后交给大模型以主编视角深度加工，输出结构化中文简报。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY 和 NEWS_BRIEFS_ROOT

# 3. 生成简报
npm run brief global-geopolitical-conflicts-rss
```

### 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `LLM_API_KEY` | LLM API 密钥 | 是 |
| `LLM_BASE_URL` | API 地址（默认 DeepSeek） | 否 |
| `LLM_MODEL` | 模型名（默认 gpt-4o-mini） | 否 |
| `LLM_TEMPERATURE` | 生成温度（默认 0.6） | 否 |
| `NEWS_BRIEFS_ROOT` | 简报输出根目录 | 是 |

支持任何 OpenAI 兼容接口（DeepSeek、通义千问、GPT-4o、Claude 等）。

## 使用

```bash
npm run brief <topic-id>              # 生成简报
npm run probe <topic-id>              # 探测源可用性
npm run audit -- list [topic]         # 查看运行记录
npm test                              # 运行测试
```

主题配置在 `config/topics/<topic-id>.yaml`，详细配置说明见 `config/CONFIG_GUIDE.md`。

## 目录

```
src/          源代码（4 阶段流水线：配置 → 抓取 → LLM 总结 → 输出）
config/       主题 YAML 配置
test/         测试与探测工具
logs/         审计日志（gitignore）
state/        运行时状态（gitignore）
```
