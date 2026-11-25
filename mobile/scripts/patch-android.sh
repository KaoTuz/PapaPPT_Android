#!/usr/bin/env bash
# 在 `npx cap add android` 之後執行：放入自訂原生程式、App 圖示與設定
set -euo pipefail
cd "$(dirname "$0")/.."
APP=android/app/src/main
PKG=$APP/java/com/kaotuz/papappt
mkdir -p "$PKG"
cp android-src/MainActivity.java android-src/NativeFilesPlugin.java "$PKG/"
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$APP/res/mipmap-$d"
  cp android-src/icons/mipmap-$d/*.png "$APP/res/mipmap-$d/"
done
rm -rf "$APP/res/mipmap-anydpi-v26"
# 大型影片需要較多記憶體
grep -q 'largeHeap' "$APP/AndroidManifest.xml" || sed -i 's/<application/<application android:largeHeap="true"/' "$APP/AndroidManifest.xml"
# 啟動畫面改為米白底（不顯示 Capacitor 預設圖）
sed -i 's#@drawable/splash#@color/papa_bg#g' "$APP/res/values/styles.xml" || true
cat > "$APP/res/values/papa_colors.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="papa_bg">#FBF7F0</color></resources>
XML
echo "Android 專案修補完成"
