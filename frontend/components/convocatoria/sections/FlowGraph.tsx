"use client";

/**
 * Grafo animado del análisis. Sus nodos salen del MISMO catálogo que el resto del producto
 * (`PASOS` de components/agentes/catalogo, que se deriva de `CARRILES`/`FASES` de
 * lib/auditoria): mismos nombres, misma descripción, mismas fuentes, mismo orden.
 *
 * Antes tenía su propio elenco escrito a mano ("Tasador de Precios", "Cruces Avanzados",
 * "Auditor Ley Contrat.") y nodos de infraestructura ("pg vector · 721 opiniones", "Cloud
 * SQL", "Cloud Storage", "Univ. Perú"): un segundo catálogo que contradecía al primero en la
 * misma pantalla y le hablaba de bases de datos a un ciudadano. Ahora:
 *  · un nodo por paso del catálogo; los que no son IA (SUNAT/OECE, autoevaluación) se
 *    distinguen por color y lo dicen;
 *  · las aristas siguen el DAG real: dentro de cada carril, cada grupo alimenta al siguiente,
 *    y la síntesis arranca cuando terminan las otras dos ramas;
 *  · en el centro, el coordinador: código fijo que reparte el contrato (no es un modelo);
 *  · las fuentes de cada paso se listan en el panel lateral, no como nodos;
 *  · con `prefers-reduced-motion`, sin partículas ni trazos que corren ni anillo que gira.
 *
 * Los ids de nodo se conservan ("parser", "legal", "web", …) porque los usan
 * `nodoActivoYHechos` (lib/auditoria) y la traza del buscador a demanda (`buildTrace`).
 */

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARRILES } from "@/lib/auditoria";
import { PASOS } from "@/components/agentes/catalogo";
import { AGENT_IDS, G_COLOR, G_DONE, G_FLOW, VERB_HEX } from "../constants";
import { buildTrace, extractFindings } from "../utils";

type TipoNodo = "orch" | "agent" | "paso";

interface Nodo {
  id: string;
  label: string;
  sub?: string;
  name: string;
  type: TipoNodo;
  r: number;
  desc: string;
  /** Pasos que lo alimentan (aristas entrantes del DAG). */
  sources: string[];
  /** Pasos a los que alimenta (aristas salientes). */
  stores: string[];
  /** Contra qué coteja, tal como lo declara el catálogo. */
  fuentes: string[];
  carril?: string;
}

/** Clave de fase del catálogo → id de nodo (los mismos que usa nodoActivoYHechos y la traza ADK). */
const ID_NODO: Record<string, string> = {
  compliance: "compliance",
  document_parser: "parser",
  document_legal_analyst: "legal",
  market: "market",
  proveedor: "proveedor",
  web_research: "web",
  news_research: "news",
  entity_personnel: "entity",
  person_network: "person",
  compliance_extended: "extended",
  report_writer: "writer",
  self_eval: "self_eval",
};
const idDe = (clave: string) => ID_NODO[clave] ?? clave;

/** Parte un nombre corto en dos renglones para el círculo ("Red de personas" → "Red de" / "personas"). */
function renglones(nombre: string): { label: string; sub?: string } {
  const w = nombre.split(/\s+/).filter(Boolean);
  if (w.length <= 1) return { label: nombre };
  const mitad = Math.ceil(w.length / 2);
  return { label: w.slice(0, mitad).join(" "), sub: w.slice(mitad).join(" ") };
}

