# HANDOFF：Papa PPT（圖片／影片轉 PPT）Android App＋網頁版

> 給接手的 AI session：請先讀完本文件。完整專案在使用者提供的 `Streamlit_PPT_full.zip`，本文件也在專案根目錄。
> **使用者偏好：一律用繁體中文回覆；先優化提詞再執行；不要臆測，有問題先問使用者。**

---

## 1. 背景

| 項目 | 內容 |
|---|---|
| 原始 repo | https://github.com/KaoTuz/Streamlit_PPT（Papa ppt） |
| 原始檔案 | `app.py`、`requirements.txt`、`ExecutePython.bat`、`.gitignore`，**全部未修改** |
| 原始技術 | Python、Streamlit 1.52.2、python-pptx 1.0.2、Pillow |
| 原本的使用方式 | Streamlit 版**提供網址給別人開啟** |
| 使用對象 | 長輩（介面要簡單、大字、步驟少） |

### 原始 `app.py` 的行為（新專案已照搬）
- 投影片 16:9（13.333 × 7.5 吋），四周邊界 0.5 吋，圖片等比例縮放後置中
- **首頁**：
  - 背景 RGB(245,240,230)
  - 標題為當天日期 `YYYY_MM_DD`，44pt、微軟正黑體、RGB(80,60,40)
  - 副標題固定「講師 高明誠」，28pt、RGB(100,80,60)
- **上傳方式**：ZIP（含子資料夾），或一次多選圖片
- **支援格式**：jpg、jpeg、png、gif、bmp、webp
- **排序**：`images.sort()` 字串排序，所以 `10.jpg` 會排在 `2.jpg` 前面
- **`show_filename = False`**：每頁顯示檔名的功能存在，但目前關閉
- **下載檔名**：`PPT_YYYY_MM_DD_HH_mm.pptx`

---

## 2. 需求（使用者原始提詞，已優化）
1. 投影片可以加入本機影片，影片要等比例、盡量填滿整張投影片
2. 上傳方式新增「指定資料夾」，資料夾內所有圖片和影片都會上傳
3. 製作前先依投影片順序列出縮圖，並可拖拉調整順序（UI/UX 要特別設計）
4. 做成 Android App，並打包成 APK

### 使用者已確認的決策

| # | 問題 | 使用者的回答 |
|---|---|---|
| 1 | APK 架構 | **A：改寫成純前端 App 再打包 APK**（可離線、不需要伺服器） |
| 2 | APK 產出方式 | 用 GitHub Actions（公開 repo 用標準主機免費；私人 repo 免費方案每月約 2,000 Linux 分鐘） |
| 3 | 影片規格 | 只支援 **MP4**；**貼滿投影片，比例不同時補黑邊**；**按一下播放，不循環** |
| 4 | 子資料夾 | **提供勾選選項** |
| 5 | 首頁副標題 | **維持**「講師 高明誠」 |
| 6 | App 名稱和圖示 | 交給 AI 決定 → 名稱「Papa PPT」，圖示是 AI 生成的暖棕色投影幕加播放鍵 |
| 7 | 網頁怎麼開啟 | 跟原本一樣，**給網址就能開** → 已新增 GitHub Pages 自動部署 |
| 8 | repo 公開或私人 | 使用者問「用 Pages 要選哪個」→ 建議**公開**（理由見第 7 節），**使用者尚未最後確認** |
| 9 | 交付內容 | 已提供**完整專案 ZIP**（原始檔加上新增檔） |

### 已向使用者說明的事
- 新專案是**全新、獨立的專案**，用 HTML/JS 重寫，和 `app.py` 沒有共用程式碼
- 兩個版本各自獨立，改一邊另一邊不會跟著變

---

## 3. 架構

```
Streamlit_PPT/
├─ .github/workflows/
│  ├─ build-apk.yml          GitHub Actions：產生 APK（Artifact: PapaPPT-APK）
│  └─ deploy-pages.yml       GitHub Actions：把 mobile/www 部署到 GitHub Pages
├─ mobile/                   新的獨立專案
│  ├─ package.json           Capacitor ^7（core、android、cli）
│  ├─ capacitor.config.json  appId com.kaotuz.papappt；appName Papa PPT；webDir www
│  ├─ .gitignore / README.md
│  ├─ www/                   純前端（瀏覽器、Pages、App 共用同一份）
│  │  ├─ index.html、css/style.css、img/icon.png
│  │  ├─ js/app.js           UI、匯入、縮圖、拖拉、預覽、製作、儲存
│  │  ├─ js/pptbuilder.js    產生 PPTX（UMD 格式，可在 Node 測試）
│  │  └─ lib/pptxgen.bundle.js（PptxGenJS 4.0.0）、lib/jszip.min.js（3.10.2）
│  ├─ android-src/           MainActivity.java、NativeFilesPlugin.java、icons/mipmap-*/
│  └─ scripts/patch-android.sh
├─ HANDOFF_PapaPPT.md        本文件
├─ app.py / requirements.txt / ExecutePython.bat / .gitignore   原始檔，未修改
```
- `android/` 資料夾不放進 repo，由 CI 執行 `npx cap add android` 產生
- 網頁版在 `file://` 下也能使用（直接開啟 `index.html`）

