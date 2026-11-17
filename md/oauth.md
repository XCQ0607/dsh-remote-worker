# 第三方 OAuth 2.0 登录配置指南

本项目支持通过 **GitHub**、**Google** 及任意标准 OAuth 2.0 提供方登录 Web 管理后台。提供方凭据在根目录 `provider.json` 中配置，执行一键部署脚本时会自动写入 Worker 密钥 `OAUTH_PROVIDERS`。

> **适用范围**：本指南配置的是 **Web 管理后台登录**。官方插件弹窗的二维码 / 轮询登录（`/auth/oauth/qr/*`）暂未实现。

---

## 工作原理

1. 登录页加载时自动拉取已启用的提供方（`GET /api/v1/auth/oauth/providers`）并渲染「使用 xxx 登录」按钮。
2. 点击登录按钮跳转到 `/api/v1/auth/oauth/<id>/start`，生成有效期 10 分钟的防 CSRF `state`（写入 `dsh_oauth` Cookie 与 Durable Object），并重定向至第三方授权页。
3. 用户同意授权后，第三方平台携带 `code` 与 `state` 回调到：
   ```text
   https://<你的域名>/api/v1/auth/oauth/<id>/callback
   ```
4. Worker 在服务端用 `code` 换取 `access_token`，读取**已验证邮箱**（GitHub 取 `primary + verified` 邮箱，fallback 到首个 `verified` 邮箱；Google 要求 `email_verified=true`）。
5. **账号匹配与自动注册**：
   - 该邮箱已存在 → 直接登录（与已有密码账号按邮箱自动关联）。
   - 该邮箱不存在且 `allowRegister=true` → 自动创建账号（初始密码随机生成），之后可在「我的设备 → 修改登录密码」中**免填原密码**设置一次登录密码。
   - 该邮箱不存在且 `allowRegister=false` → 拒绝登录并提示 `OAUTH_REGISTER_DISABLED`。
   - 若该邮箱同时在 `ADMIN_ACCOUNTS` 列表中，登录后自动拥有管理员权限。

---

## 1. 准备 `provider.json`

在项目根目录复制模板文件（`provider.json` 已加入 `.gitignore`，不会提交到 Git）：

```bash
cp provider-template.json provider.json
```

先了解各字段含义，下文申请好 GitHub / Google 凭据后回来填入即可：

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 键名（如 `github`） | 是 | — | 提供方 ID，仅允许 `a-z0-9_-`（1–32 位），直接决定回调路径中的 `<id>` |
| `clientId` | 是 | `""` | 在第三方平台申请的 Client ID |
| `clientSecret` | 是 | `""` | 在第三方平台申请的 Client Secret（`clientId` 或 `clientSecret` 为空时该项会被忽略） |
| `enabled` | 否 | `true` | 是否在登录页显示该登录按钮 |
| `allowRegister` | 否 | `true` | 该邮箱尚未注册时，是否允许通过 OAuth 自动创建账号 |
| `displayName` | 否 | 提供方 ID | 登录按钮与后台列表中的展示名称 |
| `scopes` | 否 | 内置默认值 | 授权范围；`github` 默认 `read:user user:email`，`google` 默认 `openid email` |

> `github` 与 `google` 已内置全部授权/换票/用户信息接口地址，只需填写 `clientId` 和 `clientSecret`。如需接入其它 OAuth 平台，见第 4 节。

---

## 2. 创建 GitHub OAuth App

