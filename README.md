<p align="center">
  <img src="logo.svg" width="112" alt="PageTrace logo">
</p>

<h1 align="center">PageTrace</h1>

<p align="center"><strong>网页速记与云端剪藏，多端实时同步。</strong></p>

<p align="center">
  <a href="https://page-trace.pages.dev/"><img src="https://img.shields.io/badge/Website-Cloudflare%20Pages-f38020?style=flat&amp;logo=cloudflare&amp;logoColor=white" alt="Website: Cloudflare Pages"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=flat" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/JavaScript-Browser-f7df1e?style=flat&amp;logo=javascript&amp;logoColor=white" alt="JavaScript: Browser">
</p>

<p align="center">
  <a href="https://page-trace.pages.dev/">在线体验</a> · <a href="https://github.com/yuzhounh/page-trace/releases/latest">发布版本</a> · <a href="#快速开始">快速开始</a> · <a href="LICENSE">开源协议</a>
</p>

## 项目简介

PageTrace 是一个轻量优雅的网页速记与云端捕获工具。它由**油猴扩展插件**与**云端实时速记看板**两部分组成：

- **油猴端**：在网页右下角常驻微交互磨砂玻璃胶囊，支持一键复制网页标题与网址、随时呼出 4 行速记输入卡片，通过轻量 REST API 直接同步至云端 Firestore，无需配置任何 Firebase 密钥。
- **Web 看板**：基于 Firebase 驱动的实时管理面板，支持实时同步（onSnapshot）、卡片展示、全局搜索（Spotlight 风格）、在线速记与多端协同管理。

## 快速开始

### 第一步：安装脚本

当前脚本版本为 **1.10.13**。从 [GitHub Release 安装配套脚本](https://github.com/yuzhounh/page-trace/releases/latest/download/pagetrace.user.js)，或使用 Greasy Fork 的同版入口：

🔗 **[PageTrace - Web Memo & Cloud Capture](https://greasyfork.org/en/scripts/594363-pagetrace-web-memo-cloud-capture)**

支持 Tampermonkey、Violentmonkey 或 ScriptCat 扩展。

### 第二步：登录使用

**无需配置复杂的 Firebase 认证参数或密钥。**

1. 打开任意网页，悬浮球常驻于网页右下角（鼠标悬停可查看每项操作的快捷提示）。
2. 点击卡片上的登录提示，或在油猴脚本菜单中点击 **「🔐 PageTrace 账号授权」**。
3. 在弹出的授权窗口中直接登录您的 **Google 账号**，授权完成后即刻开箱即用，所有速记笔记将自动无缝同步到您的专属个人云端空间。

### 登录桥接与更新

- 油猴脚本 `1.10.8` 起，普通网页只从油猴脚本存储读取登录状态。授权页不向打开它的网页发送 ID token 或 refresh token，只有本页脚本校验来源、窗口身份、会话随机值和固定 Firebase 项目后才接收凭据。
- 默认授权/看板入口为 `https://page-trace.pages.dev/`。可信桥接仅限该站点、`https://yuzhounh.github.io/page-trace/`、原 Firebase 站点，以及 `http://localhost:3000/` 的首页、`index.html`、`auth.html` 和 Cloudflare 规范化后的 `auth` 路径。新增部署域名时，需显式更新脚本中的 `TRUSTED_APP_BASE_URLS`，并配置 Firebase Authentication 的授权域名。
- **网页与脚本必须配套更新**：发布新的 `auth.html`、`index.html` 后更新油猴脚本。旧脚本无法完成新的会话握手，旧网页也无法向新脚本同步登录；授权窗口收到脚本已保存凭据的确认后才显示成功并关闭。
- 保留 Google 登录、普通网页云端速记、令牌自动续期、看板登录/退出同步；自动化回归使用模拟账户和网络，不会读写真实笔记。

运行桥接回归测试（Node.js 18+）：`node --test tests/auth-bridge.test.cjs`。

### 旧 Firebase 入口

- `page-trace-app.web.app` 和 `page-trace-app.firebaseapp.com` 属于同一个 Hosting 站点。旧 `/auth.html`、`/auth` 跳转到 Cloudflare 的 `/auth`，旧 `/`、`/index.html` 跳转到主站；其余已移除的业务路径返回 404。
- Firebase 只部署 `firebase-retired/` 中不含认证脚本的迁移提示页及跳转配置；`/__/auth/*` 等 Firebase 保留路径继续提供 Google 登录辅助服务。Authentication、Firestore 和现有笔记继续使用原项目。
- 维护命令：`firebase deploy --only hosting --project page-trace-app`。不要将 Hosting 的 `public` 改回根目录，以免再次发布旧业务入口。

## 备注格式

看板备注支持 Markdown：标题、加粗、斜体、列表、引用、链接、表格及代码块。
公式使用 `$x^2$`（行内）或 `$$x^2$$`（独立显示），也支持 `\(…\)` 和 `\[…\]`。
多行公式可将 `$$` 放在首尾单独一行。代码块中的公式标记保持原文，无法解析的公式显示源码。
编辑与复制保留原始 Markdown；保存不再自动插入空行或剥离正文中的链接。
历史备注按原有文本渲染，不改写云端数据。原始 HTML 作为文字显示。

渲染依赖固定版本并随站点提供，运行时不需要额外 CDN。
维护依赖后运行 `npm ci && npm run vendor`，将更新后的 `vendor/` 一同发布；运行 `npm test` 验证。
渲染实现遵循 [Marked 的净化要求](https://marked.js.org/) 和 [KaTeX 的安全选项](https://katex.org/docs/options)。

## 交互快捷键

| 操作 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **一键复制** | 鼠标左键点击悬浮球 | 快速复制当前网页标题与网址 (Title + URL) 到剪贴板 |
| **直接保存云端** | 鼠标右键点击悬浮球 | 直接保存当前网页标题与网址 (Title + URL) 至云端 |
| **打开在线看板** | Ctrl + 鼠标左键点击 | 在前台新标签页中打开云端速记看板 |
| **展开速记卡片** | Ctrl + 鼠标右键点击 | 展开速记卡片，可输入备注并保存同步至云端 |
| **隐藏/恢复悬浮球** | Ctrl + Shift + H 按键 | 隐藏/恢复浮动按钮 |
| **操作提示框** | 鼠标悬停在悬浮球上 | 浮出快捷操作提示框，每行一条简要提示 |
| **发送速记** | Shift + Enter / Ctrl + Enter | 在速记卡片中提交保存并自动同步到云端 |
| **输入换行** | Enter | 在速记输入框内换行 |
| **关闭速记卡片** | Esc | 退出当前速记弹窗 |

## 文件结构

- `pagetrace.user.js`：油猴脚本核心源码（轻量 REST 直连写入，支持 Auth Bridge 授权握手）。
- `index.html`：云端速记看板单文件 SPA 源码（支持实时同步、搜索与明暗主题）。
- `auth.html`：Google OAuth 登录与油猴脚本安全授权握手页。
- `firestore.rules`：严格按 Google 账户 UID 隔离的 Firestore 云端安全规则。

## 相关项目

- [light-note](https://github.com/yuzhounh/light-note)：以 Windows 本地笔记管理为主，支持导入、检索与可选同步。
- [Tampermonkey-scripts](https://github.com/yuzhounh/Tampermonkey-scripts)：作者维护的其他用户脚本合集。

## 开源协议

本项目采用 [MIT 许可证](LICENSE)。
