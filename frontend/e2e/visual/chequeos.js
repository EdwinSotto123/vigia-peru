// Chequeos visuales de una página de Vigía, en el navegador. Los corre e2e/visual/recorrer.py con agent-browser
// (`eval`) y devuelve un JSON. Cada chequeo es una regla que pidió el usuario o una de accesibilidad básica:
//   separadores   ningún "·" ni "•" suelto como separador de datos (sí el tapado "•••" y las refs "ref·")
//   desborde      la página no se desplaza de costado
//   migas         toda página de detalle tiene su ruta (Migas, nav "Ruta de navegación")
//   listas        una lista de 10 filas o más tiene buscador; de más de una página, paginación (salvo data-lista:
//                 gráficos, carruseles y avances que enlazan a la lista entera)
//   textoSuelto   párrafos largos sueltos, fuera de una tarjeta (borde o fondo propio)
//   colorFijo     estilos en línea con un color fijo (#…, rgb(…) sin var(--…))
//   tamanos       cuántos tamaños de letra distintos hay (jerarquía)
//   contraste     textos con contraste menor a 4.5:1 (3:1 si es grande) contra su fondo
//   sinNombre     botones o enlaces sin nombre accesible; imágenes sin alt
//   jerarquia     h1 bajo 26 px, h2 bajo 18, h3 bajo 15 (un título del tamaño del texto); textoChico: textos bajo 11 px
//   pantallas     cuántas pantallas hay que bajar; cajas y anidadas: tarjetas, y tarjetas dentro de otra tarjeta
(() => {
  const visible = (el) => {
    if (!el) return false;
    // Lo de adentro de un <details> cerrado no se ve (Chrome igual le da caja: content-visibility, no display: none).
    const plegado = el.closest("details:not([open])");
    if (plegado && !el.closest("summary")) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // Más de 1 px: lo de 1 px es el nombre oculto de un botón (`sr-only`), que no se ve.
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const corto = (t, n = 90) => t.replace(/\s+/g, " ").trim().slice(0, n);
  const ruta = (el) => {
    const partes = [];
    for (let x = el; x && x !== document.body && partes.length < 4; x = x.parentElement) {
      const id = x.id ? `#${x.id}` : "";
      const aria = x.getAttribute("aria-label") ? `[${x.getAttribute("aria-label").slice(0, 30)}]` : "";
      partes.unshift(`${x.tagName.toLowerCase()}${id}${aria}`);
    }
    return partes.join(" > ");
  };

  // ── separadores ────────────────────────────────────────────────────────────
  const separadores = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (!p || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(p.tagName) || !visible(p)) continue;
    const t = (n.textContent || "").replace(/(10·)?ref·[0-9A-Z]{6}/g, "").replace(/•{2,}/g, "");
    if (/·|•/.test(t)) separadores.push({ texto: corto(n.textContent), donde: ruta(p) });
  }

  // ── desborde ───────────────────────────────────────────────────────────────
  const ancho = document.documentElement.clientWidth;
  const desborde = document.documentElement.scrollWidth > ancho + 1
    ? { scroll: document.documentElement.scrollWidth, ancho, culpables: [...document.querySelectorAll("body *")]
        .filter((e) => visible(e) && e.getBoundingClientRect().right > ancho + 2 && getComputedStyle(e).position !== "fixed")
        .filter((e) => !e.closest("[class*='overflow-x-auto'],[class*='overflow-auto'],[class*='overflow-x-scroll']"))
        .slice(0, 5).map((e) => ({ el: ruta(e), right: Math.round(e.getBoundingClientRect().right) })) }
    : null;

  // ── migas ──────────────────────────────────────────────────────────────────
  const migas = !!document.querySelector('nav[aria-label="Ruta de navegación"]');

  // ── listas ─────────────────────────────────────────────────────────────────
  // Tablas del kit (<ul aria-label> con filas <li>), <table>, y listas largas de tarjetas.
  const listas = [];
  const contenedores = [...document.querySelectorAll("main ul[aria-label], main table, main ol")];
  for (const l of contenedores) {
    // Un gráfico de barras, un carrusel o un avance que enlaza a la lista entera no son listas para buscar
    // (data-lista="grafico" | "carrusel" | "avance").
    if (!visible(l) || l.closest("[data-lista]")) continue;
    const filas = l.tagName === "TABLE" ? l.querySelectorAll("tbody tr").length : [...l.children].filter((c) => c.tagName === "LI").length;
    if (filas < 10) continue;
    // El buscador y la paginación de esa lista: en su sección (subiendo hasta 5 niveles).
    let s = l;
    for (let i = 0; i < 5 && s.parentElement && s.parentElement.tagName !== "MAIN"; i++) s = s.parentElement;
    const buscador = !!s.querySelector('input[type="search"], input[placeholder^="Buscar"], input[aria-label^="Buscar"]');
    // Por nombre accesible (Paginacion) o por texto visible (PaginacionCursor: "Anterior" / "Siguiente").
    const paginacion = !!s.querySelector('[aria-label="Página siguiente"], [aria-label="Página anterior"]')
      || [...s.querySelectorAll("a, button")].some((b) => /^(anterior|siguiente)\b/i.test((b.textContent || "").trim()));
    listas.push({ lista: ruta(l), filas, buscador, paginacion });
  }

  // ── texto suelto ───────────────────────────────────────────────────────────
  // El fondo que se ve detrás de un elemento: las capas semitransparentes (un bg-granate/10) compuestas sobre las de abajo.
  const rgba = (c) => { const m = (c || "").match(/[\d.]+/g); return m ? [Number(m[0]), Number(m[1]), Number(m[2]), m[3] == null ? 1 : Number(m[3])] : null; };
  const fondoDe = (el) => {
    const capas = [];
    for (let x = el; x; x = x.parentElement) {
      const st = getComputedStyle(x);
      // Un degradado (una banda `bg-gradient-to-br from-granate-deep…`) se pinta ENCIMA del color de fondo del mismo
      // elemento: se toma su primer color como capa. Sin esto el texto claro de una banda se medía contra la página.
      const enDegradado = /gradient/.test(st.backgroundImage) ? st.backgroundImage.match(/rgba?\([^)]*\)/) : null;
      const d = enDegradado ? rgba(enDegradado[0]) : null;
      if (d && d[3] > 0) { capas.push(d); if (d[3] >= 1) break; }
      const c = rgba(st.backgroundColor);
      if (c && c[3] > 0) { capas.push(c); if (c[3] >= 1) break; }
    }
    let [r, g, b] = [255, 255, 255];
    for (const [cr, cg, cb, ca] of capas.reverse()) { r = cr * ca + r * (1 - ca); g = cg * ca + g * (1 - ca); b = cb * ca + b * (1 - ca); }
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  };
  /** El color del texto compuesto sobre su fondo (un text-ink/70 es más claro de lo que dice su rgb). */
  const colorSobre = (color, fondo) => {
    const c = rgba(color), f = rgba(fondo);
    if (!c || !f) return color;
    const a = c[3];
    return `rgb(${Math.round(c[0] * a + f[0] * (1 - a))}, ${Math.round(c[1] * a + f[1] * (1 - a))}, ${Math.round(c[2] * a + f[2] * (1 - a))})`;
  };
  const enTarjeta = (el) => {
    const fondoPagina = getComputedStyle(document.body).backgroundColor;
    for (let x = el; x && x.tagName !== "MAIN" && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x);
      const borde = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none");
      const fondo = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent" && s.backgroundColor !== fondoPagina;
      if (borde || fondo) return true;
    }
    return false;
  };
  // innerText: sólo lo que se ve (textContent contaba el texto oculto de los globos de Ayuda); y sin el nombre
  // `sr-only` de los botones ⓘ, que se lee pero no se ve («¿Qué es un proceso de selección?» alargaba la línea).
  const textoVisible = (p) => {
    let t = p.innerText || "";
    for (const s of p.querySelectorAll(".sr-only")) t = t.replace(s.innerText || s.textContent || "", "");
    return t.replace(/\s+/g, " ").trim();
  };
  const textoSuelto = [...document.querySelectorAll("main p")]
    // La bajada del encabezado de la página va suelta a propósito (EncabezadoPagina).
    .filter((p) => visible(p) && !p.closest("header") && textoVisible(p).length > 140 && !enTarjeta(p))
    .map((p) => ({ texto: corto(textoVisible(p), 120), donde: ruta(p) }));

  // ── color fijo en estilos en línea ─────────────────────────────────────────
  const colorFijo = [...document.querySelectorAll("[style]")]
    .filter((e) => /#[0-9a-f]{3,8}\b|rgba?\((?!var)/i.test(e.getAttribute("style") || "") && !/var\(--/.test(e.getAttribute("style") || ""))
    .slice(0, 10).map((e) => ({ el: ruta(e), style: corto(e.getAttribute("style"), 80) }));

  // ── tamaños de letra y contraste ───────────────────────────────────────────
  const tamanos = {};
  const contraste = [];
  const lum = (rgb) => {
    const m = rgb.match(/[\d.]+/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const tw2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vistos = new Set();
  for (let n = tw2.nextNode(); n; n = tw2.nextNode()) {
    const p = n.parentElement;
    if (!p || vistos.has(p) || !(n.textContent || "").trim() || !visible(p) || ["SCRIPT", "STYLE"].includes(p.tagName)) continue;
    vistos.add(p);
    const s = getComputedStyle(p);
    tamanos[s.fontSize] = (tamanos[s.fontSize] || 0) + 1;
    const fondo = fondoDe(p);
    const a = lum(colorSobre(s.color, fondo)), b = lum(fondo);
    if (a == null || b == null) continue;
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const grande = parseFloat(s.fontSize) >= 18.66 || (parseFloat(s.fontSize) >= 14 && Number(s.fontWeight) >= 700);
    if (ratio < (grande ? 3 : 4.5)) contraste.push({ texto: corto(n.textContent, 50), ratio: Math.round(ratio * 100) / 100, tam: s.fontSize, color: s.color, fondo });
  }

  // ── sin nombre accesible ───────────────────────────────────────────────────
  const sinNombre = [...document.querySelectorAll("button, a[href], [role=button]")]
    .filter((e) => visible(e) && !(e.textContent || "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("title") && !e.querySelector("[aria-label],img[alt]") && !e.getAttribute("aria-labelledby"))
    .slice(0, 10).map((e) => ruta(e));
  const imgSinAlt = [...document.querySelectorAll("img")].filter((i) => visible(i) && !i.hasAttribute("alt")).length;

  // ── jerarquía ──────────────────────────────────────────────────────────────
  // El h1 se ve más grande que los h2, y éstos que los h3; nada visible bajo 11 px. Mide lo que pinta el navegador, así
  // también atrapa un tamaño que `cn()` borró (tailwind-merge sin la escala, 2026-10-22).
  const MINIMO = { H1: 26, H2: 18, H3: 15 };
  const jerarquia = [];
  for (const h of document.querySelectorAll("main h1, main h2, main h3")) {
    if (!visible(h) || h.closest("[data-lista], nav")) continue;
    const px = parseFloat(getComputedStyle(h).fontSize);
    if (px < MINIMO[h.tagName]) jerarquia.push({ nivel: h.tagName, px, texto: corto(h.innerText, 50) });
  }
  const chico = Object.entries(tamanos).filter(([t]) => parseFloat(t) < 11).reduce((n, [, c]) => n + c, 0);

  // ── scroll y cajas ─────────────────────────────────────────────────────────
  // pantallas: cuánto hay que bajar para ver todo (alto de la página / alto de la ventana). cajas: bloques con borde y
  // radio de tarjeta (no botones ni chips: el radio de una píldora pasa de 40 px); anidadas: una caja dentro de otra.
  const alto = document.documentElement.scrollHeight;
  const pantallas = Math.round((alto / innerHeight) * 10) / 10;
  const esCaja = (el) => {
    const s = getComputedStyle(el);
    const r = parseFloat(s.borderTopLeftRadius);
    return parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderLeftWidth) >= 1 && s.borderTopStyle !== "none" && r >= 10 && r < 40
      && el.offsetWidth > 160 && el.offsetHeight > 48;
  };
  const cajas = [...document.querySelectorAll("main div, main section, main article, main li, main aside, main details, main figure")]
    .filter((el) => visible(el) && esCaja(el));
  const enCaja = new Set(cajas);
  // Una capa flotante (la leyenda sobre el mapa, un globo) no es una caja dentro de otra: necesita su superficie. Flota
  // si ella o algo entre ella y su caja madre va en `position: absolute` o `fixed`.
  const flota = (x) => ["absolute", "fixed"].includes(getComputedStyle(x).position);
  const anidadas = cajas.filter((el) => {
    let capa = flota(el);
    for (let x = el.parentElement; x && x.tagName !== "MAIN"; x = x.parentElement) {
      if (enCaja.has(x)) return !capa;
      capa = capa || flota(x);
    }
    return false;
  });

  return JSON.stringify({
    alto, pantallas, nCajas: cajas.length, nAnidadas: anidadas.length, anidadas: anidadas.slice(0, 6).map(ruta),
    url: location.pathname + location.search,
    titulo: document.title,
    separadores: separadores.slice(0, 15), nSeparadores: separadores.length,
    desborde,
    migas,
    listas,
    textoSuelto: textoSuelto.slice(0, 8), nTextoSuelto: textoSuelto.length,
    colorFijo,
    tamanos,
    contraste: contraste.slice(0, 12), nContraste: contraste.length,
    sinNombre, imgSinAlt,
    jerarquia: jerarquia.slice(0, 10), nJerarquia: jerarquia.length, textoChico: chico,
  });
})();
