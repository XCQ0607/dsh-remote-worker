# Changelog

本文件记录 dsh-remote-worker 的所有版本变更。发布流程会读取**最新一个 `## v…` 小节**作为 Release 说明。

格式约定：版本标题固定为 `## v<版本号> (<YYYY-MM-DD>)`，下一行起用 `###` 分类（新增 / 修复 / 优化 / 文档），条目用 `- ` 列表。

## v1.0.1 (2026-11-17)

STUN 配置重构：新增「总开关 + 公共列表 + Cloudflare」三层开关，内置 10 条实测可用的公共 STUN 列表并设为默认。

### 新增

- **STUN 总开关（「启用 STUN」）**：关闭后不下发任何 STUN，**连 Cloudflare TURN 凭据里自带的两条也一并剔除**，客户端只剩 TURN / Relay。此前只能靠清空自定义列表，而 TURN 可用时又会把 Cloudflare 的 STUN 塞回来，等于关不掉。
- **「启用公共列表 STUN」开关（默认开）**：追加内置公共列表 `PUBLIC_STUN`（`worker/src/stun.ts`），本版共 10 条：
  - 国内：`stun.miwifi.com:3478`、`stun.chat.bilibili.com:3478`、`stun.hitv.com:3478`、`stun.douyucdn.cn:18000`
  - 国际：`stun.cloudflare.com:443`、`stun.l.google.com:19302`、`stun1.l.google.com:19302`、`global.stun.twilio.com:3478`、`stun.voip.blackberry.com:3478`、`stun.nextcloud.com:443`
  - 均在本机国内网络实测能返回 `XOR-MAPPED-ADDRESS`（各 2 次以上）；`stun.cloudflare.com:3478`、`stun.qq.com:3478`、`stun.sipgate.net`、`stunserver.stunprotocol.org`、`stun.syncthing.net`、`stun.ekiga.net`、`stun.ideasip.com`、`stun.bige0.com` 实测不通，未收录。
- **「启用 Cloudflare STUN」开关（默认关）**：追加 `stun.cloudflare.com` 的 3478 / 443 两条；**只有填了自定义 STUN 才能开启**，否则保存时后端会强制关闭该开关（避免与 TURN 自带的 STUN 重复），后台对应行会显示「未启用」徽章并禁用。
- **设置页新增「当前实际下发的 STUN（N 条）」预览**：直接展示三层开关解析后的最终列表，以及公共列表全文，改完保存即可对照，不用猜。
- 新增 `GET /api/v1/admin/settings` 返回字段 `effectiveStun` / `publicStun`。
- 新增环境变量默认值 `DSH_STUN_ENABLED`（true）、`DSH_STUN_USE_PUBLIC_LIST`（true）、`DSH_STUN_USE_CLOUDFLARE`（false）、`DSH_STUN_URLS`（空）。

### 修复

- **自定义 STUN 在 TURN 可用时被完全忽略**：旧实现只要 TURN 签发成功就原样返回 Cloudflare 的 `iceServers`，后台填写的地址根本不生效。现在按开关解析后**自定义排最前**，TURN 仅作为打洞失败后的中转兜底。
- **关闭 TURN 会连带丢掉自定义 STUN**：改为「启用 TURN」只控制是否签发 TURN 凭据，STUN 完全由三个 STUN 开关决定。
- **TURN 凭据里的 STUN 无法剔除**：新增 `stripStun` / `stripStunFromMixed`，总开关关闭时整条剔除，开启时也只保留被开关认可的地址。
- **缓存键未包含 STUN 配置**：切换开关后最长 60 秒内仍拿到旧合并结果；现改为 `keyId:ttl:stunUrls`，保存即生效。
- **设置项 16 条上限原先在格式过滤前生效**：改为先按 `stun:` / `stuns:` 过滤再截断。

### 优化

- 默认 STUN 从单条 `stun:stun.cloudflare.com:3478` 改为「公共列表全开 + Cloudflare 关闭」，开箱即用且国内可通。
- 设置页文案补齐：总开关 / 自定义 / 公共列表 / Cloudflare 四项分别说明生效条件与顺序。
- README 新增「STUN 与 ICE 配置」整节：三个开关的作用与约束、10 条公共列表的来源与实测结论、刻意排除的地址、环境变量默认值、排错建议。

## v1.0.0 (2026-11-17)

