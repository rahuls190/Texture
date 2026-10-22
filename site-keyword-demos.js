// 關鍵字頁（scripts/generate-keyword-pages.mjs 產生的喇叭網孔／散熱孔／半色調三頁）的示範動畫。
// 外部檔是因為 CSP 不開 'unsafe-inline'；頁面用 <script src="/site-keyword-demos.js" defer> 載入。
//
// 每個 [data-kw-demo="名稱"] 框裡有一張 <canvas>，名稱對應下面 DEMOS 的一項：
//   layout(w, h, env)     依畫布尺寸（CSS px）算好幾何，尺寸變了才重算
//   draw(ctx, g, t, env)  畫第 t 秒（0 ≤ t < period），回傳 { chips: {群組: 索引}, out: {points, ratio} }
// 字一律在 HTML：[data-kw-chip="群組:索引"] 亮起目前那一個（-1 = 全暗）、[data-kw-out] 填數字、
// data-kw-l-* 是畫布上要寫的字。這支檔案不含任何語系文字，翻譯只改產生器那邊。
//
// 只在進入畫面時跑，完全離開時倒回開頭（捲回來一定從頭看）；prefers-reduced-motion 停在 still 那一格。
// 圖是示意，不是 App 的引擎：排列、漸變衰減、邊界判定（中心點／完整面積／邊界裁切）、
// 底圖明暗驅動尺寸，都照 App 的規則算，但數字只是為了畫面好讀。
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var AMBER = '#f59e0b';
  var BOARD = '#181818';
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------- math
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  // Cosine falloff: 1 on the controller, 0 at the edge of its range.
  function falloff(d, r) { return d >= r ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / r); }

  // steps = [[duration, ...], ...] → { i, u, step } for time t.
  function phase(t, steps) {
    var acc = 0;
    for (var i = 0; i < steps.length; i++) {
      if (t < acc + steps[i][0] || i === steps.length - 1) {
        return { i: i, u: clamp((t - acc) / steps[i][0], 0, 1), step: steps[i] };
      }
      acc += steps[i][0];
    }
  }
  function span(steps) { var s = 0; for (var i = 0; i < steps.length; i++) s += steps[i][0]; return s; }

  // Staggered grid (the app's hexagonal arrangement when sy = sx·√3/2) inside a centred box.
  function stagger(cx, cy, sx, sy, halfW, halfH) {
    var pts = [];
    var rows = Math.ceil(halfH / sy) + 1, cols = Math.ceil(halfW / sx) + 1;
    for (var j = -rows; j <= rows; j++) {
      var off = (j & 1) ? sx / 2 : 0;
      for (var i = -cols - 1; i <= cols; i++) {
        var x = cx + i * sx + off, y = cy + j * sy;
        if (Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH) pts.push({ x: x, y: y });
      }
    }
    return pts;
  }

  function sdRoundRect(px, py, cx, cy, hw, hh, r) {
    var qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  // Exact signed distance to a polygon (negative inside).
  function sdPolygon(px, py, v) {
    var d = Infinity, s = 1;
    for (var i = 0, j = v.length - 1; i < v.length; j = i++) {
      var ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
      var wx = px - v[i][0], wy = py - v[i][1];
      var h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
      var bx = wx - ex * h, by = wy - ey * h;
      d = Math.min(d, bx * bx + by * by);
      var c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  }

  // Distance from the centre to the zero of `sdf` along each of n directions.
  var RAYS = 240;
  function radial(sdf, maxR) {
    var out = new Float32Array(RAYS);
    for (var k = 0; k < RAYS; k++) {
      var a = k / RAYS * TAU, c = Math.cos(a), s = Math.sin(a), lo = 0, hi = maxR;
      for (var it = 0; it < 28; it++) {
        var mid = (lo + hi) / 2;
        if (sdf(c * mid, s * mid) < 0) lo = mid; else hi = mid;
      }
      out[k] = lo;
    }
    return out;
  }
  function radiusAt(arr, a) {
    var f = ((a % TAU) + TAU) % TAU / TAU * RAYS, i = Math.floor(f), j = (i + 1) % RAYS;
    return lerp(arr[i % RAYS], arr[j], f - i);
  }

  function segDist(px, py, ax, ay, bx, by) {
    var ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey;
    var h = l ? clamp(((px - ax) * ex + (py - ay) * ey) / l, 0, 1) : 0;
    var dx = px - ax - ex * h, dy = py - ay - ey * h;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function polyDist(px, py, pts) {
    var d = Infinity;
    for (var i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    return d;
  }
  function quad(a, c, b, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, m = 1 - t;
      out.push([m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]]);
    }
    return out;
  }

  // ---------------------------------------------------------------- shapes (appended to the current path)
  function addCircle(ctx, x, y, r) {
    if (r <= 0.05) return;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  // Slot: a rectangle with fully rounded ends, `len` along angle `a`.
  function addCapsule(ctx, x, y, len, wid, a) {
    var r = wid / 2;
    if (r <= 0.05) return;
    var h = Math.max(0, len / 2 - r), c = Math.cos(a), s = Math.sin(a);
    var x1 = x - c * h, y1 = y - s * h, x2 = x + c * h, y2 = y + s * h;
    ctx.moveTo(x2 + s * r, y2 - c * r);
    ctx.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
    ctx.arc(x1, y1, r, a + Math.PI / 2, a + Math.PI * 1.5);
    ctx.closePath();
  }
  function addRoundSquare(ctx, x, y, side, rad) {
    if (side <= 0.1) return;
    var h = side / 2, r = Math.min(rad, h);
    ctx.moveTo(x - h + r, y - h);
    ctx.arcTo(x + h, y - h, x + h, y + h, r);
    ctx.arcTo(x + h, y + h, x - h, y + h, r);
    ctx.arcTo(x - h, y + h, x - h, y - h, r);
    ctx.arcTo(x - h, y - h, x + h, y - h, r);
    ctx.closePath();
  }
  function addBar(ctx, x, y, len, wid, a) {
    if (len <= 0.1) return;
    var c = Math.cos(a), s = Math.sin(a), hx = len / 2, hy = wid / 2;
    ctx.moveTo(x + c * hx - s * hy, y + s * hx + c * hy);
    ctx.lineTo(x - c * hx - s * hy, y - s * hx + c * hy);
    ctx.lineTo(x - c * hx + s * hy, y - s * hx - c * hy);
    ctx.lineTo(x + c * hx + s * hy, y + s * hx - c * hy);
    ctx.closePath();
  }
  function addPoly(ctx, x, y, r, n, rot) {
    if (r <= 0.05) return;
    for (var k = 0; k < n; k++) {
      var a = rot + k / n * TAU;
      if (k) ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  }
  function addStar(ctx, x, y, r, inner, n, rot) {
    if (r <= 0.05) return;
    for (var k = 0; k < n * 2; k++) {
      var a = rot + k / (n * 2) * TAU, rr = k & 1 ? r * inner : r;
      if (k) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
  }
  // Circle → star morph: radius dips between n lobes by up to `depth` (0 = a plain circle).
  function addLobes(ctx, x, y, r, depth, n) {
    if (r <= 0.05) return;
    var steps = 30;
    for (var k = 0; k <= steps; k++) {
      var a = -Math.PI / 2 + k / steps * TAU, rr = r * (1 - depth * (0.5 - 0.5 * Math.cos(n * (a + Math.PI / 2))));
      if (k) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
  }
  // A V-shaped louver: the "custom" shape on the vent page.
  var CHEVRON = [[-0.5, -0.36], [0, 0.04], [0.5, -0.36], [0.5, -0.04], [0, 0.36], [-0.5, -0.04]];
  function addChevron(ctx, x, y, size) {
    if (size <= 0.1) return;
    for (var k = 0; k < CHEVRON.length; k++) {
      var px = x + CHEVRON[k][0] * size, py = y + CHEVRON[k][1] * size;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  // The HueScript mark (same paths as the site logo), normalised to width 1 and centred:
  // the "custom" shape on the halftone page, standing in for "your logo".
  var LOGO = (function () {
    var raw = [
      [['M', 24.84, 0], ['L', 65.26, 0], ['C', 73.76, 0, 80.67, 6.9, 80.67, 15.41], ['L', 24.84, 15.41]],
      [['M', 15.41, 0], ['L', 20.46, 0], ['L', 20.46, 15.41], ['L', 0, 15.41], ['C', 0, 6.9, 6.9, 0, 15.41, 0]],
      [['M', 0, 30.81], ['L', 65.26, 30.81], ['C', 73.76, 30.81, 80.67, 37.71, 80.67, 46.22], ['L', 15.41, 46.22], ['C', 6.9, 46.22, 0, 39.32, 0, 30.81]],
      [['M', 0, 61.63], ['L', 56.99, 61.63], ['L', 56.99, 77.04], ['L', 15.41, 77.04], ['C', 6.9, 77.04, 0, 70.13, 0, 61.63]],
      [['M', 59.72, 61.63], ['L', 80.67, 61.63], ['C', 80.67, 70.13, 73.77, 77.04, 65.26, 77.04], ['L', 59.72, 77.04]],
    ];
    return raw.map(function (sub) {
      return sub.map(function (op) {
        var out = [op[0]];
        for (var i = 1; i < op.length; i += 2) out.push((op[i] - 40.335) / 80.67, (op[i + 1] - 38.52) / 80.67);
        return out;
      });
    });
  })();
  function addLogo(ctx, x, y, size) {
    if (size <= 0.2) return;
    for (var s = 0; s < LOGO.length; s++) {
      var sub = LOGO[s];
      for (var k = 0; k < sub.length; k++) {
        var op = sub[k];
        if (op[0] === 'M') ctx.moveTo(x + op[1] * size, y + op[2] * size);
        else if (op[0] === 'L') ctx.lineTo(x + op[1] * size, y + op[2] * size);
        else ctx.bezierCurveTo(x + op[1] * size, y + op[2] * size, x + op[3] * size, y + op[4] * size, x + op[5] * size, y + op[6] * size);
      }
      ctx.closePath();
    }
  }

  // ---------------------------------------------------------------- UI bits drawn on the canvas
  function uiScale(w, h) { return clamp(Math.min(w, h) / 460, 0.72, 1.2); }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function panel(ctx, x, y, w, h, r) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = BOARD;
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Point controller: a range ring and the handle the app draws.
  function influence(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(245,158,11,.45)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function handle(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath();
    ctx.arc(x, y, 9.5 * s, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 6.5 * s, 0, TAU);
    ctx.fillStyle = AMBER;
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
  function cursor(ctx, x, y, s, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.2, 13.2);
    ctx.lineTo(7.2, 19.6);
    ctx.lineTo(10, 18.4);
    ctx.lineTo(7.1, 12.2);
    ctx.lineTo(12.5, 12.2);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- the photo (halftone page)
  var photo = { img: null, lum: null, n: 128, waiting: null };
  function needPhoto(src, cb) {
    if (photo.lum) return cb();
    if (photo.waiting) { photo.waiting.push(cb); return; }
    photo.waiting = [cb];
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      var n = photo.n, c = document.createElement('canvas');
      c.width = n; c.height = n;
      var x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, n, n);
      x.drawImage(img, 0, 0, n, n);
      var px = x.getImageData(0, 0, n, n).data, lum = new Float32Array(n * n);
      // Rec.709 luminance, like the app's image sampler.
      for (var i = 0; i < n * n; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      photo.img = img;
      photo.lum = lum;
      var list = photo.waiting;
      photo.waiting = null;
      list.forEach(function (fn) { fn(); });
    };
    img.src = src;
  }
  function lumAt(u, v) {
    var n = photo.n, x = clamp(u, 0, 1) * (n - 1), y = clamp(v, 0, 1) * (n - 1);
    var x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
    var fx = x - x0, fy = y - y0, L = photo.lum;
    return lerp(lerp(L[y0 * n + x0], L[y0 * n + x1], fx), lerp(L[y1 * n + x0], L[y1 * n + x1], fx), fy);
  }
  // Brightness → dot factor. Bright areas get the large dot, so on a dark canvas the portrait reads positive.
  function tone(L) { return Math.pow(clamp((L - 0.04) / 0.92, 0, 1), 1.15); }

  // A square board of image-sampled points; `pts` is filled by the caller.
  function photoBoard(w, h, topPad) {
    var S = Math.min(w, h) * 0.8, cx = w / 2, cy = h / 2 + (topPad || 0) * h;
    return { S: S, cx: cx, cy: cy, x0: cx - S / 2, y0: cy - S / 2 };
  }
  function sampleAll(b, pts) {
    for (var i = 0; i < pts.length; i++) {
      var q = pts[i];
      q.L = tone(lumAt((q.x - b.x0) / b.S, (q.y - b.y0) / b.S));
    }
    return pts;
  }
  function insideBoard(b, pad) {
    return function (q) { return q.x >= b.x0 + pad && q.x <= b.x0 + b.S - pad && q.y >= b.y0 + pad && q.y <= b.y0 + b.S - pad; };
  }
  function boardFrame(ctx, b) { panel(ctx, b.x0, b.y0, b.S, b.S, 6); }

  // ---------------------------------------------------------------- demos
  var DEMOS = {};

  // ===== Speaker grille: hero. A soundbar grille; a point controller glides and the holes grow around it.
  DEMOS['speaker-grille'] = {
    period: 10,
    still: 2.3,
    layout: function (w, h) {
      var bw = w * 0.86, bh = h * 0.6, cx = w / 2, cy = h / 2, r = bh / 2;
      var p = bh / 7.4, dMax = p * 0.9;
      var pts = stagger(cx, cy, p, p * 0.866, bw / 2, bh / 2).filter(function (q) {
        return sdRoundRect(q.x, q.y, cx, cy, bw / 2, bh / 2, r) <= -dMax / 2 - p * 0.1;
      });
      return { cx: cx, cy: cy, bw: bw, bh: bh, r: r, p: p, pts: pts, area: bw * bh - (4 - Math.PI) * r * r, s: uiScale(w, h) };
    },
    draw: function (ctx, g, t) {
      var a = TAU * t / 10;
      var hx = g.cx + g.bw * 0.36 * Math.sin(a), hy = g.cy + g.bh * 0.2 * Math.sin(2 * a + 0.7);
      var R = g.bh * (0.62 + 0.16 * Math.sin(a + 1.2)), d0 = g.p * 0.34, d1 = g.p * 0.9, sum = 0;
      panel(ctx, g.cx - g.bw / 2, g.cy - g.bh / 2, g.bw, g.bh, g.r);
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i], d = lerp(d0, d1, falloff(Math.hypot(q.x - hx, q.y - hy), R));
        sum += d * d;
        addCircle(ctx, q.x, q.y, d / 2);
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      influence(ctx, hx, hy, R);
      handle(ctx, hx, hy, g.s);
      cursor(ctx, hx + 4 * g.s, hy + 5 * g.s, g.s, 1);
      return { out: { points: g.pts.length, ratio: Math.PI / 4 * sum / g.area } };
    },
  };

  // ===== Speaker grille: the same round grille through four layouts. Holes are paired by
  // distance from the centre, so switching layout reads as the holes flowing into place.
  DEMOS['speaker-layouts'] = {
    period: 11.2,
    still: 0.8,
    layout: function (w, h) {
      var cx = w / 2, cy = h * 0.54, R = Math.min(w, h) * 0.36;
      // Concentric sets the count; the other layouts are built to match it.
      var conc = [{ x: 0, y: 0 }], K = 8, dr = R / (K + 0.35);
      for (var k = 1; k <= K; k++) {
        var m = Math.round(TAU * k);
        for (var j = 0; j < m; j++) {
          var a = j / m * TAU + k * 0.37;
          conc.push({ x: Math.cos(a) * k * dr, y: Math.sin(a) * k * dr });
        }
      }
      var N = conc.length, pitch = R * Math.sqrt(TAU / (Math.sqrt(3) * N));
      var hex = stagger(0, 0, pitch, pitch * 0.866, R * 1.3, R * 1.3)
        .sort(function (u, v) { return (u.x * u.x + u.y * u.y) - (v.x * v.x + v.y * v.y); })
        .slice(0, N);
      var fib = [];
      for (var i = 0; i < N; i++) {
        var rr = R * 0.97 * Math.sqrt((i + 0.5) / N), aa = i * GOLDEN;
        fib.push({ x: Math.cos(aa) * rr, y: Math.sin(aa) * rr });
      }
      // Archimedean spiral with points evenly spaced along the curve.
      var loops = 8, tMax = loops * TAU, b = R * 0.97 / tMax, lens = [0], steps = 2000;
      for (var s = 1; s <= steps; s++) {
        var t0 = (s - 1) / steps * tMax, t1 = s / steps * tMax;
        lens.push(lens[s - 1] + Math.hypot(b * t1 * Math.cos(t1) - b * t0 * Math.cos(t0), b * t1 * Math.sin(t1) - b * t0 * Math.sin(t0)));
      }
      var spi = [], total = lens[steps], cur = 0;
      for (var n = 0; n < N; n++) {
        var want = (n + 0.5) / N * total;
        while (cur < steps && lens[cur + 1] < want) cur++;
        var tt = (cur + (want - lens[cur]) / Math.max(1e-6, lens[cur + 1] - lens[cur])) / steps * tMax;
        spi.push({ x: b * tt * Math.cos(tt), y: b * tt * Math.sin(tt) });
      }
      function sortR(list) {
        return list.map(function (q) { return { x: q.x, y: q.y, r: Math.hypot(q.x, q.y), a: Math.atan2(q.y, q.x) }; })
          .sort(function (u, v) { return u.r - v.r || u.a - v.a; });
      }
      return { cx: cx, cy: cy, R: R, N: N, pitch: pitch, sets: [sortR(hex), sortR(conc), sortR(fib), sortR(spi)] };
    },
    draw: function (ctx, g, t) {
      var hold = 1.7, move = 1.1, per = hold + move;
      var L = Math.floor(t / per) % 4, local = t - L * per, u = local < hold ? 0 : ease((local - hold) / move);
      var A = g.sets[L], B = g.sets[(L + 1) % 4];
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.R + g.pitch * 0.55, 0, TAU);
      ctx.fillStyle = BOARD;
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (var i = 0; i < g.N; i++) {
        var x = lerp(A[i].x, B[i].x, u), y = lerp(A[i].y, B[i].y, u), r = Math.hypot(x, y);
        addCircle(ctx, g.cx + x, g.cy + y, g.pitch * (0.4 - 0.13 * clamp(r / g.R, 0, 1)));
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      return { chips: { layout: u > 0.5 ? (L + 1) % 4 : L } };
    },
  };

  // ===== Speaker grille: outline and edge rule. Circle → rounded rectangle → custom, then the
  // three boundary methods on the custom outline: complete area, centre point, clipping.
  var OUTLINE = [
    [1.6, 0, 0, 0], [1.0, 0, 1, 0], [1.6, 1, 1, 0], [1.0, 1, 2, 0], [1.6, 2, 2, 0],
    [1.8, 2, 2, 1], [1.8, 2, 2, 2], [1.0, 2, 0, 0], [0.4, 0, 0, 0],
  ];
  DEMOS['speaker-outline'] = {
    period: span(OUTLINE),
    still: 1.6 + 1.0 + 1.6 + 1.0 + 1.6 + 1.8 + 0.9,
    layout: function (w, h) {
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.33;
      var tri = [[0, R * 0.78], [-R * 0.9, -R * 0.54], [R * 0.9, -R * 0.54]];
      var shapes = [
        radial(function () { return -1; }, R).map(function () { return R; }),
        radial(function (x, y) { return sdRoundRect(x, y, 0, 0, R * 1.2, R * 0.8, R * 0.3); }, R * 2),
        radial(function (x, y) { return sdPolygon(x, y, tri) - R * 0.34; }, R * 2),
      ];
      var p = R / 5.6;
      var pts = stagger(0, 0, p, p * 0.866, R * 1.6, R * 1.6).map(function (q) {
        return { x: q.x, y: q.y, r: Math.hypot(q.x, q.y), a: Math.atan2(q.y, q.x) };
      });
      var ring = [];
      for (var k = 0; k < 12; k++) ring.push([Math.cos(k / 12 * TAU), Math.sin(k / 12 * TAU)]);
      return { cx: cx, cy: cy, R: R, p: p, hr: p * 0.34, shapes: shapes, pts: pts, ring: ring };
    },
    draw: function (ctx, g, t) {
      var ph = phase(t, OUTLINE), st = ph.step, m = st[1] === st[2] ? 0 : ease(ph.u);
      var A = g.shapes[st[1]], B = g.shapes[st[2]], method = st[3];
      function rAt(a) { return lerp(radiusAt(A, a), radiusAt(B, a), m); }

      var outline = new Path2D();
      for (var k = 0; k <= RAYS; k++) {
        var a = k / RAYS * TAU, rr = rAt(a), x = g.cx + Math.cos(a) * rr, y = g.cy + Math.sin(a) * rr;
        if (k) outline.lineTo(x, y); else outline.moveTo(x, y);
      }
      outline.closePath();
      ctx.fillStyle = BOARD;
      ctx.fill(outline);

      ctx.save();
      if (method === 2) ctx.clip(outline);
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i], keep;
        if (method === 1) keep = rAt(q.a) - q.r >= 0;                 // centre point inside
        else if (method === 2) keep = rAt(q.a) - q.r >= -g.hr;        // touches the inside at all
        else {                                                        // whole hole inside
          keep = true;
          for (var s = 0; s < g.ring.length && keep; s++) {
            var sx = q.x + g.ring[s][0] * g.hr, sy = q.y + g.ring[s][1] * g.hr;
            keep = rAt(Math.atan2(sy, sx)) - Math.hypot(sx, sy) >= 2;
          }
        }
        if (keep) addCircle(ctx, g.cx + q.x, g.cy + q.y, g.hr);
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      ctx.restore();

      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.stroke(outline);
      var shape = st[1] === st[2] ? st[1] : (ph.u > 0.5 ? st[2] : st[1]);
      return { chips: { shape: shape, method: method === 0 ? 0 : method } };
    },
  };

  // ===== Speaker grille: pattern → STEP → part. Tilt into 3D, every hole extrudes into a solid,
  // the solids sink into a panel and leave their holes behind.
  var CAD = [
    [1.2, 'flat'], [1.3, 'tilt'], [1.4, 'extrude'], [0.8, 'plate'], [1.7, 'sink'],
    [1.8, 'hold'], [1.3, 'back'], [0.9, 'flat'],
  ];
  DEMOS['speaker-cad'] = {
    period: span(CAD),
    still: 1.2 + 1.3 + 1.4 + 0.8 + 1.7 + 0.9,
    layout: function (w, h) {
      var holes = [], pitch = 8.4;
      stagger(0, 0, pitch, pitch * 0.866, 40, 40).forEach(function (q) {
        if (Math.hypot(q.x, q.y) <= 34) holes.push({ x: q.x, y: q.y });
      });
      var outline = [], half = 50, cr = 14;
      [[half - cr, half - cr, 0], [-half + cr, half - cr, 0.25], [-half + cr, -half + cr, 0.5], [half - cr, -half + cr, 0.75]].forEach(function (c) {
        for (var k = 0; k <= 8; k++) {
          var a = (c[2] + k / 8 * 0.25) * TAU;
          outline.push([c[0] + Math.cos(a) * cr, c[1] + Math.sin(a) * cr]);
        }
      });
      return { cx: w / 2, cy: h * 0.46, k: Math.min(w, h) * 0.0056, holes: holes, outline: outline, hr: 2.9, T: 5, H: 15 };
    },
    draw: function (ctx, g, t) {
      var ph = phase(t, CAD), name = ph.step[1], u = ph.u;
      var TOP = 1.14, E0 = Math.PI / 2, E1 = 0.66, F1 = 0.56, F2 = 0.74;
      var e = E0, phi = 0, ext = 0, plateA = 0, sink = 0, holesA = 0, flatA = 1, step = 0;
      if (name === 'tilt') { e = lerp(E0, E1, ease(u)); phi = lerp(0, F1, ease(u)); }
      if (name === 'extrude') { e = E1; phi = F1; ext = ease(u); step = 1; }
      if (name === 'plate') { e = E1; phi = F1; ext = 1; plateA = smooth(u); flatA = 1 - smooth(u); step = 1; }
      if (name === 'sink') { e = E1; phi = F1; ext = 1; plateA = 1; flatA = 0; sink = ease(u); holesA = smooth((u - 0.55) / 0.4); step = 2; }
      if (name === 'hold') { e = E1; phi = lerp(F1, F2, ease(u)); plateA = 1; flatA = 0; holesA = 1; sink = 1; ext = 1; step = 2; }
      if (name === 'back') { e = lerp(E1, E0, ease(u)); phi = lerp(F2, 0, ease(u)); plateA = 1 - smooth(u); flatA = smooth(u); holesA = 1; sink = 1; ext = 1; step = 2; }
      var ce = Math.cos(e), se = Math.sin(e), cp = Math.cos(phi), sp = Math.sin(phi);
      function P(x, y, z) {
        var xr = x * cp - y * sp, yr = x * sp + y * cp;
        return [g.cx + g.k * xr, g.cy + g.k * (yr * se - z * ce) + g.k * 12 * (1 - se) * TOP];
      }
      var rx = g.k * g.hr, ry = rx * se;
      function outlinePath(z) {
        ctx.beginPath();
        for (var i = 0; i < g.outline.length; i++) {
          var v = P(g.outline[i][0], g.outline[i][1], z);
          if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]);
        }
        ctx.closePath();
      }

      // The panel (a finished part in CAD): side band, top face, hole walls.
      if (plateA > 0) {
        ctx.save();
        ctx.globalAlpha = plateA;
        outlinePath(-g.T);
        ctx.fillStyle = '#26262a';
        ctx.fill();
        outlinePath(0);
        var c0 = P(-50, -50, 0), c1 = P(50, 50, 0), grad = ctx.createLinearGradient(c0[0], c0[1], c1[0], c1[1]);
        grad.addColorStop(0, '#4a4a50');
        grad.addColorStop(1, '#303035');
        ctx.fillStyle = grad;
        ctx.fill();
        if (holesA > 0) {
          ctx.globalAlpha = plateA * holesA;
          for (var i = 0; i < g.holes.length; i++) {
            var q = g.holes[i], top = P(q.x, q.y, 0), bot = P(q.x, q.y, -g.T);
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(top[0], top[1], rx, ry, 0, 0, TAU);
            ctx.clip();
            ctx.fillStyle = '#2b2b30';
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(bot[0], bot[1], rx, ry, 0, 0, TAU);
            ctx.fillStyle = '#0c0c0d';
            ctx.fill();
            ctx.restore();
            ctx.beginPath();
            ctx.ellipse(top[0], top[1], rx, ry, 0, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.strokeStyle = 'rgba(255,255,255,.16)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // The flat 2D pattern on the canvas board.
      if (flatA > 0) {
        ctx.save();
        ctx.globalAlpha = flatA;
        outlinePath(0);
        ctx.fillStyle = BOARD;
        ctx.fill();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (var j = 0; j < g.holes.length; j++) {
          var f = P(g.holes[j].x, g.holes[j].y, 0);
          ctx.moveTo(f[0] + rx, f[1]);
          ctx.ellipse(f[0], f[1], rx, ry, 0, 0, TAU);
        }
        ctx.fillStyle = AMBER;
        ctx.fill();
        ctx.restore();
      }

      // Hole solids, back to front.
      var height = g.H * ext * (1 - sink);
      if (ext > 0 && height > 0.05) {
        var order = g.holes.map(function (q) { return { q: q, d: q.x * sp + q.y * cp }; }).sort(function (a, b) { return a.d - b.d; });
        for (var n = 0; n < order.length; n++) {
          var hq = order[n].q, b0 = P(hq.x, hq.y, 0), t0 = P(hq.x, hq.y, height);
          ctx.beginPath();
          ctx.ellipse(b0[0], b0[1], rx, ry, 0, 0, TAU);
          ctx.fillStyle = '#b45309';
          ctx.fill();
          ctx.fillStyle = '#d97706';
          ctx.fillRect(b0[0] - rx, t0[1], rx, b0[1] - t0[1]);
          ctx.fillStyle = '#b45309';
          ctx.fillRect(b0[0], t0[1], rx, b0[1] - t0[1]);
          ctx.beginPath();
          ctx.ellipse(t0[0], t0[1], rx, ry, 0, 0, TAU);
          ctx.fillStyle = '#fbbf24';
          ctx.fill();
        }
      }
      return { chips: { step: step } };
    },
  };

  // ===== Ventilation: hero. Heat moves from one component to the other; the controller follows it
  // and the slots above open wider.
  var HOT = [
    [0.8, 'A'], [2.4, 'A'], [0.6, 'AtoB'], [1.3, 'moveB'], [2.6, 'B'], [0.6, 'BtoA'], [1.3, 'moveA'], [0.4, 'A'],
  ];
  DEMOS['vent-hotspot'] = {
    period: span(HOT),
    still: 1.6,
    layout: function (w, h) {
      var bw = w * 0.9, bh = h * 0.74, cx = w / 2, cy = h / 2, rad = h * 0.07;
      var sx = Math.max(14, bh / 13.5), sy = sx * 0.58;
      var L = sx * 0.8, W = sy * 0.62;
      var pts = stagger(cx, cy, sx, sy, bw / 2, bh / 2).filter(function (q) {
        return sdRoundRect(q.x, q.y, cx, cy, bw / 2, bh / 2, rad) <= -L / 2 - 3;
      });
      return {
        cx: cx, cy: cy, bw: bw, bh: bh, rad: rad, pts: pts, L: L, W: W, s: uiScale(w, h),
        A: { x: cx - bw * 0.22, y: cy + bh * 0.05, w: bw * 0.2, h: bh * 0.44 },
        B: { x: cx + bw * 0.25, y: cy - bh * 0.06, w: bw * 0.14, h: bh * 0.34 },
        area: bw * bh - (4 - Math.PI) * rad * rad,
      };
    },
    draw: function (ctx, g, t) {
      var ph = phase(t, HOT), name = ph.step[1], u = ph.u;
      var heatA = 1, heatB = 0, pos = 0, cur = 0;
      if (name === 'AtoB') { heatA = 1 - smooth(u); heatB = smooth(u); }
      if (name === 'moveB') { heatA = 0; heatB = 1; pos = ease(u); cur = 1; }
      if (name === 'B') { heatA = 0; heatB = 1; pos = 1; cur = u < 0.15 ? 1 - u / 0.15 : 0; }
      if (name === 'BtoA') { heatA = smooth(u); heatB = 1 - smooth(u); pos = 1; }
      if (name === 'moveA') { pos = 1 - ease(u); cur = 1; }
      if (name === 'A' && ph.i === 7) cur = 1 - u;
      if (name === 'A' && ph.i === 0) cur = 0;
      var hx = lerp(g.A.x, g.B.x, pos), hy = lerp(g.A.y, g.B.y, pos);

      panel(ctx, g.cx - g.bw / 2, g.cy - g.bh / 2, g.bw, g.bh, g.rad);
      [[g.A, heatA], [g.B, heatB]].forEach(function (c) {
        var comp = c[0], heat = c[1];
        if (heat > 0.01) {
          var rg = ctx.createRadialGradient(comp.x, comp.y, 0, comp.x, comp.y, g.bh * 0.55);
          rg.addColorStop(0, 'rgba(239,68,68,' + (0.3 * heat).toFixed(3) + ')');
          rg.addColorStop(1, 'rgba(239,68,68,0)');
          ctx.fillStyle = rg;
          ctx.fillRect(comp.x - g.bh * 0.55, comp.y - g.bh * 0.55, g.bh * 1.1, g.bh * 1.1);
        }
        ctx.beginPath();
        roundRectPath(ctx, comp.x - comp.w / 2, comp.y - comp.h / 2, comp.w, comp.h, 5);
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.14 + 0.2 * heat).toFixed(3) + ')';
        ctx.stroke();
        ctx.setLineDash([]);
      });

      var R = g.bh * 0.56, sum = 0;
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i], k = lerp(0.3, 1, falloff(Math.hypot(q.x - hx, q.y - hy), R));
        var len = g.L * k, wid = g.W * k;
        sum += wid * (len - wid) + Math.PI * wid * wid / 4;
        addCapsule(ctx, q.x, q.y, len, wid, 0);
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      influence(ctx, hx, hy, R);
      handle(ctx, hx, hy, g.s);
      cursor(ctx, hx + 4 * g.s, hy + 5 * g.s, g.s, cur);
      return { out: { points: g.pts.length, ratio: sum / g.area } };
    },
  };

  // ===== Ventilation: swap the hole shape, keep the layout. A wave runs across the panel.
  var VSHAPE_HOLD = 1.8, VSHAPE_SWAP = 0.9;
  DEMOS['vent-shapes'] = {
    period: 4 * (VSHAPE_HOLD + VSHAPE_SWAP),
    still: 0.9,
    layout: function (w, h) {
      var side = Math.min(w, h) * 0.78, cx = w / 2, cy = h * 0.53, sx = side / 9.2;
      var pts = stagger(cx, cy, sx, sx * 0.866, side / 2, side / 2).filter(function (q) {
        return sdRoundRect(q.x, q.y, cx, cy, side / 2, side / 2, side * 0.06) <= -sx * 0.62;
      }).map(function (q) {
        var r = Math.hypot(q.x - cx, q.y - cy) / (side / 2);
        return { x: q.x, y: q.y, size: sx * (0.74 - 0.2 * clamp(r, 0, 1.2)), delay: (q.x - cx + side / 2) / side * 0.45 };
      });
      return { cx: cx, cy: cy, side: side, pts: pts };
    },
    draw: function (ctx, g, t) {
      var per = VSHAPE_HOLD + VSHAPE_SWAP, S = Math.floor(t / per) % 4, local = t - S * per;
      var swapping = local >= VSHAPE_HOLD, tt = local - VSHAPE_HOLD, next = (S + 1) % 4;
      panel(ctx, g.cx - g.side / 2, g.cy - g.side / 2, g.side, g.side, g.side * 0.06);
      function add(shape, q, k) {
        var z = q.size * k;
        if (shape === 0) addCircle(ctx, q.x, q.y, z / 2);
        else if (shape === 1) addCapsule(ctx, q.x, q.y, z * 1.45, z * 0.52, 0);
        else if (shape === 2) addPoly(ctx, q.x, q.y, z * 0.56, 6, Math.PI / 6);
        else addChevron(ctx, q.x, q.y, z * 1.1);
      }
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i];
        if (!swapping) { add(S, q, 1); continue; }
        var l = clamp((tt - q.delay) / 0.44, 0, 1);
        if (l < 0.5) add(S, q, ease(1 - l * 2));
        else add(next, q, ease((l - 0.5) * 2));
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      return { chips: { shape: swapping && tt > 0.45 ? next : S } };
    },
  };

  // ===== Ventilation: a line controller along the exhaust edge; tilt it, bend it into a curve.
  var EDGE = [
    [1.6, 'line'], [1.2, 'tilt'], [1.1, 'tilted'], [0.5, 'mid'], [1.2, 'bend'], [1.6, 'curve'], [1.4, 'reset'], [0.8, 'line'],
  ];
  DEMOS['vent-edge'] = {
    period: span(EDGE),
    still: 1.6 + 1.2 + 1.1 + 0.5 + 1.2 + 0.8,
    layout: function (w, h) {
      var side = Math.min(w, h) * 0.78, cx = w / 2, cy = h * 0.53, x0 = cx - side / 2, y0 = cy - side / 2;
      var sx = side / 12.5;
      var pts = stagger(cx, cy, sx, sx * 0.866, side / 2, side / 2).filter(function (q) {
        return sdRoundRect(q.x, q.y, cx, cy, side / 2, side / 2, side * 0.06) <= -sx * 0.5;
      });
      return {
        cx: cx, cy: cy, side: side, x0: x0, y0: y0, sx: sx, pts: pts, s: uiScale(w, h),
        A: [x0 + side * 0.1, y0 + side * 0.07], B0: [x0 + side * 0.9, y0 + side * 0.07], B1: [x0 + side * 0.9, y0 + side * 0.5],
      };
    },
    draw: function (ctx, g, t) {
      var ph = phase(t, EDGE), name = ph.step[1], u = ph.u;
      var tilt = 0, bend = 0, midA = 0, curve = 0, grab = null, cur = 0;
      if (name === 'tilt') { tilt = ease(u); grab = 'B'; cur = 1; }
      if (name === 'tilted') { tilt = 1; }
      if (name === 'mid') { tilt = 1; midA = smooth(u); curve = 1; }
      if (name === 'bend') { tilt = 1; midA = 1; bend = ease(u); curve = 1; grab = 'C'; cur = 1; }
      if (name === 'curve') { tilt = 1; midA = 1; bend = 1; curve = 1; }
      if (name === 'reset') { tilt = 1 - ease(u); bend = 1 - ease(u); midA = 1 - smooth(u); curve = u < 0.5 ? 1 : 0; }
      var A = g.A, B = [g.B0[0], lerp(g.B0[1], g.B1[1], tilt)];
      var M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      var C = [M[0] - g.side * 0.24 * bend, M[1] + g.side * 0.34 * bend];
      var path = quad(A, C, B, 28);

      panel(ctx, g.cx - g.side / 2, g.cy - g.side / 2, g.side, g.side, g.side * 0.06);
      var R = g.side * 0.42;
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i];
        addCircle(ctx, q.x, q.y, g.sx * (0.08 + 0.34 * falloff(polyDist(q.x, q.y, path), R)));
      }
      ctx.fillStyle = AMBER;
      ctx.fill();

      ctx.beginPath();
      for (var k = 0; k < path.length; k++) { if (k) ctx.lineTo(path[k][0], path[k][1]); else ctx.moveTo(path[k][0], path[k][1]); }
      ctx.lineWidth = 2.2 * g.s;
      ctx.strokeStyle = AMBER;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.stroke();
      if (midA > 0) {
        ctx.save();
        ctx.globalAlpha = midA;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,.4)';
        ctx.beginPath();
        ctx.moveTo(A[0], A[1]);
        ctx.lineTo(C[0], C[1]);
        ctx.lineTo(B[0], B[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        handle(ctx, C[0], C[1], g.s * 0.8, midA);
      }
      handle(ctx, A[0], A[1], g.s * 0.8);
      handle(ctx, B[0], B[1], g.s * 0.8);
      var at = grab === 'C' ? C : B;
      cursor(ctx, at[0] + 3 * g.s, at[1] + 4 * g.s, g.s, cur);
      return { chips: { ctrl: curve } };
    },
  };

  // ===== Ventilation: hole size and spacing are numbers; the web is what is left between them.
  // One row carries the dimensions; the rest of the grid is faded so the labels have room.
  DEMOS['vent-web'] = {
    period: 8,
    still: 2.6,
    layout: function (w, h, env) {
      var D = 3, sMax = 5.2, k = Math.min(w * 0.86 / (3 * sMax + D + 7), h * 0.9 / (D + 14));
      return { w: w, cx: w * 0.47, cy: h * 0.52, D: D, k: k, fs: clamp(Math.min(w, h) / 32, 11, 14), font: env.font };
    },
    draw: function (ctx, g, t, env) {
      var s = 4.4 + 0.8 * Math.cos(TAU * t / 8), web = s - g.D, k = g.k, r = g.D / 2 * k, sk = s * k, fs = g.fs;
      function X(i) { return g.cx + (i + 0.5) * sk; }   // bright row: i = -2 … 1
      ctx.beginPath();
      for (var j = -4; j <= 4; j++) {
        for (var i = -5; i <= 4; i++) {
          if (j === 0 && i >= -2 && i <= 1) continue;
          addCircle(ctx, X(i), g.cy + j * sk, r);
        }
      }
      ctx.fillStyle = 'rgba(245,158,11,.13)';
      ctx.fill();
      ctx.beginPath();
      for (var b = -2; b <= 1; b++) addCircle(ctx, X(b), g.cy, r);
      ctx.fillStyle = AMBER;
      ctx.fill();
      // Centre marks.
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var c = -2; c <= 1; c++) {
        ctx.moveTo(X(c) - 5, g.cy); ctx.lineTo(X(c) + 5, g.cy);
        ctx.moveTo(X(c), g.cy - 5); ctx.lineTo(X(c), g.cy + 5);
      }
      ctx.stroke();

      ctx.font = '600 ' + fs + 'px ' + g.font;
      ctx.textBaseline = 'middle';
      var white = 'rgba(255,255,255,.88)';
      function tag(text, x, y, align, color) {
        var tw = ctx.measureText(text).width, pad = 6, bw = tw + pad * 2, bh = fs + 9;
        var x0 = align === 'center' ? x - bw / 2 : align === 'right' ? x - bw : x;
        x0 = clamp(x0, 6, g.w - bw - 6);
        ctx.beginPath();
        roundRectPath(ctx, x0, y - bh / 2, bw, bh, 6);
        ctx.fillStyle = 'rgba(12,12,12,.9)';
        ctx.fill();
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(text, x0 + pad, y + 0.5);
      }
      function arrow(x, y, dir, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dir * 6, y - 3.5);
        ctx.lineTo(x + dir * 6, y + 3.5);
        ctx.closePath();
        ctx.fill();
      }
      function dim(xa, xb, y, fromY, color, dashed) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(dashed ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(xa, fromY); ctx.lineTo(xa, y + (y > fromY ? 5 : -5));
        ctx.moveTo(xb, fromY); ctx.lineTo(xb, y + (y > fromY ? 5 : -5));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(xa, y); ctx.lineTo(xb, y);
        ctx.stroke();
        // A gap narrower than both arrowheads gets them pointing in from outside.
        var inside = xb - xa > 16;
        arrow(xa, y, inside ? 1 : -1, color);
        arrow(xb, y, inside ? -1 : 1, color);
      }
      var L = env.labels;
      // Spacing: centre to centre, above the row.
      var ySp = g.cy - r - fs * 1.8;
      dim(X(-2), X(-1), ySp, g.cy, white, true);
      tag(L.spacing + '  ' + s.toFixed(1), (X(-2) + X(-1)) / 2, ySp - fs * 1.25, 'center', white);
      // Web: edge to edge, below the row.
      var yWeb = g.cy + r + fs * 1.8;
      dim(X(-1) + r, X(0) - r, yWeb, g.cy, AMBER, false);
      tag(L.web + '  ' + web.toFixed(1), (X(-1) + X(0)) / 2, yWeb + fs * 1.25, 'center', AMBER);
      // Hole diameter: a leader from the right-hand hole.
      var lx = X(1) + r * 0.7071, ly = g.cy - r * 0.7071;
      ctx.strokeStyle = white;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + fs * 1.3, ly - fs * 1.3);
      ctx.lineTo(lx + fs * 2.1, ly - fs * 1.3);
      ctx.stroke();
      tag(L.hole + '  Ø ' + g.D.toFixed(1), lx + fs * 2.1, ly - fs * 1.3, 'left', white);
      return { out: { ratio: Math.PI * g.D * g.D / 4 / (s * s) } };
    },
  };

  // ===== Halftone: hero. The photo is scanned and rebuilt as dots sized by brightness, then inverted.
  var SCAN = [[0.7, 'idle'], [3.0, 'scan'], [2.2, 'hold'], [0.8, 'inv'], [1.8, 'invHold'], [0.8, 'uninv'], [1.0, 'hold2'], [0.7, 'fade']];
  DEMOS['halftone-photo'] = {
    period: span(SCAN),
    still: 0.7 + 3.0 + 1.2,
    needsPhoto: true,
    layout: function (w, h, env) {
      var S = Math.min(h * 0.72, w * 0.38), cy = h * 0.55;
      var left = { x0: w * 0.27 - S / 2, y0: cy - S / 2, S: S }, right = { x0: w * 0.73 - S / 2, y0: cy - S / 2, S: S };
      var sx = S / 34, pts = stagger(right.x0 + S / 2, cy, sx, sx * 0.866, S / 2 - sx * 0.55, S / 2 - sx * 0.55);
      pts.forEach(function (q) {
        q.L = tone(lumAt((q.x - right.x0) / S, (q.y - right.y0) / S));
        q.v = (q.y - right.y0) / S;
      });
      return { w: w, h: h, S: S, sx: sx, left: left, right: right, pts: pts, fs: clamp(S / 20, 10, 13), font: env.font, s: uiScale(w, h) };
    },
    draw: function (ctx, g, t, env) {
      var ph = phase(t, SCAN), name = ph.step[1], u = ph.u;
      var scan = name === 'idle' ? -1 : name === 'scan' ? ease(u) : 2, inv = 0, alpha = 1, invOn = -1;
      if (name === 'inv') { inv = ease(u); invOn = 0; }
      if (name === 'invHold') { inv = 1; invOn = 0; }
      if (name === 'uninv') { inv = 1 - ease(u); invOn = u < 0.5 ? 0 : -1; }
      if (name === 'fade') alpha = 1 - smooth(u);
      var l = g.left, r = g.right;

      ctx.save();
      ctx.beginPath();
      roundRectPath(ctx, l.x0, l.y0, l.S, l.S, 6);
      ctx.clip();
      ctx.drawImage(photo.img, l.x0, l.y0, l.S, l.S);
      ctx.restore();
      boardFrame(ctx, r);

      // Arrow from the photo to the pattern.
      var ax0 = l.x0 + l.S + g.w * 0.045, ax1 = r.x0 - g.w * 0.045, ay = l.y0 + l.S / 2;
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax0, ay); ctx.lineTo(ax1, ay);
      ctx.moveTo(ax1 - 7, ay - 6); ctx.lineTo(ax1, ay); ctx.lineTo(ax1 - 7, ay + 6);
      ctx.stroke();

      var shown = 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i], grow = scan < 0 ? 0 : clamp((scan - q.v) / 0.06, 0, 1);
        if (grow <= 0) continue;
        shown++;
        var f = lerp(q.L, 1 - q.L, inv);
        addCircle(ctx, q.x, q.y, g.sx * (0.04 + 0.5 * f) * ease(grow));
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      ctx.restore();

      if (scan >= 0 && scan <= 1) {
        var y = l.y0 + l.S * scan;
        ctx.fillStyle = 'rgba(245,158,11,.18)';
        ctx.fillRect(l.x0, y - 10, l.S, 10);
        ctx.fillStyle = AMBER;
        ctx.fillRect(l.x0, y - 1, l.S, 2);
        ctx.fillStyle = 'rgba(245,158,11,.5)';
        ctx.fillRect(r.x0, r.y0 + r.S * scan - 0.5, r.S, 1);
      }

      if (g.h >= 240) {
        ctx.font = '500 ' + g.fs + 'px ' + g.font;
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillText(env.labels.photo, l.x0, l.y0 - 7);
        ctx.fillText(env.labels.result, r.x0, r.y0 - 7);
      }
      return { chips: { inv: invOn }, out: { points: name === 'fade' ? g.pts.length : shown } };
    },
  };

  // ===== Halftone: the same photo rebuilt from different shapes; a diagonal wave swaps them.
  var HSHAPE_HOLD = 1.5, HSHAPE_SWAP = 0.9;
  DEMOS['halftone-shapes'] = {
    period: 5 * (HSHAPE_HOLD + HSHAPE_SWAP),
    still: 0.8,
    needsPhoto: true,
    layout: function (w, h) {
      var b = photoBoard(w, h, 0.03), sx = b.S / 23;
      var pts = sampleAll(b, stagger(b.cx, b.cy, sx, sx * 0.866, b.S / 2 - sx * 0.6, b.S / 2 - sx * 0.6));
      pts.forEach(function (q) { q.delay = ((q.x - b.x0) + (q.y - b.y0)) / (2 * b.S) * 0.45; });
      return { b: b, sx: sx, pts: pts };
    },
    draw: function (ctx, g, t) {
      var per = HSHAPE_HOLD + HSHAPE_SWAP, S = Math.floor(t / per) % 5, local = t - S * per;
      var swapping = local >= HSHAPE_HOLD, tt = local - HSHAPE_HOLD, next = (S + 1) % 5;
      boardFrame(ctx, g.b);
      function add(shape, q, k) {
        var d = g.sx * (0.1 + 0.88 * q.L) * k;
        if (shape === 0) addCircle(ctx, q.x, q.y, d / 2);
        else if (shape === 1) addRoundSquare(ctx, q.x, q.y, d * 0.84, d * 0.16);
        else if (shape === 2) addStar(ctx, q.x, q.y, d * 0.58, 0.46, 5, -Math.PI / 2);
        else if (shape === 3) addPoly(ctx, q.x, q.y, d * 0.54, 6, Math.PI / 6);
        else addLogo(ctx, q.x, q.y, d * 0.98);
      }
      ctx.beginPath();
      for (var i = 0; i < g.pts.length; i++) {
        var q = g.pts[i];
        if (!swapping) { add(S, q, 1); continue; }
        var l = clamp((tt - q.delay) / 0.44, 0, 1);
        if (l < 0.5) add(S, q, ease(1 - l * 2));
        else add(next, q, ease((l - 0.5) * 2));
      }
      ctx.fillStyle = AMBER;
      ctx.fill();
      return { chips: { shape: swapping && tt > 0.45 ? next : S } };
    },
  };

  // ===== Halftone: grid, concentric rings, Fibonacci spiral, flow lines. Crossfades between them.
  var HLAY_HOLD = 1.8, HLAY_FADE = 0.8;
  DEMOS['halftone-layouts'] = {
    period: 4 * (HLAY_HOLD + HLAY_FADE),
    still: 0.8,
    needsPhoto: true,
    layout: function (w, h) {
      var b = photoBoard(w, h, 0.03), sx = b.S / 29, pad = sx * 0.5;
      var inside = insideBoard(b, pad);
      var grid = sampleAll(b, stagger(b.cx, b.cy, sx, sx * 0.866, b.S / 2 - pad, b.S / 2 - pad));
      var conc = [], Rmax = b.S * 0.72;
      for (var k = 0; k * sx <= Rmax; k++) {
        var rr = k * sx * 0.95, m = Math.max(1, Math.round(TAU * rr / sx));
        for (var j = 0; j < m; j++) {
          var a = j / m * TAU + k * 0.5;
          conc.push({ x: b.cx + Math.cos(a) * rr, y: b.cy + Math.sin(a) * rr });
        }
      }
      conc = sampleAll(b, conc.filter(inside));
      var fib = [], N = Math.round(Math.PI * Rmax * Rmax / (sx * sx * 0.9));
      for (var i = 0; i < N; i++) {
        var fr = Rmax * Math.sqrt((i + 0.5) / N), fa = i * GOLDEN;
        fib.push({ x: b.cx + Math.cos(fa) * fr, y: b.cy + Math.sin(fa) * fr });
      }
      fib = sampleAll(b, fib.filter(inside));
      // Flow lines: vertical lines that drift sideways; width follows the photo.
      var lines = [], ls = b.S / 34, stepY = Math.max(2, b.S / 160);
      for (var x = b.x0 - ls * 2.5; x < b.x0 + b.S + ls * 3; x += ls) {
        var line = [];
        for (var y = b.y0 + 2; y <= b.y0 + b.S - 2; y += stepY) {
          // One smooth displacement field for every line, so neighbours bend together and never cross.
          var v = (y - b.y0) / b.S, off = ls * 2.2 * Math.sin(TAU * (0.8 * v + 0.3 * (x - b.x0) / b.S));
          var xx = x + off;
          line.push([xx, y, tone(lumAt((xx - b.x0) / b.S, v))]);
        }
        lines.push(line);
      }
      return { b: b, sx: sx, ls: ls, sets: [grid, conc, fib], lines: lines };
    },
    draw: function (ctx, g, t) {
      var per = HLAY_HOLD + HLAY_FADE, L = Math.floor(t / per) % 4, local = t - L * per;
      var fade = local < HLAY_HOLD ? 0 : smooth((local - HLAY_HOLD) / HLAY_FADE), next = (L + 1) % 4;
      boardFrame(ctx, g.b);
      function paint(which, alpha) {
        if (alpha <= 0.01) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        if (which < 3) {
          var pts = g.sets[which];
          for (var i = 0; i < pts.length; i++) addCircle(ctx, pts[i].x, pts[i].y, g.sx * (0.04 + 0.44 * pts[i].L));
        } else {
          // Lines run past the board on both sides; the board clips them like the app's boundary does.
          ctx.rect(g.b.x0, g.b.y0, g.b.S, g.b.S);
          ctx.clip();
          ctx.beginPath();
          for (var n = 0; n < g.lines.length; n++) {
            var line = g.lines[n], k;
            for (k = 0; k < line.length; k++) {
              var hw = g.ls * (0.03 + 0.38 * line[k][2]);
              if (k) ctx.lineTo(line[k][0] + hw, line[k][1]); else ctx.moveTo(line[k][0] + hw, line[k][1]);
            }
            for (k = line.length - 1; k >= 0; k--) ctx.lineTo(line[k][0] - g.ls * (0.03 + 0.38 * line[k][2]), line[k][1]);
            ctx.closePath();
          }
        }
        ctx.fillStyle = AMBER;
        ctx.fill();
        ctx.restore();
      }
      paint(L, 1 - fade);
      paint(next, fade);
      return { chips: { layout: fade > 0.5 ? next : L } };
    },
  };

  // ===== Halftone: brightness drives size, then the angle of short strokes, then a circle → star morph.
  var HDRV_HOLD = 2.3, HDRV_FADE = 0.7;
  DEMOS['halftone-drive'] = {
    period: 3 * (HDRV_HOLD + HDRV_FADE),
    still: 0.8,
    needsPhoto: true,
    layout: function (w, h) {
      var b = photoBoard(w, h, 0.03), sx = b.S / 25;
      var pts = sampleAll(b, stagger(b.cx, b.cy, sx, sx * 0.866, b.S / 2 - sx * 0.6, b.S / 2 - sx * 0.6));
      return { b: b, sx: sx, pts: pts };
    },
    draw: function (ctx, g, t) {
      var per = HDRV_HOLD + HDRV_FADE, M = Math.floor(t / per) % 3, local = t - M * per;
      var fade = local < HDRV_HOLD ? 0 : smooth((local - HDRV_HOLD) / HDRV_FADE), next = (M + 1) % 3;
      boardFrame(ctx, g.b);
      function paint(mode, alpha) {
        if (alpha <= 0.01) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (var i = 0; i < g.pts.length; i++) {
          var q = g.pts[i];
          if (mode === 0) addCircle(ctx, q.x, q.y, g.sx * (0.05 + 0.5 * q.L));
          else if (mode === 1) addBar(ctx, q.x, q.y, g.sx * 0.92, g.sx * 0.26, (1 - q.L) * Math.PI / 2);
          else addLobes(ctx, q.x, q.y, g.sx * 0.47, 0.62 * (1 - q.L), 5);
        }
        ctx.fillStyle = AMBER;
        ctx.fill();
        ctx.restore();
      }
      paint(M, 1 - fade);
      paint(next, fade);
      return { chips: { mode: fade > 0.5 ? next : M } };
    },
  };

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
    var def = DEMOS[frame.getAttribute('data-kw-demo')];
    var canvas = frame.querySelector('canvas');
    if (!def || !canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var lang = document.documentElement.lang || 'en';
    var nf, pf;
    try {
      nf = new Intl.NumberFormat(lang);
      pf = new Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
    } catch (err) {
      nf = { format: String };
      pf = { format: function (x) { return (x * 100).toFixed(1) + '%'; } };
    }
    var labels = {};
    each(frame.attributes, function (a) { if (a.name.indexOf('data-kw-l-') === 0) labels[a.name.slice(10)] = a.value; });
    var env = { labels: labels, font: (getComputedStyle(frame).fontFamily || 'sans-serif') };

    var chips = {};
    each(frame.querySelectorAll('[data-kw-chip]'), function (el) {
      var parts = el.getAttribute('data-kw-chip').split(':');
      (chips[parts[0]] = chips[parts[0]] || []).push({ el: el, i: +parts[1] });
    });
    var outs = {};
    each(frame.querySelectorAll('[data-kw-out]'), function (el) { outs[el.getAttribute('data-kw-out')] = el; });
    var shown = {};

    var w = 0, h = 0, dpr = 1, geo = null, ready = !def.needsPhoto;
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
      if (!geo && ready) geo = def.layout(w, h, env);
      return !!geo;
    }

    function apply(ui) {
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
          var text = key === 'ratio' ? pf.format(ui.out[key]) : nf.format(ui.out[key]);
          if (shown['o:' + key] !== text) { shown['o:' + key] = text; outs[key].textContent = text; }
        }
      }
    }

    function paint(t) {
      if (!measure()) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      apply(def.draw(ctx, geo, t, env) || {});
    }

    function frameLoop(now) {
      raf = 0;
      if (!visible) return;
      if (t0 === null) t0 = now;
      paint(((now - t0) / 1000) % def.period);
      raf = requestAnimationFrame(frameLoop);
    }
    function play() { if (!raf && visible && ready && !reduce) raf = requestAnimationFrame(frameLoop); }

    function redrawStill() { if (ready && (reduce || !raf)) paint(reduce ? def.still : 0); }

    if ('ResizeObserver' in window) new ResizeObserver(function () { geo = null; redrawStill(); }).observe(canvas);
    else window.addEventListener('resize', function () { geo = null; redrawStill(); });

    whenVisible(frame, function (on, gone) {
      visible = on;
      if (gone) t0 = null;  // fully off screen: start over next time
      if (on) play();
    });

    function onReady() {
      ready = true;
      geo = null;
      paint(reduce ? def.still : 0);
      play();
    }
    if (def.needsPhoto) needPhoto(frame.getAttribute('data-kw-src'), onReady);
    else onReady();
  }

  function init() { each(document.querySelectorAll('[data-kw-demo]'), start); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
