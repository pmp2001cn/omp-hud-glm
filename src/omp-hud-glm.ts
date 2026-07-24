// GLM Coding Plan 用量 + 上下文用量彩色 Widget 扩展
//
// 功能：
//   - 编辑器下方常驻 widget，显示上下文用量 + GLM Coding Plan 5h/每周额度
//   - /omp-hud-glm:setup 命令：选语言、配置 API Key、进度条样式、单行/双行布局
//   - /omp-hud-glm:usage 命令：查询 GLM 用量详情（含 MCP 各模型明细）
//   - auto 布局：按终端宽度自动选单行（宽屏）或两行（窄屏，如手机）
//   - 语种：自动检测系统语言，亦可在 setup 中手动选自动/中文/英文
//
// 上下文数据来自 OMP 核心 ctx.getContextUsage()（精确 token 计数，自动跟随模型变化）。
// GLM 数据来自智谱用量 API（monitor 端点，不消耗 coding plan 额度）。
//
// API Key 来源（按优先级）：
//   1. 环境变量 ZHIPU_API_KEY
//   2. 本地文件 ~/.omp/agent/.omp-hud-glm-key
// 配置文件：~/.omp/agent/.omp-hud-glm-config.json
//
// 向后兼容：若新文件不存在，自动回退读取历史名（.omp-glm-* / .glm-*），config 命中则迁移到新名。

const ENDPOINT = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const REFRESH_MS = 5 * 60 * 1000;
const WIDGET_KEY = "omp-hud-glm";

// 进度条样式映射：filled/empty 字符对（文案走 i18n.barStyleLabel）
const BAR_STYLES: Record<string, { filled: string; empty: string }> = {
  block:   { filled: "▰", empty: "▱" },
  classic: { filled: "█", empty: "░" },
  dot:     { filled: "●", empty: "·" },
  line:    { filled: "━", empty: "─" },
};

// 颜色常量（真彩色，暗色背景调亮）
const C_ACCENT = "#7aa2f7";
const C_OK = "#9ece6a";
const C_WARN = "#e0af68";
const C_ERR = "#f7768e";
const C_DIM = "#9aa5ce";
const C_SEP = "#4c566a";

// === 系统语种检测（auto 模式用；跨平台，勿用 process.env.LANG）===
const SYSTEM_LOCALE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
})();
const SYSTEM_IS_ZH = SYSTEM_LOCALE.toLowerCase().startsWith("zh");

// === 翻译表：所有用户可见字符串 ===
const zhStrings = {
  // widget 状态栏
  ctxLabel: "上下文",
  ctxNoData: "上下文：暂无数据",
  glmTag: (level: string) => (level ? `${level.toUpperCase()}使用率` : "GLM使用率"),
  weeklyTag: "周",
  widgetNoKey: "  GLM 用量：未配置 API Key",
  widgetError: (msg: string) => `  GLM：${msg}`,
  // 时间格式（fmtReset）
  resetDone: "已重置",
  durMin: (m: number) => `${m}分`,
  durHour: (h: number) => `${h}小时`,
  durHourMin: (h: number, m: number) => `${h}小时${m}分`,
  durDay: (d: number) => `${d}天`,
  durDayHour: (d: number, h: number) => `${d}天${h}小时`,
  // setup 命令
  setupDesc: "配置 GLM 用量 widget（语言、API Key、进度条样式、单行/双行布局）",
  langSwitched: "已切换为中文",
  apiKeyHint: "配置智谱 API Key：与 zhipu-coding-plan 共用同一个 key；用量查询走 monitor 端点，不消耗 Coding Plan 额度。",
  inputTitle: "智谱 API Key",
  inputPhHas: "已配置，留空保持不变",
  inputPhNew: "粘贴你的智谱 API Key",
  keySaved: "✓ API Key 已保存到 ~/.omp/agent/.omp-hud-glm-key",
  keySaveFail: "API Key 保存失败，请检查文件权限",
  keyNotSet: "未设置 API Key。可运行 setup 重新配置，或设环境变量 ZHIPU_API_KEY。",
  noInput: "当前环境不支持交互式输入，请手动配置 API Key",
  selectBar: "选择进度条样式",
  selectLayout: "选择布局",
  current: "(当前)",
  layoutAuto: "auto 自动（宽屏单行/窄屏双行）",
  layoutOne: "one 单行",
  layoutTwo: "two 双行",
  saved: (bar: string, layout: string) => `已保存：进度条 ${bar}，布局 ${layout}`,
  barStyleLabel: (key: string): string => {
    const m: Record<string, string> = {
      block: "▰▱ 实心方块", classic: "█░ 经典方块", dot: "●· 圆点", line: "━─ 细横线",
    };
    return m[key] ?? key;
  },
  // usage overlay
  usageDesc: "查询 GLM Coding Plan 用量详情",
  noApiKey: "未配置 API Key。运行 /omp-hud-glm:setup 配置，或设置环境变量 ZHIPU_API_KEY。",
  emptyData: "用量查询返回空数据",
  usageTitle: "GLM Coding Plan 用量",
  labelPlan: "套餐",
  label5h: "5h",
  labelWeekly: "每周",
  labelMcp: "MCP",
  mcpCalls: (used: number, total: number) => `${used}/${total} 次`,
  labelDetails: "明细",
  closeHint: "按 Esc 或 q 关闭",
  usageFail: (msg: string) => `GLM 用量查询失败：${msg}`,
  // refreshGlm
  notifyNoKey: "GLM 用量扩展：未检测到 API Key。运行 /omp-hud-glm:setup 配置，或设置环境变量 ZHIPU_API_KEY。",
  queryError: "查询出错",
  quotaFail: "用量查询失败",
};

