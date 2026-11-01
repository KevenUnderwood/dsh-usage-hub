/**
 * 脱离 DSH 运行时，对宿主半边的纯函数做冒烟测试：
 *  - 各供应商的响应解析器（额度时间窗 / 账户余额）
 *  - 供应商适配器注册表（路由 id → 适配器）
 *  - foldUsage：会话事件 → 按模型聚合 token 用量
 *
 * 运行：node tools/smoke-test.mjs
 */
import {
  foldUsage,
  parseCodingPlanTiers,
  findAdapter,
  findAdapterByBaseUrl,
  listAdapters
} from "../lib/index.js";
import {
  parseClaudeUsage,
  parseCodexUsage,
  parseCopilotUsage,
  parseDeepSeekBalance,
  parseGenericBalance,
  parseKimiUsage,
  parseNewApiQuota,
  parseOpencodeGoTiers,
  parseOpenRouterCredits,
  parseSiliconFlowBalance,
  parseSub2ApiQuota,
  parseZhipuQuota,
  normalizeResetsAt,
  windowSecondsTier,
  RELAY_ADAPTER
} from "../lib/providers.js";

let failures = 0;

/**
 * 断言。
 *
 * @param {string} name - 用例名。
 * @param {unknown} actual - 实际值。
 * @param {unknown} expected - 期望值。
 */
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`
  );
}

/* ---------- parseCodingPlanTiers（MiniMax） ---------- */

const full = {
  base_resp: { status_code: 0, status_msg: "success" },
  model_remains: [
    { model_name: "video", current_interval_remaining_percent: 10 },
    {
      model_name: "general",
      current_interval_remaining_percent: 85.5,
      end_time: 1730000000000,
      current_weekly_status: 1,
      current_weekly_remaining_percent: 40,
      weekly_end_time: 1731000000000
    }
  ]
};

const tiers = parseCodingPlanTiers(full);
check("minimax: 两个时间窗", tiers.length, 2);
check("minimax: 5 小时窗剩余", tiers[0].remainingPercent, 85.5);
check("minimax: 5 小时窗已用", tiers[0].usedPercent, 14.5);
check("minimax: 5 小时窗重置时间", tiers[0].resetsAt, 1730000000000);
check("minimax: 周窗剩余", tiers[1].remainingPercent, 40);
check("minimax: 周窗重置时间", tiers[1].resetsAt, 1731000000000);
check("minimax: 忽略 video 模型", tiers.some((tier) => tier.name === "video"), false);

check(
  "minimax: weekly_status=3（无周限额）不展示周窗",
  parseCodingPlanTiers({
    model_remains: [
      { model_name: "general", current_interval_remaining_percent: 50, current_weekly_status: 3, current_weekly_remaining_percent: 100 }
    ]
  }).length,
  1
);

check(
  "minimax: weekly_status=2（周额度已耗尽）仍展示",
  parseCodingPlanTiers({
    model_remains: [
      { model_name: "general", current_interval_remaining_percent: 50, current_weekly_status: 2, current_weekly_remaining_percent: 0 }
    ]
  })[1].exhausted,
  true
);

check("minimax: 没有 general 就是空", parseCodingPlanTiers({ model_remains: [] }).length, 0);
check("minimax: 非对象返回空", parseCodingPlanTiers(undefined).length, 0);

/* ---------- parseKimiUsage ---------- */

const kimi = parseKimiUsage({
  limits: [{ detail: { limit: 100, remaining: 25, resetTime: "2026-01-02T03:04:05Z" } }],
  usage: { limit: 400, remaining: 100, resetTime: 1767322800 }
});
check("kimi: 两个时间窗", kimi.length, 2);
check("kimi: 5 小时窗剩余百分比", kimi[0].remainingPercent, 25);
check("kimi: 5 小时窗重置时间可解析", typeof kimi[0].resetsAt, "number");
check("kimi: 周窗剩余百分比", kimi[1].remainingPercent, 25);
check("kimi: 秒级时间戳补成毫秒", kimi[1].resetsAt, 1767322800000);

/* ---------- parseZhipuQuota ---------- */

const zhipu = parseZhipuQuota({
  success: true,
  data: {
    limits: [
      { type: "TOKENS_LIMIT", unit: 3, percentage: 30, nextResetTime: 1730000000000 },
      { type: "TOKENS_LIMIT", unit: 6, percentage: 80, nextResetTime: 1731000000000 }
    ]
  }
});
check("zhipu: 两个时间窗", zhipu.length, 2);
check("zhipu: unit=3 → 5 小时窗", zhipu[0].name, "five_hour");
check("zhipu: 已用 30% → 剩余 70%", zhipu[0].remainingPercent, 70);
check("zhipu: unit=6 → 每周窗", zhipu[1].name, "weekly_limit");
check("zhipu: 已用 80% → 剩余 20%", zhipu[1].remainingPercent, 20);
check(
  "zhipu: 非 TOKENS_LIMIT 条目被忽略",
  parseZhipuQuota({ data: { limits: [{ type: "OTHER", unit: 3, percentage: 10 }] } }).length,
  0
);

/* ---------- parseOpencodeGoTiers ---------- */

const go = parseOpencodeGoTiers({
  usage: {
    rolling: { status: "ok", percent: 10, resetsAt: "2026-01-02T03:04:05Z" },
    weekly: { status: "ok", percent: 50, resetsAt: "2026-01-09T03:04:05Z" },
    monthly: { status: "rate-limited", percent: 100 }
  }
});
check("opencode-go: 三个时间窗", go.length, 3);
check("opencode-go: rolling 剩余 90%", go[0].remainingPercent, 90);
check("opencode-go: weekly 剩余 50%", go[1].remainingPercent, 50);
check("opencode-go: monthly 剩余 0%", go[2].remainingPercent, 0);
check("opencode-go: 用量为 0 时丢弃占位重置时间", go[2].resetsAt, null);

/* ---------- parseClaudeUsage ---------- */

const claude = parseClaudeUsage({
  five_hour: { utilization: 20, resets_at: "2026-01-02T03:04:05Z" },
  seven_day: { utilization: 75, resets_at: "2026-01-09T03:04:05Z" },
  limits: [
    {
      kind: "weekly_scoped",
      group: "weekly",
      scope: { model: { display_name: "opus" } },
      percent: 40,
      resets_at: "2026-01-09T03:04:05Z"
    }
  ]
});
// 与 cc-switch 一致：顶层窗口与模型专属周限额各自成条，共 3 条。
check("claude: 三个时间窗", claude.length, 3);
check("claude: 5 小时窗已用 20% → 剩余 80%", claude[0].remainingPercent, 80);
check("claude: 7 天窗已用 75% → 剩余 25%", claude[1].remainingPercent, 25);
check("claude: 模型专属周限额单独成条", claude[2].name, "seven_day_opus");
check("claude: 模型专属周限额剩余 60%", claude[2].remainingPercent, 60);

/* ---------- parseCodexUsage ---------- */

const codex = parseCodexUsage({
  rate_limit: {
    primary_window: { used_percent: 12.5, limit_window_seconds: 18000, reset_at: 1767322800 },
    secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1767927600 }
  },
  credits: { has_credits: true, unlimited: false, balance: "62500" }
});
check("codex: 两个时间窗", codex.tiers.length, 2);
check("codex: 5 小时窗剩余 87.5%", codex.tiers[0].remainingPercent, 87.5);
check("codex: 窗口名映射", codex.tiers[0].name, "five_hour");
check("codex: 7 天窗名映射", codex.tiers[1].name, "seven_day");
check("codex: Credits 余额", codex.balance.remaining, 62500);
check(
  "codex: 无限量时没有余额",
  parseCodexUsage({ credits: { has_credits: true, unlimited: true, balance: "1" } }).balance,
  null
);
check("codex: 窗口秒数映射", windowSecondsTier(2592000), "thirty_day");

/* ---------- parseCopilotUsage ---------- */

const copilot = parseCopilotUsage({
  copilot_plan: "Copilot Pro",
  quota_reset_date: "2026-02-01",
  quota_snapshots: {
    chat: { entitlement: 100, remaining: 100, percent_remaining: 100, unlimited: false },
    completions: { entitlement: 100, remaining: 100, percent_remaining: 100, unlimited: false },
    premium_interactions: { entitlement: 300, remaining: 30, percent_remaining: 10, unlimited: false }
  }
});
check("copilot: 不重复报时间窗", copilot.tiers.length, 0);
check("copilot: 一个余额条目", copilot.balances.length, 1);
check("copilot: 剩余额度", copilot.balances[0].remaining, 30);
check("copilot: 总额度", copilot.balances[0].total, 300);
check("copilot: 已用额度", copilot.balances[0].used, 270);
check("copilot: 备注含套餐名", copilot.note.includes("Copilot Pro"), true);
check(
  "copilot: 只有百分比时退回时间窗",
  parseCopilotUsage({ quota_snapshots: { premium_interactions: { percent_remaining: 10 } } }).tiers.length,
  1
);

/* ---------- 余额解析器 ---------- */

const ds = parseDeepSeekBalance({
  balance_infos: [
    { currency: "CNY", total_balance: "0.00" },
    { currency: "USD", total_balance: "12.34" }
  ]
});
check("deepseek: 空钱包被隐藏", ds.length, 1);
check("deepseek: 币种", ds[0].unit, "USD");
check("deepseek: 余额", ds[0].remaining, 12.34);

const or = parseOpenRouterCredits({ data: { total_credits: 100, total_usage: 25.5 } });
check("openrouter: 剩余额度", or[0].remaining, 74.5);
check("openrouter: 总额度", or[0].total, 100);
check("openrouter: 已用额度", or[0].used, 25.5);

check("siliconflow: 总额度", parseSiliconFlowBalance({ data: { totalBalance: "8.5" } }, true)[0].remaining, 8.5);
check("siliconflow: 国内站币种", parseSiliconFlowBalance({ data: { totalBalance: 1 } }, true)[0].unit, "CNY");
check("siliconflow: 国际站币种", parseSiliconFlowBalance({ data: { totalBalance: 1 } }, false)[0].unit, "USD");

check("newapi: 剩余额度换算成美元", parseNewApiQuota({ data: { quota: 500000, used_quota: 250000 } }).remaining, 1);
check("newapi: 已用额度", parseNewApiQuota({ data: { quota: 500000, used_quota: 250000 } }).used, 0.5);
check("sub2api: 剩余额度", parseSub2ApiQuota({ quota: { limit: 100, used: 30, unit: "USD" } }).remaining, 70);
check("通用余额: 识别 balance", parseGenericBalance({ balance: 12 }).remaining, 12);
check("通用余额: 认不出就是 null", parseGenericBalance({ nothing: 1 }), null);

/* ---------- normalizeResetsAt ---------- */

check("重置时间: ISO 字符串", normalizeResetsAt("2026-01-02T03:04:05Z"), Date.parse("2026-01-02T03:04:05Z"));
check("重置时间: 秒级时间戳", normalizeResetsAt(1767322800), 1767322800000);
check("重置时间: 毫秒级时间戳", normalizeResetsAt(1767322800000), 1767322800000);
check("重置时间: 非正数视为没有", normalizeResetsAt(-1), null);

/* ---------- 适配器注册表 ---------- */

check("适配器: 按路由 id 命中 minimax-cn", findAdapter("minimax-cn")?.id, "minimax-cn");
check("适配器: 别名命中 deepseek", findAdapter("deepseek")?.id, "deepseek-official");
check("适配器: 别名命中 zai", findAdapter("zai")?.id, "zai-coding-cn");
check("适配器: 未知路由返回 undefined", findAdapter("not-a-provider"), undefined);
check("适配器: 按 base URL 命中 DeepSeek", findAdapterByBaseUrl("https://api.deepseek.com/v1")?.id, "deepseek-official");
check("适配器: 按 base URL 命中 MiniMax", findAdapterByBaseUrl("https://api.minimaxi.com/v1")?.id, "minimax-cn");
check("适配器: 认不出的地址不命中", findAdapterByBaseUrl("https://relay.example.com/v1"), undefined);
check("适配器: 清单非空", listAdapters().length > 5, true);
check(
  "适配器: 每个适配器都有 id / label / family",
  listAdapters().every((adapter) => typeof adapter.id === "string" && typeof adapter.label === "string" && (adapter.family === "tiers" || adapter.family === "balance")),
  true
);
check(
  "适配器: DSH 自带路由都在清单里",
  listAdapters().some((adapter) => adapter.id === "deepseek-official") &&
    listAdapters().some((adapter) => adapter.id === "deepseek-account"),
  true
);

/* ---------- 通用中转站适配器 ---------- */

/**
 * 临时替换全局 fetch。
 *
 * @param {(url: string) => {status: number, body: unknown}} handler - 按 URL 应答。
 * @returns {() => void} 还原函数。
 */
function withFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const { status, body } = handler(String(url));
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
  return () => {
    globalThis.fetch = original;
  };
}

const restore = withFetch((url) => {
  if (url.endsWith("/api/user/self")) {
    return { status: 200, body: { data: { quota: 500000, used_quota: 125000 } } };
  }
  return { status: 404, body: undefined };
});
const relayResult = await RELAY_ADAPTER.query({
  credential: "k",
  baseUrl: "https://relay.example.com/v1",
  timeoutMs: 5000
});
restore();
check("中转站: 命中 new-api 的 /api/user/self", relayResult.balances?.[0]?.remaining, 1);
check("中转站: 已用额度", relayResult.balances?.[0]?.used, 0.25);

const restore2 = withFetch((url) => {
  if (url.endsWith("/v1/usage")) {
    return { status: 200, body: { quota: { limit: 50, used: 20, unit: "USD" } } };
  }
  return { status: 404, body: undefined };
});
const relayResult2 = await RELAY_ADAPTER.query({
  credential: "k",
  baseUrl: "https://relay.example.com/v1",
  timeoutMs: 5000
});
restore2();
check("中转站: 回落到 sub2api 的 /v1/usage", relayResult2.balances?.[0]?.remaining, 30);

const relayNoUrl = await RELAY_ADAPTER.query({ credential: "k", baseUrl: undefined, timeoutMs: 5000 });
check("中转站: 没有端点地址时报错", typeof relayNoUrl.error, "string");

/* ---------- DeepSeek 账号适配器 ---------- */

const accountAdapter = findAdapter("deepseek-account");
const accountResult = await accountAdapter.query({
  ctx: {
    get: (name) =>
      name === "deepseekAccount"
        ? {
            getBalance: async () => ({
              status: "ready",
              value: [{ currency: "CNY", balance: "18.42" }]
            })
          }
        : undefined
  }
});
check("deepseek 账号: 余额", accountResult.balances?.[0]?.remaining, 18.42);
check("deepseek 账号: 币种", accountResult.balances?.[0]?.unit, "CNY");

const accountSignedOut = await accountAdapter.query({
  ctx: { get: (name) => (name === "deepseekAccount" ? { getBalance: async () => null } : undefined) }
});
check("deepseek 账号: 未登录时报错", typeof accountSignedOut.error, "string");

/* ---------- foldUsage ---------- */

const events = [
  { type: "request/header", data: { header: { provider: "minimax-cn", model: "MiniMax-M3.1-Flash" } } },
  { type: "assistant/message", data: { usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50 } } },
  { type: "assistant/message", data: { usage: { inputTokens: 500, outputTokens: 100 } } },
  { type: "request/header", data: { header: { provider: "minimax-cn", model: "MiniMax-M2.1" } } },
  { type: "assistant/message", data: { usage: { inputTokens: 2000, outputTokens: 300, cacheWriteTokens: 20 } } },
  { type: "assistant/message", data: {} }
];

const folded = foldUsage(events);
check("usage: 总量", folded.totals.totalTokens, 1000 + 200 + 50 + 500 + 100 + 2000 + 300 + 20);
check("usage: 请求数", folded.totals.requests, 3);
check("usage: 按模型分两类", folded.byModel.size, 2);
check("usage: 第一个模型的 token", folded.byModel.get("MiniMax-M3.1-Flash").totalTokens, 1000 + 200 + 50 + 500 + 100);
check("usage: 第二个模型的 token", folded.byModel.get("MiniMax-M2.1").totalTokens, 2000 + 300 + 20);
check("usage: 缓存读计入合计", folded.byModel.get("MiniMax-M3.1-Flash").cacheReadTokens, 50);
check("usage: 没有用量的事件不计请求数", folded.byModel.get("MiniMax-M2.1").requests, 1);
check("usage: 空事件列表", foldUsage([]).totals.totalTokens, 0);
check(
  "usage: 没有请求头时归到 unknown",
  foldUsage([{ type: "assistant/message", data: { usage: { inputTokens: 5, outputTokens: 5 } } }]).byModel.has("unknown"),
  true
);

// 流式用量：assistant/attempt 的 stream 里带 usage，最终 assistant/message 结算时只算一次。
const streamed = foldUsage([
  { type: "request/header", data: { header: { model: "M" } } },
  { type: "assistant/attempt", data: { stream: [{ type: "text" }, { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } }] } },
  { type: "assistant/message", data: { usage: { inputTokens: 10, outputTokens: 2 } } }
]);
check("usage: 流式用量只算一次", streamed.totals.totalTokens, 12);
check("usage: 流式用量也算一次请求", streamed.totals.requests, 1);

// 尝试里有流式用量但最终消息没有 usage 时，仍应计入。
const streamedOnly = foldUsage([
  { type: "request/header", data: { header: { model: "M" } } },
  { type: "assistant/attempt", data: { stream: [{ usage: { inputTokens: 7, outputTokens: 3 } }] } },
  { type: "assistant/message", data: {} }
]);
check("usage: 只有流式用量也计入", streamedOnly.totals.totalTokens, 10);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 个用例失败`);
process.exit(failures === 0 ? 0 : 1);