首个正式版本：基于 Cloudflare Workers + Durable Objects（SQLite + WebSocket Hibernation）重构的 `ds-harness-remote` 自建中转服务端，可在 Cloudflare **免费版**直接运行。

### 新增

- **中转与信令核心**：单个 `Hub` Durable Object 承载全部账号（按账号在存储与 Link 中隔离），实现 Hello 握手校验、Link 状态机（`connecting → ready → closed`）与 Host ⇄ Client 的 Relay 帧互转。
- **WebSocket Hibernation**：空闲连接不产生计费时长；集成 ping/pong 心跳（默认 25s）与断线阈值（默认 75s），超时自动清理并回收连接。
- **多账号与设备体系**：账号增删改密、每账号设备注册表（Host / Client 角色、平台、客户端版本、最近在线）、设备改名与吊销、跨账号强制下线。
- **Cloudflare Realtime TURN**：短期凭据签发（默认 300s TTL），支持「一键调用 Cloudflare API 创建 Key」「手动填入已有 Key」「wrangler secret 注入」三种配置方式；未配置时自动退化为 Relay-only，另有 STUN 地址列表可配。
- **Web 管理后台**（React 19 + TypeScript + Vite）：概览看板、全部设备、账号管理、实时连接、TURN 中转、系统设置、审计日志七个模块，明暗主题跟随系统并可手动切换。
- **运行时配置覆盖**：`wrangler.jsonc` 的 `DSH_*` 变量提供默认值，后台保存的值优先且实时生效，支持一键恢复环境变量默认值；所有数值项带上下限校验（如心跳 5000–120000 ms、单连接帧率 64–65536）。
- **审计日志**：记录登录、账号变更、设备吊销、连接断开、TURN 变更等管理操作，保留最近 200 条并支持按事件类型筛选与清空。
- **安全响应头**：统一注入 `Content-Security-Policy`、`X-Content-Type-Options`、`Referrer-Policy`、`frame-ancestors 'none'` 等，API 与静态资源一致生效。
- **一键部署脚本** `scripts/deploy.mjs`：自动安装依赖、构建前端、解析 Account ID、部署 Worker、写入 `ADMIN_TOKEN` 与 TURN secrets、创建首个管理员账号，并生成 `deploy-output.json`；支持 API Token / Global API Key / wrangler OAuth 三种认证方式，可经 `env.json` 或环境变量传参。
- **Durable Object 区域提示**：通过 `DSH_DO_LOCATION`（`apac` / `wnam` / `weur` 等）指定 DO 落地区域，改善亚太等多地访问的首连延迟。
- **GitHub Actions 发布流水线**：打 `v*` 标签或手动触发即可产出源码包与预构建部署包，并自动生成带贡献者名单的 Release。

### 修复

- **移动端布局全面修复**：
  - 顶部导航在窄屏改为横向滚动胶囊，切换页面时当前项自动滚入可视区并高亮描边，不再挤压成两行或溢出屏幕。
  - 页头在小屏竖排，标题与副标题占满整行，操作按钮整行铺满；「恢复环境变量默认值 / 保存」与筛选输入框不再被挤出屏幕。
  - 数据表在 `≤640px` 折叠为卡片列表（每格带 `data-label` 左标签右数值），设备、账号、连接、日志页不再横向挤破。
  - `.app` / `.main` / `.card` / 输入框补齐 `min-width:0`，长设备 ID、长邮箱与提示文本统一 `overflow-wrap:anywhere`，页面不再出现横向滚动条。
  - 适配安全区 `env(safe-area-inset-*)` 与 `viewport-fit=cover`，刘海屏与手势条不再遮挡内容。
  - 移动端输入框字号固定 16px，iOS 聚焦时不再自动放大页面。
  - 设备搜索框抽为 `.search-box` 组件（图标垂直居中），筛选按钮组等比分布；事件筛选输入框在手机上占满整行。

### 文档

- README 补充架构图、目录结构、三种部署方式（一键脚本 / 手动配置 / 发布包）、全部环境变量说明、TURN 与自定义域名配置、界面预览与 Release 部署指引。
- 新增本 changelog 与 `.github/workflows/release.yml` 发布说明。

<!-- 新版本请在上方插入新的 ## vX.Y.Z (YYYY-MM-DD) 小节，发布流水线只取最上面一节。 -->