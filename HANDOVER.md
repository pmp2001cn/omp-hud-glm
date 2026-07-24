# omp-hud-glm 交接文档

> 本文档供下一个会话快速接手项目状态。读完即可开始开发，无需重新摸索。

## 项目概况

- **名称**：omp-hud-glm
- **仓库**：https://github.com/pmp2001cn/omp-hud-glm（Public）
- **本地目录**：`D:\Projects\omp-hud-glm`
- **性质**：Oh My Pi (OMP) 插件，为 GLM Coding Plan 用户在编辑器下方常驻显示「上下文用量 + GLM 套餐用量」彩色状态栏，并提供两个斜杠命令。
- **作者**：Simon Wang
- **许可**：MIT
- **状态**：已发布 v1.0.0，可用 `omp plugin install github:pmp2001cn/omp-hud-glm` 一行安装。

## 目录结构

```
omp-hud-glm/
├── .gitignore          # 忽略 node_modules、运行时文件（.omp-hud-glm-*）
├── README.md           # 项目说明 + 安装/配置文档
├── package.json        # 插件清单，声明 omp.extensions 入口
└── src/
    └── omp-hud-glm.ts  # 唯一源文件（全部逻辑在此）
```

## 安装与开发

### 用户安装（标准）
```bash
omp plugin install github:pmp2001cn/omp-hud-glm
```

### 本地开发（当前所用方式）
```bash
cd D:\Projects\omp-hud-glm
omp plugin install .     # 本地 link，改 src/ 即生效，重启 OMP 重新加载
```

### 更新发布流程
1. 改 `src/omp-hud-glm.ts`
2. `bun --check src/omp-hud-glm.ts` 类型检查
3. `git add -A && git commit -m "..." && git push`
4. 用户侧更新：`omp plugin uninstall omp-hud-glm && omp plugin install github:pmp2001cn/omp-hud-glm`
   （github 直装的插件 `omp plugin upgrade` 不支持，需重装；marketplace 安装才支持 upgrade）

## 关键技术约束（踩坑总结）

### 1. OMP 插件机制
- 插件入口由 `package.json` 的 **`omp.extensions`** 数组声明（不是 `main`）：
  ```json
  "omp": { "extensions": ["src/omp-hud-glm.ts"] }
  ```
- `omp plugin install .` 本地 link；`omp plugin install github:user/repo` 从 git 安装。
- **widget（常驻状态栏）** 用 `ctx.ui.setWidget(key, string[], {placement})`。
- **一次性弹窗** 用 `ctx.ui.custom(factory, {overlay:true})`，factory 返回 `{render(width), handleInput(data), invalidate()}`。
- **文本输入**（如配 API Key）用 `ctx.ui.input(title, placeholder)`。
- **选项选择** 用 `ctx.ui.select(title, options)`。

### 2. 颜色方案（两套，不可混用）
- **widget 状态栏**：自写 ANSI 真彩色，用顶部定义的常量 `C_ACCENT`/`C_OK`/`C_WARN`/`C_ERR`/`C_DIM`/`C_SEP` + `fg(hex, text)` 函数。深色背景调校过，清晰。
- **overlay 弹窗**（如 `/omp-hud-glm:usage`）：**必须用系统主题色** `theme.fg("accent"|"dim"|"success"|"warning"|"error"|"muted", text)`，自动适配深/浅色模式。不要在 overlay 里用自写 ANSI（会脱离主题）。

### 3. 对齐：padVisible 必须按显示宽度算
源文件中的 `padVisible(text, width)` 已修正为按**显示宽度**（中文/全角=2列，ASCII=1列）补空格。早期版本用 `.length`（码元数）导致中文标签行错位——切勿退回旧实现。
```ts
const dispW = [...visible].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
```
当前所有标签（套餐/5h/每周/MCP/明细）统一 `padVisible(label, 4) + " "`，内容对齐到显示列 6。

### 4. 时间格式化（fmtReset）
位于约 173 行，把重置时间戳格式化为 `1h38m`/`2d3h`/`45m`/`reset`。**这是英文缩写**，下一任务（自适应语种）需改造为中文模式输出「1小时38分」等。

### 5. 文件路径与历史名回退
配置和 Key 文件历经三代改名，当前用 `CONFIG_PATHS`/`KEY_PATHS` 数组做回退读取（新名优先，命中旧名则迁移）：
- 配置：`.omp-hud-glm-config.json` ← `.omp-glm-config.json` ← `.glm-config.json`
- Key：`.omp-hud-glm-key` ← `.omp-glm-usage-key` ← `.glm-usage-key`
**切勿删除回退逻辑**，否则老用户升级会丢配置/Key。

