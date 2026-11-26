# 分壇教育組報名：做過學到的事（knowhow）

> 2026-11-26 專案取消時整理。下次做類似的報名系統（GitHub Pages ＋ Cloudflare Worker）可以直接參考。
> 本儲存庫是公開的，這份文件不放任何人名、電話。

## 1. 架構：這樣搭就夠用

- **前端**：GitHub Pages，純 JS（不用框架）。一個 `index.html`，`#/...` 當路由（`#/u` 區的報名、`#/c` 班、`#/s` 一堂、`#/help`、`#/admin`）。
- **後端**：Cloudflare Worker ＋ **Durable Object（SQLite）**。所有寫入都在同一個 DO 依序處理，不會兩個人同時改壞資料。
- **資料表**：一張 `docs` 表（`kind` = course／session／signup，一筆一列 JSON）就夠，要加欄位不用改表。
- **讀取快取**：主畫面讀的 `getBoard` 在前面那層 Worker 快取 15 秒，人多也不會一直打 DO；報名名單那頁（`getSession`）不快取，報完馬上看得到。
- **免費方案的 cron 只有 5 個**（同一個 Cloudflare 帳號共用，已經用完）→ 每天的提醒改用 **DO alarm**：每次跑完自己排下一次（早上 7 點今天、晚上 8 點明天）。

## 2. 手機「沒更新」：最常見的抱怨

管理者好幾次說「還是沒更新」，原因都是快取：
- GitHub Pages 會讓瀏覽器快取 10 分鐘。
- **每次改 js、css 都把 `index.html` 裡的 `?v=` 換新**（例：`20261015g`）。
- Service Worker 讀頁面要**網路優先**，而且要 `fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })`。只寫 `fetch(req)` 還是會拿到瀏覽器快取的舊 `index.html`。
- 同一個網域（bailixiao.github.io）有好幾個網站：SW 的快取名稱要帶網站路徑（`PREFIX + 'v3'`），清快取時只清自己的。
- 請使用者測之前，自己先用無痕視窗或 `curl` 確認線上已經是新版。

## 3. 不用帳號也能「自己取消」

- 手機第一次報名時產生一個隨機碼，存在 localStorage（`fentan-calendar:device`）。
- 伺服器只存它的 sha256。取消時送隨機碼，伺服器比對雜湊。
- 缺點要寫進常見問題：換手機或清掉資料就不能自己取消，要找組長。

## 4. 帳號與權限

- 總管理者密碼放 Worker secret（`ADMIN_PASSWORD`），使用者自己用 `npx.cmd wrangler secret put ADMIN_PASSWORD` 設定，Claude 不經手。
- 其他帳號（點名、16 區組長）的密碼由總管理者在後台設定，存 **PBKDF2** 雜湊。
- 權限集中在一張表（`store-app.js` 的 `PERM`），每個 `admin*` action 由伺服器檢查，不靠前端藏按鈕。
- 輸錯 10 次暫停 15 分鐘；登入 12 小時有效；改密碼後已經登入的全部登出。
- 「大家共用一組」的點名帳號，比每個幹部一個帳號好推行。

## 5. 排課（一次排一整年）

- 管理者真正要的是：**每個月第 N 個星期幾**，再加上**日期不固定、在月曆上一次點好幾天**。「兩個禮拜一次」最後被拿掉。
- 坑：一開始「每個月第二個禮拜天」用開始日期去推星期幾，開始日剛好是禮拜六就排錯。→ **第幾個、星期幾要讓管理者直接選**，不要用推的。
- 欄位下面直接寫出「規則、共幾堂、前幾個日期」，管理者按儲存前就能確認。
- 一個班的堂數上限一開始設 60 太少，改成 200。

## 6. 給不懂電腦的家人用：版面原則

- 主畫面只放「現在可以報名的」，其他收起來。管理者一直在**拿掉東西**，不是加東西。
- 字體大小按鈕（A＋）一定要有。
- 名單公開、照區排、寫人數。
- 「區的報名」頁：選區就看到這一區報了誰，可以找名字、取消，但不連到報名頁（管理者特別要求要單純）。
- 名字超過 4 個字就用黃色提醒（常常是名字和區打在一起）。

## 7. 常見問題與截圖

- 每改一次畫面，就同時改 `js/help.js` 和 `img/help/` 的截圖。
- 截圖用 `tools/help-shots.js` ＋ 假資料的本機伺服器（`tools/dev-server.js --mock`）自動產生，**只用假名**（測試甲、王小明）。

## 8. App 圖示

- 用使用者原本的圖案，下面加「教育組」字（D3）。
- 用 SVG 畫，再用 headless Chrome 轉成各種尺寸的 PNG。
- 換顏色用 `feColorMatrix` 濾鏡，坑是會把整個方塊都塗滿。解法：給每一步具名的 result（mask／paint），濾鏡範圍設 `x=0 y=0 width=1 height=1`。
- maskable 圖示縮到 0.8 留邊；favicon 太小，只放圖案、不放字。

## 9. 停用但保留資料

- `worker/wrangler.toml` 加 `[vars] PAUSED = "1"`。`index.js` 裡 fetch 一律回 503 `PAUSED`，alarm 直接 return。
- GitHub Pages 用 `gh api -X DELETE repos/<owner>/<repo>/pages` 關掉。
- 要恢復的方法寫在 `docs/spec.md` 最上面。**不要刪 Worker／Durable Object**，刪了資料就沒了。

## 10. 開發時的小坑（Windows）

- 使用者的終端機是 PowerShell 5.1：沒有 `&&`，`npx` 不能用，要打 `npx.cmd`。
- 在 Bash 裡用 heredoc 寫含中文、引號、反斜線的程式常常壞掉。改成先把 patch 腳本寫成檔案，再用 `node` 執行。
- 測試裡把時間往後撥，登入會過期，要在測試裡重新登入。
- `node --test` 全部通過才 commit；每完成一段就 commit 並 push。
