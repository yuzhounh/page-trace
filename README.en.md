<p align="center">
  <img src="logo.svg" width="112" alt="PageTrace logo">
</p>

<h1 align="center">PageTrace</h1>

<p align="center"><a href="README.md">简体中文</a> · English</p>

<p align="center"><strong>Quick web notes and cloud capture, with real-time sync across devices.</strong></p>

<p align="center">
  <a href="https://page-trace.pages.dev/">Live website</a> · <a href="https://github.com/yuzhounh/page-trace/releases/latest">Releases</a> · <a href="#getting-started">Getting started</a> · <a href="LICENSE">MIT license</a>
</p>

## Overview

PageTrace combines a lightweight userscript with a cloud note board.

- **Userscript:** a floating capsule at the bottom-right of web pages copies a page title and URL, opens a four-line note card, or saves directly to Firestore through a lightweight REST API. No Firebase keys need to be configured by the user.
- **Web board:** loads and syncs notes by month, reusing cached months when switching views. Entering a search term loads historical notes for global title, URL and body search. Unloaded months are marked explicitly, and trash queries deleted notes across all months separately.

## Getting started

### 1. Install the userscript

The latest published web, userscript and Android version is **1.16.3** (Android code24). On phones, memo previews and source domains share a line when space permits; longer memos use up to two lines with truncation. Year/month totals preload after sign-in, cached totals appear first, opening the menu does not query year ranges, and background refresh preserves known counts. Help adapts to desktop, phone, tablet and Android; desktop help uses a compact centered dialog. That release retained gray memo previews, hidden source footers, existing cloud notes, search and trash.