---

## 4. 重要實作細節

### 4.1 `pptbuilder.js`
- **佔位替換**：先用 PptxGenJS 排版，媒體資料先放極小的佔位內容（`PPHX-000000-END` 的 base64）。`write({outputType:'arraybuffer'})` 之後，用 JSZip 打開 `ppt/media/*`，比對佔位內容再換成真正的 Blob 或 Buffer（`compression:'STORE'`）。這樣不用把大影片轉成 base64，可以省記憶體。如果替換數量不符，會丟出錯誤。
- **版面**：`LAYOUT_WIDE`
- **首頁**：兩個置中的文字框
- **圖片頁**：白底，0.5 吋邊界，等比例置中
- **影片頁**：黑底，等比例縮放到整張投影片並置中
  - 用 `addMedia({type:'video', extn:'mp4', cover})` 加入
  - PptxGenJS 會自動加上 `hlinkClick action="ppaction://media"`，而且沒有 `<p:timing>`，所以是按一下播放、不循環
  - 封面圖會被存成 `.png`，所以前端用 PNG 輸出封面（最長邊 960px）
- **items 格式**：`{type, ext:'jpeg'|'png'|'gif'|'bmp'|'mp4', w, h, cover?, getData: async()=>Blob|Buffer}`

### 4.2 `app.js`
- **匯入**：每批檔案先依路徑自然排序（`Intl.Collator('zh-Hant',{numeric:true})`），再附加到清單最後
- **圖片**
  - 用 `<img>` 讀取尺寸（已套用 EXIF 方向），縮圖最長邊 360px
  - EXIF 方向 > 1 或 WEBP 的圖片，在製作時才用 canvas 轉成 JPEG（品質 0.92，最長邊上限 4096）
- **影片**
  - 用 `<video>` 跳到 0.5 秒擷取縮圖和封面
  - 超過 12 秒還沒載入或發生錯誤時，標記為 `noPreview`，並以 16:9 擺放
- **ZIP**：檔名先試 UTF-8，失敗改用 Big5；略過 `__MACOSX/` 和 `._*`
- **資料夾**
  - 瀏覽器用 `webkitdirectory`，用路徑層數判斷子資料夾
  - App 呼叫原生 `pickFolder`
- **拖拉**
  - 觸控：長按 350ms（會震動）開始拖；長按前移動超過 10px 視為捲動
  - 滑鼠：移動超過 6px 開始拖
  - 拖動時顯示 ghost 縮圖和虛線佔位；靠近畫面邊緣會自動捲動；放開後依 DOM 順序重建 `state.items`
- **首頁縮圖**固定在第一格
- **預覽視窗**：移到最前、往前、往後、移到最後、刪除
- **刪除**後 6 秒內可以復原
- **排序**：依檔名或依時間；**全部清除**前會先確認
- **輸出**
  - 瀏覽器：`<a download>` 下載
  - App：每段 1.5MB 的 base64，依序呼叫 `saveBegin`、`saveAppend`、`saveFinish`，再提供開啟和分享

### 4.3 原生外掛 `NativeFiles`

| 方法 | 說明 |
|---|---|
| `pickFolder({recursive})` | 用 `ACTION_OPEN_DOCUMENT_TREE` 選資料夾，透過 `DocumentsContract` 列出檔案，把支援的檔案複製到 `cacheDir/picked/<時間戳>/`。回傳 `{cancelled, files:[{path,name,relPath,lastModified,size}]}`，過程中發送 `pickProgress` 事件。JS 再用 `fetch(Capacitor.convertFileSrc(path))` 讀取 |
| `clearCache()` | 刪除 `cacheDir/picked` |
| `saveBegin` / `saveAppend` / `saveFinish` | API 29 以上存到 MediaStore 的 `Download/PapaPPT/`；API 28 以下存到 `getExternalFilesDir(DOWNLOADS)` 並透過 FileProvider 分享。回傳 `{uri, location}` |
| `openFile({uri})` | `ACTION_VIEW`；手機上沒有能開 PPT 的 App 時，提示安裝 PowerPoint |
| `shareFile({uri})` | `ACTION_SEND`，跳出分享選單 |

### 4.4 `patch-android.sh`
1. 複製兩個 Java 檔到 `com/kaotuz/papappt/`
2. 複製圖示，並刪除 `mipmap-anydpi-v26`
3. 在 AndroidManifest 加上 `largeHeap="true"`
4. 把 `styles.xml` 的 `@drawable/splash` 換成 `@color/papa_bg`（#FBF7F0）

