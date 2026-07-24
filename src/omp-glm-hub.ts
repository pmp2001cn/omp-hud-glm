// GLM Coding Plan 用量 + 上下文用量彩色 Widget 扩展
//
// 功能：
//   - 编辑器下方常驻 widget，显示上下文用量 + GLM Coding Plan 5h/每周额度
//   - /omp-glm-config 命令：交互式选择进度条样式、单行/两行布局
//   - /omp-glm-usage 命令：查询 GLM 用量详情（含 MCP 各模型明细）
//   - auto 布局：按终端宽度自动选单行（宽屏）或两行（窄屏，如手机）
//
// 上下文数据来自 OMP 核心 ctx.getContextUsage()（精确 token 计数，自动跟随模型变化）。
// GLM 数据来自智谱用量 API（monitor 端点，不消耗 coding plan 额度）。
//
// API Key 来源（按优先级）：
//   1. 环境变量 ZHIPU_API_KEY
//   2. 本地文件 ~/.omp/agent/.omp-glm-usage-key
// 配置文件：~/.omp/agent/.omp-glm-config.json
//
// 向后兼容：若新文件不存在，自动回退读取旧名（.glm-config.json / .glm-usage-key）。

const ENDPOINT = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const REFRESH_MS = 5 * 60 * 1000;
const WIDGET_KEY = "omp-glm-usage";
const CTX_WIDGET_KEY = "omp-glm-ctx";

// 进度条样式映射：filled/empty 字符对
const BAR_STYLES: Record<string, { filled: string; empty: string; label: string }> = {
  block:   { filled: "▰", empty: "▱", label: "▰▱ 实心方块" },
  classic: { filled: "█", empty: "░", label: "█░ 经典方块" },
  dot:     { filled: "●", empty: "·", label: "●· 圆点" },
  line:    { filled: "━", empty: "─", label: "━─ 细横线" },
};

// 颜色常量（真彩色，暗色背景调亮）
const C_ACCENT = "#7aa2f7";
const C_OK = "#9ece6a";
const C_WARN = "#e0af68";
const C_ERR = "#f7768e";
const C_DIM = "#9aa5ce";
const C_SEP = "#4c566a";

interface OmpGlmConfig {
  barStyle: string;  // block | classic | dot | line
  layout: string;    // auto | one | two
}

const DEFAULT_CONFIG: OmpGlmConfig = { barStyle: "block", layout: "auto" };

function agentDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return `${home}/.omp/agent`;
}

function configFilePath(): string {
  return `${agentDir()}/.omp-glm-config.json`;
}

function keyFilePath(): string {
  return `${agentDir()}/.omp-glm-usage-key`;
}

// 读取配置（失败回退默认值）。新文件不存在时回退旧名并自动迁移。
async function loadConfig(): Promise<OmpGlmConfig> {
  const readAt = async (p: string): Promise<OmpGlmConfig | null> => {
    try {
      const f = Bun.file(p);
      if (await f.exists()) {
        const c = await f.json();
        return {
          barStyle: BAR_STYLES[c.barStyle] ? c.barStyle : "block",
          layout: ["auto", "one", "two"].includes(c.layout) ? c.layout : "auto",
        };
      }
    } catch {
      // 配置读取失败，忽略
    }
    return null;
  };

  const cur = await readAt(configFilePath());
  if (cur) return cur;

  // 回退旧名（.glm-config.json），命中则顺带迁移到新名
  const legacy = await readAt(`${agentDir()}/.glm-config.json`);
  if (legacy) {
    await saveConfig(legacy);
    return legacy;
  }
  return { ...DEFAULT_CONFIG };
}

