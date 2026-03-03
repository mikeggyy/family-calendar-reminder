# Video Frame Desktop (V0.1.1)

Windows 友善的桌面版影片處理工具原型（Tauri + React）。

## 目前功能（V0.1.1）

- 原生選檔按鈕 `選擇影片（原生）`（僅 mp4）
- 保留拖拉 mp4；若拖拉無法取得可用完整路徑，會顯示明確警告並引導改用原生按鈕
- 選到合法影片路徑後立即檢查可讀性，並即時啟用「開始擷取」
- 顯示已選影片完整路徑與大小
- 若路徑不可讀/檔案不存在/非 mp4，會顯示清楚錯誤
- 本機呼叫 **FFmpeg** 進行擷取：**每 1.5 秒 1 張圖**（`fps=2/3`）
- 顯示處理進度（由 FFmpeg 輸出時間估算）
- 產生輸出資料夾：
  - `frames/frame_00001.jpg ...`
  - `metadata.json`
- 結果列表（job_id、frame 數量、輸出路徑、metadata 路徑）
  - 顯示路徑會自動清理 `\\?\` 與 `file://` 前綴，避免 Windows 長路徑/URI 影響閱讀
  - 提供 `開啟輸出資料夾` 按鈕，可直接用系統檔案總管開啟
  - 若路徑不存在或不是資料夾，會顯示友善錯誤訊息
- AI API 設定頁：可填 `endpoint` / `token`（先存本地 localStorage）
- 預留「送出 AI API」流程：目前先做 `mock_submit_ai`（不真的上傳）

---

## 專案結構

```txt
video-frame-desktop/
├─ index.html
├─ package.json
├─ vite.config.js
├─ src/
│  ├─ App.jsx
│  ├─ main.jsx
│  └─ styles.css
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/default.json
   └─ src/
      ├─ lib.rs
      └─ main.rs
```

---

## 先決條件

1. Node.js 18+
2. Rust（stable）
3. Tauri 需求環境（Windows 建議先安裝 Visual Studio Build Tools）
4. **FFmpeg + FFprobe**（需可在 PATH 執行）

快速檢查：

```bash
ffmpeg -version
ffprobe -version
```

---

## 開發啟動

```bash
cd video-frame-desktop
npm install
npm run tauri:dev
```

啟動後可在桌面視窗先用原生按鈕選檔，再測試拖拉行為。

### 操作說明（Windows 桌面版）

1. 在「處理影片」頁面，優先點擊 `選擇影片（原生）` 挑選 `.mp4`（使用原生系統檔案對話框，取得完整絕對路徑）。
2. 也可直接把 `.mp4` 拖進虛線框。
3. 若拖拉後出現「未取得可用完整路徑」警告，請改用 `選擇影片（原生）`。
4. 選取成功後，畫面會顯示：
   - 完整檔案路徑
   - 檔案大小
   - 「開始擷取每 1.5 秒一張」按鈕會立即可按
5. 若看到紅字錯誤（例如路徑不可讀、檔案不存在、非 mp4），先修正檔案來源再重試。
6. 點「開始擷取每 1.5 秒一張」後，會顯示進度並產出 frames/metadata。
7. 在結果列表可點 `開啟輸出資料夾`，直接打開該次輸出目錄。
8. 若目錄已被移動/刪除，畫面狀態列會顯示友善錯誤提示。

### 快速自測流程

- ✅ 原生選擇：按 `選擇影片（原生）` 選 mp4，確認按鈕立即啟用。
- ✅ 拖拉：把 mp4 拖進框內，確認不會觸發瀏覽器預設行為；若無路徑則出現引導改用原生按鈕。
- ✅ UI：確認有顯示完整路徑與大小。
- ✅ 異常：測試非 mp4 或不可讀路徑，確認顯示清楚錯誤訊息。

完整測試紀錄請見：`TESTING.md`

---

## Build Windows EXE（雙擊可用）

在 Windows 環境執行：

```bash
cd video-frame-desktop
npm install
npm run tauri:build
```

產物通常在：

- `src-tauri/target/release/bundle/nsis/*.exe`（安裝程式）
- 或 `src-tauri/target/release/*.exe`（主程式）

> 建議用 NSIS 安裝包給一般使用者，雙擊安裝後即可從開始選單開啟。

---

## metadata.json 範例

```json
{
  "job_id": "uuid",
  "source_video": "C:/videos/demo.mp4",
  "created_at": "2026-03-03T14:00:00Z",
  "frame_interval_sec": 1.5,
  "frame_count": 12,
  "frames": [
    { "file": "frame_00001.jpg", "second": 0.0 },
    { "file": "frame_00002.jpg", "second": 1.5 }
  ]
}
```

---

## 後續建議（V1.1+）

- 真實 API 上傳（multipart：metadata + frames）
- 設定頁加密儲存 token（改由 Rust side keychain/credential manager）
- 佇列處理多影片
- 結果縮圖預覽與點擊開啟資料夾
- 加上 ffmpeg 不存在時的 GUI 引導與一鍵檢測
