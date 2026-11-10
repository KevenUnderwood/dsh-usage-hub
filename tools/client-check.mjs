/**
 * 在 Node 里把浏览器半边跑起来：用最小的 DOM / React 替身执行客户端 bundle，
 * 渲染整页，并检查
 *  - zh / en 两份文案的键是否一致；
 *  - 页面上用到的每一个文案键是否都存在（缺一个就显示成键名）；
 *  - 渲染过程是否抛异常（键名写错、组件写错都会在这里暴露）。
 *
 * 运行：node tools/client-check.mjs
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** 捕获到的客户端 bundle 工厂。 */
let factory;
/** 捕获到的文档元素。 */
const created = [];

/** 记录 setInterval 被要求使用的间隔（毫秒）。 */
const recordedIntervals = [];

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(spec) {
        factory = spec.factory;
      }
    }
  },
  document: {
    getElementById: () => null,
    createElement: () => ({
      id: "",
      textContent: "",
      setAttribute() {}
    }),
    head: {
      appendChild(node) {
        created.push(node);
      }
    },
    documentElement: { appendChild() {} }
  },
  console,
  setInterval: (fn, ms) => {
    recordedIntervals.push(ms);
    return 0;
  },
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {}
};
sandbox.globalThis = sandbox;
runInContext(source, createContext(sandbox));

/** 记录所有被请求过的文案键。 */
const requested = new Set();
/** 强制下一次渲染使用的 useState 初值（用来切页签）。 */
let stateOverride;

/** useState 的 setter 调用记录：用来验下拉框的展开状态。 */
const stateSetterCalls = [];

/** 迷你 React 替身。 */
const reactStub = {
  useState(initial) {
    const value =
      stateOverride !== undefined ? stateOverride : typeof initial === "function" ? initial() : initial;
    return [value, (next) => { stateSetterCalls.push(next); }];
  },
  useEffect() {},
  useMemo(factory) {
    return factory();
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    return getSnapshot();
  },
  useRef: (value) => ({ current: value })
};

const moduleExports = factory((specifier) => {
  if (specifier === "react") return reactStub;
  if (specifier === "react/jsx-runtime") {
    return {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props })
    };
  }
  if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
    return {
      IconDatabaseOutlineRegular: "IconDatabase",
      IconRefreshOutlineRegular: "IconRefresh"
    };
  }
  throw new Error(`未预期的 require：${specifier}`);
});

let failures = 0;

/**
 * 断言。
 *
 * @param {string} name - 用例名。
 * @param {boolean} ok - 是否通过。
 * @param {string} [detail] - 失败细节。
 */
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  ${detail}`}`);
}

/* ---------- 挂载 ---------- */

/** 注册到的 locale 字典。 */
let dicts = {};
/** 注册到各插槽的组件。 */
const registered = [];

/**
 * 找一个已注册的主面板。
 *
 * 现在有两个 main 注册项（用量面板与设置面板），所以必须按 `options.key` 找，
 * 不能拿「最后一个 main」。
 *
 * @param {string} key - 面板 key。
 * @returns 组件，或 undefined。
 */
function findMain(key) {
  return registered.find((entry) => entry.name === "main" && entry.key === key)?.component;
}

/**
 * 找一个已注册的注册项。
 *
 * @param {string} name - 插槽名。
 * @param {string} [id] - 条目 id。
 * @returns 注册项，或 undefined。
 */
function findEntry(name, id) {
  return registered.find((entry) => entry.name === name && (id === undefined || entry.id === id));
}

