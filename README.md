<p align="center">
  <img src="logo.svg" width="104" alt="PageTrace Logo" />
</p>

<h1 align="center">PageTrace</h1>

<p align="center">网页速记与云端剪藏，多端实时同步。</p>

<p align="center">
  <a href="https://page-trace-app.web.app/">在线访问</a>
</p>

## 项目简介

PageTrace 是一个轻量优雅的网页速记与云端捕获工具。它由**油猴扩展插件**与**云端实时速记看板**两部分组成：

- **油猴端**：在网页右下角常驻微交互磨砂玻璃胶囊，支持一键复制网页标题与网址、随时呼出 4 行速记输入卡片，通过轻量 REST API 直接同步至云端 Firestore，无需配置任何 Firebase 密钥。
- **Web 看板**：基于 Firebase 驱动的实时管理面板，支持实时同步（onSnapshot）、卡片展示、全局搜索（Spotlight 风格）、在线速记与多端协同管理。

## 快速使用指南

### 第一步：安装脚本

在 Greasy Fork 安装已发布的油猴插件：

🔗 **[PageTrace - Web Memo & Cloud Capture](https://greasyfork.org/en/scripts/594363-pagetrace-web-memo-cloud-capture)**

支持 Tampermonkey、Violentmonkey 或 ScriptCat 扩展。

### 第二步：登录使用

**无需配置复杂的 Firebase 认证参数或密钥。**

1. 打开任意网页，悬浮球常驻于网页右下角（鼠标悬停可查看每项操作的快捷提示）。
2. 点击卡片上的登录提示，或在油猴脚本菜单中点击 **「🔐 PageTrace 账号授权」**。
3. 在弹出的授权窗口中直接登录您的 **Google 账号**，授权完成后即刻开箱即用，所有速记笔记将自动无缝同步到您的专属个人云端空间。

## 交互快捷键

| 操作 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **一键复制** | 鼠标左键点击悬浮球 | 快速复制当前网页标题与网址 (Title + URL) 到剪贴板 |
| **直接保存云端** | 鼠标右键点击悬浮球 | 直接保存当前网页标题与网址 (Title + URL) 至云端 |
| **打开在线看板** | Ctrl + 鼠标左键点击 | 在前台新标签页中打开云端速记看板 |
| **展开速记卡片** | Ctrl + 鼠标右键点击 | 展开速记卡片，可输入备注并保存同步至云端 |
| **隐藏/恢复悬浮球** | Shift + H 按键 | 隐藏/恢复浮动按钮 |
| **操作提示框** | 鼠标悬停在悬浮球上 | 浮出快捷操作提示框，每行一条简要提示 |
| **发送速记** | Shift + Enter / Ctrl + Enter | 在速记卡片中提交保存并自动同步到云端 |
| **输入换行** | Enter | 在速记输入框内换行 |
| **关闭速记卡片** | Esc | 退出当前速记弹窗 |

## 文件结构

- `pagetrace.user.js`：油猴脚本核心源码（轻量 REST 直连写入，支持 Auth Bridge 授权握手）。
- `index.html`：云端速记看板单文件 SPA 源码（支持实时同步、搜索与明暗主题）。
- `auth.html`：Google OAuth 登录与油猴脚本安全授权握手页。
- `firestore.rules`：严格按 Google 账户 UID 隔离的 Firestore 云端安全规则。
