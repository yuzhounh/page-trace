# PageTrace Workspace Guidelines

- 每次修改油猴脚本（`pagetrace.user.js`）时，**必须自动递增版本号（`@version`）**：
  - Bug 修复、交互细节微调、快捷键调整等日常修改，递增**补丁/小版本号**（例如 `1.9.12` -> `1.9.13`）；
  - 新增功能、架构调整或重大改动时，递增**次版本号或主版本号**（例如 `1.9.x` -> `1.10.0` 或 `2.0.0`）。
- 仅在修改或更新了油猴脚本（`pagetrace.user.js`）时，才在回复最后附带本地更新链接：
  `您可以在 http://localhost:3000/pagetrace.user.js 重新更新油猴脚本进行验证。`
  若本次交互未修改油猴脚本，严禁输出该链接。
- 回复排版遵循无横线分隔符、紧凑清晰的原则。
- **部署策略**：
  - Netlify 团队 `yuzhounh` 的下次额度重置为 **2026-10-21 15:00 Asia/Shanghai（UTC+08:00）**，月度额度 300 credits。在此时间前跳过所有 Netlify 部署调用；普通“推送并部署”请求不解除暂停。重置后仍需有部署授权。
  - 主站发布到 Cloudflare Pages（`npx wrangler pages deploy . --project-name=page-trace --branch=main --commit-dirty=true`），`git push origin main` 触发 GitHub Pages。
  - 用户已授权退役旧 Firebase 业务页。Firebase Hosting 只发布 `firebase-retired/` 和 `firebase.json` 中的跳转配置，使用 `firebase deploy --only hosting --project page-trace-app`；不得重新发布根目录的业务网页。保留 `/__/auth/*` 认证辅助路径，不在此维护中部署 Firestore 规则、删除用户或修改笔记数据。
