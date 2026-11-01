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
  setInterval: () => 0,
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

/** 迷你 React 替身。 */
const reactStub = {
  useState(initial) {
    const value =
      stateOverride !== undefined ? stateOverride : typeof initial === "function" ? initial() : initial;
    return [value, () => {}];
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
/** 主面板组件。 */
let mainComponent;

const ctx = {
  effect(fn) {
    fn();
    return () => {};
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
      registered.push({ name: options.name, key: options.key, component });
      if (options.name === "main") mainComponent = component;
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
check("主面板组件已注册", typeof mainComponent === "function");
check("状态栏组件已注册", registered.some((entry) => entry.name === "shell.bottom"));
check("侧边栏入口已注册", registered.some((entry) => entry.name === "sidebar.panellist"));

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
  openPanel: () => {}
};

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
  } else {
    check("供应商页出现供应商清单标题", requested.has("supportedProviders"));
    check("供应商页出现「查看」按钮文案", requested.has("selectProvider"));
    check("供应商页不出现「当前会话」", !requested.has("currentSession"));
    check("供应商页不出现「跨会话累计」", !requested.has("history"));
  }
}
stateOverride = undefined;

/* ---------- 状态栏 ---------- */

const bar = registered.find((entry) => entry.name === "shell.bottom");
let barError;
try {
  bar.component({ t: ctx.locale.bind(), ...shared });
} catch (error) {
  barError = error;
}
check("状态栏渲染不抛异常", barError === undefined, barError?.stack ?? "");

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 个用例失败`);
process.exit(failures === 0 ? 0 : 1);
