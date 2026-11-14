<p align="right">
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<div align="center">

# dsh-usage-hub

**Usage & quota for every provider your session runs on.**

[![npm](https://img.shields.io/npm/v/dsh-usage-hub)](https://www.npmjs.com/package/dsh-usage-hub)
[![npm downloads](https://img.shields.io/npm/dm/dsh-usage-hub)](https://www.npmjs.com/package/dsh-usage-hub)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![DeepSeek Harness plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows the
**quota windows, credit balance and token usage** of the provider account behind the model your
conversation is running on — and switches to another provider the moment you switch models.

</div>

---

## What it does

Switch models in DSH, and the usage panel follows: the query target comes from the session's
`modelSelection` projection, so a model switch *is* a target switch. No configuration, no
"select which account to query" dropdown to get wrong.

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

The provider directory lives on **its own tab**, so it never gets mixed into the usage numbers:

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

## Features

- **Follows the session model.** The browser reads `next ?? lastUsed` from the session's
  `modelSelection` projection and re-queries with the new provider. Switching models switches
  the query target.
- **Per-provider adapters.** Each provider declares its own usage endpoint, its auth-header
  format and how to read its response. Fourteen providers ship out of the box, plus a generic
  adapter for self-hosted OpenAI-compatible gateways.
- **Quota windows as meters.** Every window gets a progress bar, coloured by how much is left
  (green ≥ 40 %, amber ≥ 15 %, red below), with the used percentage and the reset time.
- **Credential state, not credential values.** The provider tab shows which credential
  *reference* each provider uses and whether it resolves — never the key itself.
- **Cross-session token totals** aggregated by model, replayed from the session log.
- **Its own settings page.** The Usage page carries a gear button in its header; clicking it opens
  this plugin's settings, which are written straight back to the plugin's profile row — no YAML
  editing, no restart.
- **Configurable refresh interval.** Pick 5 seconds / 60 seconds / 10 minutes / 30 minutes /
  1 hour in the settings; the change takes effect at once.
- **A clean status bar.** The bar at the bottom of the window shows quota and usage only — no
  refresh button; turn "Show quick refresh button" on in the settings if you want it back.
- **The token count in the status bar can be spelled out.** Compact `120.0K tokens` or the full
  `120,000 tokens`.
- **Bilingual UI** (中文 / English), following the harness language.
- **Zero runtime dependencies.** The host half uses Node built-ins only; `schemastery` is an
  optional peer used solely for the config schema, and the plugin loads without it.

## Install

Requires an existing DeepSeek Harness installation (with the Web surface) and Node.js ≥ 20.

```sh
# npm (recommended)
dsh plugin --profile web add dsh-usage-hub

# or from GitHub
dsh plugin --profile web add github:KevenUnderwood/dsh-usage-hub

# or from a local checkout
dsh plugin --profile web add ./dsh-usage-hub
```

Restart `dsh web` (or the desktop app) afterwards and reload the page.

> **Install the tarball, not a linked checkout that carries its own `node_modules`.** Such a
> checkout shadows the harness's shared `@deepseek-ai/cordis` instance, and the host half then
> never registers — the browser gets a 404 on every request. This plugin has no runtime
> dependencies, so a plain checkout (with no `npm install` inside it) is fine; if you did
> install dependencies in the checkout, remove that `node_modules` or install the packed
> tarball instead:
>
> ```sh
> npm pack && dsh plugin --profile web add ./dsh-usage-hub-0.2.0.tgz
> ```

The desktop app keeps its own profile (`~/.dsh/profiles/desktop`); install the plugin there
too if you use the desktop window.

## Supported providers

The provider is recognised by its **DSH provider route** first, then by its **base URL**, and
finally — if the route has a `baseURL` but matches nothing known — by the generic relay adapter.

| Route | Reported as | Endpoint | Shows |
|---|---|---|---|
| `deepseek-official`, `deepseek` | balance | `GET https://api.deepseek.com/user/balance` | balance per currency |
| `deepseek-account` | balance | `ctx.deepseekAccount.getBalance()` | wallet balances of the signed-in account, no API key needed |
| `anthropic` | quota windows | `GET https://api.anthropic.com/api/oauth/usage` | 5-hour, 7-day and per-model weekly windows |
| `openai-codex` | quota windows + credits | `GET https://chatgpt.com/backend-api/wham/usage` | 5-hour / weekly windows, Codex credits |
| `kimi-coding` | quota windows | `GET https://api.kimi.com/coding/v1/usages` | 5-hour and weekly windows |
| `zai-coding-cn`, `zai` | quota windows | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | 5-hour and weekly windows; falls back to the account balance for pay-as-you-go accounts |
| `minimax-cn`, `minimax` | quota windows | `GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains` | 5-hour and weekly windows |
| `opencode-go` | quota windows | `GET https://opencode.ai/zen/go/v1/usage` | rolling, weekly and monthly windows |
| `github-copilot` | quota | `GET https://api.github.com/copilot_internal/user` | premium-interaction allowance |
| `openrouter` | balance | `GET https://openrouter.ai/api/v1/credits` | credits used / total |
| `moonshotai-cn`, `moonshotai` | balance | `GET https://api.moonshot.cn/v1/users/me/balance` | available balance |
| `siliconflow` | balance | `GET https://api.siliconflow.cn/v1/user/info` | total balance |
| `novita` | balance | `GET https://api.novita.ai/v3/user/balance` | available balance |
| `stepfun` | balance | `GET https://api.stepfun.com/v1/accounts` | account balance |
| *any other route with a `baseURL`* | balance | `/api/user/self`, `/v1/usage`, `/api/usage`, `/user/balance` (tried in turn) | New API / one-api, sub2api and plain-balance relays |

### Credential references

The plugin asks the harness for the key the route already uses, so most providers need **no
configuration at all**. The reference names it looks for:

| Route | Credential reference |
|---|---|
| `deepseek-official` | `DEEPSEEK_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN` |
| `openai-codex` | `OPENAI_CODEX_ACCESS_TOKEN`, `CHATGPT_ACCESS_TOKEN`, `CODEX_ACCESS_TOKEN` |
| `kimi-coding` | `KIMI_API_KEY`, `KIMI_CODING_API_KEY` |
| `zai-coding-cn`, `zai` | `ZAI_CODING_CN_API_KEY`, `ZAI_API_KEY`, `ZHIPU_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY`, `MINIMAX_API_KEY` |
| `opencode-go` | `OPENCODE_API_KEY` |
| `github-copilot` | `COPILOT_GITHUB_TOKEN`, `GITHUB_TOKEN` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `moonshotai-cn`, `moonshotai` | `MOONSHOT_API_KEY` |
| `siliconflow` | `SILICONFLOW_API_KEY` |
| `novita` | `NOVITA_API_KEY` |
| `stepfun` | `STEPFUN_API_KEY` |

The reference a route actually uses comes from the provider's own profile (`apiKeyEnv` in
`dsh-llm-pi-ai`'s `providers.<route>`), so a route configured with a custom reference name is
honoured too. A reference is resolved on every query: add a key in **Settings → Models** and
the next query uses it, without a restart.

### Providers that need more than an API key

Three endpoints do **not** accept a plain API key:

- **Claude** (`anthropic`) — `/api/oauth/usage` wants an **OAuth access token**, not an
  `ANTHROPIC_API_KEY`. With an API key the query returns 401.
- **ChatGPT / Codex** (`openai-codex`) — `wham/usage` wants the **OAuth access token** of a
  ChatGPT subscription.
- **GitHub Copilot** (`github-copilot`) — `copilot_internal/user` wants a **GitHub OAuth
  token** (`Authorization: token …`, not `Bearer …`).

The plugin reports the upstream error verbatim in those cases, so a 401 always means "wrong
credential kind", not "plugin bug".

## Configuration

Everything works out of the box. **The settings live behind the gear button** in the Usage
page's header: the page edits the plugin's own profile row
(`~/.dsh/profiles/<profile>/cordis.patch.yml`, the `config:` of the `id: usage-hub` entry), so
there is no YAML to write by hand and no restart to perform — the field is marked volatile on
the host side, which means the plugin receives it as a live reference and sees the new value
immediately.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `refreshIntervalMs` | `number` | `600000` | Auto refresh interval (ms); only five steps are accepted — `5000` / `60000` / `600000` / `1800000` / `3600000` |
| `showQuickRefresh` | `boolean` | `false` | Whether the status bar at the bottom of the window carries a quick refresh button |
| `tokenDisplay` | `string` | `compact` | How the current session's token count is written in the status bar: `compact` (`120.0K tokens`) or `full` (`120,000 tokens`) |

Those are the only three settings. Everything else is fixed: the cross-session aggregation replays at
most 50 sessions, the aggregated totals are cached for 30 seconds, and a usage query times
out after 15 seconds.

Without the Web settings service (a host-only deployment), the plugin still works; the values
then have to be written by hand, by **overriding the bundle's row by id** (the package's own
bundle patch already inserts it; a second `insert` of the same id fails the boot with
`duplicate loader entry id`):

```yaml
- id: usage-hub
  name: dsh-usage-hub
  config:
    refreshIntervalMs: 600000
    showQuickRefresh: false
    tokenDisplay: compact
```

## How it works

```
browser                                   host
──────                                   ────
session.projections "modelSelection" ──▶  resolve the provider route
                                             │
                                             ├─ route id  → adapter
                                             ├─ base URL  → adapter
                                             └─ otherwise → relay adapter
                                                   │
                                        ctx.credentials.resolve(ref)
                                                   │
                                        GET the provider's usage endpoint
                                                   │
                              { tiers: [...], balances: [...] } ──▶ progress bars
```

**Host half** (`lib/index.js`, `lib/providers.js`) registers one prefix route on the
`webServer` service and serves three endpoints over the Connection RPC envelope:

| Endpoint | Answers |
|---|---|
| `quota` | quota windows / balances for the current provider (or the one named in the payload) |
| `providers` | the provider directory: label, credential reference, credential state |
| `usage` | cross-session token totals, aggregated by model |

The route is registered on the `webServer` service directly rather than through
`ctx.connection.rpc.handle()`, because on newer DSH releases the latter is not available to
third-party plugins: its disposal callback reads `owner.webServer`, which resolves to
Connection's own fiber and never has a `webServer` — the channel then vanishes silently, with
a quiet startup log. The plugin performs the Host/Origin and browser-session trust check itself
with `ctx.connection.admit(req)`.

**Client half** (`lib/client.js`) is a plain `window.__ModuleLoader__.load({ id, factory })`
bundle. It registers four slots:

| Slot | Shows |
|---|---|
| `shell.bottom` | the current provider's summary and this session's token total |
| `main` | the two-tab page (panel id `usage-hub`) |
| `main` | the settings page (panel id `usage-hub-settings`, reachable from the gear only, not in the sidebar) |
| `conversation.session.header.utilities` | captures the `tokenUsage` and `modelSelection` projections |

The page is its own scroll container: DSH's centre column is `overflow: hidden`, so a main
panel has to provide the scrolling itself.

The settings page talks to DSH's configuration form service: the browser reads and writes the
plugin's own Config through `ctx.configForms.get("usage-hub")` (`ctx.configForms` is an
**optional** service — without it the page says so instead of failing). On the host side the
six fields are marked `.volatile()`, because DSH only turns volatile fields into editable
forms, and because such fields reach the plugin as live references: the host swaps the value
in place, so the plugin sees the change without being remounted.

## Security

- Credential **values** are resolved inside the host process and never leave it. Responses
  carry normalized numbers plus the credential *reference name*.
- Every request is admitted through `ctx.connection.admit(req)`, so the browser session and
  the Host/Origin check are enforced before anything is answered.
- The plugin uploads nothing. Usage requests go from the host straight to the provider API.
- The diagnostic log is off by default and never contains credential values.

## Compatibility

- DeepSeek Harness `>=0.2.1-rc.1` with the Web surface; Node.js `>=20`.
- The plugin uses DSH internals — the slot system, the `tokenUsage` and `modelSelection`
  session projections, `ctx.agentDefaultModel`, `ctx.llm.listConfigurableProviders()`,
  `ctx.configEditor.configuration()`, `ctx.credentials` and the Connection RPC envelope.
  These are not a public API and may change between harness releases.
- Every optional service is resolved through `ctx.get()` when it is used, so the plugin still
  mounts where one of them is absent or activates later. `webServer` and `connection` are the
  only hard dependencies.
- `engines.dsh` declares an open lower bound on purpose: a narrow `^` range would make the
  plugin get skipped as `skipping profile bundle` on every harness minor release.

## Not supported (and why)

- **Grok / xAI** — the credits endpoint is a gRPC-web protobuf binary with no public schema.
- **Antigravity / Gemini** — the quota endpoint requires a specific `User-Agent` and a Google
  OAuth grant the harness does not hold.
- **Alibaba Qwen Token Plan, Xiaomi Token Plan** — no public usage endpoint; the vendors have
  not documented one, and the cc-switch project does not implement one either.
- **Mistral, Groq, plain `api.x.ai`, OpenCode Zen (pay-as-you-go)** — no usage or balance API.

Adding a provider means adding one adapter to `lib/providers.js`: declare the endpoint, the
auth header and how to read the response. Nothing else changes.

## Development

```sh
npm test          # host-side unit tests + client-side render checks
npm run verify    # the same suite; also runs from prepublishOnly
```

| Script | What it covers |
|---|---|
| `tools/smoke-test.mjs` | every response parser, the provider registry and the session-log aggregation — no harness needed |
| `tools/client-check.mjs` | mounts the client bundle in a minimal DOM/React stand-in and renders the page: locale keys, the two tabs, the scroll container |

The plugin has **no build step**. `lib/client.js` already is the bundle format DSH expects,
so a change shows up after a page reload. A host-side change needs the plugin restarted (or
toggled off and on in the plugin manager).

### Layout

```
package.json        manifest: dsh.bundle / dsh.client declarations, engines, npm metadata
cordis.patch.yml    bundle patch: inserts the plugin row into a profile
icon.svg            plugin icon
locale/             plugin title and description (zh / en)
lib/index.js        host half: the RPC route, provider routing, credential resolution
lib/providers.js    adapters: provider recognition, request building, response parsing
lib/client.js       client half: status bar, the two-tab page, session capture
tools/              the test scripts (published)
tools/local/        the author's private debugging tools (not published)
```

## Credits

- The provider endpoints and their response shapes were researched against
  [cc-switch](https://github.com/farion1231/cc-switch) — in particular
  `src-tauri/src/services/coding_plan.rs`, `balance.rs`, `subscription.rs` and
  `proxy/providers/copilot_auth.rs`. This plugin is an independent implementation; the
  interface knowledge comes from there.
- The harness, its slot system and its session projections are the work of
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## License

MIT — see [LICENSE](./LICENSE). DeepSeek Harness is MIT-licensed as well. This is an
independent community plugin and is not affiliated with or endorsed by DeepSeek.
