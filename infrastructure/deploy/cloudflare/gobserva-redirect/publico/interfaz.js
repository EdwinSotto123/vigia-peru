// Lo que hace la portada de gobserva.cloud con o sin movimiento: el botón de día y noche, y el índice de la cabecera, que
// marca la sección que se está leyendo. Sin dependencias.
//
// El modo es el atributo data-modo de <html> («dia» o «noche»; el CSS de worker.js cambia todos los colores con él). Lo
// pone antes de pintar el script en línea de worker.js (MODO_INICIAL), con lo que la persona eligió la última vez en este
// navegador; si nunca eligió, noche. Este archivo muestra el botón (sin JavaScript no sirve y llega oculto), guarda la
// elección y avisa el cambio con el evento «gobserva:modo» (portada.js vuelve a pintar el mapa con los colores nuevos).
(() => {
  "use strict";
  const raiz = document.documentElement;
  const CLAVE = "gobserva-modo";
  // El color de la barra del navegador en el teléfono: el fondo de cada modo.
  const BARRA = { noche: "#030B07", dia: "#EDF4EF" };
  const barra = document.querySelector('meta[name="theme-color"]');
  const grupo = document.querySelector(".modo");
  const botones = grupo ? [...grupo.querySelectorAll("button[data-modo]")] : [];
  const quieto = matchMedia("(prefers-reduced-motion: reduce)");

  function mostrar(modo) {
    raiz.dataset.modo = modo;
    if (barra) barra.content = BARRA[modo];
    for (const b of botones) b.setAttribute("aria-pressed", String(b.dataset.modo === modo));
    document.dispatchEvent(new CustomEvent("gobserva:modo", { detail: { modo } }));
  }

  function elegir(modo) {
    if (modo === raiz.dataset.modo) return;
    try {
      localStorage.setItem(CLAVE, modo);
    } catch {
      // Sin almacenamiento (ventana privada estricta): el cambio vale hasta cerrar la página.
    }
    // Un fundido corto de toda la página, donde el navegador sabe hacerlo y nadie pidió menos movimiento.
    if (document.startViewTransition && !quieto.matches) document.startViewTransition(() => mostrar(modo));
    else mostrar(modo);
  }

  mostrar(raiz.dataset.modo === "dia" ? "dia" : "noche");
  if (grupo) grupo.hidden = false;
  for (const b of botones) b.addEventListener("click", () => elegir(b.dataset.modo));

  // ─── El índice: la sección que se está leyendo queda marcada en la cabecera ─────────────────────────────────────────
  const enlaces = [...document.querySelectorAll('.indice a[href^="#"]')];
  const secciones = enlaces.map((a) => document.getElementById(a.getAttribute("href").slice(1)));
  if (!enlaces.length || secciones.some((s) => !s) || !("IntersectionObserver" in window)) return;
  const vistas = new Set();
  const marcar = () => {
    // La primera, en el orden de la página, de las que cruzan la franja del medio de la pantalla.
    const k = secciones.findIndex((s) => vistas.has(s));
    enlaces.forEach((a, n) => (n === k ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
  };
  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) (e.isIntersecting ? vistas.add(e.target) : vistas.delete(e.target));
      marcar();
    },
    { rootMargin: "-35% 0px -55% 0px" },
  );
  for (const s of secciones) io.observe(s);
})();
