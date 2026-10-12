# CLAUDE.md

## 每次工作前

- **每次工作前先讀 `docs/spec.md`，所有開發以它為準。**
- 需求有變動時，先更新 `docs/spec.md`，再改程式。

## 公開儲存庫規則

- **本儲存庫是公開的，不可放任何人名、電話。** 程式碼、測試資料、範例、註解、文件、commit 訊息都一樣。
- 測試或範例需要名字時，使用明顯的假名（例如「測試甲」「王小明」）。區名是公開資訊，可以放。
- 教全區的公開 API 回應裡有人名：分壇 Worker 只留規格第 4 節列的欄位，絕不轉給前端。
- 管理密碼存在 Cloudflare Worker 的 secret（`ADMIN_PASSWORD`），不寫進程式碼；Claude 不經手真的密碼。

## 參考專案

- `D:\Projects\教全區行事曆\duty-calendar` 是教全區的報名系統，**只能讀、參考，不可修改裡面任何檔案**。

## 開發流程

- 每完成一個段落就 commit 並 push 到 GitHub。大功能先討論再做。
- `node --test` 全部通過才 commit。
- 改了 js、css 後把 `index.html` 裡 `?v=` 的日期換新。
- **每次加新功能或畫面改變，都要同時更新常見問題**（`js/help.js`）和截圖（`img/help/`）。
- 同網域（bailixiao.github.io）有好幾個網站：Service Worker 的快取名稱要帶網站路徑、只清自己的快取。
- 本機預覽用 `.claude/launch.json`（autoPort），不要固定連接埠。
