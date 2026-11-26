# Papa PPT：圖片／影片轉 PPT（Android App + 網頁版）

## 功能
1. **照片和影片都能放進投影片**
   - 照片：四周留 0.5 吋邊界，等比例置中（和原本 Streamlit 版一樣）
   - MP4 影片：等比例放大貼滿整張投影片，比例不同時補黑邊；按一下才播放，不循環
2. **三種加入方式**
   - 選擇資料夾：可以勾選要不要包含子資料夾
   - 一次多選照片或影片
   - ZIP 壓縮檔
3. **製作前先檢視、調整順序**
   - 縮圖依投影片順序排列，並標上序號
   - 按住約半秒後拖動即可排序
   - 點一下縮圖可以放大預覽，或用按鈕移到最前、往前、往後、移到最後、刪除
   - 可依檔名（自然排序）或依時間排序，刪除後可以復原
   - 可以自訂輸出檔名與首頁標題，並用滑桿調整縮圖大小
   - 縮圖清單最後的「＋加入更多」可繼續加入資料夾、照片／影片或 ZIP
4. **首頁**：沿用米色背景與副標題「講師 高明誠」，標題預設為當天日期，可在製作前修改
5. 下載檔名預設為：`PPT_YYYY_MM_DD_HH_mm.pptx`，可在製作前修改。手機上會存到「下載 / PapaPPT」，可以直接開啟或分享

## 用 GitHub Actions 產生 APK
1. 把壓縮檔內的 `mobile/` 和 `.github/` 兩個資料夾放到 repo 根目錄，然後 commit 並 push 到 `main`
2. 到 GitHub repo 的 **Actions** 頁面，選 **Build Android APK**，等它跑完（也可以按 **Run workflow** 手動執行）
3. 在執行結果頁面最下方的 **Artifacts** 下載 `PapaPPT-APK`，解壓縮後就是 `PapaPPT.apk`
4. 把 APK 傳到手機安裝。第一次安裝時，請允許「安裝不明來源的應用程式」

> 建置出來的是 debug 簽章的 APK，自己安裝使用沒有問題，但不能上架 Google Play。

## 在電腦上使用
直接用 Chrome 或 Edge 開啟 `mobile/www/index.html` 即可，不需要安裝 Python。
原本的 Streamlit 版 `app.py` 沒有變動，仍然可以照常使用。

## 在自己電腦用 Android Studio 建置（選用）
需要先安裝 Node.js 20 以上、JDK 21 和 Android Studio：
```
cd mobile
npm install
npx cap add android
bash scripts/patch-android.sh
npx cap sync android
npx cap open android      # 在 Android Studio 中執行 Build > Build APK
```

## 注意事項
- 照片和影片都在手機上處理，不會上傳到網路
- 影片很大時（例如合計超過 500 MB），舊手機可能會記憶體不足，建議分批製作
- 手機直拍照片如果帶有 EXIF 旋轉資訊，會自動轉正；WEBP 會轉成 JPEG，以確保 PowerPoint 能正常顯示
- 少數 HEVC（H.265）編碼的 MP4 在手機上無法預覽縮圖，但仍會放進投影片；能不能在 PowerPoint 播放，取決於播放的電腦
