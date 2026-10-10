// Service worker — cache de l'app pour l'ouverture hors ligne + réception des rappels push.
// Incrémente VERSION à chaque déploiement pour forcer la mise à jour du cache.
const VERSION = "maison-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./plant-care.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/badge-72.png"
];

self.addEventListener("install", event => {
  // cache: "reload" : ignore le cache HTTP du navigateur pour récupérer la version réellement publiée
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Jamais de cache pour l'API Supabase (données, auth, fonctions)
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) return;

  // Fichiers de l'app (même origine) : réseau d'abord pour toujours avoir la dernière version
  // (config.js compris), cache en secours quand on est hors ligne.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req.mode === "navigate" ? "./index.html" : req, copy)); }
        return res;
      }).catch(() => caches.match(req.mode === "navigate" ? "./index.html" : req, { ignoreSearch: true }))
    );
    return;
  }

  // Polices et librairie (autres origines) : cache d'abord, mis à jour en arrière-plan
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Rappel envoyé par la fonction send-reminders
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Carnet de maison";
  const options = {
    body: data.body || "Des choses t'attendent aujourd'hui.",
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-72.png",
    tag: data.tag || "rappel-quotidien",
    renotify: true,
    data: { url: data.url || "./?tab=home" }
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    data.count && self.navigator && "setAppBadge" in self.navigator ? self.navigator.setAppBadge(data.count).catch(() => {}) : Promise.resolve()
  ]));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        const params = new URL(target).searchParams;
        c.postMessage({ tab: params.get("tab"), foyer: params.get("foyer") });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
