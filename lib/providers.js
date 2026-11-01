/**
 * `dsh-usage-hub` —— 多供应商用量适配层。
 *
 * 这里放的是**纯逻辑**：供应商识别、请求拼装、响应解析。宿主半边
 * （`lib/index.js`）负责凭据解析与路由分发，浏览器半边（`lib/client.js`）
 * 负责呈现。
 *
 * 设计沿用 cc-switch 的做法（`src-tauri/src/services/coding_plan.rs`、
 * `balance.rs`、`subscription.rs`）：每个供应商一个适配器，声明
 *  - 用量接口的完整 URL 与鉴权头写法；
 *  - 响应里「哪个字段代表哪个时间窗/余额」；
 *  - 把响应折叠成统一的两种形状：
 *      - `tiers`   —— 百分比时间窗（5 小时 / 每周 / 每月…）
 *      - `balances`—— 账户余额（金额 + 币种）
 *
 * 供应商 id 用的是 **DSH 的供应商路由 id**（`ctx.llm` 的 provider route），
 * 不是 cc-switch 的供应商 id：DSH 自带 `deepseek-official` /
 * `deepseek-account` 两条路由，其余走 pi-ai 适配器的路由（`anthropic`、
 * `openai-codex`、`minimax-cn`、`kimi-coding`…）。
 */

/* ------------------------------------------------------------------ *
 * 通用工具
 * ------------------------------------------------------------------ */

/**
 * 把任意值解析成有限数字，缺失或非法时为 undefined。
 *
 * @param {unknown} value - 原值。
 * @returns {number | undefined} 数值。
 */
export function optionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * 把任意值解析成有限数字，缺失或非法时为 0。
 *
 * @param {unknown} value - 原值。
 * @returns {number} 数值。
 */
export function numberOf(value) {
  const parsed = optionalNumber(value);
  return parsed === undefined ? 0 : parsed;
}

/**
 * 取一个数值，缺失时为 null。
 *
 * @param {unknown} value - 原值。
 * @returns {number | null} 数值。
 */
export function numberOrNull(value) {
  const parsed = optionalNumber(value);
  return parsed === undefined ? null : parsed;
}

/**
 * 把上游给的重置时间归一成毫秒时间戳。
 *
 * 上游格式很杂：ISO 字符串、秒级时间戳、毫秒级时间戳都有。
 *
 * @param {unknown} value - 原值。
 * @returns {number | null} 毫秒时间戳。
 */
export function normalizeResetsAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    // 秒级时间戳 < 1e12，毫秒级 >= 1e12。
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return normalizeResetsAt(Number(trimmed));
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * 从响应体里取一条可读的错误信息。
 *
 * @param {unknown} body - 解析后的响应体。
 * @returns {string | undefined} 错误文本。
 */
export function errorMessage(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  const error = body.error ?? body;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.msg === "string") return error.msg;
    if (typeof error.status_msg === "string") return error.status_msg;
  }
  return undefined;
}

/**
 * 请求上游接口并解析 JSON。
 *
 * 瞬时传输失败（网络不可达 / 超时）直接抛出，由调用方归为可重试错误；
 * HTTP 层面的确定性失败（401 / 404 / 500）以返回值交给调用方判定，
 * 免得把「上游说不行」当成「网络抖动」。
 *
 * @param {string} url - 完整 URL。
 * @param {object} [options] - 请求选项。
 * @param {string} [options.method] - HTTP 方法。
 * @param {Record<string, string>} [options.headers] - 请求头。
 * @param {string} [options.body] - 请求体。
 * @param {number} [options.timeoutMs] - 超时（毫秒）。
 * @returns {Promise<{ok: boolean, status: number, body: unknown, text: string}>} 响应。
 */
