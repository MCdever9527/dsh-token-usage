# dsh-token-usage

给 DSH（DeepSeek Harness）补上**按「提供商 × 模型」分类的 token 用量统计**：
宿主半区扫描**全部历史会话日志（含已归档会话与子代理会话）**，把各家提供商、
各个模型消耗的 token 汇总成一份快照；浏览器半区在**设置 → Token 统计**页渲染
成表格，并随宿主的周期扫描自动刷新。

它是独立 DSH 组合包（host + client 双半区），只挂在官方公开的接缝上，
不修改客户端源码。

## 统计口径

| 项 | 口径 |
| --- | --- |
| 数据源 | `$DSH_HOME/sessions` 下**全部已存储会话**：官方清单与文件系统遍历取并集——归档只是 UI 标记，日志原地保留，照样统计 |
| 读取器 | 首选官方 `ctx.sessionPersistence.open(id,'read')`（自动迁移 legacy 格式、校验回放）；**该接缝读不动的会话自动落盘直读日志文件**（多帧 zstd 逐帧解码，legacy 的 `assistant/message` 同样带 provider/model/usage；无 provider 的 `assistant/chunk` 用量是同次调用的重复，正确忽略不重复计数） |
| 归属粒度 | **每条模型调用自己的路由**：`assistant/message` 的 `message.source.{provider, model}`。同一会话**中途换模型、甚至跨提供商切换**，切换前后的用量各自记到当时真正服务的那条路由下；同名模型挂在多个提供商下时也按 (提供商, 模型) 复合键分开 |
| 计数语义 | 与官方 `tokenUsage` 投影一致：同一步骤的重复结算**替换**（minus 旧 + plus 新），`llm/retry-started` 关闭替换槽让重试**另计**一次计费用量；`assistant/attempt` 的 usage 归到当次请求声明的路由 |
| 额外来源 | `compaction/summary`（压缩本身消耗的 token）按其自带的 provider/model 直接计入 |
| 列含义 | 输入 = 未命中缓存的输入；缓存读单列；输出含推理 token（推理单列展示但不重复计入合计）；**合计 = 输入 + 缓存读 + 输出**（与官方 totalTokens 定义一致） |
| 刷新 | 挂载时全量扫描一次（约 10~15s / 100 会话，后台进行），此后每 30s 检查一次存储会话清单，只重折有新用量的会话；页面通过文件监听实时跟随 |
| 时间维度 | 每条样按**事件自身时间**落入本地自然日的日桶；页面按 今天 / 近 3 天 / 近 7 天 / 近 30 天 / 全部 就地求和，切换零延迟、不重扫日志 |

## 时间筛选

页面工具条上的「时间范围」：**今天 · 近 3 天 · 近 7 天 · 近 30 天 · 全部**，窗口为**本地自然日**、含今天（近 3 天 = 今天 + 前 2 天，以此类推），全部时间含无法定日的样本。

- 宿主在折叠时就把每条用量落到 `YYYY-MM-DD`（本地）日桶，快照里每个模型行带 `days` 序列；
- 页面过滤只是把这些日桶按窗口相加，提供商小计与全部合计都随之重算；窗口内没有任何用量时显示「该时间范围内暂无用量」；
- 「全部」直接读行的历史总计（与日桶求和在数值上一致），因此即使快照尚未重建日序列也不会空表。

## 界面

**侧栏 → 设置 → Token 统计**：

- 顶部「全部合计」卡片（输入 / 缓存读 / 输出 / 合计 / 调用次数）
- 每个提供商一张可折叠卡片：显示名（取自 llm-pi-ai 配置的 displayName）+ id + 该提供商合计；展开后每个模型一行（输入、缓存读、输出、合计、缓存命中率、调用次数）+ 小计行
- 元信息行：更新时间、会话数（含已归档数）、扫描耗时
- 「展开全部 / 全部折叠」「刷新」按钮；数字悬停显示精确值

## 安装

本插件是一个普通 DSH 组合包，由客户端的插件管理器托管：

| 位置 | 内容 |
| --- | --- |
| `~/.dsh/profiles/desktop/package.json` | `dependencies: { "dsh-token-usage": "link:<本仓库绝对路径>" }`，并在 `dsh.profile.bundles` 中选中 |
| `~/.dsh/profiles/desktop/node_modules/dsh-token-usage` | pnpm/npm 建的链接 |

或：**侧栏 → 插件 → 添加插件**，粘贴本目录绝对路径，安装后点**立即启用**。
卸载同样在插件页完成。