const enStrings = {
  ctxLabel: "Context",
  ctxNoData: "Context: no data",
  glmTag: (level: string) => `GLM${level ? " " + level.toUpperCase() : ""} 5h`,
  weeklyTag: "Wk",
  widgetNoKey: "  GLM usage: API Key not configured",
  widgetError: (msg: string) => `  GLM: ${msg}`,
  resetDone: "reset",
  durMin: (m: number) => `${m}m`,
  durHour: (h: number) => `${h}h`,
  durHourMin: (h: number, m: number) => `${h}h${m}m`,
  durDay: (d: number) => `${d}d`,
  durDayHour: (d: number, h: number) => `${d}d${h}h`,
  setupDesc: "Configure GLM usage widget (language, API Key, bar style, one/two-line layout)",
  langSwitched: "Switched to English",
  apiKeyHint: "Configure Zhipu API Key: shared with zhipu-coding-plan; uses the monitor endpoint, no Coding Plan quota consumed.",
  inputTitle: "Zhipu API Key",
  inputPhHas: "Already configured, leave blank to keep",
  inputPhNew: "Paste your Zhipu API Key",
  keySaved: "✓ API Key saved to ~/.omp/agent/.omp-hud-glm-key",
  keySaveFail: "Failed to save API Key; check file permissions",
  keyNotSet: "API Key not set. Run setup again, or set env var ZHIPU_API_KEY.",
  noInput: "Interactive input not supported here; configure the API Key manually",
  selectBar: "Select bar style",
  selectLayout: "Select layout",
  current: "(current)",
  layoutAuto: "auto Auto (wide one-line / narrow two-line)",
  layoutOne: "one One line",
  layoutTwo: "two Two lines",
  saved: (bar: string, layout: string) => `Saved: bar ${bar}, layout ${layout}`,
  barStyleLabel: (key: string): string => {
    const m: Record<string, string> = {
      block: "▰▱ Block", classic: "█░ Classic", dot: "●· Dot", line: "━─ Line",
    };
    return m[key] ?? key;
  },
  usageDesc: "Query GLM Coding Plan usage details",
  noApiKey: "API Key not configured. Run /omp-hud-glm:setup, or set env var ZHIPU_API_KEY.",
  emptyData: "Usage query returned empty data",
  usageTitle: "GLM Coding Plan Usage",
  labelPlan: "Plan",
  label5h: "5h",
  labelWeekly: "Weekly",
  labelMcp: "MCP",
  mcpCalls: (used: number, total: number) => `${used}/${total} calls`,
  labelDetails: "Details",
  closeHint: "Press Esc or q to close",
  usageFail: (msg: string) => `GLM usage query failed: ${msg}`,
  notifyNoKey: "GLM usage extension: no API Key detected. Run /omp-hud-glm:setup, or set env var ZHIPU_API_KEY.",
  queryError: "query error",
  quotaFail: "usage query failed",
};

