// 教學頁（/tutorial/<lang>）的頁內行為：側欄 scroll-spy、影片佈位圖、行動版側欄、
// 舊語言切換器、🥚 折扣碼彩蛋。原本內嵌在 12 個語系頁各一份（內容相同），為了 CSP
// 不開 'unsafe-inline' 外移成這一支（roadmap R-3）。用 <script src="/site-tutorial.js" defer> 載入。
(function() {
  // Scroll spy for sidebar navigation
  var navLinks = document.querySelectorAll('.nav-link');
  var articles = document.querySelectorAll('article[id]');

  function updateActiveLink() {
    var scrollPos = window.scrollY + 120;
    var current = '';
    articles.forEach(function(article) {
      if (article.offsetTop <= scrollPos) {
        current = article.id;
      }
    });
    navLinks.forEach(function(link) {
      link.classList.remove('active');
      if (link.getAttribute('href') === '#' + current) {
        link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', updateActiveLink);
  updateActiveLink();

  // Hide placeholder when video loads successfully
  var videos = document.querySelectorAll('.video-container video');
  videos.forEach(function(video) {
    var hidePlaceholder = function() {
      var placeholder = video.parentElement.querySelector('.video-placeholder');
      if (placeholder) placeholder.style.display = 'none';
    };
    // Metadata may already be loaded before this script runs
    if (video.readyState >= 1) hidePlaceholder();
    video.addEventListener('loadedmetadata', hidePlaceholder);
    video.addEventListener('play', hidePlaceholder);
    video.addEventListener('error', function() {
      video.style.display = 'none';
    });
  });

  // Mobile sidebar toggle (show categories on small screens)
  var mobileNav = document.querySelector('aside');
  if (window.innerWidth < 1024 && mobileNav) {
    mobileNav.style.display = 'none';
  }

  // Language switcher
  var langLabels = { 'zh-TW': '繁中', 'zh-CN': '简中', en: 'EN', ja: '日本語', ko: '한국어', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', tr: 'TR', th: 'ไทย' };
  var pathParts = window.location.pathname.replace(/\/+$/, '').split('/');
  var lastPart = pathParts[pathParts.length - 1];
  var currentLang = langLabels[lastPart] ? lastPart : 'zh-TW';
  var currentLabel = document.getElementById('lang-current');
  if (currentLabel) currentLabel.textContent = langLabels[currentLang] || '繁中';
  var langLinks = document.querySelectorAll('#lang-dropdown a[data-lang]');
  langLinks.forEach(function(link) {
    if (link.getAttribute('data-lang') === currentLang) link.classList.add('active');
  });
  document.addEventListener('click', function(e) {
    var switcher = document.getElementById('lang-switcher');
    var dropdown = document.getElementById('lang-dropdown');
    if (switcher && dropdown && !switcher.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Easter egg
  var EGG_CODE = 'M4NTC5MG';
  var eggTrigger = document.getElementById('egg-trigger');
  var eggOverlay = document.getElementById('egg-overlay');
  var eggClose = document.getElementById('egg-close');
  var eggCopy = document.getElementById('egg-copy');
  var eggCopied = document.getElementById('egg-copied');

  function eggConfetti() {
    var colors = ['#f59e0b', '#fbbf24', '#fde68a', '#ffffff'];
    for (var i = 0; i < 60; i++) {
      var piece = document.createElement('div');
      piece.className = 'egg-confetti';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.width = (6 + Math.random() * 6) + 'px';
      piece.style.height = (8 + Math.random() * 8) + 'px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.animationDuration = (2 + Math.random() * 2.5) + 's';
      piece.style.animationDelay = (Math.random() * 0.8) + 's';
      piece.addEventListener('animationend', function() { this.remove(); });
      document.body.appendChild(piece);
    }
  }

  if (eggTrigger && eggOverlay) {
    eggTrigger.addEventListener('click', function() {
      eggOverlay.classList.add('open');
      eggConfetti();
    });
    eggOverlay.addEventListener('click', function(e) {
      if (e.target === eggOverlay) eggOverlay.classList.remove('open');
    });
    if (eggClose) eggClose.addEventListener('click', function() {
      eggOverlay.classList.remove('open');
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') eggOverlay.classList.remove('open');
    });
    if (eggCopy) eggCopy.addEventListener('click', function() {
      function copied() {
        if (!eggCopied) return;
        eggCopied.style.opacity = '1';
        setTimeout(function() { eggCopied.style.opacity = '0'; }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(EGG_CODE).then(copied);
      } else {
        var ta = document.createElement('textarea');
        ta.value = EGG_CODE;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        copied();
      }
    });
  }
})();
