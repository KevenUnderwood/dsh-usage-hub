/**
 * `dsh-usage-hub` —— 宿主半边。
 *
 * 职责：
 *  1. 在 Host 的 WebServer 上注册一个 RPC 路由 `/usage-hub`，
 *     让浏览器半边能问三件事：
 *     - `quota`：当前模型所属供应商的**额度/余额**。宿主按 DSH 当前选中的
 *       供应商路由（provider route）挑适配器，用对应凭据查对应接口；
 *       切模型就自动切到另一个供应商的用量。
 *     - `providers`：本插件支持的供应商清单（含是否已配置凭据），
 *       供界面上手动切换查看。
 *     - `usage`：回放会话日志，跨会话按模型聚合 token 用量。
 *  2. 只依赖 Node 内置能力与 DSH 服务，因此以 `link:` 方式装进 profile 时
 *     不需要额外的 node_modules。
 *
 * 路由与鉴权自己实现：Connection 的通用 RPC 通道（`ctx.connection.rpc.handle`）
 * 要求宿主侧作用域里能看到 webServer，而在新一些的 DSH 上那条路对第三方插件
 * 已经不可用——注册时的销毁回调会读到 Connection 插件自己的 fiber，那里
 * 永远没有 webServer，于是通道凭空消失、启动日志却一片安静。
 *
 * 所以这里改为**自己向 webServer 注册一条前缀路由**，并用
 * `ctx.connection.admit(req)` 自己做 Host/Origin 与浏览器会话的信任判定。
 * 请求体沿用 Connection 的信封格式，因此浏览器半边的
 * `ctx.connection.rpc.call()` 可以直接调用。
 */
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PROVIDER_ADAPTERS,
  RELAY_ADAPTER,
  findAdapter,
  findAdapterByBaseUrl,
  listAdapters,
  numberOf,
  numberOrNull,
  optionalNumber
} from "./providers.js";

/** 本插件独占的 RPC 路由前缀。 */
const RPC_CHANNEL = "/usage-hub";

/** 端点名允许的字符集。 */
const ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

/** 默认配置值。 */
const DEFAULTS = {
  /** 自动刷新间隔（毫秒）。 */
  refreshIntervalMs: 600000,
  /** 是否在窗口左下角的状态栏里显示快捷刷新按钮。 */
  showQuickRefresh: false
};

/**
 * 允许的自动刷新间隔（毫秒）。
 *
 * 界面上只给这几个档位：5 秒 / 60 秒 / 10 分钟 / 30 分钟 / 1 小时。
 * 配置里写了别的值就退回默认档。
 */
const REFRESH_INTERVALS = [5000, 60000, 600000, 1800000, 3600000];

/** 跨会话聚合最多回放多少个会话。 */
const MAX_SESSIONS = 50;
/** 跨会话聚合结果的缓存时长（毫秒）。 */
const USAGE_CACHE_MS = 30000;
/** 单次用量查询的超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * 是否写本地诊断日志。
 *
 * 排查问题时把它改成 true：日志写到系统临时目录下的 `dsh-usage-hub.log`，
 * 从不写入凭据值。
 */
const DIAGNOSTICS = false;

/**
 * 追加一行诊断信息。
 *
 * @param {string} message - 文本。
 * @param {unknown} [extra] - 附加结构化信息。
 */
function diag(message, extra) {
  if (!DIAGNOSTICS) return;
  const path = join(tmpdir(), "dsh-usage-hub.log");
  const line = `[${new Date().toISOString()}] ${message}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}\n`;
  try {
    appendFileSync(path, line, "utf8");
  } catch {
    // 诊断日志写不进去也不能影响插件本身。
  }
}