type I18n = typeof zhStrings;

// 当前生效语种与翻译表（setup 选语言 / loadConfig 后更新）
let currentLang: "zh" | "en" = SYSTEM_IS_ZH ? "zh" : "en";
let t: I18n = currentLang === "zh" ? zhStrings : enStrings;

// 把配置里的 language（auto|zh|en）解析为实际语种
function resolveLang(language: string): "zh" | "en" {
  if (language === "zh") return "zh";
  if (language === "en") return "en";
  return SYSTEM_IS_ZH ? "zh" : "en"; // auto
}

// 应用语种：更新 currentLang 与翻译表 t，所有后续渲染/提示立即跟随
function applyLanguage(language: string): void {
  currentLang = resolveLang(language);
  t = currentLang === "zh" ? zhStrings : enStrings;
}

interface OmpHudGlmConfig {
  barStyle: string;   // block | classic | dot | line
  layout: string;     // auto | one | two
  language: string;   // auto | zh | en
}

const DEFAULT_CONFIG: OmpHudGlmConfig = { barStyle: "block", layout: "auto", language: "auto" };

function agentDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return `${home}/.omp/agent`;
}

// 配置/Key 文件路径（当前名）+ 历史名回退（三代改名累积）
const CONFIG_PATHS = [
  `${agentDir()}/.omp-hud-glm-config.json`,
  `${agentDir()}/.omp-glm-config.json`,
  `${agentDir()}/.glm-config.json`,
];
const KEY_PATHS = [
  `${agentDir()}/.omp-hud-glm-key`,
  `${agentDir()}/.omp-glm-usage-key`,
  `${agentDir()}/.glm-usage-key`,
];

// 读取配置（失败回退默认值）。优先读新文件，命中历史名则迁移到新名。
async function loadConfig(): Promise<OmpHudGlmConfig> {
  const readAt = async (p: string): Promise<OmpHudGlmConfig | null> => {
    try {
      const f = Bun.file(p);
      if (await f.exists()) {
        const c = await f.json();
        return {
          barStyle: BAR_STYLES[c.barStyle] ? c.barStyle : "block",
          layout: ["auto", "one", "two"].includes(c.layout) ? c.layout : "auto",
          language: ["auto", "zh", "en"].includes(c.language) ? c.language : "auto",
        };
      }
    } catch {
      // 配置读取失败，忽略
    }
    return null;
  };

  for (const p of CONFIG_PATHS) {
    const c = await readAt(p);
    if (c) {
      // 命中历史名，迁移到新名
      if (p !== CONFIG_PATHS[0]) await saveConfig(c);
      return c;
    }
  }
  return { ...DEFAULT_CONFIG };
}

async function saveConfig(c: OmpHudGlmConfig): Promise<void> {
  try {
    await Bun.write(CONFIG_PATHS[0], JSON.stringify(c, null, 2));
  } catch {
    // 写入失败静默忽略
  }
}

interface McpUsageDetail {
  modelCode: string;
  usage: number;
}

interface QuotaLimit {
  type: string;
  percentage?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  nextResetTime?: number;
  unit?: number;
  number?: number;
  usageDetails?: McpUsageDetail[];
}

interface QuotaData {
  level?: string;
  limits?: QuotaLimit[];
}

interface QuotaResponse {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: QuotaData;
}

interface ParsedUsage {
  level: string;
  hour5UsedPct: number;
  weeklyUsedPct: number;
  hasWeekly: boolean;
  hour5ResetMs?: number;
  weeklyResetMs?: number;
  mcpUsed?: number;
  mcpTotal?: number;
  mcpDetails?: McpUsageDetail[];
}