function construirNodos(): Nodo[] {
  const nodos: Nodo[] = [
    {
      id: "orch", label: "Coordinador", sub: "del análisis", name: "Coordinador del análisis", type: "orch", r: 40,
      desc: "Código fijo, no un modelo de IA: recibe el contrato, lo reparte entre los carriles en el orden del catálogo y junta lo que encuentra cada paso.",
      sources: [], stores: [], fuentes: [],
    },
  ];
  const porId = new Map<string, Nodo>();
  for (const p of PASOS) {
    const n: Nodo = {
      id: idDe(p.clave), ...renglones(p.nombre), name: p.titulo, type: p.tipo === "agente" ? "agent" : "paso",
      r: p.tipo === "agente" ? 31 : 27, desc: p.que, sources: [], stores: [], fuentes: p.fuentes, carril: p.carrilLabel,
    };
    nodos.push(n);
    porId.set(n.id, n);
  }
  const unir = (de: string, a: string) => {
    const x = porId.get(de), y = porId.get(a);
    if (!x || !y || x.stores.includes(a)) return;
    x.stores.push(a);
    y.sources.push(de);
  };
  // Dentro de cada carril, cada grupo alimenta al siguiente (los del mismo grupo corren a la vez).
  const finales: string[] = [];
  let sintesis: string[] = [];
  for (const c of CARRILES) {
    const grupos = c.pasos.map((g) => g.map(idDe));
    for (let i = 1; i < grupos.length; i++) for (const de of grupos[i - 1]) for (const a of grupos[i]) unir(de, a);
    if (c.key === "sintesis") sintesis = grupos[0] ?? [];
    else finales.push(...(grupos[grupos.length - 1] ?? []));
  }
  // La síntesis arranca cuando terminan las otras ramas.
  for (const de of finales) for (const a of sintesis) unir(de, a);
  return nodos;
}

const G_NODES: Nodo[] = construirNodos();
/** Raíces de las ramas que corren a la vez: las reparte el coordinador. */
const RAICES = new Set(
  CARRILES.filter((c) => c.key !== "sintesis").flatMap((c) => (c.pasos[0] ?? []).map(idDe)),
);
const G_EDGES: Array<{ from: string; to: string }> = [];
for (const n of G_NODES) for (const s of n.sources) G_EDGES.push({ from: s, to: n.id });
for (const r of RAICES) G_EDGES.push({ from: "orch", to: r });

const colorDe = (t: TipoNodo | undefined) => G_COLOR[t === "paso" ? "src" : t ?? "src"] ?? G_COLOR.src;
const TIPO_LABEL: Record<TipoNodo, string> = { orch: "Coordinador (no es IA)", agent: "Agente de IA", paso: "Paso de datos o control (no es IA)" };

/**
 * `override`: para integraciones que no tienen el stream crudo del ADK (p. ej. la cola
 * financiada de /app/auditoria, que solo persiste fases con timestamps reales) pero SÍ saben
 * con certeza qué nodo está activo y cuáles terminaron: evita adivinar por orden de llegada,
 * que con el DAG paralelo puede marcar "hecha" una fase que sigue corriendo.
 */
