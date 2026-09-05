# PageTrace - Web Memo & Cloud Capture

基于「Copy Title & URL」油猴脚本扩展的云端速记与多端实时同步解决方案。

## 核心设计特性

1. **极致轻量的油猴端（REST Direct Write）**：
   - 采用 `GM_xmlhttpRequest` 直连 Firestore REST API，无需将庞大的 Firebase SDK 打包进所有网页。
   - 保持原脚本毫秒级加载与轻量纯净体验。

2. **微交互速记卡片（Shadow DOM）**：
   - 保留原有右下角优雅磨砂玻璃胶囊。
   - **左键点击**：快速复制当前网页 Title & URL 到剪贴板。
   - **右键点击**：展开 4 行速记输入框（显示当前页面 Title 预览 + 向上箭头保存按钮）。
   - **Ctrl + 左键**：直接将当前 Title & URL 保存至云端 Firestore。
   - **Ctrl + 右键**：在前台新标签页中打开云端速记看板。
   - **Shift + 左键**：隐藏浮动按钮。
   - **Shift + Enter**：保存速记到云端；**Enter**：换行；**Esc**：收起弹窗。

3. **优雅的 Google 认证桥接（Auth Bridge）**：
   - 解决用户在任意第三方域名（Github, 知乎等）无法直接执行 Firebase Google OAuth 的问题。
   - 提供专属认证页 `auth.html`（可托管在 Firebase Hosting），通过 `window.postMessage` 与油猴脚本进行授权握手。
   - 内置 Google SecureToken REST API 刷新机制，支持长时间免重复登录。

4. **单 Document 数据模型（适合实时多端同步）**：
   - 数据写入路径：`users/{uid}/notes/{noteId}`。
   - 配合 `ai-resource-hub` 或 Web 管理端使用 `onSnapshot()`，一台设备保存，另一台设备即刻呈现。

---

## 文件结构

- [pagetrace.user.js](file:///d:/Archives/20260904%20Web%20memo/pagetrace.user.js)：油猴脚本核心源码。
- [auth.html](file:///d:/Archives/20260904%20Web%20memo/auth.html)：Google 登录与 Auth Bridge 握手页。
- [firestore.rules](file:///d:/Archives/20260904%20Web%20memo/firestore.rules)：严格按 UID 隔离的 Firestore 安全规则。

---

## 快速使用指南

### 第一步：安装脚本
将 `pagetrace.user.js` 代码复制并安装到 Tampermonkey / Violentmonkey。

### 第二步：配置 Firebase 认证
1. 在油猴浮动按钮上按住 `Alt` 并点击，或在油猴扩展菜单中选择 `⚙️ PageTrace 认证与配置`。
2. 填入你的 Firebase `Project ID` 与 `Web API Key`。
3. 若部署了 `auth.html` 到你的 Firebase Hosting，直接点击「🚀 打开 Auth 登录页完成认证」，完成 Google 账号一键授权绑定。
