// La lupa sobre el mapa del Perú, en la portada de gobserva.cloud. Sin dependencias.
//
// Lee la malla de puntos de window.MAPA_PERU (mapa-peru.js, de mapa/generar_mapa.py) y los datos de cada región que el
// Worker deja en #datos-regiones (worker.js, de la API de Vigía). Con el mouse, la lupa sigue al puntero y agranda los
// puntos que tiene debajo; la región que toca se enciende, a su lado aparecen sus cifras y la ficha cuenta lo que la
// Procuraduría Anticorrupción, la Contraloría y la OECE registran de ella. Si nadie la mueve, recorre sola las regiones.
// Con el teclado, el mapa toma el foco: las flechas cambian de región y Enter la abre en Vigía. Con movimiento reducido
// no hay recorrido ni deslizamiento: la lupa salta a la región elegida.
//
// El radar (worker.js, la portada como instrumento): el barrido gira con CSS y este código pone las tres regiones con más
// casos de la métrica elegida como ecos rojos que se encienden cuando el barrido pasa por su rumbo; muestra las coordenadas
// de la lupa (mapa-peru.js trae la malla en grados) y avisa cada región elegida con el evento «gobserva:region» (la
// consola de animaciones.js la escribe). El botón de pausa (animaciones.js) detiene el recorrido.
(() => {
  "use strict";
  const MAPA = window.MAPA_PERU;
  const caja = document.getElementById("mapa");
  const lienzo = caja && caja.querySelector("canvas");
  const ctx = lienzo && lienzo.getContext("2d");
  if (!MAPA || !ctx) return;

  const VIGIA = "https://vigia.gobserva.cloud";
  const TAU = Math.PI * 2;
  const datos = leerDatos();
  const regiones = MAPA.regiones; // códigos "01" a "25", en el orden de las celdas
  const porCodigo = new Map((datos ? datos.regiones : []).map((r) => [r.c, r]));
  const nombres = new Map([...document.querySelectorAll("#region option")].map((o) => [o.value, o.textContent]));
  const fmt = new Intl.NumberFormat("es-PE");
  const reducido = matchMedia("(prefers-reduced-motion: reduce)");
  const pausado = () => document.documentElement.classList.contains("pausado");
  const finoConMouse = matchMedia("(hover: hover) and (pointer: fine)");

  // ─── La malla ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const { cols, filas } = MAPA;
  const celdas = Uint8Array.from(atob(MAPA.celdas), (c) => c.charCodeAt(0));
  const puntos = []; // [columna, fila, región]
  const puntoEn = new Int16Array(cols * filas).fill(-1);
  const sumas = regiones.map(() => [0, 0, 0]);
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      const v = celdas[j * cols + i];
      if (!v) continue;
      puntoEn[j * cols + i] = puntos.length;
      puntos.push([i, j, v - 1]);
      const s = sumas[v - 1];
      s[0] += i + 0.5;
      s[1] += j + 0.5;
      s[2]++;
    }
  }
  const centros = sumas.map(([x, y, n]) => [x / n, y / n]);
  // De norte a sur (y de oeste a este en la misma franja): el orden de las flechas del teclado.
  const ordenGeo = regiones.map((_, k) => k).sort((a, b) => centros[a][1] - centros[b][1] || centros[a][0] - centros[b][0]);
  const RECORRIDO = ["15", "02", "13", "20", "06", "16", "22", "25", "12", "05", "08", "21", "04", "23", "18", "11", "09", "03",
    "19", "10", "01", "14", "24", "17", "07"].map((c) => regiones.indexOf(c));
  caja.style.aspectRatio = `${cols} / ${filas}`;
  // El arranque: los píxeles se encienden en ola desde la región inicial (sin movimiento reducido).
  const ARRANQUE_OLA = 14; // ms por celda de distancia
  const ARRANQUE_PIXEL = 260; // lo que tarda cada píxel en llegar a su tamaño
  let distancias = new Float32Array(puntos.length);
  let ARRANQUE_TOTAL = 0;
  let arranque = 0;

  // ─── Lo que se mide ───────────────────────────────────────────────────────────────────────────────────────────────
  const corte = datos && datos.corte ? fecha(datos.corte) : null;
  const METRICAS = {
    tramite: {
      leyenda: `Casos de corrupción en trámite, por región${corte ? ` (Procuraduría Anticorrupción, al ${corte})` : ""}`,
      rotulos: [["tramite", "casos de corrupción en trámite"], ["firme", "con sentencia firme"]],
    },
    penal: {
      leyenda: "Informes de control con presunta responsabilidad penal, por región (Contraloría)",
      rotulos: [["penal", "informes con presunta responsabilidad penal"], ["informes", "informes de control en total"]],
    },
    procesos: {
      leyenda: "Procesos de compra pública desde 2015, por región (OECE)",
      rotulos: [["procesos", "procesos de compra desde 2015"], ["monto", "de valor referencial"]],
    },
  };
  let metrica = "tramite";
  let clases = []; // por región: 0 a 4, o -1 sin dato
  let cortes = [];

  function calcularClases() {
    const valores = regiones.map((c) => valor(c, metrica));
    const ordenados = valores.filter((v) => v != null).sort((a, b) => a - b);
    if (!ordenados.length) {
      clases = regiones.map(() => -1);
      return;
    }
    // Quintiles: cinco regiones por tono. Más brillo, más casos (oscuro); más oscuro, más casos (claro).
    cortes = [1, 2, 3, 4].map((m) => ordenados[Math.floor((m * ordenados.length) / 5)]);
    clases = valores.map((v) => (v == null ? -1 : cortes.filter((c) => v >= c).length));
    const leyenda = document.getElementById("leyenda-titulo");
    if (leyenda) leyenda.textContent = METRICAS[metrica].leyenda;
    const min = document.getElementById("leyenda-min");
    const max = document.getElementById("leyenda-max");
    if (min) min.textContent = cifra(ordenados[0], metrica);
    if (max) max.textContent = cifra(ordenados[ordenados.length - 1], metrica);
  }

  // ─── Colores (del CSS: siguen al modo claro u oscuro) ────────────────────────────────────────────────────────────
  let colores = {};
  function leerColores() {
    const cs = getComputedStyle(caja);
    const v = (n) => cs.getPropertyValue(n).trim();
    colores = {
      tonos: [v("--r1"), v("--r2"), v("--r3"), v("--r4"), v("--r5")],
      sin: v("--mapa-sin"),
      aro: v("--lupa-aro"),
      vidrio: v("--lupa-vidrio"),
    };
  }

  // ─── Medidas del lienzo ───────────────────────────────────────────────────────────────────────────────────────────
  let W = 0, H = 0, paso = 1, ox = 0, oy = 0, R = 60, dpr = 1;
  function medir() {
    const r = caja.getBoundingClientRect();
    W = r.width;
    H = r.height;
    if (!W || !H) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    lienzo.width = Math.round(W * dpr);
    lienzo.height = Math.round(H * dpr);
    paso = Math.min(W / cols, H / filas);
    ox = (W - cols * paso) / 2;
    oy = (H - filas * paso) / 2;
    R = Math.max(42, Math.min(96, cols * paso * 0.19));
    if (activa >= 0) llevarA(activa, true);
  }
  const enX = (i) => ox + i * paso;
  const enY = (j) => oy + j * paso;

  function regionEn(x, y) {
    const i = Math.floor((x - ox) / paso);
    const j = Math.floor((y - oy) / paso);
    // La celda de abajo o, en la costa y en los bordes, la vecina más cercana: un pixel afuera no apaga la región.
    let mejor = -1, dist = Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= filas) continue;
        const p = puntoEn[jj * cols + ii];
        if (p < 0) continue;
        const d = (enX(ii + 0.5) - x) ** 2 + (enY(jj + 0.5) - y) ** 2;
        if (d < dist) {
          dist = d;
          mejor = puntos[p][2];
        }
      }
    }
    return dist <= (paso * 1.2) ** 2 ? mejor : -1;
  }

  // ─── Estado ───────────────────────────────────────────────────────────────────────────────────────────────────────
  let activa = regiones.indexOf((document.getElementById("region") || {}).value || "15");
  const lupa = { x: 0, y: 0 };
  const destino = { x: 0, y: 0 };
  let modo = "recorrido"; // recorrido | mano | fijo
  let visible = true;
  let cuadro = 0;
  let ultimo = 0;
  let siguientePaso = 0;
  let reanudar = 0;
  let pasoRecorrido = Math.max(0, RECORRIDO.indexOf(activa));

  function llevarA(k, salto) {
    destino.x = enX(centros[k][0]);
    destino.y = enY(centros[k][1]);
    if (salto || reducido.matches) {
      lupa.x = destino.x;
      lupa.y = destino.y;
    }
  }

  function elegir(k, origen) {
    if (k < 0) return;
    const cambia = k !== activa;
    activa = k;
    if (origen !== "mano") llevarA(k, origen === "inicio");
    if (cambia || origen === "inicio") {
      pintarFicha(k);
      pintarRotulos(k);
      avisar(k, origen);
    }
    if (origen === "teclado" || origen === "lista") anunciar(k);
    pedirCuadro();
  }

  // ─── Dibujo ───────────────────────────────────────────────────────────────────────────────────────────────────────
  function pedirCuadro() {
    if (!cuadro && visible) cuadro = requestAnimationFrame(avanzar);
  }

  function avanzar(t) {
    cuadro = 0;
    const dt = ultimo ? Math.min(64, t - ultimo) : 16;
    ultimo = t;
    const dx = destino.x - lupa.x, dy = destino.y - lupa.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.4) {
      // Suave al viajar sola; casi pegada al puntero cuando la mueve una mano.
      const base = reducido.matches ? 1 : modo === "mano" ? 0.42 : 0.075;
      const f = 1 - Math.pow(1 - base, dt / 16.7);
      lupa.x += dx * f;
      lupa.y += dy * f;
      if (modo === "mano") {
        const k = regionEn(lupa.x, lupa.y);
        if (k >= 0) elegir(k, "mano");
        caja.classList.toggle("sobre-mar", k < 0);
      }
      pedirCuadro();
    } else {
      lupa.x = destino.x;
      lupa.y = destino.y;
      ultimo = 0;
    }
    dibujar();
    moverRotulos();
    ponerCoordenadas();
    if (arranque) pedirCuadro();
  }

  function dibujar() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const base = paso * 0.37; // medio lado del píxel: queda una rendija entre vecinos
    const M = 1.4; // aumento de la lupa en el centro: 2,4 veces
    const t = arranque ? performance.now() - arranque : 0;
    // Un trazo por tono y por si es la región encendida: así son doce rellenos por cuadro, no dos mil.
    const grupos = new Map();
    for (let n = 0; n < puntos.length; n++) {
      const [i, j, k] = puntos[n];
      let x = enX(i + 0.5), y = enY(j + 0.5), r = base;
      const ddx = x - lupa.x, ddy = y - lupa.y;
      const d = Math.hypot(ddx, ddy);
      if (d < R) {
        // Ojo de pez (Sarkar y Brown): adentro todo se aleja del centro, en el borde se junta.
        const u = d / R;
        const u2 = ((M + 1) * u) / (M * u + 1);
        if (d > 0.01) {
          x = lupa.x + (ddx / d) * u2 * R;
          y = lupa.y + (ddy / d) * u2 * R;
        }
        r = base * (1 + 1.15 * (1 - u));
      }
      const encendida = k === activa;
      if (encendida) r *= 1.08;
      if (arranque) {
        // Cada píxel se enciende según su distancia a la región inicial: una ola que sale de Lima.
        const u = Math.min(1, Math.max(0, (t - distancias[n] * ARRANQUE_OLA) / ARRANQUE_PIXEL));
        r *= 1 - Math.pow(1 - u, 3);
        if (r <= 0.05) continue;
      }
      const tono = clases[k] == null ? -1 : clases[k];
      const clave = `${tono}${encendida ? "+" : ""}`;
      let g = grupos.get(clave);
      if (!g) grupos.set(clave, (g = { tono, encendida, camino: new Path2D() }));
      g.camino.rect(x - r, y - r, r * 2, r * 2);
    }
    for (const g of grupos.values()) {
      ctx.globalAlpha = activa >= 0 && !g.encendida ? 0.45 : 1;
      ctx.fillStyle = g.tono < 0 ? colores.sin : colores.tonos[g.tono];
      ctx.fill(g.camino);
      if (g.encendida) {
        // Un contorno fino: la región se distingue aunque su tono sea de los bajos (el color sigue siendo el dato).
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = colores.aro;
        ctx.lineWidth = 1;
        ctx.stroke(g.camino);
      }
    }
    ctx.globalAlpha = 1;
    if (arranque && t > ARRANQUE_TOTAL) arranque = 0;
    // La lupa de Gobserva: vidrio, aro y mango a 45°, de corte recto.
    const aro = Math.max(3.5, R * 0.085);
    ctx.fillStyle = colores.vidrio;
    ctx.beginPath();
    ctx.arc(lupa.x, lupa.y, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colores.aro;
    ctx.lineWidth = aro;
    ctx.beginPath();
    ctx.arc(lupa.x, lupa.y, R, 0, TAU);
    ctx.stroke();
    // La retícula: una cruz fina con el centro libre, como en el visor de un instrumento.
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(lupa.x + ux * R * 0.2, lupa.y + uy * R * 0.2);
      ctx.lineTo(lupa.x + ux * R * 0.52, lupa.y + uy * R * 0.52);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const a = Math.PI / 4;
    ctx.lineWidth = aro * 1.4;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(lupa.x + Math.cos(a) * (R + aro * 0.4), lupa.y + Math.sin(a) * (R + aro * 0.4));
    ctx.lineTo(lupa.x + Math.cos(a) * R * 1.62, lupa.y + Math.sin(a) * R * 1.62);
    ctx.stroke();
  }

  // ─── Lo que aparece junto a la lupa ───────────────────────────────────────────────────────────────────────────────
  const rotulos = caja.querySelector(".lupa-rotulos");
  const rotRegion = rotulos && rotulos.querySelector(".lupa-region");
  const rotDatos = rotulos ? [...rotulos.querySelectorAll(".lupa-dato")] : [];

  function pintarRotulos(k) {
    if (!rotulos) return;
    const c = regiones[k];
    rotRegion.textContent = nombres.get(c) || c;
    METRICAS[metrica].rotulos.forEach(([campo, texto], n) => {
      const el = rotDatos[n];
      if (!el) return;
      const v = valor(c, campo);
      el.hidden = v == null;
      el.querySelector("b").textContent = v == null ? "" : cifra(v, campo);
      el.querySelector("span").textContent = texto;
    });
    if (!reducido.matches) {
      rotulos.classList.remove("entra");
      void rotulos.offsetWidth; // reinicia la animación de entrada
      rotulos.classList.add("entra");
    }
  }

  function moverRotulos() {
    if (!rotulos || !W) return;
    const ancho = rotulos.offsetWidth, alto = rotulos.offsetHeight;
    let x = lupa.x + R + 18;
    if (x + ancho > W - 4) x = lupa.x - R - 18 - ancho;
    x = Math.max(4, Math.min(W - ancho - 4, x));
    const y = Math.max(4, Math.min(H - alto - 4, lupa.y - alto / 2 - R * 0.35));
    rotulos.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ─── La ficha ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const ficha = document.getElementById("ficha");
  const lista = document.getElementById("region");

  function pintarFicha(k) {
    if (!ficha) return;
    const c = regiones[k];
    const nombre = nombres.get(c) || c;
    if (lista) lista.value = c;
    const enlace = document.getElementById("ficha-enlace");
    if (enlace) {
      enlace.href = `${VIGIA}/region/${c}`;
      enlace.textContent = `Ver ${nombre} en Vigía`;
    }
    for (const el of ficha.querySelectorAll("[data-campo]")) {
      const campo = el.dataset.campo;
      const v = valor(c, campo);
      el.textContent = v == null ? "Sin dato" : cifra(v, campo);
    }
    const r = porCodigo.get(c);
    const anios = document.getElementById("ficha-anios");
    if (anios && r) anios.textContent = r.desde && r.hasta ? `informes de ${r.desde.slice(0, 4)} a ${r.hasta.slice(0, 4)}` : "informes publicados";
  }

  const anuncio = document.getElementById("anuncio");
  function anunciar(k) {
    if (!anuncio) return;
    const c = regiones[k];
    const t = valor(c, "tramite");
    anuncio.textContent = `${nombres.get(c) || c}${t == null ? "" : `: ${fmt.format(t)} casos de corrupción en trámite`}`;
  }

  // ─── El radar ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const capaEcos = caja.querySelector(".radar-blips");
  const barrido = caja.querySelector(".radar-barrido");
  function periodo() {
    const v = getComputedStyle(caja).getPropertyValue("--periodo").trim();
    const n = parseFloat(v);
    return n > 0 ? (v.endsWith("ms") ? n : n * 1000) : 6000;
  }

  // Las tres regiones con más de la métrica elegida, como ecos: cada uno se enciende cuando el barrido pasa por su rumbo
  // (medido como el barrido, desde el norte y en el sentido del reloj, desde el centro del visor).
  function ponerEcos() {
    if (!capaEcos || !W) return;
    const T = periodo();
    const anim = barrido && barrido.getAnimations ? barrido.getAnimations()[0] : null;
    const fase = anim && typeof anim.currentTime === "number" ? anim.currentTime % T : 0;
    const top = regiones
      .map((c, k) => [k, valor(c, metrica)])
      .filter(([, v]) => v != null)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    capaEcos.textContent = "";
    for (const [k] of top) {
      const x = enX(centros[k][0]), y = enY(centros[k][1]);
      const rumbo = ((Math.atan2(x - W / 2, -(y - H / 2)) * 180) / Math.PI + 360) % 360;
      const retraso = ((((rumbo / 360) * T - fase) % T) + T) % T;
      const eco = document.createElement("span");
      eco.className = "blip";
      eco.style.setProperty("--x", `${x.toFixed(1)}px`);
      eco.style.setProperty("--y", `${y.toFixed(1)}px`);
      eco.style.setProperty("--retraso", `${Math.round(retraso)}ms`);
      capaEcos.append(eco);
    }
  }

  // Las coordenadas de la lupa, en grados y minutos (sólo cambian cuando cambia un minuto: nada de redibujar texto).
  const GEO = MAPA.geo;
  const coords = document.getElementById("coords");
  let coordsTexto = "";
  function ponerCoordenadas() {
    if (!coords || !GEO || !W) return;
    const i = (lupa.x - ox) / paso, j = (lupa.y - oy) / paso;
    const lat = GEO.lat1 - j * GEO.paso;
    const lon = GEO.lon0 + (i * GEO.paso) / GEO.kx;
    const t = `${gradoMinuto(lat, "N", "S")} ${gradoMinuto(lon, "E", "O")}`;
    if (t !== coordsTexto) coords.textContent = coordsTexto = t;
  }
  function gradoMinuto(v, mas, menos) {
    const a = Math.abs(v);
    let g = Math.floor(a);
    let m = Math.round((a - g) * 60);
    if (m === 60) {
      g++;
      m = 0;
    }
    return `${g}°${String(m).padStart(2, "0")}′ ${v >= 0 ? mas : menos}`;
  }

  // Cada región elegida, para la consola (animaciones.js): quién la eligió y qué cifras tiene.
  function avisar(k, origen) {
    const c = regiones[k];
    caja.dispatchEvent(new CustomEvent("gobserva:region", {
      bubbles: true,
      detail: { codigo: c, nombre: nombres.get(c) || c, origen, metrica, valores: porCodigo.get(c) || null },
    }));
  }

  // ─── El recorrido solo ────────────────────────────────────────────────────────────────────────────────────────────
  function puedeRecorrer() {
    return !reducido.matches && visible && !document.hidden && !pausado();
  }

  function programar(ms) {
    clearTimeout(siguientePaso);
    if (modo === "recorrido" && puedeRecorrer()) siguientePaso = setTimeout(darPaso, ms);
  }

  function darPaso() {
    if (modo !== "recorrido" || !puedeRecorrer()) return;
    pasoRecorrido = (pasoRecorrido + 1) % RECORRIDO.length;
    elegir(RECORRIDO[pasoRecorrido], "recorrido");
    programar(3600);
  }

  function retomarEn(ms) {
    clearTimeout(reanudar);
    reanudar = setTimeout(() => {
      modo = "recorrido";
      pasoRecorrido = Math.max(0, RECORRIDO.indexOf(activa));
      programar(1200);
    }, ms);
  }

  function tomarControl(nuevo) {
    modo = nuevo;
    clearTimeout(siguientePaso);
    clearTimeout(reanudar);
  }

  // ─── Eventos ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function posicion(e) {
    const r = caja.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  caja.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    tomarControl("mano");
    const [x, y] = posicion(e);
    destino.x = x;
    destino.y = y;
    pedirCuadro();
  });
  caja.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    caja.classList.remove("sobre-mar");
    modo = "fijo";
    retomarEn(5000);
  });
  // Un toque elige la región que tiene debajo (sin bloquear el desplazamiento de la página).
  let toque = null;
  caja.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") toque = posicion(e);
  });
  caja.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch" || !toque) return;
    const [x, y] = posicion(e);
    const movio = Math.hypot(x - toque[0], y - toque[1]) > 12;
    toque = null;
    if (movio) return;
    const k = regionEn(x, y);
    if (k < 0) return;
    tomarControl("fijo");
    elegir(k, "toque");
    retomarEn(12000);
  });
  // Con mouse, un clic abre la región en Vigía; en una pantalla táctil el toque sólo la elige (la ficha tiene el enlace).
  caja.addEventListener("click", (e) => {
    if (!finoConMouse.matches || e.pointerType === "touch") return;
    const [x, y] = posicion(e);
    const k = regionEn(x, y);
    if (k >= 0) window.location.href = `${VIGIA}/region/${regiones[k]}`;
  });
  caja.addEventListener("keydown", (e) => {
    const n = ordenGeo.indexOf(activa);
    let k = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") k = ordenGeo[(n + 1) % ordenGeo.length];
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") k = ordenGeo[(n - 1 + ordenGeo.length) % ordenGeo.length];
    else if (e.key === "Home") k = ordenGeo[0];
    else if (e.key === "End") k = ordenGeo[ordenGeo.length - 1];
    else if (e.key === "Enter") {
      window.location.href = `${VIGIA}/region/${regiones[activa]}`;
      return;
    } else return;
    e.preventDefault();
    tomarControl("fijo");
    elegir(k, "teclado");
    retomarEn(20000);
  });
  caja.addEventListener("focus", () => tomarControl("fijo"));
  caja.addEventListener("blur", () => retomarEn(8000));
  if (lista) {
    lista.addEventListener("change", () => {
      tomarControl("fijo");
      elegir(regiones.indexOf(lista.value), "lista");
      retomarEn(20000);
    });
  }
  for (const radio of document.querySelectorAll('input[name="metrica"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      metrica = radio.value;
      const contenedor = caja.closest(".portada-mapa");
      if (contenedor) {
        contenedor.classList.remove("m-tramite", "m-penal", "m-procesos");
        contenedor.classList.add(`m-${metrica}`);
      }
      leerColores();
      calcularClases();
      ponerEcos();
      if (activa >= 0) pintarRotulos(activa);
      pedirCuadro();
    });
  }

  // Fuera de pantalla o en otra pestaña, nada se mueve ni se dibuja.
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    caja.classList.toggle("en-pantalla", visible);
    if (visible) {
      pedirCuadro();
      programar(1500);
    } else clearTimeout(siguientePaso);
  }).observe(caja);
  document.addEventListener("visibilitychange", () => (document.hidden ? clearTimeout(siguientePaso) : programar(1500)));
  reducido.addEventListener("change", () => {
    if (reducido.matches) tomarControl("fijo");
    else programar(1500);
  });
  document.addEventListener("gobserva:pausa", () => (pausado() ? clearTimeout(siguientePaso) : programar(1500)));
  new ResizeObserver(() => {
    medir();
    ponerEcos();
    pedirCuadro();
  }).observe(caja);

  // ─── Arranque ─────────────────────────────────────────────────────────────────────────────────────────────────────
  document.documentElement.classList.add("con-mapa");
  if (!finoConMouse.matches) caja.classList.add("tactil");
  leerColores();
  calcularClases();
  medir();
  {
    const k0 = activa < 0 ? regiones.indexOf("15") : activa;
    const [cx0, cy0] = centros[k0];
    let lejos = 0;
    puntos.forEach(([i, j], n) => {
      distancias[n] = Math.hypot(i + 0.5 - cx0, j + 0.5 - cy0);
      lejos = Math.max(lejos, distancias[n]);
    });
    ARRANQUE_TOTAL = lejos * ARRANQUE_OLA + ARRANQUE_PIXEL;
    if (!reducido.matches) arranque = performance.now();
  }
  elegir(activa < 0 ? regiones.indexOf("15") : activa, "inicio");
  ponerEcos();
  ponerCoordenadas();
  programar(2600);

  // ─── Utilidades ───────────────────────────────────────────────────────────────────────────────────────────────────
  function leerDatos() {
    try {
      const el = document.getElementById("datos-regiones");
      return el ? JSON.parse(el.textContent) : null;
    } catch {
      return null;
    }
  }

  function valor(codigo, campo) {
    const r = porCodigo.get(codigo);
    const v = r ? r[campo] : null;
    return typeof v === "number" ? v : null;
  }

  function cifra(v, campo) {
    if (campo !== "monto") return fmt.format(v);
    if (v >= 1e9) return `S/ ${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(v / 1e9)} mil millones`;
    if (v >= 1e6) return `S/ ${fmt.format(Math.round(v / 1e6))} millones`;
    return `S/ ${fmt.format(Math.round(v))}`;
  }

  function fecha(iso) {
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const [a, m, d] = iso.split("-").map(Number);
    return `${d} de ${meses[m - 1]} de ${a}`;
  }
})();
