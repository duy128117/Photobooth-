const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

if ("serviceWorker" in navigator && !isLocalhost) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/service-worker.js").catch(function (error) {
      console.warn("Unable to register service worker", error);
    });
  });
}
