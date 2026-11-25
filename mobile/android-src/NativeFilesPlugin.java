package com.kaotuz.papappt;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** 選資料夾（含子資料夾選項）、儲存 PPT 到「下載」、開啟與分享。 */
@CapacitorPlugin(name = "NativeFiles")
public class NativeFilesPlugin extends Plugin {

    private static final Set<String> EXTS = new HashSet<>(Arrays.asList(
            "jpg", "jpeg", "png", "gif", "bmp", "webp", "mp4"));

    private File saveFile;
    private OutputStream saveStream;

    // ───────────── 選資料夾 ─────────────
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            r.put("files", new JSArray());
            call.resolve(r);
            return;
        }
        final Uri tree = data.getData();
        final boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "picked/" + System.currentTimeMillis());
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                JSArray files = new JSArray();
                int[] counter = {0};
                walk(tree, DocumentsContract.getTreeDocumentId(tree), "", recursive, dir, files, counter);
                JSObject r = new JSObject();
                r.put("cancelled", false);
                r.put("files", files);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("讀取資料夾失敗：" + e.getMessage(), e);
            }
        }).start();
    }

    private void walk(Uri tree, String parentId, String rel, boolean recursive, File outDir,
                      JSArray out, int[] counter) throws IOException {
        ContentResolver cr = getContext().getContentResolver();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] proj = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        try (Cursor c = cr.query(children, proj, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long modified = c.isNull(3) ? 0 : c.getLong(3);
                if (name == null) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (recursive) walk(tree, id, rel + name + "/", true, outDir, out, counter);
                    continue;
                }
                int dot = name.lastIndexOf('.');
                if (dot < 0) continue;
                String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (!EXTS.contains(ext)) continue;

                counter[0]++;
                File dest = new File(outDir, counter[0] + "_" + name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                try (InputStream in = cr.openInputStream(docUri)) {
                    if (in == null) continue;
                    try (OutputStream os = new FileOutputStream(dest)) { copy(in, os); }
                }
                JSObject f = new JSObject();
                f.put("path", dest.getAbsolutePath());
                f.put("name", name);
                f.put("relPath", rel + name);
                f.put("lastModified", modified);
                f.put("size", dest.length());
                out.put(f);

                JSObject p = new JSObject();
                p.put("count", counter[0]);
                p.put("name", name);
                notifyListeners("pickProgress", p);
            }
        }
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        deleteRec(new File(getContext().getCacheDir(), "picked"));
        call.resolve();
    }

    // ───────────── 分段寫入並存到「下載」 ─────────────
    @PluginMethod
    public void saveBegin(PluginCall call) {
        try {
            closeQuietly();
            File dir = new File(getContext().getCacheDir(), "out");
            deleteRec(dir);
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            saveFile = new File(dir, call.getString("fileName", "output.pptx"));
            saveStream = new BufferedOutputStream(new FileOutputStream(saveFile), 1 << 20);
            call.resolve();
        } catch (Exception e) {
            call.reject("無法建立檔案：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void saveAppend(PluginCall call) {
        String d = call.getString("data");
        if (saveStream == null || d == null) { call.reject("儲存尚未開始"); return; }
        try {
            saveStream.write(Base64.decode(d, Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("寫入失敗：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void saveFinish(PluginCall call) {
        if (saveStream == null || saveFile == null) { call.reject("儲存尚未開始"); return; }
        final String mime = call.getString("mimeType",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        new Thread(() -> {
            try {
                saveStream.close();
                saveStream = null;
                Context ctx = getContext();
                String name = saveFile.getName();
                JSObject r = new JSObject();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = ctx.getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PapaPPT");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("無法在「下載」建立檔案");
                    try (InputStream in = new FileInputStream(saveFile);
                         OutputStream os = cr.openOutputStream(uri)) {
                        if (os == null) throw new IOException("無法寫入「下載」");
                        copy(in, os);
                    }
                    v.clear();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(uri, v, null, null);
                    r.put("uri", uri.toString());
                    r.put("location", "下載 / PapaPPT / " + name);
                } else {
                    File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File dest = new File(dir, name);
                    try (InputStream in = new FileInputStream(saveFile);
                         OutputStream os = new FileOutputStream(dest)) { copy(in, os); }
                    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", dest);
                    r.put("uri", uri.toString());
                    r.put("location", dest.getAbsolutePath());
                }
                //noinspection ResultOfMethodCallIgnored
                saveFile.delete();
                call.resolve(r);
            } catch (Exception e) {
                call.reject("儲存失敗：" + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(call.getString("uri")), call.getString("mimeType",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("手機上找不到可以開啟 PPT 的 App，請先安裝 PowerPoint。");
        } catch (Exception e) {
            call.reject("開啟失敗：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(call.getString("mimeType",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
            i.putExtra(Intent.EXTRA_STREAM, Uri.parse(call.getString("uri")));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(i, "分享投影片");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("分享失敗：" + e.getMessage(), e);
        }
    }

    // ───────────── 工具 ─────────────
    private static void copy(InputStream in, OutputStream os) throws IOException {
        byte[] buf = new byte[256 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
    }

    private void closeQuietly() {
        try { if (saveStream != null) saveStream.close(); } catch (IOException ignored) { }
        saveStream = null;
    }

    private static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