## 下一个任务：自适应语种

### 需求
- 中文系统 → 全中文界面；英文系统 → 全英文界面
- 自动检测，无需用户配置

### 已验证的检测方法
```ts
const locale = Intl.DateTimeFormat().resolvedOptions().locale; // "zh-CN" / "en-US"
const isZh = locale.startsWith("zh");
```
此方法跨平台可靠（Windows/macOS/Linux 均可），已在本机验证返回 `zh-CN`。**勿用** `process.env.LANG`（Windows 无此变量）或 fork PowerShell（过重）。

### 需要改造的字符串清单

**widget 状态栏（renderContextSegment / renderGlmSegment，约 245-276 行）**
| 当前 | 中文 | 英文 |
|---|---|---|
| `上下文` | 上下文 | Context |
| `GLM {level} 5h` | `GLM {level} 使用率`（用户原话：「PRO使用率」）| `GLM {level} 5h` |
| `周`（每周段标签）| 周 | Wk |
| `上下文：暂无数据` | 上下文：暂无数据 | Context: no data |

**fmtReset（约 173-187 行）时间格式**
| 当前 | 中文 | 英文 |
|---|---|---|
| `1h38m` | 1小时38分 | 1h38m |
| `2d3h` | 2天3小时 | 2d3h |
| `45m` | 45分 | 45m |
| `reset` | 已重置 | reset |

**setup 命令（约 392-455 行）**
- input 提示：「配置智谱 API Key...」「已配置，留空保持不变」「粘贴你的智谱 API Key」→ 对应英文
- notify：「✓ API Key 已保存...」「未设置 API Key...」→ 对应英文
- select 标题：「选择进度条样式」「选择布局」→ 英文
- BAR_STYLES 的 label（约 24-29 行）：「▰▱ 实心方块」→ 「▰▱ Block」等
- 布局选项：「auto 自动（宽屏单行/窄屏双行）」→ 英文
- notify 结果：「已保存：进度条 X，布局 Y」→ 英文
- "(当前)" → "(current)"

**usage overlay（约 458-536 行）**
- 标题「GLM Coding Plan 用量」→ 英文
- 标签：套餐/5h/每周/MCP/明细 → Plan/5h/Weekly/MCP/Details
- 「次」（MCP 次数）→ calls
- 「按 Esc 或 q 关闭」→ Press Esc or q to close
- 错误：「未配置 API Key...」「用量查询返回空数据」「GLM 用量查询失败」→ 英文

**refreshGlm 错误提示（约 341-362 行）**
- 「GLM 用量：未配置 API Key」「GLM 用量扩展：未检测到 API Key...」「查询出错」→ 英文

### 建议的实现架构
创建一个 `t` 翻译表对象，模块级初始化一次（`const i18n = isZh ? zhStrings : enStrings`），所有用户可见字符串改为 `t.xxx` 引用。避免散落的 `isZh ? : ` 三元。示例：

```ts
const zhStrings = {
  context: "上下文", glmUsage: (level) => `GLM ${level} 使用率`,
  resetFmt: (h, m) => m > 0 ? `${h}小时${m}分` : `${h}小时`,
  // ...
};
const enStrings = { /* 对应英文 */ };
```

### 注意事项
1. **fmtReset 改造后**，注意显示宽度变化（「1小时38分」比「1h38m」宽很多），需同步检查 `useOneLine` 的单行/双行切换阈值（当前 cols>=110 单行，约 279 行）——中文更长可能挤爆单行。
2. **padVisible 已支持中文宽度**，新字符串若含中文会自动正确对齐，无需额外处理。
3. **git commit 建议**：完成后单独一个 commit「feat: 自适应中英文语种」，便于回溯。

## 运行时文件位置（用户机器）

- 配置：`~/.omp/agent/.omp-hud-glm-config.json`
- API Key：`~/.omp/agent/.omp-hud-glm-key`
- 或环境变量 `ZHIPU_API_KEY`

## 最近 commit 历史
```
a90e96a fix: 修正 usage 详情对齐与明细标签颜色
0918eb7 fix: usage 改为一次性 overlay 弹窗，用系统主题色，不污染状态栏
65c6c9c feat: usage 详情改用系统彩色 widget 渲染并对齐列宽
1160f32 refactor: 重命名为 omp-hud-glm 并改造为 OMP 插件，setup 命令支持配置 API Key
6a4416b feat: 初始化 omp-glm-hub 项目
```

---
*生成于 2026-07-24 目录迁移完成后。新会话请先读本文件，再开始自适应语种任务。*
