# 部署步驟

## 第一次

1. **GitHub 儲存庫**：`bailixiao/fentan-calendar`（公開，GitHub Pages 免費方案只能用公開的）。
   開 GitHub Pages：Settings → Pages → Branch 選 `main`、資料夾 `/ (root)`。
   網址：`https://bailixiao.github.io/fentan-calendar/`
2. **Cloudflare Worker**：
   ```
   cd worker
   npx wrangler deploy
   ```
   網址：`https://fentan-calendar-api.duty-calendar-worker.workers.dev/`，要和 `js/config.js`、`index.html` 的 preconnect 一致。
   注意：教全區的 API 和分壇在同一個 Cloudflare 帳號，同帳號的 Worker 預設不能直接互連，`wrangler.toml` 的 `compatibility_flags = ["global_fetch_strictly_public"]` 不能拿掉（拿掉會讀不到教全區）。
3. **管理密碼**（由管理者自己輸入，不要貼給別人或寫進程式碼）：
   ```
   cd worker
   npx wrangler secret put ADMIN_PASSWORD
   ```
4. 打開網站確認：行事曆有教全區的活動、後台能登入、新增一筆測試活動後刪掉。

## 之後更新

- 前端（html、js、css）：改完把 `index.html` 的 `?v=` 日期換新，commit、push，GitHub Pages 約 1～10 分鐘生效。
- 後端（`worker/`）：`cd worker && npx wrangler deploy`。
- 上線前 `node --test` 全部通過。

## 用量

- 免費方案每天約 10 萬次請求（Worker、Durable Object 各自計算），正式上線前到 Cloudflare 官方定價頁再確認。
- 看用量：Cloudflare 後台 → Workers → `fentan-calendar-api` → 指標。
