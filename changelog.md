# Changelog

本文件记录 dsh-remote-worker 的所有版本变更。发布流程会读取**最新一个 `## v…` 小节**作为 Release 说明。

格式约定：版本标题固定为 `## v<版本号> (<YYYY-MM-DD>)`，下一行起用 `###` 分类（新增 / 修复 / 优化 / 文档），条目用 `- ` 列表。

## v1.0.1 (2026-11-18)

P2P / STUN 连接控制与卡片化后台管理重构：新增「打开 P2P」与「打开 STUN」双默认开启开关，内置完整 18 条公共 STUN 列表，并将 STUN 与 Origin 白名单管理全部升级为可添加、删除、单条禁用的卡片界面。

### 新增

- **「打开 P2P」与「打开 STUN」默认双开开关**：
  - `p2pEnabled`（环境变量 `DSH_P2P_ENABLED`，默认 `true`）：控制是否在 `hello.ack` 能力协商中开放 `transport.p2p`。
  - `stunEnabled`（环境变量 `DSH_STUN_ENABLED`，默认 `true`）：控制是否下发用于 P2P NAT 打洞的 STUN 服务器；关闭后连同 TURN 凭据附带的 STUN 一并剔除。
- **完整公共 STUN 列表（`worker/src/stun.ts` 的 `PUBLIC_STUN`，共 18 条）**：
  - 覆盖国内（小米、哔哩哔哩、芒果 TV、斗鱼、腾讯）、Cloudflare（443 / 3478）与国际常用公共节点（Google 0–4、Twilio、BlackBerry、Nextcloud、Syncthing、Sipgate、StunProtocol），默认全部收录并可按需单独启用或禁用。
- **卡片化服务器与 Origin 管理界面（`web/src/pages.tsx`）**：
  - 移除原有繁琐的多行文本输入框，改为直观的卡片网格：每条 STUN 服务器和每条 Origin 规则均为独立卡片，支持单条**启用 / 禁用**切换、**删除**、行内**添加**。
  - STUN 卡片区额外提供全部/已启用/已禁用筛选、全部启用/全部禁用、一键恢复默认列表，并明确标注「用于 P2P 打洞（不中转流量）」。
- **前端版本号自动联动**：`web/vite.config.ts` 从 `web/package.json` 自动注入 `__APP_VERSION__`，页面底部版权栏始终与当前版本一致。

### 修复

- **自定义 STUN 在 TURN 可用时被忽略 / 关闭 TURN 误丢 STUN**：`fetchIceServers` 按已启用的 STUN 列表合并并保留在最前，TURN 仅控制中继凭据签发，互不干扰。
- **TURN 响应附带未启用 STUN**：`stripStun` 与 `stripStunFromMixed` 确保只在当前已启用列表中的 STUN 才会被保留；缓存键纳入 STUN 解析结果，保存设置后立即生效。
- **Origin 输入框受 STUN 开关误禁用的问题**：改为独立卡片区管理，不再受 `stunEnabled` 状态连带禁用。
- **旧版 DO 存储兼容迁移**：`settings.ts` 的 `sanitize()` 自动将旧版 `stunUrls` / `stunUsePublicList` / `stunUseCloudflare` / `allowedOrigins` 平滑迁移为新版 `stunServers` 与 `originRules` 结构。

### 文档

- 重写本 `v1.0.1` 变更说明，更新 `README.md` 的「P2P、STUN 与 ICE 配置」、环境变量表及 Release 解压示例版本号。

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