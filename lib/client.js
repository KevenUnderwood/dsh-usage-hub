/**
 * `dsh-usage-hub` —— 浏览器半边。
 *
 * 渲染三个位置：
 *  - `shell.bottom`：底部状态栏，常驻显示当前供应商的额度/余额与本会话 token 小计；
 *  - `main`：主区整页。顶部是「用量 / 供应商」两个页签——**用量**页只放额度、
 *    当前会话与跨会话统计，**供应商**页单独放可查询的供应商清单，两者不混在一起；
 *  - `conversation.session.header.utilities`：捕获会话的 `tokenUsage` 与
 *    `modelSelection` 投影，供上面两处使用。
 *
 * **自动切换**：会话的 `modelSelection` 投影一变（用户在 DSH 里切模型），
 * 就带着新的 provider 重新查一次用量，状态栏与整页随之更新。
 *
 * 数据全部来自宿主半边（RPC 通道 `/usage-hub`），
 * 当前会话的用量则来自 session scope 里的 `tokenUsage` 投影。
 *
 * 本文件是 DSH 客户端 bundle 的工厂格式：Host 端按 `exports["./client"]`
 * 提供这个文件，浏览器端在物化时执行工厂体。
 */
window.__ModuleLoader__.load({
  id: "dsh-usage-hub",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /** 本插件的文案命名空间。 */
    const NS = "usageHub";
    /** 主区面板 id，与侧边栏入口共用。 */
    const PANEL_ID = "usage-hub";
    /** 宿主半边注册的 RPC 通道。 */
    const RPC_CHANNEL = "/usage-hub";
    /** 自动刷新间隔（毫秒）：10 分钟。 */
    const REFRESH_MS = 10 * 60 * 1000;

    /* ---------------------------------------------------------------- *
     * 文案
     * ---------------------------------------------------------------- */

    const zh = {
      panel: "用量与额度",
      tabUsage: "用量",
      tabProviders: "供应商",
      tokens: "token",
      details: "查看详情",
      loading: "查询中…",
      failed: "查询失败",
      noKey: "未找到 API Key",
      remaining: "剩余",
      used: "已用",
      resetsAt: "重置",
      noQuota: "没有额度数据",
      updatedAt: "更新于",
      refresh: "刷新",
      currentSession: "当前会话",
      history: "跨会话累计",
      byModel: "按模型",
      model: "模型",
      requests: "请求数",
      input: "输入",
      output: "输出",
      cacheRead: "缓存读",
      cacheWrite: "缓存写",
      total: "合计",
      session: "会话",
      noCurrentSession: "当前没有打开的会话",
      noHistory: "还没有可统计的会话",
      provider: "供应商",
      currentProvider: "当前供应商",
      supportedProviders: "支持的供应商",
      unsupported: "该供应商没有用量查询接口",
      noProvider: "未识别供应商",
      selectProvider: "查看",
      viewing: "正在查看",
      backToCurrent: "回到当前模型",
      balance: "余额",
      configured: "已配置凭据",
      notConfigured: "未配置凭据",
      keyRef: "凭据",
      sessions: "会话",
      exhausted: "已耗尽",
      following: "跟随当前模型",
      providerHint: "点「查看」可以单独查询某个供应商的额度；供应商清单与用量分开显示。",
      usageHint: "切换 DSH 里的模型，这里会自动跟着换到对应供应商。",
      tier_five_hour: "5 小时",
      tier_seven_day: "7 天",
      tier_seven_day_opus: "Opus 周限",
      tier_seven_day_sonnet: "Sonnet 周限",
      tier_seven_day_fable: "Fable 周限",
      tier_weekly_limit: "每周",
      tier_monthly: "每月",
      tier_thirty_day: "30 天",
      tier_rolling: "滚动窗",
      tier_credits: "Credits",
      tier_premium_interactions: "高级交互",
      tier_balance: "余额",
      tier_unknown: "未知窗口"
    };

    const en = {
      panel: "Usage & quota",
      tabUsage: "Usage",
      tabProviders: "Providers",
      tokens: "tokens",
      details: "Details",
      loading: "Loading…",
      failed: "Failed",
      noKey: "No API key",
      remaining: "Remaining",
      used: "Used",
      resetsAt: "Resets",
      noQuota: "No quota reported",
      updatedAt: "Updated",
      refresh: "Refresh",
      currentSession: "Current session",
      history: "All sessions",
      byModel: "By model",
      model: "Model",
      requests: "Requests",
      input: "Input",
      output: "Output",
      cacheRead: "Cache read",
      cacheWrite: "Cache write",
      total: "Total",
      session: "Session",
      noCurrentSession: "No session is open",
      noHistory: "No sessions to report yet",
      provider: "Provider",
      currentProvider: "Current provider",
      supportedProviders: "Supported providers",
      unsupported: "This provider has no usage query API",
      noProvider: "Unknown provider",
      selectProvider: "View",
      viewing: "Viewing",
      backToCurrent: "Back to current model",
      balance: "Balance",
      configured: "Credential configured",
      notConfigured: "No credential",
      keyRef: "Credential",
      sessions: "sessions",
      exhausted: "Exhausted",
      following: "Following current model",
      providerHint: "Use “View” to query one provider on its own; the provider list is kept apart from usage.",
      usageHint: "Switch the model in DSH and this follows to that provider automatically.",
      tier_five_hour: "5-hour",
      tier_seven_day: "7-day",
      tier_seven_day_opus: "Opus weekly",
      tier_seven_day_sonnet: "Sonnet weekly",
      tier_seven_day_fable: "Fable weekly",
      tier_weekly_limit: "Weekly",
      tier_monthly: "Monthly",
      tier_thirty_day: "30-day",
      tier_rolling: "Rolling",
      tier_credits: "Credits",
      tier_premium_interactions: "Premium interactions",
      tier_balance: "Balance",
      tier_unknown: "Unknown window"
    };

    /** 时间窗 / 余额条目标识 → 文案键。 */
    const TIER_LABEL_KEYS = {
      five_hour: "tier_five_hour",
      seven_day: "tier_seven_day",
      seven_day_opus: "tier_seven_day_opus",
      seven_day_sonnet: "tier_seven_day_sonnet",
      seven_day_fable: "tier_seven_day_fable",
      weekly_limit: "tier_weekly_limit",
      monthly: "tier_monthly",
      thirty_day: "tier_thirty_day",
      rolling: "tier_rolling",
      credits: "tier_credits",
      premium_interactions: "tier_premium_interactions",
      balance: "tier_balance",
      unknown: "tier_unknown"
    };

    /* ---------------------------------------------------------------- *
     * 样式
     * ---------------------------------------------------------------- */

    /**
     * 插件自己的样式表。
     *
     * 用注入的 `<style>` 而不是一堆内联 style：进度条、页签、悬停态这类
     * 需要伪类与过渡的样式，内联写不出来。
     */
    const CSS = `
.dsh-mu-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
.dsh-mu-page{max-width:840px;margin:0 auto;padding:28px 28px 56px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box}
.dsh-mu-head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
.dsh-mu-headText{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-mu-title{font-size:20px;font-weight:600;line-height:28px;margin:0;color:var(--dsw-alias-label-primary)}
.dsh-mu-subtitle{font-size:13px;line-height:20px;margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-mu-headActions{margin-left:auto;display:flex;align-items:center;gap:8px}
.dsh-mu-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);width:max-content}
.dsh-mu-tab{border:none;background:transparent;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);padding:6px 14px;border-radius:var(--dsw-radius-md,8px);cursor:pointer}
.dsh-mu-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-mu-tab[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dsh-mu-card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl,12px);padding:18px 20px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}
.dsh-mu-cardHead{display:flex;align-items:center;gap:10px}
.dsh-mu-cardTitle{font-size:14px;font-weight:500;line-height:20px;margin:0;color:var(--dsw-alias-label-primary)}
.dsh-mu-cardNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-left:auto;text-align:right}
.dsh-mu-hero{display:flex;flex-direction:column;gap:6px}
.dsh-mu-heroTitle{font-size:16px;font-weight:600;line-height:24px;margin:0;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-mu-heroModel{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);margin:0}
.dsh-mu-metric{display:flex;flex-direction:column;gap:7px}
.dsh-mu-metricHead{display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:20px}
.dsh-mu-metricName{color:var(--dsw-alias-label-primary)}
.dsh-mu-metricValue{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dsh-mu-track{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dsh-mu-fill{height:100%;border-radius:999px;transition:width .35s ease}
.dsh-mu-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-mu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}
.dsh-mu-stat{background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-md,8px);padding:10px 12px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.dsh-mu-statValue{font-size:17px;font-weight:600;line-height:24px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dsh-mu-statLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-mu-tableWrap{overflow-x:auto;margin:0 -4px;padding:0 4px}
.dsh-mu-table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dsh-mu-th{text-align:left;font-weight:400;color:var(--dsw-alias-label-secondary);padding:6px 8px;white-space:nowrap}
.dsh-mu-td{padding:8px;white-space:nowrap}
.dsh-mu-tr+.dsh-mu-tr .dsh-mu-td{border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-mu-num{text-align:right}
.dsh-mu-provider{display:flex;align-items:center;gap:12px;padding:11px 0}
.dsh-mu-provider+.dsh-mu-provider{border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-mu-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.dsh-mu-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary)}
.dsh-mu-providerText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-mu-providerName{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-mu-providerMeta{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mu-providerActions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.dsh-mu-button{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;font:inherit;font-size:12.5px;line-height:18px;padding:5px 12px;cursor:pointer;white-space:nowrap}
.dsh-mu-button:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsh-mu-button[data-variant="primary"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.dsh-mu-button[data-variant="primary"]:hover{filter:brightness(1.06)}
.dsh-mu-button[data-variant="ghost"]{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-mu-button[data-variant="ghost"]:hover{color:var(--dsw-alias-label-primary)}
.dsh-mu-banner{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-mu-banner strong{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-mu-error{font-size:12.5px;line-height:19px;color:var(--dsw-alias-state-error-primary)}
.dsh-mu-muted{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dsh-mu-spin{display:inline-block;animation:dsh-mu-spin 1s linear infinite}
@keyframes dsh-mu-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
`;

    /**
     * 注入样式表（只需一次）。
     */
    function ensureStyles() {
      if (typeof document === "undefined" || document === null) return;
      if (document.getElementById("dsh-usage-hub-style") !== null) return;
      const style = document.createElement("style");
      style.id = "dsh-usage-hub-style";
      style.textContent = CSS;
      (document.head ?? document.documentElement).appendChild(style);
    }

    /* ---------------------------------------------------------------- *
     * 状态存储
     * ---------------------------------------------------------------- */

    /**
     * 建一个最小的可观察存储。
     *
     * @param initial - 初始快照。
     * @returns 带 getSnapshot / subscribe / patch 的存储。
     */
    function createStore(initial) {
      let snapshot = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        patch: (next) => {
          snapshot = { ...snapshot, ...next };
          for (const listener of [...listeners]) listener();
        }
      };
    }

    /* ---------------------------------------------------------------- *
     * 格式化
     * ---------------------------------------------------------------- */

    /**
     * 百分比格式化。
     *
     * @param value - 百分比（0-100）。
     * @returns 形如 `85.5%` 的文本。
     */
    function formatPercent(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "—";
      return `${trimZero(value)}%`;
    }

    /**
     * 金额格式化。
     *
     * @param value - 金额。
     * @param unit - 币种。
     * @returns 紧凑文本。
     */
    function formatMoney(value, unit) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "—";
      const text = Math.abs(value) >= 1000 ? formatTokens(value) : trimZero(value);
      return unit ? `${text} ${unit}` : text;
    }

    /**
     * 时间戳格式化。
     *
     * @param value - 毫秒时间戳。
     * @returns 本地时间文本，无效时为 undefined。
     */
    function formatTime(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
      return new Date(value).toLocaleString();
    }

    /**
     * token 数格式化：按 K / M 缩写。
     *
     * @param value - token 数。
     * @returns 紧凑文本。
     */
    function formatTokens(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "—";
      if (value < 1000) return String(Math.round(value));
      if (value < 1000000) return `${trimZero(value / 1000)}K`;
      return `${trimZero(value / 1000000)}M`;
    }

    /**
     * 去掉多余的小数尾零。
     *
     * @param value - 数值。
     * @returns 文本。
     */
    function trimZero(value) {
      return String(Math.round(value * 10) / 10);
    }

    /**
     * 取一个时间窗 / 余额条目的展示名。
     *
     * @param name - 标识。
     * @param t - 文案函数。
     * @returns 展示名。
     */
    function tierLabel(name, t) {
      const key = TIER_LABEL_KEYS[name];
      return key === undefined ? name : t(key);
    }

    /**
     * 余额条目的行标签：优先用条目名（能区分「Credits」与「余额」），
     * 没有已知名字时退回币种。
     *
     * @param entry - 余额条目。
     * @param t - 文案函数。
     * @returns 行标签。
     */
    function balanceLabel(entry, t) {
      const key = TIER_LABEL_KEYS[entry?.name];
      if (key !== undefined) return t(key);
      if (typeof entry?.unit === "string" && entry.unit !== "") return entry.unit;
      return t("balance");
    }

    /**
     * 按剩余百分比选进度条颜色。
     *
     * @param remaining - 剩余百分比。
     * @returns CSS 颜色。
     */
    function fillColor(remaining) {
      if (remaining <= 0) return "var(--dsw-alias-state-error-primary)";
      if (remaining < 15) return "var(--dsw-alias-state-error-primary)";
      if (remaining < 40) return "var(--dsw-alias-state-warn-primary)";
      return "var(--dsw-alias-state-success-primary)";
    }

    /* ---------------------------------------------------------------- *
     * 组件
     * ---------------------------------------------------------------- */

    /**
     * 侧边栏里的面板图标。
     *
     * @param props - 侧边栏传入的尺寸。
     * @returns 图标元素。
     */
    function UsagePanelIcon({ size }) {
      return jsx(primitives.IconDatabaseOutlineRegular, { size });
    }

    /**
     * 底部状态栏。
     *
     * @param props - 插槽注入的 props。
     * @returns 状态栏元素。
     */
    function BalanceBar({ t, useAccountUsage, openPanel, refresh }) {
      const state = useAccountUsage((snapshot) => snapshot);
      const quota = state.quota;

      let quotaText;
      if (quota.phase === "ready") {
        if (quota.supported === false) {
          quotaText = t("unsupported");
        } else {
          const summary = summarizeQuota(quota, t);
          quotaText = summary === "" ? t("noQuota") : summary;
        }
      } else if (quota.phase === "failed") {
        quotaText = quota.code === "missing-credential" ? t("noKey") : t("failed");
      } else {
        quotaText = t("loading");
      }

      const session = state.session;
      const sessionText =
        session.usage === undefined ? "—" : `${formatTokens(totalTokens(session.usage))} ${t("tokens")}`;

      return jsxs(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 12px",
            fontSize: 12,
            lineHeight: "18px",
            borderTop: "0.5px solid var(--dsw-alias-border-l1)",
            color: "var(--dsw-alias-label-secondary)"
          },
          children: [
            jsx(primitives.IconDatabaseOutlineRegular, { key: "icon", size: 14, "aria-hidden": true }),
            jsx(
              "span",
              {
                key: "provider",
                style: { color: "var(--dsw-alias-label-primary)", fontWeight: 500 },
                children: quota.providerLabel || t("provider")
              }
            ),
            jsxs(
              "span",
              {
                key: "quota-group",
                style: { display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 },
                children: [
                  jsx(
                    "span",
                    {
                      key: "quota-value",
                      style: { fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                      title:
                        quota.checkedAt === null || quota.checkedAt === undefined
                          ? undefined
                          : `${t("updatedAt")} ${new Date(quota.checkedAt).toLocaleTimeString()}`,
                      children: quotaText
                    }
                  ),
                  refreshIcon(t, quota.phase === "loading", () => refresh())
                ]
              }
            ),
            jsx("span", { key: "sep", style: { opacity: 0.45 }, children: "·" }),
            jsx("span", { key: "session-label", children: t("currentSession") }),
            jsx(
              "span",
              {
                key: "session-value",
                style: { fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-primary)" },
                children: sessionText
              }
            ),
            jsx(
              "button",
              {
                key: "details",
                type: "button",
                onClick: openPanel,
                className: "dsh-mu-button",
                "data-variant": "ghost",
                style: { marginLeft: "auto" },
                children: t("details")
              }
            )
          ]
        }
      );
    }

    /**
     * 把额度 / 余额折叠成一行短文本。
     *
     * @param quota - 额度状态。
     * @param t - 文案函数。
     * @returns 短文本。
     */
    function summarizeQuota(quota, t) {
      const tiers = quota.tiers ?? [];
      if (tiers.length > 0) {
        return tiers
          .map((tier) => `${tierLabel(tier.name, t)} ${formatPercent(tier.remainingPercent)}`)
          .join(" · ");
      }
      const balances = quota.balances ?? [];
      if (balances.length > 0) {
        return balances
          .map((entry) => `${balanceLabel(entry, t)} ${formatMoney(entry.remaining, entry.unit)}`)
          .join(" · ");
      }
      return "";
    }

    /**
     * 主区整页。
     *
     * @param props - 插槽注入的 props。
     * @returns 页面元素。
     */
    function UsagePage({ t, useAccountUsage, refresh, backToCurrent }) {
      const state = useAccountUsage((snapshot) => snapshot);
      const [tab, setTab] = react.useState("usage");

      return jsxs(
        "div",
        {
          className: "dsh-mu-scroll",
          children: jsxs(
            "div",
            {
              className: "dsh-mu-page",
              children: [
                jsxs(
                  "div",
                  {
                    key: "head",
                    className: "dsh-mu-head",
                    children: [
                      jsxs(
                        "div",
                        {
                          key: "headText",
                          className: "dsh-mu-headText",
                          children: [
                            jsx("h1", { key: "title", className: "dsh-mu-title", children: t("panel") }),
                            jsx("p", {
                              key: "subtitle",
                              className: "dsh-mu-subtitle",
                              children: tab === "usage" ? t("usageHint") : t("providerHint")
                            })
                          ]
                        }
                      ),
                      jsx(
                        "div",
                        {
                          key: "actions",
                          className: "dsh-mu-headActions",
                          children: refreshIcon(t, state.quota.phase === "loading", () => refresh())
                        }
                      )
                    ]
                  },
                  "head"
                ),
                jsxs(
                  "div",
                  {
                    key: "tabs",
                    className: "dsh-mu-tabs",
                    role: "tablist",
                    children: [
                      tabButton(t, "usage", t("tabUsage"), tab, setTab),
                      tabButton(t, "providers", t("tabProviders"), tab, setTab)
                    ]
                  },
                  "tabs"
                ),
                tab === "usage"
                  ? jsxs(
                      "div",
                      {
                        key: "usage",
                        style: { display: "flex", flexDirection: "column", gap: 18 },
                        children: [
                          quotaCard(t, state, refresh, backToCurrent),
                          sessionCard(t, state.session),
                          historyCard(t, state.usage)
                        ]
                      },
                      "usage"
                    )
                  : jsxs(
                      "div",
                      {
                        key: "providers",
                        style: { display: "flex", flexDirection: "column", gap: 18 },
                        children: providersCard(t, state, refresh, () => setTab("usage"))
                      },
                      "providers"
                    )
              ]
            }
          )
        }
      );
    }

    /**
     * 一个页签按钮。
     *
     * @param t - 文案函数。
     * @param id - 页签标识。
     * @param label - 展示名。
     * @param active - 当前页签。
     * @param setTab - 切换回调。
     * @returns 按钮元素。
     */
    function tabButton(t, id, label, active, setTab) {
      return jsx(
        "button",
        {
          key: id,
          type: "button",
          role: "tab",
          "aria-selected": active === id,
          "data-active": active === id ? "true" : "false",
          className: "dsh-mu-tab",
          onClick: () => setTab(id),
          children: label
        }
      );
    }

    /**
     * 额度 / 余额卡片。
     *
     * @param t - 文案函数。
     * @param state - 整体状态。
     * @param refresh - 手动刷新回调。
     * @param backToCurrent - 回到「跟随当前模型」的回调。
     * @returns 卡片元素。
     */
    function quotaCard(t, state, refresh, backToCurrent) {
      const quota = state.quota;
      const children = [];

      if (state.override !== undefined) {
        children.push(
          jsxs(
            "div",
            {
              key: "banner",
              className: "dsh-mu-banner",
              children: [
                jsx("span", { key: "text", children: t("viewing") }),
                jsx("strong", { key: "name", children: quota.providerLabel || quota.provider }),
                jsx(
                  "button",
                  {
                    key: "back",
                    type: "button",
                    className: "dsh-mu-button",
                    "data-variant": "ghost",
                    style: { marginLeft: "auto" },
                    onClick: backToCurrent,
                    children: t("backToCurrent")
                  }
                )
              ]
            },
            "banner"
          )
        );
      }

      const hasData = (quota.tiers ?? []).length > 0 || (quota.balances ?? []).length > 0;

      // 查询失败时保留上一次成功的数据，只在前面补一条错误提示。
      if (quota.phase === "failed") {
        children.push(
          jsx("div", { key: "error", className: "dsh-mu-error", role: "status", children: quota.message })
        );
      }
      if (quota.phase === "loading" && !hasData) {
        children.push(jsx("div", { key: "loading", className: "dsh-mu-muted", children: t("loading") }));
      }
      if (quota.supported === false) {
        children.push(
          jsx("div", { key: "none", className: "dsh-mu-muted", children: quota.message || t("unsupported") })
        );
      } else if (hasData || quota.phase === "ready") {
        children.push(
          jsxs(
            "div",
            {
              key: "hero",
              className: "dsh-mu-hero",
              children: [
                jsxs("h2", {
                  key: "title",
                  className: "dsh-mu-heroTitle",
                  children: [
                    jsx("span", { key: "name", children: quota.providerLabel || quota.provider || t("noProvider") }),
                    quota.model === ""
                      ? null
                      : jsx("span", { key: "model", className: "dsh-mu-subtitle", children: quota.model })
                  ]
                }),
                quota.note === undefined || quota.note === ""
                  ? null
                  : jsx("p", { key: "note", className: "dsh-mu-subtitle", children: quota.note })
              ]
            },
            "hero"
          )
        );

        for (const tier of quota.tiers ?? []) {
          children.push(
            jsxs(
              "div",
              {
                key: `tier-${tier.name}`,
                className: "dsh-mu-metric",
                children: [
                  jsxs(
                    "div",
                    {
                      key: "head",
                      className: "dsh-mu-metricHead",
                      children: [
                        jsx("span", { key: "name", className: "dsh-mu-metricName", children: tierLabel(tier.name, t) }),
                        jsx("span", {
                          key: "value",
                          className: "dsh-mu-metricValue",
                          children:
                            tier.exhausted === true
                              ? `${formatPercent(tier.remainingPercent)} · ${t("exhausted")}`
                              : `${t("remaining")} ${formatPercent(tier.remainingPercent)}`
                        })
                      ]
                    },
                    "head"
                  ),
                  jsxs(
                    "div",
                    {
                      key: "track",
                      className: "dsh-mu-track",
                      children: jsx("div", {
                        key: "fill",
                        className: "dsh-mu-fill",
                        style: {
                          width: `${Math.max(0, Math.min(100, tier.remainingPercent ?? 0))}%`,
                          background: fillColor(tier.remainingPercent)
                        }
                      })
                    },
                    "track"
                  ),
                  jsxs(
                    "div",
                    {
                      key: "meta",
                      className: "dsh-mu-meta",
                      children: [
                        jsx("span", { key: "used", children: `${t("used")} ${formatPercent(tier.usedPercent)}` }),
                        formatTime(tier.resetsAt) === undefined
                          ? null
                          : jsx("span", {
                              key: "resets",
                              children: `${t("resetsAt")} ${formatTime(tier.resetsAt)}`
                            })
                      ]
                    },
                    "meta"
                  )
                ]
              },
              `tier-${tier.name}`
            )
          );
        }

        for (const entry of quota.balances ?? []) {
          children.push(
            jsxs(
              "div",
              {
                key: `balance-${entry.name}`,
                className: "dsh-mu-metric",
                children: [
                  jsxs(
                    "div",
                    {
                      key: "head",
                      className: "dsh-mu-metricHead",
                      children: [
                        jsx("span", { key: "name", className: "dsh-mu-metricName", children: balanceLabel(entry, t) }),
                        jsx("span", {
                          key: "value",
                          className: "dsh-mu-metricValue",
                          children: formatMoney(entry.remaining, entry.unit)
                        })
                      ]
                    },
                    "head"
                  ),
                  typeof entry.total === "number" && typeof entry.used === "number"
                    ? jsxs(
                        "div",
                        {
                          key: "meta",
                          className: "dsh-mu-meta",
                          children: [
                            jsx("span", { key: "used", children: `${t("used")} ${formatMoney(entry.used, entry.unit)}` }),
                            jsx("span", { key: "total", children: `${t("total")} ${formatMoney(entry.total, entry.unit)}` })
                          ]
                        },
                        "meta"
                      )
                    : null
                ]
              },
              `balance-${entry.name}`
            )
          );
        }

        if ((quota.tiers ?? []).length === 0 && (quota.balances ?? []).length === 0) {
          children.push(jsx("div", { key: "none", className: "dsh-mu-muted", children: t("noQuota") }));
        }
      }

      if (quota.checkedAt !== null && quota.checkedAt !== undefined && quota.phase === "ready") {
        children.push(
          jsx("div", {
            key: "updated",
            className: "dsh-mu-muted",
            children: `${t("updatedAt")} ${new Date(quota.checkedAt).toLocaleString()}`
          })
        );
      }

      return jsxs(
        "section",
        {
          key: "quota",
          className: "dsh-mu-card",
          children: [
            jsxs(
              "div",
              {
                key: "head",
                className: "dsh-mu-cardHead",
                children: [
                  jsx("h3", { key: "title", className: "dsh-mu-cardTitle", children: t("currentProvider") }),
                  jsx("span", {
                    key: "note",
                    className: "dsh-mu-cardNote",
                    children: quota.keyRef === undefined ? "" : `${t("keyRef")}: ${quota.keyRef}`
                  })
                ]
              },
              "head"
            ),
            ...children
          ]
        },
        "quota"
      );
    }

    /**
     * 供应商清单卡片（独立页签，不与用量混在一起）。
     *
     * @param t - 文案函数。
     * @param state - 整体状态。
     * @param refresh - 手动刷新回调。
     * @param onView - 查看某个供应商后的回调（切回用量页）。
     * @returns 卡片元素。
     */
    function providersCard(t, state, refresh, onView) {
      const providers = state.providers;
      const list = providers.list ?? [];

      const body = [];
      if (providers.phase === "loading" && list.length === 0) {
        body.push(jsx("div", { key: "loading", className: "dsh-mu-muted", children: t("loading") }));
      } else if (list.length === 0) {
        body.push(jsx("div", { key: "none", className: "dsh-mu-muted", children: t("noProvider") }));
      } else {
        for (const entry of list) {
          const viewing = state.override === entry.id;
          body.push(
            jsxs(
              "div",
              {
                key: entry.id,
                className: "dsh-mu-provider",
                children: [
                  jsx("span", {
                    key: "dot",
                    className: "dsh-mu-dot",
                    "data-on": entry.configured === true ? "true" : "false",
                    title: entry.configured === true ? t("configured") : t("notConfigured")
                  }),
                  jsxs(
                    "div",
                    {
                      key: "text",
                      className: "dsh-mu-providerText",
                      children: [
                        jsx("span", { key: "name", className: "dsh-mu-providerName", children: entry.label }),
                        jsx("span", {
                          key: "meta",
                          className: "dsh-mu-providerMeta",
                          children:
                            entry.configured === true
                              ? `${entry.keyRef ?? ""} · ${entry.baseURL ?? entry.id}`
                              : `${t("notConfigured")} · ${entry.baseURL ?? entry.id}`
                        })
                      ]
                    },
                    "text"
                  ),
                  jsx(
                    "div",
                    {
                      key: "actions",
                      className: "dsh-mu-providerActions",
                      children: jsx(
                        "button",
                        {
                          key: "view",
                          type: "button",
                          className: "dsh-mu-button",
                          "data-variant": viewing ? "primary" : undefined,
                          onClick: () => {
                            refresh(entry.id);
                            onView();
                          },
                          children: viewing ? t("viewing") : t("selectProvider")
                        }
                      )
                    },
                    "actions"
                  )
                ]
              },
              entry.id
            )
          );
        }
      }

      return jsxs(
        "section",
        {
          key: "providers",
          className: "dsh-mu-card",
          children: [
            jsxs(
              "div",
              {
                key: "head",
                className: "dsh-mu-cardHead",
                children: [
                  jsx("h3", { key: "title", className: "dsh-mu-cardTitle", children: t("supportedProviders") }),
                  jsx("span", { key: "note", className: "dsh-mu-cardNote", children: `${list.length}` })
                ]
              },
              "head"
            ),
            ...body
          ]
        },
        "providers"
      );
    }

    /**
     * 当前会话卡片。
     *
     * @param t - 文案函数。
     * @param session - 当前会话状态。
     * @returns 卡片元素。
     */
    function sessionCard(t, session) {
      const body =
        session.usage === undefined
          ? [jsx("div", { key: "none", className: "dsh-mu-muted", children: t("noCurrentSession") })]
          : [
              jsxs(
                "div",
                {
                  key: "grid",
                  className: "dsh-mu-grid",
                  children: [
                    stat(t("input"), formatTokens(session.usage.uncachedInputTokens ?? 0)),
                    stat(t("output"), formatTokens(session.usage.outputTokens ?? 0)),
                    stat(t("cacheRead"), formatTokens(session.usage.cacheReadTokens ?? 0)),
                    stat(t("cacheWrite"), formatTokens(session.usage.cacheWriteTokens ?? 0)),
                    stat(t("total"), formatTokens(totalTokens(session.usage)))
                  ]
                },
                "grid"
              )
            ];

      return jsxs(
        "section",
        {
          key: "session",
          className: "dsh-mu-card",
          children: [
            jsx("h3", { key: "title", className: "dsh-mu-cardTitle", children: t("currentSession") }),
            ...body
          ]
        },
        "session"
      );
    }

    /**
     * 一个统计块。
     *
     * @param label - 标签。
     * @param value - 数值文本。
     * @returns 元素。
     */
    function stat(label, value) {
      return jsxs(
        "div",
        {
          key: label,
          className: "dsh-mu-stat",
          children: [
            jsx("span", { key: "value", className: "dsh-mu-statValue", children: value }),
            jsx("span", { key: "label", className: "dsh-mu-statLabel", children: label })
          ]
        }
      );
    }

    /**
     * 跨会话累计卡片。
     *
     * @param t - 文案函数。
     * @param usage - 聚合状态。
     * @returns 卡片元素。
     */
    function historyCard(t, usage) {
      const body = [];
      if (usage.phase === "failed") {
        body.push(jsx("div", { key: "error", className: "dsh-mu-error", children: usage.message }));
      } else if (usage.phase !== "ready") {
        body.push(jsx("div", { key: "loading", className: "dsh-mu-muted", children: t("loading") }));
      } else {
        const byModel = usage.byModel ?? [];
        if (byModel.length === 0) {
          body.push(jsx("div", { key: "none", className: "dsh-mu-muted", children: t("noHistory") }));
        } else {
          const headers = [t("model"), t("requests"), t("input"), t("output"), t("cacheRead"), t("total")];
          body.push(
            jsxs(
              "div",
              {
                key: "table",
                className: "dsh-mu-tableWrap",
                children: jsxs(
                  "table",
                  {
                    className: "dsh-mu-table",
                    children: [
                      jsx(
                        "thead",
                        {
                          key: "head",
                          children: jsx(
                            "tr",
                            {
                              children: headers.map((label, index) =>
                                jsx(
                                  "th",
                                  {
                                    key: `h-${index}`,
                                    className: `dsh-mu-th${index === 0 ? "" : " dsh-mu-num"}`,
                                    children: label
                                  }
                                )
                              )
                            }
                          )
                        },
                        "head"
                      ),
                      jsx(
                        "tbody",
                        {
                          key: "body",
                          children: byModel.map((entry) =>
                            jsxs(
                              "tr",
                              {
                                key: entry.model,
                                className: "dsh-mu-tr",
                                children: [
                                  cell(entry.model, false, "m"),
                                  cell(String(entry.requests), true, "r"),
                                  cell(formatTokens(entry.uncachedInputTokens), true, "i"),
                                  cell(formatTokens(entry.outputTokens), true, "o"),
                                  cell(formatTokens(entry.cacheReadTokens), true, "c"),
                                  cell(formatTokens(entry.totalTokens), true, "t")
                                ]
                              },
                              entry.model
                            )
                          )
                        },
                        "body"
                      )
                    ]
                  },
                  "table"
                )
              },
              "table"
            )
          );
          body.push(
            jsx("div", {
              key: "footer",
              className: "dsh-mu-muted",
              children: `${t("total")} ${formatTokens(usage.totals?.totalTokens ?? 0)} ${t("tokens")} · ${usage.sessionCount ?? 0} ${t("sessions")}`
            })
          );
        }
      }

      return jsxs(
        "section",
        {
          key: "history",
          className: "dsh-mu-card",
          children: [
            jsx("h3", { key: "title", className: "dsh-mu-cardTitle", children: t("history") }),
            ...body
          ]
        },
        "history"
      );
    }

    /**
     * 表格单元格。
     *
     * @param value - 文本。
     * @param numeric - 是否右对齐。
     * @param key - 单元格标识（同一行内必须唯一）。
     * @returns 元素。
     */
    function cell(value, numeric, key) {
      return jsx("td", {
        key,
        className: `dsh-mu-td${numeric ? " dsh-mu-num" : ""}`,
        children: value
      });
    }

    /**
     * 卡片标题右侧的刷新图标：查询中时旋转。
     *
     * @param t - 文案函数。
     * @param spinning - 是否正在加载。
     * @param onClick - 点击回调。
     * @returns 图标按钮。
     */
    function refreshIcon(t, spinning, onClick) {
      return jsx(
        "button",
        {
          key: "refresh-icon",
          type: "button",
          onClick,
          title: t("refresh"),
          "aria-label": t("refresh"),
          className: "dsh-mu-button",
          style: { display: "inline-flex", alignItems: "center", justifyContent: "center" },
          children: jsx(
            "span",
            {
              className: spinning ? "dsh-mu-spin" : undefined,
              style: { display: "inline-flex" },
              children: jsx(primitives.IconRefreshOutlineRegular, { size: 14 })
            }
          )
        }
      );
    }

    /**
     * 当前会话用量的捕获器。
     *
     * 它渲染在 session scope 里，因此能读到 `tokenUsage` 与 `modelSelection`
     * 两个投影；读到后把数据写进共享存储，供 root scope 的状态栏与整页使用。
     *
     * `modelSelection` 变了就通知外部重新查用量——这就是「在 DSH 里切模型，
     * 用量查询自动跟着换供应商」。
     *
     * @param props - 插槽注入的 props。
     * @returns null。
     */
    function SessionUsageCapture({ useProjection, publish, publishSelection }) {
      const usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      const selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;
      const current = selection?.next ?? selection?.lastUsed ?? undefined;
      const provider = current?.provider;
      const model = current?.model;

      react.useEffect(() => {
        publish(usage);
      }, [usage, publish]);

      react.useEffect(() => {
        publishSelection(provider, model);
      }, [provider, model, publishSelection]);

      return null;
    }

    /**
     * 计算一组用量的 token 总量。
     *
     * @param usage - 用量对象。
     * @returns 总量。
     */
    function totalTokens(usage) {
      return (
        (usage.uncachedInputTokens ?? 0) +
        (usage.outputTokens ?? 0) +
        (usage.cacheReadTokens ?? 0) +
        (usage.cacheWriteTokens ?? 0)
      );
    }

    /* ---------------------------------------------------------------- *
     * 插件主体
     * ---------------------------------------------------------------- */

    /** 客户端需要的服务：插槽、语言、Connection（RPC）、布局（切面板）。 */
    const inject = ["slots", "locale", "connection", "layout"];

    /**
     * 挂载本插件。
     *
     * @param ctx - 客户端 Cordis 上下文。
     */
    function apply(ctx) {
      ensureStyles();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage-hub: 文案");
      const t = ctx.locale.bind(NS);

      const store = createStore({
        quota: {
          phase: "idle",
          provider: "",
          providerLabel: "",
          model: "",
          supported: true,
          family: "tiers",
          tiers: [],
          balances: [],
          note: undefined,
          checkedAt: null,
          message: "",
          code: ""
        },
        usage: { phase: "idle", byModel: [], perSession: [], totals: undefined, sessionCount: 0, message: "" },
        session: { id: undefined, title: undefined, usage: undefined },
        providers: { phase: "idle", list: [] },
        /** 手动指定的供应商 id；undefined 表示跟着当前模型走。 */
        override: undefined,
        /** 当前会话选中的 provider / model。 */
        selection: { provider: undefined, model: undefined }
      });

      /**
       * 订阅状态存储。
       *
       * @param selector - 选择器。
       * @returns 选中的状态。
       */
      function useAccountUsage(selector) {
        const snapshot = react.useSyncExternalStore(
          store.subscribe,
          store.getSnapshot,
          store.getSnapshot
        );
        return selector === undefined ? snapshot : selector(snapshot);
      }

      /**
       * 发布当前会话的 token 用量。
       *
       * @param sessionId - 会话 id。
       * @param usage - 用量对象。
       */
      function publishSessionUsage(sessionId, usage) {
        store.patch({ session: { ...store.getSnapshot().session, id: sessionId, usage } });
      }

      /**
       * 发布当前会话选中的模型。
       *
       * provider 变了就把「手动指定」清掉，并重新查一次用量。
       *
       * @param provider - 供应商路由 id。
       * @param model - 模型 id。
       */
      function publishSelection(provider, model) {
        const previous = store.getSnapshot().selection;
        if (previous.provider === provider && previous.model === model) return;
        store.patch({ selection: { provider, model } });
        // 用户在 DSH 里切了模型 → 回到「跟着当前模型」并立刻重查。
        if (store.getSnapshot().override !== undefined) {
          store.patch({ override: undefined });
          void refreshQuota();
          return;
        }
        if (provider !== previous.provider) void refreshQuota();
      }

      /**
       * 读取额度 / 余额。
       *
       * @param provider - 指定供应商 id；不传则跟着当前模型。
       */
      async function refreshQuota(provider) {
        const snapshot = store.getSnapshot();
        const target = provider ?? snapshot.override ?? snapshot.selection.provider;
        if (typeof provider === "string") store.patch({ override: provider });
        store.patch({ quota: { ...snapshot.quota, phase: "loading" } });
        try {
          const result = await ctx.connection.rpc.call(RPC_CHANNEL, "quota", {
            ...(target === undefined ? {} : { provider: target }),
            ...(snapshot.selection.model === undefined ? {} : { model: snapshot.selection.model })
          });
          if (result?.ok === true) {
            const value = result.value ?? {};
            store.patch({
              quota: {
                phase: "ready",
                provider: value.provider ?? "",
                providerLabel: value.providerLabel ?? value.provider ?? "",
                model: value.model ?? "",
                supported: value.supported !== false,
                family: value.family ?? "tiers",
                tiers: value.tiers ?? [],
                balances: value.balances ?? [],
                note: value.note,
                checkedAt: value.checkedAt ?? Date.now(),
                message: value.message ?? "",
                code: ""
              }
            });
            return;
          }
          store.patch({
            quota: {
              ...store.getSnapshot().quota,
              phase: "failed",
              code: result?.error?.code ?? "unknown",
              message: result?.error?.message ?? "查询失败"
            }
          });
        } catch (error) {
          store.patch({
            quota: {
              ...store.getSnapshot().quota,
              phase: "failed",
              code: "transport",
              message: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }

      /**
       * 读取跨会话用量。
       */
      async function refreshUsage() {
        store.patch({ usage: { ...store.getSnapshot().usage, phase: "loading" } });
        try {
          const result = await ctx.connection.rpc.call(RPC_CHANNEL, "usage", {});
          if (result?.ok === true) {
            const value = result.value ?? {};
            store.patch({
              usage: {
                phase: "ready",
                byModel: value.byModel ?? [],
                perSession: value.perSession ?? [],
                totals: value.totals,
                sessionCount: value.sessionCount ?? 0,
                message: ""
              }
            });
            return;
          }
          store.patch({
            usage: {
              ...store.getSnapshot().usage,
              phase: "failed",
              message: result?.error?.message ?? "查询失败"
            }
          });
        } catch (error) {
          store.patch({
            usage: {
              ...store.getSnapshot().usage,
              phase: "failed",
              message: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }

      /**
       * 读取支持的供应商清单。
       */
      async function refreshProviders() {
        store.patch({ providers: { ...store.getSnapshot().providers, phase: "loading" } });
        try {
          const result = await ctx.connection.rpc.call(RPC_CHANNEL, "providers", {});
          if (result?.ok === true) {
            store.patch({
              providers: { phase: "ready", list: result.value?.providers ?? [] }
            });
            return;
          }
          store.patch({
            providers: { ...store.getSnapshot().providers, phase: "failed", list: [] }
          });
        } catch {
          store.patch({
            providers: { ...store.getSnapshot().providers, phase: "failed", list: [] }
          });
        }
      }

      /**
       * 刷新全部数据。
       *
       * @param provider - 可选：手动指定要查看的供应商。非字符串（例如点击事件）
       *   一律按「不指定」处理，避免把事件对象当成供应商 id。
       */
      function refresh(provider) {
        void refreshQuota(typeof provider === "string" ? provider : undefined);
        void refreshUsage();
        void refreshProviders();
      }

      /**
       * 回到「跟随当前模型」：清掉手动指定的供应商。
       */
      function backToCurrent() {
        store.patch({ override: undefined });
        void refreshQuota();
        void refreshUsage();
        void refreshProviders();
      }

      refresh();
      ctx.effect(() => {
        const timer = setInterval(() => refresh(), REFRESH_MS);
        return () => clearInterval(timer);
      }, "usage-hub: 定时刷新");

      const openPanel = () => ctx.layout.selectPanel(PANEL_ID);
      const shared = { useAccountUsage, refresh, backToCurrent, openPanel };

      ctx.slots.inject("shell.bottom", () =>
        ctx.slots.register(
          {
            name: "shell.bottom",
            locale: NS,
            inject: () => shared
          },
          BalanceBar
        )
      );

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
            inject: () => shared
          },
          UsagePage
        )
      );

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 5,
            label: () => t("panel"),
            locale: NS
          },
          UsagePanelIcon
        )
      );

      // session scope：把当前会话的 token 用量与模型选择同步到共享存储。
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "model-usage-capture",
            order: 100,
            locale: NS,
            inject: (sessionId) => ({
              publish: (usage) => publishSessionUsage(sessionId, usage),
              publishSelection: (provider, model) => publishSelection(provider, model)
            })
          },
          SessionUsageCapture
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.NS = NS;
    exports.PANEL_ID = PANEL_ID;
    return module.exports;
  }
});