The web package is `dist/web-1.16.3` and the APK is `dist/PageTrace-1.16.3-code24.apk`. See [GitHub Release v1.16.3](https://github.com/yuzhounh/page-trace/releases/tag/v1.16.3). The daily userscript updates through the [GitHub script entry](https://raw.githubusercontent.com/yuzhounh/page-trace/main/pagetrace.user.js).

After the initial snapshot, a record Map is updated using `docChanges`. Unchanged status snapshots do not repeatedly parse, sort or serialize all note bodies. Reconnecting rebuilds a complete server view. Content, server versions, cache completeness and deletion acknowledgments are tracked separately. Cache writes and rendering for actual changes are batched within 60 ms; the first screen renders immediately, and pending cache writes flush before changing accounts or scopes or leaving the page. Background pages keep saving data while deferring list rendering, then show the latest state on return. A hidden userscript releases its two-second fallback timer and checks again when visible. Cache keys, the v3 format and `users/{uid}/notes` remain unchanged, with no new data migration. Multi-select and deferred actions stay bound to the original account.

Deterministic fixtures cover 20 unchanged snapshots over 1,000 records with zero body reads, cache writes or redraws; a single update reads only its changed document. They also cover batching, background recovery, SDK pending local writes, server versions and trash restoration. These checks do not measure actual phone battery use or live network latency. See the [Firestore QuerySnapshot documentation](https://firebase.google.com/docs/reference/js/firestore.querysnapshot#querysnapshotdocchanges). `npm run build` creates an allowlisted web package, and `npm test` uses at most two test processes. Downloads and copies use normal tool completion without additional transfer integrity comparisons.

Install [PageTrace — Web Memo & Cloud Capture](https://greasyfork.org/en/scripts/594363-pagetrace-web-memo-cloud-capture) with Tampermonkey, Violentmonkey or ScriptCat.

### 2. Sign in

No Firebase authentication parameters or keys need to be configured.

1. Open a web page. The floating capsule appears at the bottom-right; hover it for action tips.
2. Click the sign-in prompt in the card, or choose **「🔐 PageTrace 账号授权」** in the userscript menu.
3. Sign in to your Google account in the authorization window. Notes then sync to your personal cloud space.

### Authentication bridge and updates

- Since userscript `1.10.8`, ordinary web pages obtain sign-in state only from userscript storage. The authorization page does not send ID or refresh tokens to the page that opened it. Credentials are accepted only after the userscript on that page validates the origin, window identity, session nonce and fixed Firebase project.
- The default authorization and board URL is `https://page-trace.pages.dev/`. Trusted bridge URLs are restricted to that site, `https://yuzhounh.github.io/page-trace/`, the original Firebase site, and the home, `index.html`, `auth.html` and normalized `auth` paths at `http://localhost:3000/`. A new deployment domain requires an explicit `TRUSTED_APP_BASE_URLS` update and Firebase Authentication authorized-domain configuration.
- **Update the website and userscript together.** Publish `auth.html` and `index.html`, then update the userscript. Older scripts cannot complete the new handshake, and older pages cannot sync sign-in to newer scripts. The authorization window shows success and closes only after the userscript acknowledges that credentials were saved.
- Google sign-in, cloud capture from ordinary pages, token renewal and board sign-in/sign-out sync remain supported. Authentication regression tests use simulated accounts and networks, without reading or writing real notes.

Run bridge regression tests with Node.js 18+: `node --test tests/auth-bridge.test.cjs`.

### Retired Firebase entry points

- `page-trace-app.web.app` and `page-trace-app.firebaseapp.com` share one Hosting site. The former `/auth.html` and `/auth` redirect to Cloudflare `/auth`; `/` and `/index.html` redirect to the main site. Other removed business routes return 404.
- Firebase Hosting serves only the migration notice in `firebase-retired/` and the redirect configuration. Reserved Firebase paths such as `/__/auth/*` still support Google sign-in. Authentication, Firestore and existing notes stay in the original project.
- Maintenance command: `firebase deploy --only hosting --project page-trace-app`. Keep Hosting's `public` set to `firebase-retired/` to preserve the retired entry points.

## Interface language and local preview

The current source supports Simplified Chinese and English, with the choice saved in the current browser. On desktop, click the avatar and use the language button in its right-aligned card, or press `L` outside input fields. On phones and tablets, use the language action in the menu. Dates, counts, tooltips, loading states, trash and help follow the selected language, including text generated later. Note titles, bodies, URLs, account names and input values remain unchanged; copying preserves the original Markdown.

Collapsed memo previews stay gray; expanded memos use the theme's body text color, including in dark mode. The more-actions menu no longer shows a character count. These changes describe the current source and do not imply that public releases or installed APKs have been updated.

After installing dependencies, run from the project root:

```sh
npm run build
node scripts/serve-web.cjs
```

Open [local PageTrace](http://localhost:3000/). The server reads `dist/web-<VERSION>`; rebuild after source changes, then refresh the page.

## Memo formatting

Memos support Markdown headings, bold, italics, lists, quotations, links, tables and code blocks. Use `$x^2$` for inline math or `$$x^2$$` for display math; `\(…\)` and `\[…\]` are also supported. For multiline formulas, put the opening and closing `$$` on separate lines. Formula delimiters in code blocks remain literal, and formulas that cannot be parsed display their source.

Editing and copying preserve original Markdown. Saving normalizes blank paragraph lines and removes standalone separator lines while keeping body links. Historical tables with blank lines between rows are rendered as tables. Existing memos render without rewriting cloud data, and raw HTML is displayed as text.

Rendering dependencies are pinned and bundled with the site, without extra runtime CDNs. After maintaining dependencies, run `npm ci && npm run vendor`, publish the updated `vendor/` directory, and validate with `npm test`. Rendering follows [Marked's sanitization guidance](https://marked.js.org/) and [KaTeX security options](https://katex.org/docs/options).

## Shortcuts

- Left-click the floating capsule: copy the page title and URL.
- Right-click the capsule: save the title and URL directly to the cloud.
- Ctrl + left-click: open the board in a foreground tab.
- Ctrl + right-click: open the memo card to write and save a note.
- Ctrl + Shift + H: hide or restore the floating capsule.
- Hover the capsule: show action tips.
- Shift + Enter / Ctrl + Enter in the memo card: save and sync.
- Enter in the memo input: insert a new line.
- Esc: close the memo card.
- On the board, outside input fields: `/` searches, `N` creates a note, `T` opens trash, `D` toggles the theme, `L` switches language, and `?` opens help.

## Files

- `pagetrace.user.js`: userscript with lightweight REST writes and the secure Auth Bridge handshake.
- `index.html`: cloud note board SPA with live sync, search and themes.
- `i18n.js`: Chinese/English UI translations, dynamic updates and user-content exclusions.
- `auth.html`: Google OAuth sign-in and secure userscript authorization page.
- `firestore.rules`: Firestore security rules isolating data by Google account UID.

## Design documentation

- [Browsing, caching and sync design](docs/design-and-sync.md) (Chinese): monthly browsing, shared cache, global search, trash and sync feedback. Original proposals and release evidence remain in historical records.

## Related projects

- [light-note](https://github.com/yuzhounh/light-note): Windows local notes with import, search and optional sync.
- [Tampermonkey-scripts](https://github.com/yuzhounh/Tampermonkey-scripts): other userscripts maintained by the author.

## License

PageTrace is licensed under the [MIT license](LICENSE).
