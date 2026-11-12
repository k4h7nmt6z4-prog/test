// 羽球報名 PWA 的 Service Worker
//
// - 網頁外框（HTML、CSS、JS、圖示）：先連網取得最新版，離線時才用快取。
// - 固定版本的 supabase-js（CDN）：先用快取，沒有才下載。
// - Supabase 的資料請求一律不經過快取，名單永遠是即時的。
//
// 修改網頁檔案後不需要改這裡；只有要清掉舊快取時才把 CACHE 的版本號加一。

var CACHE = "badminton-v1";
var SUPABASE_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
var SHELL = [
  "./badminton.html",
  "./style.css",
  "./config.js",
  "./badminton.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // CDN 下載失敗不影響安裝，之後第一次使用時會再補進快取
      return cache.addAll(SHELL).then(function () {
        return cache.add(SUPABASE_LIB).catch(function () {});
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf("badminton-") === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Supabase 資料：不處理，交給瀏覽器直接連線
  if (/\.supabase\.co$/.test(url.hostname)) return;

  // 固定版本的程式庫：快取優先
  if (req.url === SUPABASE_LIB) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // 同網站的檔案：網路優先，離線時用快取
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          // 離線打開其他頁面時，至少顯示羽球報名頁
          if (req.mode === "navigate") return caches.match("./badminton.html");
          return Response.error();
        });
      })
    );
  }
});
