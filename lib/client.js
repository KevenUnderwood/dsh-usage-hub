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
    /**
     * 设置页的主区面板 id。
     *
     * 设置页只从「用量与额度」页的齿轮进入，所以**不**注册 `sidebar.panellist`
     * 入口——侧边栏里不会出现第二个本插件的面板。
     */
    const SETTINGS_PANEL_ID = "usage-hub-settings";
    /**
     * 本插件的 Config 命名空间。
     *
     * 它等于 profile 条目 id（`cordis.patch.yml` 里的 `id: "usage-hub"`），
     * 也是宿主 `settings.describe` 报告出来的 `ns`。
     */
    const CONFIG_NS = "usage-hub";
    /** 宿主半边注册的 RPC 通道。 */
    const RPC_CHANNEL = "/usage-hub";
    /** 自动刷新间隔的默认档（毫秒）：10 分钟。 */
    const DEFAULT_REFRESH_MS = 600000;
    /**
     * 自动刷新间隔的可选档位。
     *
     * 与宿主半边 `lib/index.js` 里的 `REFRESH_INTERVALS` 一一对应：
     * 5 秒 / 60 秒 / 10 分钟 / 30 分钟 / 1 小时。
     */
    const REFRESH_OPTIONS = [5000, 60000, 600000, 1800000, 3600000];

    /**
     * 状态栏里当前会话 token 数的写法。
     *
     * `compact` 是缩写（`120.0K token`），`full` 是完整数字（`120,000 token`）。
     */
    const TOKEN_DISPLAYS = ["compact", "full"];

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
      tier_unknown: "未知窗口",
      settings: "设置",
      settingsTitle: "用量中心设置",
      settingsCardTitle: "配置项",
      settingsHint: "这里的配置写回本插件在 profile 里的条目，保存后立刻生效。",
      backToUsage: "返回用量",
      save: "保存",
      saved: "已保存",
      saveFailed: "保存失败",
      settingsUnavailable: "设置不可用：当前 DSH 没有提供配置服务。",
      settingsReadonly: "当前配置是只读的，改不了。",
      saveRejected: "宿主拒绝了这次写入",
      restartHint: "宿主可能还在用旧的配置结构，重启 DSH 后再试一次",
      fieldRefreshInterval: "自动刷新间隔",
      interval5s: "5 秒",
      interval60s: "60 秒",
      interval10m: "10 分钟",
      interval30m: "30 分钟",
      interval1h: "1 小时",
      refreshIntervalHint: "每隔多久重新查一次用量；5 秒会频繁请求供应商接口。",
      fieldShowQuickRefresh: "显示快捷刷新按钮",
      showQuickRefreshHint: "在窗口左下角的状态栏里放一个立即刷新的按钮；关掉后那里只剩余额和用量。",
      fieldTokenDisplay: "状态栏的 token 写法",
      tokenDisplayHint: "窗口左下角状态栏里当前会话的 token 数怎么写：完整是 120,000，紧凑是 120.0K。",
      tokenDisplayFull: "完整",
      tokenDisplayCompact: "紧凑"
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
      tier_unknown: "Unknown window",
      settings: "Settings",
      settingsTitle: "Usage hub settings",
      settingsCardTitle: "Configuration",
      settingsHint: "These values are written back to this plugin's profile entry and take effect immediately.",
      backToUsage: "Back to usage",
      save: "Save",
      saved: "Saved",
      saveFailed: "Save failed",
      settingsUnavailable: "Settings are unavailable: this DSH build exposes no configuration service.",
      settingsReadonly: "This configuration is read-only and cannot be changed.",
      saveRejected: "The host rejected this write",
      restartHint: "The host may still be running the old config schema — restart DSH and try again",
      fieldRefreshInterval: "Auto refresh interval",
      interval5s: "5 seconds",
      interval60s: "60 seconds",
      interval10m: "10 minutes",
      interval30m: "30 minutes",
      interval1h: "1 hour",
      refreshIntervalHint: "How often usage is re-queried; 5 seconds hits the provider APIs often.",
      fieldShowQuickRefresh: "Show quick refresh button",
      showQuickRefreshHint: "Puts an immediate refresh button in the status bar at the bottom of the window; with it off only quota and usage remain.",
      fieldTokenDisplay: "Status bar token style",
      tokenDisplayHint: "How the current session's token count is written in the status bar: full is 120,000, compact is 120.0K.",
      tokenDisplayFull: "Full",
      tokenDisplayCompact: "Compact"
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
.dsh-mu-button[data-variant="save"]{background:#43454a;border:.5px solid #555658;color:#fff}
.dsh-mu-button[data-variant="save"]:hover{background:#4b4d53;border-color:#555658}
.dsh-mu-button[data-variant="ghost"]{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-mu-button[data-variant="ghost"]:hover{color:var(--dsw-alias-label-primary)}
.dsh-mu-banner{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-mu-banner strong{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-mu-error{font-size:12.5px;line-height:19px;color:var(--dsw-alias-state-error-primary)}
/* 保存失败的原因：独占一行，别把按钮那排挤歪。 */
.dsh-mu-errorDetail{flex-basis:100%;margin:0;word-break:break-word}
.dsh-mu-muted{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dsh-mu-field{display:flex;align-items:center;gap:24px;padding:14px 0}
.dsh-mu-field+.dsh-mu-field{border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-mu-field[data-wide="true"]{align-items:stretch;flex-direction:column;gap:8px}
.dsh-mu-fieldText{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.dsh-mu-fieldLabel{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-mu-fieldControl{flex:none;display:flex;align-items:center;gap:8px}
.dsh-mu-field[data-wide="true"] .dsh-mu-fieldControl{width:100%}
.dsh-mu-input,.dsh-mu-textarea{font:inherit;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);padding:5px 10px;box-sizing:border-box;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}
.dsh-mu-input{min-width:120px;width:120px;text-align:right}
.dsh-mu-inputWide{width:260px;text-align:left}
.dsh-mu-textarea{min-height:76px;resize:vertical;width:100%}
.dsh-mu-input:focus,.dsh-mu-textarea:focus{outline:none;border-color:var(--dsw-alias-border-l1)}
.dsh-mu-input:disabled,.dsh-mu-textarea:disabled{opacity:.55;cursor:not-allowed}
/* 下拉框：去掉原生外观，箭头自己画——系统箭头在深浅两套配色下长相不一致。
   填充/描边跟宿主自己的输入框一致（bg-layer-3 + border-l4 发丝线），这样它看起来
   是这个应用里的一个控件，而不是一个掉进来的系统下拉框。 */
.dsh-mu-selectWrap{position:relative;display:inline-flex;flex:none;align-items:center}
.dsh-mu-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);height:34px;min-width:132px;max-width:200px;padding:0 32px 0 12px;box-sizing:border-box;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .15s ease}
.dsh-mu-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}
.dsh-mu-select:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dsh-mu-select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-mu-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dsh-mu-selectWrap::after{content:"";position:absolute;right:12px;top:50%;width:7px;height:7px;margin-top:-5px;border-right:1.5px solid var(--dsw-alias-label-secondary);border-bottom:1.5px solid var(--dsw-alias-label-secondary);border-radius:1.5px;transform:rotate(45deg);pointer-events:none;transition:transform .18s ease,border-color .15s ease}
.dsh-mu-selectWrap:hover::after{border-color:var(--dsw-alias-label-primary)}
.dsh-mu-selectWrap[data-open="true"]::after{margin-top:-2px;transform:rotate(-135deg);border-color:var(--dsw-alias-label-primary)}
.dsh-mu-selectWrap[data-disabled="true"]{opacity:.55}
.dsh-mu-selectWrap[data-disabled="true"]::after{border-color:var(--dsw-alias-label-secondary)}
.dsh-mu-select option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-mu-select option:checked{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mu-checkBox{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary)}
.dsh-mu-checkBox:disabled{opacity:.55;cursor:not-allowed}
.dsh-mu-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0}
.dsh-mu-formActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-mu-status{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-left:auto}
.dsh-mu-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
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
     * token 数格式化（完整写法）：千分位数字，不带 K / M 缩写。
     *
     * @param value - token 数。
     * @returns 完整文本。
     */
    function formatTokensFull(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "—";
      return Math.round(value).toLocaleString("en-US");
    }

    /**
     * 按设置挑一种写法来显示 token 数。
     *
     * @param value - token 数。
     * @param display - 写法：`compact` 缩写、`full` 完整。
     * @returns 文本。
     */
    function formatSessionTokens(value, display) {
      return display === "full" ? formatTokensFull(value) : formatTokens(value);
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
     * 设置页
     * ---------------------------------------------------------------- */

    /**
     * 设置页管理的字段。
     *
     * 字段名与宿主半边 `Config` 的键一一对应；宿主只把 `.volatile()` 的字段
     * 放进设置文档，所以这几个字段必须由宿主侧标成 volatile 才可编辑。
     */
    const SETTINGS_FIELDS = [
      {
        name: "refreshIntervalMs",
        type: "select",
        labelKey: "fieldRefreshInterval",
        hintKey: "refreshIntervalHint",
        options: [
          { value: 5000, labelKey: "interval5s" },
          { value: 60000, labelKey: "interval60s" },
          { value: 600000, labelKey: "interval10m" },
          { value: 1800000, labelKey: "interval30m" },
          { value: 3600000, labelKey: "interval1h" }
        ]
      },
      {
        name: "showQuickRefresh",
        type: "checkbox",
        labelKey: "fieldShowQuickRefresh",
        hintKey: "showQuickRefreshHint"
      },
      {
        name: "tokenDisplay",
        type: "select",
        // 下拉框的值有数字和字符串两种，这里说明这个字段是字符串。
        valueType: "string",
        labelKey: "fieldTokenDisplay",
        hintKey: "tokenDisplayHint",
        options: [
          { value: "full", labelKey: "tokenDisplayFull" },
          { value: "compact", labelKey: "tokenDisplayCompact" }
        ]
      }
    ];

    /** 齿轮图标路径（24×24 的实心齿轮，插件自绘，不依赖 primitives 图标包）。 */
    const GEAR_PATH =
      "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54C14.36 2.56 14.16 2.4 13.92 2.4h-3.84c-.24 0-.43.16-.47.4l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.86c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.4.48.4h3.84c.24 0 .44-.16.47-.4l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";

    /** 配置镜像没有内容时的占位快照。 */
    const EMPTY_MIRROR = { status: "idle", view: undefined, error: null };
    /** 配置表单没有内容时的占位快照。 */
    const EMPTY_FORM = { status: "idle", value: {}, base: {}, user: {}, revision: 0, writable: false };

    /**
     * 取可选的配置服务。
     *
     * `configForms` 在没有挂设置插件的部署里不存在，所以它只能是可选服务：
     * 用 `ctx.get` 而不是 `inject`，拿不到就渲染「设置不可用」，不抛错。
     *
     * @param ctx - 客户端上下文。
     * @returns 配置服务，或 undefined。
     */
    function getConfigForms(ctx) {
      try {
        return ctx.get("configForms");
      } catch {
        return undefined;
      }
    }

    /**
     * 在宿主报告的命名空间清单里找本插件的那一个。
     *
     * 优先用约定的 `usage-hub`；拿不到就退而求其次，找 value / schema 里
     * 带 `refreshIntervalMs` 的那一项——它一定是我们自己的条目。
     *
     * @param view - `configForms.describe()` 的 `view`。
     * @returns 命名空间 id，或 undefined。
     */
    function resolveNamespace(view) {
      const namespaces = view?.namespaces ?? [];
      const preferred = namespaces.find((item) => item?.ns === CONFIG_NS);
      if (preferred !== undefined) return preferred.ns;
      for (const item of namespaces) {
        const value = item?.value;
        if (value !== undefined && value !== null && Object.prototype.hasOwnProperty.call(value, "refreshIntervalMs")) {
          return item.ns;
        }
        const schema = item?.schema;
        if (schema !== undefined && schema !== null && JSON.stringify(schema).includes("refreshIntervalMs")) {
          return item.ns;
        }
      }
      return undefined;
    }

    /**
     * 数字 → 文本（表单里的数字输入用字符串，解析失败时留空）。
     *
     * @param value - 数值。
     * @returns 文本。
     */
    function numberToText(value) {
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    }

    /**
     * 解析数字输入。
     *
     * 空串或非数字都算解析失败（返回 undefined），这种字段不会进 ops。
     *
     * @param text - 输入文本。
     * @returns 数值，或 undefined。
     */
    function parseNumber(text) {
      if (typeof text !== "string" || text.trim() === "") return undefined;
      const value = Number(text);
      return Number.isFinite(value) ? value : undefined;
    }

    /**
     * 把宿主给的配置值转成表单草稿。
     *
     * 草稿里数字是字符串（下拉框的值是字符串）。
     *
     * @param value - 当前配置值。
     * @returns 草稿对象。
     */
    function toDraft(value) {
      const source = value ?? {};
      return {
        refreshIntervalMs: numberToText(
          REFRESH_OPTIONS.includes(source.refreshIntervalMs)
            ? source.refreshIntervalMs
            : DEFAULT_REFRESH_MS
        ),
        showQuickRefresh: source.showQuickRefresh === true,
        tokenDisplay: TOKEN_DISPLAYS.includes(source.tokenDisplay) ? source.tokenDisplay : "compact"
      };
    }

    /**
     * 计算草稿相对当前值的改动。
     *
     * 只产出真正变了的字段；解析失败的值直接跳过（宁可不写，也不写错）。
     *
     * @param draft - 表单草稿。
     * @param current - 当前配置值。
     * @returns 一次原子写要用的 ops。
     */
    function buildOps(draft, current) {
      const source = current ?? {};
      const ops = [];
      for (const field of SETTINGS_FIELDS) {
        if (field.type === "number") {
          const next = parseNumber(draft[field.name]);
          if (next === undefined) continue;
          if (next !== source[field.name]) ops.push({ op: "set", path: [field.name], value: next });
          continue;
        }
        if (field.type === "checkbox") {
          const next = draft[field.name] === true;
          if (next !== (source[field.name] === true)) {
            ops.push({ op: "set", path: [field.name], value: next });
          }
          continue;
        }
        if (field.type === "select") {
          // 下拉框的值有数字（刷新间隔）和字符串（token 写法）两种。
          if (field.valueType === "string") {
            const next = String(draft[field.name] ?? "");
            if (next !== String(source[field.name] ?? "")) {
              ops.push({ op: "set", path: [field.name], value: next });
            }
            continue;
          }
          const next = Number(draft[field.name]);
          if (!Number.isFinite(next)) continue;
          if (next !== source[field.name]) ops.push({ op: "set", path: [field.name], value: next });
          continue;
        }
        const next = String(draft[field.name] ?? "");
        if (next !== String(source[field.name] ?? "")) {
          ops.push({ op: "set", path: [field.name], value: next });
        }
      }
      return ops;
    }

    /**
     * 宿主当前加载的 schema 里有没有这个字段。
     *
     * 宿主半边新增配置字段后必须重启才会加载新的 schema；没重启的话，
     * 写入会被宿主按旧 schema 拒掉。schema 看不出来时返回 true——
     * 宁可不说，也不给一个错误的诊断。
     *
     * @param {unknown} schema - 宿主报的命名空间 schema。
     * @param {string} field - 字段名。
     * @returns 字段是否在 schema 里。
     */
    function schemaHasField(schema, field) {
      try {
        if (schema === undefined || schema === null) return true;
        return JSON.stringify(schema).includes(field);
      } catch {
        return true;
      }
    }

    /**
     * 把保存失败的原因拼成一句话。
     *
     * 提交的字段宿主那边还不认识时，多半是宿主进程没重启、还在用旧的配置
     * 结构——那种情况下补一句「重启 DSH」，比光说「保存失败」有用。
     *
     * @param {Function} t - 文案函数。
     * @param {string} message - 失败原因。
     * @param {object[]} ops - 这次提交的操作。
     * @param {object} view - 宿主报的命名空间清单（`mirrorSnapshot.view`）。
     * @param {string} namespace - 本插件的命名空间。
     * @returns 错误描述。
     */
    function describeFailure(t, message, ops, view, namespace) {
      const item = (view?.namespaces ?? []).find((entry) => entry?.ns === namespace);
      const unknown = ops.some((op) => !schemaHasField(item?.schema, String(op.path?.[0] ?? "")));
      return unknown ? `${message} · ${t("restartHint")}` : message;
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

      // 静默刷新：查询过程中继续显示上一次的结果，不出现「查询中…」。
      let quotaText;
      if (quota.phase === "failed") {
        quotaText = quota.code === "missing-credential" ? t("noKey") : t("failed");
      } else if (quota.supported === false) {
        quotaText = t("unsupported");
      } else {
        const summary = summarizeQuota(quota, t);
        quotaText = summary === "" ? t("noQuota") : summary;
      }

      const session = state.session;
      const sessionText =
        session.usage === undefined
          ? "—"
          : `${formatSessionTokens(totalTokens(session.usage), state.tokenDisplay)} ${t("tokens")}`;

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
                  // 快捷刷新按钮默认不显示：它占着状态栏的位置，
                  // 想用可以在设置里打开「显示快捷刷新按钮」。
                  state.showQuickRefresh === true ? refreshIcon(t, () => refresh()) : null
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
    function UsagePage({ t, useAccountUsage, refresh, backToCurrent, openSettings }) {
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
                          children: [
                            refreshIcon(t, () => refresh()),
                            settingsIcon(t, openSettings)
                          ]
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
      // 已经查到过结果（有供应商名或模型）。这个条件不能跟着 phase 走：
      // phase 在刷新期间会变成 loading，跟着它走会让这一块被删掉又加回来，页面上下跳。
      const hasResult = quota.provider !== "" || quota.providerLabel !== "" || quota.model !== "";

      // 查询失败时保留上一次成功的数据，只在前面补一条错误提示。
      // 重试期间（phase 回到 loading）也留着这条提示，别让它闪一下就没。
      if (quota.phase === "failed" || (quota.phase === "loading" && quota.code !== "")) {
        children.push(
          jsx("div", { key: "error", className: "dsh-mu-error", role: "status", children: quota.message })
        );
      }
      // 静默刷新：查询过程中不显示「查询中…」，旧数据继续留在页面上。
      if (quota.supported === false) {
        children.push(
          jsx("div", { key: "none", className: "dsh-mu-muted", children: quota.message || t("unsupported") })
        );
      } else if (hasData || hasResult) {
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

      // 「更新于」这一行只在第一次成功查询后出现，之后就一直留在页面上。
      // 刷新时只换文字、不动结构——否则少一行会让整张卡片变矮，
      // 下面的卡片跟着上移，数据回来再移回去，页面就上下抽搐。
      if (quota.checkedAt !== null && quota.checkedAt !== undefined) {
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
      // 静默刷新：清单刷新期间不显示「查询中…」。
      if (list.length === 0) {
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
      // 静默刷新：聚合刷新期间不显示「查询中…」，旧表格继续留着。
      // 重试期间也留着上一次的错误提示，别让它闪一下就没。
      if (usage.phase === "failed" || (usage.phase === "loading" && usage.message !== "")) {
        body.push(jsx("div", { key: "error", className: "dsh-mu-error", children: usage.message }));
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
     * 刷新图标按钮。
     *
     * 静默刷新：按钮不转圈、不出「查询中…」，数据到了就自己更新。
     *
     * @param t - 文案函数。
     * @param onClick - 点击回调。
     * @returns 图标按钮。
     */
    function refreshIcon(t, onClick) {
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
              style: { display: "inline-flex" },
              children: jsx(primitives.IconRefreshOutlineRegular, { size: 14 })
            }
          )
        }
      );
    }

    /**
     * 齿轮按钮：进入本插件自己的设置页。
     *
     * 图标是内联 SVG——插件不 import DSH 的 primitives 图标包，按官方约定
     * 自己画并只借用主题变量。
     *
     * @param t - 文案函数。
     * @param onClick - 点击回调。
     * @returns 齿轮按钮。
     */
    function settingsIcon(t, onClick) {
      return jsx(
        "button",
        {
          key: "settings-icon",
          type: "button",
          onClick,
          title: t("settings"),
          "aria-label": t("settings"),
          className: "dsh-mu-button",
          style: { display: "inline-flex", alignItems: "center", justifyContent: "center" },
          children: jsx("svg", {
            width: 14,
            height: 14,
            viewBox: "0 0 24 24",
            fill: "currentColor",
            "aria-hidden": true,
            focusable: "false",
            children: jsx("path", { d: GEAR_PATH })
          })
        }
      );
    }

    /**
     * 一个设置字段行：标签 + 控件 + 提示。
     *
     * @param t - 文案函数。
     * @param field - 字段描述。
     * @param settings - 设置页状态。
     * @param writable - 是否可写。
     * @param openField - 当前展开的下拉字段名，或 undefined。
     * @param setOpenField - 设置展开字段名的回调。
     * @returns 字段行元素。
     */
    function settingsField(t, field, settings, writable, openField, setOpenField) {
      const id = `dsh-mu-field-${field.name}`;
      const draft = settings.draft ?? {};
      const raw = draft[field.name];
      const onChange = (event) => {
        if (field.type === "checkbox") {
          settings.update(field.name, event?.target?.checked === true);
          return;
        }
        settings.update(field.name, event?.target?.value ?? "");
      };

      let control;
      if (field.type === "textarea") {
        control = jsx("textarea", {
          key: "control",
          id,
          className: "dsh-mu-textarea",
          "data-field": field.name,
          rows: 4,
          value: raw ?? "",
          disabled: !writable,
          onChange
        });
      } else if (field.type === "number") {
        control = jsx("input", {
          key: "control",
          id,
          type: "number",
          className: "dsh-mu-input",
          "data-field": field.name,
          value: raw ?? "",
          disabled: !writable,
          onChange
        });
      } else if (field.type === "checkbox") {
        control = jsx("input", {
          key: "control",
          id,
          type: "checkbox",
          className: "dsh-mu-checkBox",
          "data-field": field.name,
          checked: raw === true,
          disabled: !writable,
          onChange
        });
      } else if (field.type === "select") {
        // 原生 select 没有「已展开」状态：按下鼠标时展开，选完或失焦后收起。
        // 这段时间里把箭头翻上去，展开与否就看得出来。
        const open = openField === field.name;
        control = jsx("span", {
          key: "control",
          className: "dsh-mu-selectWrap",
          "data-open": open ? "true" : "false",
          "data-disabled": writable ? "false" : "true",
          children: jsx("select", {
            key: "select",
            id,
            className: "dsh-mu-select",
            "data-field": field.name,
            value: raw ?? "",
            disabled: !writable,
            onChange: (event) => {
              setOpenField(undefined);
              onChange(event);
            },
            onMouseDown: () => setOpenField(field.name),
            onBlur: () => setOpenField(undefined),
            children: (field.options ?? []).map((option) =>
              jsx("option", {
                key: String(option.value),
                value: String(option.value),
                children: t(option.labelKey)
              })
            )
          })
        });
      } else {
        control = jsx("input", {
          key: "control",
          id,
          type: "text",
          className: "dsh-mu-input dsh-mu-inputWide",
          "data-field": field.name,
          value: raw ?? "",
          disabled: !writable,
          onChange
        });
      }

      return jsxs(
        "div",
        {
          key: field.name,
          className: "dsh-mu-field",
          "data-wide": field.type === "textarea" ? "true" : "false",
          children: [
            jsxs(
              "div",
              {
                key: "text",
                className: "dsh-mu-fieldText",
                children: [
                  jsx("label", {
                    key: "label",
                    className: "dsh-mu-fieldLabel",
                    htmlFor: id,
                    children: t(field.labelKey)
                  }),
                  field.hintKey === undefined
                    ? null
                    : jsx("p", { key: "hint", className: "dsh-mu-hint", children: t(field.hintKey) })
                ]
              },
              "text"
            ),
            jsx("div", { key: "control", className: "dsh-mu-fieldControl", children: control }, "control")
          ]
        },
        field.name
      );
    }

    /**
     * 本插件的设置页。
     *
     * 它是一个独立的 `main` 面板（key = `usage-hub-settings`），只从
     * 「用量与额度」页的齿轮进入，**不**注册 `sidebar.panellist` 入口。
     *
     * 表单通过 `ctx.configForms` 直接读写本插件自己的 Config：字段必须是
     * 宿主侧标了 `.volatile()` 的那些，保存是一次 `mutate` 原子写。
     *
     * @param props - 插槽注入的 props。
     * @returns 页面元素。
     */
    function SettingsPage({ t, useSettings, openUsage }) {
      const settings = useSettings();
      const writable = settings.writable !== false;
      // 当前展开的下拉字段名：原生 select 不给「已展开」事件，只能自己记。
      const [openField, setOpenField] = react.useState(undefined);
      const fields = [];

      if (settings.available === false || settings.namespace === undefined) {
        fields.push(
          jsx("div", { key: "unavailable", className: "dsh-mu-muted", children: t("settingsUnavailable") })
        );
      } else {
        for (const field of SETTINGS_FIELDS) {
          fields.push(settingsField(t, field, settings, writable, openField, setOpenField));
        }
        fields.push(
          jsxs(
            "div",
            {
              key: "actions",
              className: "dsh-mu-formActions",
              children: [
                jsx("button", {
                  key: "save",
                  type: "button",
                  className: "dsh-mu-button",
                  "data-variant": "save",
                  disabled: !writable,
                  onClick: () => settings.save(),
                  children: t("save")
                }),
                settings.status === "saved"
                  ? jsx("span", { key: "saved", className: "dsh-mu-status", children: t("saved") })
                  : null,
                settings.status === "failed"
                  ? jsx("span", {
                      key: "failed",
                      className: "dsh-mu-status",
                      "data-tone": "error",
                      children: t("saveFailed")
                    })
                  : null,
                // 保存失败的原因：光说「保存失败」没法查，把宿主给的话摆出来。
                settings.status === "failed" && settings.error !== ""
                  ? jsx("p", {
                      key: "failed-detail",
                      className: "dsh-mu-error dsh-mu-errorDetail",
                      role: "status",
                      children: settings.error
                    })
                  : null
              ]
            },
            "actions"
          )
        );
        if (!writable) {
          fields.push(
            jsx("div", { key: "readonly", className: "dsh-mu-muted", children: t("settingsReadonly") })
          );
        }
      }

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
                            jsx("h1", { key: "title", className: "dsh-mu-title", children: t("settingsTitle") }),
                            jsx("p", { key: "subtitle", className: "dsh-mu-subtitle", children: t("settingsHint") })
                          ]
                        }
                      ),
                      jsx(
                        "div",
                        {
                          key: "actions",
                          className: "dsh-mu-headActions",
                          children: jsx("button", {
                            key: "back",
                            type: "button",
                            className: "dsh-mu-button",
                            "data-variant": "ghost",
                            onClick: openUsage,
                            children: t("backToUsage")
                          })
                        }
                      )
                    ]
                  },
                  "head"
                ),
                jsxs(
                  "section",
                  {
                    key: "form",
                    className: "dsh-mu-card",
                    children: [
                      jsxs(
                        "div",
                        {
                          key: "head",
                          className: "dsh-mu-cardHead",
                          children: [
                            jsx("h3", {
                              key: "title",
                              className: "dsh-mu-cardTitle",
                              children: t("settingsCardTitle")
                            }),
                            jsx("span", {
                              key: "note",
                              className: "dsh-mu-cardNote",
                              children: settings.namespace ?? ""
                            })
                          ]
                        },
                        "head"
                      ),
                      ...fields
                    ]
                  },
                  "form"
                )
              ]
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
        selection: { provider: undefined, model: undefined },
        /** 自动刷新间隔（毫秒）：跟随设置页里的配置。 */
        refreshIntervalMs: DEFAULT_REFRESH_MS,
        /** 状态栏里是否放快捷刷新按钮：跟随设置页里的配置，默认不放。 */
        showQuickRefresh: false,
        /** 状态栏里当前会话 token 数的写法：跟随设置页里的配置。 */
        tokenDisplay: "compact"
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
       * 设置页的本地状态：每个命名空间一份草稿，外加一次保存的结果。
       *
       * 草稿放在存储里而不是组件的 state 里：草稿要活过一次渲染，
       * 保存之后还要拿它跟当前值做差。
       */
      const settingsStore = createStore({ drafts: {}, status: "idle", error: "" });

      /**
       * 订阅设置页状态。
       *
       * @param selector - 选择器。
       * @returns 选中的状态。
       */
      function useSettingsStore(selector) {
        const snapshot = react.useSyncExternalStore(
          settingsStore.subscribe,
          settingsStore.getSnapshot,
          settingsStore.getSnapshot
        );
        return selector === undefined ? snapshot : selector(snapshot);
      }

      /**
       * 设置页需要的全部信息与动作。
       *
       * `configForms` 是可选服务：没有它就只渲染「设置不可用」。
       *
       * @returns 设置页状态。
       */
      function useSettings() {
        const configForms = getConfigForms(ctx);
        const mirror = configForms === undefined ? undefined : configForms.describe();
        const mirrorSnapshot = react.useSyncExternalStore(
          (listener) => {
            if (mirror === undefined || typeof mirror.subscribe !== "function") return () => {};
            return mirror.subscribe(listener);
          },
          () => (mirror === undefined ? EMPTY_MIRROR : mirror.getSnapshot()),
          () => (mirror === undefined ? EMPTY_MIRROR : mirror.getSnapshot())
        );
        const namespace = resolveNamespace(mirrorSnapshot?.view);
        const form = namespace === undefined ? undefined : configForms.get(namespace);
        const formSnapshot = react.useSyncExternalStore(
          (listener) => {
            if (form === undefined || typeof form.subscribe !== "function") return () => {};
            return form.subscribe(listener);
          },
          () => (form === undefined ? EMPTY_FORM : form.getSnapshot()),
          () => (form === undefined ? EMPTY_FORM : form.getSnapshot())
        );
        const state = useSettingsStore((snapshot) => snapshot);
        const draft =
          namespace === undefined ? undefined : state.drafts[namespace] ?? toDraft(formSnapshot.value);

        /**
         * 改一个字段。
         *
         * @param field - 字段名。
         * @param value - 新值。
         */
        function update(field, value) {
          if (namespace === undefined) return;
          const fresh = settingsStore.getSnapshot();
          const current = fresh.drafts[namespace] ?? toDraft(formSnapshot.value);
          settingsStore.patch({
            drafts: {
              ...fresh.drafts,
              [namespace]: { ...current, [field]: value }
            }
          });
        }

        /**
         * 保存：把相对当前值的改动打包成一次原子写。
         */
        async function save() {
          if (form === undefined || namespace === undefined) return;
          const ops = buildOps(draft ?? toDraft(formSnapshot.value), formSnapshot.value);
          if (ops.length === 0) {
            settingsStore.patch({ status: "saved", error: "" });
            return;
          }
          settingsStore.patch({ status: "saving", error: "" });
          try {
            const result = await form.mutate(ops, formSnapshot.revision);
            if (result === false) {
              settingsStore.patch({ status: "failed", error: describeFailure(t, t("saveRejected"), ops, mirrorSnapshot?.view, namespace) });
              return;
            }
            settingsStore.patch({ status: "saved", error: "" });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[dsh-usage-hub] 保存配置失败", error);
            settingsStore.patch({ status: "failed", error: describeFailure(t, message, ops, mirrorSnapshot?.view, namespace) });
          }
        }

        return {
          available: configForms !== undefined,
          namespace,
          writable: formSnapshot.writable !== false,
          draft,
          status: state.status,
          error: state.error,
          update,
          save
        };
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

      /**
       * 当前的刷新间隔（毫秒）与定时器。
       *
       * 间隔是设置项，改了以后立刻换定时器——不用刷新页面。
       */
      let currentRefreshMs = DEFAULT_REFRESH_MS;
      let refreshTimer;

      /**
       * 让定时器跟上设置里的刷新间隔。
       */
      function syncRefreshTimer() {
        const wanted = store.getSnapshot().refreshIntervalMs;
        if (wanted === currentRefreshMs && refreshTimer !== undefined) return;
        currentRefreshMs = wanted;
        if (refreshTimer !== undefined) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => refresh(), currentRefreshMs);
      }

      ctx.effect(() => {
        syncRefreshTimer();
        const off = store.subscribe(syncRefreshTimer);
        return () => {
          off();
          if (refreshTimer !== undefined) {
            clearInterval(refreshTimer);
            refreshTimer = undefined;
          }
        };
      }, "usage-hub: 定时刷新");

      // 从配置表单里读设置项：配置服务是可选的，读不到就用默认值。
      ctx.effect(() => {
        const configForms = getConfigForms(ctx);
        if (configForms === undefined) return;
        const mirror = configForms.describe();
        if (typeof mirror.ensure === "function") mirror.ensure();
        const sync = () => {
          const namespace = resolveNamespace(mirror.getSnapshot()?.view);
          if (namespace === undefined) return;
          const value = configForms.get(namespace).getSnapshot()?.value;
          if (value === undefined || value === null) return;
          const patch = {};
          if (REFRESH_OPTIONS.includes(value.refreshIntervalMs)) {
            patch.refreshIntervalMs = value.refreshIntervalMs;
          }
          patch.showQuickRefresh = value.showQuickRefresh === true;
          patch.tokenDisplay = TOKEN_DISPLAYS.includes(value.tokenDisplay) ? value.tokenDisplay : "compact";
          store.patch(patch);
        };
        sync();
        return mirror.subscribe(sync);
      }, "usage-hub: 配置项");

      /**
       * 切到某个主区面板。
       *
       * 面板还没在 `main` 槽位里注册好时（刚挂载就被点）忽略这次切换，
       * 不把异常抛到事件处理里。
       *
       * @param id - 面板 id。
       */
      function selectPanel(id) {
        try {
          ctx.layout.selectPanel(id);
        } catch {
          // 面板还没注册好，忽略这次点击。
        }
      }

      const openPanel = () => selectPanel(PANEL_ID);
      const openSettings = () => selectPanel(SETTINGS_PANEL_ID);
      const openUsage = () => selectPanel(PANEL_ID);
      const shared = { useAccountUsage, refresh, backToCurrent, openPanel, openSettings };

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

      // 设置页：独立的 main 面板，只从齿轮进入，不进侧边栏。
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: SETTINGS_PANEL_ID,
            locale: NS,
            inject: () => ({ useSettings, openUsage })
          },
          SettingsPage
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
    exports.SETTINGS_PANEL_ID = SETTINGS_PANEL_ID;
    exports.CONFIG_NS = CONFIG_NS;
    return module.exports;
  }
});