/** 假配置表单记录下来的 mutate 调用。 */
const mutateCalls = [];
/** 假表单的 mutate 行为：ok=成功，reject=被拒，throw=抛异常。 */
let mutateMode = "ok";
/** 假配置表单的当前值。 */
const fakeValue = {
  refreshIntervalMs: 5000,
  showQuickRefresh: false,
  tokenDisplay: "compact"
};
/** 假配置服务报的 schema 字段：宿主进程重启后才会更新。 */
let fakeSchemaProperties = {
  refreshIntervalMs: { type: "number" },
  showQuickRefresh: { type: "boolean" },
  tokenDisplay: { type: "string" }
};
/** 假配置表单控制器。 */
const fakeForm = {
  snapshot: {
    status: "ready",
    value: fakeValue,
    base: { ...fakeValue },
    user: {},
    revision: 7,
    writable: true
  },
  getSnapshot() {
    return this.snapshot;
  },
  subscribe() {
    return () => {};
  },
  async mutate(ops, revision) {
    mutateCalls.push({ ops, revision });
    if (mutateMode === "reject") return false;
    if (mutateMode === "throw") throw new Error('settings namespace "usage-hub" changed since it was read');
    return true;
  }
};
/** 假 mirror 的订阅回调：配置改了以后手动触发一次，验证界面跟着变。 */
let mirrorListener;
/** 假配置服务：describe() 报出 ns 为 usage-hub 的命名空间。 */
const fakeConfigForms = {
  describe() {
    return {
      getSnapshot: () => ({
        status: "ready",
        view: {
          namespaces: [
            {
              ns: "usage-hub",
              schema: {
                type: "object",
                properties: { ...fakeSchemaProperties }
              },
              revision: 7,
              value: fakeValue,
              base: { ...fakeValue },
              user: {},
              autoGenerate: true,
              applies: "live"
            }
          ]
        },
        error: null
      }),
      subscribe: (listener) => {
        mirrorListener = listener;
        return () => {};
      }
    };
  },
  get(ns) {
    return ns === "usage-hub" ? fakeForm : undefined;
  }
};

const ctx = {
  effect(fn) {
    fn();
    return () => {};
  },
  get(name) {
    return name === "configForms" ? fakeConfigForms : undefined;
  },
  locale: {
    register(namespace, value) {
      dicts = value;
    },
    bind() {
      return (key) => {
        requested.add(key);
        return dicts.zh?.[key] ?? key;
      };
    }
  },
  slots: {
    inject(key, fn) {
      fn();
    },
    register(options, component) {
      registered.push({
        name: options.name,
        key: options.key,
        id: options.id,
        options,
        component
      });
    }
  },
  connection: {
    rpc: {
      async call(channel, endpoint) {
        if (endpoint === "providers") {
          return {
            ok: true,
            value: {
              providers: [
                { id: "minimax-cn", label: "MiniMax", family: "tiers", baseURL: "https://x", credentialRefs: [], configured: true, keyRef: "MINIMAX_CN_API_KEY" },
                { id: "openrouter", label: "OpenRouter", family: "balance", baseURL: "https://y", credentialRefs: [], configured: false }
              ]
            }
          };
        }
        if (endpoint === "quota") {
          return {
            ok: true,
            value: {
              provider: "minimax-cn",
              providerLabel: "MiniMax",
              model: "MiniMax-M3.1-Flash",
              supported: true,
              family: "tiers",
              tiers: [
                { name: "five_hour", remainingPercent: 72, usedPercent: 28, resetsAt: 1730000000000, exhausted: false },
                { name: "weekly_limit", remainingPercent: 0, usedPercent: 100, resetsAt: 1731000000000, exhausted: true }
              ],
              balances: [],
              keyRef: "MINIMAX_CN_API_KEY",
              checkedAt: Date.now()
            }
          };
        }
        return { ok: true, value: { byModel: [], perSession: [], totals: { totalTokens: 0 }, sessionCount: 0 } };
      }
    }
  },
  layout: { selectPanel() {} }
};

moduleExports.apply(ctx);

/* ---------- 检查 ---------- */

check("样式表只注入一次", created.length === 1, `实际 ${created.length} 次`);
check("样式表带滚动容器的规则", created[0]?.textContent?.includes("dsh-mu-scroll") === true);
check("样式表里没有不存在的 token", !created[0]?.textContent?.includes("--dsw-alias-state-critical"));
check("主面板组件已注册", typeof findMain("usage-hub") === "function");
check("设置面板组件已注册", typeof findMain("usage-hub-settings") === "function");
check(
  "configForms 是可选服务（不在 inject 列表里）",
  Array.isArray(moduleExports.inject) && moduleExports.inject.includes("configForms") === false,
  `inject=${JSON.stringify(moduleExports.inject)}`
);
check("状态栏组件已注册", registered.some((entry) => entry.name === "shell.bottom"));
check("侧边栏入口已注册", registered.some((entry) => entry.name === "sidebar.panellist"));
check(
  "设置面板没有侧边栏入口",
  findEntry("sidebar.panellist", "usage-hub-settings") === undefined
);

