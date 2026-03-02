# 自然語言行事曆提醒 MVP（前後端整合版）

這個專案已整合為「同一個 workspace 可同時啟動前端 + 後端」。

- 後端：Fastify + SQLite（根目錄）
- 前端：React + Vite（`nl-calendar-reminder-mvp/`）

目前已改為 **前端呼叫真實後端 API**，並支援 Google Calendar OAuth2 串接（MVP）。

---

## 1) 安裝

```bash
# 根目錄後端依賴
npm install

# 前端依賴
npm --prefix nl-calendar-reminder-mvp install
```

或使用一鍵安裝：

```bash
npm run install:all
```

---

## 2) 環境變數

### 後端（根目錄 `.env`）

先複製：

```bash
cp .env.example .env
```

```env
PORT=3000
DB_PATH=./data/app.db
DEFAULT_TIMEZONE=Asia/Taipei
OPENAI_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/oauth/callback
GOOGLE_CALENDAR_ID=primary
FRONTEND_BASE_URL=http://localhost:5173
```

### 前端（`nl-calendar-reminder-mvp/.env`）

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_USER_ID=u_demo
```

---

## 3) Google Cloud Console 設定（OAuth 同意畫面 + Redirect URI）

1. 到 Google Cloud Console 建立/選擇專案。
2. 啟用 API：`Google Calendar API`。
3. 建立 OAuth 同意畫面（External/Internal 皆可，MVP 可先測試模式）：
   - App name、Support email
   - 加上測試使用者（若為 Testing 模式）
4. 建立 OAuth Client ID（Web application）
   - Authorized redirect URI 加入：
     - `http://localhost:3000/api/integrations/google/oauth/callback`
5. 把 Client ID / Secret 填入 `.env`。

---

## 4) 啟動

### 一鍵同時啟動前後端（推薦）

```bash
npm run dev:all
```

會同時啟動：
- Backend: `http://localhost:3000`
- Frontend(Vite): `http://localhost:5173`

---

## 5) 本地測試流程（建立提醒 + 授權 + 同步）

1. 打開 `http://localhost:5173`
2. 建立提醒（例如：`明天下午三點跟 PM 開會`）
3. 點「連線 Google Calendar」
   - 前端會呼叫 `/api/integrations/google/oauth/start?userId=u_demo`
   - 轉跳到 Google 授權頁
   - 同意後由後端 callback 重新導回前端 `FRONTEND_BASE_URL`，並帶上 `?oauth=success`（失敗則 `?oauth=error&message=...`）
4. 前端會顯示授權結果訊息並更新連線狀態
5. 點「手動同步」
   - 呼叫 `POST /api/integrations/google/sync`
   - 成功後會顯示同步筆數
6. 後端新增提醒時，會自動嘗試同步該事件（失敗不影響提醒建立）

---

## 6) API 速查

```bash
# 連線狀態
curl "http://localhost:3000/api/integrations/google/status?userId=u_demo"

# 觸發授權 URL
curl "http://localhost:3000/api/integrations/google/oauth/start?userId=u_demo"

# 手動同步全部（最多 50 筆）
curl -X POST http://localhost:3000/api/integrations/google/sync \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u_demo"}'

# 同步單筆事件
curl -X POST http://localhost:3000/api/integrations/google/sync/<eventId> \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u_demo"}'
```

---

## 7) 錯誤處理（MVP）

- 未連線：回傳 `not_connected` 與可讀訊息
- token 過期：自動用 refresh token 更新 access token
- refresh token 缺失/失效：回傳 `reauthorization_required`
- Google API 失敗：回傳 `sync_failed` 與可讀訊息
- 建立提醒時 auto sync 失敗：只記錄錯誤碼，不阻斷提醒建立

---

## 8) Smoke 測試腳本

啟動後端後可快速檢查 API：

```bash
# 檢查 health
npm run smoke:health

# 建立/查詢/刪除提醒（smoke user）
npm run smoke:reminders

# 一次跑完
npm run smoke
```

可用環境變數覆蓋：
- `API_BASE_URL`（預設 `http://localhost:3000`）
- `SMOKE_USER_ID`（預設 `u_smoke`）

---

## 9) 需要使用者動作（唯一必要步驟）

只有 Google 授權必須由使用者親自完成：
1. 在前端按下「連線 Google Calendar」。
2. 在 Google 授權頁登入並按同意。
3. 被導回前端後看到成功訊息即可。

其餘（啟動、建立提醒、同步 API）皆可由系統自行處理。

---

## 10) 時間解析可用例句（含自然句）

以下句型可被後端時間解析器辨識（`src/services/timeParser.js`）：
- `提醒我明天下午三點開會`
- `請在下週二早上9點提醒我交報告`
- `3/15 下午2點開會提醒`
- `明天晚上8點`
- `下週五`

可用快速檢查腳本驗證：

```bash
npm run test:time-parser
```

---

## 11) 既有功能

既有功能維持可用：
- 新增提醒
- 列表提醒
- 刪除提醒

Google 同步是增量功能，不影響原有提醒流程。
