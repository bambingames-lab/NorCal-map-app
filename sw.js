const CACHE_NAME = "tm-v2-fixed-1";
self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