1. 登录 GitHub，前往 [Developer settings → OAuth Apps](https://github.com/settings/developers)（或右上角头像 → **Settings** → 左侧最底部 **Developer settings** → **OAuth Apps**）。
2. 点击 **New OAuth App**（或 **Register a new application**），按当前页面字段填写：
   - **Application name \***：填写易于识别的名称，例如 `dsh-remote`
   - **Homepage URL \***：填写你的完整站点地址，例如 `https://dsh.example.com`
   - **Application description**（可选）：应用简介
   - **Redirect URIs**：
     - 在 **Redirect URI** 输入框填入生产环境回调地址：
       ```text
       https://<你的域名>/api/v1/auth/oauth/github/callback
       ```
     - 如需同时支持本地调试，可点击右上角 **Add redirect URI**（新版 GitHub 单个 OAuth App 最多支持 **10 个**回调地址，无需再单独建测试 App），追加一行：
       ```text
       http://localhost:8787/api/v1/auth/oauth/github/callback
       ```
     - **Allow wildcard matching**：保持**不勾选**（避免子域名/路径通配带来回调劫持风险）。
   - **Enable Device Flow**：保持**不勾选**（本项目使用标准 Web 授权码流程）。
   - **Expire user access tokens**：新版默认勾选，保持勾选或取消均可（Worker 仅在登录瞬间用 token 获取一次邮箱，不会长期保存 GitHub token）。
3. 点击 **Register application** 创建应用。
4. 进入应用详情页：
   - 复制页面显示的 **Client ID**。
   - 点击 **Generate a new client secret** 生成密钥并**立即复制保存**（Client Secret 仅展示这一次，刷新后将无法再次查看）。
5. 将两者填入 `provider.json` 的 `providers.github` 中。

---

## 3. 创建 Google OAuth 2.0 客户端（新版 Google Auth Platform）

Google Cloud 控制台已将原「OAuth 同意屏幕 + 凭据」整合为 **Google Auth Platform**（左侧菜单：**概览 / 品牌塑造 / 目标对象 / 客户端 / 数据访问 / 验证中心 / 设置**）。首次配置按以下步骤操作：

### 步骤 3.1：选择项目并初始化 Google Auth Platform

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，在顶部项目选择器中新建或选择项目（例如 `dsh-remote`）。
2. 在左侧导航栏进入 **API 和服务 → Google Auth Platform**（或直接打开 [Google Auth Platform](https://console.cloud.google.com/auth/overview)）。
3. 若页面提示「**尚未配置 Google Auth Platform**」，点击 **开始（Get started）**，按引导完成 4 步初始化：
   1. **应用信息（App Information）**：
      - **应用名称（App name）**：填写展示在登录授权页的名称（例如 `DSH Remote`）。
      - **用户支持邮箱（User support email）**：选择你的管理员邮箱。
   2. **受众（Audience / 目标对象）**：
      - **内部（Internal）**：仅限同一 Google Workspace 组织内成员使用，无需审核（个人免费 Gmail 账号无法选此项）。
      - **外部（External）**：任何 Google 账号均可使用（个人账号与公开服务选此项）。
   3. **联系信息（Contact Information）**：
      - 填写接收 Google 项目通知的电子邮箱地址。
   4. **完成（Finish）**：
      - 勾选同意《Google API 服务用户数据政策》，点击 **继续（Continue）** → **创建（Create）**。

### 步骤 3.2：配置「品牌塑造」（发布公开前必设）

在左侧菜单进入 **品牌塑造（Branding）**，确认以下四部分信息（设置公开/发布前需确保网域与联系信息完整）：

1. **应用信息**：
   - **应用名称**、**用户支持邮箱**：确认无误。
   - **应用徽标**（**建议留空**）：可选上传 120×120 px 以内图片（≤1MB，JPG/PNG/BMP）。**注意：只要上传了应用徽标，发布为外部生产状态时就必须提交 Google 审核**；不上传徽标且仅使用 `openid email` 范围则**免审核**。
2. **应用网域**：
   - **应用首页**：填写你的完整站点地址（例如 `https://dsh.example.com`）。
   - **应用隐私权政策链接** / **应用服务条款链接**（可选）：有公开页面时可填写，提交正式审核时必填。
   - **已获授权的网域（Authorized domains）**：点击添加你的**根域名**（例如 `example.com`，**不要带 `https://` 和路径**）。权限请求页及客户端回调中使用的域名必须先在此处注册（如提交审核，还需在 [Google Search Console](https://search.google.com/search-console/about) 完成网域所有权验证）。
3. **开发者联系信息**：
   - **电子邮件地址**：填写接收项目变更通知的邮箱并点击 **保存（Save）**。

### 步骤 3.3：设置目标对象（测试 / 发布应用）

在左侧进入 **目标对象（Audience）** 页面：
- 应用默认处于 **测试（Testing）** 状态，此时只有手动加入 **测试用户（Test users）** 列表的邮箱才能登录（最多 100 个）。
- 若希望所有已授权（或允许注册的）Google 用户都能登录，点击 **发布应用（Publish app）** 将状态改为「生产（In production）」。只要未上传应用徽标且仅使用 `openid` 与 `email` 基础范围，**无需提交审核**即可直接生效。

### 步骤 3.4：创建 OAuth 客户端 ID

1. 在 Google Auth Platform 左侧菜单点击 **客户端（Clients）** → **创建客户端（Create client）**（或在旧版路径 **API 和服务 → 凭据 → + 创建凭据 → OAuth 客户端 ID**）。
2. 按表单填写：
   - **应用类型（Application type）**：选择 **Web 应用（Web application）**。
   - **名称（Name）**：自定义客户端名称（仅控制台内部区分用，例如 `dsh-remote-web`）。
   - **已获授权的 JavaScript 来源（Authorized JavaScript origins）**（建议填写）：
     ```text
     https://<你的域名>
     ```
   - **已获授权的重定向 URI（Authorized redirect URIs）**：
     ```text
     https://<你的域名>/api/v1/auth/oauth/google/callback
     ```
     > 可同时点击 **+ 添加 URI** 追加 `http://localhost:8787/api/v1/auth/oauth/google/callback` 用于本地调试（Worker 会按当前访问的 `origin` 动态匹配，两者互不干扰）；但**正式上线或需提交 Google 审核时，建议删掉 `localhost` 或单独建测试客户端**。
3. 点击 **创建（Create）**。

### 步骤 3.5：记录凭据

1. 在弹出的「**已创建 OAuth 客户端**」窗口中，分别复制：
   - **客户端 ID**（形如 `0123456789-xxxx.apps.googleusercontent.com`）→ 填入 `provider.json` 的 `clientId`
   - **客户端密钥**（形如 `GOCSPX-xxxxxxxxxxxx`）→ 填入 `provider.json` 的 `clientSecret`
2. 点击 **确定（OK）**。

> **注意事项**：
> - Google 对连续 **6 个月未使用**的非活跃 OAuth 客户端可能会自动清理（删除前会发邮件通知，且删除后 30 天内可恢复）。
> - 若你在完成初始化后点击「创建客户端」仍提示“必须先配置同意屏幕”，这是控制台 UI 缓存导致的已知现象，刷新页面或重新进入 **客户端（Clients）** 即可正常创建。

---

## 4. 接入其它 OAuth 2.0 提供方

只要符合标准 **OAuth 2.0 授权码模式（Authorization Code）**，且用户信息接口会返回邮箱的平台（如 GitLab、Gitea、Authentik、Authelia、Keycloak 等），都可以直接在 `provider.json` 的 `providers` 下新增一项并写全接口地址：

```json
{
  "providers": {
    "github": {
      "enabled": true,
      "allowRegister": true,
      "displayName": "GitHub",
      "clientId": "你的_GitHub_Client_ID",
      "clientSecret": "你的_GitHub_Client_Secret"
    },
    "google": {
      "enabled": true,
      "allowRegister": true,
      "displayName": "Google",
      "clientId": "你的_Google_Client_ID",
      "clientSecret": "你的_Google_Client_Secret"
    },
    "gitlab": {
      "enabled": true,
      "allowRegister": true,
      "displayName": "GitLab",
      "clientId": "你的_GitLab_Application_ID",
      "clientSecret": "你的_GitLab_Secret",
      "scopes": "read_user openid email",
      "authUrl": "https://gitlab.com/oauth/authorize",
      "tokenUrl": "https://gitlab.com/oauth/token",
      "userInfoUrl": "https://gitlab.com/api/v4/user",
      "emailField": "email"
    }
  }
}
```

扩展字段说明：

- `authUrl` / `tokenUrl` / `userInfoUrl`：标准 OAuth 2.0 授权端点、换取 token 端点与用户信息端点（必填）。
- `emailField`：用户信息 JSON 中的邮箱字段名，默认 `email`。
- `verifiedField`（可选）：邮箱是否已验证的布尔字段名（如 `email_verified`）；配置后若平台返回的该字段不为 `true` / `'true'`，将拒绝登录。
- 回调地址规则固定为：`https://<你的域名>/api/v1/auth/oauth/<提供方键名>/callback`。
- 不返回邮箱或需非标准签名流程的平台（如微信、QQ 等）无法直接接入。

> **安全提示**：自定义提供方务必仅接入**会验证邮箱归属**或已配置 `verifiedField` 校验的平台，防止他人用未验证邮箱注册并接管同邮箱账号。

---

## 5. 部署与本地调试

### 一键部署（推荐）

填写好根目录 `provider.json` 后运行：

```bash
node scripts/deploy.mjs
```

脚本会自动读取 `provider.json` 并写入 Worker Secret `OAUTH_PROVIDERS`。

### 手动写入 Secret

如果不想重新跑完整部署脚本，也可直接将 `provider.json` 全部内容写入 Worker Secret：

```bash
cd worker
npx wrangler secret put OAUTH_PROVIDERS --name dsh-remote
# 按提示粘贴 provider.json 的完整 JSON 内容
```

### 本地调试（`wrangler dev`）

在 `worker/.dev.vars` 中添加一行单行 JSON：

```ini
OAUTH_PROVIDERS={"providers":{"github":{"clientId":"...","clientSecret":"..."}}}
```

> 修改 `clientId`、`clientSecret` 或新增/删除提供方后，需要重新部署或更新 `OAUTH_PROVIDERS` Secret 才会生效；仅切换「启用登录」或「允许注册」可在管理后台实时完成，无需重部署。

---

## 6. 管理后台开关

管理员登录后台后，进入左侧 **OAuth 登录** 页面可以：

- 查看所有在 `provider.json` 中已配置的提供方及对应**回调地址**（可直接核对或复制填入第三方平台）。
- 实时开关每个提供方的 **启用登录** 与 **允许注册新用户**（保存在 Durable Object 中，优先级**高于** `provider.json` 中的 `enabled` / `allowRegister`）。
- 相关操作与 OAuth 注册/登录均会记入 **审计日志**（`oauth.update`、`oauth.register`、`login`）。

---

## 7. 常见问题排查

| 现象 / 错误码 | 原因与解决方法 |
| --- | --- |
| 第三方页面报错 `redirect_uri_mismatch` | 平台填写的回调地址与 `https://<你的域名>/api/v1/auth/oauth/<id>/callback` 不完全一致（检查协议 `http`/`https`、域名、末尾是否多余 `/`） |
| Google 提示「已屏蔽访问 / 403 `access_denied`」 | Google Auth Platform 的「目标对象」处于**测试**状态且当前邮箱不在「测试用户」列表中；加入测试用户或在「目标对象」页点击**发布应用** |
| 登录页没有 OAuth 登录按钮 | `provider.json` 中 `clientId`/`clientSecret` 任一为空、`enabled=false`、或在后台「OAuth 登录」关闭了开关、或修改后未更新 `OAUTH_PROVIDERS` Secret |
| `OAUTH_STATE_INVALID` | 授权停留超过 10 分钟、浏览器禁用了 Cookie、或通过 HTTP 与 HTTPS 混用访问导致 `dsh_oauth` Cookie 未携带 |
| `OAUTH_TOKEN_FAILED` | `clientId` / `clientSecret` 填错、回调 URI 不匹配、或自定义提供方的 `tokenUrl` 未返回 JSON 格式 `access_token` |
| `OAUTH_EMAIL_UNVERIFIED` | 第三方账号没有已验证的邮箱（例如 GitHub 账号未验证主邮箱，或自定义提供方配置了 `verifiedField` 但返回非 `true`） |
| `OAUTH_REGISTER_DISABLED` | 该邮箱尚未在系统内创建账号，且当前提供方的 `allowRegister` 为关闭状态（可在后台「OAuth 登录」开启，或由管理员在「账号管理」预先创建该邮箱） |
| `OAUTH_FAILED` | 换取 token 或拉取用户信息过程中发生网络异常或非预期响应 |
