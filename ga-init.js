// GA4 初始化。原本內嵌在 index.html <head>，為了讓 CSP 的 script-src 不必開
// 'unsafe-inline' 而搬成外部檔（資安審查 F-1/R-1；見 public/_headers 註解）。
// 內容與 scripts/site-chrome.mjs 的 GA_SNIPPET 一致：?ga_optout=1 關閉追蹤、
// ?ga_optout=0 恢復；localhost 一律不追蹤。
//
// Cookie 同意（2026-10-02）：歐洲經濟區、英國、瑞士的訪客預設不寫 GA cookie。用的是
// Consent Mode 的 region，地區由 Google 依 IP 判斷，所以其他地區完全照舊。選擇存在
// localStorage 的 sv_consent（granted／denied），任何地區在隱私權政策頁按「Cookie 設定」
// 拒絕也會關掉。橫幅本身在 public/site-consent.js，只在需要時由這裡載入：
// 時區在歐洲又還沒選過，或頁面上有 [data-sv-consent-open] 按鈕。
try{var svq=new URLSearchParams(location.search).get('ga_optout');if(svq==='1')localStorage.setItem('sv_ga_optout','1');else if(svq==='0')localStorage.removeItem('sv_ga_optout');if(localStorage.getItem('sv_ga_optout')==='1'||location.hostname==='localhost'||location.hostname==='127.0.0.1')window['ga-disable-G-8W2EV2PJ7W']=true;}catch(e){}
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}

(function () {
  // EU 27 + Iceland, Liechtenstein, Norway (EEA) + UK + Switzerland.
  var REGIONS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
  var DENY_ALL = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };

  var deny = {};
  for (var k in DENY_ALL) deny[k] = DENY_ALL[k];
  deny.region = REGIONS;
  gtag('consent', 'default', deny);
  gtag('set', 'ads_data_redaction', true);

  var choice = null;
  try { choice = localStorage.getItem('sv_consent'); } catch (e) {}
  // Accepting grants analytics only; ad storage stays as the region default.
  if (choice === 'granted') gtag('consent', 'update', { analytics_storage: 'granted' });
  else if (choice === 'denied') gtag('consent', 'update', DENY_ALL);

  // The banner is shown by time zone: it is the best guess a static page has.
  // Getting it wrong is harmless both ways: someone in the EU with another time
  // zone stays at the denied default, someone elsewhere just sees the question.
  var NOT_EEA = /^Europe\/(Istanbul|Moscow|Minsk|Kiev|Kyiv|Simferopol|Volgograd|Kirov|Astrakhan|Saratov|Ulyanovsk|Samara|Kaliningrad|Chisinau|Tiraspol)$/;
  var EXTRA = /^(Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Asia\/(Nicosia|Famagusta)|Arctic\/Longyearbyen)$/;
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var inEurope = (/^Europe\//.test(tz) && !NOT_EEA.test(tz)) || EXTRA.test(tz);
  window.__svConsentAsk = !choice && inEurope;

  function maybeLoad() {
    if (!window.__svConsentAsk && !document.querySelector('[data-sv-consent-open]')) return;
    var s = document.createElement('script');
    s.src = '/site-consent.js';
    s.defer = true;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeLoad);
  else maybeLoad();
})();

gtag('js', new Date());
// Google 信號（人口統計、跨裝置、廣告受眾）關掉（2026-10-02）：隱私權政策說資料不拿來打廣告，
// 這一行讓 tag 不再打 doubleclick／ga-audiences。GA 後台「Google 信號資料收集」是另一層開關，
// 兩邊都關才乾淨；tag 這邊關了，後台開著也收不到。
gtag('config', 'G-8W2EV2PJ7W', { allow_google_signals: false, allow_ad_personalization_signals: false });