/**
 * 构建配置 schema。
 *
 * 两个字段都标成 `.volatile()`：
 * - DSH 的配置编辑器（`dsh-settings`）只把 volatile 字段做成可写表单，
 *   所以 Web 端的齿轮设置页才能读到并写回它们；
 * - volatile 字段的值以引用对象（`{ get() }`）的形式交给插件，宿主改配置时
 *   原地替换引用里的值，插件不重启即可看到新值（见 `readConfigValue`）。
 *
 * schemastery 不可用时返回 undefined：Loader 看到没有 Config 就不做校验，
 * 原始配置照样传给 apply()，插件仍然可用（只是没有 Web 端设置页）。
 *
 * @returns 配置 schema，或 undefined。
 */
async function buildConfigSchema() {
  try {
    const z = (await import("@deepseek-ai/schemastery")).default;
    return z.object({
      refreshIntervalMs: z.number().default(DEFAULTS.refreshIntervalMs).volatile(),
      showQuickRefresh: z.boolean().default(DEFAULTS.showQuickRefresh).volatile()
    });
  } catch (error) {
    console.error("[dsh-usage-hub] schemastery 不可用，配置将不做校验", error);
    return undefined;
  }
}

/** 插件的配置 schema（由 Loader 校验后传给 apply）。 */
export const Config = await buildConfigSchema();

/**
 * 宿主半边需要的服务：Connection 提供鉴权判定，WebServer 承载路由。
 *
 * `agentDefaultModel` / `llm` / `credentials` 都是可选的：拿不到就退回到
 * 「客户端显式指定供应商」或「按 base URL 猜测」。
 */
export const inject = ["connection", "webServer"];

/**
 * 挂载本插件。
 *
 * 宿主半边不读配置：唯一剩下的配置项（自动刷新间隔）只影响浏览器的轮询节奏，
 * 由浏览器半边通过 DSH 的配置服务读写。
 *
 * @param {object} ctx - 宿主 Cordis 上下文。
 */
