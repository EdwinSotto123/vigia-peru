// Las animaciones de la portada de gobserva.cloud (el radar cívico). Sin dependencias.
//
// Cada bloque con data-anima se arma al entrar en pantalla: le pone la clase .visible y el CSS hace el resto, en
// escalones como píxeles (worker.js: los cuadros que se encienden, las barras que crecen, las señales que aparecen). Las
// cifras con data-contar cuentan desde cero hasta su valor. La consola escribe letra por letra lo que Gobserva lee y,
// después, cada región que muestra el radar (el evento «gobserva:region» de portada.js). Los paquetes de la cadena de
// «Cómo funciona» sólo corren mientras se ve. El botón de pausa del radar detiene todo lo que se mueve.
//
// Sin JavaScript o con movimiento reducido no hay nada que esperar: la clase .anima no se pone y todo se ve quieto y
// completo, con las cifras finales y las líneas de la consola que ya trae el HTML.
(() => {
  "use strict";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const raiz = document.documentElement;
  raiz.classList.add("anima");
  const fmt = new Intl.NumberFormat("es-PE");
  const pausado = () => raiz.classList.contains("pausado");

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

  // ─── La consola ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const consola = document.querySelector(".consola-lineas");
  if (consola) {
    const MAXIMO = 16; // líneas en la página: las de arriba se van recortando
    // Lo que trae el HTML es lo primero que escribe: [clase, texto, de dónde].
    const cola = [...consola.children].filter((li) => li.textContent).map((li) => [li.className, li.textContent, "inicio"]);
    consola.textContent = "";
    let ocupada = false;
    let enPantalla = false;
    let esperaMano = 0;

    const linea = (clase) => {
      const li = document.createElement("li");
      li.className = clase;
      consola.append(li);
      while (consola.children.length > MAXIMO) consola.firstElementChild.remove();
      return li;
    };
    // La línea de comando que espera, con el cursor titilando.
    const espera = () => {
      const ultima = consola.lastElementChild;
      return ultima && ultima.classList.contains("escribiendo") ? ultima : linea("cmd escribiendo");
    };
    espera();
    const quieta = () => pausado() || !enPantalla || document.hidden;

    function seguir() {
      if (ocupada || !cola.length || quieta()) return;
      ocupada = true;
      const [clase, texto] = cola.shift();
      const comando = clase === "cmd";
      const li = comando ? espera() : linea(clase);
      let n = 0;
      const tecla = () => {
        if (quieta()) return void setTimeout(tecla, 400);
        // Los comandos, letra por letra, como a mano; las respuestas salen de golpe, como una máquina.
        n = Math.min(texto.length, n + (comando ? 1 : 5));
        li.textContent = texto.slice(0, n);
        if (n < texto.length) return void setTimeout(tecla, comando ? 45 + Math.random() * 55 : 18);
        if (comando) li.className = "cmd";
        else if (!cola.length || cola[0][0] === "cmd") espera();
        ocupada = false;
        setTimeout(seguir, comando ? 320 : 650);
      };
      tecla();
    }

    /** Lo que la consola dice de una región: la cifra de lo que muestra el radar en ese momento. */
    function sobreRegion({ nombre, metrica, valores: v }) {
      const l = [["cmd", `región ${nombre}`]];
      if (v && metrica === "penal" && v.penal != null) l.push(["res", `${fmt.format(v.penal)} informes con presunta responsabilidad penal`]);
      else if (v && metrica === "procesos" && v.procesos != null) l.push(["res", `${fmt.format(v.procesos)} procesos de compra desde 2015`]);
      else if (v && v.tramite != null) {
        l.push(["res", `${fmt.format(v.tramite)} casos de corrupción en trámite`]);
        if (v.firme != null) l.push(["res alerta", `${fmt.format(v.firme)} con sentencia firme`]);
      } else l.push(["res", "sin cifras de esta región"]);
      return l;
    }

    document.addEventListener("gobserva:region", (e) => {
      const d = e.detail;
      if (!d || d.origen === "inicio") return;
      clearTimeout(esperaMano);
      const meter = () => {
        // Sólo la última región espera turno: si el radar va más rápido que la consola, salta a la que ve ahora.
        for (let i = cola.length - 1; i >= 0; i--) if (cola[i][2] === "region") cola.splice(i, 1);
        for (const [clase, texto] of sobreRegion(d)) cola.push([clase, texto, "region"]);
        seguir();
      };
      // Con el mouse, la lupa cruza varias regiones seguidas: escribe la última donde se detuvo.
      if (d.origen === "mano") esperaMano = setTimeout(meter, 650);
      else meter();
    });

    new IntersectionObserver(([e]) => {
      enPantalla = e.isIntersecting;
      if (enPantalla) setTimeout(seguir, 500);
    }).observe(consola);
    document.addEventListener("visibilitychange", seguir);
    document.addEventListener("gobserva:pausa", seguir);
  }

  // ─── Pausar: todo lo que se mueve se detiene (el radar, la cinta, la consola, el recorrido) ──────────────────────────
  const boton = document.getElementById("pausa");
  if (boton) {
    boton.addEventListener("click", () => {
      const pausar = !pausado();
      raiz.classList.toggle("pausado", pausar);
      boton.setAttribute("aria-pressed", String(pausar));
      document.dispatchEvent(new Event("gobserva:pausa"));
    });
  }

  // La cadena de «Cómo funciona»: los paquetes corren entre etapas sólo mientras está en pantalla.
  const cadena = document.querySelector(".cadena");
  if (cadena) new IntersectionObserver(([e]) => cadena.classList.toggle("andando", e.isIntersecting)).observe(cadena);

  // «Ver las 25 regiones» lleva a la tabla y la abre.
  for (const a of document.querySelectorAll('a[href="#tabla-regiones"]')) {
    a.addEventListener("click", () => {
      const tabla = document.getElementById("tabla-regiones");
      if (tabla) tabla.open = true;
    });
  }
})();
