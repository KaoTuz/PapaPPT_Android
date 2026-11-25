/* 圖片／影片轉 PPT － 前端主程式（瀏覽器與 Android App 共用） */
(function () {
  'use strict';

  // ───────── 基本設定 ─────────
  var SUBTITLE = '講師 高明誠';
  var IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
  var VID_EXT = ['mp4'];
  var MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', mp4: 'video/mp4' };
  var MAX_REENCODE = 4096;   // 需轉檔的照片最長邊
  var LONG_PRESS_MS = 350;

  var Cap = window.Capacitor;
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var NativeFiles = isNative ? Cap.registerPlugin('NativeFiles') : null;
  var collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });

  var state = { items: [], seq: 0, lastDeleted: null, downloadUrl: null };
  var $ = function (id) { return document.getElementById(id); };
  var grid = $('grid');

  // ───────── 小工具 ─────────
  function extOf(n) { var i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); }
  function kindOf(n) {
    var e = extOf(n);
    if (IMG_EXT.indexOf(e) >= 0) return 'image';
    if (VID_EXT.indexOf(e) >= 0) return 'video';
    return null;
  }
  function baseName(p) { return p.split('/').pop(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d, withTime) {
    var s = d.getFullYear() + '_' + pad(d.getMonth() + 1) + '_' + pad(d.getDate());
    return withTime ? s + '_' + pad(d.getHours()) + '_' + pad(d.getMinutes()) : s;
  }
  function fmtDur(sec) {
    if (!isFinite(sec) || sec <= 0) return '';
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + pad(sec % 60);
  }
  function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function blobToDataURL(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function canvasToBlob(c, type, q) {
    return new Promise(function (res) { c.toBlob(function (b) { res(b); }, type, q); });
  }
  function drawScaled(src, w, h, max) {
    var r = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function loadImg(url) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('無法讀取圖片')); };
      im.src = url;
    });
  }
  // 讀取 JPEG EXIF 方向（手機直拍照片常見，PowerPoint 不一定會自動轉正）
  async function jpegOrientation(blob) {
    try {
      var v = new DataView(await blob.slice(0, 131072).arrayBuffer());
      if (v.getUint16(0) !== 0xFFD8) return 1;
      var off = 2;
      while (off + 4 < v.byteLength) {
        var marker = v.getUint16(off), len = v.getUint16(off + 2);
        if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
          var t = off + 10, le = v.getUint16(t) === 0x4949;
          var ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
          for (var i = 0; i < n; i++) {
            var e = ifd + 2 + i * 12;
            if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
          }
          return 1;
        }
        if ((marker & 0xFF00) !== 0xFF00) break;
        off += 2 + len;
      }
    } catch (e) { /* 忽略 */ }
    return 1;
  }

  // ───────── 處理中視窗 / 提示 ─────────
  function busy(text, pct, sub) {
    $('busy').hidden = false;
    $('busyText').textContent = text;
    $('busyBar').style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%';
    $('busySub').textContent = sub || '';
  }
  function unbusy() { $('busy').hidden = true; }
  var toastTimer = null;
  function toast(text, btnText, onBtn) {
    $('toast').hidden = false;
    $('toastText').textContent = text;
    var b = $('toastBtn');
    b.hidden = !btnText;
    b.textContent = btnText || '';
    b.onclick = function () { $('toast').hidden = true; if (onBtn) onBtn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; }, btnText ? 6000 : 3000);
  }

  // ───────── 加入檔案 ─────────
  // sources: [{ name, relPath, blob, mtime }]
  async function addSources(sources, skipped) {
    sources = sources.filter(function (s) { return kindOf(s.name); });
    sources.sort(function (a, b) { return collator.compare(a.relPath || a.name, b.relPath || b.name); });
    if (!sources.length) {
      unbusy();
      toast(skipped ? '沒有找到支援的照片或影片（略過 ' + skipped + ' 個檔案）' : '沒有找到任何照片或影片！');
      return;
    }
    hideResult();
    var added = 0, failed = 0;
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      busy('正在讀取檔案…', (i / sources.length) * 100, (i + 1) + ' / ' + sources.length + '　' + s.name);
      var ext = extOf(s.name);
      var it = {
        id: ++state.seq, name: s.name, relPath: s.relPath || s.name, ext: ext, kind: kindOf(s.name),
        blob: s.blob.type === MIME[ext] ? s.blob : s.blob.slice(0, s.blob.size, MIME[ext]),
        mtime: s.mtime || 0, w: 0, h: 0
      };
      try {
        if (it.kind === 'image') await analyzeImage(it); else await analyzeVideo(it);
        state.items.push(it);
        added++;
      } catch (e) { failed++; }
      if (i % 5 === 4) await sleep(0);
    }
    unbusy();
    render();
    var msg = '已加入 ' + added + ' 個檔案';
    if (failed) msg += '，' + failed + ' 個無法讀取';
    if (skipped) msg += '，略過 ' + skipped + ' 個不支援的檔案';
    toast(msg);
    if (added) $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function analyzeImage(it) {
    var url = URL.createObjectURL(it.blob);
    try {
      var img = await loadImg(url);
      it.w = img.naturalWidth; it.h = img.naturalHeight;   // 已套用 EXIF 方向
      var c = drawScaled(img, it.w, it.h, 360);
      it.thumbUrl = URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.8));
    } finally { URL.revokeObjectURL(url); }
    it.reencode = false;
    if (it.ext === 'webp') it.reencode = true;
    if (it.ext === 'jpg' || it.ext === 'jpeg') it.reencode = (await jpegOrientation(it.blob)) > 1;
  }

  function analyzeVideo(it) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      var url = URL.createObjectURL(it.blob), finished = false;
      var timer = setTimeout(function () { finish(false); }, 12000);
      async function finish(ok) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        it.duration = isFinite(v.duration) ? v.duration : 0;
        if (ok && v.videoWidth) {
          it.w = v.videoWidth; it.h = v.videoHeight;
          try {
            it.thumbUrl = URL.createObjectURL(await canvasToBlob(drawScaled(v, it.w, it.h, 360), 'image/jpeg', 0.8));
            it.coverBlob = await canvasToBlob(drawScaled(v, it.w, it.h, 960), 'image/png');
          } catch (e) { /* 無縮圖 */ }
        } else {
          // 手機無法預覽（例如 HEVC 編碼），仍可放入投影片，以 16:9 擺放
          it.w = it.w || 1920; it.h = it.h || 1080; it.noPreview = true;
        }
        v.removeAttribute('src'); v.load();
        URL.revokeObjectURL(url);
        resolve();
      }
      v.addEventListener('loadedmetadata', function () { it.w = v.videoWidth; it.h = v.videoHeight; }, { once: true });
      v.addEventListener('loadeddata', function () {
        var t = Math.min(0.5, (isFinite(v.duration) ? v.duration : 1) / 2);
        if (t > 0) v.currentTime = t; else finish(true);
      }, { once: true });
      v.addEventListener('seeked', function () { finish(true); }, { once: true });
      v.addEventListener('error', function () { finish(false); }, { once: true });
      v.src = url;
    });
  }

  // 一般多選
  $('btnFiles').addEventListener('click', function () { $('inFiles').value = ''; $('inFiles').click(); });
  $('inFiles').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    var src = [], skipped = 0;
    files.forEach(function (f) {
      if (kindOf(f.name)) src.push({ name: f.name, relPath: f.name, blob: f, mtime: f.lastModified });
      else skipped++;
    });
    busy('正在讀取檔案…', 0);
    addSources(src, skipped);
  });

  // 資料夾
  $('btnFolder').addEventListener('click', async function () {
    var recursive = $('chkSub').checked;
    if (!isNative) { $('inFolder').value = ''; $('inFolder').click(); return; }
    var handle = null;
    try {
      handle = await NativeFiles.addListener('pickProgress', function (p) {
        busy('正在讀取資料夾…', null, '已找到 ' + p.count + ' 個：' + p.name);
      });
      var r = await NativeFiles.pickFolder({ recursive: recursive });
      if (r.cancelled) return;
      if (!r.files.length) { toast('這個資料夾裡沒有照片或影片'); return; }
      busy('正在讀取檔案…', 0);
      var src = [];
      for (var i = 0; i < r.files.length; i++) {
        var f = r.files[i];
        var resp = await fetch(Cap.convertFileSrc(f.path));
        src.push({ name: f.name, relPath: f.relPath, blob: await resp.blob(), mtime: f.lastModified });
      }
      await addSources(src, 0);
    } catch (e) {
      unbusy();
      toast('讀取資料夾失敗：' + (e && e.message ? e.message : e));
    } finally {
      if (handle) handle.remove();
      if ($('busyText').textContent.indexOf('資料夾') >= 0) unbusy();
    }
  });
  $('inFolder').addEventListener('change', function (e) {
    var recursive = $('chkSub').checked;
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    var src = [], skipped = 0;
    files.forEach(function (f) {
      var rel = f.webkitRelativePath || f.name;
      var depth = rel.split('/').length;           // 「資料夾/檔案」= 2
      if (!recursive && depth > 2) return;
      if (kindOf(f.name)) src.push({ name: f.name, relPath: rel, blob: f, mtime: f.lastModified });
      else skipped++;
    });
    busy('正在讀取檔案…', 0);
    addSources(src, skipped);
  });

  // ZIP（沿用原程式：壓縮檔內所有資料夾）
  $('btnZip').addEventListener('click', function () { $('inZip').value = ''; $('inZip').click(); });
  $('inZip').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    busy('正在解壓縮…', 0, file.name);
    try {
      var zip = await JSZip.loadAsync(file, { decodeFileName: decodeZipName });
      var entries = [], skipped = 0;
      zip.forEach(function (path, entry) {
        if (entry.dir || path.indexOf('__MACOSX/') === 0 || baseName(path).indexOf('._') === 0) return;
        if (kindOf(path)) entries.push({ path: path, entry: entry }); else skipped++;
      });
      var src = [];
      for (var i = 0; i < entries.length; i++) {
        busy('正在解壓縮…', (i / entries.length) * 100, (i + 1) + ' / ' + entries.length);
        var en = entries[i];
        src.push({ name: baseName(en.path), relPath: en.path, blob: await en.entry.async('blob'), mtime: en.entry.date ? en.entry.date.getTime() : 0 });
      }
      await addSources(src, skipped);
    } catch (err) {
      unbusy();
      toast('ZIP 檔讀取失敗：' + (err && err.message ? err.message : err));
    }
  });
  // Windows 中文 ZIP 檔名常為 Big5，UTF-8 解不開時改用 Big5
  function decodeZipName(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { try { return new TextDecoder('big5').decode(bytes); } catch (e2) { return new TextDecoder().decode(bytes); } }
  }

  // ───────── 縮圖清單 ─────────
  var coverTile = (function () {
    var el = document.createElement('div');
    el.className = 'tile cover';
    el.innerHTML = '<div class="thumb"><span class="num">首頁</span><div class="ct"></div><div class="cs"></div></div><div class="tname">首頁（自動產生）</div>';
    el.querySelector('.cs').textContent = SUBTITLE;
    return el;
  })();

  function makeTile(it) {
    var el = document.createElement('div');
    el.className = 'tile' + (it.kind === 'video' ? ' video' : '');
    el.dataset.id = it.id;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (it.thumbUrl) {
      var img = document.createElement('img');
      img.src = it.thumbUrl; img.alt = ''; img.draggable = false;
      thumb.appendChild(img);
    } else {
      var ni = document.createElement('div'); ni.className = 'noimg'; ni.textContent = '🎬';
      thumb.appendChild(ni);
    }
    var num = document.createElement('span'); num.className = 'num'; thumb.appendChild(num);
    if (it.kind === 'video') {
      var vb = document.createElement('span'); vb.className = 'vbadge';
      vb.textContent = '▶ ' + (fmtDur(it.duration) || '影片');
      thumb.appendChild(vb);
    }
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'tdel'; del.textContent = '✕';
    del.setAttribute('aria-label', '刪除 ' + it.name);
    thumb.appendChild(del);
    var name = document.createElement('div'); name.className = 'tname'; name.textContent = it.name;
    el.appendChild(thumb); el.appendChild(name);
    it.el = el;
    return el;
  }

  function render() {
    var n = state.items.length;
    $('step2').hidden = n === 0;
    $('makeBar').hidden = n === 0;
    coverTile.querySelector('.ct').textContent = dateStr(new Date());
    if (grid.firstChild !== coverTile) grid.insertBefore(coverTile, grid.firstChild);
    state.items.forEach(function (it, i) {
      var el = it.el || makeTile(it);
      grid.appendChild(el);
      el.querySelector('.num').textContent = i + 1;
      el.setAttribute('aria-label', '第 ' + (i + 1) + ' 張：' + it.name);
    });
    var imgs = state.items.filter(function (x) { return x.kind === 'image'; }).length;
    $('countText').textContent = '共 ' + n + ' 個（照片 ' + imgs + '、影片 ' + (n - imgs) + '）';
    $('makeText').textContent = '製作投影片（共 ' + (n + 1) + ' 頁，含首頁）';
  }
  function renumber() {
    var i = 0;
    Array.prototype.forEach.call(grid.querySelectorAll('.tile[data-id]'), function (el) {
      el.querySelector('.num').textContent = ++i;
    });
  }
  function itemById(id) { id = Number(id); return state.items.filter(function (x) { return x.id === id; })[0]; }

  function removeItem(it, silent) {
    var idx = state.items.indexOf(it);
    if (idx < 0) return;
    state.items.splice(idx, 1);
    if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    state.lastDeleted = { it: it, idx: idx };
    hideResult();
    render();
    if (!silent) toast('已刪除「' + it.name + '」', '復原', function () {
      var d = state.lastDeleted;
      if (!d) return;
      state.items.splice(Math.min(d.idx, state.items.length), 0, d.it);
      state.lastDeleted = null;
      render();
    });
  }
  function freeItem(it) { if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); }

  $('sortName').addEventListener('click', function () {
    state.items.sort(function (a, b) { return collator.compare(a.relPath, b.relPath); });
    render(); toast('已依檔名排序（1、2、…10）');
  });
  $('sortTime').addEventListener('click', function () {
    state.items.sort(function (a, b) { return (a.mtime - b.mtime) || collator.compare(a.relPath, b.relPath); });
    render(); toast('已依時間排序（舊 → 新）');
  });
  $('clearAll').addEventListener('click', function () {
    if (!confirm('確定要清除全部 ' + state.items.length + ' 個檔案嗎？')) return;
    state.items.forEach(function (it) { freeItem(it); if (it.el) it.el.remove(); });
    state.items = []; state.lastDeleted = null;
    hideResult(); render();
    if (NativeFiles) NativeFiles.clearCache().catch(function () {});
  });

  // 點一下：預覽；✕：刪除
  var suppressClickUntil = 0;
  grid.addEventListener('click', function (e) {
    if (Date.now() < suppressClickUntil) return;
    var tile = e.target.closest('.tile[data-id]');
    if (!tile) return;
    var it = itemById(tile.dataset.id);
    if (!it) return;
    if (e.target.closest('.tdel')) { removeItem(it); return; }
    openModal(it);
  });
  grid.addEventListener('keydown', function (e) {
    var tile = e.target.closest && e.target.closest('.tile[data-id]');
    if (tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openModal(itemById(tile.dataset.id)); }
  });
  grid.addEventListener('contextmenu', function (e) { if (e.target.closest('.tile')) e.preventDefault(); });

  // ───────── 拖拉排序（手機長按、電腦直接拖） ─────────
  var pending = null, drag = null, lastPt = null, rafId = 0;

  function startDrag(tile, x, y) {
    pending = null;
    var r = tile.getBoundingClientRect();
    var ghost = tile.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.removeAttribute('data-id');
    ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
    ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
    ghost.style.transform = 'scale(1.06)';
    document.body.appendChild(ghost);
    tile.classList.add('placeholder');
    document.body.classList.add('dragging');
    drag = { tile: tile, ghost: ghost, dx: x - r.left, dy: y - r.top };
    lastPt = { x: x, y: y };
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* ignore */ } }
    rafId = requestAnimationFrame(autoScroll);
  }
  function moveDrag(x, y) {
    if (!drag) return;
    lastPt = { x: x, y: y };
    drag.ghost.style.left = (x - drag.dx) + 'px';
    drag.ghost.style.top = (y - drag.dy) + 'px';
    var under = document.elementFromPoint(x, y);
    var target = under && under.closest ? under.closest('.tile[data-id]') : null;
    if (!target || target === drag.tile || target.parentNode !== grid) return;
    var tiles = Array.prototype.slice.call(grid.children);
    var from = tiles.indexOf(drag.tile), to = tiles.indexOf(target);
    grid.insertBefore(drag.tile, from < to ? target.nextSibling : target);
    renumber();
  }
  function endDrag() {
    cancelAnimationFrame(rafId);
    if (!drag) return;
    drag.ghost.remove();
    drag.tile.classList.remove('placeholder');
    document.body.classList.remove('dragging');
    var order = Array.prototype.map.call(grid.querySelectorAll('.tile[data-id]'), function (el) { return itemById(el.dataset.id); });
    state.items = order.filter(Boolean);
    drag = null;
    suppressClickUntil = Date.now() + 400;
    hideResult();
    render();
  }
  function autoScroll() {
    if (!drag) return;
    var edge = 90, h = window.innerHeight, speed = 0;
    if (lastPt.y < edge) speed = -Math.ceil((edge - lastPt.y) / 6);
    else if (lastPt.y > h - edge - 60) speed = Math.ceil((lastPt.y - (h - edge - 60)) / 6);
    if (speed) { window.scrollBy(0, speed); moveDrag(lastPt.x, lastPt.y); }
    rafId = requestAnimationFrame(autoScroll);
  }

  // 觸控：長按啟動
  grid.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { cancelPending(); return; }
    var tile = e.target.closest('.tile[data-id]');
    if (!tile || e.target.closest('.tdel')) return;
    var t = e.touches[0];
    pending = { tile: tile, x: t.clientX, y: t.clientY };
    pending.timer = setTimeout(function () { if (pending) startDrag(pending.tile, pending.x, pending.y); }, LONG_PRESS_MS);
  }, { passive: true });
  grid.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (drag) { e.preventDefault(); moveDrag(t.clientX, t.clientY); return; }
    if (pending && Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > 10) cancelPending();
  }, { passive: false });
  grid.addEventListener('touchend', function () { cancelPending(); if (drag) endDrag(); });
  grid.addEventListener('touchcancel', function () { cancelPending(); if (drag) endDrag(); });
  function cancelPending() { if (pending) { clearTimeout(pending.timer); pending = null; } }

  // 滑鼠：按下移動超過 6px 即拖
  var mouseDown = null;
  grid.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var tile = e.target.closest('.tile[data-id]');
    if (!tile || e.target.closest('.tdel')) return;
    e.preventDefault();
    mouseDown = { tile: tile, x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mousemove', function (e) {
    if (drag) { moveDrag(e.clientX, e.clientY); return; }
    if (mouseDown && Math.hypot(e.clientX - mouseDown.x, e.clientY - mouseDown.y) > 6) {
      startDrag(mouseDown.tile, mouseDown.x, mouseDown.y);
      mouseDown = null;
      moveDrag(e.clientX, e.clientY);
    }
  });
  window.addEventListener('mouseup', function () { mouseDown = null; if (drag) endDrag(); });

  // ───────── 放大預覽視窗 ─────────
  var modalItem = null, modalUrl = null;
  function openModal(it) {
    modalItem = it;
    var box = $('mMedia');
    box.innerHTML = '';
    if (modalUrl) URL.revokeObjectURL(modalUrl);
    modalUrl = URL.createObjectURL(it.blob);
    if (it.kind === 'video') {
      box.className = 'modal-media';
      var v = document.createElement('video');
      v.src = modalUrl; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      box.appendChild(v);
    } else {
      box.className = 'modal-media img';
      var img = document.createElement('img'); img.src = modalUrl; img.alt = it.name;
      box.appendChild(img);
    }
    $('mName').textContent = it.relPath + (it.noPreview ? '（此影片手機無法預覽，仍會放進投影片）' : '');
    updateModalPos();
    $('modal').hidden = false;
  }
  function updateModalPos() {
    var i = state.items.indexOf(modalItem), n = state.items.length;
    $('mTitle').textContent = '第 ' + (i + 1) + ' / ' + n + ' 張' + (modalItem.kind === 'video' ? '（影片）' : '');
    $('mFirst').disabled = $('mPrev').disabled = i <= 0;
    $('mLast').disabled = $('mNext').disabled = i >= n - 1;
  }
  function closeModal() {
    $('modal').hidden = true;
    $('mMedia').innerHTML = '';
    if (modalUrl) { URL.revokeObjectURL(modalUrl); modalUrl = null; }
    modalItem = null;
  }
  function moveTo(newIdx) {
    var i = state.items.indexOf(modalItem);
    if (i < 0) return;
    newIdx = Math.max(0, Math.min(state.items.length - 1, newIdx));
    state.items.splice(i, 1);
    state.items.splice(newIdx, 0, modalItem);
    hideResult(); render(); updateModalPos();
  }
  $('mClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });
  $('mFirst').addEventListener('click', function () { moveTo(0); });
  $('mPrev').addEventListener('click', function () { moveTo(state.items.indexOf(modalItem) - 1); });
  $('mNext').addEventListener('click', function () { moveTo(state.items.indexOf(modalItem) + 1); });
  $('mLast').addEventListener('click', function () { moveTo(state.items.length - 1); });
  $('mDel').addEventListener('click', function () { var it = modalItem; closeModal(); removeItem(it); });

  // ───────── 製作投影片 ─────────
  $('btnMake').addEventListener('click', makePpt);

  async function makePpt() {
    if (!state.items.length) return;
    var now = new Date();
    var fileName = 'PPT_' + dateStr(now, true) + '.pptx';
    var items = state.items.slice();
    try {
      var list = [];
      for (var i = 0; i < items.length; i++) {
        busy('正在準備素材…', (i / items.length) * 20, (i + 1) + ' / ' + items.length);
        list.push(await toBuildItem(items[i]));
        await sleep(0);
      }
      var blob = await PapaPptBuilder.build({
        PptxGenJS: window.PptxGenJS, JSZip: window.JSZip, items: list,
        title: dateStr(now), subtitle: SUBTITLE, outputType: 'blob',
        onProgress: function (p) {
          if (p.phase === 'layout') busy('正在排版投影片…', 22);
          else if (p.phase === 'media') busy('正在放入照片與影片…', 22 + (p.done / p.total) * 38, p.done + ' / ' + p.total);
          else if (p.phase === 'zip') busy('正在產生 PPT 檔…', 60 + p.percent * (isNative ? 0.2 : 0.4), Math.round(p.percent) + '%');
        }
      });
      await deliver(blob, fileName);
    } catch (e) {
      unbusy();
      alert('製作失敗：' + (e && e.message ? e.message : e) + '\n\n若影片很大，可以分批製作。');
    }
  }

  async function toBuildItem(it) {
    if (it.kind === 'video') {
      return {
        type: 'video', ext: 'mp4', w: it.w, h: it.h,
        cover: it.coverBlob ? await blobToDataURL(it.coverBlob) : undefined,
        getData: function () { return Promise.resolve(it.blob); }
      };
    }
    var ext = it.reencode ? 'jpeg' : (it.ext === 'jpg' ? 'jpeg' : it.ext);
    return {
      type: 'image', ext: ext, w: it.w, h: it.h,
      getData: it.reencode ? function () { return reencode(it); } : function () { return Promise.resolve(it.blob); }
    };
  }
  // 轉正（EXIF 方向）或 WEBP 轉 JPEG，確保 PowerPoint 顯示正確
  async function reencode(it) {
    var url = URL.createObjectURL(it.blob);
    try {
      var img = await loadImg(url);
      var c = drawScaled(img, img.naturalWidth, img.naturalHeight, MAX_REENCODE);
      var b = await canvasToBlob(c, 'image/jpeg', 0.92);
      c.width = c.height = 0;
      return b;
    } finally { URL.revokeObjectURL(url); }
  }

  async function deliver(blob, fileName) {
    var size = fmtSize(blob.size);
    var btns = $('resultBtns');
    btns.innerHTML = '';
    if (!isNative) {
      if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
      state.downloadUrl = URL.createObjectURL(blob);
      var download = function () {
        var a = document.createElement('a');
        a.href = state.downloadUrl; a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
      };
      download();
      unbusy();
      $('resultText').textContent = fileName + '（' + size + '）已開始下載。';
      addBtn('📥 再下載一次', download, true);
    } else {
      var CHUNK = 3 * 512 * 1024; // 1.5MB（3 的倍數，base64 不會斷在中間）
      await NativeFiles.saveBegin({ fileName: fileName });
      for (var off = 0; off < blob.size; off += CHUNK) {
        busy('正在儲存到手機…', 80 + (off / blob.size) * 18, Math.round(off / blob.size * 100) + '%');
        var dataUrl = await blobToDataURL(blob.slice(off, off + CHUNK));
        await NativeFiles.saveAppend({ data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
      }
      busy('正在儲存到手機…', 99);
      var r = await NativeFiles.saveFinish({ mimeType: PapaPptBuilder.PPTX_MIME });
      unbusy();
      $('resultText').textContent = fileName + '（' + size + '）已存到：' + r.location;
      addBtn('📂 開啟', function () {
        NativeFiles.openFile({ uri: r.uri }).catch(function (e) { alert(e.message || e); });
      }, true);
      addBtn('📤 分享（LINE、Email…）', function () {
        NativeFiles.shareFile({ uri: r.uri }).catch(function (e) { alert(e.message || e); });
      });
    }
    $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function addBtn(text, fn, main) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    if (main) b.className = 'main';
    b.addEventListener('click', fn);
    $('resultBtns').appendChild(b);
  }
  function hideResult() { $('result').hidden = true; }

  // 啟動
  if (NativeFiles) NativeFiles.clearCache().catch(function () {});
  render();
})();
