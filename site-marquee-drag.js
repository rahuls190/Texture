// 官網首頁那幾條橫向輪播（.sv-marquee > .sv-track）的手勢拖曳。手機上原本只能看著
// CSS 動畫自己跑，滑不動也倒不回去；這支讓觸控與滑鼠都能直接拖，放開後接回原本的
// 動畫。為了 CSP 不開 'unsafe-inline' 外移成獨立檔，頁面用 <script src defer> 載入。
//
// 為什麼不用 overflow-x: auto 原生捲動：軌道是「同一份內容排兩次、平移 -50% 無縫接回」
// 的無限跑馬燈，改成原生捲動就會捲到盡頭停住，動畫也保不住。所以拖曳期間把
// animation-name 關成 none 改寫 inline transform，放開再用**負的 animation-delay**
// 把動畫接回同一個相位（見下面 resume() 的推導），視覺上不會跳一下。
//
// touch-action: pan-y 寫在 CSS（見 pages/landing/en/index.html 的 <style>）：直向捲動
// 交給瀏覽器，橫向手勢才會進到這裡，所以全程不需要 preventDefault。
(function () {
  if (window.__svMarqueeDragWired) return;
  window.__svMarqueeDragWired = true;

  // 超過這個位移才算拖曳。之前是點擊（第一排的圖是 <a href="/explore/…">），
  // 手指難免抖幾 px，門檻太低會把點擊都吃掉。
  var THRESHOLD = 6;

  function currentX(el) {
    var t = window.getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    var m = t.match(/^matrix3d\((.+)\)$/);
    if (m) return parseFloat(m[1].split(',')[12]) || 0;
    m = t.match(/^matrix\((.+)\)$/);
    if (m) return parseFloat(m[1].split(',')[4]) || 0;
    return 0;
  }

  function seconds(value) {
    var n = parseFloat(value);
    if (!n) return 0;
    return /ms$/.test((value || '').trim()) ? n / 1000 : n;
  }

  // 把位移收進 (-half, 0]。兩份內容一模一樣，落在這個區間的任何位置畫面都是滿的。
  function norm(x, half) {
    if (!half) return x;
    x = x % half;
    return x > 0 ? x - half : x;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function wire(viewport) {
    var track = viewport.querySelector('.sv-track');
    if (!track) return;
    viewport.classList.add('sv-marquee--drag');

    var pointerId = null;   // 目前這根手指／這顆滑鼠鍵
    var dragging = false;   // 已經超過門檻，正在拖
    var suppressClick = false;
    var startX = 0, startY = 0, startOffset = 0;
    var half = 0, duration = 0, reverse = false;
    var offset = 0;

    function freeze() {
      // 一半的寬度＝一份內容的寬度（尾端的 pr-4 讓兩份之間也留著同樣的間距，
      // 所以 -50% 才會無縫）。每次按下都重量，免得字體或圖片載入後尺寸變了。
      half = track.getBoundingClientRect().width / 2;
      var cs = window.getComputedStyle(track);
      duration = seconds(cs.animationDuration);
      reverse = cs.animationDirection === 'reverse';
      startOffset = currentX(track);
      // CSS 動畫的計算值蓋得過 inline style，所以要真的把 animation-name 關掉，
      // 光是 animation-play-state: paused 沒有用。
      track.style.animationName = 'none';
      track.style.transform = 'translate3d(' + startOffset + 'px,0,0)';
      viewport.classList.add('sv-marquee--dragging');
    }

    function resume() {
      viewport.classList.remove('sv-marquee--dragging');
      // 動畫關掉時（prefers-reduced-motion）就停在拖到的位置，別把它接回去跑。
      if (!duration || reducedMotion()) return;
      // 關鍵影格是 0% → translateX(0)、100% → translateX(-half)，正向播放時
      // x = -half·k，反向播放時 x = -half·(1-k)（k 是 0→1 的進度）。負的
      // animation-delay 等於「動畫已經跑了 k·duration」，所以解出 k 再回填即可。
      var k = reverse ? 1 + offset / half : -offset / half;
      k = ((k % 1) + 1) % 1;
      track.style.animationDelay = (-k * duration) + 's';
      track.style.transform = '';
      track.style.animationName = '';
    }

    viewport.addEventListener('pointerdown', function (event) {
      if (pointerId !== null) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerId = event.pointerId;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
    });

    viewport.addEventListener('pointermove', function (event) {
      if (event.pointerId !== pointerId) return;
      var dx = event.clientX - startX;
      if (!dragging) {
        // 直向滑得比橫向多就當成在捲頁面，這一次手勢不接管
        // （touch-action: pan-y 之下瀏覽器會自己捲，我們只要別跟著動）。
        if (Math.abs(dx) <= THRESHOLD) {
          if (Math.abs(event.clientY - startY) > THRESHOLD) pointerId = null;
          return;
        }
        dragging = true;
        freeze();
        if (viewport.setPointerCapture) {
          try { viewport.setPointerCapture(event.pointerId); } catch (e) {}
        }
      }
      offset = norm(startOffset + dx, half);
      track.style.transform = 'translate3d(' + offset + 'px,0,0)';
    });

    function end(event) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      // 拖完手指放開時瀏覽器還是會補一個 click，不擋的話第一排會直接跳去 /explore。
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      resume();
    }

    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);

    viewport.addEventListener('click', function (event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    // 桌機把圖片拖出去的原生行為會蓋掉我們的手勢（游標變成一張半透明縮圖）。
    viewport.addEventListener('dragstart', function (event) { event.preventDefault(); });
  }

  function init() {
    var rails = document.querySelectorAll('.sv-marquee');
    for (var i = 0; i < rails.length; i++) wire(rails[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
