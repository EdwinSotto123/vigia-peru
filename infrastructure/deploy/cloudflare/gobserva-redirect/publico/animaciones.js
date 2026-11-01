// Las animaciones de la presentación, en la portada de gobserva.cloud. Sin dependencias.
//
// Cada bloque con data-anima se arma al entrar en pantalla: le pone la clase .visible y el CSS hace el resto, en
// escalones como píxeles (worker.js: los cuadros que se encienden, las barras que crecen, las señales que aparecen). Las
// cifras con data-contar cuentan desde cero hasta su valor. El flujo de datos del capítulo 04 sólo se mueve mientras
// se ve.
//
// Sin JavaScript o con movimiento reducido no hay nada que esperar: la clase .anima no se pone y todo se ve quieto y
// completo, con las cifras finales que ya trae el HTML.
(() => {
  "use strict";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("anima");
  const fmt = new Intl.NumberFormat("es-PE");

  /** Cuenta de 0 al valor de data-contar, rápido al principio y lento al final. */
  function contar(el, ms = 1500) {
    const fin = Number(el.dataset.contar);
    if (!Number.isFinite(fin)) return;
    const t0 = performance.now();
    const paso = (t) => {
      const u = Math.min(1, (t - t0) / ms);
      el.textContent = fmt.format(Math.round(fin * (1 - Math.pow(1 - u, 3))));
      if (u < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  const bloques = document.querySelectorAll("[data-anima]");
  // Las cifras de lo que todavía no se ve empiezan en cero (las de arriba cuentan apenas carga la página).
  for (const b of bloques) for (const n of b.querySelectorAll("[data-contar]")) n.textContent = fmt.format(0);

  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("visible");
        for (const n of e.target.querySelectorAll("[data-contar]")) contar(n);
        io.unobserve(e.target);
      }
    },
    { threshold: 0.2, rootMargin: "0px 0px -6% 0px" },
  );
  for (const b of bloques) io.observe(b);

  // El flujo de datos (capítulo 04) se mueve sólo mientras está en pantalla.
  const flujo = document.querySelector(".flujo");
  if (flujo) new IntersectionObserver(([e]) => flujo.classList.toggle("andando", e.isIntersecting)).observe(flujo);

  // «Ver las 25 regiones» lleva a la tabla y la abre.
  for (const a of document.querySelectorAll('a[href="#tabla-regiones"]')) {
    a.addEventListener("click", () => {
      const tabla = document.getElementById("tabla-regiones");
      if (tabla) tabla.open = true;
    });
  }
})();
