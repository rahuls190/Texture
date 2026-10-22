// /guides/wrap/<lang>（HueScript Wrap 指南）的頁內行為：各步驟的示範片捲到畫面裡才播、離開就停，
// 點一下暫停／繼續。hero 那支照 autoplay 自己播。減少動態效果時都不自動播，改成留在封面＋原生控制列。
// 頁面由 scripts/generate-guide-wrap-pages.mjs 產生，用 <script src="/site-guide-wrap.js" defer> 載入（CSP 不開 'unsafe-inline'）。
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var videos = document.querySelectorAll('video[data-wg-video]');

  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i]); }

  each(videos, function (v) {
    if (reduce) {
      v.removeAttribute('autoplay');
      v.pause();
      v.controls = true;
      return;
    }
    // iOS 省電模式會擋自動播放，留在封面：點一下就播
    v.addEventListener('click', function () {
      v.dataset.wgPaused = v.paused ? '' : '1';
      if (v.paused) v.play(); else v.pause();
    });
  });

  if (reduce || !('IntersectionObserver' in window)) return;

  var steps = [];
  each(videos, function (v) { if (v.getAttribute('data-wg-video') !== 'hero') steps.push(v); });
  var io = new IntersectionObserver(function (entries) {
    each(entries, function (e) {
      var v = e.target;
      if (e.isIntersecting && e.intersectionRatio >= 0.35) {
        // 使用者自己按停的就別再自動播
        if (v.dataset.wgPaused !== '1') {
          var p = v.play();
          if (p && p.catch) p.catch(function () { /* 被擋就留在封面 */ });
        }
      } else if (!v.paused) {
        v.pause();
      }
    });
  }, { threshold: [0, 0.35, 0.7] });
  each(steps, function (v) { io.observe(v); });
})();
