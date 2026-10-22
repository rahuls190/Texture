// 指南頁右側「本頁內容」目錄的目前位置標示。外部檔是因為 CSP 不開 'unsafe-inline'；
// 頁面用 <script src="/site-toc.js" defer> 載入。
// .sv-toc 裡每個 a[href="#id"] 對應頁面上的 h2#id；標題捲過畫面上方四分之一的那一段算「目前這段」，
// 它的連結加 aria-current（樣式在頁面的 <style>）。還沒捲到第一段時不標。
(function () {
  var toc = document.querySelector('.sv-toc');
  if (!toc) return;
  var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
  var heads = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });

  function update() {
    var limit = window.innerHeight * 0.25, current = -1;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i] && heads[i].getBoundingClientRect().top <= limit) current = i;
    }
    for (var j = 0; j < links.length; j++) {
      if (j === current) links[j].setAttribute('aria-current', 'true');
      else links[j].removeAttribute('aria-current');
    }
  }

  var queued = false;
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; update(); });
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
