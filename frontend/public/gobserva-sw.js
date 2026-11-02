/*
 * Service worker de Gobserva (empleo., licitaciones. y obras.gobserva.cloud), 2026-11-01: sólo muestra las
 * notificaciones de las alertas y abre su enlace al tocarlas. No guarda páginas en caché: la web siempre se pide al
 * servidor. El mensaje lo arma la API (backend/api/src/lib/webpush.ts): {titulo, cuerpo, url, tag}.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { cuerpo: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.titulo || "Gobserva", {
      body: d.cuerpo || "",
      icon: "/gobserva/icono-192.png",
      badge: "/gobserva/insignia-96.png",
      tag: d.tag || undefined,
      lang: "es-PE",
      data: { url: d.url || "/cuenta?tab=alertas" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || "/cuenta", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const v of ventanas) {
        if (v.url === destino && "focus" in v) return v.focus();
      }
      return self.clients.openWindow(destino);
    })(),
  );
});