// ANSI 真彩色前景色包装
function fg(hex: string, text: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function colorForUsage(usedPct: number): string {
  if (usedPct >= 80) return C_ERR;
  if (usedPct >= 50) return C_WARN;
  return C_OK;
}

export async function resolveApiKey(): Promise<string | undefined> {
  const env = process.env.ZHIPU_API_KEY;
  if (env && env.trim()) return env.trim();
  // 新名优先，回退历史名，不自动迁移以免动 key 文件
  for (const p of KEY_PATHS) {
    try {
      const f = Bun.file(p);
      if (await f.exists()) {
        const k = (await f.text()).trim();
        if (k) return k;
      }
    } catch {
      // key 文件读取失败，忽略
    }
  }
  return undefined;
}

// 重置倒计时格式化（中文「1小时38分」，英文「1h38m」）
function fmtReset(ms?: number): string {
  if (!ms) return "";
  const diff = ms - Date.now();
  if (diff <= 0) return t.resetDone;
  const totalMin = Math.round(diff / 60000);
  if (totalMin < 60) return t.durMin(totalMin);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? t.durDayHour(d, rh) : t.durDay(d);
  }
  return m > 0 ? t.durHourMin(h, m) : t.durHour(h);
}

function fmtWindow(tokens: number): string {
  if (tokens >= 1_048_576) {
    const m = tokens / 1_048_576;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1024) {
    const k = tokens / 1024;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}K`;
  }
  return String(tokens);
}

export function parseUsage(resp: QuotaResponse): ParsedUsage | null {
  if (!resp?.success || !resp.data) return null;
  const limits = resp.data.limits ?? [];
  const level = resp.data.level ?? "";
  const tokenLimits = limits
    .filter((l) => l.type === "TOKENS_LIMIT")
    .sort((a, b) => (a.nextResetTime ?? 0) - (b.nextResetTime ?? 0));
  const mcp = limits.find((l) => l.type === "TIME_LIMIT");
  const hour5 = tokenLimits[0];
  const weekly = tokenLimits[1];
  return {
    level,
    hour5UsedPct: hour5?.percentage ?? 0,
    weeklyUsedPct: weekly?.percentage ?? 0,
    hasWeekly: tokenLimits.length > 1,
    hour5ResetMs: hour5?.nextResetTime,
    weeklyResetMs: weekly?.nextResetTime,
    mcpUsed: mcp?.currentValue,
    mcpTotal: mcp?.usage,
    mcpDetails: mcp?.usageDetails?.filter((d) => d.usage > 0),
  };
}

// 彩色进度条（按配置样式）
function coloredBar(usedPct: number, style: string, segments = 10): string {
  const s = BAR_STYLES[style] ?? BAR_STYLES.block;
  const filled = Math.round((usedPct / 100) * segments);
  const color = colorForUsage(usedPct);
  return fg(color, s.filled.repeat(filled)) + fg(C_DIM, s.empty.repeat(segments - filled));
}

function plainBar(usedPct: number, style: string, segments = 16): string {
  const s = BAR_STYLES[style] ?? BAR_STYLES.block;
  const filled = Math.round((usedPct / 100) * segments);
  return s.filled.repeat(filled) + s.empty.repeat(segments - filled);
}

// 按显示宽度右补空格对齐：剔除 ANSI，中文/全角计 2 列，ASCII 计 1 列
function padVisible(text: string, width: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  const dispW = [...visible].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - dispW));
}

// 上下文段：标签 + 进度条 + 百分比 + 已用/窗口
function renderContextSegment(
  cu: { tokens?: number; contextWindow?: number; percent?: number } | null,
  style: string,
): string {
  if (!cu || !cu.contextWindow) return fg(C_DIM, t.ctxNoData);
  const pct = Math.min(100, Math.max(0, cu.percent ?? 0));
  const used = cu.tokens ?? 0;
  const tag = fg(C_ACCENT, t.ctxLabel);
  const bar = coloredBar(pct, style);
  const pctC = fg(colorForUsage(pct), `${pct.toFixed(1)}%`);
  const detail = fg(C_DIM, `${fmtWindow(used)}/${fmtWindow(cu.contextWindow)}`);
  return `${tag} ${bar} ${pctC} ${detail}`;
}

// GLM 段：标签 + 进度条 + 百分比 + 重置时间
function renderGlmSegment(u: ParsedUsage, style: string): string {
  const c5 = colorForUsage(u.hour5UsedPct);
  const tag = fg(C_ACCENT, t.glmTag(u.level));
  const bar5 = coloredBar(u.hour5UsedPct, style);
  const pct5 = fg(c5, `${u.hour5UsedPct}%`);
  const _r5 = fmtReset(u.hour5ResetMs);
  const reset5 = _r5 ? fg(C_DIM, `·${_r5}`) : "";
  let seg = `${tag} ${bar5} ${pct5} ${reset5}`;
  if (u.hasWeekly) {
    const cw = colorForUsage(u.weeklyUsedPct);
    const barW = coloredBar(u.weeklyUsedPct, style);
    const pctW = fg(cw, `${u.weeklyUsedPct}%`);
    const _rW = fmtReset(u.weeklyResetMs);
    const resetW = _rW ? fg(C_DIM, `·${_rW}`) : "";
    seg += ` ${fg(C_ACCENT, t.weeklyTag)} ${barW} ${pctW} ${resetW}`;
  }
  return seg;
}

// 根据配置和终端宽度决定单行还是两行（中文更宽，阈值上调）
function useOneLine(config: OmpHudGlmConfig): boolean {
  if (config.layout === "one") return true;
  if (config.layout === "two") return false;
  // auto：窄屏（手机）用两行，宽屏合并
  const cols = process.stdout.columns ?? parseInt(process.env.COLUMNS ?? "120", 10) ?? 120;
  return cols >= (currentLang === "zh" ? 120 : 110);
}

// 渲染 widget 行（数组）：单行合并或两行分离
export function renderWidgetLines(
  cu: { tokens?: number; contextWindow?: number; percent?: number } | null,
  u: ParsedUsage | null,
  config: OmpHudGlmConfig,
): string[] {
  const ctxSeg = renderContextSegment(cu, config.barStyle);
  if (!u) return [`  ${ctxSeg}`];
  const glmSeg = renderGlmSegment(u, config.barStyle);
  if (useOneLine(config)) {
    return [`  ${ctxSeg} ${fg(C_SEP, "│")} ${glmSeg}`];
  }
  return [`  ${ctxSeg}`, `  ${glmSeg}`];
}

async function fetchUsage(apiKey: string): Promise<ParsedUsage | null> {
  const res = await fetch(ENDPOINT, {
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = (await res.json()) as QuotaResponse;
  if (!json.success) throw new Error(json.msg || t.quotaFail);
  return parseUsage(json);
}

export default function (pi): void {
  let warnedMissingKey = false;
  let lastUsage: ParsedUsage | null = null;
  let lastRefreshAt = 0;
  let config: OmpHudGlmConfig = { ...DEFAULT_CONFIG };
  const MIN_REFRESH_GAP = 60_000;

  async function reloadConfig(): Promise<void> {
    config = await loadConfig();
    applyLanguage(config.language);
  }

  function renderWidgets(ctx, u: ParsedUsage | null): void {
    const cu = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : null;
    ctx.ui?.setWidget?.(WIDGET_KEY, renderWidgetLines(cu, u, config), {
      placement: "belowEditor",
    });
  }

  async function refreshGlm(ctx): Promise<void> {
    const now = Date.now();
    if (lastUsage && now - lastRefreshAt < MIN_REFRESH_GAP) {
      renderWidgets(ctx, lastUsage);
      return;
    }
    const apiKey = await resolveApiKey();
    if (!apiKey) {
      const cu = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : null;
      ctx.ui?.setWidget?.(WIDGET_KEY, [
        ...renderWidgetLines(cu, null, config),
        fg(C_ERR, t.widgetNoKey),
      ], { placement: "belowEditor" });
      if (!warnedMissingKey && ctx.ui?.notify) {
        warnedMissingKey = true;
        ctx.ui.notify(t.notifyNoKey, "warning");
      }
      return;
    }
    try {
      const u = await fetchUsage(apiKey);
      lastRefreshAt = now;
      if (u) lastUsage = u;
      renderWidgets(ctx, u ?? lastUsage);
    } catch (e) {
      const cu = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : null;
      ctx.ui?.setWidget?.(WIDGET_KEY, [
        ...renderWidgetLines(cu, lastUsage, config),
        fg(C_ERR, t.widgetError(e instanceof Error ? e.message : t.queryError)),
      ], { placement: "belowEditor" });
    }
  }

  async function refreshAll(ctx): Promise<void> {
    await refreshGlm(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    await reloadConfig();
    await refreshAll(ctx);
    ctx.setInterval(() => {
      void refreshGlm(ctx);
    }, REFRESH_MS);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await refreshAll(ctx);
  });

  // 每轮对话后刷新上下文（token 计数变了）；GLM 受节流保护
  pi.on("turn_end", async (_event, ctx) => {
    renderWidgets(ctx, lastUsage);
    void refreshGlm(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    renderWidgets(ctx, lastUsage);
  });

  // /omp-hud-glm:setup：交互式配置（语言、API Key、进度条样式、单行/双行布局）
  pi.registerCommand("omp-hud-glm:setup", {
    description: t.setupDesc,
    handler: async (_args, ctx) => {
      // 1. 选语言（菜单固定英文，「中文」选项用中文，选择后后续提示跟随所选语言）
      const langLabels = [
        `Auto (detect from system)${config.language === "auto" ? " (current)" : ""}`,
        `中文${config.language === "zh" ? " (current)" : ""}`,
        `English${config.language === "en" ? " (current)" : ""}`,
      ];
      const pickedLang = await ctx.ui?.select?.("Select language", langLabels);
      if (!pickedLang) return;
      if (pickedLang.startsWith("Auto")) config.language = "auto";
      else if (pickedLang.startsWith("中文")) config.language = "zh";
      else config.language = "en";
      applyLanguage(config.language); // 立即应用，后续提示用所选语言
      ctx.ui?.notify?.(t.langSwitched, "info");

      // 2. 配置 API Key（先 notify 提示说明，再弹出输入框）
      if (ctx.ui?.input) {
        ctx.ui?.notify?.(t.apiKeyHint, "info");
        const existingKey = await resolveApiKey();
        const keyInput = await ctx.ui.input(t.inputTitle, existingKey ? t.inputPhHas : t.inputPhNew);
        if (keyInput !== undefined) {
          const trimmed = keyInput.trim();
          if (trimmed) {
            try {
              await Bun.write(KEY_PATHS[0], trimmed);
              warnedMissingKey = false;
              ctx.ui?.notify?.(t.keySaved, "info");
            } catch {
              ctx.ui?.notify?.(t.keySaveFail, "error");
            }
          } else if (!existingKey && !process.env.ZHIPU_API_KEY) {
            ctx.ui?.notify?.(t.keyNotSet, "warning");
          }
        }
      } else {
        ctx.ui?.notify?.(t.noInput, "warning");
      }

      // 3. 选进度条样式
      const styleLabels = Object.entries(BAR_STYLES).map(
        ([k]) => `${t.barStyleLabel(k)}${k === config.barStyle ? ` ${t.current}` : ""}`,
      );
      const pickedStyle = await ctx.ui?.select?.(t.selectBar, styleLabels);
      if (!pickedStyle) return;
      const styleKey = Object.entries(BAR_STYLES).find(
        ([k]) => pickedStyle.startsWith(t.barStyleLabel(k)),
      )?.[0];
      if (styleKey) config.barStyle = styleKey;

      // 4. 选布局
      const layoutLabels = [
        `${t.layoutAuto}${config.layout === "auto" ? ` ${t.current}` : ""}`,
        `${t.layoutOne}${config.layout === "one" ? ` ${t.current}` : ""}`,
        `${t.layoutTwo}${config.layout === "two" ? ` ${t.current}` : ""}`,
      ];
      const pickedLayout = await ctx.ui?.select?.(t.selectLayout, layoutLabels);
      if (!pickedLayout) return;
      if (pickedLayout.startsWith("auto")) config.layout = "auto";
      else if (pickedLayout.startsWith("one")) config.layout = "one";
      else config.layout = "two";

      await saveConfig(config);
      // 立即重渲染
      renderWidgets(ctx, lastUsage);
      void refreshGlm(ctx);
      ctx.ui?.notify?.(
        t.saved(t.barStyleLabel(config.barStyle), config.layout),
        "info",
      );
    },
  });

  pi.registerCommand("omp-hud-glm:usage", {
    description: t.usageDesc,
    handler: async (_args, ctx) => {
      try {
        const apiKey = await resolveApiKey();
        if (!apiKey) {
          ctx.ui?.notify?.(t.noApiKey, "error");
          return;
        }
        const u = await fetchUsage(apiKey);
        if (!u) {
          ctx.ui?.notify?.(t.emptyData, "warning");
          return;
        }
        // 用量百分比 → 主题色 token（自动适配深/浅色模式）
        const pctToken = (pct: number): "success" | "warning" | "error" =>
          pct >= 80 ? "error" : pct >= 50 ? "warning" : "success";
        // 标签列宽：中文标签统一 2 字（4 列），英文标签更长（Weekly/Details=7 列）
        const LABEL_W = currentLang === "zh" ? 4 : 8;
        // 渲染详情行（用系统主题色，非自写 ANSI）
        const renderDetails = (theme: { fg: (c: string, t: string) => string }): string[] => {
          const out: string[] = [];
          if (u.level) out.push(`${padVisible(theme.fg("accent", t.labelPlan), LABEL_W)} ${theme.fg("muted", u.level.toUpperCase())}`);
          const bar = (pct: number) => {
            const s = BAR_STYLES[config.barStyle] ?? BAR_STYLES.block;
            const filled = Math.round((pct / 100) * 10);
            return theme.fg(pctToken(pct), s.filled.repeat(filled)) + theme.fg("dim", s.empty.repeat(10 - filled));
          };
          const r5 = fmtReset(u.hour5ResetMs);
          out.push(
            `${padVisible(theme.fg("accent", t.label5h), LABEL_W)} ${bar(u.hour5UsedPct)} ${theme.fg(pctToken(u.hour5UsedPct), `${u.hour5UsedPct}%`)}${r5 ? " " + theme.fg("dim", `·${r5}`) : ""}`,
          );
          if (u.hasWeekly) {
            const rW = fmtReset(u.weeklyResetMs);
            out.push(
              `${padVisible(theme.fg("accent", t.labelWeekly), LABEL_W)} ${bar(u.weeklyUsedPct)} ${theme.fg(pctToken(u.weeklyUsedPct), `${u.weeklyUsedPct}%`)}${rW ? " " + theme.fg("dim", `·${rW}`) : ""}`,
            );
          }
          if (u.mcpTotal != null) {
            const mcpPct = u.mcpTotal > 0 ? Math.round(((u.mcpUsed ?? 0) / u.mcpTotal) * 100) : 0;
            out.push(
              `${padVisible(theme.fg("accent", t.labelMcp), LABEL_W)} ${theme.fg("muted", t.mcpCalls(u.mcpUsed ?? 0, u.mcpTotal))} ${theme.fg(pctToken(mcpPct), `(${mcpPct}%)`)}`,
            );
            if (u.mcpDetails && u.mcpDetails.length > 0) {
              // 明细内容与上方数值列对齐（标签列宽+空格起），标签用 accent 统一
              const detail = u.mcpDetails.map((d) => `${d.modelCode} ${theme.fg("dim", String(d.usage))}`).join(theme.fg("dim", "  ·  "));
              out.push(`${padVisible(theme.fg("accent", t.labelDetails), LABEL_W)} ${detail}`);
            }
          }
          return out;
        };
        // 一次性 overlay 弹窗显示（不污染状态栏），Esc/q 关闭
        await ctx.ui?.custom?.(
          (_tui, theme, _keybindings, done) => ({
            render(_width: number): readonly string[] {
              return [
                theme.fg("accent", t.usageTitle),
                ...renderDetails(theme),
                "",
                theme.fg("dim", t.closeHint),
              ];
            },
            handleInput(data: string): void {
              // Esc / q / Enter / Ctrl-C 任一关闭（兼容不同终端的 Esc 编码）
              if (data === "q" || data === "Q" || data === "\r" || data === "\n" ||
                  data === "\x03" || data.startsWith("\x1b")) done(undefined);
            },
            invalidate(): void {},
          }),
          { overlay: true },
        );
      } catch (e) {
        ctx.ui?.notify?.(
          t.usageFail(e instanceof Error ? e.message : String(e)),
          "error",
        );
      }
    },
  });
}
