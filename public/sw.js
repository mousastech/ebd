// Service worker da EBD:
//  - deixa o app instalável e mostra uma página amigável sem internet;
//  - guarda NO PRÓPRIO APARELHO as telas de chamada já abertas, para fazer a chamada sem internet
//    (o envio fica numa fila e sobe sozinho quando a conexão volta; ver OfflineSync);
//  - os arquivos estáticos do app ficam em cache para abrir rápido.
// Ao sair da conta, as telas guardadas são apagadas.
const OFFLINE = "/offline.html";
const STATIC = "ebd-static-v3";
const PAGES = "ebd-pages-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![STATIC, PAGES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
const isOfflinePage = (url) => url.origin === self.location.origin && /^\/presenca(\/\d+)?\/?$/.test(url.pathname);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.open(STATIC).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (e.request.mode !== "navigate") return;
  if (isOfflinePage(url)) {
    // rede primeiro; sem rede, a última versão guardada desta tela de chamada
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && !r.redirected) caches.open(PAGES).then((c) => c.put(url.pathname, r.clone()));
      return r;
    }).catch(async () => (await caches.match(url.pathname, { cacheName: PAGES })) || caches.match(OFFLINE)));
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
self.addEventListener("message", (e) => {
  if (e.data === "logout") e.waitUntil(caches.delete(PAGES));
  if (e.data && e.data.type === "prefetch") {
    e.waitUntil(caches.open(PAGES).then((c) => Promise.all(e.data.urls.map((u) =>
      fetch(u, { credentials: "same-origin" }).then((r) => (r.ok && !r.redirected ? c.put(u, r) : null)).catch(() => null)))));
  }
});

// Notificações push (comunicados, eventos, relatórios devolvidos, aniversários…)
self.addEventListener("push", (e) => {
  let data = { title: "EBD", body: "", url: "/" };
  try { data = { ...data, ...e.data.json() }; } catch { /* texto simples */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: data.url },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
