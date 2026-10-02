/* Procedural Decor — рисует текстуру декора (камень с жилками) из векторных данных, а не
   из JPEG. Данные (src/decorData.js) получены конвертером tools/texture-convert из изображения
   ЦЕЛОГО листа производителя: жилы со своей толщиной и яркостью + крошечная карта «облаков».
   Текстура строится ОДИН раз под реальные длину и глубину детали (столешницы) — без плитки и
   стыков; за краем листа рисунок продолжается сдвигом на период повтора декора.
   API: window.Modul3D.procDecor.get(code)                    -> spec | null
        window.Modul3D.procDecor.renderPiece(spec, Lmm, Dmm)  -> HTMLCanvasElement */
(function () {
  'use strict';
  var root = window.Modul3D = window.Modul3D || {};

  // Детерминированный генератор (mulberry32) — одна и та же текстура при каждой загрузке.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------------
  // ТОЧНАЯ КОПИЯ ЛИСТА. spec.exact: все жилы настоящего листа лежат в данных на
  // своих местах (без перестановок), фон — крошечная карта «облаков» листа
  // (spec.bg) плюс мелкий шум. Деталь вырезается окном из листа; за краем листа
  // рисунок зеркалится, поэтому жилы непрерывны и склеек нет. Рисуется с шагом
  // ~1 мм/px в любом размере.
  function renderExact(spec, Lmm, Dmm) {
    var sc = Math.min(1.5, 4096 / Lmm);
    var pw = Math.max(64, Math.round(Lmm * sc)), ph = Math.max(64, Math.round(Dmm * sc));
    var c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    var ctx = c.getContext('2d');
    var Wm = spec.tileMM[0], Hm = spec.tileMM[1], k = Wm / spec.w;
    var ex = spec.exposure || 1;
    var ox = spec.ox || 0, oy = Dmm < Hm ? (Hm - Dmm) * (spec.oyK == null ? 0.5 : spec.oyK) : 0;
    var rand = rng((spec.seed || 1) * 31 + Math.round(Lmm));
    // 1. фон: карта облаков листа (мелкая картинка) в базовом цвете
    var gw = spec.bgW, gh = spec.bgH, raw = atob(spec.bg), i;
    var bc = document.createElement('canvas'); bc.width = gw; bc.height = gh;
    var bctx = bc.getContext('2d'), bimg = bctx.createImageData(gw, gh);
    for (i = 0; i < gw * gh; i++) {
      var m = raw.charCodeAt(i) / 128;
      bimg.data[i * 4] = spec.base[0] * ex * m; bimg.data[i * 4 + 1] = spec.base[1] * ex * m;
      bimg.data[i * 4 + 2] = spec.base[2] * ex * m; bimg.data[i * 4 + 3] = 255;
    }
    bctx.putImageData(bimg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // За краем листа рисунок продолжается СДВИГОМ на период повтора декора (spec.period,
    // ~1311 мм — так печатает производитель), по Y (если деталь глубже листа) — зеркалом.
    var P = spec.period || Wm, cMax = Math.max(0, Math.ceil((ox + Lmm - Wm) / P));
    var cy0 = Math.floor(oy / Hm), cy1 = Math.floor((oy + Dmm) / Hm);
    var copies = [], cxI, cyI;
    for (cxI = 0; cxI <= cMax; cxI++) for (cyI = cy0; cyI <= cy1; cyI++) copies.push([cxI, cyI]);
    function setXf(cp) {
      var my = ((cp[1] % 2) + 2) % 2 === 1;
      var x0 = cp[0] * P - ox, y0 = (my ? (cp[1] + 1) * Hm : cp[1] * Hm) - oy;
      ctx.setTransform(sc, 0, 0, (my ? -1 : 1) * sc, x0 * sc, y0 * sc);
    }
    function clipTo(cp) {
      var left = cp[0] === 0 ? -1e6 : Wm + (cp[0] - 1) * P, right = cp[0] === cMax ? 1e6 : Wm + cp[0] * P;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.rect((left - ox) * sc, -1e6, (right - left) * sc, 2e6); ctx.clip();
    }
    copies.forEach(function (cp) {
      ctx.save(); clipTo(cp); setXf(cp);
      ctx.drawImage(bc, 0, 0, Wm, Hm);
      ctx.restore();
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 2. мелкий шум зерна
    var nsx = Math.max(32, Math.round(pw / 2)), nsy = Math.max(32, Math.round(ph / 2));
    var gimg = ctx.createImageData(nsx, nsy), mt = (spec.mott || [0.4, 0.5, 1.0])[2] * ex;
    for (i = 0; i < nsx * nsy; i++) {
      var v = 128 + (rand() - 0.5) * 2 * mt * 8;
      gimg.data[i * 4] = gimg.data[i * 4 + 1] = gimg.data[i * 4 + 2] = v; gimg.data[i * 4 + 3] = 255;
    }
    var gc = document.createElement('canvas'); gc.width = nsx; gc.height = nsy;
    gc.getContext('2d').putImageData(gimg, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.35;
    ctx.drawImage(gc, 0, 0, pw, ph);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // 3. жилы листа
    var t = spec.tint, bl = (spec.base[0] + spec.base[1] + spec.base[2]) / 3, tl = (t[0] + t[1] + t[2]) / 3;
    var gain = (spec.gain || 1) / Math.max(1, tl - bl) * (spec.aK || 1);
    var rgb = Math.round(t[0] * ex) + ',' + Math.round(t[1] * ex) + ',' + Math.round(t[2] * ex) + ',';
    var polys = spec.veins, lwK = spec.lwK || 0.5, glow = spec.glow || 0, p, q;
    ctx.globalCompositeOperation = 'lighten';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    copies.forEach(function (cp) {
      ctx.save(); clipTo(cp); setXf(cp);
      for (p = 0; p < polys.length; p++) {
        var v = polys[p], n = v.length / 4;
        for (q = 0; q < n - 1; q++) {
          var o = q * 4;
          var w = Math.min(3.2, (v[o + 2] + v[o + 6]) / 16 * k * lwK);
          var a = Math.min(1, (v[o + 3] + v[o + 7]) / 2 * gain);
          if (a < 0.02) continue;
          var X0 = v[o] / 4 * k, Y0 = v[o + 1] / 4 * k, X1 = v[o + 4] / 4 * k, Y1 = v[o + 5] / 4 * k;
          if (glow > 0 && a > 0.3) {
            ctx.lineWidth = Math.max(1.4, Math.min(5, w * 2.0)); ctx.strokeStyle = 'rgba(' + rgb + (a * glow * 0.7).toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
          }
          ctx.lineWidth = Math.max(0.8, w); ctx.strokeStyle = 'rgba(' + rgb + a.toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        }
      }
      ctx.restore();
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }

  function renderPiece(spec, Lmm, Dmm) {
    return renderExact(spec, Lmm, Dmm);
  }

  function get(code) {
    var d = root.decorData;
    if (!d || !code) return null;
    return d.byCode[code] || null;
  }

  root.procDecor = { renderPiece: renderPiece, get: get };
})();
