/* 產生 PPTX：先用 PptxGenJS 排版（媒體用極小的佔位資料），
 * 再用 JSZip 把佔位資料換成真正的圖片/影片原始檔（不經 base64，手機記憶體較省）。 */
(function (root) {
  'use strict';
  var SLIDE_W = 13.333, SLIDE_H = 7.5, MARGIN = 0.5;
  var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function fitContain(w, h, boxW, boxH) {
    w = w > 0 ? w : 16; h = h > 0 ? h : 9;
    var r = Math.min(boxW / w, boxH / h);
    return { w: w * r, h: h * r };
  }
  function toB64(s) {
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'ascii').toString('base64');
  }
  function keyOf(i) { return 'PPHX-' + String(i).padStart(6, '0') + '-END'; }

  /**
   * opts.items: [{ type:'image'|'video', ext:'jpeg'|'png'|'gif'|'bmp'|'mp4', w, h,
   *               cover?: 'data:image/png;base64,...', getData: async () => Blob|Buffer }]
   */
  async function build(opts) {
    var PptxGenJS = opts.PptxGenJS, JSZip = opts.JSZip, items = opts.items;
    var onProgress = opts.onProgress || function () {};
    var pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 吋，與原程式相同
    pptx.title = opts.title || '';

    // ── 首頁：樸素淡米色背景（沿用原程式設定）──
    var s0 = pptx.addSlide();
    s0.background = { color: 'F5F0E6' };
    s0.addText(opts.title || '', {
      x: 0.5, y: 2.2, w: SLIDE_W - 1, h: 1.6, fontSize: 44, fontFace: '微軟正黑體',
      color: '503C28', align: 'center', valign: 'middle', isTextBox: true
    });
    if (opts.subtitle) {
      s0.addText(opts.subtitle, {
        x: 0.5, y: 4.0, w: SLIDE_W - 1, h: 1.0, fontSize: 28, fontFace: '微軟正黑體',
        color: '64503C', align: 'center', valign: 'middle', isTextBox: true
      });
    }

    var swaps = {};
    items.forEach(function (it, i) {
      var key = keyOf(i);
      swaps[key] = it;
      var ph = toB64(key);
      var s = pptx.addSlide();
      var box;
      if (it.type === 'video') {
        // 影片：貼滿投影片、等比例，比例不同時補黑邊；按一下播放、不循環
        s.background = { color: '000000' };
        box = fitContain(it.w, it.h, SLIDE_W, SLIDE_H);
        var m = {
          type: 'video', data: 'video/mp4;base64,' + ph, extn: 'mp4',
          x: (SLIDE_W - box.w) / 2, y: (SLIDE_H - box.h) / 2, w: box.w, h: box.h
        };
        if (it.cover) m.cover = it.cover;
        s.addMedia(m);
      } else {
        // 圖片：保留原程式 0.5 吋邊界、等比例置中
        var cw = SLIDE_W - 2 * MARGIN, ch = SLIDE_H - 2 * MARGIN;
        box = fitContain(it.w, it.h, cw, ch);
        s.addImage({
          data: 'image/' + it.ext + ';base64,' + ph,
          x: MARGIN + (cw - box.w) / 2, y: MARGIN + (ch - box.h) / 2, w: box.w, h: box.h
        });
      }
    });

    onProgress({ phase: 'layout' });
    var ab = await pptx.write({ outputType: 'arraybuffer' });
    var zip = await JSZip.loadAsync(ab);
    ab = null;

    var names = Object.keys(zip.files).filter(function (n) { return n.indexOf('ppt/media/') === 0; });
    var total = items.length, done = 0;
    for (var k = 0; k < names.length; k++) {
      var f = zip.file(names[k]);
      if (!f) continue;
      var u8 = await f.async('uint8array');
      if (u8.length > 40) continue;
      var s = String.fromCharCode.apply(null, Array.prototype.slice.call(u8));
      var it = swaps[s];
      if (!it) continue;
      var data = await it.getData();
      zip.file(names[k], data, { compression: 'STORE', binary: true });
      done++;
      onProgress({ phase: 'media', done: done, total: total });
    }
    if (done !== total) throw new Error('媒體寫入數量不符（' + done + '/' + total + '）');

    return zip.generateAsync({
      type: opts.outputType || 'blob', mimeType: PPTX_MIME,
      compression: 'DEFLATE', compressionOptions: { level: 6 }
    }, function (meta) { onProgress({ phase: 'zip', percent: meta.percent }); });
  }

  var api = { build: build, fitContain: fitContain, PPTX_MIME: PPTX_MIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PapaPptBuilder = api;
})(typeof self !== 'undefined' ? self : this);