export async function requestJson(url, options = {}) {
  const { method = "GET", headers = {}, body, timeoutMs = 15000 } = options;
  const response = await fetch(url, {
    method,
    headers: { accept: "application/json", ...headers },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { ok: response.ok, status: response.status, body: parsed, text };
}

/* ------------------------------------------------------------------ *
 * 统一结果形状
 * ------------------------------------------------------------------ */

/**
 * 构造一个时间窗。
 *
 * @param {string} name - 窗口标识（five_hour / weekly_limit / …）。
 * @param {number} remainingPercent - 剩余百分比（0-100）。
 * @param {number | null} [resetsAt] - 重置时间（毫秒时间戳）。
 * @param {object} [extra] - 附加字段。
 * @returns {object} 时间窗。
 */
function tier(name, remainingPercent, resetsAt = null, extra = {}) {
  const used = Math.max(0, Math.min(100, 100 - remainingPercent));
  return {
    name,
    remainingPercent,
    usedPercent: used,
    resetsAt,
    exhausted: remainingPercent <= 0,
    ...extra
  };
}

/**
 * 构造一个余额条目。
 *
 * @param {string} name - 标识。
 * @param {number | null} remaining - 剩余金额。
 * @param {object} [extra] - 附加字段（total / used / unit）。
 * @returns {object} 余额条目。
 */
function balance(name, remaining, extra = {}) {
  return { name, remaining, total: null, used: null, unit: "", ...extra };
}

/* ------------------------------------------------------------------ *
 * 解析器：百分比时间窗
 * ------------------------------------------------------------------ */

/**
 * 解析 MiniMax 编程套餐余量（`/coding_plan/remains`）。
 *
 * 语义与 cc-switch 一致：
 *  - `model_remains[]` 里 `model_name === "general"` 才是编程套餐；
 *  - `current_interval_remaining_percent` 是 5 小时窗的**剩余**百分比；
 *  - 周窗用 `current_weekly_status` 区分：1 正常计时、2 周额度已耗尽（照常展示）、
 *    3 该套餐无周限额（跳过）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 各时间窗的余量。
 */
export function parseCodingPlanTiers(body) {
  const tiers = [];
  const modelRemains = Array.isArray(body?.model_remains) ? body.model_remains : [];
  const item = modelRemains.find((entry) => entry?.model_name === "general");
  if (item === undefined) return tiers;

  const interval = optionalNumber(item.current_interval_remaining_percent);
  if (interval !== undefined) {
    tiers.push(tier("five_hour", interval, numberOrNull(item.end_time)));
  }

  const weeklyStatus = optionalNumber(item.current_weekly_status);
  if (weeklyStatus === 1 || weeklyStatus === 2) {
    const weekly = optionalNumber(item.current_weekly_remaining_percent);
    if (weekly !== undefined) {
      tiers.push(
        tier("weekly_limit", weekly, numberOrNull(item.weekly_end_time), {
          exhausted: weeklyStatus === 2 || weekly <= 0
        })
      );
    }
  }

  return tiers;
}

/**
 * 解析 Kimi For Coding 用量（`/coding_plan/v1/usages`）。
 *
 *  - `limits[].detail` 是 5 小时滚动窗（`limit` / `remaining` / `resetTime`）；
 *  - `usage` 是周限额窗。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 各时间窗的余量。
 */
export function parseKimiUsage(body) {
  const tiers = [];
  const limits = Array.isArray(body?.limits) ? body.limits : [];
  for (const limitItem of limits) {
    const detail = limitItem?.detail;
    if (detail === undefined || detail === null) continue;
    const limit = optionalNumber(detail.limit) ?? 1;
    const remaining = optionalNumber(detail.remaining) ?? 0;
    if (limit <= 0) continue;
    tiers.push(tier("five_hour", (remaining / limit) * 100, normalizeResetsAt(detail.resetTime)));
  }
  const usage = body?.usage;
  if (usage !== undefined && usage !== null) {
    const limit = optionalNumber(usage.limit) ?? 1;
    const remaining = optionalNumber(usage.remaining) ?? 0;
    if (limit > 0) {
      tiers.push(tier("weekly_limit", (remaining / limit) * 100, normalizeResetsAt(usage.resetTime)));
    }
  }
  return tiers;
}

/**
 * 智谱 GLM 的 TOKENS_LIMIT 条目按 `unit` 字段的显式窗口分类。
 *
 * - `unit: 3` → 5 小时滚动窗
 * - `unit: 6` → 每周窗口
 *
 * `unit` 缺失或不认识时返回 undefined，由调用方走重置时间启发式兜底。
 *
 * @param {unknown} item - `limits[]` 里的一条。
 * @returns {"five_hour" | "weekly_limit" | undefined} 窗口名。
 */
export function classifyZhipuWindow(item) {
  const unit = optionalNumber(item?.unit);
  if (unit === 3) return "five_hour";
  if (unit === 6) return "weekly_limit";
  return undefined;
}

/**
 * 解析智谱额度响应体（`/api/monitor/usage/quota/limit`）。
 *
 * 分类优先级：
 *  1. 显式 `unit` 字段（不能按 `nextResetTime` 排序代替——周期末尾每周窗口
 *     会比 5 小时窗口更早重置，按时间排序必然把两桶标反）；
 *  2. 兜底启发式：无 `nextResetTime` 的条目优先归 five_hour，其余按 reset 升序。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 各时间窗的余量。
 */
export function parseZhipuQuota(body) {
  const tiers = [];
  const data = body?.data;
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  let fiveHour;
  let weekly;
  const unclassified = [];

  for (const limitItem of limits) {
    const type = typeof limitItem?.type === "string" ? limitItem.type : "";
    if (!/^(TOKENS_LIMIT|CREDIT_LIMIT)$/i.test(type)) continue;
    const percentage = optionalNumber(limitItem.percentage) ?? 0;
    const resetsAt = normalizeResetsAt(limitItem.nextResetTime);
    const entry = { percentage, resetsAt };
    const window = classifyZhipuWindow(limitItem);
    if (window === "five_hour" && fiveHour === undefined) fiveHour = entry;
    else if (window === "weekly_limit" && weekly === undefined) weekly = entry;
    else unclassified.push(entry);
  }

  unclassified.sort((left, right) => {
    if (left.resetsAt === null && right.resetsAt === null) return 0;
    if (left.resetsAt === null) return -1;
    if (right.resetsAt === null) return 1;
    return left.resetsAt - right.resetsAt;
  });
  for (const entry of unclassified) {
    if (fiveHour === undefined) fiveHour = entry;
    else if (weekly === undefined) weekly = entry;
  }

  if (fiveHour !== undefined) {
    tiers.push(tier("five_hour", 100 - fiveHour.percentage, fiveHour.resetsAt));
  }
  if (weekly !== undefined) {
    tiers.push(tier("weekly_limit", 100 - weekly.percentage, weekly.resetsAt));
  }
  return tiers;
}

/**
 * 查智谱的账户余额（按量付费账户没有 Coding Plan 时的回落）。
 *
 * `GET {host}/api/biz/account/query-customer-account-report`，鉴权同样是裸 Key
 * （不加 Bearer）。国内站人民币，国际站美元。
 *
 * @param {string} host - `open.bigmodel.cn` 或 `api.z.ai`。
 * @param {string} credential - API Key。
 * @param {number} [timeoutMs] - 超时（毫秒）。
 * @returns {Promise<object>} 查询结果。
 */
async function queryZhipuBalance(host, credential, timeoutMs) {
  const response = await requestJson(`https://${host}/api/biz/account/query-customer-account-report`, {
    headers: { authorization: credential, "accept-language": "en-US,en" },
    timeoutMs
  });
  if (response.status === 401 || response.status === 403) {
    return { error: `凭据被拒绝（HTTP ${response.status}）：${errorMessage(response.body) ?? ""}` };
  }
  if (!response.ok) {
    return { error: `上游返回 HTTP ${response.status}：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
  }
  const body = response.body;
  if (body?.success === false) {
    return { error: `智谱返回业务错误：${typeof body?.msg === "string" ? body.msg : "未知错误"}` };
  }
  const data = body?.data !== null && typeof body?.data === "object" ? body.data : body;
  const available = optionalNumber(data?.availableBalance) ?? optionalNumber(data?.balance);
  if (available === undefined) return { error: "智谱余额字段缺失。" };
  return {
    balances: [
      {
        name: "balance",
        remaining: available,
        total: numberOrNull(data?.balance),
        used: numberOrNull(data?.totalSpendAmount),
        unit: host === "open.bigmodel.cn" ? "CNY" : "USD"
      }
    ],
    note: "按量付费（无 Coding Plan）"
  };
}

/**
 * 解析 OpenCode Go 用量（`/zen/go/v1/usage`）。
 *
 * 响应形态：`{"usage":{"rolling"|"weekly"|"monthly":{"status","percent","resetsAt"}}}`，
 * `percent` 是**已用**整数百分比。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 各时间窗的余量。
 */
export function parseOpencodeGoTiers(body) {
  const windows = [
    ["rolling", "five_hour"],
    ["weekly", "weekly_limit"],
    ["monthly", "monthly"]
  ];
  const usage = body?.usage;
  if (usage === undefined || usage === null) return [];
  const tiers = [];
  for (const [key, name] of windows) {
    const window = usage[key];
    if (window === undefined || window === null) continue;
    const used = optionalNumber(window.percent);
    if (used === undefined) continue;
    // percent 为 0 时上游的 resetsAt 是「now + 窗口时长」的占位值，丢弃。
    const resetsAt = used > 0 ? normalizeResetsAt(window.resetsAt) : null;
    tiers.push(tier(name, 100 - used, resetsAt));
  }
  return tiers;
}

/**
 * 解析 Claude 官方订阅额度（`/api/oauth/usage`）。
 *
 *  - 顶层窗口：`{ five_hour, seven_day, … }`，每项 `{ utilization, resets_at }`，
 *    `utilization` 是**已用**百分比；
 *  - `limits[]` 里 `kind === "weekly_scoped"` 的模型专属周限额用 `percent`。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 各时间窗的余量。
 */
export function parseClaudeUsage(body) {
  if (body === undefined || body === null || typeof body !== "object") return [];
  const tiers = [];
  const known = new Set(["extra_usage", "limits"]);
  const modelTiers = new Map();

  const limits = Array.isArray(body.limits) ? body.limits : [];
  for (const limit of limits) {
    if (limit?.kind !== "weekly_scoped" || limit?.group !== "weekly") continue;
    if (limit?.scope?.surface !== undefined && limit.scope.surface !== null) continue;
    const displayName = limit?.scope?.model?.display_name;
    if (typeof displayName !== "string") continue;
    const percent = optionalNumber(limit.percent);
    if (percent === undefined) continue;
    const name = claudeModelTier(displayName);
    if (name === undefined) continue;
    modelTiers.set(name, { percent, resetsAt: normalizeResetsAt(limit.resets_at) });
  }

  for (const [key, value] of Object.entries(body)) {
    if (known.has(key)) continue;
    const window = value;
    if (window === undefined || window === null || typeof window !== "object") continue;
    const used = optionalNumber(window.utilization);
    if (used === undefined) continue;
    const name = claudeWindowTier(key);
    const scoped = modelTiers.get(name);
    if (scoped !== undefined) {
      modelTiers.delete(name);
      tiers.push(tier(name, 100 - scoped.percent, scoped.resetsAt));
    } else {
      tiers.push(tier(name, 100 - used, normalizeResetsAt(window.resets_at)));
    }
  }

  for (const [name, scoped] of modelTiers) {
    tiers.push(tier(name, 100 - scoped.percent, scoped.resetsAt));
  }
  return tiers;
}

/**
 * Claude 顶层窗口名归一化。
 *
 * @param {string} key - 窗口名。
 * @returns {string} 归一化后的窗口名。
 */
function claudeWindowTier(key) {
  switch (key) {
    case "five_hour":
      return "five_hour";
    case "seven_day":
      return "seven_day";
    case "seven_day_opus":
      return "seven_day_opus";
    case "seven_day_sonnet":
      return "seven_day_sonnet";
    case "seven_day_fable":
      return "seven_day_fable";
    default:
      return key;
  }
}

/**
 * Claude 模型专属周限额的 tier 名。
 *
 * @param {string} displayName - 模型展示名。
 * @returns {string | undefined} tier 名。
 */
function claudeModelTier(displayName) {
  switch (displayName.trim().toLowerCase()) {
    case "fable":
      return "seven_day_fable";
    case "opus":
      return "seven_day_opus";
    case "sonnet":
      return "seven_day_sonnet";
    default:
      return undefined;
  }
}

/**
 * 按窗口秒数映射到 tier 名（Codex 用）。
 *
 * @param {number | undefined} seconds - 窗口长度（秒）。
 * @returns {string} tier 名。
 */
export function windowSecondsTier(seconds) {
  switch (seconds) {
    case 18000:
      return "five_hour";
    case 604800:
      return "seven_day";
    case 2592000:
      return "thirty_day";
    default: {
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "unknown";
      const hours = seconds / 3600;
      if (hours >= 24 * 28) return "thirty_day";
      if (hours >= 24 * 6) return "seven_day";
      if (hours >= 4) return "five_hour";
      return "rolling";
    }
  }
}

/**
 * 解析 ChatGPT / Codex 订阅额度（`/backend-api/wham/usage`）。
 *
 * `rate_limit.primary_window` / `secondary_window` 里的 `used_percent` 是**已用**百分比。
 *
 * @param {unknown} body - 响应体。
 * @returns {{tiers: object[], balance: object | null}} 时间窗与 Codex Credits 余额。
 */
export function parseCodexUsage(body) {
  const tiers = [];
  const rateLimit = body?.rate_limit;
  const windows = [rateLimit?.primary_window, rateLimit?.secondary_window];
  for (const window of windows) {
    if (window === undefined || window === null) continue;
    const used = optionalNumber(window.used_percent);
    if (used === undefined) continue;
    // 已用 0 时上游会返回「当前时间 + 窗口长度」作为占位重置时间，丢弃。
    const resetsAt = used === 0 ? null : normalizeResetsAt(window.reset_at);
    tiers.push(tier(windowSecondsTier(optionalNumber(window.limit_window_seconds)), 100 - used, resetsAt));
  }
  return { tiers, balance: parseCodexCreditsBalance(body?.credits) };
}

/**
 * 解析 Codex Credits 余额。
 *
 * @param {unknown} credits - `credits` 字段。
 * @returns {object | null} 余额条目。
 */
function parseCodexCreditsBalance(credits) {
  if (credits === undefined || credits === null || typeof credits !== "object") return null;
  if (credits.has_credits !== true || credits.unlimited === true) return null;
  const raw = credits.balance;
  const value = optionalNumber(raw);
  if (value === undefined || value <= 0) return null;
  return balance("credits", value, { unit: "USD" });
}

/**
 * 解析 GitHub Copilot 额度（`/copilot_internal/user`）。
 *
 * 响应：`{ copilot_plan, quota_reset_date, quota_snapshots: { chat, completions,
 * premium_interactions: { entitlement, remaining, percent_remaining, unlimited } } }`。
 *
 * 与 cc-switch 一致：只展示 `premium_interactions`（高级交互额度），
 * chat / completions 解析出来但不展示。
 *
 * @param {unknown} body - 响应体。
 * @returns {{tiers: object[], balances: object[], note: string | undefined}} 额度。
 */
export function parseCopilotUsage(body) {
  const snapshots = body?.quota_snapshots;
  if (snapshots === null || typeof snapshots !== "object") {
    return { tiers: [], balances: [], note: undefined };
  }
  const premium = snapshots.premium_interactions;
  const tiers = [];
  const balances = [];
  let note;
  if (premium !== null && typeof premium === "object") {
    const entitlement = optionalNumber(premium.entitlement);
    const remaining = optionalNumber(premium.remaining);
    if (entitlement !== undefined && remaining !== undefined) {
      balances.push({
        name: "premium_interactions",
        remaining,
        total: entitlement,
        used: entitlement - remaining,
        unit: premium.unlimited === true ? "∞" : "requests"
      });
    }
    const percent = optionalNumber(premium.percent_remaining);
    if (percent !== undefined && entitlement === undefined) {
      // 上游只给了百分比、没有给额度条数时，退回时间窗形态。
      tiers.push(tier("premium_interactions", percent, null));
    }
  }
  const plan = typeof body?.copilot_plan === "string" ? body.copilot_plan : undefined;
  const reset = typeof body?.quota_reset_date === "string" ? body.quota_reset_date : undefined;
  if (plan !== undefined) note = reset === undefined ? plan : `${plan} · ${reset}`;
  return { tiers, balances, note };
}

/* ------------------------------------------------------------------ *
 * 解析器：账户余额
 * ------------------------------------------------------------------ */

/**
 * 解析 DeepSeek 账户余额（`/user/balance`）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 余额条目。
 */
export function parseDeepSeekBalance(body) {
  const balances = [];
  const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
  for (const info of infos) {
    const currency = typeof info?.currency === "string" && info.currency !== "" ? info.currency : "CNY";
    const total = optionalNumber(info.total_balance);
    if (total === undefined) continue;
    balances.push(balance(currency.toLowerCase(), total, { unit: currency.toUpperCase() }));
  }
  // 同一账号会列出 CNY / USD 两个钱包。只要还有币种有余额，就不列空钱包。
  if (balances.some((entry) => (entry.remaining ?? 0) > 0)) {
    return balances.filter((entry) => (entry.remaining ?? 0) > 0);
  }
  return balances;
}

/**
 * 解析 OpenRouter 余额（`/api/v1/credits`）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 余额条目。
 */
export function parseOpenRouterCredits(body) {
  const data = body?.data ?? body;
  const totalCredits = optionalNumber(data?.total_credits);
  const totalUsage = optionalNumber(data?.total_usage);
  if (totalCredits === undefined || totalUsage === undefined) return [];
  return [
    balance("credits", totalCredits - totalUsage, {
      unit: "USD",
      total: totalCredits,
      used: totalUsage
    })
  ];
}

/**
 * 解析 SiliconFlow 余额（`/v1/user/info`）。
 *
 * @param {unknown} body - 响应体。
 * @param {boolean} isCn - 国内站。
 * @returns {object[]} 余额条目。
 */
export function parseSiliconFlowBalance(body, isCn) {
  const data = body?.data;
  const total = optionalNumber(data?.totalBalance);
  if (total === undefined) return [];
  return [
    balance("balance", total, {
      unit: isCn ? "CNY" : "USD",
      used: numberOrNull(data.chargeBalance)
    })
  ];
}

/**
 * 解析 Novita AI 余额（`/v3/user/balance`）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 余额条目。
 */
export function parseNovitaBalance(body) {
  const available = optionalNumber(body?.availableBalance);
  if (available === undefined) return [];
  // Novita 金额单位是 0.0001 USD。
  return [
    balance("balance", available / 10000, {
      unit: "USD",
      total: numberOrNull(body.cashBalance) === null ? null : numberOrNull(body.cashBalance) / 10000
    })
  ];
}

/**
 * 解析 StepFun 余额（`/v1/accounts`）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object[]} 余额条目。
 */
export function parseStepFunBalance(body) {
  const balanceValue = optionalNumber(body?.balance);
  if (balanceValue === undefined) return [];
  return [
    balance("balance", balanceValue, {
      unit: "CNY",
      total: numberOrNull(body.total_cash_balance),
      used: numberOrNull(body.total_voucher_balance)
    })
  ];
}

/* ------------------------------------------------------------------ *
 * 供应商适配器
 * ------------------------------------------------------------------ */

/**
 * 构造一个「Bearer 鉴权」的适配器。
 *
 * @param {object} spec - 适配器描述。
 * @returns {object} 适配器。
 */
function bearerAdapter(spec) {
  return {
    ...spec,
    async query({ credential, baseUrl, timeoutMs }) {
      const url = typeof spec.url === "function" ? spec.url({ baseUrl }) : spec.url;
      const response = await requestJson(url, {
        headers: { authorization: `Bearer ${credential}`, ...(spec.headers ?? {}) },
        timeoutMs
      });
      if (response.status === 401 || response.status === 403) {
        return { error: `凭据被拒绝（HTTP ${response.status}）：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      if (!response.ok) {
        return { error: `上游返回 HTTP ${response.status}：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      return spec.parse(response.body, { baseUrl });
    }
  };
}

/**
 * 构造一个「裸 Key 鉴权」的适配器（智谱这种不加 Bearer 的）。
 *
 * @param {object} spec - 适配器描述。
 * @returns {object} 适配器。
 */
function rawKeyAdapter(spec) {
  return {
    ...spec,
    async query({ credential, baseUrl, timeoutMs }) {
      const url = typeof spec.url === "function" ? spec.url({ baseUrl }) : spec.url;
      const response = await requestJson(url, {
        headers: { authorization: credential, ...(spec.headers ?? {}) },
        timeoutMs
      });
      if (response.status === 401 || response.status === 403) {
        return { error: `凭据被拒绝（HTTP ${response.status}）：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      if (!response.ok) {
        return { error: `上游返回 HTTP ${response.status}：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      return spec.parse(response.body, { baseUrl });
    }
  };
}

/**
 * 构造一个「GitHub token 鉴权」的适配器（Copilot 用的是 `token X` 而不是 `Bearer X`）。
 *
 * @param {object} spec - 适配器描述。
 * @returns {object} 适配器。
 */
function tokenAdapter(spec) {
  return {
    ...spec,
    async query({ credential, baseUrl, timeoutMs }) {
      const url = typeof spec.url === "function" ? spec.url({ baseUrl }) : spec.url;
      const response = await requestJson(url, {
        headers: { authorization: `token ${credential}`, ...(spec.headers ?? {}) },
        timeoutMs
      });
      if (response.status === 401 || response.status === 403) {
        return { error: `凭据被拒绝（HTTP ${response.status}）：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      if (!response.ok) {
        return { error: `上游返回 HTTP ${response.status}：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      return spec.parse(response.body, { baseUrl });
    }
  };
}

/**
 * 构造一个「自定义鉴权」的适配器。
 *
 * @param {object} spec - 适配器描述。
 * @returns {object} 适配器。
 */
function customAdapter(spec) {
  return {
    ...spec,
    async query(input) {
      return await spec.query(input);
    }
  };
}

/* ------------------------------------------------------------------ *
 * 通用中转站额度
 * ------------------------------------------------------------------ */

/**
 * 解析 one-api / new-api 风格的额度（`/api/user/self`）。
 *
 * `data.quota` 是**剩余**额度，`data.used_quota` 是已用额度，单位是
 * 「1/500000 美元」——这是 new-api 的历史约定。
 *
 * @param {unknown} body - 响应体。
 * @returns {object | null} 余额条目。
 */
export function parseNewApiQuota(body) {
  const data = body?.data ?? body;
  if (data === null || typeof data !== "object") return null;
  const quota = optionalNumber(data.quota);
  if (quota === undefined) return null;
  const used = optionalNumber(data.used_quota);
  const scale = 500000;
  return {
    name: "balance",
    remaining: quota / scale,
    total: used === undefined ? null : (quota + used) / scale,
    used: used === undefined ? null : used / scale,
    unit: "USD"
  };
}

/**
 * 解析 sub2api 风格的额度（`/v1/usage`）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object | null} 余额条目。
 */
export function parseSub2ApiQuota(body) {
  const quota = body?.quota;
  if (quota === null || typeof quota !== "object") return null;
  const limit = optionalNumber(quota.limit);
  const used = optionalNumber(quota.used);
  if (limit === undefined && used === undefined) return null;
  const remaining = limit === undefined ? null : limit - (used ?? 0);
  return {
    name: "balance",
    remaining,
    total: limit,
    used: used ?? null,
    unit: typeof quota.unit === "string" ? quota.unit : "USD"
  };
}

/**
 * 解析通用余额（`/user/balance` 这类直接给 `balance` 的接口）。
 *
 * @param {unknown} body - 响应体。
 * @returns {object | null} 余额条目。
 */
export function parseGenericBalance(body) {
  if (body === null || typeof body !== "object") return null;
  const data = body?.data !== null && typeof body?.data === "object" ? body.data : body;
  const remaining = optionalNumber(data.balance ?? data.remaining ?? data.amount);
  if (remaining === undefined) return null;
  return {
    name: "balance",
    remaining,
    total: numberOrNull(data.total ?? data.total_balance),
    used: numberOrNull(data.used),
    unit: typeof data.unit === "string" ? data.unit : typeof data.currency === "string" ? data.currency : "USD"
  };
}

/**
 * 中转站额度的候选接口，按命中概率排序。
 *
 * 对应 cc-switch 的 `general` / `newapi` / `sub2api` 三套模板：
 * 用户自建的 OpenAI 兼容中转站大多只提供其中一种。
 */
const RELAY_ENDPOINTS = [
  { suffix: "/api/user/self", parse: parseNewApiQuota },
  { suffix: "/v1/usage", parse: parseSub2ApiQuota },
  { suffix: "/api/usage", parse: parseGenericBalance },
  { suffix: "/user/balance", parse: parseGenericBalance }
];

/**
 * 通用中转站适配器。
 *
 * DSH 的 pi-ai 允许把任意 OpenAI 兼容地址配成供应商路由。这类中转站
 * 绝大多数有额度接口，只是路径各不相同——这里按候选列表逐个试，
 * 第一个能解析出余额的就用它。
 *
 * @type {object}
 */
export const RELAY_ADAPTER = {
  id: "relay",
  label: "中转站",
  family: "balance",
  credentialRefs: [],
  /**
   * 依次尝试候选接口。
   *
   * @param {object} input - 查询输入。
   * @param {string} input.credential - 凭据。
   * @param {string} [input.baseUrl] - 推理端点地址。
   * @param {number} [input.timeoutMs] - 超时。
   * @returns {Promise<object>} 查询结果。
   */
  async query({ credential, baseUrl, timeoutMs }) {
    if (typeof baseUrl !== "string" || baseUrl === "") {
      return { error: "没有该供应商的端点地址，无法查询额度。" };
    }
    const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    let lastError = "所有候选额度接口都没有返回可识别的数据。";
    for (const candidate of RELAY_ENDPOINTS) {
      const url = `${root}${candidate.suffix}`;
      let response;
      try {
        response = await requestJson(url, {
          headers: { authorization: `Bearer ${credential}` },
          timeoutMs
        });
      } catch (error) {
        lastError = `请求 ${url} 失败：${error instanceof Error ? error.message : String(error)}`;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        return { error: `凭据被拒绝（HTTP ${response.status}）：${errorMessage(response.body) ?? ""}` };
      }
      if (!response.ok) continue;
      const parsed = candidate.parse(response.body);
      if (parsed !== null) return { balances: [parsed], note: url };
      lastError = `${url} 返回的数据无法识别。`;
    }
    return { error: lastError };
  }
};

/**
 * 全部供应商适配器。
 *
 * `id` 是 DSH 的供应商路由 id；`aliases` 覆盖同一个供应商的其它路由写法。
 * `credentialRefs` 是凭据引用的候选名，按优先级尝试（先凭据服务，后环境变量）。
 *
 * @type {object[]}
 */
export const PROVIDER_ADAPTERS = [
  /* ---------------- DSH 自带路由 ---------------- */

  customAdapter({
    id: "deepseek-account",
    label: "DeepSeek 账号",
    family: "balance",
    credentialRefs: [],
    note: "使用 DSH 已登录的 DeepSeek 账号，不需要单独的 API Key。",
    async query({ ctx }) {
      const account = ctx.get("deepseekAccount");
      if (account === undefined) {
        return { error: "当前组合没有挂载 DeepSeek 账号服务。" };
      }
      // 账号服务要一份「请求方身份」：版本、语言、时区偏移。
      const details = await account.getBalance({
        version: "1.0.0",
        locale: "zh-CN",
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
      });
      if (details === null || details === undefined) {
        return { error: "没有取到 DeepSeek 账号余额，请确认已登录 DeepSeek 账号。" };
      }
      if (details.status !== "ready") {
        return { error: "DeepSeek 账号余额查询失败。" };
      }
      const wallets = Array.isArray(details.value) ? details.value : [];
      if (wallets.length === 0) {
        return { error: "DeepSeek 账号没有余额数据。" };
      }
      return {
        balances: wallets.map((wallet) => ({
          name: String(wallet?.currency ?? "balance").toLowerCase(),
          remaining: optionalNumber(wallet?.balance) ?? 0,
          total: null,
          used: null,
          unit: String(wallet?.currency ?? "").toUpperCase()
        }))
      };
    }
  }),

  bearerAdapter({
    id: "deepseek-official",
    aliases: ["deepseek"],
    label: "DeepSeek",
    family: "balance",
    credentialRefs: ["DEEPSEEK_API_KEY"],
    match: (baseUrl) => baseUrl.includes("api.deepseek.com"),
    url: "https://api.deepseek.com/user/balance",
    parse: (body) => ({ balances: parseDeepSeekBalance(body) })
  }),

  /* ---------------- 订阅额度（时间窗） ---------------- */

  bearerAdapter({
    id: "anthropic",
    label: "Claude",
    family: "tiers",
    credentialRefs: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"],
    match: (baseUrl) => baseUrl.includes("anthropic.com"),
    url: "https://api.anthropic.com/api/oauth/usage",
    headers: { "anthropic-beta": "oauth-2025-04-20" },
    parse: (body) => ({ tiers: parseClaudeUsage(body) })
  }),

  bearerAdapter({
    id: "openai-codex",
    label: "ChatGPT (Codex)",
    family: "tiers",
    credentialRefs: ["OPENAI_CODEX_ACCESS_TOKEN", "CHATGPT_ACCESS_TOKEN", "CODEX_ACCESS_TOKEN"],
    url: "https://chatgpt.com/backend-api/wham/usage",
    headers: { "user-agent": "codex-cli" },
    parse: (body) => {
      const parsed = parseCodexUsage(body);
      return { tiers: parsed.tiers, balances: parsed.balance === null ? [] : [parsed.balance] };
    }
  }),

  bearerAdapter({
    id: "kimi-coding",
    label: "Kimi For Coding",
    family: "tiers",
    credentialRefs: ["KIMI_API_KEY", "KIMI_CODING_API_KEY"],
    match: (baseUrl) => baseUrl.includes("api.kimi.com") || baseUrl.includes("api.kimi.ai"),
    url: ({ baseUrl }) => {
      const host = typeof baseUrl === "string" && baseUrl.includes("api.kimi.ai") ? "api.kimi.ai" : "api.kimi.com";
      return `https://${host}/coding/v1/usages`;
    },
    parse: (body) => ({ tiers: parseKimiUsage(body) })
  }),

  customAdapter({
    id: "zai-coding-cn",
    aliases: ["zai", "zhipu"],
    label: "智谱 GLM",
    family: "tiers",
    credentialRefs: ["ZAI_CODING_CN_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
    match: (baseUrl) => baseUrl.includes("bigmodel.cn") || baseUrl.includes("api.z.ai"),
    async query({ credential, baseUrl, timeoutMs }) {
      const host =
        typeof baseUrl === "string" && baseUrl.includes("bigmodel.cn") ? "open.bigmodel.cn" : "api.z.ai";
      const url = `https://${host}/api/monitor/usage/quota/limit`;
      const response = await requestJson(url, {
        headers: { authorization: credential, "accept-language": "en-US,en" },
        timeoutMs
      });
      if (response.status === 401 || response.status === 403) {
        return { error: `凭据被拒绝（HTTP ${response.status}）：${errorMessage(response.body) ?? ""}` };
      }
      if (!response.ok) {
        return { error: `上游返回 HTTP ${response.status}：${errorMessage(response.body) ?? response.text.slice(0, 200)}` };
      }
      const body = response.body;
      if (body?.success === false) {
        const message = typeof body?.msg === "string" ? body.msg : "未知错误";
        if (!/coding\s*plan/i.test(message) || !/(不存在|没有|未开通|not\s+(exist|found|have))/i.test(message)) {
          return { error: `智谱返回业务错误：${message}` };
        }
        // 没有 Coding Plan（按量付费）时改查账户余额。
        return await queryZhipuBalance(host, credential, timeoutMs);
      }
      const data = body?.data;
      if (data === undefined || data === null) return { error: "智谱响应里没有 data 字段。" };
      const tiers = parseZhipuQuota(body);
      const level = typeof data.level === "string" ? data.level : undefined;
      return { tiers, note: level };
    }
  }),

  bearerAdapter({
    id: "minimax-cn",
    aliases: ["minimax"],
    label: "MiniMax",
    family: "tiers",
    credentialRefs: ["MINIMAX_CN_API_KEY", "MINIMAX_API_KEY"],
    match: (baseUrl) =>
      baseUrl.includes("minimaxi.com") || baseUrl.includes("minimax.io") || baseUrl.includes("minimax.cn"),
    url: ({ baseUrl }) => {
      const international =
        typeof baseUrl === "string" && (baseUrl.includes("minimax.io") || baseUrl.includes("minimax.ai"));
      const host = international ? "api.minimax.io" : "api.minimaxi.com";
      return `https://${host}/v1/api/openplatform/coding_plan/remains`;
    },
    parse: (body) => {
      const baseResp = body?.base_resp;
      if (baseResp !== undefined && baseResp !== null && optionalNumber(baseResp.status_code) !== 0) {
        return {
          error: `MiniMax 返回业务错误 ${String(baseResp.status_code)}：${String(baseResp.status_msg ?? "未知")}`
        };
      }
      return { tiers: parseCodingPlanTiers(body) };
    }
  }),

  bearerAdapter({
    id: "opencode-go",
    label: "OpenCode Go",
    family: "tiers",
    credentialRefs: ["OPENCODE_API_KEY"],
    match: (baseUrl) => baseUrl.includes("opencode.ai"),
    url: "https://opencode.ai/zen/go/v1/usage",
    parse: (body) => {
      const tiers = parseOpencodeGoTiers(body);
      if (tiers.length === 0) return { error: "OpenCode Go 用量响应结构无法识别。" };
      return { tiers };
    }
  }),

  /* ---------------- 账户余额 ---------------- */

  tokenAdapter({
    id: "github-copilot",
    label: "GitHub Copilot",
    family: "tiers",
    credentialRefs: ["COPILOT_GITHUB_TOKEN", "GITHUB_TOKEN"],
    match: (baseUrl) => baseUrl.includes("githubcopilot.com") || baseUrl.includes("api.github.com"),
    url: "https://api.github.com/copilot_internal/user",
    headers: {
      "content-type": "application/json",
      "editor-version": "vscode/1.110.1",
      "editor-plugin-version": "copilot-chat/0.38.2",
      "user-agent": "GitHubCopilotChat/0.38.2",
      "x-github-api-version": "2025-10-01"
    },
    parse: (body) => {
      const parsed = parseCopilotUsage(body);
      if (parsed.tiers.length === 0 && parsed.balances.length === 0) {
        return { error: "Copilot 用量响应结构无法识别。" };
      }
      return parsed;
    }
  }),

  bearerAdapter({
    id: "openrouter",
    label: "OpenRouter",
    family: "balance",
    credentialRefs: ["OPENROUTER_API_KEY"],
    match: (baseUrl) => baseUrl.includes("openrouter.ai"),
    url: "https://openrouter.ai/api/v1/credits",
    parse: (body) => {
      const balances = parseOpenRouterCredits(body);
      if (balances.length === 0) return { error: "OpenRouter 余额字段缺失或非法。" };
      return { balances };
    }
  }),

  bearerAdapter({
    id: "moonshotai-cn",
    aliases: ["moonshotai"],
    label: "Moonshot",
    family: "balance",
    credentialRefs: ["MOONSHOT_API_KEY"],
    match: (baseUrl) => baseUrl.includes("moonshot.cn") || baseUrl.includes("moonshot.ai"),
    url: ({ baseUrl }) => {
      const host =
        typeof baseUrl === "string" && baseUrl.includes("moonshot.ai") ? "api.moonshot.ai" : "api.moonshot.cn";
      return `https://${host}/v1/users/me/balance`;
    },
    parse: (body) => {
      const data = body?.data ?? body;
      const available = optionalNumber(data?.available_balance ?? data?.balance);
      if (available === undefined) return { error: "Moonshot 余额字段缺失。" };
      return [
        {
          name: "balance",
          remaining: available,
          total: numberOrNull(data.total_balance),
          used: numberOrNull(data.voucher_balance ?? data.cash_balance),
          unit: "CNY"
        }
      ];
    }
  }),

  bearerAdapter({
    id: "siliconflow",
    label: "SiliconFlow",
    family: "balance",
    credentialRefs: ["SILICONFLOW_API_KEY"],
    match: (baseUrl) => baseUrl.includes("siliconflow.cn") || baseUrl.includes("siliconflow.com"),
    url: ({ baseUrl }) => {
      const host =
        typeof baseUrl === "string" && baseUrl.includes("siliconflow.com") ? "api.siliconflow.com" : "api.siliconflow.cn";
      return `https://${host}/v1/user/info`;
    },
    parse: (body, { baseUrl }) => ({
      balances: parseSiliconFlowBalance(body, !(typeof baseUrl === "string" && baseUrl.includes("siliconflow.com")))
    })
  }),

  bearerAdapter({
    id: "novita",
    label: "Novita AI",
    family: "balance",
    credentialRefs: ["NOVITA_API_KEY"],
    match: (baseUrl) => baseUrl.includes("api.novita.ai"),
    url: "https://api.novita.ai/v3/user/balance",
    parse: (body) => ({ balances: parseNovitaBalance(body) })
  }),

  bearerAdapter({
    id: "stepfun",
    label: "StepFun",
    family: "balance",
    credentialRefs: ["STEPFUN_API_KEY"],
    match: (baseUrl) => baseUrl.includes("stepfun.ai") || baseUrl.includes("stepfun.com"),
    url: "https://api.stepfun.com/v1/accounts",
    parse: (body) => ({ balances: parseStepFunBalance(body) })
  })
];

/**
 * 按 DSH 供应商路由 id 找适配器。
 *
 * @param {string | undefined} providerId - 供应商路由 id。
 * @returns {object | undefined} 适配器。
 */
export function findAdapter(providerId) {
  if (typeof providerId !== "string" || providerId === "") return undefined;
  const normalized = providerId.toLowerCase();
  return PROVIDER_ADAPTERS.find(
    (adapter) => adapter.id === normalized || (adapter.aliases ?? []).includes(normalized)
  );
}

/**
 * 按 base URL 找适配器（供应商路由是自定义名字时兜底）。
 *
 * @param {string | undefined} baseUrl - 推理端点地址。
 * @returns {object | undefined} 适配器。
 */
export function findAdapterByBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl === "") return undefined;
  const normalized = baseUrl.toLowerCase();
  return PROVIDER_ADAPTERS.find((adapter) => adapter.match?.(normalized) === true);
}

/**
 * 列出全部适配器的静态信息（不含查询逻辑）。
 *
 * @returns {object[]} 适配器概览。
 */
export function listAdapters() {
  return PROVIDER_ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    family: adapter.family,
    aliases: adapter.aliases ?? [],
    credentialRefs: adapter.credentialRefs ?? []
  }));
}
