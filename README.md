# 自然語言行事曆提醒（Cloudflare MVP）

本版已重構為 Cloudflare 架構：
- **Frontend:** Cloudflare Pages（`frontend/pages`）
- **API:** Cloudflare Worker + Hono（`worker/src/index.ts`）
- **DB:** Cloudflare D1（`migrations/0001_init.sql`）
- **Scheduler:** Worker Cron Trigger（每分鐘掃描到期提醒並標記 sent）

---

## 目錄結構

```txt
frontend/
  pages/
    index.html
worker/
  src/
    index.ts
    lib/timeParser.ts
migrations/
  0001_init.sql
scripts/
  smoke-local.sh
  smoke-preview.sh
wrangler.toml
```

---

## 1) 安裝

```bash
npm install
```

---

## 2) 建立 D1 + 套 migration

```bash
# 建立資料庫（首次）
npm run d1:create

# 把回傳的 database_id 填入 wrangler.toml 的 [[d1_databases]].database_id

# 本地 D1 migration
npm run d1:migrate:local

# 雲端 D1 migration
npm run d1:migrate:remote
```

---

## 3) 環境變數（Worker vars/secrets）

### wrangler.toml vars（已放預設）
- `DEFAULT_TIMEZONE`
- `FRONTEND_BASE_URL`
- `GOOGLE_CALENDAR_ID`

### secrets（需另外設定）
```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REDIRECT_URI
```

> `GOOGLE_REDIRECT_URI` 應設為：
> `https://<your-worker-domain>/api/integrations/google/oauth/callback`

---

## 4) 本地開發

### API Worker
```bash
npm run dev
# http://127.0.0.1:8787
```

### Pages 前端（可選）
```bash
npm run dev:pages
# http://127.0.0.1:8788
```

---

## 5) 部署

```bash
# 部署 Worker API
npm run deploy

# 部署 Pages
npm run deploy:pages
```

部署後請確認：
1. Google OAuth redirect URI 指向 Worker callback。
2. `FRONTEND_BASE_URL` 指向 Pages URL（OAuth 完成後會導回前端）。

---

## 6) API 摘要

- `GET /health`
- `POST /api/reminders`
  - 建立事件時固定寫入兩筆提醒時間：
    - 事件前 **1 天同一時間**
    - 事件前 **2 小時**
  - 即使事件距離現在少於 2 小時，`事件前 2 小時` 的提醒仍會照規則寫入（可能為過去時間）
- `GET /api/reminders/create?userId=...&title=...&text=...&timezone=...`（受限環境建立備援）
- `GET /api/reminders?userId=...`
- `DELETE /api/reminders/:eventId?userId=...`
- `GET /api/reminders/delete?eventId=...&userId=...`（受限環境刪除備援）
- `GET /api/integrations/google/oauth/start?userId=...`
- `GET /api/integrations/google/oauth/callback`
- `GET /api/integrations/google/status?userId=...`
- `POST /api/integrations/google/sync/:eventId`
- `POST /api/integrations/google/sync`

### 受限環境建立備援（GET）

若執行環境（例如某些 webhook / proxy / low-code 平台）只能發 GET（無法發 POST JSON），可改用：

- `GET /api/reminders/create?userId=...&title=...&text=...&timezone=...`

行為與 `POST /api/reminders` 相同：
- 解析 `text` 自然語句時間，建立 `events`
- 固定建立兩筆提醒：事件前 **1 天同時**、事件前 **2 小時**
- 回傳同等 JSON：`{ event, reminders, sync }`，HTTP `201`
- 缺少必要參數（`userId/title/text`）：回 `400`
- 解析失敗：回 `422`

範例：

```bash
curl "https://<your-worker-domain>/api/reminders/create?userId=u123&title=%E7%B9%B3%E4%BF%9D%E8%B2%BB&text=%E4%B8%8B%E9%80%B1%E4%BA%8C%E4%B8%8B%E5%8D%883%E9%BB%9E&timezone=Asia%2FTaipei"
```

### 受限環境刪除備援

若執行環境（例如某些 webhook / proxy / low-code 平台）無法送出 `DELETE` 方法，可改用：

- `GET /api/reminders/delete?eventId=...&userId=...`

行為與 `DELETE /api/reminders/:eventId?userId=...` 相同：
- 缺少 `eventId` 或 `userId`：回 `400`
- 找不到事件：回 `404`
- 若事件有 `google_event_id` 且 Google 已連線，會先嘗試刪除 Google Calendar 遠端事件（`404` 視為已刪除）
- 再刪除本地 `reminders/events`
- 刪除成功：
  - `DELETE` 端點維持 `204 No Content`
  - `GET` fallback 回 `200` 與 JSON `{ "ok": true, "eventId": "...", "googleDeleted": true|false }`

---

## 7) Cron 行為

`wrangler.toml` 設定：
```toml
[triggers]
crons = ["* * * * *"]
```

Worker `scheduled` handler 每分鐘：
1. 查 `status='pending' AND remind_at <= now()` 的提醒
2. 模擬發送（console log）
3. 更新 `status='sent'`, `sent_at=datetime('now')`

---

## 8) 測試

### 時間解析最小單元測試（Node built-in test runner）
```bash
node --test --experimental-strip-types worker/src/lib/timeParser.test.ts
```

### Smoke 測試（本地 wrangler dev）
```bash
npm run smoke:local
```

### Smoke 測試（預覽/正式）
```bash
API_BASE_URL=https://<your-worker-domain> npm run smoke:preview
```

---

## 9) Google OAuth / Calendar 同步現況

✅ 已完成：
- OAuth start/callback/status API 介面
- access token / refresh token 儲存到 D1
- 單筆與批次同步 API（寫入 Google Calendar）
- 提醒建立後自動嘗試 sync（失敗不阻斷主流程）

⚠️ 尚需實機打通確認：
- Google Cloud Console 憑證與 redirect URI 正確配置
- 真實網域上的 OAuth consent 流程完整驗證
- 權限審核/品牌驗證（若要對外正式上線）
