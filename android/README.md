# PageTrace Android 1.10.14

安装包：`../dist/PageTrace-1.10.14.apk`。最低 Android 8.0；Google 登录需要可用的 Google Play 服务和网络。沿用 1.0.0 的签名，可直接覆盖安装，无需卸载。

1.10.14 修复手机上点年份、月份没有下拉菜单（工具栏横向滚动裁掉了菜单）；年份、月份菜单统一左对齐到各自按钮，超出屏幕时自动左移；APK 工具栏按钮加高到 36px、间距拉开并保证“复制”不出屏幕；APK 页面文字整体缩小约 10%。

1.10.13 展开/收起按钮靠右；底部小提示统一版式（只有“已移至回收站”带撤销和关闭，其余为图标加文字，错误用 ⚠️），原来的系统 alert 弹窗也改为同样的小提示。

1.10.12 与网页版、油猴脚本统一版本号。长按菜单去掉“选择文字”（与编辑重复），弹出菜单、编辑窗口和笔记详情的字号调小。新建/编辑速记的输入框占位文字改为两行，Markdown 提示不再单独占一行。

1.0.4 手机交互改版（仅 APK 生效，网页端不变）：隐藏备注的“⋯”按钮，长按备注弹出圆角操作面板（编辑、选择文字、复制、分享、删除、笔记详情），弹出时轻震；返回键按层级依次关闭面板、编辑/新建/回收站/文档弹窗、侧边栏与下拉菜单，最后才退出；彻底删除与替换草稿的确认改为应用内圆角面板；触控目标放大到 44px，移除触屏上会“粘住”的悬停样式和快捷键提示；状态栏与导航栏图标随深浅色主题切换。同时修复 APK 缺少 Markdown/公式渲染文件的问题。

1.0.3 按参考图替换账户区：去掉账户状态标签与卡片边框，使用头像、姓名、邮箱及圆形退出图标。头像采用 Google 账号照片，缺失或加载失败时显示姓名首字母；姓名与邮箱使用 textContent 安全填充。320px、393px 窄屏和头像失败回退已检查，APK 编译、Lint 与签名校验通过。

1.0.2 调整侧边栏账户区：标签单独一行，下方用户名与退出按钮并排；用户名弹性占位并省略长文本，退出不换行、不压缩，点击高度至少 40px。已用模拟登录用户名检查 320px 和 393px 视口的布局及截图，无重叠、溢出。APK 编译、Lint 和签名校验通过；本次 CSS 调整未改变登录与同步逻辑。

1.0.1 修复状态栏重叠：将 WebView 放入原生 FrameLayout，按系统栏、屏幕挖孔和键盘的实际 Insets 调整容器边距，让网页及固定定位侧边栏一起避让。已处理的 Insets 归零后再传入 WebView，避免重复留白；浅色系统栏背景搭配深色图标。

## 使用

1. 安装 APK，打开 PageTrace，使用与网页端相同的 Google 账号登录。
2. 在浏览器或其他应用选择“分享”，选择 PageTrace。
3. 自动弹出当前速记界面，带入标题和链接；可编辑标题、链接和备注。
4. 点击蓝色向上箭头保存。云端确认成功后显示提示，在网页端同一账号的收件箱查看。

未保存的草稿会保存在应用本地，重启可恢复。离线时保留草稿并提示联网后再保存；不把本地草稿显示为已同步。已有草稿时接收新分享，需要确认是否替换。首次分享时未登录，点击保存会先发起登录，完成后再点击保存。

## 架构与账号

- 原生 Activity 接收 Android `ACTION_SEND` 的 `text/plain`、`text/html` 文本；冷启动及已运行时均支持。
- APK 内置当前 `index.html`、`android-bridge.js` 与 Firebase 10.12.0 SDK，通过 AndroidX WebViewAssetLoader 加载。构建时生成 assets，不维护第二份网页源码。
- Android Credential Manager 获取 Google ID token，交给原有 Firebase `signInWithCredential`，继续写入 `users/{uid}/notes`，保留 inbox、标题、链接、备注及服务器时间格式。
- Firebase 项目仍是 `page-trace-app`，Android 包名 `com.pagetrace.app`；已注册发布签名 SHA-1。未修改数据库规则或迁移笔记。
- 原生消息仅允许本地 assets origin 的主框架；外部 HTTP(S) 链接交给浏览器，外部页面不能调用原生登录。

## 构建

需要 JDK 17 或 21、Android SDK 35。`local.properties` 设置本机 SDK 路径，例如 `sdk.dir=C\:/Users/your-name/AppData/Local/Android/Sdk`。

发布签名使用本机 `pagetrace-release.jks` 和 `signing.properties`（已忽略，不可提交）。请私下妥善保存这两个文件；后续覆盖升级需要沿用此签名。`google-services.json` 是公开客户端配置，不含服务端私钥。

```powershell
cd android
.\gradlew.bat --no-daemon assembleRelease lintRelease
```

输出：`app/build/outputs/apk/release/app-release.apk`。如果 Windows JDK 报 UnixDomainSockets / loopback 错误，为 `JAVA_TOOL_OPTIONS` 设置 `-Djdk.net.unixdomain.tmpdir="短路径临时目录"`。本机成功构建使用工作区 `tmp/pt`。

随包 SDK 文件在 `app/src/main/vendor/`，来自 Google 官方 `https://www.gstatic.com/firebasejs/10.12.0/`，保留原始授权声明。`bundleDashboard` 仅在 APK 构建副本中替换脚本路径。

## 验证记录（2026-10-07）

- `assembleRelease lintRelease` 成功：0 errors，9 warnings（依赖新版本提示、兼容 API 与 WebView 检查等）。
- `node --test tests/*.test.cjs`：22/22 通过，覆盖分享解析、草稿恢复、Google 凭据交接、现有 notes 路径写入、重复点击、失败保留、离线与账号切换。
- Android 15 模拟器安装签名发布包成功，分享链接后显示速记弹窗，标题/链接正确带入；强制退出再启动后恢复草稿；未登录保存可启动 Google 登录流程。
- `apksigner verify --print-certs` 通过。发布证书 SHA-1：`73:76:8B:3A:72:34:30:D7:43:CE:39:28:D9:AD:FB:36:AE:B1:5F:75`。
- 未使用真实 Google 账号进行端到端云端写入；需用户在手机上完成登录并保存一条笔记，确认网页端出现。测试没有写入真实笔记。
- 本次未推送 GitHub 或部署网站；APK 内置网页更新，无需先部署网页。

### 1.0.1 状态栏修复验证

`assembleRelease lintRelease` 成功，签名校验通过。Android 15 模拟器实测 WebView 顶部位于 y=136（状态栏以下），底部位于 y=2337（导航栏以上）；打开侧边栏后标题及关闭按钮仍在安全区域内，截图验证无状态栏重叠。测试模拟器已关闭。此次仅修改原生容器和 Android 版本/依赖，复用此前已通过的网页业务测试。
