/*
 * Medición de DENSIDAD de una pantalla. Se ejecuta DENTRO de la página (agent-browser eval) y devuelve un
 * string JSON. Mide solo el contenido de <main> (si existe): el menú lateral y la cabecera no cuentan.
 *
 * Qué detecta (los números están definidos en README.md):
 *   · cajas ralas   : cajas visibles (borde, fondo o sombra, >= 160x72) con área >= 40.000 px² y < 120
 *                     caracteres sin medios que la llenen, o con vacío interno > 55 % (área >= 20.000 px²)
 *   · huecos        : espacio vertical > 72 px entre hermanos apilados (los separadores de sección se marcan)
 *   · minH          : bloques con min-height forzada (>= 160 px) cuyo contenido ocupa menos de la mitad
 *   · vacío inicial : porcentaje del primer viewport de <main> sin contenido (a 24 px de resolución)
 *   · tablas        : de una sola fila o con filas muy altas (> 72 px de promedio)
 */
(() => {
  const VW = innerWidth;
  const VH = innerHeight;
  const sx = scrollX;
  const sy = scrollY;
  const main = document.querySelector("main") || document.body;
  const mr0 = main.getBoundingClientRect();
  const MR = { x: mr0.left + sx, y: mr0.top + sy, w: mr0.width, h: Math.max(mr0.height, 1) };

  const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const rectAbs = (r) => ({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
  const limpio = (s) => (s || "").replace(/\s+/g, " ").trim();
  const alfa = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return c && c !== "transparent" ? 1 : 0;
    const p = m[1].split(new RegExp("[ ,/]+")).filter(Boolean);
    return p.length >= 4 ? parseFloat(p[3]) : 1;
  };
  // El contenido de un <details> cerrado no se pinta (content-visibility: hidden) aunque conserve caja:
  // contarlo daba "cajas ralas con 0 caracteres" que nadie ve. Solo cuenta su <summary>.
  const enDetailsCerrado = (el) => {
    let d = el.closest("details");
    while (d) {
      if (!d.open && el !== d) {
        const s = d.querySelector(":scope > summary");
        if (!(s && s.contains(el))) return true;
      }
      d = d.parentElement ? d.parentElement.closest("details") : null;
    }
    return false;
  };
  const visible = (el, cs) => {
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    if (enDetailsCerrado(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const tieneCaja = (cs) => {
    const borde = ["Top", "Right", "Bottom", "Left"].some(
      (l) => num(cs[`border${l}Width`]) > 0 && cs[`border${l}Style`] !== "none" && alfa(cs[`border${l}Color`]) > 0.04,
    );
    return borde || alfa(cs.backgroundColor) > 0.03 || cs.backgroundImage !== "none" || cs.boxShadow !== "none";
  };

  const selector = (el) => {
    const partes = [];
    let e = el;
    for (let i = 0; e && e !== document.body && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      const cls = (typeof e.className === "string" ? e.className : "")
        .split(/\s+/)
        .filter((c) => c && !/[:\[\]/]/.test(c))
        .slice(0, 3);
      if (cls.length) s += "." + cls.join(".");
      partes.unshift(s);
    }
    return partes.join(" > ");
  };
  const clasesCrudas = (el) => (typeof el.className === "string" ? limpio(el.className) : "");
  const fragmentos = (el) =>
    (el.innerText || "")
      .split(String.fromCharCode(10))
      .map(limpio)
      .filter((t) => t.length >= 6)
      .slice(0, 4)
      .map((t) => t.slice(0, 48));

  // ── Rectángulos de contenido (texto y medios) ───────────────────────────────────────────────
  const contenido = []; // {x,y,w,h}
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (limpio(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let textoTotal = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p) continue;
    const cs = getComputedStyle(p);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0 || enDetailsCerrado(p)) continue;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 0 && r.height > 0) contenido.push(rectAbs(r));
    textoTotal += limpio(n.nodeValue).length;
  }
  const MEDIOS = "img,svg,canvas,video,iframe,input,select,textarea,button,picture,[role=img],[role=progressbar]";
  for (const el of main.querySelectorAll(MEDIOS)) {
    // un svg dentro de un botón o ícono ya cuenta con el botón
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) continue;
    if (el.tagName === "svg" && el.closest("button, a")) continue;
    contenido.push(rectAbs(el.getBoundingClientRect()));
  }

  // fracción de un rectángulo cubierta por contenido dilatado (rejilla de `paso` px)
  const cubierto = (box, dilatar, paso = 8) => {
    const cols = Math.max(1, Math.ceil(box.w / paso));
    const filas = Math.max(1, Math.ceil(box.h / paso));
    const grid = new Uint8Array(cols * filas);
    for (const c of contenido) {
      const x0 = Math.max(box.x, c.x - dilatar);
      const y0 = Math.max(box.y, c.y - dilatar);
      const x1 = Math.min(box.x + box.w, c.x + c.w + dilatar);
      const y1 = Math.min(box.y + box.h, c.y + c.h + dilatar);
      if (x1 <= x0 || y1 <= y0) continue;
      const i0 = Math.floor((x0 - box.x) / paso);
      const i1 = Math.min(cols - 1, Math.floor((x1 - box.x - 0.01) / paso));
      const j0 = Math.floor((y0 - box.y) / paso);
      const j1 = Math.min(filas - 1, Math.floor((y1 - box.y - 0.01) / paso));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * cols + i] = 1;
    }
    let n = 0;
    for (let k = 0; k < grid.length; k++) n += grid[k];
    return n / grid.length;
  };

  // ── Cajas ralas ─────────────────────────────────────────────────────────────────────────────
  const todos = [...main.querySelectorAll("*")];
  const candidatos = [];
  const cajas = [];
  for (const el of main.querySelectorAll("div,section,article,li,aside,details,figure,a,form,fieldset,ul,ol,dl")) {
    const cs = getComputedStyle(el);
    if (!visible(el, cs) || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 72) continue;
    if (!tieneCaja(cs)) continue;
    // envoltorios de página (cubren casi todo <main>): no son una caja de contenido
    if (r.width >= MR.w * 0.94 && r.height >= Math.min(MR.h * 0.9, VH * 1.5)) continue;
    cajas.push({ el, cs, r: rectAbs(r) });
  }
  for (const { el, r } of cajas) {
    const area = r.w * r.h;
    const chars = limpio(el.innerText).length;
    const lleno = cubierto(r, 12);
    const vacio = 1 - lleno;
    const rala = area >= 40000 && chars < 120 && vacio >= 0.35;
    const vacia = area >= 20000 && vacio > 0.55;
    if (!rala && !vacia) continue;
    const titulo = el.querySelector("h1,h2,h3,h4,h5,[class*=title]");
    candidatos.push({
      el,
      sel: selector(el),
      clases: clasesCrudas(el),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.w),
      h: Math.round(r.h),
      area: Math.round(area),
      chars,
      vacio: +vacio.toFixed(2),
      razon: rala ? "poco texto en caja grande" : "vacío interno alto",
      titulo: limpio(titulo?.innerText).slice(0, 60),
      texto: limpio(el.innerText).slice(0, 90),
      frag: fragmentos(el),
      desperdicio: Math.round(area * Math.max(vacio, 0.35)),
    });
  }
  // se queda la caja más interna cuando hay una ralas dentro de otra ralas de tamaño parecido
  const ralas = candidatos.filter(
    (c) => !candidatos.some((o) => o !== c && c.el.contains(o.el) && o.area >= c.area * 0.3),
  );

  // ── Huecos verticales ───────────────────────────────────────────────────────────────────────
  const huecos = [];
  for (const padre of [main, ...todos]) {
    const hijos = [...padre.children].filter((h) => {
      const cs = getComputedStyle(h);
      if (!visible(h, cs)) return false;
      return cs.position !== "absolute" && cs.position !== "fixed" && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(h.tagName);
    });
    if (hijos.length < 2) continue;
    const pcs = getComputedStyle(padre);
    if (pcs.display.includes("flex") && pcs.flexDirection.startsWith("row")) continue;
    if (pcs.display.includes("grid") && num(pcs.gridTemplateColumns.split(" ").length) > 1) continue;
    const ord = hijos.map((h) => ({ h, r: h.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
    for (let i = 1; i < ord.length; i++) {
      const a = ord[i - 1];
      const b = ord[i];
      const hueco = b.r.top - a.r.bottom;
      if (hueco <= 72) continue;
      const solape = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      if (solape < Math.min(a.r.width, b.r.width) * 0.5) continue; // no están apilados
      const sec = (e) => /^(SECTION|HEADER|FOOTER|HR)$/.test(e.tagName) || /^H[1-3]$/.test(e.tagName);
      const exento = padre === main || (sec(a.h) && sec(b.h)) || /^H[1-3]$/.test(b.h.tagName);
      huecos.push({
        padre: selector(padre),
        hueco: Math.round(hueco),
        y: Math.round(a.r.bottom + sy),
        ancho: Math.round(Math.min(a.r.width, b.r.width)),
        antes: limpio(a.h.innerText).slice(0, 50),
        despues: limpio(b.h.innerText).slice(0, 50),
        frag: [...fragmentos(b.h), ...fragmentos(a.h)].slice(0, 4),
        exento,
        desperdicio: Math.round((hueco - 72) * Math.min(a.r.width, b.r.width)),
      });
    }
  }

  // ── min-height forzada con poco contenido ───────────────────────────────────────────────────
  const minH = [];
  for (const el of todos) {
    const cs = getComputedStyle(el);
    if (!cs.minHeight.endsWith("px") || !visible(el, cs)) continue;
    const mh = num(cs.minHeight);
    if (mh < 160) continue;
    const r = rectAbs(el.getBoundingClientRect());
    if (r.h > mh + 2) continue; // la min-height no está mandando
    const lleno = cubierto(r, 12);
    if (lleno >= 0.5) continue;
    minH.push({
      sel: selector(el),
      clases: clasesCrudas(el),
      minHeight: Math.round(mh),
      h: Math.round(r.h),
      w: Math.round(r.w),
      chars: limpio(el.innerText).length,
      vacio: +(1 - lleno).toFixed(2),
      texto: limpio(el.innerText).slice(0, 70),
      frag: fragmentos(el),
      desperdicio: Math.round(r.w * r.h * (1 - lleno)),
    });
  }

  // ── Vacío del primer viewport ───────────────────────────────────────────────────────────────
  const region = { x: MR.x, y: Math.max(MR.y, 0), w: MR.w, h: Math.min(MR.y + MR.h, VH) - Math.max(MR.y, 0) };
  const vacioInicial = region.h > 0 ? 1 - cubierto(region, 32, 24) : 0;

  // ── Tablas ──────────────────────────────────────────────────────────────────────────────────
  const tablas = [];
  for (const t of main.querySelectorAll("table")) {
    const cs = getComputedStyle(t);
    if (!visible(t, cs)) continue;
    const filas = [...t.querySelectorAll("tbody tr")].filter((f) => f.getBoundingClientRect().height > 0);
    const alto = filas.length ? filas.reduce((s, f) => s + f.getBoundingClientRect().height, 0) / filas.length : 0;
    const motivo = filas.length === 1 ? "una sola fila" : alto > 72 ? "filas muy altas" : null;
    if (motivo)
      tablas.push({ sel: selector(t), filas: filas.length, altoFila: Math.round(alto), motivo, texto: limpio(t.innerText).slice(0, 60) });
  }

  const alturaPagina = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const orden = (a, b) => b.desperdicio - a.desperdicio;
  const out = {
    url: location.pathname + location.search,
    titulo: document.title,
    viewport: { w: VW, h: VH },
    alturaPagina,
    alturaMain: Math.round(MR.h),
    anchoMain: Math.round(MR.w),
    cajasCandidatas: cajas.length,
    caracteres: textoTotal,
    textoPor10mil: +((textoTotal / ((MR.w * MR.h) / 10000)) || 0).toFixed(1),
    vacioInicial: +vacioInicial.toFixed(2),
    ralas: ralas.sort(orden).slice(0, 25).map(({ el, ...r }) => r),
    huecos: huecos.sort(orden).slice(0, 25),
    minH: minH.sort(orden).slice(0, 15),
    tablas: tablas.slice(0, 10),
    texto: limpio(main.innerText).slice(0, 160),
  };
  return JSON.stringify(out);
})()
