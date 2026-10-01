# PageTrace Workspace Guidelines

- 每次修改油猴脚本（`pagetrace.user.js`）时，**必须自动递增版本号（`@version`）**：
  - Bug 修复、交互细节微调、快捷键调整等日常修改，递增**补丁/小版本号**（例如 `1.9.12` -> `1.9.13`）；
  - 新增功能、架构调整或重大改动时，递增**次版本号或主版本号**（例如 `1.9.x` -> `1.10.0` 或 `2.0.0`）。
- 仅在修改或更新了油猴脚本（`pagetrace.user.js`）时，才在回复最后附带本地更新链接：
  `您可以在 http://localhost:3000/pagetrace.user.js 重新更新油猴脚本进行验证。`
  若本次交互未修改油猴脚本，严禁输出该链接。
- 回复排版遵循无横线分隔符、紧凑清晰的原则。
- **部署策略（暂停 Netlify，仅部署 Cloudflare Pages）**：
  - 由于 Netlify 账户免费配额用尽（Account credit usage exceeded），在 1 个月内（至 2026 年 11 月）暂停向 Netlify 部署。
  - 本项目后续触发部署时，**仅部署 Cloudflare Pages**（通过 `npx wrangler pages deploy . --project-name=page-trace --branch=main --commit-dirty=true`，并通过 `git push origin main` 触发原生 GitHub Pages）。严禁向 Netlify、Vercel 或 Firebase 发起部署。

