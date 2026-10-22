// 官網首頁「把連結寄到手機」卡片（.sv-send-link）。原本內嵌在 pages/landing/en/index.html
// 並複製到 12 個語系，為了 CSP 不開 'unsafe-inline' 外移（roadmap R-3）。
// 錯誤文字從卡片內的 [data-sl="err-*"] 節點讀，所以各語系共用這一支。
// 用 <script src="/site-sendlink.js" defer> 載入。
(function () {
  // Anon key is the same public credential the app bundle ships; RLS
  // limits it to inserting capture rows, exactly like the app's form.
  var SB_URL = 'https://mjoromqyjrjczgwhmyjf.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qb3JvbXF5anJqY3pnd2hteWpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNzQxMzQsImV4cCI6MjA4NDY1MDEzNH0.AEhqu5_C6t4AK1yIMt7GdBhdjDCthGjEfzkOkZbRpFk';
  // Two cards ship on mobile (hero and closing section); each one gets
  // its own state, so a submit in the top card leaves the bottom one
  // untouched.
  Array.prototype.forEach.call(document.querySelectorAll('.sv-send-link'), function (root) {
    var form = root.querySelector('form');
    if (!form) return;
    var input = form.querySelector('input');
    var button = form.querySelector('button');
    var errorEl = root.querySelector('[data-sl="error"]');
    var msg = {
      invalid: root.querySelector('[data-sl="err-invalid"]').textContent,
      generic: root.querySelector('[data-sl="err-generic"]').textContent,
    };
    // A page cached from before err-limit existed falls back to the generic text.
    var limitEl = root.querySelector('[data-sl="err-limit"]');
    msg.limit = limitEl ? limitEl.textContent : msg.generic;
    var busy = false;
    function showError(text) {
      errorEl.textContent = text;
      errorEl.classList.toggle('hidden', !text);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError(msg.invalid); return; }
      busy = true;
      button.disabled = true;
      showError('');
      var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY };
      fetch(SB_URL + '/rest/v1/mobile_email_captures', {
        method: 'POST',
        headers: { 'Content-Type': headers['Content-Type'], 'Authorization': headers.Authorization, 'apikey': SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ email: email, user_id: null, source_url: location.href }),
      }).then(function (res) {
        if (!res.ok) throw new Error('insert failed');
        // The capture row is the source of truth, so only one answer from
        // the mail hop changes the UI: 429 means this address already got
        // its links today (3 per recipient per day). A 5xx, a network error
        // or a hop slower than 8 s still shows success, as before.
        var sent = fetch(SB_URL + '/functions/v1/send-mobile-link', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ email: email, link_url: location.origin, language: document.documentElement.getAttribute('lang') || 'en' }),
        }).then(function (r) { return r.status; }, function () { return 0; });
        var slow = new Promise(function (resolve) { setTimeout(function () { resolve(0); }, 8000); });
        return Promise.race([sent, slow]);
      }).then(function (status) {
        if (status === 429) { showError(msg.limit); return; }
        root.querySelector('[data-sl="form"]').hidden = true;
        root.querySelector('[data-sl="success"]').hidden = false;
      }).catch(function () {
        showError(msg.generic);
      }).then(function () {
        busy = false;
        button.disabled = false;
      });
    });
  });
})();