### 4.5 CI
- **build-apk.yml**
  - 觸發：push 到 main，且 `mobile/**` 或 workflow 本身有變更；也可手動執行
  - 環境：Node 22、JDK 21
  - 步驟：`npm install` → `cap add android` → `patch` → `cap sync` → `assembleDebug`
- **deploy-pages.yml**
  - 觸發：push 到 main，且 `mobile/www/**` 有變更；也可手動執行
  - 使用 `configure-pages@v5`、`upload-pages-artifact@v3`（`path: mobile/www`）、`deploy-pages@v4`
  - **需要先在 Settings → Pages 把 Source 設為 GitHub Actions**

---

## 5. 已完成的驗證

| 項目 | 結果 |
|---|---|
| `node --check` 檢查 `app.js` 和 `pptbuilder.js` | ✅ 通過 |
| 在 Node 用 pptbuilder 產生 PPT（JPG、PNG 直式、MP4 4:3） | ✅ 產出成功 |
| PPT 轉成圖片人工檢查（第一次建置時做的） | ✅ 版面正確，4:3 影片左右補黑邊 |
| PPT 內的 MP4 和原檔比對 | ✅ 完全相同 |
| 影片 XML | ✅ 有 `ppaction://media`，沒有 timing |
| pptx skill 的 `validate.py` | ⚠️ 第一次通過；重建後出現 `notesMasterIdLst` 順序錯誤。這是 PptxGenJS 已知的輸出方式，pptx skill 文件說明 PowerPoint 可以正常開啟，**不要**手動調整順序。仍需用 PowerPoint 實際確認 |

### ⚠️ 尚未驗證
- GitHub Actions 的 APK 建置和 Pages 部署都**還沒實際跑過**
- UI **沒有在任何瀏覽器實際操作過**（沙箱裡沒有可用的瀏覽器）
- 原生外掛**還沒編譯過，也沒在手機上測試過**
- 還沒用 Microsoft PowerPoint 開啟產生的 PPT（包括影片能不能播放）

---

## 6. TODO

### P0
- [ ] 使用者把 repo 設為 Public（待確認）→ 在 Settings → Pages 把 Source 設為 GitHub Actions → push
- [ ] 確認兩個 workflow 都成功；取得 Pages 網址（預期為 `https://kaotuz.github.io/Streamlit_PPT/`）
- [ ] APK 建置失敗時，優先檢查：
  - Capacitor 7 範本的檔名和路徑（`styles.xml`、mipmap）是否和 patch 腳本假設的一致
  - MainActivity 的套件路徑
  - Gradle 或 SDK 授權
- [ ] 手機實測：
  - 三種上傳方式和子資料夾勾選
  - 長按拖拉（會不會和捲動衝突）
  - 預覽、刪除、復原
  - 製作 PPT → 存到「下載 / PapaPPT」→ 開啟、分享
- [ ] 確認 WebView 的行為：
  - 多選檔案
  - 用 `convertFileSrc` 讀大檔案
  - `navigator.vibrate` 有沒有作用（若需要，manifest 要加 VIBRATE 權限）

### P1
- [ ] 用 PowerPoint（Windows、Mac、手機）開啟產生的 PPT，確認影片可以播放、首頁字型正常
- [ ] 壓力測試：100 張照片以上，以及合計 500MB 以上的影片；必要時改善記憶體用量（JSZip `streamFiles`，或改在原生端打包 ZIP）

### P2
- [ ] Android 返回鍵：預覽視窗開著時，按返回鍵應先關閉視窗
- [ ] 是否要提供「每頁顯示檔名」開關（原程式的 `show_filename`）
- [ ] release 簽章
- [ ] 深色模式

### P3
- [ ] 決定是否停用 Streamlit 版
- [ ] 是否把 `mobile/` 拆成獨立 repo

---

## 7. 待使用者確認
1. **repo 要不要改成公開？**
   - GitHub Free 只能在公開 repo 使用 Pages；私人 repo 需要 Pro、Team 或更高方案
   - 即使 repo 是私人的，Pages 網站本身仍是公開的；要限制瀏覽者，需要 Enterprise Cloud
   - 原始碼內沒有密碼或金鑰，但含「講師 高明誠」字樣（網站上本來就看得到）
   - 因此**建議改成公開**，使用者尚未最後確認
2. 原本的 Streamlit 網址是部署在哪裡（例如 Streamlit Community Cloud）？要不要停用或保留？

---

## 8. 已知限制
- 手機瀏覽器大多不支援選資料夾，手機請用 APK
- 部分 HEVC 編碼的 MP4 無法預覽
- 不支援 HEIC
- APK 是 debug 簽章
- 所有處理都在本機進行，不會上傳任何檔案
