// 頁尾「複製 email」按鈕（[data-sv-copy]）。原本以兩種形式內嵌：site-chrome.mjs 的
// COPY_EMAIL_SCRIPT（逐顆綁定）與 pages/shared/siteFooterHtml.mjs 的 wireFooterCopy（委派）。
// 為了 CSP 不開 'unsafe-inline' 外移成這一支（roadmap R-3）；用 document 層委派，
// 兩種 footer 都吃得到，也不怕按鈕晚於 script 出現。React 頁不載這支——它們在 effect
// 裡直接呼叫 wireFooterCopy()。用 <script src="/site-copy.js" defer> 載入。
(function () {
  if (window.__svCopyWired) return;
  window.__svCopyWired = true;
  document.addEventListener('click', function (event) {
    var btn = event.target && event.target.closest ? event.target.closest('[data-sv-copy]') : null;
    if (!btn) return;

    var mail = btn.querySelector('.sv-copy-icon');
    var check = btn.querySelector('.sv-copy-check');
    var toast = btn.querySelector('.sv-copy-toast');
    var flash = function () {
      if (mail) mail.style.display = 'none';
      if (check) check.style.display = '';
      if (toast) toast.style.display = '';
      clearTimeout(btn._svCopyTimer);
      btn._svCopyTimer = setTimeout(function () {
        if (mail) mail.style.display = '';
        if (check) check.style.display = 'none';
        if (toast) toast.style.display = 'none';
      }, 2000);
    };
    var legacyCopy = function (text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      flash();
    };

    var text = btn.getAttribute('data-sv-copy');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash, function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  });
})();
