<p align="right">
  <a href="./README.EN.md">English</a>
</p>

<div align="center">

# dsh-usage-hub

**当前会话用到的每个供应商，一眼看到额度。**

[![npm](https://img.shields.io/npm/v/dsh-usage-hub)](https://www.npmjs.com/package/dsh-usage-hub)
[![npm downloads](https://img.shields.io/npm/dm/dsh-usage-hub)](https://www.npmjs.com/package/dsh-usage-hub)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![DeepSeek Harness plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的插件：
显示**当前对话所跑模型背后的供应商账户**的额度窗口、账户余额与 token 用量——
你一换模型，它就跟着换供应商。

</div>

---

## 它做什么

在 DSH 里切换模型，用量面板自动跟上：查询对象取自会话的 `modelSelection` 投影，
所以「换模型」就是「换查询对象」。不需要任何配置，也没有「先选个账户再查」的
下拉框让你选错。

```
┌─ 用量 / Usage ─────────────────────────────────────────────────┐
│                                                                  │
│  ● MiniMax            MiniMax-M3.1-Flash    凭据 MINIMAX_CN_API_KEY
│                                                                  │
│  5 小时          剩余 72%                                        │
│  ████████████████░░░░░░░░░░░░                                  │
│  已用 28%  ·  重置 2026/10/29 18:16                              │
│                                                                  │
│  每周           剩余 80%                                        │
│  ████████████████████░░░░░░░░░░░░                              │
│  已用 20%  ·  重置 2026/11/05 14:30                              │
│                                                                  │
├─ 当前会话 ──────────────────────────────────────────────────────┤
│  输入 120K   输出 18K   缓存读 640K   缓存写 0   合计 778K      │
│                                                                  │
├─ 跨会话累计 ────────────────────────────────────────────────────┤
│  模型                     请求数    输入     输出    缓存读    合计  │
│  MiniMax-M3.1-Flash         281     1.2M    180K     4.8M     6.2M │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

供应商清单**单独一页**，不和用量数字混在一起：

```
┌─ 供应商 / Providers ───────────────────────────────────────────┐
│                                                                  │
│  ● MiniMax          MINIMAX_CN_API_KEY · api.minimaxi.com  [查看] │
│  ● DeepSeek         DEEPSEEK_API_KEY · api.deepseek.com    [查看] │
│  ○ Claude           未配置凭据 · api.anthropic.com        [查看] │
│  ○ OpenRouter       未配置凭据 · openrouter.ai            [查看] │
│                                                                  │
│  ● 已配置凭据   ○ 未配置凭据              [回到当前模型]         │
└──────────────────────────────────────────────────────────────────┘
```

## 功能

- **跟随会话模型**：浏览器读会话 `modelSelection` 投影的 `next ?? lastUsed`，带着新的
  provider 重新查询。切模型就是切换查询对象。
- **逐供应商适配器**：每个供应商各自声明用量接口、鉴权头写法和响应解析方式。
  内置十四家供应商，外加一个给自建 OpenAI 兼容中转站用的通用适配器。
- **额度窗口画成进度条**：按剩余量着色（≥40 % 绿、≥15 % 橙、更低为红），
  下面跟已用百分比与重置时间。
- **只显示凭据状态，不显示凭据本身**：供应商页列出每个供应商用的**凭据引用名**
  与它能否解析成功，绝不显示 key。
- **跨会话 token 汇总**，按模型聚合，从会话日志回放得出。
- **自带设置页**：「用量与额度」页右上角有一个齿轮，点进去就是本插件的设置页；
  改完直接写回 profile 里的本插件条目，**不需要手改 YAML、不需要重启插件**。
- **刷新间隔可配**：设置页里选 5 秒 / 60 秒 / 10 分钟 / 30 分钟 / 1 小时，改完立刻生效。
- **状态栏保持清爽**：窗口左下角默认只显示额度与用量，不放刷新按钮；想要的话在设置页
  打开「显示快捷刷新按钮」。
- **中英双语界面**，跟随 harness 的语言设置。
- **零运行时依赖**：宿主半边只用 Node 内置能力；`schemastery` 是可选 peer，
  仅用于配置 schema，缺了插件照样能装。

## 安装

需要一个已有的 DeepSeek Harness 安装（带 Web 界面）与 Node.js ≥ 20。

```sh
# npm（推荐）
dsh plugin --profile web add dsh-usage-hub

# 或从 GitHub 安装
dsh plugin --profile web add github:KevenUnderwood/dsh-usage-hub

# 或从本地目录安装
dsh plugin --profile web add ./dsh-usage-hub
```

装完**重启 `dsh web`**（或桌面版），然后刷新页面。

> **装 tarball，别装带着自己 `node_modules` 的链接目录。** 这种目录会遮蔽 harness
> 共享的 `@deepseek-ai/cordis` 实例，宿主半边因此根本注册不上——浏览器每个请求都
> 404。本插件没有运行时依赖，所以一个干净的目录（里面没跑过 `npm install`）没问题；
> 如果你在目录里装过依赖，删掉那个 `node_modules`，或者改装打包好的 tarball：
>
> ```sh
> npm pack && dsh plugin --profile web add ./dsh-usage-hub-0.1.0.tgz
> ```

桌面版有自己独立的 profile（`~/.dsh/profiles/desktop`）；用桌面窗口的话那边也要装一份。

## 支持的供应商

识别顺序：**DSH 供应商路由 id** → **base URL** → 若路由有 `baseURL` 但谁都不像，
则交给通用中转站适配器。

| 路由 | 展示形态 | 接口 | 显示内容 |
|---|---|---|---|
| `deepseek-official`、`deepseek` | 余额 | `GET https://api.deepseek.com/user/balance` | 分币种的余额 |
| `deepseek-account` | 余额 | `ctx.deepseekAccount.getBalance()` | 已登录账户的钱包余额，不需要 API Key |
| `anthropic` | 额度窗口 | `GET https://api.anthropic.com/api/oauth/usage` | 5 小时、7 天与模型专属周限 |
| `openai-codex` | 额度窗口 + Credits | `GET https://chatgpt.com/backend-api/wham/usage` | 5 小时 / 每周窗口、Codex Credits |
| `kimi-coding` | 额度窗口 | `GET https://api.kimi.com/coding/v1/usages` | 5 小时与每周窗口 |
| `zai-coding-cn`、`zai` | 额度窗口 | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | 5 小时与每周窗口；按量付费账户回落查账户余额 |
| `minimax-cn`、`minimax` | 额度窗口 | `GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains` | 5 小时与每周窗口 |
| `opencode-go` | 额度窗口 | `GET https://opencode.ai/zen/go/v1/usage` | 滚动、每周与每月窗口 |
| `github-copilot` | 额度 | `GET https://api.github.com/copilot_internal/user` | 高级交互额度 |
| `openrouter` | 余额 | `GET https://openrouter.ai/api/v1/credits` | 已用 / 总额度 |
| `moonshotai-cn`、`moonshotai` | 余额 | `GET https://api.moonshot.cn/v1/users/me/balance` | 可用余额 |
| `siliconflow` | 余额 | `GET https://api.siliconflow.cn/v1/user/info` | 总余额 |
| `novita` | 余额 | `GET https://api.novita.ai/v3/user/balance` | 可用余额 |
| `stepfun` | 余额 | `GET https://api.stepfun.com/v1/accounts` | 账户余额 |
| *任何其它带 `baseURL` 的路由* | 余额 | 依次试 `/api/user/self`、`/v1/usage`、`/api/usage`、`/user/balance` | New API / one-api、sub2api 与通用余额中转站 |

### 凭据引用名

插件直接向 harness 要该路由**本来就在用的那把 key**，所以多数供应商**完全不用配置**。
它会找的引用名：

| 路由 | 凭据引用 |
|---|---|
| `deepseek-official` | `DEEPSEEK_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_OAUTH_TOKEN` |
| `openai-codex` | `OPENAI_CODEX_ACCESS_TOKEN`、`CHATGPT_ACCESS_TOKEN`、`CODEX_ACCESS_TOKEN` |
| `kimi-coding` | `KIMI_API_KEY`、`KIMI_CODING_API_KEY` |
| `zai-coding-cn`、`zai` | `ZAI_CODING_CN_API_KEY`、`ZAI_API_KEY`、`ZHIPU_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY`、`MINIMAX_API_KEY` |
| `opencode-go` | `OPENCODE_API_KEY` |
| `github-copilot` | `COPILOT_GITHUB_TOKEN`、`GITHUB_TOKEN` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `moonshotai-cn`、`moonshotai` | `MOONSHOT_API_KEY` |
| `siliconflow` | `SILICONFLOW_API_KEY` |
| `novita` | `NOVITA_API_KEY` |
| `stepfun` | `STEPFUN_API_KEY` |

路由实际用的引用名来自它自己的配置（`dsh-llm-pi-ai` 的 `providers.<route>.apiKeyEnv`），
所以用户自定义过引用名的路由同样认得。凭据**每次查询都重新解析**：在
「设置 → 模型」里填好 key，下一次查询就用上了，不用重启。

### 不止要 API Key 的供应商

有三个接口**不接受普通 API Key**：

- **Claude**（`anthropic`）—— `/api/oauth/usage` 要的是 **OAuth access token**，
  不是 `ANTHROPIC_API_KEY`。拿 API Key 去查会 401。
- **ChatGPT / Codex**（`openai-codex`）—— `wham/usage` 要 ChatGPT 订阅的
  **OAuth access token**。
- **GitHub Copilot**（`github-copilot`）—— `copilot_internal/user` 要 **GitHub OAuth
  token**（`Authorization: token …`，不是 `Bearer …`）。

这些情况下插件会把上游错误原样显示出来，所以 401 一定意味着「凭据类型不对」，
而不是插件坏了。

## 配置

开箱即用。**设置在「用量与额度」页右上角的齿轮里**——点开就是本插件的设置页，
保存后直接写回 profile 里本插件的那一条（`~/.dsh/profiles/<profile>/cordis.patch.yml`
里 `id: usage-hub` 的 `config:`），**不用手改 YAML，也不用重启插件**：这个字段在
宿主侧标成了 volatile，值是一个「活引用」，改完立刻生效。

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `refreshIntervalMs` | `number` | `600000` | 自动刷新间隔（毫秒）；只接受 `5000` / `60000` / `600000` / `1800000` / `3600000` 五档 |
| `showQuickRefresh` | `boolean` | `false` | 是否在窗口左下角的状态栏里显示快捷刷新按钮 |

只有这两个配置项。其余行为都是固定值：跨会话聚合最多回放 50 个会话、聚合结果
缓存 30 秒、单次用量查询超时 15 秒。

没有 Web 设置服务（比如只跑宿主、没挂设置插件）时，插件照常工作，设置只能手改
YAML：

```yaml
- id: usage-hub
  name: dsh-usage-hub
  config:
    refreshIntervalMs: 600000
    showQuickRefresh: false
```

> 本包的 bundle patch 已经插好了这一行；再 `insert` 一个同 id 的行会让启动直接失败：
> `duplicate loader entry id`。

## 工作原理

```
浏览器                                    宿主
──────                                    ────
会话投影 "modelSelection" ───────────▶  解析供应商路由
                                              │
                                              ├─ 路由 id  → 适配器
                                              ├─ base URL → 适配器
                                              └─ 其它      → 中转站适配器
                                                     │
                                          ctx.credentials.resolve(引用名)
                                                     │
                                          请求该供应商的用量接口
                                                     │
                              { tiers: [...], balances: [...] } ──▶ 进度条
```

**宿主半边**（`lib/index.js`、`lib/providers.js`）在 `webServer` 服务上注册一条前缀路由，
用 Connection 的 RPC 信封提供三个端点：

| 端点 | 回答什么 |
|---|---|
| `quota` | 当前供应商（或载荷里指定的那个）的额度窗口 / 余额 |
| `providers` | 供应商清单：名称、凭据引用名、凭据状态 |
| `usage` | 跨会话 token 合计，按模型聚合 |

路由直接注册在 `webServer` 服务上，而不是走 `ctx.connection.rpc.handle()`——因为在较新的
DSH 上后者对第三方插件已经不可用：它的销毁回调会读 `owner.webServer`，而那个 owner 解析到
Connection 插件自己的 fiber，那里永远没有 `webServer`，于是通道凭空消失、启动日志却一片
安静。插件自己用 `ctx.connection.admit(req)` 做 Host/Origin 与浏览器会话的信任判定。

**浏览器半边**（`lib/client.js`）是一个 `window.__ModuleLoader__.load({ id, factory })`
格式的 bundle，注册四个插槽：

| 插槽 | 显示什么 |
|---|---|
| `shell.bottom` | 当前供应商的摘要与本会话 token 小计 |
| `main` | 两页签整页（面板 id `usage-hub`） |
| `main` | 设置页（面板 id `usage-hub-settings`，只从齿轮进入，不进侧边栏） |
| `conversation.session.header.utilities` | 捕获 `tokenUsage` 与 `modelSelection` 投影 |

整页自带滚动容器：DSH 的中列是 `overflow: hidden`，主面板必须自己提供滚动。

设置页走 DSH 的配置表单服务：浏览器用 `ctx.configForms.get("usage-hub")` 读写本插件
自己的 Config（`ctx.configForms` 是**可选**服务，拿不到就显示「设置不可用」）。
宿主侧对应地把六个字段标成 `.volatile()`——DSH 只把 volatile 字段做成可写表单，
而且这些字段交给插件时是「活引用」：宿主改配置时原地换值，插件不重启也能看到新值。

## 安全

- 凭据**值**只在宿主进程内解析，绝不外传；响应里只有归一化后的数字与凭据**引用名**。
- 每个请求都先过 `ctx.connection.admit(req)`，浏览器会话与 Host/Origin 校验都在应答前完成。
- 插件不上传任何数据；用量请求由宿主直接发往供应商接口。
- 诊断日志默认关闭，且从不写入凭据值。

## 兼容性

- DeepSeek Harness `>=0.2.1-rc.1`（带 Web 界面）；Node.js `>=20`。
- 插件用到 DSH 内部接口——插槽系统、`tokenUsage` 与 `modelSelection` 会话投影、
  `ctx.agentDefaultModel`、`ctx.llm.listConfigurableProviders()`、
  `ctx.configEditor.configuration()`、`ctx.credentials` 与 Connection 的 RPC 信封。
  这些都不是公开 API，harness 升级后可能变化。
- 可选服务一律用 `ctx.get()` 按需获取，所以某个服务缺失或稍后才激活时插件仍能挂载。
  硬依赖只有 `webServer` 与 `connection`。
- `engines.dsh` 特意声明**开放的下界**：写成窄的 `^` 区间会让插件在每次 harness 小版本
  升级后都被判定为 `skipping profile bundle` 而跳过安装。

## 不支持的部分（以及原因）

- **Grok / xAI** —— 额度接口是 gRPC-web 二进制 protobuf，没有公开 schema。
- **Antigravity / Gemini** —— 额度接口要求特定 `User-Agent`，还需要 harness 并不持有的
  Google OAuth 授权。
- **阿里千问 Token Plan、小米 Token Plan** —— 厂商没有公开用量接口，cc-switch 项目
  同样没有实现。
- **Mistral、Groq、纯 `api.x.ai`、OpenCode Zen（按量付费）** —— 没有用量 / 余额接口。

新增一家供应商只要在 `lib/providers.js` 里加一个适配器：声明接口、鉴权头与响应解析方式，
其它地方不用动。

## 开发

```sh
npm test          # 宿主半边单元测试 + 浏览器半边渲染检查
npm run verify    # 同一套检查；prepublishOnly 也会跑
```

| 脚本 | 覆盖什么 |
|---|---|
| `tools/smoke-test.mjs` | 各家响应解析器、供应商注册表、会话日志聚合——不需要 harness |
| `tools/client-check.mjs` | 用最小 DOM / React 替身挂载客户端 bundle 并渲染整页：文案键、两个页签、滚动容器 |

插件**没有构建步骤**。`lib/client.js` 本身就是 DSH 期望的 bundle 格式，改完刷新页面即生效；
改宿主半边需要重启插件（或在插件管理器里关掉再打开）。

### 目录结构

```
package.json        清单：dsh.bundle / dsh.client 声明、版本约束、npm 元信息
cordis.patch.yml    bundle patch：把插件行插进 profile
icon.svg            插件图标
locale/             插件标题与描述（zh / en）
lib/index.js        宿主半边：RPC 路由、供应商路由、凭据解析
lib/providers.js    适配层：供应商识别、请求拼装、响应解析
lib/client.js       浏览器半边：状态栏、两页签整页、会话捕获
tools/              测试脚本（随包发布）
tools/local/        作者自用的本机调试工具（不发布）
```

## 致谢

- 各家用量接口与响应形态的调研参考了 [cc-switch](https://github.com/farion1231/cc-switch)
  —— 主要是 `src-tauri/src/services/coding_plan.rs`、`balance.rs`、`subscription.rs`
  与 `proxy/providers/copilot_auth.rs`。本插件是独立实现，接口知识来自那里。
- harness、插槽系统与会话投影都出自
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 许可

MIT，见 [LICENSE](./LICENSE)。DeepSeek Harness 同样以 MIT 许可发布。本项目为独立社区插件，
与深度求索公司无隶属或背书关系。