const zhKeys = Object.keys(dicts.zh ?? {}).sort();
const enKeys = Object.keys(dicts.en ?? {}).sort();
check(
  "zh / en 的键集合一致",
  JSON.stringify(zhKeys) === JSON.stringify(enKeys),
  `zh 多 ${zhKeys.filter((key) => !enKeys.includes(key))} / en 多 ${enKeys.filter((key) => !zhKeys.includes(key))}`
);

/* ---------- 渲染整页 ---------- */

/** 一份贴近真实的快照。 */
const snapshot = {
  quota: {
    phase: "ready",
    provider: "minimax-cn",
    providerLabel: "MiniMax",
    model: "MiniMax-M3.1-Flash",
    supported: true,
    family: "tiers",
    tiers: [
      { name: "five_hour", remainingPercent: 72, usedPercent: 28, resetsAt: 1730000000000, exhausted: false },
      { name: "weekly_limit", remainingPercent: 0, usedPercent: 100, resetsAt: 1731000000000, exhausted: true }
    ],
    balances: [{ name: "credits", remaining: 12.5, total: 100, used: 87.5, unit: "USD" }],
    note: undefined,
    checkedAt: Date.now(),
    message: "",
    code: ""
  },
  usage: {
    phase: "ready",
    byModel: [{ model: "MiniMax-M3.1-Flash", requests: 3, uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, totalTokens: 125 }],
    perSession: [],
    totals: { totalTokens: 125 },
    sessionCount: 1,
    message: ""
  },
  session: { id: "s1", title: "会话", usage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0 } },
  providers: {
    phase: "ready",
    list: [
      { id: "minimax-cn", label: "MiniMax", family: "tiers", baseURL: "https://x", credentialRefs: [], configured: true, keyRef: "MINIMAX_CN_API_KEY" },
      { id: "openrouter", label: "OpenRouter", family: "balance", baseURL: "https://y", credentialRefs: [], configured: false }
    ]
  },
  override: undefined,
  selection: { provider: "minimax-cn", model: "MiniMax-M3.1-Flash" }
};

const shared = {
  useAccountUsage: (selector) => selector(snapshot),
  refresh: () => {},
  backToCurrent: () => {},
  openPanel: () => {},
  openSettings: () => {}
};

const mainComponent = findMain("usage-hub");
const settingsComponent = findMain("usage-hub-settings");

let renderError;
try {
  mainComponent({ t: ctx.locale.bind(), ...shared });
} catch (error) {
  renderError = error;
}
check("整页渲染不抛异常", renderError === undefined, renderError?.stack ?? "");

const missing = [...requested].filter((key) => !(key in (dicts.zh ?? {})));
check("页面上用到的文案键都存在", missing.length === 0, `缺 ${missing.join(", ")}`);

/* ---------- 渲染两个页签 ---------- */

/**
 * 收集一棵树里出现过的 className 与文案键。
 *
 * @param {unknown} node - 节点。
 * @param {string[]} classes - 收集到的 className。
 */
function walk(node, classes) {
  if (node === null || node === undefined || typeof node !== "object") return;
  const props = node.props;
  if (props === undefined || props === null) return;
  if (typeof props.className === "string") classes.push(props.className);
  const children = props.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, classes);
  } else {
    walk(children, classes);
  }
}