export function FlowGraph({ liveEvents = [], override }: {
  liveEvents?: any[];
  override?: { activeId: string; doneIds: string[]; narracion?: string | null } | null;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Esc para cerrar + bloquear el scroll del fondo mientras está en pantalla completa.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [fullscreen]);

  const findings = extractFindings(liveEvents);
  const trace = buildTrace(liveEvents);
  const curStep = trace.length ? trace[trace.length - 1] : null;
  // Estado del grafo derivado del TRACE REAL: qué agente trabaja ahora, cuáles terminaron.
  // (o, en `override`, del estado real de cada fase; ver docstring arriba).
  let activeId = override?.activeId ?? "orch";
  if (!override && curStep) {
    if (AGENT_IDS.includes(curStep.f)) activeId = curStep.f;
    else if (curStep.f === "orch" && AGENT_IDS.includes(curStep.t)) activeId = curStep.t;
  }
  const doneSet = new Set<string>(override?.doneIds ?? []);
  if (!override) {
    trace.forEach((s) => {
      if (AGENT_IDS.includes(s.f)) doneSet.add(s.f);
      if (s.f === "orch" && AGENT_IDS.includes(s.t)) doneSet.add(s.t);
    });
  }
  doneSet.delete(activeId);

  // refs leídos por el rAF loop
  const findRef = useRef(findings); findRef.current = findings;
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const doneRef = useRef(doneSet); doneRef.current = doneSet;

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let quieto = false;
    try { quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* se anima */ }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const FONT = "'Syne', system-ui, sans-serif";
    let raf = 0, CW = 0, CH = 0, sideW = 0, prevActive: string | null = null, frame = 0;
    type SN = Nodo & { x: number; y: number; vx: number; vy: number };
    let sn: SN[] = [];
    let particles: Array<{ from: string; to: string; t: number; speed: number; color: string }> = [];
    const gn = (id: string) => sn.find((n) => n.id === id);

    function resize() {
      CW = wrap!.clientWidth; CH = wrap!.clientHeight;
      // El panel lateral solo le "come" ancho al grafo si sobra espacio de verdad: en un
      // contenedor angosto reservarle 318 px fijos empujaba TODOS los nodos contra el borde.
      sideW = Math.min(318, Math.max(0, CW - 320));
      canvas!.width = CW * dpr; canvas!.height = CH * dpr;
      canvas!.style.width = CW + "px"; canvas!.style.height = CH + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function initSim() {
      const cx = CW / 2 - sideW / 2, cy = CH / 2;
      const pasos = G_NODES.filter((n) => n.type !== "orch");
      const R = Math.min(CW - sideW, CH);
      sn = G_NODES.map((n) => {
        if (n.type === "orch") return { ...n, x: cx, y: cy, vx: 0, vy: 0 };
        // En el orden del catálogo, así cada carril queda junto en el anillo.
        const i = pasos.indexOf(n);
        const angle = (i / pasos.length) * Math.PI * 2 - Math.PI / 2;
        const jit = quieto ? 0 : (Math.random() - 0.5) * 20;
        return { ...n, x: cx + Math.cos(angle) * R * 0.34 + jit, y: cy + Math.sin(angle) * R * 0.34 + jit, vx: 0, vy: 0 };
      });
    }
    function physics() {
      const cx = CW / 2 - sideW / 2, cy = CH / 2;
      for (let i = 0; i < sn.length; i++) for (let j = i + 1; j < sn.length; j++) {
        const a = sn[i], b = sn[j]; const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minD = (a.r + b.r) * 1.9 + 18;
        if (dist < minD) { const f = (minD - dist) / dist * 0.11; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f; }
      }
      const R = Math.min(CW - sideW, CH);
      G_EDGES.forEach((e) => {
        const a = gn(e.from), b = gn(e.to); if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const target = a.type === "orch" || b.type === "orch" ? R * 0.26 : R * 0.2;
        const f = (dist - target) / dist * 0.012; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      });
      sn.forEach((n) => {
        if (n.type === "orch") { n.x = cx; n.y = cy; n.vx = 0; n.vy = 0; return; }
        n.vx += (cx - n.x) * 0.002; n.vy += (cy - n.y) * 0.002;
        n.vx *= 0.78; n.vy *= 0.78; n.x += n.vx; n.y += n.vy;
        const maxX = CW - sideW, pad = n.r + 18;
        if (n.x < pad) { n.x = pad; n.vx *= -0.3; } if (n.x > maxX - pad) { n.x = maxX - pad; n.vx *= -0.3; }
        if (n.y < pad + 8) { n.y = pad + 8; n.vy *= -0.3; } if (n.y > CH - pad - 44) { n.y = CH - pad - 44; n.vy *= -0.3; }
      });
    }
    function spawn(fromId: string, toId: string, color: string) {
      if (quieto) return;
      const a = gn(fromId), b = gn(toId); if (!a || !b) return;
      for (let k = 0; k < 2; k++) particles.push({ from: fromId, to: toId, t: k * 0.14, speed: 0.011 + Math.random() * 0.006, color });
    }
    function emitForActive() {
      const id = activeRef.current; const n = gn(id); if (!n) return;
      n.sources.forEach((s) => spawn(s, id, colorDe(n.type).stroke));
      if (RAICES.has(id)) spawn("orch", id, G_COLOR.orch.stroke);
    }

    function draw() {
      ctx!.clearRect(0, 0, CW, CH);
      // grid sutil
      ctx!.save(); ctx!.strokeStyle = "rgba(30,25,27,0.05)"; ctx!.lineWidth = 1;
      for (let x = 0; x < CW; x += 36) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, CH); ctx!.stroke(); }
      for (let y = 0; y < CH; y += 36) { ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(CW, y); ctx!.stroke(); }
      ctx!.restore();

      const sel = selRef.current, active = activeRef.current, done = doneRef.current, f = findRef.current;
      let selEdges: Set<string> | null = null, selConns: Set<string> | null = null;
      if (sel) {
        selEdges = new Set(); selConns = new Set([sel]);
        G_EDGES.forEach((e) => { if (e.from === sel || e.to === sel) { selEdges!.add(e.from + ">" + e.to); selConns!.add(e.from); selConns!.add(e.to); } });
      }

      // aristas: VERDE cuando llega información al nodo activo
      const liveEdge = (e: { from: string; to: string }) => !sel && e.to === active;
      const dashPhase = quieto ? 0 : -(Date.now() / 38) % 1024;
      const flowPulse = quieto ? 1 : 0.6 + 0.4 * Math.sin(Date.now() / 240);
      G_EDGES.forEach((e) => {
        const a = gn(e.from), b = gn(e.to); if (!a || !b) return;
        const isSel = selEdges && selEdges.has(e.from + ">" + e.to);
        const live = liveEdge(e);
        const dimmed = sel && !isSel;
        const ca = colorDe(a.type).stroke, cb = colorDe(b.type).stroke;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
        ctx!.save();
        if (live) {
          ctx!.globalAlpha = 0.5 + 0.45 * flowPulse;
          ctx!.lineWidth = 2.6;
          ctx!.strokeStyle = G_FLOW;
          if (!quieto) { ctx!.shadowColor = G_FLOW; ctx!.shadowBlur = 11; }
          ctx!.setLineDash([7, 8]); ctx!.lineDashOffset = dashPhase;
        } else if (isSel) {
          ctx!.globalAlpha = 0.85; ctx!.lineWidth = 1.8;
          const g = ctx!.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca); g.addColorStop(1, cb); ctx!.strokeStyle = g;
        } else {
          ctx!.globalAlpha = dimmed ? 0.06 : 0.4;
          ctx!.lineWidth = 1;
          const g = ctx!.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca + "99"); g.addColorStop(1, cb + "99"); ctx!.strokeStyle = g;
        }
        ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.quadraticCurveTo(mx, my, b.x, b.y); ctx!.stroke();
        // punta de flecha: el DAG tiene dirección
        ctx!.setLineDash([]);
        const t = 0.9;
        const qx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, qy = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        const ang = Math.atan2(b.y - qy, b.x - qx);
        const ax = b.x - Math.cos(ang) * (b.r + 2), ay = b.y - Math.sin(ang) * (b.r + 2);
        ctx!.strokeStyle = live ? G_FLOW : cb; ctx!.lineWidth = isSel || live ? 1.8 : 1.1;
        ctx!.beginPath();
        ctx!.moveTo(ax - Math.cos(ang - 0.42) * 7, ay - Math.sin(ang - 0.42) * 7); ctx!.lineTo(ax, ay); ctx!.lineTo(ax - Math.cos(ang + 0.42) * 7, ay - Math.sin(ang + 0.42) * 7);
        ctx!.stroke();
        ctx!.restore();
      });

      // partículas
      particles.forEach((p) => {
        const a = gn(p.from), b = gn(p.to); if (!a || !b) return;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08; const t = p.t;
        const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        ctx!.save(); ctx!.globalAlpha = 0.95 * (1 - t * 0.35); ctx!.shadowColor = p.color; ctx!.shadowBlur = 9; ctx!.fillStyle = p.color;
        ctx!.beginPath(); ctx!.arc(px, py, 3.4, 0, Math.PI * 2); ctx!.fill(); ctx!.restore();
      });

      // nodos
      sn.forEach((n) => {
        const c = colorDe(n.type);
        const isActive = active === n.id, isDone = !isActive && done.has(n.id);
        const isSel = sel === n.id, isHov = hoverRef.current === n.id;
        const dimmed = sel && selConns && !selConns.has(n.id);
        const r = n.r + (isHov && !dimmed ? 2 : 0);
        ctx!.save(); ctx!.globalAlpha = dimmed ? 0.18 : 1;
        if (isActive || isSel) { ctx!.shadowColor = c.stroke; ctx!.shadowBlur = isSel ? 26 : 18; }
        ctx!.beginPath(); ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = isDone ? G_DONE.fill : "#FFFFFF";
        ctx!.fill(); ctx!.shadowBlur = 0;
        ctx!.strokeStyle = isDone ? G_DONE.stroke : (isActive || isSel) ? c.stroke : c.stroke + "66";
        ctx!.lineWidth = (isActive || isSel) ? 2.4 : 1.2;
        if (n.type === "paso") ctx!.setLineDash([4, 3]);
        ctx!.stroke(); ctx!.setLineDash([]);
        // anillo del activo: gira salvo que se pida menos movimiento
        if (isActive && !isDone) {
          const ang = quieto ? 0 : (Date.now() / 520) % (Math.PI * 2);
          ctx!.beginPath(); ctx!.arc(n.x, n.y, r + 6, ang, ang + Math.PI * 1.3); ctx!.strokeStyle = c.stroke; ctx!.lineWidth = 2.6; ctx!.stroke();
        }
        // etiqueta
        let sub = n.sub;
        if (n.id === "web" && f.empresa) sub = String(f.empresa).split(" ").slice(0, 2).join(" ");
        else if (n.id === "person" && f.socios.length) sub = `${f.socios.length} socios`;
        const lines = [n.label]; if (sub) lines.push(sub);
        const fs = n.type === "orch" ? 12 : 11;
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
        ctx!.fillStyle = dimmed ? "#A79DA1" : isDone ? G_DONE.text : (isActive || isSel) ? c.stroke : "#1E191B"; // ink
        ctx!.font = `${n.type === "orch" ? "800" : "700"} ${fs}px ${FONT}`;
        lines.forEach((line, i) => { const lh = fs + 2; const yOff = (i - (lines.length - 1) / 2) * lh; ctx!.fillText(line, n.x, n.y + yOff); });
        if (isDone) { ctx!.fillStyle = G_DONE.stroke; ctx!.font = `${Math.max(r * 0.5, 10)}px sans-serif`; ctx!.fillText("✓", n.x + r * 0.62, n.y - r * 0.62); }
        ctx!.restore();
      });
    }

    function loop() {
      frame++;
      if (activeRef.current !== prevActive) { prevActive = activeRef.current; emitForActive(); }
      if (frame % 64 === 0) emitForActive();
      particles = particles.filter((p) => { p.t += p.speed; return p.t < 1; });
      physics(); draw();
      raf = requestAnimationFrame(loop);
    }
    function pick(ev: MouseEvent): SN | null {
      const rect = canvas!.getBoundingClientRect(); const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let hit: SN | null = null;
      sn.forEach((n) => { if (Math.hypot(mx - n.x, my - n.y) < n.r + 8) hit = n; });
      return hit;
    }
    const onMove = (ev: MouseEvent) => { const h = pick(ev); hoverRef.current = h ? h.id : null; canvas.style.cursor = h ? "pointer" : "default"; };
    const onClick = (ev: MouseEvent) => { const h = pick(ev); const id = h && h.id === selRef.current ? null : (h ? h.id : null); selRef.current = id; setSelected(id); };

    resize(); initSim(); emitForActive();
    raf = requestAnimationFrame(loop);
    // ResizeObserver, no solo el resize de window: el contenedor también cambia de tamaño
    // al entrar/salir de pantalla completa (mismo nodo, solo cambia su CSS).
    const onResize = () => { resize(); initSim(); };
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener("mousemove", onMove); canvas.removeEventListener("click", onClick); };
  }, []);

  const nm = (id: string) => G_NODES.find((n) => n.id === id)?.name || id;
  const stroke = (id: string) => colorDe(G_NODES.find((n) => n.id === id)?.type).stroke;
  const selNode = selected ? G_NODES.find((n) => n.id === selected) : null;
  const recent = trace.slice(-6).reverse();

  // El div del backdrop SIEMPRE está presente (con `contents` cuando no hace nada) para que
  // el div con `ref={wrapRef}` nunca cambie de posición en el árbol: si el backdrop apareciera
  // y desapareciera condicionalmente, React desmontaría y remontaría el canvas al entrar/salir
  // de pantalla completa, perdiendo el efecto imperativo (`useEffect` de deps `[]`) que lo arma.
  return (
    <div
      className={fullscreen ? "fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm sm:p-8" : "contents"}
      onClick={fullscreen ? (e) => { if (e.target === e.currentTarget) setFullscreen(false); } : undefined}
    >
    <div ref={wrapRef} className={cn(
        "relative overflow-hidden rounded-2xl border border-line bg-paperSoft",
        fullscreen ? "h-full w-full max-w-[1600px]" : "h-[480px] w-full sm:h-[560px]",
      )}>
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-label="Grafo de los pasos del análisis y el orden en que corren" role="img" />

      {/* pantalla completa */}
      <button
        type="button"
        onClick={() => setFullscreen((v) => !v)}
        className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-line bg-paperSoft/70 px-2.5 py-1 font-mono text-[10px] text-mute backdrop-blur transition-colors hover:text-ink"
        title={fullscreen ? "Salir de pantalla completa (Esc)" : "Ver en grande"}
      >
        {fullscreen ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}
        {fullscreen ? "Cerrar" : "Ver en grande"}
      </button>

      {/* PANEL LATERAL DE DESCUBRIMIENTO */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex max-h-[calc(100%-90px)] w-[min(286px,45%)] flex-col gap-2.5 overflow-y-auto">
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          {selNode ? (
            <>
              <div className="font-display text-[17px] font-bold leading-tight" style={{ color: stroke(selNode.id) }}>{selNode.name}</div>
              <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider"
                style={{ background: stroke(selNode.id) + "1f", color: stroke(selNode.id), border: `1px solid ${stroke(selNode.id)}55` }}>
                {TIPO_LABEL[selNode.type]}{selNode.carril ? `, carril ${selNode.carril}` : ""}
              </span>
              <p className="mt-2 text-[12px] leading-relaxed text-ink/75">{selNode.desc}</p>
              {selNode.fuentes.length > 0 && (
                <div className="mt-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-mute">Coteja contra</div>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {selNode.fuentes.map((c) => <li key={c} className="rounded-md border border-line bg-paperDeep/60 px-2 py-0.5 text-[10px] text-mute">{c}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-mute">Haz clic en un paso para ver qué hace y contra qué fuentes coteja.</p>
          )}
        </div>

        {/* Hallazgos en vivo (necesita el trace fino del ADK: no disponible en `override`) */}
        {!override && (
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 text-[12px] font-semibold text-ink">Hallazgos en vivo</div>
          {(findings.empresa || findings.entidad || findings.socios.length > 0 || findings.senales.length > 0) ? (
            <div className="flex flex-col gap-2 text-[12px]">
              {findings.entidad && <div><span className="text-[10px] uppercase tracking-wide text-mute">entidad</span> <span className="font-semibold text-ink">{findings.entidad}</span></div>}
              {findings.empresa && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-mute">empresa</span>
                  <span className="font-semibold text-ink">{findings.empresa}</span>
                  {findings.ruc && <span className="rounded-full border border-line bg-paperDeep/60 px-2 py-0.5 font-mono text-[9px] text-mute">RUC {findings.ruc}</span>}
                  {findings.estado && <span className="rounded-full bg-moss/10 px-2 py-0.5 text-[9px] font-bold text-mossTexto">{findings.estado}</span>}
                  {findings.apto === false && <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-[9px] font-bold text-rust">NO APTO</span>}
                  {typeof findings.n_sanciones === "number" && findings.n_sanciones > 0 && <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-[9px] font-bold text-rust">{findings.n_sanciones} sanciones</span>}
                </div>
              )}
              {findings.socios.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-mute">socios</span>
                  {findings.socios.slice(0, 6).map((s: string, i: number) => <span key={i} className="rounded-md border border-line bg-paperDeep/60 px-2 py-0.5 text-[11px] text-ink">{s}</span>)}
                </div>
              )}
              {findings.senales.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-mute">señales</span>
                  {findings.senales.slice(0, 6).map((s: string, i: number) => <span key={i} className="rounded-full bg-crimson-soft px-2 py-0.5 text-[10px] font-bold text-rust">{s.replace(/_/g, " ")}</span>)}
                </div>
              )}
            </div>
          ) : <p className="text-[12px] text-mute">Aún sin hallazgos…</p>}
        </div>
        )}

        {/* Traza de invocaciones (compacta: verbo + acción): ídem, requiere el trace fino */}
        {!override && (
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-mute">Últimos pasos</div>
          {recent.length ? (
            <div className="flex flex-col gap-1">
              {recent.slice(-6).map((s, i) => (
                <div key={i} className="flex items-baseline gap-1.5 text-[10px] leading-snug text-mute">
                  <span className="shrink-0 font-mono font-bold" style={{ color: VERB_HEX[s.v] }}>{s.v}</span>
                  <span className="truncate">{s.m}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-mute">Esperando el primer paso…</p>}
        </div>
        )}

        {/* Leyenda */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-mute">Leyenda</div>
          <ul className="flex flex-col gap-1.5 text-[12px] text-mute">
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.agent.stroke }} aria-hidden />Agente de IA</li>
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border border-dashed" style={{ borderColor: G_COLOR.src.stroke, background: G_COLOR.src.stroke + "40" }} aria-hidden />Paso de datos o control (no es IA)</li>
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.orch.stroke }} aria-hidden />Coordinador (código fijo)</li>
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-mute">Las flechas siguen el orden real: expediente y proveedor a la vez, la síntesis al final.</p>
        </div>
      </div>

      {/* BARRA DE NARRACIÓN (paso actual) */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-full border border-line bg-paperSoft/95 px-5 py-2.5 shadow-lg backdrop-blur sm:max-w-[calc(100%-320px)]">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: curStep ? VERB_HEX[curStep.v] : stroke(activeId) }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: curStep ? VERB_HEX[curStep.v] : stroke(activeId) }} />
        </span>
        {override?.narracion ? (
          <span className="truncate font-display text-[14px] font-semibold text-ink">
            Ahora: <span style={{ color: stroke(activeId) }}>{override.narracion}</span>
          </span>
        ) : curStep ? (
          <span className="truncate font-display text-[14px] font-semibold text-ink">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: VERB_HEX[curStep.v] }}>{curStep.v}</span>
            {" "}<span style={{ color: stroke(curStep.f) }}>{nm(curStep.f)}</span> {curStep.m}
          </span>
        ) : (
          <span className="font-display text-[14px] font-semibold text-ink">Repartiendo el contrato entre los agentes…</span>
        )}
      </div>
    </div>
    </div>
  );
}
