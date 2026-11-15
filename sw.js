const CACHE = "fatture-sonia-v17";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=10",
  "./manifest.webmanifest",
  "./js/money.js?v=5",
  "./js/places.js?v=1",
  "./js/db.js?v=4",
  "./js/sync.js?v=7",
  "./js/drive.js?v=1",
  "./js/xlsx.js?v=4",
  "./js/pdf.js?v=9",
  "./js/seed.js?v=5",
  "./js/app.js?v=16",
  "./vendor/jspdf.umd.min.js?v=3",
  "./assets/logo.png?v=3",
  "./assets/icon-180.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(ASSETS);
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    fetch(req).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) { return cached || caches.match("./index.html"); });
    })
  );
});