/**
 * 收集一棵树里所有满足条件的节点。
 *
 * @param {unknown} node - 节点。
 * @param {(node: {type: unknown, props: Record<string, unknown>}) => boolean} predicate - 过滤条件。
 * @param {Array<object>} [out] - 收集结果。
 * @returns 收集到的节点。
 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  const props = node.props;
  if (props === undefined || props === null) return out;
  if (predicate(node)) out.push(node);
  const children = props.children;
  if (Array.isArray(children)) {
    for (const child of children) findAll(child, predicate, out);
  } else {
    findAll(children, predicate, out);
  }
  return out;
}

for (const tab of ["usage", "providers"]) {
  stateOverride = tab;
  requested.clear();
  let error;
  let tree;
  try {
    tree = mainComponent({ t: ctx.locale.bind(), ...shared });
  } catch (caught) {
    error = caught;
  }
  check(`页签 ${tab} 渲染不抛异常`, error === undefined, error?.stack ?? "");

  const classes = [];
  walk(tree, classes);
  check(`页签 ${tab} 的根节点是滚动容器`, classes[0] === "dsh-mu-scroll", `根 class=${classes[0]}`);
  check(
    `页签 ${tab} 的根节点带滚动样式类`,
    classes.some((name) => name.includes("dsh-mu-scroll"))
  );

  if (tab === "usage") {
    check("用量页出现「当前供应商」", requested.has("currentProvider"));
    check("用量页出现「当前会话」", requested.has("currentSession"));
    check("用量页出现「跨会话累计」", requested.has("history"));
    check("用量页不出现供应商清单标题", !requested.has("supportedProviders"));
    const gears = findAll(
      tree,
      (node) => node.type === "button" && node.props["aria-label"] === dicts.zh.settings
    );
    check("用量页头部有齿轮按钮", gears.length === 1, `找到 ${gears.length} 个`);
  } else {
    check("供应商页出现供应商清单标题", requested.has("supportedProviders"));
    check("供应商页出现「查看」按钮文案", requested.has("selectProvider"));
    check("供应商页不出现「当前会话」", !requested.has("currentSession"));
    check("供应商页不出现「跨会话累计」", !requested.has("history"));
  }
}
stateOverride = undefined;

/* ---------- 设置页 ---------- */

stateOverride = undefined;
requested.clear();

const settingsEntry = registered.find(
  (entry) => entry.name === "main" && entry.key === "usage-hub-settings"
);
const settingsProps = { t: ctx.locale.bind(), ...(settingsEntry?.options?.inject?.() ?? {}) };

