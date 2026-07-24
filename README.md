# omp-hud-glm

GLM Coding Plan 用量 + 上下文用量彩色状态栏插件，用于 [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) coding agent。

在编辑器下方常驻显示两个指标：

```
  上下文 ▰▰▰▰▱▱▱▱▱▱ 13.2% 135K/1M │ GLM PRO 5h ▰▱▱▱▱▱▱▱▱▱ 5% ·2h44m
```

- **上下文用量** — 来自 OMP 核心精确 token 计数，自动跟随模型 contextWindow 变化（200K / 128K / 1M 等）
- **GLM Coding Plan 用量** — 调智谱用量查询 API，显示 5h / 每周额度、重置倒计时、MCP 各模型明细
- **彩色分级** — 已用 <50% 绿 / 50-79% 黄 / ≥80% 红
- **4 种进度条样式** — `▰▱` `█░` `●·` `━─`
- **单行 / 双行布局** — auto 模式按终端宽度自动切换（手机窄屏自动双行）

## 命令

| 命令 | 作用 |
|---|---|
| `/omp-hud-glm:setup` | 交互式配置：设置 API Key、选进度条样式、选单行/双行布局 |
| `/omp-hud-glm:usage` | 查询 GLM 用量详情（含套餐、5h、每周、MCP 各模型明细） |

## 安装

### 方式一：一行安装（推荐）

```bash
omp plugin install github:pmp2001cn/omp-hud-glm
```

安装后重启 OMP 即可。后续 `omp plugin upgrade omp-hud-glm` 更新。

### 方式二：本地开发安装

```bash
git clone https://github.com/pmp2001cn/omp-hud-glm.git
cd omp-hud-glm
omp plugin install .
```

### 配置 API Key

GLM 用量查询需要智谱 API Key（与 `zhipu-coding-plan` provider 共用同一个 key）。三选一：

**方式 A（推荐）** — 运行 `/omp-hud-glm:setup`，交互式粘贴 Key。

**方式 B** — 写入 key 文件：

```powershell
"你的智谱API_KEY" | Out-File -NoNewline "$env:USERPROFILE\.omp\agent\.omp-hud-glm-key"
```

**方式 C** — 设系统环境变量 `ZHIPU_API_KEY`。

> 用量查询走智谱 monitor 端点（`/api/monitor/usage/quota/limit`），**不消耗 Coding Plan 额度**。

## 配置文件

扩展配置持久化在 `~/.omp/agent/.omp-hud-glm-config.json`：

```json
{
  "barStyle": "block",
  "layout": "auto"
}
```

| 字段 | 值 | 说明 |
|---|---|---|
| `barStyle` | `block` / `classic` / `dot` / `line` | 进度条字符样式 |
| `layout` | `auto` / `one` / `two` | auto 按终端宽度自动选单行/双行 |

也可通过 `/omp-hud-glm:setup` 命令交互式修改，即时生效并持久化。

> 升级自旧版本（omp-glm-hub / glm-usage）时，历史配置和 Key 文件会自动迁移，无需手动处理。

## 数据来源

### 上下文用量

来自 OMP 核心 `ctx.getContextUsage()`，精确 token 计数（非估算）：

```
usedTokens = skillsTokens + toolsTokens + systemContextTokens + systemPromptTokens + 所有 messages token
percent = usedTokens / contextWindow × 100
```

`contextWindow` 取当前活跃模型的值，切换模型自动跟随。

### GLM Coding Plan 用量

调智谱用量查询 API：

```
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Authorization: <API_KEY>
```

返回数据含 `TOKENS_LIMIT`（5h / 每周）和 `TIME_LIMIT`（MCP 月度，含各模型明细）。

刷新策略借鉴 [claude-hud](https://github.com/jarrodwatts/claude-hud) 的事件驱动 + 节流：
- `turn_end` / `session_compact` 事件触发刷新
- GLM 用量请求有 60 秒最小间隔（节流）
- 5 分钟定时兜底刷新重置倒计时

## 技术说明

- **OMP 插件** — 通过 `package.json` 的 `omp.extensions` 声明，`omp plugin install` 安装
- **不会被 OMP 更新覆盖** — 插件在用户数据目录，npm 更新只动 OMP 本体
- **改源码即生效** — 重启 OMP 自动重新加载（带 `?mtime` 缓存清除）

## License

MIT
