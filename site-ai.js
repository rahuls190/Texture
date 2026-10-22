// /ai 頁（scripts/generate-ai-pages.mjs）的示範動畫與複製按鈕。
// 外部檔是因為 CSP 不開 'unsafe-inline'。同步載入：先在 <html> 標上 sv-js，示範才會從隱藏開始。
//
//   [data-sv-demo]  [data-at="n"] 依序加上 is-on。每一步停多久＝那一步元素的 data-hold（毫秒，取最大，預設 500）。
//                   [data-off="m"] 到第 m 步收掉（AI 回覆前的「…」）；比目前早的步驟加 is-done（工具標籤變綠點）。
//                   播完停在完成畫面，標題列露出「重播」。播到一半完全捲出畫面會倒回、捲回來從頭；播完的不倒回。
//                   圖解碼完才起跑；逾時先跑，圖晚到就重演。
//   [data-sv-steps] [data-screen] 與 [data-goto] 自動輪播（手機上目前那一步的字寫進 .sv-stepcap）；[data-type] 一個字一個字打，打完才按 .sv-press；
//                   每一步的長度寫進 --dur 給進度條。點步驟就停在那一步。
//   [data-sv-copytext] 按下複製，按鈕文字暫時換成 data-copied
//   prefers-reduced-motion：示範直接停在最後一格，打字直接是完整的字，不自動輪播。
(function () {
  document.documentElement.classList.add('sv-js');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // cb(on, gone)：on = 露出兩成以上；gone = 完全離開畫面
  function whenVisible(el, cb) {
    if (!('IntersectionObserver' in window)) { cb(true, false); return; }
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      cb(e.intersectionRatio >= 0.19, !e.isIntersecting || e.intersectionRatio <= 0);
    }, { threshold: [0, 0.2] }).observe(el);
  }

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  // 同 site-ai.js：圖沒解碼就起跑，展開會演在空盒子上。lazy 圖先改 eager，SVG 的 <image> 用 Image 暖快取。
  function whenImagesReady(demo, cb, late) {
    var waits = [];
    each(demo.querySelectorAll('img'), function (el) { waits.push(el); });
    each(demo.querySelectorAll('image'), function (el) {
      var url = el.getAttribute('href') || el.getAttribute('xlink:href');
      if (!url) return;
      var warm = new Image();
      warm.src = url;
      waits.push(warm);
    });
    var left = waits.length, done = false;
    function fire() { if (done) return; done = true; clearTimeout(bail); cb(); }
    var bail = setTimeout(fire, 3000);
    if (!left) return fire();
    function one() {
      if (--left > 0) return;
      if (done) { if (late) late(); } else fire();
    }
    each(waits, function (el) {
      if (el.loading === 'lazy') el.loading = 'eager';
      var settled = false;
      function settle() { if (settled) return; settled = true; one(); }
      function wait() {
        if (el.complete) return settle();
        el.addEventListener('load', settle);
        el.addEventListener('error', settle);
      }
      var p = null;
      try { p = el.decode ? el.decode() : null; } catch (err) { p = null; }
      if (p && p.then) p.then(settle, wait);
      else wait();
    });
  }

  function initDemo(demo) {
    var items = demo.querySelectorAll('[data-at]');
    var replay = demo.querySelector('.sv-replay');
    var last = 0;
    each(items, function (el) { last = Math.max(last, +el.getAttribute('data-at')); });
    var step = 0, timer = null, visible = false, ready = false, arming = false, done = false;
    function paint() {
      each(items, function (el) {
        var at = +el.getAttribute('data-at');
        var off = el.hasAttribute('data-off') ? +el.getAttribute('data-off') : Infinity;
        el.classList.toggle('is-on', at <= step && step < off);
        el.classList.toggle('is-done', at < step);
      });
    }
    function holdFor(s) {
      var ms = 0;
      each(items, function (el) {
        if (+el.getAttribute('data-at') === s) ms = Math.max(ms, +(el.getAttribute('data-hold') || 0));
      });
      return ms || 500;
    }
    if (reduce) { step = last; paint(); return; }
    function advance() {
      timer = null;
      step += 1;
      paint();
      if (step >= last) { done = true; if (replay) replay.hidden = false; return; }
      timer = setTimeout(advance, holdFor(step));
    }
    function stop() { if (timer) { clearTimeout(timer); timer = null; } }
    // 從頭開始馬上出第一格；停在半途後恢復，先等一下再走，不要一回來就跳一格
    function start() { if (!visible || !ready || timer || done) return; timer = setTimeout(advance, step ? 400 : 0); }
    function rewind() { stop(); step = 0; done = false; if (replay) replay.hidden = true; paint(); }
    if (replay) replay.addEventListener('click', function () { rewind(); setTimeout(start, 400); });
    whenVisible(demo, function (on, gone) {
      visible = on;
      if (!on) { stop(); if (gone && !done) rewind(); return; }
      if (ready) return start();
      if (arming) return;
      arming = true;
      whenImagesReady(demo, function () { ready = true; start(); }, function () {
        rewind();      // 圖比逾時晚到：那一輪是在空盒子上演的，重演一次
        start();
      });
    });
  }

  // 以字素為單位切（泰文的附加符號、emoji 不會被拆開）
  function graphemes(text) {
    if (window.Intl && Intl.Segmenter && Array.from) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function (s) { return s.segment; });
    }
    return Array.from ? Array.from(text) : text.split('');
  }

  function initSteps(box) {
    var screens = box.querySelectorAll('[data-screen]');
    var tabs = box.querySelectorAll('[data-goto]');
    var cap = box.querySelector('.sv-stepcap');
    var n = screens.length, cur = 0, timer = null, manual = false, visible = false, pending = [];
    function later(fn, ms) { pending.push(setTimeout(fn, ms)); }
    function clearPending() {
      each(pending, function (id) { clearTimeout(id); });
      pending = [];
      if (timer) { clearTimeout(timer); timer = null; }
    }
    // 在 at 毫秒開始打 el 的字，回傳打完的時間點。整段最多約 1.1 秒，短字每字 55 毫秒。
    function typeInto(el, at) {
      var chars = graphemes(el.getAttribute('data-type'));
      var per = Math.min(55, 1100 / Math.max(chars.length, 1));
      el.textContent = '';
      later(function () { el.classList.add('is-typing'); }, at);
      chars.forEach(function (ch, i) {
        later(function () { el.textContent = chars.slice(0, i + 1).join(''); }, at + per * (i + 1));
      });
      var end = at + per * chars.length;
      later(function () { el.classList.remove('is-typing'); }, end + 400);
      return end;
    }
    function show(i) {
      clearPending();
      cur = i;
      // 先全部拿掉 is-on 再加回去，進度條的動畫才會從頭跑
      each(tabs, function (t) { t.classList.remove('is-on'); });
      void box.offsetWidth;
      each(screens, function (s) { s.classList.toggle('is-on', +s.getAttribute('data-screen') === i); });
      each(tabs, function (t) {
        var on = +t.getAttribute('data-goto') === i;
        t.classList.toggle('is-on', on);
        if (on) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
        // 手機只顯示編號，目前那一步的字放在下面那一行
        if (on && cap) cap.textContent = t.lastElementChild.textContent;
      });
      var screen = screens[i];
      var types = screen.querySelectorAll('[data-type]');
      var presses = screen.querySelectorAll('.sv-press');
      each(presses, function (p) { p.classList.remove('is-press'); });
      if (reduce) { each(types, function (el) { el.textContent = el.getAttribute('data-type'); }); return; }
      var t = 350;  // 等畫面淡入
      each(types, function (el) { t = typeInto(el, t) + 250; });
      var pressAt = types.length ? t : 700;
      each(presses, function (p) { later(function () { p.classList.add('is-press'); }, pressAt); });
      var dur = +(screen.getAttribute('data-hold') || 0) || Math.max(2400, presses.length ? pressAt + 1500 : t + 1300);
      box.style.setProperty('--dur', dur + 'ms');
      if (!manual && visible) timer = setTimeout(function () { show((cur + 1) % n); }, dur);
    }
    each(tabs, function (t) {
      t.addEventListener('click', function () {
        manual = true;
        box.classList.add('is-manual');
        show(+t.getAttribute('data-goto'));
      });
    });
    show(0);
    if (reduce) return;
    whenVisible(box, function (on) {
      if (on === visible) return;
      visible = on;
      box.classList.toggle('is-paused', !on);
      // 捲回來就重演目前這一步：打到一半被捲走的字才補得回來（點過步驟的話 show 不會排下一步）
      if (on) show(cur);
      else clearPending();
    });
  }

  document.addEventListener('click', function (event) {
    var btn = event.target && event.target.closest ? event.target.closest('[data-sv-copytext]') : null;
    if (!btn || !navigator.clipboard) return;
    if (!btn.hasAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    navigator.clipboard.writeText(btn.getAttribute('data-sv-copytext')).then(function () {
      btn.textContent = btn.getAttribute('data-copied') || '✓';
      clearTimeout(btn._svTimer);
      btn._svTimer = setTimeout(function () { btn.textContent = btn.getAttribute('data-label'); }, 1600);
    }, function () {});
  });

  function init() {
    each(document.querySelectorAll('[data-sv-demo]'), initDemo);
    each(document.querySelectorAll('[data-sv-steps]'), initSteps);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
