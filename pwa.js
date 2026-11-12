// 羽球報名 PWA：註冊 Service Worker、安裝提示、離線提示。
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var HIDE_KEY = "badminton-install-dismissed";

  // ---- Service Worker ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        // 註冊失敗不影響網頁使用
      });
    });
  }

  // ---- 離線提示 ----
  var offlineBar = $("offlineBar");
  function updateOnline() {
    offlineBar.hidden = navigator.onLine;
  }
  window.addEventListener("offline", updateOnline);
  window.addEventListener("online", function () {
    updateOnline();
    // 恢復連線後自動重新載入名單
    var refresh = $("refreshBtn");
    if (refresh && !refresh.disabled) refresh.click();
  });
  updateOnline();

  // ---- 安裝提示 ----
  var card = $("installCard");
  var btn = $("installBtn");
  var hint = $("installHint");
  var deferred = null;

  var standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  function dismissed() {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch (e) { return false; }
  }

  function showCard() {
    if (standalone || dismissed()) return;
    card.hidden = false;
  }

  // Android／電腦版 Chrome、Edge：瀏覽器提供安裝視窗
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
    hint.textContent = "像 App 一樣，一點就開。";
    showCard();
  });

  btn.addEventListener("click", async function () {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* 使用者關閉視窗 */ }
    deferred = null;
    card.hidden = true;
  });

  window.addEventListener("appinstalled", function () {
    card.hidden = true;
  });

  $("installClose").addEventListener("click", function () {
    card.hidden = true;
    try { localStorage.setItem(HIDE_KEY, "1"); } catch (e) { /* 無法記住也沒關係 */ }
  });

  // iPhone／iPad 的 Safari 沒有安裝視窗，改顯示操作說明
  var ua = navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone) {
    btn.hidden = true;
    hint.textContent = "點 Safari 下方的「分享」按鈕，再選「加入主畫面」。";
    showCard();
  }
})();