## 工作原理

数据通道全部走官方已公开的表面，插件不自建宿主↔浏览器通道：

| 步骤 | 做法 |
| --- | --- |
| 枚举 | `ctx.sessionPersistence.list()`（按调用时惰性解析，挂载时快照会把启动竞态里的 `undefined` 锁死）**∪ 遍历会话根目录**，两边都不能藏会话 |
| 读取 | `open(id, 'read')` → `read(0, undefined)`；失败则回退直读最新一代日志（`frameSpans` 按 zstd 帧头逐块精确计算帧长——内容尺寸只描述解码后大小，不能用来算存储长度；撕裂尾部只丢未完成帧） |
| 折叠 | `src/fold.ts` 纯状态机：替换槽 + 重试清槽 + 路由回退链（`message.source` → 跟踪的 `model/selection`/`request/context`/`request/header`） |
| 聚合 | 全会话求和 → 原子写 `$DSH_HOME/cache/dsh-token-usage/stats.json` |
| 展示 | 浏览器经 `remote.$host.home` 拿路径、`remote.session.list` 拿会话身份、`remote.workspaceFiles.read/changes` 读文件并监听变化（官方文件 Remote 明确允许工作区外的绝对路径读取）。注意 `$host.home` 是**操作系统用户主目录**（宿主注册远程事件源时传的是 `homedir()`），不是 `$DSH_HOME`：页面先探测 `<用户主目录>/.dsh/cache/dsh-token-usage/stats.json`（默认安装即此处），缺失时再读同目录的 `anchor.json`（宿主始终写入，内含真实 stats 路径）跟进自定义 `$DSH_HOME` |

诊断：每次激活写 `$DSH_HOME/cache/dsh-token-usage/stats-status.json`（版本、
激活时间、最近一次扫描的统计与失败原因）。文件不存在 = entry 没挂上。

## 开发

```sh
node build.mjs          # 构建 lib/index.js（宿主）与 lib/client.js（浏览器）
node tools/tsc.mjs      # 类型检查
```

本包不安装 esbuild / typescript / `@types`，开发时从**同级检出**的 `node_modules` 借用。这些路径因机器而异，
因此放在仓库根一个**不纳入版本控制的** `.dsh-local.json`（可选）：

```json
{ "moduleRoots": ["D:/some/checkout/node_modules"] }
```

字段可选，文件不存在就等于没有额外候选；环境变量 `DSH_ESBUILD` / `DSH_TSC` 优先级更高。
全新克隆不需要这个文件：先 `npm install`，工具链就走本包自己的 `node_modules`。

单测（`tests/*.spec.ts`）与冒烟脚本（`tools/run-tests.mjs`、`tools/smoke-*.mjs`）是**本地专用资产**，
不随本仓库发布，所以本仓库里没有 `npm test`；`node build.mjs --tests` 在没有 `tests/` 的检出里会直接跳过。

### 结构

| 文件 | 作用 |
| --- | --- |
| `src/fold.ts` | 纯折叠状态机（浏览器安全，无 Node 导入） |
| `src/log-file.ts` | 宿主兜底读取器：zstd 多帧精确遍历 + 最新一代选择 + 直读解码 |
| `src/status.ts` | DSH_HOME 解析与激活报告写入器 |
| `src/index.ts` | 宿主半区：扫描器、快照组装、原子发布、轮询 |
| `src/client/stats-source.ts` | 浏览器数据源：路径/会话/读取/监听，订阅驱动生命周期 |
| `src/client/page.tsx` | 设置页：提供商折叠卡片与表格 |
| `src/client/index.tsx` | 客户端入口：`settings.section` 座位注册（order 19） |

## 已知边界

- 缓存写（cacheWrite）维度已整体移除（v1.1.0）：实测快照里该值在全部提供商、全部模型、全部日桶上均为 0，纯属占位。若将来某提供商真开始上报缓存写，其 token 不计入任何列、也不计入合计。
- 缓存命中率 = 缓存读 /（输入 + 缓存读），即命中缓存的输入占全部输入 token 的比例。
- `totalTokens` 各提供商上报不一致（有的不写），合计一律自行计算。
- 投影缓存（projcache）与日志口径不同（它剔除被压缩掉的历史），本插件以**日志为准**——那是计费口径。
- 没有挂载 session-persistence 的组合会让页面报「统计文件读取失败」；桌面基础组合恒有该服务。

## 许可

MIT，见 [LICENSE](LICENSE)。