async function saveConfig(c: OmpGlmConfig): Promise<void> {
  try {
    await Bun.write(configFilePath(), JSON.stringify(c, null, 2));
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
  hour5ResetText: string;
  weeklyResetText: string;
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
  // 新名优先，回退旧名（.glm-usage-key），不自动迁移以免动 key 文件
  for (const p of [keyFilePath(), `${agentDir()}/.glm-usage-key`]) {
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

function fmtReset(ms?: number): string {
  if (!ms) return "";
  const diff = ms - Date.now();
  if (diff <= 0) return "reset";
  const totalMin = Math.round(diff / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h${m}m` : `${h}h`;
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
    hour5ResetText: fmtReset(hour5?.nextResetTime),
    weeklyResetText: fmtReset(weekly?.nextResetTime),
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

// 上下文段：标签 + 进度条 + 百分比 + 已用/窗口
function renderContextSegment(
  cu: { tokens?: number; contextWindow?: number; percent?: number } | null,
  style: string,
): string {
  if (!cu || !cu.contextWindow) return fg(C_DIM, "上下文：暂无数据");
  const pct = Math.min(100, Math.max(0, cu.percent ?? 0));
  const used = cu.tokens ?? 0;
  const tag = fg(C_ACCENT, "上下文");
  const bar = coloredBar(pct, style);
  const pctC = fg(colorForUsage(pct), `${pct.toFixed(1)}%`);
  const detail = fg(C_DIM, `${fmtWindow(used)}/${fmtWindow(cu.contextWindow)}`);
  return `${tag} ${bar} ${pctC} ${detail}`;
}

// GLM 段：标签 + 进度条 + 百分比 + 重置时间
function renderGlmSegment(u: ParsedUsage, style: string): string {
  const c5 = colorForUsage(u.hour5UsedPct);
  const tag = fg(C_ACCENT, `GLM${u.level ? " " + u.level.toUpperCase() : ""} 5h`);
  const bar5 = coloredBar(u.hour5UsedPct, style);
  const pct5 = fg(c5, `${u.hour5UsedPct}%`);
  const reset5 = u.hour5ResetText ? fg(C_DIM, `·${u.hour5ResetText}`) : "";
  let seg = `${tag} ${bar5} ${pct5} ${reset5}`;
  if (u.hasWeekly) {
    const cw = colorForUsage(u.weeklyUsedPct);
    const barW = coloredBar(u.weeklyUsedPct, style);
    const pctW = fg(cw, `${u.weeklyUsedPct}%`);
    const resetW = u.weeklyResetText ? fg(C_DIM, `·${u.weeklyResetText}`) : "";
    seg += ` ${fg(C_ACCENT, "周")} ${barW} ${pctW} ${resetW}`;
  }
  return seg;
}

// 终端可见宽度（去除 ANSI）
function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// 根据配置和终端宽度决定单行还是两行
function useOneLine(config: OmpGlmConfig): boolean {
  if (config.layout === "one") return true;
  if (config.layout === "two") return false;
  // auto：窄屏（手机）用两行，宽屏合并
  const cols = process.stdout.columns ?? parseInt(process.env.COLUMNS ?? "120", 10) ?? 120;
  return cols >= 110;
}

// 渲染 widget 行（数组）：单行合并或两行分离
export function renderWidgetLines(
  cu: { tokens?: number; contextWindow?: number; percent?: number } | null,
  u: ParsedUsage | null,
  config: OmpGlmConfig,
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
  if (!json.success) throw new Error(json.msg || "用量查询失败");
  return parseUsage(json);
}

export default function (pi): void {
  let warnedMissingKey = false;
  let lastUsage: ParsedUsage | null = null;
  let lastRefreshAt = 0;
  let config: OmpGlmConfig = { ...DEFAULT_CONFIG };
  const MIN_REFRESH_GAP = 60_000;

  async function reloadConfig(): Promise<void> {
    config = await loadConfig();
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
        fg(C_ERR, "  GLM 用量：未配置 API Key"),
      ], { placement: "belowEditor" });
      if (!warnedMissingKey && ctx.ui?.notify) {
        warnedMissingKey = true;
        ctx.ui.notify(
          "GLM 用量扩展：未检测到 API Key。请设置环境变量 ZHIPU_API_KEY，或在 ~/.omp/agent/.omp-glm-usage-key 写入 key。",
          "warning",
        );
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
        fg(C_ERR, `  GLM：${e instanceof Error ? e.message : "查询出错"}`),
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

  // /omp-glm-config：交互式设置面板
  pi.registerCommand("omp-glm-config", {
    description: "配置 GLM 用量 widget（进度条样式、单行/两行布局）",
    handler: async (_args, ctx) => {
      // 1. 选进度条样式
      const styleLabels = Object.entries(BAR_STYLES).map(
        ([k, v]) => `${v.label}${k === config.barStyle ? " (当前)" : ""}`,
      );
      const pickedStyle = await ctx.ui?.select?.("选择进度条样式", styleLabels);
      if (!pickedStyle) return;
      const styleKey = Object.entries(BAR_STYLES).find(
        ([, v]) => pickedStyle.startsWith(v.label),
      )?.[0];
      if (styleKey) config.barStyle = styleKey;

      // 2. 选布局
      const layoutLabels = [
        `auto 自动（宽屏单行/窄屏两行）${config.layout === "auto" ? " (当前)" : ""}`,
        `one 单行${config.layout === "one" ? " (当前)" : ""}`,
        `two 两行${config.layout === "two" ? " (当前)" : ""}`,
      ];
      const pickedLayout = await ctx.ui?.select?.("选择布局", layoutLabels);
      if (!pickedLayout) return;
      if (pickedLayout.startsWith("auto")) config.layout = "auto";
      else if (pickedLayout.startsWith("one")) config.layout = "one";
      else config.layout = "two";

      await saveConfig(config);
      // 立即重渲染
      renderWidgets(ctx, lastUsage);
      ctx.ui?.notify?.(
        `已保存：进度条 ${BAR_STYLES[config.barStyle].label}，布局 ${config.layout}`,
        "info",
      );
    },
  });

  pi.registerCommand("omp-glm-usage", {
    description: "查询 GLM Coding Plan 用量详情",
    handler: async (_args, ctx) => {
      try {
        const apiKey = await resolveApiKey();
        if (!apiKey) {
          ctx.ui?.notify?.(
            "未配置 API Key（ZHIPU_API_KEY 或 ~/.omp/agent/.omp-glm-usage-key），无法查询。",
            "error",
          );
          return;
        }
        const u = await fetchUsage(apiKey);
        if (!u) {
          ctx.ui?.notify?.("用量查询返回空数据", "warning");
          return;
        }
        const lines: string[] = [];
        if (u.level) lines.push(`套餐：${u.level.toUpperCase()}`);
        lines.push(
          `5h ${plainBar(u.hour5UsedPct, config.barStyle)} ${u.hour5UsedPct}%${u.hour5ResetText ? " · " + u.hour5ResetText : ""}`,
        );
        if (u.hasWeekly) {
          lines.push(
            `每周 ${plainBar(u.weeklyUsedPct, config.barStyle)} ${u.weeklyUsedPct}%${u.weeklyResetText ? " · " + u.weeklyResetText : ""}`,
          );
        }
        if (u.mcpTotal != null) {
          const mcpPct = u.mcpTotal > 0 ? Math.round(((u.mcpUsed ?? 0) / u.mcpTotal) * 100) : 0;
          lines.push(`MCP 月度：${u.mcpUsed ?? 0}/${u.mcpTotal} 次 (${mcpPct}%)`);
          if (u.mcpDetails && u.mcpDetails.length > 0) {
            lines.push(`  明细：${u.mcpDetails.map((d) => `${d.modelCode} ${d.usage}`).join(" · ")}`);
          }
        }
        ctx.ui?.notify?.(lines.join("\n"), "info");
      } catch (e) {
        ctx.ui?.notify?.(
          `GLM 用量查询失败：${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    },
  });
}
