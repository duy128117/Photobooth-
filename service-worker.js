const CACHE_NAME = "photobooth-shell-v2";
const RUNTIME_CACHE = "photobooth-runtime-v2";
const OFFLINE_URL = "/offline.html";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/photobooth.html",
  "/gallery.html",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/assets/css/landing.css",
  "/assets/css/auth.css",
  "/assets/css/style.css",
  "/assets/js/pwa.js",
  "/assets/js/home.js",
  "/assets/js/login.js",
  "/assets/js/gallery.js",
  "/assets/js/app.js",
  "/assets/js/modules/state.js",
  "/assets/js/modules/theme.js",
  "/assets/js/modules/camera.js",
  "/assets/js/modules/uploads.js",
  "/assets/js/modules/stickers.js",
  "/assets/js/modules/editor.js",
  "/assets/js/modules/export.js",
  "/assets/js/modules/backend.js",
  "/assets/js/modules/api.js",
  "/assets/js/modules/auto-crop.js",
  "/node_modules/html2canvas/dist/html2canvas.esm.js",
  "/node_modules/@mediapipe/selfie_segmentation/selfie_segmentation.js",
  "/assets/icons/icon-192.svg",
  "/assets/icons/icon-512.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then(function (cache) {
          cache.put(request, copy);
        });
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match(OFFLINE_URL);
        });
      })
    );
    return;
  }

  const isAppShellAsset = requestUrl.origin === self.location.origin && (
    requestUrl.pathname.endsWith(".js") ||
    requestUrl.pathname.endsWith(".css") ||
    requestUrl.pathname.endsWith(".html")
  );

  if (isAppShellAsset) {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match(OFFLINE_URL);
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }

      return fetch(request).then(function (response) {
        if (!response || response.status !== 200 || requestUrl.origin !== self.location.origin) {
          return response;
        }

        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then(function (cache) {
          cache.put(request, copy);
        });
        return response;
      });
    })
  );
});
