// iPad 指南頁（scripts/generate-guide-ipad-pages.mjs 產生的 /guides/ipad/<lang>）的示範動畫。
// 外部檔是因為 CSP 不開 'unsafe-inline'；頁面用 <script src="/site-ipad-demos.js" defer> 載入。
//
// 跟 public/site-keyword-demos.js 同一套寫法（那支是關鍵字頁的），屬性換成 data-ip-*，兩支不會同頁載入：
//   每個 [data-ip-demo="名稱"] 框裡有一張 <canvas>，名稱對應下面 DEMOS 的一項：
//   layout(w, h, env)     依畫布尺寸（CSS px）算好幾何，尺寸變了才重算；env.top／env.bottom 是上方標籤列、
//                         下方步驟列（或讀數）實際佔掉的高度，翻譯變長換行時畫面自己讓開
//   draw(ctx, g, t, env)  畫第 t 秒（0 ≤ t < period），回傳 { chips: {群組: 索引}, out: {鍵: 數字}, tone: {鍵: 'short'|'wide'} }
// 字一律在 HTML：[data-ip-chip="群組:索引"] 亮起目前那一個、[data-ip-out] 填數字、
// data-ip-l-* 是畫布上要寫的字（App 介面名稱由產生器從 utils/locales 讀進來）。這支檔案不含任何語系文字。
//
// 只在進入畫面時跑，完全離開時倒回開頭；prefers-reduced-motion 停在 still 那一格。
// 圖是示意：手勢、按鍵、數字鍵盤的行為照 App（components/common/NumberPad.tsx、
// ShapeEditorModal 的螢幕按鍵、CanvasContextMenu），數字只是為了畫面好讀。
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var AMBER = '#f59e0b';
  var RED = '#f87171';
  var BOARD = '#181818';
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------- math
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  // Cosine falloff: 1 on the controller, 0 at the edge of its range.
  function falloff(d, r) { return d >= r ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / r); }
  // Up and back: 0 → 1 → 0 over u.
  function bump(u) { return Math.sin(Math.PI * clamp(u, 0, 1)); }

  // steps = [[duration, name], ...] → { i, u, name, at } for time t (`at` = start of the step).
  function phase(t, steps) {
    var acc = 0;
    for (var i = 0; i < steps.length; i++) {
      if (t < acc + steps[i][0] || i === steps.length - 1) {
        return { i: i, u: clamp((t - acc) / steps[i][0], 0, 1), name: steps[i][1], at: acc };
      }
      acc += steps[i][0];
    }
  }
  function span(steps) { var s = 0; for (var i = 0; i < steps.length; i++) s += steps[i][0]; return s; }
  // Start time of the named step.
  function at(steps, name) {
    var acc = 0;
    for (var i = 0; i < steps.length; i++) { if (steps[i][1] === name) return acc; acc += steps[i][0]; }
    return acc;
  }
  // Index of the step called `name` (for "before / after" tests).
  function idx(steps, name) {
    for (var i = 0; i < steps.length; i++) if (steps[i][1] === name) return i;
    return -1;
  }

  // Staggered grid (the app's hexagonal arrangement when sy = sx·√3/2) inside a box.
  function stagger(x0, y0, x1, y1, sx, sy) {
    var pts = [], row = 0;
    for (var y = y0; y <= y1 + 0.01; y += sy, row++) {
      for (var x = x0 + ((row & 1) ? sx / 2 : 0); x <= x1 + 0.01; x += sx) pts.push({ x: x, y: y });
    }
    return pts;
  }

  function segDist(px, py, ax, ay, bx, by) {
    var ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey;
    var h = l ? clamp(((px - ax) * ex + (py - ay) * ey) / l, 0, 1) : 0;
    var dx = px - ax - ex * h, dy = py - ay - ey * h;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Similarity transform {x, y, k, a}: scale k and rotate a about the origin, then move by (x, y).
  function apply(T, px, py) {
    var c = Math.cos(T.a) * T.k, s = Math.sin(T.a) * T.k;
    return [T.x + px * c - py * s, T.y + px * s + py * c];
  }

  // ---------------------------------------------------------------- drawing
  function uiScale(w, h) { return clamp(Math.min(w, h) / 460, 0.72, 1.25); }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function box(ctx, x, y, w, h, r, fill, stroke, lw) {
    ctx.beginPath();
    rr(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  // The canvas board: the app's dashed work area.
  function board(ctx, x, y, w, h, r) {
    ctx.beginPath();
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = BOARD;
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function font(env, size, weight) { return (weight || 400) + ' ' + size.toFixed(1) + 'px ' + env.font; }
  // Text that shrinks (to 70%) and then truncates to fit maxW.
  function label(ctx, env, str, x, y, size, color, opts) {
    opts = opts || {};
    var weight = opts.weight || 400, maxW = opts.maxW || 1e9, sz = size;
    ctx.font = font(env, sz, weight);
    var wid = ctx.measureText(str).width;
    if (wid > maxW) {
      sz = Math.max(size * 0.7, size * maxW / wid);
      ctx.font = font(env, sz, weight);
      wid = ctx.measureText(str).width;
    }
    var out = str;
    if (wid > maxW) {
      while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
      out += '…';
    }
    ctx.fillStyle = color;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.base || 'middle';
    ctx.fillText(out, x, y);
    return ctx.measureText(out).width;
  }
  function textWidth(ctx, env, str, size, weight) {
    ctx.font = font(env, size, weight);
    return ctx.measureText(str).width;
  }

  // A fingertip: the translucent disc iOS screen recordings show. `press` 0..1 squashes it.
  function finger(ctx, x, y, s, alpha, press) {
    if (alpha <= 0) return;
    var r = 15 * s * (1 - 0.14 * (press || 0));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 3 * s;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.stroke();
    ctx.restore();
  }
  // Tap feedback: a ring that grows and fades (u 0..1).
  function ripple(ctx, x, y, s, u) {
    if (u <= 0 || u >= 1) return;
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - u);
    ctx.beginPath();
    ctx.arc(x, y, (10 + 22 * ease(u)) * s, 0, TAU);
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
  // Press-and-hold progress around the finger (u 0..1).
  function holdRing(ctx, x, y, s, u, alpha) {
    if (u <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, TAU);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(u, 0, 1));
    ctx.strokeStyle = AMBER;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Apple Pencil, tip at (x, y), coming in from the lower right (`left`: the lower left,
  // a left hand). `lift` 0 = touching, 1 = hovering.
  function pencil(ctx, x, y, s, alpha, lift, left) {
    if (alpha <= 0) return;
    lift = lift || 0;
    var side = left ? -1 : 1, a = left ? Math.PI - 0.62 : 0.62, L = 190 * s, R = 6.6 * s, cone = 19 * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Body, casting a shadow on the screen that drifts off as the pencil lifts
    // (shadowBlur rather than ctx.filter: older iPad Safari has no canvas filter).
    ctx.translate(x - 3 * s * lift * side, y - 5 * s * lift);
    ctx.rotate(a);
    var g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#ececec');
    g.addColorStop(1, '#c9c9c9');
    ctx.beginPath();
    ctx.moveTo(1.2 * s, -1.4 * s);
    ctx.lineTo(cone, -R);
    ctx.lineTo(L, -R);
    ctx.lineTo(L, R);
    ctx.lineTo(cone, R);
    ctx.lineTo(1.2 * s, 1.4 * s);
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,' + (0.42 - 0.16 * lift).toFixed(3) + ')';
    ctx.shadowBlur = (5 + 8 * lift) * s;
    ctx.shadowOffsetX = (5 + 9 * lift) * s * side;
    ctx.shadowOffsetY = (7 + 12 * lift) * s;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Flat charging side.
    ctx.fillStyle = 'rgba(0,0,0,.06)';
    ctx.fillRect(cone + 40 * s, R * 0.35, L - cone - 40 * s, R * 0.65);
    // The grey nib.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5 * s, -2.4 * s);
    ctx.lineTo(5 * s, 2.4 * s);
    ctx.closePath();
    ctx.fillStyle = '#9ca3af';
    ctx.fill();
    ctx.restore();
  }

  // The app's node handle: amber dot, white ring.
  function node(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath();
    ctx.arc(x, y, 8.5 * s, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5.5 * s, 0, TAU);
    ctx.fillStyle = AMBER;
    ctx.fill();
    ctx.lineWidth = 1.8 * s;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- demos
  var DEMOS = {};

  // ===== Before you start: 768 px. An iPad mini turns from portrait (744 px, phone layout)
  // to landscape (the editor); then Split View halves the window and the divider is dragged
  // until the window is wider than 768 px again.
  var MINI = 1133 / 744;
  var WID = [
    [0.4, 'in'], [1.8, 'portrait'], [1.2, 'rotate'], [1.8, 'land'], [0.9, 'split'], [1.1, 'half'],
    [0.4, 'touch'], [1.5, 'drag'], [1.5, 'wide'], [0.5, 'lift'], [0.8, 'out'],
  ];
  function phoneLayout(ctx, W, H, s) {
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, W, H);
    var u = Math.min(W, H * 0.62), m = u * 0.08;
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, W, u * 0.13);
    box(ctx, m, u * 0.035, u * 0.06, u * 0.06, u * 0.012, AMBER);
    for (var k = 0; k < 3; k++) ctx.fillRect(W - m - u * 0.08, u * (0.045 + k * 0.022), u * 0.08, u * 0.009);
    ctx.fillStyle = '#e5e5e5';
    var y = u * 0.24;
    box(ctx, m, y, (W - 2 * m) * 0.82, u * 0.055, u * 0.01, '#d4d4d4');
    box(ctx, m, y + u * 0.08, (W - 2 * m) * 0.58, u * 0.055, u * 0.01, '#d4d4d4');
    for (var i = 0; i < 3; i++) box(ctx, m, y + u * (0.19 + i * 0.045), (W - 2 * m) * [0.95, 0.9, 0.6][i], u * 0.022, u * 0.008, '#3a3a3a');
    // The send-link card the phone layout offers instead of the editor.
    var cy = y + u * 0.36, ch = u * 0.34;
    box(ctx, m, cy, W - 2 * m, ch, u * 0.03, '#141414', 'rgba(255,255,255,.1)', 1);
    box(ctx, m * 1.8, cy + ch * 0.2, (W - 3.6 * m) * 0.7, u * 0.03, u * 0.01, '#3a3a3a');
    box(ctx, m * 1.8, cy + ch * 0.42, W - 3.6 * m, u * 0.07, u * 0.015, '#0a0a0a', 'rgba(255,255,255,.12)', 1);
    box(ctx, m * 1.8, cy + ch * 0.68, W - 3.6 * m, u * 0.075, u * 0.015, AMBER);
    // Preset thumbnails.
    var ty = cy + ch + u * 0.08, tw = (W - 2 * m - 2 * u * 0.04) / 3;
    for (var j = 0; j < 3; j++) {
      var tx = m + j * (tw + u * 0.04);
      if (ty + tw > H - m * 0.5) break;
      box(ctx, tx, ty, tw, tw, u * 0.02, '#161616');
      ctx.beginPath();
      for (var gx = 0; gx < 4; gx++) for (var gy = 0; gy < 4; gy++) {
        ctx.moveTo(tx + tw * (0.2 + gx * 0.2) + tw * 0.05, ty + tw * (0.2 + gy * 0.2));
        ctx.arc(tx + tw * (0.2 + gx * 0.2), ty + tw * (0.2 + gy * 0.2), tw * 0.05, 0, TAU);
      }
      ctx.fillStyle = ['#a855f7', '#ef4444', AMBER][j];
      ctx.fill();
    }
  }
  function editorLayout(ctx, W, H) {
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, W, H);
    var top = H * 0.08, side = W * 0.19;
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, W, top);
    box(ctx, H * 0.025, top * 0.25, top * 0.5, top * 0.5, top * 0.12, AMBER);
    box(ctx, W - H * 0.025 - W * 0.1, top * 0.22, W * 0.1, top * 0.56, top * 0.14, AMBER);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, top, side, H - top);
    ctx.fillRect(W - side, top, side, H - top);
    ctx.fillStyle = '#262626';
    for (var i = 0; i < 7; i++) {
      var fy = top + H * 0.05 + i * H * 0.115;
      if (fy > H - H * 0.06) break;
      box(ctx, side * 0.1, fy, side * (i % 3 ? 0.8 : 0.5), H * (i % 3 ? 0.045 : 0.028), 2, i % 3 ? '#262626' : '#3a3a3a');
      box(ctx, W - side * 0.9, fy, side * (i % 3 ? 0.8 : 0.5), H * (i % 3 ? 0.045 : 0.028), 2, i % 3 ? '#262626' : '#3a3a3a');
    }
    // The canvas: a dot grid growing toward a point controller.
    var cx0 = side + W * 0.03, cx1 = W - side - W * 0.03, cy0 = top + H * 0.06, cy1 = H - H * 0.06;
    var pitch = (cx1 - cx0) / 11, hx = lerp(cx0, cx1, 0.62), hy = lerp(cy0, cy1, 0.45), R = (cx1 - cx0) * 0.45;
    ctx.beginPath();
    for (var gx = 0; gx <= 11; gx++) for (var gy = 0; gy * pitch <= cy1 - cy0; gy++) {
      var x = cx0 + gx * pitch, y = cy0 + gy * pitch;
      var d = pitch * lerp(0.18, 0.42, falloff(Math.hypot(x - hx, y - hy), R));
      ctx.moveTo(x + d, y);
      ctx.arc(x, y, d, 0, TAU);
    }
    ctx.fillStyle = AMBER;
    ctx.fill();
  }
  // Another app sharing the screen: a Files-like window.
  function otherApp(ctx, W, H) {
    ctx.fillStyle = '#1c1c1e';
    ctx.fillRect(0, 0, W, H);
    var u = Math.min(W, H);
    ctx.fillStyle = '#2c2c2e';
    ctx.fillRect(0, 0, W, H * 0.1);
    box(ctx, u * 0.06, H * 0.14, W * 0.5, H * 0.05, 3, '#3a3a3c');
    var cell = (W - u * 0.12) / 3;
    for (var i = 0; i < 6; i++) {
      var x = u * 0.06 + (i % 3) * cell, y = H * 0.26 + Math.floor(i / 3) * cell * 1.15;
      if (y + cell * 0.7 > H) break;
      box(ctx, x + cell * 0.15, y, cell * 0.6, cell * 0.72, 4, i === 1 ? '#0a84ff' : '#48484a');
    }
  }
  DEMOS['ipad-width'] = {
    period: span(WID),
    still: at(WID, 'wide') + 0.6,
    layout: function (w, h, env) {
      var s = uiScale(w, h);
      // Portrait is the tallest pose: device height 1.07 × sw, then the ruler under it.
      var top = Math.max(env.top, 10) + 10 * s, bottom = h - Math.max(env.bottom, 10) - 8 * s - 26 * s;
      var sw = Math.min(w * 0.74, (bottom - top) / 1.07), sh = sw / MINI, b = sw * 0.035;
      return { w: w, h: h, s: s, cx: w / 2, cy: (top + bottom) / 2, sw: sw, sh: sh, b: b };
    },
    draw: function (ctx, g, t) {
      var ph = phase(t, WID), n = ph.name, u = ph.u, s = g.s;
      var ang = -Math.PI / 2, alpha = 1, contentA = 1, portrait = true, f = 1, splitA = 0;
      var fx = 0, fy = 0, fA = 0, press = 0;
      var I = function (name) { return ph.i >= idx(WID, name); };
      if (n === 'in') alpha = smooth(u);
      if (n === 'rotate') { ang = lerp(-Math.PI / 2, 0, ease(u)); contentA = Math.abs(1 - 2 * u) < 0.6 ? 0 : smooth((Math.abs(1 - 2 * u) - 0.6) / 0.4); portrait = u < 0.5; }
      if (I('land')) { ang = 0; portrait = false; }
      if (n === 'split') { splitA = ease(u); f = lerp(1, 0.5, ease(u)); }
      if (I('half')) { splitA = 1; f = 0.5; }
      if (n === 'drag') f = lerp(0.5, 0.72, ease(u));
      if (I('wide')) f = 0.72;
      if (n === 'out') { alpha = 1 - smooth(u); }
      if (n === 'out' || n === 'lift') { splitA = 1; f = 0.72; }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(g.cx, g.cy);
      ctx.rotate(ang);
      // Device.
      var dw = g.sw + 2 * g.b, dh = g.sh + 2 * g.b;
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 24 * s;
      ctx.shadowOffsetY = 8 * s;
      box(ctx, -dw / 2, -dh / 2, dw, dh, g.b * 1.6, '#1c1c1e');
      ctx.shadowColor = 'transparent';
      box(ctx, -dw / 2, -dh / 2, dw, dh, g.b * 1.6, null, '#2e2e30', 1);
      ctx.beginPath();
      rr(ctx, -g.sw / 2, -g.sh / 2, g.sw, g.sh, g.b * 0.7);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.save();
      ctx.clip();
      // Content stays upright: undo the device rotation.
      ctx.rotate(-ang);
      ctx.globalAlpha = alpha * contentA;
      var W = portrait ? g.sh : g.sw, H = portrait ? g.sw : g.sh;
      if (Math.abs(ang) < 1e-3 || Math.abs(ang + Math.PI / 2) < 1e-3) {
        ctx.translate(-W / 2, -H / 2);
        if (portrait) {
          phoneLayout(ctx, W, H, s);
        } else {
          var gap = W * 0.012, sv = splitA > 0 ? (W - gap) * f : W;
          var px = 1133 * f, wideA = clamp((px - 755) / 26, 0, 1);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, sv, H);
          ctx.clip();
          if (wideA < 1) phoneLayout(ctx, sv, H, s);
          if (wideA > 0) { ctx.globalAlpha = alpha * contentA * wideA; editorLayout(ctx, sv, H); }
          ctx.restore();
          ctx.globalAlpha = alpha * contentA;
          if (splitA > 0) {
            ctx.fillStyle = '#000';
            ctx.fillRect(sv, 0, gap, H);
            ctx.save();
            ctx.translate(sv + gap, 0);
            ctx.beginPath();
            ctx.rect(0, 0, W - sv - gap, H);
            ctx.clip();
            otherApp(ctx, (W - gap) * (1 - f), H);
            ctx.restore();
            // Divider handle.
            box(ctx, sv + gap / 2 - 2 * s, H / 2 - 16 * s, 4 * s, 32 * s, 2 * s, 'rgba(255,255,255,.85)');
            fx = sv + gap / 2 - W / 2;
            fy = 0;
          }
        }
      }
      ctx.restore();
      ctx.restore();

      // Width ruler under the device, over the HueScript window.
      var px2, spanW, left;
      if (portrait) { px2 = 744; spanW = g.sh; left = g.cx - g.sh / 2; }
      else {
        var gapW = g.sw * 0.012;
        spanW = splitA > 0 ? (g.sw - gapW) * f : g.sw;
        px2 = Math.round(1133 * (splitA > 0 ? f : 1));
        left = g.cx - g.sw / 2;
      }
      var wide = px2 >= 768;
      var rulerA = alpha * (n === 'rotate' ? Math.abs(1 - 2 * u) : 1);
      var ry = portrait && n !== 'rotate' ? g.cy + g.sw / 2 + g.b + 14 * s : g.cy + g.sh / 2 + g.b + 14 * s;
      if (n === 'rotate' && u < 0.5) ry = g.cy + g.sw / 2 + g.b + 14 * s;
      if (rulerA > 0.01) {
        ctx.save();
        ctx.globalAlpha = rulerA;
        ctx.strokeStyle = wide ? AMBER : RED;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        ctx.moveTo(left, ry - 6 * s); ctx.lineTo(left, ry + 6 * s);
        ctx.moveTo(left + spanW, ry - 6 * s); ctx.lineTo(left + spanW, ry + 6 * s);
        ctx.moveTo(left + 2 * s, ry); ctx.lineTo(left + spanW - 2 * s, ry);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(left + 1 * s, ry); ctx.lineTo(left + 8 * s, ry - 4 * s); ctx.lineTo(left + 8 * s, ry + 4 * s); ctx.closePath();
        ctx.moveTo(left + spanW - 1 * s, ry); ctx.lineTo(left + spanW - 8 * s, ry - 4 * s); ctx.lineTo(left + spanW - 8 * s, ry + 4 * s); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // The finger on the Split View divider.
      if (n === 'touch' || n === 'drag' || n === 'wide' || n === 'lift') {
        fA = n === 'touch' ? smooth(u * 2) : n === 'lift' ? 1 - smooth(u) : 1;
        press = n === 'touch' ? smooth((u - 0.5) * 2) : n === 'lift' ? 1 - smooth(u) : 1;
        finger(ctx, g.cx + fx, g.cy + fy + 44 * s, s, fA * alpha, press);
      }
      return {
        chips: { c: wide && !(n === 'rotate' && u < 0.5) && !(portrait) ? 1 : 0 },
        out: { width: px2 },
        tone: { width: wide ? 'wide' : 'short' },
      };
    },
  };

  // ===== Touch basics: press and hold opens the menu, Scale follows the finger; then a
  // second finger turns and stretches the line controller. The holes near the line grow.
  var TCH = [
    [0.5, 'idle'], [0.6, 'approach'], [0.6, 'hold'], [0.25, 'menu'], [0.5, 'toScale'], [0.3, 'press'],
    [1.6, 'scale'], [0.5, 'release'], [0.5, 'approach2'], [0.5, 'drag1'], [0.3, 'second'], [2.0, 'twist'],
    [0.5, 'release2'], [1.2, 'hold2'], [1.0, 'reset'],
  ];
  DEMOS['ipad-touch'] = {
    period: span(TCH),
    still: at(TCH, 'menu') + 0.2,
    layout: function (w, h, env) {
      var s = uiScale(w, h), m = w * 0.05;
      var p = w / 14;
      var pts = stagger(m + p * 0.5, Math.max(h * 0.14, env.top + p * 0.6), w - m - p * 0.5, h - m - p * 0.3, p, p * 0.866);
      // Base line controller, in coordinates about its centre.
      var C0 = { x: w * 0.48, y: h * 0.56 }, half = w * 0.2, a0 = -0.42;
      return {
        w: w, h: h, s: s, m: m, p: p, pts: pts, C0: C0,
        A: [-half * Math.cos(a0), -half * Math.sin(a0)], B: [half * Math.cos(a0), half * Math.sin(a0)],
        R: w * 0.2, top: Math.max(h * 0.12, env.top + 6 * s), items: ['add', 'fillet', '-', 'scale', 'rotate', '-', 'del'].map(function (k) { return k === '-' ? null : k; }),
      };
    },
    draw: function (ctx, g, t, env) {
      var ph = phase(t, TCH), n = ph.name, u = ph.u, s = g.s;
      var I = function (name) { return ph.i >= idx(TCH, name); };
      var base = { x: g.C0.x, y: g.C0.y, k: 1, a: 0 };
      // Scale via the menu: k 1 → 1.4.
      var k1 = 1.4;
      var T = { x: base.x, y: base.y, k: 1, a: 0 };
      if (n === 'scale') T.k = lerp(1, k1, ease(u));
      if (I('release')) T.k = k1;
      // One finger moves the line, the second turns and stretches it about the fingers.
      var move = [g.w * 0.03, -g.h * 0.03];
      var twistA = 0.75, twistK = 1.12;
      if (n === 'drag1') { T.x += move[0] * ease(u); T.y += move[1] * ease(u); }
      if (I('second')) { T.x += move[0]; T.y += move[1]; }
      // The two fingers: F1 on the line near A, F2 near B; they rotate about their midpoint.
      var F1b = apply({ x: base.x + move[0], y: base.y + move[1], k: k1, a: 0 }, g.A[0] * 0.55, g.A[1] * 0.55);
      var F2b = apply({ x: base.x + move[0], y: base.y + move[1], k: k1, a: 0 }, g.B[0] * 0.6, g.B[1] * 0.6);
      var M = [(F1b[0] + F2b[0]) / 2, (F1b[1] + F2b[1]) / 2];
      var tw = n === 'twist' ? ease(u) : I('release2') ? 1 : 0;
      var ang = twistA * tw, sc = lerp(1, twistK, tw);
      function turn(P) {
        var dx = (P[0] - M[0]) * sc, dy = (P[1] - M[1]) * sc, c = Math.cos(ang), sn = Math.sin(ang);
        return [M[0] + dx * c - dy * sn, M[1] + dx * sn + dy * c];
      }
      if (tw > 0) {
        // The same similarity maps the whole line: rotate/scale about M.
        var cN = turn([T.x, T.y]);
        T.x = cN[0]; T.y = cN[1]; T.k *= sc; T.a += ang;
      }
      if (n === 'reset') {
        var r = ease(u), full = { x: g.C0.x + move[0], y: g.C0.y + move[1], k: k1, a: 0 };
        var cF = (function () { var dx = (full.x - M[0]) * twistK, dy = (full.y - M[1]) * twistK, c = Math.cos(twistA), sn = Math.sin(twistA); return [M[0] + dx * c - dy * sn, M[1] + dx * sn + dy * c]; })();
        T = { x: lerp(cF[0], base.x, r), y: lerp(cF[1], base.y, r), k: lerp(k1 * twistK, 1, r), a: lerp(twistA, 0, r) };
      }
      var A = apply(T, g.A[0], g.A[1]), B = apply(T, g.B[0], g.B[1]);

      // Pattern: hole size follows the distance to the line.
      ctx.fillStyle = '#0f0f0f';
      ctx.fillRect(0, 0, g.w, g.h);
      ctx.beginPath();
      var d0 = g.p * 0.2, d1 = g.p * 0.84;
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i], d = lerp(d0, d1, falloff(segDist(q.x, q.y, A[0], A[1], B[0], B[1]), g.R));
        ctx.moveTo(q.x + d / 2, q.y);
        ctx.arc(q.x, q.y, d / 2, 0, TAU);
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      // Range band and the line itself.
      ctx.save();
      ctx.translate(A[0], A[1]);
      var la = Math.atan2(B[1] - A[1], B[0] - A[0]), len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      ctx.rotate(la);
      ctx.beginPath();
      ctx.arc(0, 0, g.R, Math.PI / 2, Math.PI * 1.5);
      ctx.lineTo(len, -g.R);
      ctx.arc(len, 0, g.R, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(245,158,11,.4)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
      ctx.lineCap = 'round';
      ctx.lineWidth = 6 * s;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.stroke();
      ctx.lineWidth = 2.2 * s;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      node(ctx, A[0], A[1], s);
      node(ctx, B[0], B[1], s);

      // Press point on the line (40% from A) and the menu beside it.
      var P = [lerp(A[0], B[0], 0.4), lerp(A[1], B[1], 0.4)];
      var chip = I('approach2') ? 1 : 0;
      var fA = 0, fx = P[0], fy = P[1], press = 0;
      var start = [g.w * 0.86, g.h * 0.88];
      // Menu geometry (fixed to where the hold happened, i.e. the base line).
      var Pb = [lerp(g.C0.x + g.A[0], g.C0.x + g.B[0], 0.4), lerp(g.C0.y + g.A[1], g.C0.y + g.B[1], 0.4)];
      var fs = 12 * s, ih = 26 * s, pad = 10 * s, ic = 16 * s, mw = 0;
      g.items.forEach(function (k) { if (k) mw = Math.max(mw, textWidth(ctx, env, env.labels[k] || '', fs, 400)); });
      mw = Math.min(mw + pad * 2 + ic + 8 * s, g.w * 0.46);
      var mh = 0;
      g.items.forEach(function (k) { mh += k ? ih : 9 * s; });
      mh += 8 * s;
      var mx = Pb[0] + 26 * s, my = clamp(Pb[1] - mh * 0.35, g.top, g.h - mh - 10 * s);
      if (mx + mw > g.w - 10 * s) mx = Pb[0] - 26 * s - mw;
      var rowY = {}, yy = my + 4 * s;
      g.items.forEach(function (k, j) { if (k) { rowY[k] = yy; yy += ih; } else yy += 9 * s; });
      var scaleRow = [mx + pad + ic / 2 + 30 * s, rowY.scale + ih / 2];

      var menuA = 0, menuK = 1, hi = null;
      if (n === 'menu') { menuA = smooth(u * 1.5); menuK = lerp(0.92, 1, ease(u)); }
      if (n === 'toScale' || n === 'press') menuA = 1;
      if (n === 'press') hi = 'scale';
      if (n === 'scale') { menuA = 1 - smooth(u * 5); hi = 'scale'; }

      if (n === 'idle') { fA = 0; }
      if (n === 'approach') { fA = smooth(u * 2); fx = lerp(start[0], Pb[0], ease(u)); fy = lerp(start[1], Pb[1], ease(u)); }
      if (n === 'hold' || n === 'menu') { fA = 1; fx = Pb[0]; fy = Pb[1]; press = 1; }
      if (n === 'toScale') { fA = 1; press = 1 - smooth(u * 3); fx = lerp(Pb[0], scaleRow[0], ease(u)); fy = lerp(Pb[1], scaleRow[1], ease(u)); }
      if (n === 'press') { fA = 1; press = smooth(u * 2); fx = scaleRow[0]; fy = scaleRow[1]; }
      var C = [T.x, T.y];
      if (n === 'scale' || n === 'release') {
        // Drag away from the centre: the stretch follows the finger's distance.
        var dir = [scaleRow[0] - g.C0.x, scaleRow[1] - g.C0.y], dl = Math.hypot(dir[0], dir[1]) || 1;
        var k = n === 'scale' ? lerp(1, k1, ease(u)) : k1;
        fx = g.C0.x + dir[0] * k; fy = g.C0.y + dir[1] * k;
        fA = n === 'release' ? 1 - smooth(u * 1.6) : 1;
        press = n === 'release' ? 1 - smooth(u * 2) : 1;
        if (n === 'scale') {
          ctx.save();
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1.2 * s;
          ctx.strokeStyle = 'rgba(255,255,255,.45)';
          ctx.beginPath();
          ctx.moveTo(g.C0.x, g.C0.y);
          ctx.lineTo(fx, fy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(g.C0.x, g.C0.y, 3 * s, 0, TAU);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.restore();
        }
      }
      // Hold ring while pressing.
      if (n === 'hold') holdRing(ctx, fx, fy, s, u / 0.85, 1);
      if (n === 'menu') holdRing(ctx, fx, fy, s, 1, 1 - smooth(u * 2));

      // Menu.
      if (menuA > 0.01) {
        ctx.save();
        ctx.globalAlpha = menuA;
        ctx.translate(mx, my);
        ctx.scale(menuK, menuK);
        ctx.translate(-mx, -my);
        ctx.shadowColor = 'rgba(0,0,0,.7)';
        ctx.shadowBlur = 18 * s;
        ctx.shadowOffsetY = 6 * s;
        box(ctx, mx, my, mw, mh, 6 * s, '#1f1f1f');
        ctx.shadowColor = 'transparent';
        box(ctx, mx, my, mw, mh, 6 * s, null, '#3a3a3a', 1);
        var y2 = my + 4 * s;
        g.items.forEach(function (key) {
          if (!key) {
            ctx.fillStyle = '#333';
            ctx.fillRect(mx + 1, y2 + 4 * s, mw - 2, 1);
            y2 += 9 * s;
            return;
          }
          if (hi === key) box(ctx, mx + 3 * s, y2, mw - 6 * s, ih, 4 * s, '#333');
          var ix = mx + pad + ic / 2, iy = y2 + ih / 2;
          ctx.strokeStyle = AMBER;
          ctx.fillStyle = AMBER;
          ctx.lineWidth = 1.5 * s;
          ctx.lineCap = 'round';
          ctx.beginPath();
          var r6 = 5.5 * s;
          if (key === 'add') { ctx.arc(ix, iy, r6, 0, TAU); ctx.moveTo(ix - 3 * s, iy); ctx.lineTo(ix + 3 * s, iy); ctx.moveTo(ix, iy - 3 * s); ctx.lineTo(ix, iy + 3 * s); }
          if (key === 'fillet') { ctx.moveTo(ix - r6, iy + r6); ctx.lineTo(ix - r6, iy); ctx.arcTo(ix - r6, iy - r6, ix, iy - r6, r6); ctx.lineTo(ix + r6, iy - r6); }
          if (key === 'scale') { ctx.moveTo(ix - r6, iy - 1 * s); ctx.lineTo(ix - r6, iy - r6); ctx.lineTo(ix - 1 * s, iy - r6); ctx.moveTo(ix + r6, iy + 1 * s); ctx.lineTo(ix + r6, iy + r6); ctx.lineTo(ix + 1 * s, iy + r6); ctx.moveTo(ix - r6, iy - r6); ctx.lineTo(ix + r6, iy + r6); }
          if (key === 'rotate') { ctx.arc(ix, iy, r6, -Math.PI * 0.35, Math.PI * 1.35); ctx.moveTo(ix + r6 * 0.45, iy - r6 * 1.05); ctx.lineTo(ix + r6 * 0.95, iy - r6 * 0.7); ctx.lineTo(ix + r6 * 0.5, iy - r6 * 0.25); }
          if (key === 'del') { ctx.rect(ix - r6 * 0.7, iy - r6 * 0.55, r6 * 1.4, r6 * 1.55); ctx.moveTo(ix - r6, iy - r6 * 0.55); ctx.lineTo(ix + r6, iy - r6 * 0.55); ctx.moveTo(ix - r6 * 0.3, iy - r6); ctx.lineTo(ix + r6 * 0.3, iy - r6); }
          ctx.stroke();
          label(ctx, env, env.labels[key] || '', mx + pad + ic + 8 * s, iy, fs, hi === key ? '#fff' : '#e5e5e5', { maxW: mw - pad * 2 - ic - 8 * s });
          y2 += ih;
        });
        ctx.restore();
      }

      // Two-finger part.
      var F1 = null, F2 = null, f1A = 0, f2A = 0, p1 = 0, p2 = 0;
      if (n === 'approach2') { f1A = smooth(u * 2); F1 = [lerp(start[0], F1b[0] - move[0], ease(u)), lerp(start[1], F1b[1] - move[1], ease(u))]; }
      if (n === 'drag1') { f1A = 1; p1 = 1; F1 = [F1b[0] - move[0] * (1 - ease(u)), F1b[1] - move[1] * (1 - ease(u))]; }
      if (n === 'second') { f1A = 1; p1 = 1; F1 = F1b; f2A = smooth(u * 2); p2 = smooth(u); F2 = F2b; }
      if (n === 'twist') { f1A = f2A = 1; p1 = p2 = 1; F1 = turn(F1b); F2 = turn(F2b); }
      if (n === 'release2') { f1A = f2A = 1 - smooth(u * 1.4); p1 = p2 = 1 - smooth(u * 2); F1 = turn(F1b); F2 = turn(F2b); }
      if (F1) finger(ctx, F1[0], F1[1], s, f1A, p1);
      if (F2) finger(ctx, F2[0], F2[1], s, f2A, p2);
      if (n === 'second') ripple(ctx, F2b[0], F2b[1], s, u);

      if (!F1 && fA > 0) finger(ctx, fx, fy, s, fA, press);
      if (n === 'press') ripple(ctx, fx, fy, s, u);
      return { chips: { c: chip } };
    },
  };

  // ===== Number fields: the Pencil slides Width, then X Spacing; a tap on Height opens the
  // number pad (NumberPad.tsx: digits, ⌫, ±, ✓), typed 6 and applied; a finger scrolls the panel.
  var FLD = [
    [0.5, 'in'], [2.2, 'slideW'], [0.45, 'toXs'], [1.8, 'slideXs'], [0.45, 'toH'], [0.3, 'tapH'], [0.5, 'pad'],
    [0.3, 'to6'], [0.3, 'tap6'], [0.35, 'toOk'], [0.3, 'tapOk'], [0.6, 'out'], [0.4, 'fingerIn'],
    [1.2, 'scroll'], [0.5, 'fingerOut'], [0.9, 'hold'], [1.0, 'reset'],
  ];
  var FIELDS = ['xs', 'zs', 'w', 'h', 'cr', 'rot'];
  var DEF = { xs: 14, zs: 8, w: 9, h: 4, cr: 2, rot: 0 };
  DEMOS['ipad-fields'] = {
    period: span(FLD),
    still: at(FLD, 'pad') + 0.3,
    layout: function (w, h, env) {
      var s = uiScale(w, h);
      var top = Math.max(h * 0.15, env.top + 10 * s), bot = h * 0.95;
      var bx = w * 0.05, bw = w * 0.52, px = w * 0.61, pw = w * 0.34;
      var blk = clamp((bot - top) / 5.2, 50, 92);
      var rows = {};
      FIELDS.forEach(function (k, i) { rows[k] = 12 * s + i * blk; });
      var content = 12 * s + FIELDS.length * blk + 6 * s;
      return {
        w: w, h: h, s: s, top: top, bot: bot, bx: bx, bw: bw, px: px, pw: pw, blk: blk, rows: rows,
        maxScroll: Math.max(0, content - (bot - top)),
      };
    },
    draw: function (ctx, g, t, env) {
      var ph = phase(t, FLD), n = ph.name, u = ph.u, s = g.s;
      var I = function (name) { return ph.i >= idx(FLD, name); };
      var v = { xs: DEF.xs, zs: DEF.zs, w: DEF.w, h: DEF.h, cr: DEF.cr, rot: DEF.rot };
      // Width: 9 → 15 → 6.5; X spacing: 14 → 19 → 12; Height 4 → 6 after the pad.
      function wAt(x) { return x < 0.45 ? lerp(9, 15, ease(x / 0.45)) : lerp(15, 6.5, ease((x - 0.45) / 0.55)); }
      function xsAt(x) { return x < 0.45 ? lerp(14, 19, ease(x / 0.45)) : lerp(19, 12, ease((x - 0.45) / 0.55)); }
      if (n === 'slideW') v.w = wAt(u);
      if (I('toXs')) v.w = 6.5;
      if (n === 'slideXs') v.xs = xsAt(u);
      if (I('toH')) v.xs = 12;
      if (n === 'tapOk') v.h = lerp(4, 6, ease(u));
      if (I('out')) v.h = 6;
      var scroll = 0;
      if (n === 'scroll') scroll = g.maxScroll * ease(u);
      if (I('fingerOut')) scroll = g.maxScroll;
      if (n === 'reset') {
        var r = ease(u);
        v.w = lerp(6.5, DEF.w, r); v.xs = lerp(12, DEF.xs, r); v.h = lerp(6, DEF.h, r);
        scroll = g.maxScroll * (1 - r);
      }

      ctx.fillStyle = '#0f0f0f';
      ctx.fillRect(0, 0, g.w, g.h);

      // Pattern board: staggered slots from the field values (mm → px).
      var by = g.top, bh = g.bot - g.top;
      board(ctx, g.bx, by, g.bw, bh, 6 * s);
      ctx.save();
      ctx.beginPath();
      rr(ctx, g.bx + 1, by + 1, g.bw - 2, bh - 2, 6 * s);
      ctx.clip();
      var k = g.bw / 64, sx = v.xs * k, sz = v.zs * k, sw = v.w * k, sh = v.h * k, cr = Math.min(v.cr * k, sh / 2);
      var cx = g.bx + g.bw / 2, cy = by + bh / 2;
      ctx.beginPath();
      var rows = Math.ceil(bh / 2 / sz) + 1, cols = Math.ceil(g.bw / 2 / sx) + 1;
      for (var j = -rows; j <= rows; j++) {
        var off = (j & 1) ? sx / 2 : 0;
        for (var i = -cols - 1; i <= cols; i++) {
          var x = cx + i * sx + off, y = cy + j * sz;
          if (x < g.bx + sw / 2 + 4 * s || x > g.bx + g.bw - sw / 2 - 4 * s || y < by + sh / 2 + 4 * s || y > by + bh - sh / 2 - 4 * s) continue;
          rr(ctx, x - sw / 2, y - sh / 2, sw, sh, cr);
        }
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      ctx.restore();

      // Panel with fields, scrolled.
      var ph2 = g.bot - g.top;
      box(ctx, g.px, g.top, g.pw, ph2, 8 * s, '#151515', '#262626', 1);
      ctx.save();
      ctx.beginPath();
      rr(ctx, g.px + 1, g.top + 1, g.pw - 2, ph2 - 2, 8 * s);
      ctx.clip();
      var active = n === 'slideW' ? 'w' : n === 'slideXs' ? 'xs' : (I('tapH') && !I('out')) ? 'h' : null;
      var boxH = Math.min(28 * s, g.blk * 0.44), fs = 11.5 * s;
      var fieldAt = {};
      FIELDS.forEach(function (key) {
        var ry = g.top + g.rows[key] - scroll;
        var lx = g.px + 10 * s, bw2 = g.pw - 20 * s, by2 = ry + g.blk * 0.36;
        fieldAt[key] = { x: lx, y: by2, w: bw2, h: boxH };
        label(ctx, env, env.labels[key] || '', lx, ry + g.blk * 0.2, fs, '#9ca3af', { maxW: bw2 });
        box(ctx, lx, by2, bw2, boxH, 5 * s, '#1f1f1f', active === key ? 'rgba(245,158,11,.85)' : '#2e2e2e', active === key ? 1.5 * s : 1);
        var val = v[key], txt = key === 'rot' ? String(Math.round(val)) : (Math.round(val * 10) / 10).toFixed(val % 1 ? 1 : 0);
        if (key === 'h' && I('tap6') && !I('tapOk')) txt = '4';
        label(ctx, env, txt, lx + bw2 - 9 * s, by2 + boxH / 2, 13 * s, '#fff', { align: 'right', weight: 500 });
      });
      ctx.restore();

      // Number pad beside Height (to its left: no room on the right).
      var padA = 0;
      if (n === 'tapH') padA = smooth((u - 0.6) / 0.4);
      if (I('pad') && !I('out')) padA = 1;
      if (n === 'tapOk') padA = 1 - smooth((u - 0.3) / 0.5);
      if (n === 'out') padA = 0;
      var H = fieldAt.h, padW = Math.min(g.w * 0.42, 196 * s * 0.92), key = (padW - 16 * s - 3 * 4 * s) / 4;
      var keyH = key * 0.78, padH = 8 * s + 30 * s + 14 * s + 4 * keyH + 3 * 4 * s + 8 * s;
      var padX = H.x - 8 * s - padW, padY = clamp(H.y + H.h / 2 - padH / 2, g.top, g.bot - padH);
      var keys = {};
      var gx0 = padX + 8 * s, gy0 = padY + 8 * s + 30 * s + 14 * s;
      function kpos(c, r2, cw, rh) { return { x: gx0 + c * (key + 4 * s), y: gy0 + r2 * (keyH + 4 * s), w: key * (cw || 1) + 4 * s * ((cw || 1) - 1), h: keyH * (rh || 1) + 4 * s * ((rh || 1) - 1) }; }
      keys['6'] = kpos(2, 1);
      keys.ok = kpos(3, 2, 1, 2);
      if (padA > 0.01) {
        ctx.save();
        ctx.globalAlpha = padA;
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 20 * s;
        ctx.shadowOffsetY = 6 * s;
        box(ctx, padX, padY, padW, padH, 5 * s, '#161616');
        ctx.shadowColor = 'transparent';
        box(ctx, padX, padY, padW, padH, 5 * s, null, '#3a3a3a', 1);
        // Display: the field's value, selected until the first key.
        var dx = padX + 8 * s, dy = padY + 8 * s, dw = padW - 16 * s - 34 * s;
        box(ctx, dx, dy, dw, 30 * s, 4 * s, '#0a0a0a', 'rgba(245,158,11,.6)', 1);
        var typed = I('tap6') && !(n === 'tap6' && u < 0.3);
        var shown = typed ? '6' : '4';
        var tw = textWidth(ctx, env, shown, 16 * s, 500);
        if (!typed) box(ctx, dx + dw - 8 * s - tw - 3 * s, dy + 6 * s, tw + 6 * s, 18 * s, 2 * s, 'rgba(245,158,11,.3)');
        label(ctx, env, shown, dx + dw - 8 * s, dy + 15 * s, 16 * s, '#f5f5f5', { align: 'right', weight: 500 });
        label(ctx, env, '×', padX + padW - 8 * s - 15 * s, dy + 15 * s, 17 * s, '#9ca3af', { align: 'center' });
        var grid = [['7', '8', '9', '⌫'], ['4', '5', '6', '±'], ['1', '2', '3', null], [null, null, '.', null]];
        for (var r3 = 0; r3 < 4; r3++) for (var c3 = 0; c3 < 4; c3++) {
          var ch = grid[r3][c3];
          if (!ch) continue;
          var kp = kpos(c3, r3), lit = ch === '6' && n === 'tap6';
          box(ctx, kp.x, kp.y, kp.w, kp.h, 3 * s, lit ? '#3a3a3a' : '#262626');
          label(ctx, env, ch, kp.x + kp.w / 2, kp.y + kp.h / 2, 15 * s, '#e5e5e5', { align: 'center' });
        }
        var zero = kpos(0, 3, 2);
        box(ctx, zero.x, zero.y, zero.w, zero.h, 3 * s, '#262626');
        label(ctx, env, '0', zero.x + zero.w / 2, zero.y + zero.h / 2, 15 * s, '#e5e5e5', { align: 'center' });
        var ok = keys.ok;
        box(ctx, ok.x, ok.y, ok.w, ok.h, 3 * s, n === 'tapOk' && u < 0.4 ? '#fbbf24' : AMBER);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2 * s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ok.x + ok.w * 0.3, ok.y + ok.h * 0.52);
        ctx.lineTo(ok.x + ok.w * 0.45, ok.y + ok.h * 0.6);
        ctx.lineTo(ok.x + ok.w * 0.72, ok.y + ok.h * 0.4);
        ctx.stroke();
        ctx.restore();
      }

      // Pencil and finger.
      var W = fieldAt.w, X = fieldAt.xs, pxw = 5.2 * s;
      var hover = [g.w * 0.98, g.h * 0.7];
      var penA = 0, pen = hover, lift = 1, tap = -1;
      var cW = [W.x + W.w * 0.5, W.y + W.h / 2], cX = [X.x + X.w * 0.5, X.y + X.h / 2], cH = [H.x + H.w * 0.5, H.y + H.h / 2];
      var k6 = [keys['6'].x + keys['6'].w / 2, keys['6'].y + keys['6'].h / 2], kOk = [keys.ok.x + keys.ok.w / 2, keys.ok.y + keys.ok.h * 0.55];
      if (n === 'in') { penA = smooth(u * 2); pen = [lerp(hover[0], cW[0], ease(u)), lerp(hover[1], cW[1], ease(u))]; lift = 1 - ease(u); }
      if (n === 'slideW') { penA = 1; lift = 0; pen = [cW[0] + (v.w - 9) * pxw, cW[1]]; }
      if (n === 'toXs') { penA = 1; lift = bump(u); var e1 = [cW[0] + (6.5 - 9) * pxw, cW[1]]; pen = [lerp(e1[0], cX[0], ease(u)), lerp(e1[1], cX[1], ease(u))]; }
      if (n === 'slideXs') { penA = 1; lift = 0; pen = [cX[0] + (v.xs - 14) * pxw, cX[1]]; }
      if (n === 'toH') { penA = 1; lift = bump(u); var e2 = [cX[0] + (12 - 14) * pxw, cX[1]]; pen = [lerp(e2[0], cH[0], ease(u)), lerp(e2[1], cH[1], ease(u))]; }
      if (n === 'tapH') { penA = 1; pen = cH; lift = u < 0.5 ? 0 : smooth((u - 0.5) * 2) * 0.6; tap = u; }
      if (n === 'pad') { penA = 1; pen = cH; lift = 0.6; }
      if (n === 'to6') { penA = 1; lift = 0.6; pen = [lerp(cH[0], k6[0], ease(u)), lerp(cH[1], k6[1], ease(u))]; }
      if (n === 'tap6') { penA = 1; pen = k6; lift = u < 0.4 ? 0 : 0.6 * smooth((u - 0.4) / 0.6); tap = u; }
      if (n === 'toOk') { penA = 1; lift = 0.6; pen = [lerp(k6[0], kOk[0], ease(u)), lerp(k6[1], kOk[1], ease(u))]; }
      if (n === 'tapOk') { penA = 1; pen = kOk; lift = u < 0.4 ? 0 : 0.8 * smooth((u - 0.4) / 0.6); tap = u; }
      if (n === 'out') { penA = 1 - smooth(u); lift = 1; pen = [lerp(kOk[0], hover[0], ease(u)), lerp(kOk[1], hover[1] + g.h * 0.1, ease(u))]; }
      if (tap >= 0) ripple(ctx, pen[0], pen[1], s * 0.8, tap);
      pencil(ctx, pen[0], pen[1], s, penA, lift);

      // A finger swipes the panel up.
      var fx = g.px + g.pw * 0.55, fy0 = g.bot - g.h * 0.12, fA = 0, fy = fy0, press = 0;
      if (n === 'fingerIn') { fA = smooth(u * 2); press = smooth(u); }
      if (n === 'scroll') { fA = 1; press = 1; fy = fy0 - g.maxScroll * ease(u); }
      if (n === 'fingerOut') { fA = 1 - smooth(u * 1.5); press = 1 - smooth(u * 2); fy = fy0 - g.maxScroll; }
      if (fA > 0) finger(ctx, fx, fy, s, fA, press);

      var chip = I('fingerIn') ? 2 : I('toH') ? 1 : 0;
      if (n === 'reset') chip = 2;
      return { chips: { c: chip } };
    },
  };

  // ===== Custom editor: the on-screen keys (ShapeEditorModal). The Pencil is in the left hand
  // and the keys sit under the right one: a finger taps Shift to latch it and the Pencil scales
  // a shape in proportion; Alt latched, the Pencil drags out a copy; Delete removes it; the top
  // button moves the keys to the other side (for a right-handed Pencil).
  var KEY = [
    [0.4, 'in'], [0.3, 'tapShift'], [0.5, 'penIn'], [1.8, 'scale'], [0.4, 'penUp'], [0.3, 'tapShift2'],
    [0.4, 'toAlt'], [0.3, 'tapAlt'], [0.5, 'penToShape'], [1.6, 'dup'], [0.4, 'penUp2'], [0.3, 'tapAlt2'],
    [0.4, 'toDel'], [0.3, 'tapDel'], [0.5, 'deleted'], [0.4, 'toSwap'], [0.3, 'tapSwap'], [0.7, 'swap'],
    [1.2, 'hold'], [0.9, 'back'],
  ];
  DEMOS['ipad-keys'] = {
    period: span(KEY),
    still: at(KEY, 'dup') + 1.2,
    layout: function (w, h, env) {
      var s = uiScale(w, h);
      return { w: w, h: h, s: s, top: h * 0.05, bot: Math.min(h * 0.8, h - env.bottom - 12 * s) };
    },
    draw: function (ctx, g, t, env) {
      var ph = phase(t, KEY), n = ph.name, u = ph.u, s = g.s, w = g.w;
      var I = function (name) { return ph.i >= idx(KEY, name); };
      // Keys side: 0 = right, 1 = left.
      var side = 0;
      if (n === 'swap') side = ease(u);
      if (I('hold')) side = 1;
      if (n === 'back') side = 1 - ease(u);
      var margin = w * 0.19;
      var ex = lerp(w * 0.04, margin, side), ew = w - margin - w * 0.04, ey = g.top, eh = g.bot - g.top;
      var kx = lerp(w - margin / 2, margin / 2, side);

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, g.h);
      // Editor window: toolbar and a dotted grid.
      box(ctx, ex, ey, ew, eh, 8 * s, '#161616', '#2e2e2e', 1);
      ctx.save();
      ctx.beginPath();
      rr(ctx, ex + 1, ey + 1, ew - 2, eh - 2, 8 * s);
      ctx.clip();
      var tb = 30 * s;
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(ex, ey, ew, tb);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(ex, ey + tb, ew, 1);
      for (var ti = 0; ti < 6; ti++) {
        var tx = ex + 10 * s + ti * 24 * s;
        box(ctx, tx, ey + 6 * s, 18 * s, 18 * s, 4 * s, ti === 0 ? '#3a3a3a' : null, ti === 0 ? null : '#333', 1);
      }
      ctx.beginPath();
      var step = 18 * s;
      for (var gx = ex + step / 2; gx < ex + ew; gx += step) for (var gy = ey + tb + step / 2; gy < ey + eh; gy += step) {
        ctx.moveTo(gx + 1.1 * s, gy);
        ctx.arc(gx, gy, 1.1 * s, 0, TAU);
      }
      ctx.fillStyle = '#2c2c2c';
      ctx.fill();

      // Shapes: the original (scaled with Shift) and the Alt copy.
      var base = 0.2 * w, cxS = ex + ew * 0.36, cyS = ey + tb + (eh - tb) * 0.46;
      var k = 1, kMax = 1.4;
      if (n === 'scale') k = lerp(1, kMax, ease(u));
      if (I('penUp')) k = kMax;
      if (n === 'back') k = lerp(kMax, 1, ease(u));
      // Scaling anchors the top-left corner.
      var x0 = cxS - base / 2, y0 = cyS - base / 2, sz = base * k;
      var dupOff = [ew * 0.36, (eh - tb) * 0.16];
      var copyA = 0, copyT = 0, copyK = 1;
      if (n === 'dup') { copyA = 1; copyT = ease(u); }
      if (I('penUp2')) { copyA = 1; copyT = 1; }
      if (n === 'tapDel') { copyK = 1 - 0.3 * ease(u); copyA = 1 - smooth(u); }
      if (I('deleted')) copyA = 0;
      function shape(x, y, size, alpha, selected) {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        box(ctx, x, y, size, size, size * 0.24, 'rgba(245,158,11,.9)');
        if (selected) {
          ctx.strokeStyle = 'rgba(255,255,255,.9)';
          ctx.lineWidth = 1 * s;
          ctx.strokeRect(x - 4 * s, y - 4 * s, size + 8 * s, size + 8 * s);
          var hs = 6 * s;
          [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]].forEach(function (c) {
            var hx = x - 4 * s + c[0] * (size + 8 * s), hy = y - 4 * s + c[1] * (size + 8 * s);
            ctx.fillStyle = '#fff';
            ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
            ctx.strokeStyle = '#111';
            ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
          });
        }
        ctx.restore();
      }
      var copySelected = copyA > 0;
      shape(x0, y0, sz, 1, !copySelected || n === 'tapDel');
      if (copyA > 0) {
        var csz = sz * copyK;
        shape(x0 + dupOff[0] * copyT + (sz - csz) / 2, y0 + dupOff[1] * copyT + (sz - csz) / 2, csz, copyA, true);
      }
      // Shift: a dashed diagonal shows the proportion being kept.
      if (n === 'scale') {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(245,158,11,.7)';
        ctx.lineWidth = 1 * s;
        ctx.beginPath();
        ctx.moveTo(x0 - 4 * s, y0 - 4 * s);
        ctx.lineTo(x0 + base * kMax * 1.12, y0 + base * kMax * 1.12);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // The keys: swap, Shift, Alt, Delete — bottom aligned like the app's.
      var shiftOn = I('tapShift') && !I('tapShift2');
      if (n === 'tapShift') shiftOn = u > 0.35;
      if (n === 'tapShift2') shiftOn = u < 0.35;
      var altOn = I('tapAlt') && !I('tapAlt2');
      if (n === 'tapAlt') altOn = u > 0.35;
      if (n === 'tapAlt2') altOn = u < 0.35;
      var kw = Math.min(56 * s, margin * 0.72), khS = kw * 1.7, khD = kw * 1.15, gap = 10 * s, rs = kw * 0.36;
      var yDel = g.bot - khD, yAlt = yDel - gap - khS, yShift = yAlt - gap - khS, ySwap = yShift - gap - rs * 2;
      var K = {
        swap: [kx, ySwap + rs], shift: [kx, yShift + khS / 2], alt: [kx, yAlt + khS / 2], del: [kx, yDel + khD / 2],
      };
      function keyBox(cy, hgt, on, pressed) {
        box(ctx, kx - kw / 2, cy - hgt / 2, kw, hgt, 14 * s, on ? '#2a2206' : pressed ? '#2f2f2f' : '#1f1f1f', on ? 'rgba(245,158,11,.75)' : '#3a3a3a', on ? 1.5 * s : 1);
      }
      var pressKey = null;
      if (n === 'tapShift' || n === 'tapShift2') pressKey = 'shift';
      if (n === 'tapAlt' || n === 'tapAlt2') pressKey = 'alt';
      if (n === 'tapDel') pressKey = 'del';
      if (n === 'tapSwap') pressKey = 'swap';
      var pressed = pressKey && u < 0.5;
      // swap
      ctx.beginPath();
      ctx.arc(kx, K.swap[1], rs, 0, TAU);
      ctx.fillStyle = pressKey === 'swap' && pressed ? '#2f2f2f' : '#1f1f1f';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#3a3a3a';
      ctx.stroke();
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1.5 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      var a1 = rs * 0.45;
      ctx.moveTo(kx - a1, K.swap[1] - a1 * 0.45); ctx.lineTo(kx + a1, K.swap[1] - a1 * 0.45);
      ctx.moveTo(kx + a1 * 0.55, K.swap[1] - a1 * 0.9); ctx.lineTo(kx + a1, K.swap[1] - a1 * 0.45); ctx.lineTo(kx + a1 * 0.55, K.swap[1]);
      ctx.moveTo(kx + a1, K.swap[1] + a1 * 0.45); ctx.lineTo(kx - a1, K.swap[1] + a1 * 0.45);
      ctx.moveTo(kx - a1 * 0.55, K.swap[1]); ctx.lineTo(kx - a1, K.swap[1] + a1 * 0.45); ctx.lineTo(kx - a1 * 0.55, K.swap[1] + a1 * 0.9);
      ctx.stroke();
      // Shift, Alt
      [['shift', shiftOn, '⇧'], ['alt', altOn, '⌥']].forEach(function (d) {
        var cy = K[d[0]][1];
        keyBox(cy, khS, d[1], pressKey === d[0] && pressed);
        var col = d[1] ? AMBER : '#9ca3af';
        label(ctx, env, d[2], kx, cy - khS * 0.12, 20 * s, col, { align: 'center' });
        label(ctx, env, env.labels[d[0]] || '', kx, cy + khS * 0.2, 11 * s, col, { align: 'center', weight: 500, maxW: kw - 6 * s });
      });
      // Delete
      keyBox(K.del[1], khD, false, pressKey === 'del' && pressed);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1.4 * s;
      ctx.lineJoin = 'round';
      var dy0 = K.del[1] - khD * 0.14, bw3 = 16 * s, bh3 = 10 * s;
      ctx.beginPath();
      ctx.moveTo(kx - bw3 / 2, dy0);
      ctx.lineTo(kx - bw3 / 2 + 5 * s, dy0 - bh3 / 2);
      ctx.lineTo(kx + bw3 / 2, dy0 - bh3 / 2);
      ctx.lineTo(kx + bw3 / 2, dy0 + bh3 / 2);
      ctx.lineTo(kx - bw3 / 2 + 5 * s, dy0 + bh3 / 2);
      ctx.closePath();
      ctx.moveTo(kx - 1 * s, dy0 - 2.5 * s); ctx.lineTo(kx + 4 * s, dy0 + 2.5 * s);
      ctx.moveTo(kx + 4 * s, dy0 - 2.5 * s); ctx.lineTo(kx - 1 * s, dy0 + 2.5 * s);
      ctx.stroke();
      label(ctx, env, env.labels.del || '', kx, K.del[1] + khD * 0.24, 11 * s, '#9ca3af', { align: 'center', weight: 500, maxW: kw - 6 * s });

      // The finger (other hand) only comes in for the key taps.
      var away = [kx + (side < 0.5 ? 1 : -1) * margin * 0.2, g.h * 0.93];
      var fA = 0, fp = K.shift, press = 0, rip = -1;
      function tapAt(key, uu, fromKey) {
        var from = fromKey ? K[fromKey] : away;
        fA = 1;
        fp = uu < 0 ? from : K[key];
        press = uu >= 0 && uu < 0.5 ? 1 : 0;
        if (uu >= 0) rip = uu;
      }
      if (n === 'in') { fA = smooth(u * 2); fp = [lerp(away[0], K.shift[0], ease(u)), lerp(away[1], K.shift[1], ease(u))]; }
      if (n === 'tapShift') tapAt('shift', u);
      if (n === 'penIn') { fA = 1 - smooth(u * 2); fp = K.shift; }
      if (n === 'tapShift2') { tapAt('shift', u); fA = smooth(u * 3); }
      if (n === 'toAlt') { fA = 1; fp = [K.shift[0], lerp(K.shift[1], K.alt[1], ease(u))]; }
      if (n === 'tapAlt') tapAt('alt', u);
      if (n === 'penToShape') { fA = 1 - smooth(u * 2); fp = K.alt; }
      if (n === 'tapAlt2') { tapAt('alt', u); fA = smooth(u * 3); }
      if (n === 'toDel') { fA = 1; fp = [K.alt[0], lerp(K.alt[1], K.del[1], ease(u))]; }
      if (n === 'tapDel') tapAt('del', u);
      if (n === 'deleted') { fA = 1; fp = K.del; }
      if (n === 'toSwap') { fA = 1; fp = [K.del[0], lerp(K.del[1], K.swap[1], ease(u))]; }
      if (n === 'tapSwap') tapAt('swap', u);
      if (n === 'swap') { fA = 1 - smooth(u * 1.5); fp = K.swap; }
      if (rip >= 0) ripple(ctx, fp[0], fp[1], s, rip);
      finger(ctx, fp[0], fp[1], s, fA, press);

      // Pencil: scale via the bottom-right handle, then drag the copy out.
      var hdl = [x0 + sz + 4 * s, y0 + sz + 4 * s];
      var penA = 0, pen = [w * 0.3, g.h * 0.97], lift = 1;
      var hoverP = [w * 0.3, g.h * 0.97];
      if (n === 'penIn') { penA = smooth(u * 2); lift = 1 - ease(u); pen = [lerp(hoverP[0], x0 + base + 4 * s, ease(u)), lerp(hoverP[1], y0 + base + 4 * s, ease(u))]; }
      if (n === 'scale') {
        penA = 1; lift = 0;
        // The pen wanders off the diagonal (mostly right); Shift keeps the square.
        pen = [hdl[0] + bump(u) * 12 * s, hdl[1] - bump(u) * 6 * s];
      }
      if (n === 'penUp') { penA = 1; lift = ease(u); pen = [x0 + base * kMax + 4 * s, y0 + base * kMax + 4 * s]; }
      if (n === 'tapShift2' || n === 'toAlt' || n === 'tapAlt') { penA = 1; lift = 1; pen = [x0 + base * kMax + 4 * s, y0 + base * kMax + 4 * s]; }
      var mid = [x0 + sz / 2, y0 + sz / 2];
      if (n === 'penToShape') { penA = 1; lift = 1 - ease(u); var p0 = [x0 + base * kMax + 4 * s, y0 + base * kMax + 4 * s]; pen = [lerp(p0[0], mid[0], ease(u)), lerp(p0[1], mid[1], ease(u))]; }
      if (n === 'dup') { penA = 1; lift = 0; pen = [mid[0] + dupOff[0] * copyT, mid[1] + dupOff[1] * copyT]; }
      if (n === 'penUp2') { penA = 1 - smooth(u) * 0.2; lift = ease(u); pen = [mid[0] + dupOff[0], mid[1] + dupOff[1]]; }
      // Then it leaves, so the finger has the keys to itself.
      if (n === 'tapAlt2') { penA = 1 - smooth(u); lift = 1; pen = [mid[0] + dupOff[0] + 10 * s * u, mid[1] + dupOff[1] + 20 * s * u]; }
      pencil(ctx, pen[0], pen[1], s, penA, lift, true);

      var stepI = I('toSwap') ? 3 : I('toDel') ? 2 : I('toAlt') ? 1 : 0;
      return { chips: { step: stepI } };
    },
  };

  // ===== Pattern to CAD on one iPad: Export → STP, the file lands in Downloads in Files and
  // is shared to a CAD app, where the holes cut through the part.
  var CAD = [
    [0.6, 'a-in'], [0.4, 'tapExport'], [0.5, 'menu'], [0.35, 'toStp'], [0.3, 'tapStp'], [1.1, 'file'],
    [0.5, 'toFiles'], [0.6, 'drop'], [0.45, 'toFile'], [0.3, 'tapFile'], [0.6, 'share'], [0.3, 'tapApp'],
    [0.5, 'toCad'], [0.8, 'flat'], [0.9, 'extrude'], [1.3, 'sink'], [1.6, 'hold'], [0.6, 'out'],
  ];
  DEMOS['ipad-cad'] = {
    period: span(CAD),
    still: at(CAD, 'hold') + 0.8,
    layout: function (w, h, env) {
      var s = uiScale(w, h);
      var holes = [], outline = [], half = 50, cr = 14, pitch = 8.4;
      for (var yy = -40, row = 0; yy <= 40; yy += pitch * 0.866, row++) {
        for (var xx = -40 + ((row & 1) ? pitch / 2 : 0); xx <= 40; xx += pitch) {
          if (Math.hypot(xx, yy) <= 34) holes.push({ x: xx, y: yy });
        }
      }
      [[half - cr, half - cr, 0], [-half + cr, half - cr, 0.25], [-half + cr, -half + cr, 0.5], [half - cr, -half + cr, 0.75]].forEach(function (c) {
        for (var k = 0; k <= 8; k++) {
          var a = (c[2] + k / 8 * 0.25) * TAU;
          outline.push([c[0] + Math.cos(a) * cr, c[1] + Math.sin(a) * cr]);
        }
      });
      return { w: w, h: h, s: s, holes: holes, outline: outline, top: h * 0.05, bot: Math.min(h * 0.86, h - env.bottom - 12 * s) };
    },
    draw: function (ctx, g, t, env) {
      var ph = phase(t, CAD), n = ph.name, u = ph.u, s = g.s, w = g.w;
      var I = function (name) { return ph.i >= idx(CAD, name); };
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, g.h);
      var scene = I('toCad') ? 2 : I('toFiles') ? 1 : 0;
      var fade = 1;
      if (n === 'a-in') fade = smooth(u * 2);
      if (n === 'toFiles' || n === 'toCad') fade = smooth(u);
      if (n === 'out') fade = 1 - smooth(u);
      var fx = w * 0.05, fy = g.top, fw = w * 0.9, fh = g.bot - g.top;
      var pen = null, penA = 0, lift = 1, tap = -1;
      var hover = [w * 0.97, g.h * 0.75];

      ctx.save();
      ctx.globalAlpha = fade;
      if (scene === 0) {
        // HueScript: toolbar with Export, and the pattern on the board.
        box(ctx, fx, fy, fw, fh, 8 * s, '#0f0f0f', '#262626', 1);
        var tb = 34 * s;
        ctx.fillStyle = '#151515';
        ctx.fillRect(fx + 1, fy + 1, fw - 2, tb);
        box(ctx, fx + 10 * s, fy + tb / 2 - 7 * s, 14 * s, 14 * s, 3 * s, AMBER);
        var ex = env.labels.export ? env.labels.export.toUpperCase() : '';
        var bw = textWidth(ctx, env, ex, 11 * s, 800) + 24 * s;
        var bx = fx + fw - 10 * s - bw, by = fy + tb / 2 - 11 * s;
        var litE = n === 'tapExport' || I('menu');
        box(ctx, bx, by, bw, 22 * s, 5 * s, litE ? '#fbbf24' : AMBER);
        label(ctx, env, ex, bx + bw / 2, by + 11 * s, 11 * s, '#000', { align: 'center', weight: 800 });
        // Board + holes.
        var bs = Math.min(fw * 0.62, fh - tb - 30 * s), bcx = fx + fw / 2, bcy = fy + tb + (fh - tb) / 2;
        board(ctx, bcx - bs / 2, bcy - bs / 2, bs, bs, bs * 0.14);
        ctx.beginPath();
        g.holes.forEach(function (q) {
          var x = bcx + q.x / 100 * bs, y = bcy + q.y / 100 * bs;
          ctx.moveTo(x + bs * 0.029, y);
          ctx.arc(x, y, bs * 0.029, 0, TAU);
        });
        ctx.fillStyle = AMBER;
        ctx.fill();
        // Export menu.
        var menuA = n === 'menu' ? smooth(u * 3) : (n === 'toStp' || n === 'tapStp') ? 1 : n === 'file' ? 1 - smooth(u * 4) : 0;
        var rows = ['PNG', 'SVG', 'DXF', 'STP'], mw = 112 * s, rh = 30 * s, mx = bx + bw - mw, my = by + 30 * s;
        var stpY = my + 6 * s + 3 * rh + rh / 2;
        if (menuA > 0.01) {
          ctx.save();
          ctx.globalAlpha = fade * menuA;
          ctx.shadowColor = 'rgba(0,0,0,.6)';
          ctx.shadowBlur = 18 * s;
          box(ctx, mx, my, mw, rh * 4 + 12 * s, 7 * s, '#1f1f1f');
          ctx.shadowColor = 'transparent';
          box(ctx, mx, my, mw, rh * 4 + 12 * s, 7 * s, null, '#3a3a3a', 1);
          rows.forEach(function (r, i) {
            var ry = my + 6 * s + i * rh, on = r === 'STP' && (n === 'tapStp' || n === 'file');
            if (on) box(ctx, mx + 4 * s, ry + 2 * s, mw - 8 * s, rh - 4 * s, 5 * s, '#3a2a06');
            fileGlyph(ctx, mx + 19 * s, ry + rh / 2, s, on ? AMBER : '#9ca3af');
            label(ctx, env, r, mx + 36 * s, ry + rh / 2, 12 * s, on ? AMBER : '#e5e5e5', { weight: 700 });
          });
          ctx.restore();
        }
        // The downloaded file.
        var fileA = n === 'file' ? smooth((u - 0.2) * 3) : 0;
        if (fileA > 0.01) {
          var cwd = 200 * s, chh = 50 * s, cx0 = fx + fw / 2 - cwd / 2, cy0 = fy + fh - chh - 18 * s + (1 - ease((u - 0.2) * 2)) * 16 * s;
          ctx.save();
          ctx.globalAlpha = fade * fileA;
          ctx.shadowColor = 'rgba(0,0,0,.6)';
          ctx.shadowBlur = 18 * s;
          box(ctx, cx0, cy0, cwd, chh, 10 * s, '#232325');
          ctx.shadowColor = 'transparent';
          docIcon(ctx, cx0 + 24 * s, cy0 + chh / 2, s, 0.9);
          label(ctx, env, env.labels.file || '', cx0 + 44 * s, cy0 + chh / 2, 12 * s, '#f5f5f5', { maxW: cwd - 54 * s, weight: 500 });
          ctx.restore();
        }
        var eP = [bx + bw / 2, by + 11 * s], sP = [mx + mw / 2, stpY];
        if (n === 'a-in') { penA = smooth(u * 2); lift = 1 - ease(u) * 0.6; pen = [lerp(hover[0], eP[0], ease(u)), lerp(hover[1], eP[1] + 30 * s, ease(u))]; }
        if (n === 'tapExport') { penA = 1; lift = u < 0.5 ? ease(u * 2) * 0 : 0.5 * smooth((u - 0.5) * 2); pen = [eP[0], lerp(eP[1] + 30 * s, eP[1], ease(Math.min(1, u * 2)))]; if (u > 0.3) tap = (u - 0.3) / 0.7; }
        if (n === 'menu') { penA = 1; lift = 0.5; pen = eP; }
        if (n === 'toStp') { penA = 1; lift = 0.5; pen = [lerp(eP[0], sP[0], ease(u)), lerp(eP[1], sP[1], ease(u))]; }
        if (n === 'tapStp') { penA = 1; pen = sP; lift = u < 0.45 ? 0 : 0.7 * smooth((u - 0.45) * 2); tap = u; }
        if (n === 'file') { penA = 1 - smooth(u * 2); lift = 1; pen = [sP[0] + u * 40 * s, sP[1] + u * 60 * s]; }
      } else if (scene === 1) {
        // Files: Downloads, the new .stp, shared to a CAD app.
        box(ctx, fx, fy, fw, fh, 10 * s, '#1c1c1e', '#2c2c2e', 1);
        var sbw = fw * 0.3;
        ctx.save();
        ctx.beginPath();
        rr(ctx, fx, fy, fw, fh, 10 * s);
        ctx.clip();
        ctx.fillStyle = '#161618';
        ctx.fillRect(fx, fy, sbw, fh);
        label(ctx, env, env.labels.files || '', fx + 14 * s, fy + 24 * s, 17 * s, '#fff', { weight: 700, maxW: sbw - 20 * s });
        for (var r = 0; r < 5; r++) {
          var ry2 = fy + 52 * s + r * 30 * s, on = r === 1;
          if (on) box(ctx, fx + 6 * s, ry2 - 12 * s, sbw - 12 * s, 26 * s, 6 * s, '#0a84ff');
          box(ctx, fx + 14 * s, ry2 - 6 * s, 14 * s, 11 * s, 2 * s, on ? '#fff' : '#48484a');
          if (on) label(ctx, env, env.labels.downloads || '', fx + 34 * s, ry2, 12 * s, '#fff', { weight: 600, maxW: sbw - 44 * s });
          else box(ctx, fx + 34 * s, ry2 - 3 * s, sbw * [0.4, 0, 0.5, 0.35, 0.45][r], 6 * s, 3 * s, '#3a3a3c');
        }
        var mx0 = fx + sbw + 16 * s;
        label(ctx, env, env.labels.downloads || '', mx0, fy + 26 * s, 19 * s, '#fff', { weight: 700, maxW: fw - sbw - 30 * s });
        // Files grid: placeholders and the new file (first cell).
        var cell = Math.min((fw - sbw - 32 * s) / 3, 92 * s), gy0 = fy + 56 * s;
        for (var c = 0; c < 6; c++) {
          var cx1 = mx0 + (c % 3) * cell, cy1 = gy0 + Math.floor(c / 3) * cell * 1.2;
          if (c === 0) continue;
          box(ctx, cx1 + cell * 0.22, cy1 + cell * 0.1, cell * 0.56, cell * 0.66, 5 * s, '#3a3a3c');
          box(ctx, cx1 + cell * 0.2, cy1 + cell * 0.84, cell * 0.6, 5 * s, 2.5 * s, '#48484a');
        }
        var dropA = n === 'drop' ? smooth(u * 1.5) : I('toFile') ? 1 : 0;
        var dropY = n === 'drop' ? (1 - ease(u)) * -20 * s : 0;
        var fcx = mx0 + cell / 2, fcy = gy0 + cell * 0.43 + dropY;
        if (dropA > 0) {
          ctx.save();
          ctx.globalAlpha = fade * dropA;
          var sel = I('tapFile');
          if (sel) box(ctx, mx0 + 4 * s, gy0 - 2 * s, cell - 8 * s, cell * 1.1, 8 * s, 'rgba(10,132,255,.22)');
          docIcon(ctx, fcx, fcy, s, cell / (60 * s));
          label(ctx, env, env.labels.file || '', fcx, gy0 + cell * 0.92, 10 * s, '#e5e5e5', { align: 'center', maxW: cell - 6 * s });
          ctx.restore();
        }
        // Share row: two CAD apps.
        var shA = n === 'share' ? smooth(u * 2) : n === 'tapApp' ? 1 : 0;
        var shH = 96 * s, shY = fy + fh - shH - 10 * s;
        var appR = 22 * s, app1 = [mx0 + 40 * s, shY + 40 * s], app2 = [mx0 + 110 * s, shY + 40 * s];
        if (shA > 0.01) {
          ctx.save();
          ctx.globalAlpha = fade * shA;
          ctx.shadowColor = 'rgba(0,0,0,.6)';
          ctx.shadowBlur = 20 * s;
          box(ctx, fx + sbw * 0.5, shY + (1 - ease(Math.min(1, u * 2))) * 20 * s * (n === 'share' ? 1 : 0), fw - sbw * 0.5 - 10 * s, shH, 14 * s, '#2c2c2e');
          ctx.shadowColor = 'transparent';
          // Shapr3D-like tile and an Onshape-like tile (generic, not their marks).
          box(ctx, app1[0] - appR, app1[1] - appR, appR * 2, appR * 2, appR * 0.45, n === 'tapApp' && u < 0.5 ? '#333' : '#0b0b0b', '#48484a', 1);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 * s;
          ctx.beginPath();
          ctx.moveTo(app1[0], app1[1] - appR * 0.5);
          ctx.lineTo(app1[0] + appR * 0.45, app1[1] - appR * 0.22);
          ctx.lineTo(app1[0] + appR * 0.45, app1[1] + appR * 0.3);
          ctx.lineTo(app1[0], app1[1] + appR * 0.55);
          ctx.lineTo(app1[0] - appR * 0.45, app1[1] + appR * 0.3);
          ctx.lineTo(app1[0] - appR * 0.45, app1[1] - appR * 0.22);
          ctx.closePath();
          ctx.stroke();
          box(ctx, app2[0] - appR, app2[1] - appR, appR * 2, appR * 2, appR * 0.45, '#f5f5f5');
          ctx.beginPath();
          ctx.arc(app2[0], app2[1], appR * 0.45, 0, TAU);
          ctx.lineWidth = 4 * s;
          ctx.strokeStyle = '#1e3a8a';
          ctx.stroke();
          label(ctx, env, 'Shapr3D', app1[0], app1[1] + appR + 12 * s, 10 * s, '#e5e5e5', { align: 'center' });
          label(ctx, env, 'Onshape', app2[0], app2[1] + appR + 12 * s, 10 * s, '#e5e5e5', { align: 'center' });
          ctx.restore();
        }
        ctx.restore();
        var fileP = [fcx, fcy];
        if (n === 'toFiles') { penA = 0; }
        if (n === 'drop') { penA = smooth((u - 0.5) * 2); lift = 1; pen = [lerp(hover[0], fileP[0] + 30 * s, u), lerp(hover[1], fileP[1] + 60 * s, u)]; }
        if (n === 'toFile') { penA = 1; lift = 1 - ease(u); pen = [lerp(fileP[0] + 30 * s, fileP[0], ease(u)), lerp(fileP[1] + 60 * s, fileP[1], ease(u))]; }
        if (n === 'tapFile') { penA = 1; pen = fileP; lift = u < 0.45 ? 0 : 0.6 * smooth((u - 0.45) * 2); tap = u; }
        if (n === 'share') { penA = 1; lift = 0.6; pen = [lerp(fileP[0], app1[0], ease(u)), lerp(fileP[1], app1[1], ease(u))]; }
        if (n === 'tapApp') { penA = 1; pen = app1; lift = u < 0.45 ? 0 : 0.8 * smooth((u - 0.45) * 2); tap = u; }
      } else {
        // CAD: the pattern lands on the part, the hole solids rise and sink through it.
        var ph3 = n, uu = u;
        var TOP = 1.14, E0 = Math.PI / 2, E1 = 0.66, F1 = 0.56, F2 = 0.8;
        var e = E1, phi = F1, ext = 0, sink = 0, holesA = 0, flatA = 1;
        if (ph3 === 'toCad') { e = E1; phi = F1; }
        if (ph3 === 'extrude') { ext = ease(uu); }
        if (ph3 === 'sink') { ext = 1; sink = ease(uu); holesA = smooth((uu - 0.55) / 0.4); flatA = 1 - smooth((uu - 0.5) / 0.4); }
        if (ph3 === 'hold' || ph3 === 'out') { ext = 1; sink = 1; holesA = 1; flatA = 0; phi = lerp(F1, F2, ph3 === 'hold' ? ease(uu) : 1); }
        var cx = w / 2, cy = g.top + (g.bot - g.top) * 0.5, kk = Math.min(w, g.bot - g.top) * 0.0058;
        var ce = Math.cos(e), se = Math.sin(e), cp = Math.cos(phi), sp = Math.sin(phi);
        var P = function (x, y, z) {
          var xr = x * cp - y * sp, yr = x * sp + y * cp;
          return [cx + kk * xr, cy + kk * (yr * se - z * ce) + kk * 12 * (1 - se) * TOP];
        };
        var T0 = 7, H0 = 15, hr = 2.9, rx = kk * hr, ry = rx * se;
        var outlinePath = function (z) {
          ctx.beginPath();
          for (var i = 0; i < g.outline.length; i++) {
            var v = P(g.outline[i][0], g.outline[i][1], z);
            if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]);
          }
          ctx.closePath();
        };
        // The part: side band, top face, walls of the cut holes.
        outlinePath(-T0);
        ctx.fillStyle = '#6b6f86';
        ctx.fill();
        outlinePath(0);
        var c0 = P(-50, -50, 0), c1 = P(50, 50, 0), grad = ctx.createLinearGradient(c0[0], c0[1], c1[0], c1[1]);
        grad.addColorStop(0, '#b9bdd6');
        grad.addColorStop(1, '#8e93b0');
        ctx.fillStyle = grad;
        ctx.fill();
        if (holesA > 0) {
          ctx.save();
          ctx.globalAlpha = fade * holesA;
          for (var hI = 0; hI < g.holes.length; hI++) {
            var q = g.holes[hI], top = P(q.x, q.y, 0), bot = P(q.x, q.y, -T0);
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(top[0], top[1], rx, ry, 0, 0, TAU);
            ctx.clip();
            ctx.fillStyle = '#5b5f76';
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(bot[0], bot[1], rx, ry, 0, 0, TAU);
            ctx.fillStyle = '#0c0c0d';
            ctx.fill();
            ctx.restore();
          }
          ctx.restore();
        }
        // The imported sketch on top.
        if (flatA > 0) {
          ctx.save();
          ctx.globalAlpha = fade * flatA;
          ctx.beginPath();
          for (var j = 0; j < g.holes.length; j++) {
            var f = P(g.holes[j].x, g.holes[j].y, 0.01);
            ctx.moveTo(f[0] + rx, f[1]);
            ctx.ellipse(f[0], f[1], rx, ry, 0, 0, TAU);
          }
          ctx.fillStyle = '#3b82f6';
          ctx.fill();
          ctx.restore();
        }
        // Hole solids, back to front.
        var height = H0 * ext * (1 - sink);
        if (ext > 0 && height > 0.05) {
          var order = g.holes.map(function (hq) { return { q: hq, d: hq.x * sp + hq.y * cp }; }).sort(function (a2, b2) { return a2.d - b2.d; });
          for (var o = 0; o < order.length; o++) {
            var hq = order[o].q, b0 = P(hq.x, hq.y, 0), t0 = P(hq.x, hq.y, height);
            ctx.beginPath();
            ctx.ellipse(b0[0], b0[1], rx, ry, 0, 0, TAU);
            ctx.fillStyle = '#1d4ed8';
            ctx.fill();
            ctx.fillStyle = '#2563eb';
            ctx.fillRect(b0[0] - rx, t0[1], rx, b0[1] - t0[1]);
            ctx.fillStyle = '#1d4ed8';
            ctx.fillRect(b0[0], t0[1], rx, b0[1] - t0[1]);
            ctx.beginPath();
            ctx.ellipse(t0[0], t0[1], rx, ry, 0, 0, TAU);
            ctx.fillStyle = '#60a5fa';
            ctx.fill();
          }
        }
      }
      ctx.restore();
      if (pen && penA > 0) {
        if (tap >= 0) ripple(ctx, pen[0], pen[1], s * 0.8, tap);
        pencil(ctx, pen[0], pen[1], s, penA * fade, lift);
      }
      return { chips: { step: scene } };
    },
  };

  // Outline of a file with a folded corner, for menu rows.
  function fileGlyph(ctx, x, y, s, color) {
    var w = 10 * s, h = 13 * s, f = 3.5 * s;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h / 2);
    ctx.lineTo(x + w / 2 - f, y - h / 2);
    ctx.lineTo(x + w / 2, y - h / 2 + f);
    ctx.lineTo(x + w / 2, y + h / 2);
    ctx.lineTo(x - w / 2, y + h / 2);
    ctx.closePath();
    ctx.moveTo(x + w / 2 - f, y - h / 2);
    ctx.lineTo(x + w / 2 - f, y - h / 2 + f);
    ctx.lineTo(x + w / 2, y - h / 2 + f);
    ctx.lineWidth = 1.2 * s;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // A document icon with a folded corner (the .stp file).
  function docIcon(ctx, x, y, s, k) {
    var w = 26 * s * k, h = 34 * s * k, f = 8 * s * k;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h / 2);
    ctx.lineTo(x + w / 2 - f, y - h / 2);
    ctx.lineTo(x + w / 2, y - h / 2 + f);
    ctx.lineTo(x + w / 2, y + h / 2);
    ctx.lineTo(x - w / 2, y + h / 2);
    ctx.closePath();
    ctx.fillStyle = '#f5f5f5';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - f, y - h / 2);
    ctx.lineTo(x + w / 2 - f, y - h / 2 + f);
    ctx.lineTo(x + w / 2, y - h / 2 + f);
    ctx.fillStyle = '#c7c7cc';
    ctx.fill();
    box(ctx, x - w * 0.34, y + h * 0.1, w * 0.68, h * 0.22, 2 * s * k, AMBER);
  }

  // ---------------------------------------------------------------- runner
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function whenVisible(el, cb) {
    if (!('IntersectionObserver' in window)) { cb(true, false); return; }
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      cb(e.isIntersecting && e.intersectionRatio > 0.05, !e.isIntersecting);
    }, { threshold: [0, 0.1] }).observe(el);
  }

  function start(frame) {
    var def = DEMOS[frame.getAttribute('data-ip-demo')];
    var canvas = frame.querySelector('canvas');
    if (!def || !canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var lang = document.documentElement.lang || 'en';
    var nf;
    try { nf = new Intl.NumberFormat(lang, { useGrouping: false }); } catch (err) { nf = { format: String }; }
    var labels = {};
    each(frame.attributes, function (a) { if (a.name.indexOf('data-ip-l-') === 0) labels[a.name.slice(10)] = a.value; });
    var env = { labels: labels, font: (getComputedStyle(frame).fontFamily || 'sans-serif') };

    var chips = {};
    each(frame.querySelectorAll('[data-ip-chip]'), function (el) {
      var parts = el.getAttribute('data-ip-chip').split(':');
      (chips[parts[0]] = chips[parts[0]] || []).push({ el: el, i: +parts[1] });
    });
    var outs = {};
    each(frame.querySelectorAll('[data-ip-out]'), function (el) { outs[el.getAttribute('data-ip-out')] = el; });
    var shown = {};

    var w = 0, h = 0, dpr = 1, geo = null;
    var raf = 0, t0 = null, visible = false;

    function measure() {
      var r = canvas.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
      if (!W || !H) return false;
      var d = Math.min(2, window.devicePixelRatio || 1);
      if (W !== w || H !== h || d !== dpr) {
        w = W; h = H; dpr = d;
        canvas.width = Math.round(W * d);
        canvas.height = Math.round(H * d);
        geo = null;
      }
      if (!geo) {
        var chipsEl = frame.querySelector('.ip-chips'), lowEl = frame.querySelector('.ip-steps') || frame.querySelector('.ip-pill');
        env.top = chipsEl ? chipsEl.offsetTop + chipsEl.offsetHeight : 0;
        env.bottom = lowEl ? H - lowEl.offsetTop : 0;
        geo = def.layout(w, h, env);
      }
      return true;
    }

    function applyUi(ui) {
      var g, key;
      if (ui.chips) {
        for (g in ui.chips) {
          if (!chips[g] || shown['c:' + g] === ui.chips[g]) continue;
          shown['c:' + g] = ui.chips[g];
          chips[g].forEach(function (c) { c.el.classList.toggle('is-on', c.i === ui.chips[g]); });
        }
      }
      if (ui.out) {
        for (key in ui.out) {
          if (!outs[key]) continue;
          var text = nf.format(ui.out[key]);
          if (shown['o:' + key] !== text) { shown['o:' + key] = text; outs[key].textContent = text; }
        }
      }
      if (ui.tone) {
        for (key in ui.tone) {
          if (!outs[key] || shown['t:' + key] === ui.tone[key]) continue;
          shown['t:' + key] = ui.tone[key];
          outs[key].classList.toggle('is-short', ui.tone[key] === 'short');
          outs[key].classList.toggle('is-wide', ui.tone[key] === 'wide');
        }
      }
    }

    function paint(t) {
      if (!measure()) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      applyUi(def.draw(ctx, geo, t, env) || {});
    }

    function frameLoop(now) {
      raf = 0;
      if (!visible) return;
      if (t0 === null) t0 = now;
      paint(((now - t0) / 1000) % def.period);
      raf = requestAnimationFrame(frameLoop);
    }
    function play() { if (!raf && visible && !reduce) raf = requestAnimationFrame(frameLoop); }
    function redrawStill() { if (reduce || !raf) paint(reduce ? def.still : 0); }

    if ('ResizeObserver' in window) new ResizeObserver(function () { geo = null; redrawStill(); }).observe(canvas);
    else window.addEventListener('resize', function () { geo = null; redrawStill(); });

    whenVisible(frame, function (on, gone) {
      visible = on;
      if (gone) t0 = null;  // fully off screen: start over next time
      if (on) play();
    });

    // Fonts can land after the first paint; the labels measure themselves, so lay out again.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { geo = null; redrawStill(); });
    paint(reduce ? def.still : 0);
    play();
  }

  // The hero video: under reduced motion it waits on its poster with the native
  // controls; otherwise a tap plays or pauses it (iOS Low Power Mode blocks
  // autoplay and leaves the poster up).
  function video(v) {
    if (reduce) {
      v.removeAttribute('autoplay');
      v.pause();
      v.controls = true;
      return;
    }
    v.addEventListener('click', function () { if (v.paused) v.play(); else v.pause(); });
  }

  function init() {
    each(document.querySelectorAll('[data-ip-demo]'), start);
    each(document.querySelectorAll('video[data-ip-video]'), video);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
