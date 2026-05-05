# news-workflows

基于 RSS 和 LLM 生成新闻简报的 Node.js 项目。

## 使用方法

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL`。

3. 生成简报

```bash
npm run brief us-iran
```

输出会写入主题配置中的 `output.dir`，同时生成 Markdown 和 JSON 文件。
