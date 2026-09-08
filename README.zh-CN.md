# hivekey

[English](README.md) | **简体中文**

自托管的 LLM API Key 池。把某个 OpenAI 兼容接口的所有 API Key 放到一个统一 URL 后面,hivekey 会用智能调度算法在这些 Key 之间做负载均衡:遇到 429 或其他错误自动换 Key 重试、按 Key 指数退避冷却、支持出站代理,并提供实时 Web 管理面板。客户端可以用 **OpenAI、Anthropic(Claude)、OpenAI Responses 或 Google Gemini** 任意一种协议调用,池会统一转换到 OpenAI 兼容上游。设计思路参考 [new-api](https://github.com/QuantumNous/new-api)。

```
OpenAI SDK ────▶ /v1/chat/completions ─┐
Claude SDK ────▶ /v1/messages ─────────┤
Codex SDK ─────▶ /v1/responses ────────┼─▶ 调度器 ──▶ key #17 ──▶ https://api.upstream.com/v1
Gemini SDK ────▶ /v1beta/models/…/ ────┘      │ 429? 5xx? 换一个 Key 重试
                    (一个池令牌)               └──▶ key #4  ──▶ ✓
```

## 功能特性

- **一个 URL,多个 Key** —— 对外只暴露一个 OpenAI 兼容的 `/v1` 端点,背后可挂任意数量的上游 API Key,支持每行一个的批量导入。
- **多协议兼容** —— Anthropic SDK(`/v1/messages`,含 `count_tokens`)、OpenAI Responses API(`/v1/responses`)、Google Gemini SDK(`/v1beta/models/{m}:generateContent`)的请求会被透明转换到 OpenAI 上游 —— 非流式和流式都支持,包括工具/函数调用、图片和协议格式的错误响应。
- **自动重试与故障转移** —— 遇到 429 / 5xx / 网络错误时自动换一个 Key 透明重试;尊重 `Retry-After`;被限流的 Key 按指数退避进入冷却;连续两次返回 401 的 Key 自动禁用。
- **十二种调度策略** —— 默认 `auto` 根据近期健康、并发负载和响应类型按请求自动选策。新增延迟感知、可靠性优先、双随机负载均衡，保留原有八种策略。配置即时生效，升级保留已保存的策略。
- **容量感知切换与渠道熔断** —— 支持单密钥/渠道并发上限，满载时使用备用渠道；连续网络/5xx 故障触发隔离，冷却后使用一个真实请求探测恢复。首字节超时可在向客户端输出前切换。
- **模块化运维控制台** —— 响应式运行概览、独立智能路由页、零上游消耗的路由预览、策略预设、日志暂停/CSV 导出、令牌默认打码、密钥批量启用/禁用/重置；前端按页面、交互和设计变量拆分，无构建步骤。
- **性能感知路由** —— 每个请求都会记录首字延迟(TTFT)和每秒 token 数,按 Key 做 EWMA 平滑;这些指标既用于调度,也展示在仪表盘、Key 表格和日志里。
- **渠道与优先级分层** —— 把 Key 按渠道(每个渠道一个 base URL)分组,支持优先级故障转移、渠道权重、模型白名单(支持结尾 `*` 通配符)和模型名映射。
- **实时管理面板** —— 进行中请求实时表格、每分钟流量图表、持久化的每日用量统计、每个 Key 的健康度/延迟/首字/吞吐/429 统计与冷却倒计时,通过 SSE 实时推送。
- **完整的 Web 管理** —— 添加渠道、批量导入 Key、搜索/分页/测试 Key(单个或一键全测)、启用/禁用/重置 Key、签发客户端访问令牌、调整所有调度参数,全部在浏览器里完成。
- **备份与恢复** —— 在设置页把全部配置(渠道、Key、令牌、设置)导出为 JSON,并支持合并或替换两种模式导入。
- **明暗主题** —— 深色 / 浅色 / 跟随系统,一键切换。
- **代理支持** —— 每个渠道可单独设置出站 HTTP(S) 或 SOCKS(socks5/socks5h) 代理,也可配置全局兜底代理(`OUTBOUND_PROXY`)。
- **流式与用量统计** —— SSE 流式响应直接透传;从 JSON 和流式响应中提取 token 用量用于统计。
- **零数据库** —— 所有状态存在一个 JSON 文件里,用 Docker 一分钟即可部署。
- **中英双语面板(i18n)** —— 简体中文与英文,自动跟随浏览器语言,也可一键切换。

## 快速开始

### Docker

```bash
docker run -d --name hivekey \
  -p 3000:3000 \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=change-me-please \
  -v pool-data:/app/data \
  ghcr.io/kaecho/hivekey:latest   # 或本地构建:docker build -t hivekey .
```

### Docker Compose

```bash
git clone https://github.com/kaecho/hivekey.git
cd hivekey
# 编辑 docker-compose.yml(务必修改 ADMIN_PASSWORD!)
docker compose up -d
```

### Node.js(≥ 18.17)

```bash
git clone https://github.com/kaecho/hivekey.git
cd hivekey
npm ci
ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me npm start
```

然后:

1. 打开 `http://localhost:3000` 进入管理面板并登录。
2. **Channels → Add channel** —— 填入上游 base URL(如 `https://api.openai.com`),把 API Key 粘贴进去,每行一个。
3. **Tokens → Create** —— 为你的应用签发一个访问令牌。
4. 把应用指向池子:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-pool-..." \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}'
```

任何 OpenAI 兼容 SDK 都能用——把 `baseURL` 设为 `http://localhost:3000/v1`,`apiKey` 设为你的池令牌。响应头里带有 `x-pool-attempts` 和 `x-pool-channel` 便于调试。

## 使用其他 SDK(Anthropic / Responses / Gemini)

上游渠道保持 OpenAI 兼容即可,池会实时转换这些客户端协议。同一个池令牌在所有端点通用(`Bearer`、`x-api-key`、`x-goog-api-key` 或 `?key=`)。

**Anthropic SDK / Claude Code:**

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=sk-pool-...
# claude 或任何 Anthropic SDK 现在都会经过池子(POST /v1/messages)
```

**OpenAI Responses API**(如 Codex 类客户端):

```python
client = OpenAI(base_url="http://localhost:3000/v1", api_key="sk-pool-...")
client.responses.create(model="gpt-4o", input="hello")
```

**Google Gemini SDK:**

```python
from google import genai
client = genai.Client(api_key="sk-pool-...",
    http_options={"base_url": "http://localhost:3000"})
client.models.generate_content(model="gpt-4o", contents="hello")
```

说明:工具/函数调用、系统提示词、图片(base64)、流式和用量统计都会转换;托管的服务器工具(`web_search` 等)不支持。`/v1/messages/count_tokens` 和 `:countTokens` 由池本地估算返回。

## 配置

服务端配置全部通过环境变量:

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `ADMIN_USERNAME` | `admin` | 面板登录用户名 |
| `ADMIN_PASSWORD` | *(空)* | 面板登录密码。留空时自动生成随机密码,持久化并打印到日志 |
| `SESSION_SECRET` | *(自动)* | 会话签名密钥;留空时自动生成并持久化 |
| `SESSION_TTL_MS` | `86400000` | 管理员会话有效期(24 小时) |
| `DATA_DIR` | `./data` | `data.json`(渠道/Key/令牌/设置)的存储目录 |
| `OUTBOUND_PROXY` | *(空)* | 全局兜底出站代理(`http://host:port` 或 `socks5://host:port`);也会读取 `HTTPS_PROXY`/`HTTP_PROXY` |
| `TRUST_PROXY` | *(关)* | 信任的反向代理跳数(nginx/traefik 之后通常为 `1`),登录限流才能拿到真实客户端 IP;同时通过 `X-Forwarded-Proto` 启用 cookie 的 `Secure` 标志 |
| `BODY_LIMIT_BYTES` | `26214400` | `/v1` 请求体大小上限(25 MB) |
| `LOG_LEVEL` | `info` | 控制台日志等级:`error` / `warn` / `info` / `debug` |
| `LOG_COLOR` | `auto` | ANSI 颜色:`auto`(仅 TTY)、`always`(Docker 用)、`never` |

运行时行为分为**智能路由**（策略、切换和容量）与**设置**（请求预算、密钥保护、访问和备份）两部分：

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `strategy` | `auto` | Key 选择策略(见下文) |
| `maxAttempts` | `3` | 每个请求的总尝试次数(1 次初始 + 重试),每次换不同的 Key |
| `requestTimeoutMs` | `300000` | 所有尝试与响应流共用的请求总超时 |
| `firstByteTimeoutMs` | `30000` | 每次尝试等待首字节的时间，包含连接和响应头 |
| `maxInflightPerKey` | `0` | 单密钥并发上限，0 不限制 |
| `preferDifferentChannel` | `true` | 网络/5xx 故障时优先尝试其他渠道，包括低优先级备用渠道 |
| `circuitBreakerThreshold` | `3` | 渠道连续网络/5xx 故障熔断阈值，0 关闭 |
| `circuitBreakerCooldownMs` | `30000` | 熔断后允许一个真实恢复探测请求前的等待时间 |
| `connectTimeoutMs` | `10000` | 上游 TCP 连接超时 |
| `cooldown429BaseMs` | `30000` | 429 后的基础冷却时间(连续 429 时翻倍,上限 `cooldownMaxMs`;上游带 `Retry-After` 时以其为准) |
| `cooldownErrorBaseMs` | `5000` | 5xx/网络错误后的基础冷却时间(指数增长) |
| `cooldownMaxMs` | `900000` | 冷却时间上限 |
| `disableAfterConsecutiveFailures` | `8` | 连续失败达到该次数后自动禁用 Key(`0` = 从不) |
| `retryOn` | `429, 401, 403, 500, 502, 503, 504` | 触发换 Key 重试的上游状态码 |
| `allowAnonymous` | `false` | 允许不带池令牌直接调用 `/v1` |
| `logLimit` | `1000` | 内存中保留的已完成请求日志条数 |

## 核心概念

- **渠道(Channel)** —— 一个上游 base URL 及其配置:优先级、权重、可选的模型白名单、模型名映射(例如把 `gpt-4o` 改写为该上游的 `gpt-4o-2024-08-06`)、鉴权头样式(默认 `Authorization: Bearer`,可配置成其他方案),以及可选的渠道级代理。
- **Key** —— 渠道内的一个上游 API Key。支持每行一个批量导入,重复的会被跳过。每个 Key 独立跟踪健康状态:成功/失败次数、429 次数、EWMA 延迟、冷却状态。
- **访问令牌(Access Token)** —— *你的*应用调用池 `/v1` 端点所用的令牌(`sk-pool-…`),在面板里创建/吊销。

### 调度

首次请求使用服务该模型的**最高可用优先级层**，排除冷却/禁用密钥、熔断渠道和满载容量。每个渠道可设置 `maxInflight`（0 不限制）。网络/5xx 故障后，`preferDifferentChannel` 优先尝试其他渠道，包括备用优先级层；池内不会排队等待容量。

`auto` 在重试或近期故障时使用可靠性优先，高并发时使用双随机负载均衡，流式或长输出时使用延迟感知，其余情况使用自适应策略。请求日志展示实际策略和重试轨迹；`/api/routing/preview` 只计算资格，不调用上游、不占用密钥。

| 策略 | 行为 |
|---|---|
| `auto` *(默认)* | 根据健康、负载、流式类型与输出预算自动选策 |
| `latency_aware` | 综合健康、预计等待/生成时间和渠道权重进行加权选择 |
| `reliability_first` | 强调近期健康，保留探索并惩罚高并发 |
| `power_of_two` | 按权重抽取两个候选，选择负载更低/响应更快的一个 |
| `adaptive` | 按综合评分加权随机:平滑成功率² × 首字延迟因子 × 吞吐因子 × 并发惩罚 × 渠道权重。在偏好健康快速 Key 的同时保持探索 |
| `round_robin` | 轮询 |
| `random` | 均匀随机 |
| `weighted` | 按渠道权重随机 |
| `least_inflight` | 选并发请求最少的 Key |
| `lowest_latency` | 选 EWMA 响应延迟最低的 Key(新 Key 优先) |
| `lowest_ttft` | 选 EWMA 首字延迟最低的 Key(新 Key 优先) |
| `highest_throughput` | 选 EWMA 每秒 token 数最高的 Key(新 Key 优先) |

### 重试与 Key 健康度

- 可重试的上游失败(`retryOn` 中的状态码 + 网络错误)会立即换**另一个 Key** 重试,失败的 Key 被暂时下场:
  - **429** → 有 `Retry-After` 按其冷却,否则从 `cooldown429BaseMs` 开始指数退避。
  - **5xx / 网络错误** → 从 `cooldownErrorBaseMs` 开始指数冷却;连续失败达到 `disableAfterConsecutiveFailures` 次后自动禁用。
  - **401/403** → 视为坏 Key:连续出现两次即自动禁用。
- 客户端错误（400/422 等）不影响健康评分。**404 始终在尝试预算内换密钥重试**，不触发冷却或熔断。即使从 `retryOn` 移除状态码，429/认证/5xx 的健康保护仍生效。
- 渠道熔断只统计网络/5xx 错误，不统计单密钥限流或认证失败。冷却后只允许一个真实请求探测恢复，其他请求使用备选渠道；探测成功后自动恢复放行。认证禁用的密钥仍需修复凭证或人工处理。
- **输出后绝不重放**：只有向客户端输出前才能透明切换。部分 SSE 流出错时结束连接，不重试、不重复内容；所有尝试共用总超时。TTFT 指首个上游响应字节的到达时间。
- 所有尝试都失败时返回最后一次上游错误;完全没有可用 Key 时返回 `503` JSON 错误。
- 请求成功会完全重置该 Key 的失败计数。

## HTTP API

面板的所有操作都是普通 REST API,可以直接脚本化——用 `POST /api/auth/login` 拿到会话令牌后以 `Authorization: Bearer <token>` 调用:

```
POST   /api/auth/login              {username, password}
GET    /api/overview
GET    /api/routing                 POST /api/routing/preview  {model, stream, maxTokens, strategy?}
POST   /api/routing/channels/:id/reset
GET    /api/channels                POST /api/channels        PUT/DELETE /api/channels/:id
GET    /api/channels/:id/keys      POST /api/channels/:id/keys   {"keys": "sk-a\nsk-b\n..."}
POST   /api/channels/:id/test-keys  (批量测试渠道内启用的 Key,限并发)
PATCH  /api/keys/:id               POST /api/keys/:id/reset  POST /api/keys/:id/test
DELETE /api/keys/:id               POST /api/keys/batch-delete   {"ids": [...]}
POST   /api/keys/batch              {ids: [...], action: "enable"|"disable"|"reset"}
GET    /api/tokens                  POST /api/tokens          PATCH/DELETE /api/tokens/:id
GET    /api/logs                    GET  /api/requests/live  (日志筛选：q, channelId, status, retried=true, limit)
GET    /api/settings                PUT  /api/settings
GET    /api/export                  POST /api/import          {"data": <备份>, "mode": "merge"|"replace"}
GET    /api/events                  (SSE:请求/Key/总览实时事件)
```

## 说明

- 池会把 `/v1/*` 原样转发到 `<baseUrl>/v1/*`(base URL 末尾的 `/v1` 会被自动剥离,所以 `https://host` 和 `https://host/v1` 都可以)。
- 上游请求会带 `Accept-Encoding: identity`,以便从响应体中读取 token 用量。
- API Key 以明文存储在 `DATA_DIR/data.json` 中,请保护好该目录。面板、日志和 API 响应中的 Key 默认全部打码,除非显式选择显示。
- 如果对公网暴露,请置于 HTTPS 反向代理之后,并设置强 `ADMIN_PASSWORD`。

## 开发

```bash
npm ci
npm test        # 单元 + 集成测试(mock 上游:重试、429、流式、鉴权)
npm run dev     # 修改后自动重启
npm run test:ui # Playwright：桌面/移动端、主题、中英文与操作流程
```

浏览器测试需要 Node.js 20+（服务端仍支持 ≥18.17），使用临时本地实例与虚拟凭证，不访问你的 `data/`。没有系统 Chromium 时先运行 `npx playwright install chromium`，也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器。截图和调试轨迹输出到已忽略的 `test-results/`。

前端结构：`public/app.js` 启动路由；`public/js/views/` 渲染页面，`actions/` 处理委托交互，`core.js` 提供共享状态/API 工具，`realtime.js` 处理 SSE。样式位于 `public/css/`，每种主题只维护一份设计变量。新增可见文案需通过 `t()` 并添加到 `public/js/locales/zh-cn.js`。策略元数据统一定义在 `src/scheduler.js`，通过 `/api/routing` 提供给界面。

`qs` override 将 Express 间接依赖的查询解析器保持在已修复的 6.16+ 版本，待上游依赖范围更新后可移除。

**升级提示**：保留原先保存的策略，新安装默认使用 `auto`。请求超时现在覆盖全部重试与流式传输，超长生成任务需适当调大。首字节超时默认为 30 秒，慢启动或长思考模型需适当调大；超时的尝试仍可能消耗上游额度。首字节超时、熔断参数在智能路由页调整；并发上限默认不限制。响应头新增 `x-pool-request-id`、`x-pool-strategy`、`x-pool-failover`，与原有 `x-pool-attempts` / `x-pool-channel` 一起用于排障。

## 许可证

[MIT](LICENSE)