export function apply(ctx) {
  diag("apply 被调用", {
    hasConnection: ctx.connection !== undefined,
    hasWebServer: ctx.webServer !== undefined
  });

  // 把本插件从 DSH 的「自动设置页」里摘掉：设置页只保留插件自己页面上的
  // 齿轮入口，不在 DSH 的插件管理器/设置页里再自动生成一份配置表单。
  //
  // `settings` 是可选服务（没有配置编辑器的部署里不存在），`ctx.inject` 会
  // 等到它出现才跑回调，所以这里不影响插件本身挂载。
  ctx.inject(["settings"], (child) => {
    child.effect(() => {
      try {
        child.settings.configure({ auto: false }, ctx.fiber);
      } catch (error) {
        // 这个 fiber 已经配置过（比如热重载时重复挂载）：不影响插件本身。
        diag("关闭自动设置页失败", { message: String(error) });
      }
    });
  });

  try {
    ctx.effect(
      () =>
        ctx.webServer.register(
          {
            kind: "prefix",
            path: RPC_CHANNEL,
            handler: (req, res) => {
              void handleRequest(ctx, req, res);
            }
          },
          "usage-hub: rpc 路由"
        ),
      "usage-hub: rpc 路由"
    );
    diag("rpc 路由已注册", { path: RPC_CHANNEL });
  } catch (error) {
    diag("注册 rpc 路由失败", { message: String(error), stack: error?.stack });
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * RPC 路由
 * ------------------------------------------------------------------ */

/**
 * 处理一次 RPC 请求。
 *
 * @param {object} ctx - 宿主上下文。
 * @param {object} req - Node 请求。
 * @param {object} res - Node 响应。
 */
async function handleRequest(ctx, req, res) {
  try {
    const admission = ctx.connection.admit(req);
    if ("rejection" in admission) {
      diag("请求被拒", { rejection: admission.rejection, url: req.url });
      res.writeHead(admission.rejection, { "content-type": "text/plain; charset=utf-8" });
      res.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return;
    }

    const raw = await readBody(req);
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("body is not JSON");
      return;
    }

    const rpcId = typeof envelope?.rpcId === "string" ? envelope.rpcId : "invalid-request";
    const endpoint = endpointFromPath(req.url);
    if (envelope?.type !== "client-request" || typeof envelope?.method !== "string" || endpoint === undefined) {
      respond(res, rpcId, {
        ok: false,
        error: { code: "gateway/bad-request", message: "invalid client-request message", details: {} }
      });
      return;
    }
    if (envelope.method !== endpoint) {
      respond(res, rpcId, {
        ok: false,
        error: {
          code: "gateway/bad-request",
          message: `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: {}
        }
      });
      return;
    }

    diag("rpc 调用", { endpoint });
    let result;
    try {
      result = await dispatch(ctx, endpoint, envelope.payload);
    } catch (error) {
      diag("端点执行失败", { endpoint, message: String(error), stack: error?.stack });
      result = { ok: false, error: { code: "handler-error", message: String(error), details: {} } };
    }
    respond(res, rpcId, result);
  } catch (error) {
    diag("请求处理异常", { message: String(error), stack: error?.stack });
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("internal error");
  }
}

/**
 * 从请求路径里取出端点名。
 *
 * @param {string | undefined} url - 请求 URL。
 * @returns {string | undefined} 端点名，非法时为 undefined。
 */
function endpointFromPath(url) {
  if (typeof url !== "string") return undefined;
  const pathname = url.split("?")[0];
  if (!pathname.startsWith(`${RPC_CHANNEL}/`)) return undefined;
  const endpoint = pathname.slice(RPC_CHANNEL.length + 1);
  return ENDPOINT_PATTERN.test(endpoint) ? endpoint : undefined;
}

/**
 * 读出请求体。
 *
 * @param {object} req - Node 请求。
 * @returns {Promise<string>} 请求体文本。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 写出 RPC 响应。
 *
 * @param {object} res - Node 响应。
 * @param {string} rpcId - 关联 id。
 * @param {object} result - 结果。
 */
function respond(res, rpcId, result) {
  const body = JSON.stringify({ type: "server-response", rpcId, result });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(body);
}

/**
 * 按端点分派。
 *
 * @param {object} ctx - 宿主上下文。
 * @param {string} endpoint - 端点名。
 * @param {unknown} payload - 客户端载荷。
 * @returns {Promise<object>} 结果。
 */
async function dispatch(ctx, endpoint, payload) {
  if (endpoint === "quota" || endpoint === "balance") return await readQuota(ctx, payload);
  if (endpoint === "providers") return await readProviders(ctx);
  if (endpoint === "usage") return await readUsage(ctx);
  return { ok: false, error: { code: "unknown-endpoint", message: `未知端点 ${endpoint}`, details: {} } };
}

/* ------------------------------------------------------------------ *
 * 供应商路由
 * ------------------------------------------------------------------ */

/**
 * 读出 pi-ai 适配器里每个供应商路由的本地配置。
 *
 * 这样插件拿到的是**用户真的配的** base URL 与凭据引用，而不是猜的默认值：
 * 用户把 `minimax-cn` 指到自建网关时，用量接口也要跟着走那个地址。
 *
 * @param {object} ctx - 宿主上下文。
 * @returns {Map<string, {baseURL?: string, apiKeyEnv?: string, displayName?: string}>} 路由配置。
 */
function readProviderProfiles(ctx) {
  const profiles = new Map();
  const editor = ctx.get("configEditor");
  if (editor === undefined) return profiles;
  let configuration;
  try {
    configuration = editor.configuration();
  } catch (error) {
    diag("读取配置编辑器失败", { message: String(error) });
    return profiles;
  }
  for (const item of Array.isArray(configuration) ? configuration : []) {
    const entry = item?.entry;
    const haystack = [entry?.name, entry?.id, entry?.moduleName, entry?.plugin]
      .filter((value) => typeof value === "string")
      .join(" ");
    if (!haystack.includes("llm-pi-ai")) continue;
    const raw = { ...(item?.inherited ?? {}), ...(item?.override ?? {}) };
    const providers = raw.providers;
    if (providers === null || typeof providers !== "object") continue;
    for (const [route, profile] of Object.entries(providers)) {
      if (profile === null || typeof profile !== "object") continue;
      profiles.set(route, {
        baseURL: typeof profile.baseURL === "string" ? profile.baseURL : undefined,
        apiKeyEnv: typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : undefined,
        displayName: typeof profile.displayName === "string" ? profile.displayName : undefined
      });
    }
  }
  return profiles;
}

/**
 * 读出 DSH 自带路由（deepseek-official）的本地配置。
 *
 * @param {object} ctx - 宿主上下文。
 * @returns {Map<string, {baseURL?: string, apiKeyEnv?: string}>} 路由配置。
 */
function readBuiltinProfiles(ctx) {
  const profiles = new Map();
  const editor = ctx.get("configEditor");
  if (editor === undefined) return profiles;
  let configuration;
  try {
    configuration = editor.configuration();
  } catch {
    return profiles;
  }
  for (const item of Array.isArray(configuration) ? configuration : []) {
    const entry = item?.entry;
    const haystack = [entry?.name, entry?.id, entry?.moduleName, entry?.plugin]
      .filter((value) => typeof value === "string")
      .join(" ");
    if (!haystack.includes("llm-deepseek-api-key")) continue;
    const raw = { ...(item?.inherited ?? {}), ...(item?.override ?? {}) };
    const apiKeyEnv = typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv : undefined;
    const baseURL = typeof raw.baseURL === "string" ? raw.baseURL : undefined;
    if (apiKeyEnv !== undefined || baseURL !== undefined) {
      profiles.set("deepseek-official", { apiKeyEnv, baseURL });
    }
  }
  return profiles;
}

/**
 * 合并出「路由 id → 本地配置」的视图。
 *
 * @param {object} ctx - 宿主上下文。
 * @returns {Map<string, object>} 路由配置。
 */
function collectProfiles(ctx) {
  const merged = new Map();
  for (const [route, profile] of readBuiltinProfiles(ctx)) merged.set(route, profile);
  for (const [route, profile] of readProviderProfiles(ctx)) merged.set(route, profile);
  return merged;
}

/**
 * 读出当前选中的模型。
 *
 * 优先级：客户端显式指定 → 会话投影（客户端会带上）→ DSH 默认模型。
 *
 * @param {object} ctx - 宿主上下文。
 * @param {unknown} payload - 客户端载荷。
 * @returns {Promise<{provider?: string, model?: string}>} 当前选择。
 */
async function resolveSelection(ctx, payload) {
  const fromPayload =
    payload !== null && typeof payload === "object"
      ? {
          provider: typeof payload.provider === "string" ? payload.provider : undefined,
          model: typeof payload.model === "string" ? payload.model : undefined
        }
      : {};

  if (fromPayload.provider !== undefined && fromPayload.provider !== "") {
    return fromPayload;
  }

  const defaults = ctx.get("agentDefaultModel");
  if (defaults !== undefined) {
    try {
      const selection = defaults.currentSelection();
      if (typeof selection?.provider === "string" && selection.provider !== "") {
        return {
          provider: selection.provider,
          model: typeof selection.model === "string" ? selection.model : undefined
        };
      }
    } catch (error) {
      diag("读取默认模型失败", { message: String(error) });
    }
  }

  return fromPayload;
}

/**
 * 读出供应商目录里声明的默认端点。
 *
 * pi-ai 的目录项带 `defaultBaseURL`（安装的目录里每个路由的内置地址），
 * 用户没在配置里写 baseURL 时用它。
 *
 * @param {object} ctx - 宿主上下文。
 * @returns {Map<string, string>} 路由 → 默认端点。
 */
function readDirectoryBaseUrls(ctx) {
  const baseUrls = new Map();
  const llm = ctx.get("llm");
  if (llm === undefined) return baseUrls;
  try {
    for (const entry of llm.listConfigurableProviders?.() ?? []) {
      if (typeof entry?.provider !== "string") continue;
      if (typeof entry.defaultBaseURL === "string" && entry.defaultBaseURL !== "") {
        baseUrls.set(entry.provider, entry.defaultBaseURL);
      }
    }
  } catch (error) {
    diag("读取供应商目录失败", { message: String(error) });
  }
  return baseUrls;
}

/**
 * 找出某个路由对应的适配器。
 *
 * 顺序：
 *  1. 按路由 id 直接命中（DSH 自带路由与 pi-ai 目录里的常见供应商）；
 *  2. 按 base URL 猜（供应商路由是自定义名字，但地址是认得的）；
 *  3. 兜底用「中转站」适配器——DSH 允许把任意 OpenAI 兼容地址配成路由，
 *     而这类中转站大多有自己的额度接口，只是路径不统一。
 *
 * @param {string | undefined} provider - 供应商路由 id。
 * @param {Map<string, object>} profiles - 路由的本地配置。
 * @param {Map<string, string>} directoryBaseUrls - 路由的默认端点。
 * @returns {object | undefined} 适配器。
 */
function resolveAdapter(provider, profiles, directoryBaseUrls) {
  const byId = findAdapter(provider);
  if (byId !== undefined) return byId;

  const baseUrl = baseUrlOf(provider, profiles, directoryBaseUrls);
  if (baseUrl !== undefined) {
    const byUrl = findAdapterByBaseUrl(baseUrl);
    if (byUrl !== undefined) return byUrl;
    // 地址认不出是哪家，但用户自己配了端点：按中转站试一遍常见额度接口。
    return RELAY_ADAPTER;
  }
  return undefined;
}

/**
 * 取某个路由的端点地址。
 *
 * @param {string | undefined} provider - 供应商路由 id。
 * @param {Map<string, object>} profiles - 路由的本地配置。
 * @param {Map<string, string>} directoryBaseUrls - 路由的默认端点。
 * @returns {string | undefined} 端点地址。
 */
function baseUrlOf(provider, profiles, directoryBaseUrls) {
  if (provider === undefined) return undefined;
  const profile = profiles.get(provider);
  if (profile?.baseURL !== undefined) return profile.baseURL;
  return directoryBaseUrls.get(provider);
}

/**
 * 看着像「可以直接当密钥用」的环境变量名。
 *
 * 供应商目录的 `nativeAuth.env` 里混着组织 ID、规则 ID、证书文件路径这类
 * 辅助变量——它们不是凭据，拿去当 Bearer 会得到莫名其妙的 401。
 */
const CREDENTIAL_NAME_PATTERN = /(API_KEY|_TOKEN|_SECRET)$/;

/**
 * 列出某个路由的凭据引用候选。
 *
 * @param {object} adapter - 适配器。
 * @param {object | undefined} profile - 路由的本地配置。
 * @param {object} ctx - 宿主上下文。
 * @returns {string[]} 候选引用名。
 */
function credentialCandidates(adapter, profile, ctx) {
  const candidates = [];
  const push = (name) => {
    if (typeof name !== "string" || name === "") return;
    if (!candidates.includes(name)) candidates.push(name);
  };
  push(profile?.apiKeyEnv);
  for (const ref of adapter.credentialRefs ?? []) push(ref);

  // 目录里可能声明了原生鉴权的环境变量（例如 ANTHROPIC_API_KEY）。
  const llm = ctx.get("llm");
  if (llm !== undefined) {
    try {
      for (const entry of llm.listConfigurableProviders?.() ?? []) {
        if (entry?.provider !== adapter.id && !(adapter.aliases ?? []).includes(entry?.provider)) continue;
        for (const name of entry?.nativeAuth?.env ?? []) {
          if (CREDENTIAL_NAME_PATTERN.test(name)) push(name);
        }
      }
    } catch (error) {
      diag("读取供应商目录失败", { message: String(error) });
    }
  }
  return candidates;
}

/**
 * 解析出一个可用的凭据。
 *
 * 先问凭据服务（用户在「模型」页里存的那份），再退回环境变量。
 *
 * @param {object} ctx - 宿主上下文。
 * @param {string[]} refs - 候选引用名。
 * @returns {Promise<{value: string, ref: string} | undefined>} 凭据。
 */
async function resolveCredential(ctx, refs) {
  const credentials = ctx.get("credentials");
  for (const ref of refs) {
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(ref);
        if (hit?.value !== undefined && hit.value !== "") return { value: hit.value, ref };
      } catch (error) {
        diag("读取凭据失败", { ref, message: String(error) });
      }
    }
    const ambient = process.env[ref];
    if (ambient !== undefined && ambient !== "") return { value: ambient, ref };
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * 用量 / 余额查询
 * ------------------------------------------------------------------ */

/**
 * 查询当前模型的用量（额度或余额）。
 *
 * @param {object} ctx - 宿主上下文。
 * @param {unknown} payload - 客户端载荷（可带 provider / model）。
 * @returns {Promise<object>} RPC 结果。
 */
async function readQuota(ctx, payload) {
  const selection = await resolveSelection(ctx, payload);
  const provider = selection.provider;
  const profiles = collectProfiles(ctx);
  const directoryBaseUrls = readDirectoryBaseUrls(ctx);
  const adapter = resolveAdapter(provider, profiles, directoryBaseUrls);

  if (adapter === undefined) {
    return {
      ok: true,
      value: {
        provider: provider ?? "",
        providerLabel: provider ?? "",
        model: selection.model ?? "",
        supported: false,
        tiers: [],
        balances: [],
        message:
          provider === undefined || provider === ""
            ? "当前没有选中模型，无法确定要查询哪个供应商的用量。"
            : `供应商 ${provider} 没有可用的用量查询接口。可以手动选择一个支持的供应商查看。`,
        checkedAt: Date.now()
      }
    };
  }

  const profile = profiles.get(provider) ?? profiles.get(adapter.id);
  const baseUrl = baseUrlOf(provider, profiles, directoryBaseUrls);
  const refs = credentialCandidates(adapter, profile, ctx);
  const credential = await resolveCredential(ctx, refs);

  const needsCredential =
    (adapter.credentialRefs?.length ?? 0) > 0 ||
    profile?.apiKeyEnv !== undefined ||
    adapter === RELAY_ADAPTER;
  if (credential === undefined && needsCredential) {
    return {
      ok: false,
      error: {
        code: "missing-credential",
        message: `没有找到 ${adapter.label} 的可用 API Key。请在 DSH 凭据里新增 ${
          refs[0] ?? "对应供应商的 API Key"
        }，或在环境变量中设置同名变量。`,
        details: { provider: adapter.id, refs }
      }
    };
  }

  diag("查询用量", {
    provider: adapter.id,
    model: selection.model,
    baseUrl,
    hasCredential: credential !== undefined
  });

  let result;
  try {
    result = await adapter.query({
      ctx,
      credential: credential?.value ?? "",
      baseUrl,
      timeoutMs: REQUEST_TIMEOUT_MS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diag("用量查询异常", { provider: adapter.id, message });
    return {
      ok: false,
      error: { code: "query-failed", message: `查询 ${adapter.label} 用量失败：${message}`, details: {} }
    };
  }

  if (result?.error !== undefined) {
    return {
      ok: false,
      error: { code: "query-failed", message: `${adapter.label}：${result.error}`, details: { provider: adapter.id } }
    };
  }

  const tiers = Array.isArray(result?.tiers) ? result.tiers : [];
  const balances = Array.isArray(result?.balances) ? result.balances : [];

  return {
    ok: true,
    value: {
      provider: adapter.id,
      providerLabel: adapter.label,
      model: selection.model ?? "",
      supported: true,
      family: adapter.family,
      tiers,
      balances,
      note: typeof result?.note === "string" ? result.note : undefined,
      keyRef: credential?.ref,
      checkedAt: Date.now()
    }
  };
}

/**
 * 列出本插件支持的供应商。
 *
 * @param {object} ctx - 宿主上下文。
 * @returns {Promise<object>} RPC 结果。
 */
async function readProviders(ctx) {
  const profiles = collectProfiles(ctx);
  const directoryBaseUrls = readDirectoryBaseUrls(ctx);
  const providers = [];
  const seen = new Set();
  for (const adapter of listAdapters()) {
    const profile = profiles.get(adapter.id);
    const refs = credentialCandidates(adapter, profile, ctx);
    const credential = refs.length === 0 ? undefined : await resolveCredential(ctx, refs);
    seen.add(adapter.id);
    providers.push({
      ...adapter,
      baseURL: baseUrlOf(adapter.id, profiles, directoryBaseUrls),
      credentialRefs: refs,
      configured: credential !== undefined,
      keyRef: credential?.ref
    });
  }

  // 当前选中的路由若不在固定清单里（例如自建中转站），单独列一条。
  const selection = await resolveSelection(ctx, undefined);
  const current = selection.provider;
  if (typeof current === "string" && current !== "" && !seen.has(current)) {
    const profile = profiles.get(current);
    const baseUrl = baseUrlOf(current, profiles, directoryBaseUrls);
    const refs = [];
    if (typeof profile?.apiKeyEnv === "string") refs.push(profile.apiKeyEnv);
    const credential = refs.length === 0 ? undefined : await resolveCredential(ctx, refs);
    providers.push({
      id: current,
      label: profile?.displayName ?? current,
      family: "balance",
      aliases: [],
      baseURL: baseUrl,
      credentialRefs: refs,
      configured: credential !== undefined,
      keyRef: credential?.ref,
      custom: true
    });
  }

  return { ok: true, value: { providers } };
}

/* ------------------------------------------------------------------ *
 * 跨会话用量聚合
 * ------------------------------------------------------------------ */

/** 跨会话聚合的短缓存，按宿主上下文各存一份。 */
const usageCache = new WeakMap();

/**
 * 读取跨会话的 token 用量（按模型聚合）。
 *
 * @param {object} ctx - 宿主上下文。
 * @returns {Promise<object>} RPC 结果。
 */
async function readUsage(ctx) {
  const query = ctx.get("sessionQuery");
  if (query === undefined) {
    return {
      ok: false,
      error: {
        code: "no-session-query",
        message: "当前组合没有挂载 sessionQuery 服务，无法回放会话日志。",
        details: {}
      }
    };
  }

  let cache = usageCache.get(ctx);
  if (cache === undefined) {
    cache = { at: 0, value: undefined };
    usageCache.set(ctx, cache);
  }

  const now = Date.now();
  if (cache.value !== undefined && now - cache.at < USAGE_CACHE_MS) {
    return { ok: true, value: cache.value };
  }

  let sessions;
  try {
    sessions = await query.listSessions();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "query-failed",
        message: `列出会话失败：${error instanceof Error ? error.message : String(error)}`,
        details: {}
      }
    };
  }

  const selected = sessions.slice(0, MAX_SESSIONS);
  const byModel = new Map();
  const perSession = [];
  const totals = emptyBuckets();

  for (const record of selected) {
    const sessionId = record?.header?.id;
    if (typeof sessionId !== "string") continue;
    let events;
    try {
      // listEvents() 只给轻量记录（seq/type/time/surface），没有 data 负载；
      // 原始事件日志要靠 readSession()。
      const observation = await query.readSession(sessionId);
      events = observation?.events ?? [];
    } catch {
      // 单个会话读失败不影响整体聚合。
      continue;
    }
    const folded = foldUsage(events);
    perSession.push({
      id: sessionId,
      title: record?.header?.title ?? sessionId,
      updatedAt: record?.header?.updatedAt ?? null,
      ...folded.totals
    });
    for (const [model, buckets] of folded.byModel) {
      const target = byModel.get(model) ?? emptyBuckets();
      addBuckets(target, buckets);
      byModel.set(model, target);
    }
    addBuckets(totals, folded.totals);
  }

  const value = {
    byModel: [...byModel.entries()]
      .map(([model, buckets]) => ({ model, ...buckets }))
      .sort((left, right) => right.totalTokens - left.totalTokens),
    perSession: perSession.sort((left, right) => right.totalTokens - left.totalTokens),
    totals,
    sessionCount: selected.length
  };

  cache.at = now;
  cache.value = value;
  return { ok: true, value };
}

/**
 * 新建一组空的 token 计数。
 *
 * @returns {object} 计数对象。
 */
function emptyBuckets() {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 0,
    totalTokens: 0
  };
}

/**
 * 累加一组计数。
 *
 * @param {object} target - 目标。
 * @param {object} source - 来源。
 */
function addBuckets(target, source) {
  target.uncachedInputTokens += source.uncachedInputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.requests += source.requests;
  target.totalTokens += source.totalTokens;
}

/**
 * 回放一个会话的事件，统计 token 用量并按模型归类。
 *
 * 用量的落点有两种，都要用：
 *  - `assistant/message` 上的 `data.usage`（每次尝试的最终结算）；
 *  - `assistant/attempt` 的 `data.stream` 里最后一个带 usage 的分片
 *    （流式尝试的用量；最终消息会用它替换，所以同一次尝试只算一次）。
 *
 * @param {object[]} events - 会话事件（按 seq 升序）。
 * @returns {{byModel: Map<string, object>, totals: object}} 按模型的计数与合计。
 */
function foldUsage(events) {
  const byModel = new Map();
  let model = "unknown";
  let pending = undefined;

  for (const event of events) {
    const type = event?.type;

    if (type === "request/header") {
      const header = event?.data?.header ?? event?.data ?? {};
      const config = header?.config ?? header;
      const next = config?.model ?? header?.model ?? config?.modelId ?? header?.modelId;
      if (typeof next === "string" && next !== "") model = next;
      continue;
    }

    if (type === "assistant/attempt") {
      pending = usageFromStream(event?.data?.stream);
      continue;
    }

    if (type !== "assistant/message") continue;

    const usage = event?.data?.usage ?? pending;
    pending = undefined;
    if (usage === undefined || usage === null) continue;

    const buckets = byModel.get(model) ?? emptyBuckets();
    buckets.uncachedInputTokens += numberOf(usage.inputTokens);
    buckets.outputTokens += numberOf(usage.outputTokens);
    buckets.cacheReadTokens += numberOf(usage.cacheReadTokens);
    buckets.cacheWriteTokens += numberOf(usage.cacheWriteTokens);
    buckets.requests += 1;
    buckets.totalTokens =
      buckets.uncachedInputTokens +
      buckets.outputTokens +
      buckets.cacheReadTokens +
      buckets.cacheWriteTokens;
    byModel.set(model, buckets);
  }

  // 合计由各模型的最终计数累加而来：逐条累加累计值会把同一份用量重复计入。
  const totals = emptyBuckets();
  for (const buckets of byModel.values()) addBuckets(totals, buckets);

  return { byModel, totals };
}

/**
 * 从流式分片里取最后一个带 usage 的用量。
 *
 * @param {unknown} stream - 分片数组。
 * @returns {object | undefined} 用量对象，没有时为 undefined。
 */
function usageFromStream(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const usage = stream[index]?.usage;
    if (usage !== undefined && usage !== null) return usage;
  }
  return undefined;
}

/* 导出纯函数，便于脱离 DSH 运行时做冒烟测试。 */
export {
  foldUsage,
  PROVIDER_ADAPTERS,
  findAdapter,
  findAdapterByBaseUrl,
  listAdapters,
  numberOrNull,
  optionalNumber
};
export { parseCodingPlanTiers } from "./providers.js";
