# omp-glm-hub

GLM Coding Plan 用量 + 上下文用量彩色状态栏扩展，用于 [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) coding agent。

在编辑器下方常驻显示两个指标：

```
  上下文 ▰▰▰▰▱▱▱▱▱▱ 13.2% 135K/1M │ GLM PRO 5h ▰▱▱▱▱▱▱▱▱▱ 5% ·2h44m
```

- **上下文用量** — 来自 OMP 核心精确 token 计数，自动跟随模型 contextWindow 变化（200K / 128K / 1M 等）
- **GLM Coding Plan 用量** — 调智谱用量查询 API，显示 5h / 每周额度、重置倒计时、MCP 各模型明细
- **彩色分级** — 已用 <50% 绿 / 50-79% 黄 / ≥80% 红
- **4 种进度条样式** — `▰▱` `█░` `●·` `━─`
- **单行 / 两行布局** — auto 模式按终端宽度自动切换（手机窄屏自动两行）

## 命令

| 命令 | 作用 |
|---|---|
| `/glm-config` | 交互式配置面板：选进度条样式、选单行/两行布局 |
| `/glm-usage` | 查询 GLM 用量详情（含套餐、5h、每周、MCP 各模型明细） |

## 安装

### 方式一：install 脚本（推荐）

```powershell
cd D:\Projects\omp-glm-hub
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会把扩展路径写入 OMP 全局配置（`~/.omp/agent/config.yml` 的 `extensions` 数组），改项目源码即生效，无需拷贝。重启 OMP 即可。

### 方式二：手动配置

编辑 `~/.omp/agent/config.yml`，在 `extensions` 数组中加入项目源文件路径：

```yaml
extensions:
  - D:/Projects/omp-glm-hub/src/glm-hub.ts
```

> 注意：路径用正斜杠 `/`，不要用反斜杠。

### 配置 API Key

GLM 用量查询需要智谱 API Key（与 `zhipu-coding-plan` provider 共用同一个 key）。二选一：

**方式 A（推荐，私密）** — 写入 key 文件：

```powershell
"你的智谱API_KEY" | Out-File -NoNewline "$env:USERPROFILE\.omp\agent\.glm-usage-key"
```

**方式 B** — 设系统环境变量 `ZHIPU_API_KEY`。

> 用量查询走智谱 monitor 端点（`/api/monitor/usage/quota/limit`），**不消耗 Coding Plan 额度**。

## 配置文件

扩展配置持久化在 `~/.omp/agent/.glm-config.json`：

```json
{
  "barStyle": "block",
  "layout": "auto"
}
```

| 字段 | 值 | 说明 |
|---|---|---|
| `barStyle` | `block` / `classic` / `dot` / `line` | 进度条字符样式 |
| `layout` | `auto` / `one` / `two` | auto 按终端宽度自动选单行/两行 |

也可通过 `/glm-config` 命令交互式修改，即时生效并持久化。

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

- **不是 OMP 插件，是扩展（extension）** — 放在 OMP 自动发现的 `~/.omp/agent/extensions/` 或通过 config `extensions` 数组加载
- **不会被 OMP 更新覆盖** — 扩展在用户数据目录，npm 更新只动 `node_modules`
- **改源码即生效** — 重启 OMP 自动重新加载（带 `?mtime` 缓存清除）

## License

MIT