let settingsTree;
let settingsError;
try {
  settingsTree = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
check("设置页渲染不抛异常", settingsError === undefined, settingsError?.stack ?? "");

const settingsClasses = [];
walk(settingsTree, settingsClasses);
check("设置页的根节点是滚动容器", settingsClasses[0] === "dsh-mu-scroll", `根 class=${settingsClasses[0]}`);
check("设置页出现标题", requested.has("settingsTitle"));
check("设置页出现「返回用量」", requested.has("backToUsage"));

const fieldNodes = findAll(settingsTree, (node) => typeof node.props["data-field"] === "string");
const fieldNames = fieldNodes.map((node) => node.props["data-field"]);
check("设置页渲染三个字段", fieldNames.length === 3, `实际 ${fieldNames.length}：${fieldNames.join(",")}`);
check(
  "设置页的字段是 refreshIntervalMs、showQuickRefresh 和 tokenDisplay",
  fieldNames.includes("refreshIntervalMs") &&
    fieldNames.includes("showQuickRefresh") &&
    fieldNames.includes("tokenDisplay"),
  fieldNames.join(",")
);

/* 快捷刷新开关：一个复选框，默认不勾选。 */

const quickField = fieldNodes.find((node) => node.props["data-field"] === "showQuickRefresh");
check(
  "快捷刷新字段是复选框",
  quickField?.type === "input" && quickField?.props?.type === "checkbox",
  `实际 ${quickField?.type} / ${quickField?.props?.type}`
);
check("快捷刷新默认不勾选", quickField?.props?.checked === false, `实际 ${quickField?.props?.checked}`);

/* 配置里已经是打开的，初次渲染就要显示成勾选——否则保存会把 true 覆盖回 false。 */

fakeValue.showQuickRefresh = true;
let quickTree;
try {
  quickTree = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
const quickOn = findAll(quickTree, (node) => node.props["data-field"] === "showQuickRefresh")[0];
check("配置为打开时复选框是勾选状态", quickOn?.props?.checked === true, `实际 ${quickOn?.props?.checked}`);
fakeValue.showQuickRefresh = false;

/* 刷新间隔是一个下拉框，五个档位。 */

const intervalField = fieldNodes.find((node) => node.props["data-field"] === "refreshIntervalMs");
check("刷新间隔字段是下拉框", intervalField?.type === "select", `实际 ${intervalField?.type}`);
const intervalOptions = (intervalField?.props?.children ?? []).map((option) => option.props.value);
check(
  "刷新间隔有 5 个档位（5s/60s/10m/30m/1h）",
  intervalOptions.join(",") === "5000,60000,600000,1800000,3600000",
  intervalOptions.join(",")
);
check(
  "刷新间隔的下拉框显示当前值",
  intervalField?.props?.value === "5000",
  `实际 ${intervalField?.props?.value}`
);

/* 下拉框的展开状态：原生 select 不给「已展开」事件，插件自己记一份。 */

const selectWrap = findAll(
  settingsTree,
  (node) => node.props?.className === "dsh-mu-selectWrap"
)[0];
check(
  "下拉框默认是收起的",
  selectWrap?.props?.["data-open"] === "false",
  `实际 ${selectWrap?.props?.["data-open"]}`
);

const setterBefore = stateSetterCalls.length;
intervalField?.props?.onMouseDown?.();
check(
  "按下下拉框会标记为展开",
  stateSetterCalls.length === setterBefore + 1 && stateSetterCalls.at(-1) === "refreshIntervalMs",
  JSON.stringify(stateSetterCalls.slice(setterBefore))
);
intervalField?.props?.onBlur?.();
check(
  "失焦会收起下拉框",
  stateSetterCalls.length === setterBefore + 2 && stateSetterCalls.at(-1) === undefined,
  JSON.stringify(stateSetterCalls.slice(setterBefore))
);

/* token 写法也是一个下拉框，两种写法：完整与紧凑。 */

const tokenField = fieldNodes.find((node) => node.props["data-field"] === "tokenDisplay");
check("token 写法字段是下拉框", tokenField?.type === "select", `实际 ${tokenField?.type}`);
const tokenOptions = (tokenField?.props?.children ?? []).map((option) => option.props.value);
check(
  "token 写法有完整与紧凑两个选项",
  tokenOptions.join(",") === "full,compact",
  tokenOptions.join(",")
);
check(
  "token 写法的下拉框显示当前值",
  tokenField?.props?.value === "compact",
  `实际 ${tokenField?.props?.value}`
);

const saveButton = findAll(
  settingsTree,
  (node) => node.type === "button" && node.props.children === dicts.zh.save
)[0];
check("设置页有「保存」按钮", saveButton !== undefined);
check(
  "设置页没有「恢复默认」按钮",
  findAll(settingsTree, (node) => node.type === "button" && node.props.children === "恢复默认").length === 0
);
check("保存按钮用 save 变体", saveButton?.props?.["data-variant"] === "save");

/* 改刷新间隔再保存：应该发出 refreshIntervalMs 的 set。 */

const intervalField2 = findAll(
  settingsTree,
  (node) => node.props["data-field"] === "refreshIntervalMs"
)[0];
intervalField2.props.onChange({ target: { value: "3600000" } });

let settingsTree3;
try {
  settingsTree3 = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
check("改刷新间隔后重渲染不抛异常", settingsError === undefined, settingsError?.stack ?? "");

const saveButton3 = findAll(
  settingsTree3,
  (node) => node.type === "button" && node.props.children === dicts.zh.save
)[0];
await saveButton3.props.onClick();

check("保存发出一次 mutate", mutateCalls.length === 1, `实际 ${mutateCalls.length} 次`);
const intervalOps = mutateCalls[0]?.ops ?? [];
check(
  "保存的 ops 包含 refreshIntervalMs",
  intervalOps.some(
    (op) => op.op === "set" && op.path[0] === "refreshIntervalMs" && op.value === 3600000
  ),
  JSON.stringify(intervalOps)
);
check(
  "保存的 ops 不带其它字段",
  intervalOps.every(
    (op) => op.path[0] === "refreshIntervalMs" && Array.isArray(op.path) && op.path.length === 1
  ),
  JSON.stringify(intervalOps)
);
check("保存带上当前 revision", mutateCalls[0]?.revision === 7, `实际 ${mutateCalls[0]?.revision}`);

/* 勾上快捷刷新开关再保存：应该发出 showQuickRefresh 的 set。 */

const quickField2 = findAll(
  settingsTree3,
  (node) => node.props["data-field"] === "showQuickRefresh"
)[0];
quickField2?.props?.onChange?.({ target: { checked: true } });

let settingsTree4;
try {
  settingsTree4 = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
check("勾选快捷刷新后重渲染不抛异常", settingsError === undefined, settingsError?.stack ?? "");

const saveButton4 = findAll(
  settingsTree4,
  (node) => node.type === "button" && node.props.children === dicts.zh.save
)[0];
await saveButton4.props.onClick();

check("勾选后保存发出第二次 mutate", mutateCalls.length === 2, `实际 ${mutateCalls.length} 次`);
const quickOps = mutateCalls[1]?.ops ?? [];
check(
  "保存的 ops 包含 showQuickRefresh",
  quickOps.some((op) => op.op === "set" && op.path[0] === "showQuickRefresh" && op.value === true),
  JSON.stringify(quickOps)
);

/* 保存失败时要说清楚为什么，不能只丢一句「保存失败」。 */

mutateMode = "throw";
const saveButton5 = findAll(
  settingsTree4,
  (node) => node.type === "button" && node.props.children === dicts.zh.save
)[0];
await saveButton5.props.onClick();

let failedTree;
try {
  failedTree = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
const failedDetail = findAll(failedTree, (node) => node.props?.className === "dsh-mu-error dsh-mu-errorDetail")[0];
check("保存失败时显示原因", failedDetail !== undefined, "页面上没有失败原因");
check(
  "失败原因里带宿主给的消息",
  String(failedDetail?.props?.children ?? "").includes("changed since it was read"),
  String(failedDetail?.props?.children ?? "")
);
check("保存失败时显示「保存失败」", requested.has("saveFailed") === true, `用到了 ${[...requested].join(",")}`);

/* 宿主不认这个字段时，多提一句「重启 DSH」。 */

mutateMode = "reject";
fakeSchemaProperties = { refreshIntervalMs: { type: "number" } };
// 重新渲染，好让保存回调拿到新的 schema（宿主重启后才会换）。
let rejectedTree;
try {
  rejectedTree = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
const saveButton6 = findAll(
  rejectedTree,
  (node) => node.type === "button" && node.props.children === dicts.zh.save
)[0];
await saveButton6.props.onClick();

try {
  rejectedTree = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
const rejectedDetail = findAll(rejectedTree, (node) => node.props?.className === "dsh-mu-error dsh-mu-errorDetail")[0];
check(
  "宿主不认这个字段时提示重启",
  String(rejectedDetail?.props?.children ?? "").includes(dicts.zh.restartHint),
  String(rejectedDetail?.props?.children ?? "")
);
mutateMode = "ok";
fakeSchemaProperties = { refreshIntervalMs: { type: "number" }, showQuickRefresh: { type: "boolean" }, tokenDisplay: { type: "string" } };

/* 改 token 写法再保存：应该发出 tokenDisplay 的 set。 */

let tokenTree;
try {
  tokenTree = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
const tokenField2 = findAll(
  tokenTree,
  (node) => node.props["data-field"] === "tokenDisplay"
)[0];
tokenField2?.props?.onChange?.({ target: { value: "full" } });

let tokenTree2;
try {
  tokenTree2 = settingsComponent(settingsProps);
} catch (error) {
  settingsError = error;
}
check("改 token 写法后重渲染不抛异常", settingsError === undefined, settingsError?.stack ?? "");

const saveButton7 = findAll(
  tokenTree2,
  (node) => node.type === "button" && node.props.children === dicts.zh.save
)[0];
await saveButton7.props.onClick();

const tokenOps = mutateCalls.at(-1)?.ops ?? [];
check(
  "保存的 ops 包含 tokenDisplay",
  tokenOps.some((op) => op.op === "set" && op.path[0] === "tokenDisplay" && op.value === "full"),
  JSON.stringify(tokenOps)
);

/* 定时器用的是配置里的刷新间隔。 */

check(
  "定时器用配置里的刷新间隔",
  recordedIntervals.includes(5000),
  `记录到的间隔：${recordedIntervals.join(",")}`
);

const settingsMissing = [...requested].filter((key) => !(key in (dicts.zh ?? {})));
check("设置页用到的文案键都存在", settingsMissing.length === 0, `缺 ${settingsMissing.join(", ")}`);

/* 没有配置服务时：显示「设置不可用」，不抛错。 */

const realGet = ctx.get;
ctx.get = () => undefined;
requested.clear();
let unavailableTree;
let unavailableError;
try {
  unavailableTree = settingsComponent(settingsProps);
} catch (error) {
  unavailableError = error;
}
ctx.get = realGet;
check("没有配置服务时设置页不抛异常", unavailableError === undefined, unavailableError?.stack ?? "");
check("没有配置服务时显示「设置不可用」", requested.has("settingsUnavailable"));
check(
  "没有配置服务时不渲染字段",
  findAll(unavailableTree, (node) => typeof node.props["data-field"] === "string").length === 0
);

/* ---------- 静默刷新 ---------- */

const bar = registered.find((entry) => entry.name === "shell.bottom");
const loadingSnapshot = {
  ...snapshot,
  quota: { ...snapshot.quota, phase: "loading" },
  usage: { ...snapshot.usage, phase: "loading" },
  providers: { ...snapshot.providers, phase: "loading" }
};
const loadingShared = { ...shared, useAccountUsage: (selector) => selector(loadingSnapshot) };

requested.clear();
let loadingError;
let loadingTree;
try {
  loadingTree = mainComponent({ t: ctx.locale.bind(), ...loadingShared });
} catch (error) {
  loadingError = error;
}
check("加载中整页渲染不抛异常", loadingError === undefined, loadingError?.stack ?? "");
check("加载中不显示「查询中」", requested.has("loading") === false, `用到了 ${[...requested].join(",")}`);

/* 刷新期间不能把内容删掉再加回来：少一行，卡片变矮，下面的内容会上移，
   数据回来再移回去，整页就上下抽搐。 */

check(
  "加载中仍显示「更新于」",
  requested.has("updatedAt") === true,
  `用到了 ${[...requested].join(",")}`
);
const loadingClasses = [];
walk(loadingTree, loadingClasses);
check(
  "加载中仍显示供应商信息",
  loadingClasses.includes("dsh-mu-hero"),
  `class=${loadingClasses.join(",")}`
);

/* 没有额度数据的供应商也一样：刷新时供应商信息不能被删掉。 */

const emptySnapshot = {
  ...snapshot,
  quota: { ...snapshot.quota, tiers: [], balances: [], phase: "loading" }
};
const emptyClasses = [];
try {
  walk(
    mainComponent({
      t: ctx.locale.bind(),
      ...shared,
      useAccountUsage: (selector) => selector(emptySnapshot)
    }),
    emptyClasses
  );
} catch (error) {
  loadingError = error;
}
check("没有额度数据时加载中也不抛异常", loadingError === undefined, loadingError?.stack ?? "");
check(
  "没有额度数据时加载中仍显示供应商信息",
  emptyClasses.includes("dsh-mu-hero"),
  `class=${emptyClasses.join(",")}`
);

/* 重试期间也别把上一次的错误提示撤掉再挂回来。 */

const retrySnapshot = {
  ...snapshot,
  quota: { ...snapshot.quota, phase: "loading", code: "unknown", message: "查询失败" },
  usage: { ...snapshot.usage, phase: "loading", message: "查询失败" }
};
const retryClasses = [];
try {
  walk(
    mainComponent({
      t: ctx.locale.bind(),
      ...shared,
      useAccountUsage: (selector) => selector(retrySnapshot)
    }),
    retryClasses
  );
} catch (error) {
  loadingError = error;
}
check("重试中整页渲染不抛异常", loadingError === undefined, loadingError?.stack ?? "");
check(
  "重试中仍显示错误提示",
  retryClasses.filter((name) => name === "dsh-mu-error").length === 2,
  `class=${retryClasses.join(",")}`
);

requested.clear();
try {
  bar.component({ t: ctx.locale.bind(), ...loadingShared });
} catch (error) {
  loadingError = error;
}
check("加载中状态栏渲染不抛异常", loadingError === undefined, loadingError?.stack ?? "");
check("加载中状态栏不显示「查询中」", requested.has("loading") === false, `用到了 ${[...requested].join(",")}`);

/* ---------- 状态栏 ---------- */

let barError;
try {
  bar.component({ t: ctx.locale.bind(), ...shared });
} catch (error) {
  barError = error;
}
check("状态栏渲染不抛异常", barError === undefined, barError?.stack ?? "");

/* 快捷刷新按钮默认不显示；配置打开后才出现。 */

requested.clear();
try {
  bar.component({ t: ctx.locale.bind(), ...shared });
} catch (error) {
  barError = error;
}
check("状态栏默认不显示快捷刷新按钮", requested.has("refresh") === false, `用到了 ${[...requested].join(",")}`);

requested.clear();
try {
  bar.component({
    t: ctx.locale.bind(),
    ...shared,
    useAccountUsage: (selector) => selector({ ...snapshot, showQuickRefresh: true })
  });
} catch (error) {
  barError = error;
}
check("打开配置后状态栏显示快捷刷新按钮", requested.has("refresh") === true, `用到了 ${[...requested].join(",")}`);

/* 端到端：配置里的开关改掉 → mirror 通知 → 状态栏跟着出现/消失按钮。 */

const realShared = bar.options.inject();
fakeValue.showQuickRefresh = true;
mirrorListener?.();
requested.clear();
try {
  bar.component({ t: ctx.locale.bind(), ...realShared });
} catch (error) {
  barError = error;
}
check("配置改成打开后状态栏出现按钮", requested.has("refresh") === true, `用到了 ${[...requested].join(",")}`);

fakeValue.showQuickRefresh = false;
mirrorListener?.();
requested.clear();
try {
  bar.component({ t: ctx.locale.bind(), ...realShared });
} catch (error) {
  barError = error;
}
check("配置改回关闭后状态栏没有按钮", requested.has("refresh") === false, `用到了 ${[...requested].join(",")}`);

/* 状态栏里当前会话的 token 数：紧凑写 120K，完整写 120,000。 */

/**
 * 取状态栏里当前会话 token 数那一格的文本。
 *
 * @param {unknown} tree - 状态栏渲染出来的树。
 * @returns 文本。
 */
function sessionTextOf(tree) {
  const node = findAll(tree, (item) => item.props?.key === "session-value")[0];
  return String(node?.props?.children ?? "");
}

/** 一份 token 数够大的快照：120000 便于区分 120K 与 120,000。 */
const bigSnapshot = {
  ...snapshot,
  session: {
    ...snapshot.session,
    usage: { uncachedInputTokens: 120000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  }
};

let compactTree;
try {
  compactTree = bar.component({
    t: ctx.locale.bind(),
    ...shared,
    useAccountUsage: (selector) => selector(bigSnapshot)
  });
} catch (error) {
  barError = error;
}
check("状态栏默认用紧凑写法", sessionTextOf(compactTree) === "120K token", sessionTextOf(compactTree));

let fullTree;
try {
  fullTree = bar.component({
    t: ctx.locale.bind(),
    ...shared,
    useAccountUsage: (selector) => selector({ ...bigSnapshot, tokenDisplay: "full" })
  });
} catch (error) {
  barError = error;
}
check("配置为完整时状态栏写完整数字", sessionTextOf(fullTree) === "120,000 token", sessionTextOf(fullTree));

/* 端到端：配置里的写法改掉 → mirror 通知 → store 里的写法跟着变。 */

fakeValue.tokenDisplay = "full";
mirrorListener?.();
let e2eState;
try {
  e2eState = realShared.useAccountUsage((state) => state);
} catch (error) {
  barError = error;
}
check(
  "配置改成完整后 store 里的写法跟着变",
  e2eState?.tokenDisplay === "full",
  String(e2eState?.tokenDisplay)
);

fakeValue.tokenDisplay = "compact";
mirrorListener?.();
try {
  e2eState = realShared.useAccountUsage((state) => state);
} catch (error) {
  barError = error;
}
check(
  "配置改回紧凑后 store 里的写法跟着变",
  e2eState?.tokenDisplay === "compact",
  String(e2eState?.tokenDisplay)
);

/* 宿主侧的配置 schema：这个字段必须标成 volatile，否则 Web 设置页读写不到它
   （宿主只把 volatile 字段做成可写表单）。本地没装 schemastery，只能查源码。 */

const indexSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
check(
  "showQuickRefresh 在宿主 schema 里标成了 volatile",
  /showQuickRefresh:[^,\n]*volatile\(\)/.test(indexSource),
  "lib/index.js 的 schema 里没有 volatile 的 showQuickRefresh"
);
check(
  "tokenDisplay 在宿主 schema 里标成了 volatile",
  /tokenDisplay:[^,\n]*volatile\(\)/.test(indexSource),
  "lib/index.js 的 schema 里没有 volatile 的 tokenDisplay"
);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 个用例失败`);
process.exit(failures === 0 ? 0 : 1);
