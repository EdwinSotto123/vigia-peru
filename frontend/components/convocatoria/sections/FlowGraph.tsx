"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { GNode } from "../types";
import { AGENT_IDS, G_COLOR, G_DONE, G_FLOW, TYPE_LABEL, VERB_HEX } from "../constants";
import { buildTrace, extractFindings } from "../utils";

const G_NODES: GNode[] = [
  { id: "orch", label: "Orquestador", sub: "Vigía Core", name: "Orquestador · Vigía Core", type: "orch", r: 44,
    sources: ["oece_ocds", "seace"], stores: ["sql"],
    desc: "Recibe el código de la convocatoria, razona el plan global, decide a qué agente llamar y en qué orden, y consolida el veredicto final." },
  // AGENTES
  { id: "compliance", label: "Auditor", sub: "Ley Contrat.", name: "Auditor Normativo", type: "agent", r: 33,
    sources: ["pgvec"], stores: ["sql"],
    desc: "Aplica las reglas duras de la Ley de Contrataciones del Estado: único postor, plazos ilegales, adendas > 25%, contratación directa sin causal." },
  { id: "parser", label: "Lector", sub: "Expediente", name: "Lector de Expediente", type: "agent", r: 31,
    sources: ["seace"], stores: ["sql", "gcs"],
    desc: "Descarga y lee los PDFs del expediente (bases, acta de buena pro, contrato) y extrae ítems, firmantes y comité de selección." },
  { id: "legal", label: "Analista", sub: "Legal · OECE", name: "Analista Legal", type: "agent", r: 31,
    sources: ["pgvec"], stores: ["sql"],
    desc: "Cruza el caso contra 721 opiniones normativas del OECE mediante búsqueda semántica (pgvector) y cita la jurisprudencia aplicable." },
  { id: "market", label: "Tasador", sub: "de Precios", name: "Tasador de Precios", type: "agent", r: 32,
    sources: ["google", "mef"], stores: ["sql"],
    desc: "Tasa cada ítem contra el mercado real (Google Search, en paralelo) y lo compara contra el presupuesto del MEF para detectar sobreprecios." },
  { id: "web", label: "Perfil", sub: "de Empresa", name: "Investigador de Empresa", type: "agent", r: 32,
    sources: ["oece_perfil", "sunat", "uniperu", "google"], stores: ["sql"],
    desc: "Perfila a la empresa adjudicataria: estado y condición en SUNAT, aptitud para contratar, edad del RUC; detecta empresas de fachada." },
  { id: "news", label: "Prensa", sub: "Peruana", name: "Rastreador de Prensa", type: "agent", r: 29,
    sources: ["google"], stores: ["sql"],
    desc: "Rastrea cobertura en prensa peruana sobre la empresa, el funcionario o la obra (OjoPúblico, IDL, Convoca, La República)." },
  { id: "person", label: "Red de", sub: "Personas", name: "Mapa de Red de Personas", type: "agent", r: 34,
    sources: ["rnp", "onpe", "jne", "pep", "visitas"], stores: ["sql"],
    desc: "Mapea socios, representantes y familia; cruza aportes de campaña (ONPE), candidaturas (JNE), PEPs y la base pública de visitas a funcionarios." },
  { id: "entity", label: "Autoridades", sub: "de Entidad", name: "Identificador de Funcionarios", type: "agent", r: 29,
    sources: ["jne"], stores: ["sql"],
    desc: "Identifica a las autoridades y funcionarios vigentes de la entidad contratante a partir de las hojas de vida del JNE." },
  { id: "extended", label: "Cruces", sub: "Avanzados", name: "Cruces Avanzados", type: "agent", r: 30,
    sources: ["onpe", "infobras"], stores: ["sql"],
    desc: "Cruces avanzados: puerta giratoria (funcionario que rota y el proveedor lo sigue), aportes de campaña y sobrecostos vs INFOBRAS." },
  { id: "writer", label: "Redactor", sub: "Dictamen", name: "Redactor del Dictamen", type: "agent", r: 33,
    sources: [], stores: ["sql", "dictamen"],
    desc: "Redacta el dictamen final: cada bandera con su severidad, la norma que cita y su evidencia oficial (URL de SEACE, contrato, opinión OECE)." },
  // FUENTES
  { id: "oece_ocds", label: "OECE", sub: "OCDS", name: "OECE · Contrataciones Abiertas", type: "src", r: 20, desc: "Contrataciones Abiertas del OECE (estándar OCDS): metadata del proceso, ítems, montos y ganador." },
  { id: "oece_perfil", label: "OECE", sub: "Perfil", name: "OECE · Perfil de Proveedor", type: "src", r: 19, desc: "API de perfil de proveedor del OECE: estado, sanciones, inhabilitaciones y aptitud para contratar." },
  { id: "seace", label: "SEACE", name: "SEACE", type: "src", r: 20, desc: "SEACE: documentos del expediente — bases, acta de buena pro y contrato." },
  { id: "sunat", label: "SUNAT", name: "SUNAT", type: "src", r: 18, desc: "SUNAT: estado y condición del RUC de la empresa." },
  { id: "uniperu", label: "Univ.", sub: "Perú", name: "universidadperu.com", type: "src", r: 16, desc: "universidadperu.com: fecha de inicio de actividades y CIIU (actividad económica)." },
  { id: "rnp", label: "RNP", name: "RNP", type: "src", r: 18, desc: "RNP: socios, representantes legales y órganos de administración de la empresa." },
  { id: "onpe", label: "ONPE", name: "ONPE · Claridad", type: "src", r: 18, desc: "ONPE (Portal Claridad): aportes de campaña a los partidos." },
  { id: "jne", label: "JNE", name: "JNE", type: "src", r: 18, desc: "JNE: candidaturas y hojas de vida de autoridades." },
  { id: "pep", label: "PEPs", name: "PEPs", type: "src", r: 16, desc: "Registro de personas expuestas políticamente." },
  { id: "visitas", label: "Visitas", name: "Visitas a Funcionarios", type: "src", r: 17, desc: "Base pública de visitas a funcionarios del Estado." },
  { id: "google", label: "Google", name: "Google Search", type: "src", r: 21, desc: "Google Search: grounding en vivo para precios de mercado, prensa y perfil de empresa." },
  { id: "infobras", label: "INFO", sub: "BRAS", name: "INFOBRAS · Contraloría", type: "src", r: 18, desc: "INFOBRAS (Contraloría): avance físico y financiero de las obras." },
  { id: "mef", label: "MEF", name: "MEF · Consulta Amigable", type: "src", r: 18, desc: "MEF: presupuesto y devengado de la entidad (Consulta Amigable)." },
  // PERSISTENCIA
  { id: "sql", label: "Cloud", sub: "SQL", name: "Cloud SQL", type: "store", r: 24, desc: "Cloud SQL (PostgreSQL + PostGIS): ciclo de vida del proceso, alertas, banderas, RNP y datasets peruanos." },
  { id: "pgvec", label: "pg", sub: "vector", name: "pgvector · RAG legal", type: "store", r: 21, desc: "pgvector dentro de Cloud SQL: 721 opiniones del OECE indexadas para búsqueda semántica." },
  { id: "gcs", label: "Cloud", sub: "Storage", name: "Cloud Storage", type: "store", r: 19, desc: "Cloud Storage: documentos del expediente archivados." },
  { id: "dictamen", label: "Dictamen", name: "Dictamen final", type: "store", r: 25, desc: "Dictamen final con todas las banderas, sus normas y su evidencia oficial — listo para un periodista o fiscal." },
];
const G_EDGES: Array<{ from: string; to: string }> = [];
G_NODES.forEach((n) => {
  (n.sources || []).forEach((s) => G_EDGES.push({ from: s, to: n.id }));
  (n.stores || []).forEach((s) => G_EDGES.push({ from: n.id, to: s }));
});
AGENT_IDS.forEach((a) => G_EDGES.push({ from: "orch", to: a }));

// ── TRACE AGÉNTICO ──────────────────────────────────────────────────────────
// Deriva del stream REAL los pasos "agente → (verbo) → destino · qué hace".
// Cada `transfer` del orquestador y cada `tool_call` de un agente se vuelve un
// paso narrado. Es lo que se anima en el grafo y se escribe en la narración.


/**
 * `override`: para integraciones que no tienen el stream crudo del ADK (p. ej. la cola
 * financiada de /app/auditoria, que solo persiste fases coarse con timestamps reales) pero
 * SÍ saben con certeza qué nodo está activo y cuáles terminaron — evita adivinar por orden
 * de llegada, que con el DAG paralelo puede marcar "hecha" una fase que sigue corriendo.
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
  const [filter, setFilter] = useState<"all" | "orch" | "agent" | "src" | "store">("all");

  const findings = extractFindings(liveEvents);
  const trace = buildTrace(liveEvents);
  const curStep = trace.length ? trace[trace.length - 1] : null;
  // Estado del grafo derivado del TRACE REAL: qué agente trabaja ahora, cuáles terminaron.
  // (o, en `override`, del estado real de cada fase — ver docstring arriba).
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
  const curRef = useRef(curStep); curRef.current = curStep;
  const filterRef = useRef(filter); filterRef.current = filter;

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap) return;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const FONT = "'Syne', system-ui, sans-serif";
    let raf = 0, CW = 0, CH = 0, prevActive: string | null = null, frame = 0;
    type SN = GNode & { x: number; y: number; vx: number; vy: number };
    let sn: SN[] = [];
    let particles: Array<{ from: string; to: string; t: number; speed: number; color: string }> = [];
    const gn = (id: string) => sn.find((n) => n.id === id);
    const visible = (n: SN) => filterRef.current === "all" ? true
      : filterRef.current === "orch" ? (n.type === "orch" || n.type === "agent")
      : (n.type === filterRef.current || n.type === "orch");

    function resize() {
      CW = wrap!.clientWidth; CH = wrap!.clientHeight;
      canvas!.width = CW * dpr; canvas!.height = CH * dpr;
      canvas!.style.width = CW + "px"; canvas!.style.height = CH + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function initSim() {
      const cx = CW / 2 - 150, cy = CH / 2;
      const byType: Record<string, GNode[]> = {};
      G_NODES.forEach((n) => { (byType[n.type] = byType[n.type] || []).push(n); });
      const R = Math.min(CW, CH);
      const ringR: Record<string, number> = { orch: 0, agent: R * 0.24, store: R * 0.34, src: R * 0.46 };
      sn = G_NODES.map((n) => {
        const peers = byType[n.type]; const i = peers.indexOf(n); const total = peers.length;
        let angle = 0;
        if (n.type === "agent") angle = (i / total) * Math.PI * 2 - Math.PI / 2;
        else if (n.type === "src") angle = (i / total) * Math.PI * 2 - Math.PI / 4;
        else if (n.type === "store") angle = (i / total) * Math.PI * 2 + Math.PI / 6;
        const r = ringR[n.type] || 0; const jit = (Math.random() - 0.5) * 30;
        return { ...n, x: cx + Math.cos(angle) * r + jit, y: cy + Math.sin(angle) * r + jit, vx: 0, vy: 0 } as SN;
      });
    }
    function physics() {
      const cx = CW / 2 - 150, cy = CH / 2;
      const vis = sn.filter(visible);
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i], b = vis[j]; const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minD = (a.r + b.r) * 2.7 + 26;
        if (dist < minD) { const f = (minD - dist) / dist * 0.11; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f; }
      }
      G_EDGES.forEach((e) => {
        const a = gn(e.from), b = gn(e.to); if (!a || !b || !visible(a) || !visible(b)) return;
        const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.sqrt(dx * dx + dy * dy) || 0.01; const R = Math.min(CW, CH);
        let target = 190;
        if ((a.type === "orch" && b.type === "agent") || (a.type === "agent" && b.type === "orch")) target = R * 0.23;
        else if (a.type === "agent" && b.type === "store") target = R * 0.17;
        else if (a.type === "src" && b.type === "agent") target = R * 0.19;
        const f = (dist - target) / dist * 0.014; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      });
      vis.forEach((n) => { n.vx += (cx - n.x) * 0.0028; n.vy += (cy - n.y) * 0.0028; });
      sn.forEach((n) => {
        n.vx *= 0.78; n.vy *= 0.78; n.x += n.vx; n.y += n.vy;
        const maxX = CW - 318, pad = n.r + 18;
        if (n.x < pad) { n.x = pad; n.vx *= -0.3; } if (n.x > maxX - pad) { n.x = maxX - pad; n.vx *= -0.3; }
        if (n.y < pad + 8) { n.y = pad + 8; n.vy *= -0.3; } if (n.y > CH - pad - 44) { n.y = CH - pad - 44; n.vy *= -0.3; }
      });
    }
    function spawn(fromId: string, toId: string, color: string) {
      const a = gn(fromId), b = gn(toId); if (!a || !b) return;
      for (let k = 0; k < 2; k++) particles.push({ from: fromId, to: toId, t: k * 0.14, speed: 0.011 + Math.random() * 0.006, color });
    }
    function emitForActive() {
      const id = activeRef.current; const n = gn(id); if (!n) return;
      (n.sources || []).forEach((s) => spawn(s, id, G_COLOR.src.stroke));
      if (n.type === "agent") spawn("orch", id, G_COLOR.orch.stroke);
      (n.stores || []).forEach((s) => spawn(id, s, G_COLOR.store.stroke));
    }

    function draw() {
      ctx!.clearRect(0, 0, CW, CH);
      // grid sutil
      ctx!.save(); ctx!.strokeStyle = "rgba(70,56,30,0.04)"; ctx!.lineWidth = 1;
      for (let x = 0; x < CW; x += 36) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, CH); ctx!.stroke(); }
      for (let y = 0; y < CH; y += 36) { ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(CW, y); ctx!.stroke(); }
      ctx!.restore();

      const sel = selRef.current, active = activeRef.current, done = doneRef.current, f = findRef.current;
      let selEdges: Set<string> | null = null, selConns: Set<string> | null = null;
      if (sel) {
        selEdges = new Set(); selConns = new Set([sel]);
        G_EDGES.forEach((e) => { if (e.from === sel || e.to === sel) { selEdges!.add(e.from + ">" + e.to); selConns!.add(e.from); selConns!.add(e.to); } });
      }

      // aristas — VERDE animado cuando el nodo activo está intercambiando info
      const activeNode = gn(active);
      const exchSet = new Set<string>();
      if (activeNode) {
        (activeNode.sources || []).forEach((s) => exchSet.add(s));
        if (activeNode.type === "agent") exchSet.add("orch");
        (activeNode.stores || []).forEach((s) => exchSet.add(s));
      }
      const liveEdge = (e: { from: string; to: string }) =>
        !sel && ((e.from === active && exchSet.has(e.to)) || (e.to === active && exchSet.has(e.from)));
      const dashPhase = -(Date.now() / 38) % 1024;
      const flowPulse = 0.6 + 0.4 * Math.sin(Date.now() / 240);
      G_EDGES.forEach((e) => {
        const a = gn(e.from), b = gn(e.to); if (!a || !b || !visible(a) || !visible(b)) return;
        const isSel = selEdges && selEdges.has(e.from + ">" + e.to);
        const live = liveEdge(e);
        const dimmed = sel && !isSel;
        const ca = (G_COLOR[a.type] || G_COLOR.src).stroke, cb = (G_COLOR[b.type] || G_COLOR.src).stroke;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
        ctx!.save();
        if (live) {
          // intercambio ACTIVO: verde vivo, marching-ants + glow pulsante
          ctx!.globalAlpha = 0.5 + 0.45 * flowPulse;
          ctx!.lineWidth = 2.6;
          ctx!.strokeStyle = G_FLOW;
          ctx!.shadowColor = G_FLOW; ctx!.shadowBlur = 11;
          ctx!.setLineDash([7, 8]); ctx!.lineDashOffset = dashPhase;
        } else if (isSel) {
          ctx!.globalAlpha = 0.85; ctx!.lineWidth = 1.8;
          const g = ctx!.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca); g.addColorStop(1, cb); ctx!.strokeStyle = g;
        } else {
          // idle: gradiente tenue POR TIPO (más color que el marrón uniforme)
          ctx!.globalAlpha = dimmed ? 0.05 : 0.3;
          ctx!.lineWidth = 0.9;
          const g = ctx!.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca + "99"); g.addColorStop(1, cb + "99"); ctx!.strokeStyle = g;
          ctx!.setLineDash([3, 5]);
        }
        ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.quadraticCurveTo(mx, my, b.x, b.y); ctx!.stroke();
        if (isSel) {
          ctx!.setLineDash([]); const t = 0.87;
          const qx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, qy = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
          const ang = Math.atan2(b.y - qy, b.x - qx); const tip = b.r;
          const ax = b.x - Math.cos(ang) * tip, ay = b.y - Math.sin(ang) * tip;
          ctx!.strokeStyle = cb; ctx!.lineWidth = 1.7;
          ctx!.beginPath();
          ctx!.moveTo(ax - Math.cos(ang - 0.42) * 8, ay - Math.sin(ang - 0.42) * 8); ctx!.lineTo(ax, ay); ctx!.lineTo(ax - Math.cos(ang + 0.42) * 8, ay - Math.sin(ang + 0.42) * 8);
          ctx!.stroke();
        }
        ctx!.restore();
      });

      // partículas
      particles.forEach((p) => {
        const a = gn(p.from), b = gn(p.to); if (!a || !b || !visible(a) || !visible(b)) return;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08; const t = p.t;
        const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        ctx!.save(); ctx!.globalAlpha = 0.95 * (1 - t * 0.35); ctx!.shadowColor = p.color; ctx!.shadowBlur = 9; ctx!.fillStyle = p.color;
        ctx!.beginPath(); ctx!.arc(px, py, 3.4, 0, Math.PI * 2); ctx!.fill(); ctx!.restore();
      });

      // nodos
      sn.forEach((n) => {
        if (!visible(n)) return;
        const c = G_COLOR[n.type] || G_COLOR.src;
        const isActive = active === n.id, isDone = !isActive && done.has(n.id);
        const isSel = sel === n.id, isHov = hoverRef.current === n.id;
        const dimmed = sel && selConns && !selConns.has(n.id);
        const r = n.r + (isHov && !dimmed ? 2 : 0);
        ctx!.save(); ctx!.globalAlpha = dimmed ? 0.16 : 1;
        if (isActive || isSel) { ctx!.shadowColor = c.stroke; ctx!.shadowBlur = isSel ? 26 : 18; }
        ctx!.beginPath(); ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = isDone ? G_DONE.fill : "#fffdf7";
        ctx!.fill(); ctx!.shadowBlur = 0;
        ctx!.strokeStyle = isDone ? G_DONE.stroke : (isActive || isSel) ? c.stroke : c.stroke + "66";
        ctx!.lineWidth = (isActive || isSel) ? 2.4 : 1.2; ctx!.stroke();
        // spinner activo
        if (isActive && !isDone) {
          const ang = (Date.now() / 520) % (Math.PI * 2);
          ctx!.beginPath(); ctx!.arc(n.x, n.y, r + 6, ang, ang + Math.PI * 1.3); ctx!.strokeStyle = c.stroke; ctx!.lineWidth = 2.6; ctx!.stroke();
        }
        // etiqueta
        const baseSub = n.sub;
        let sub = baseSub;
        if (n.id === "web" && f.empresa) sub = String(f.empresa).split(" ").slice(0, 2).join(" ");
        else if (n.id === "sunat" && f.estado) sub = String(f.estado).toLowerCase();
        else if (n.id === "person" && f.socios.length) sub = `${f.socios.length} socios`;
        else if (n.id === "sql" && f.senales.length) sub = `${f.senales.length} señales`;
        const lines = [n.label]; if (sub) lines.push(sub);
        const fs = n.type === "orch" ? 13 : n.r > 30 ? 12 : n.r > 22 ? 11 : n.r > 17 ? 10 : 9;
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
        ctx!.fillStyle = dimmed ? "#bcb3a0" : isDone ? G_DONE.text : (isActive || isSel) ? c.stroke : "#3a3324";
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
      sn.forEach((n) => { if (visible(n) && Math.hypot(mx - n.x, my - n.y) < n.r + 8) hit = n; });
      return hit;
    }
    const onMove = (ev: MouseEvent) => { const h = pick(ev); hoverRef.current = h ? h.id : null; canvas.style.cursor = h ? "pointer" : "default"; };
    const onClick = (ev: MouseEvent) => { const h = pick(ev); const id = h && h.id === selRef.current ? null : (h ? h.id : null); selRef.current = id; setSelected(id); };

    resize(); initSim(); emitForActive();
    raf = requestAnimationFrame(loop);
    const onResize = () => { resize(); initSim(); };
    window.addEventListener("resize", onResize);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); canvas.removeEventListener("mousemove", onMove); canvas.removeEventListener("click", onClick); };
  }, []);

  const fmtRegla = (r: string) => r.replace(/_/g, " ");
  const nm = (id: string) => G_NODES.find((n) => n.id === id)?.name || id;
  const stroke = (id: string) => (G_COLOR[G_NODES.find((n) => n.id === id)?.type || "src"] || G_COLOR.src).stroke;
  const selNode = selected ? G_NODES.find((n) => n.id === selected) : null;
  const conns = selNode ? [...(selNode.sources || []), ...(selNode.stores || [])].map(nm) : [];
  const recent = trace.slice(-6).reverse();
  const FILTERS: Array<{ k: typeof filter; label: string }> = [
    { k: "all", label: "Todo" }, { k: "orch", label: "Núcleo" }, { k: "agent", label: "Agentes" }, { k: "src", label: "Fuentes" }, { k: "store", label: "Datos" },
  ];

  return (
    <div ref={wrapRef} className="relative h-[560px] w-full overflow-hidden rounded-2xl border border-line sm:h-[640px]"
      style={{ background: "radial-gradient(900px 500px at 78% -10%, #fbf7ee, transparent), radial-gradient(800px 500px at 10% 110%, #efe6d4, transparent), #f3ede1" }}>
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {/* filtros */}
      <div className="absolute left-3 top-3 z-10 flex gap-1.5">
        {FILTERS.map((ff) => (
          <button key={ff.k} onClick={() => { setFilter(ff.k); setSelected(null); selRef.current = null; }}
            className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] backdrop-blur transition-colors ${filter === ff.k ? "border-line2 bg-paperSoft font-semibold text-ink" : "border-line bg-paperSoft/70 text-mute hover:text-ink"}`}>
            {ff.label}
          </button>
        ))}
      </div>

      {/* PANEL LATERAL DE DESCUBRIMIENTO */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex max-h-[calc(100%-90px)] w-[286px] flex-col gap-2.5 overflow-y-auto">
        {/* Descubrimiento */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-mute">Descubrimiento</div>
          {selNode ? (
            <>
              <div className="font-serif text-[17px] font-bold leading-tight" style={{ color: stroke(selNode.id) }}>{selNode.name}</div>
              <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider"
                style={{ background: stroke(selNode.id) + "1f", color: stroke(selNode.id), border: `1px solid ${stroke(selNode.id)}55` }}>{TYPE_LABEL[selNode.type]}</span>
              <p className="mt-2 text-[12px] leading-relaxed text-ink/75">{selNode.desc}</p>
              {conns.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {conns.map((c, i) => <span key={i} className="rounded-md border border-line bg-paperDeep/60 px-2 py-0.5 font-mono text-[9px] text-mute">{c}</span>)}
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-dim">Haz clic en un nodo para ver qué es, qué hace y con qué se conecta.</p>
          )}
        </div>

        {/* Hallazgos en vivo (necesita el trace fino del ADK: no disponible en `override`) */}
        {!override && (
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-clay">Hallazgos en vivo</div>
          {(findings.empresa || findings.entidad || findings.socios.length > 0 || findings.senales.length > 0) ? (
            <div className="flex flex-col gap-2 text-[12px]">
              {findings.entidad && <div><span className="font-mono text-[9px] uppercase tracking-wide text-mute">entidad</span> <span className="font-semibold text-ink">{findings.entidad}</span></div>}
              {findings.empresa && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-mute">empresa</span>
                  <span className="font-semibold text-ink">{findings.empresa}</span>
                  {findings.ruc && <span className="rounded-full border border-line bg-paperDeep/60 px-2 py-0.5 font-mono text-[9px] text-mute">RUC {findings.ruc}</span>}
                  {findings.estado && <span className="rounded-full bg-moss/10 px-2 py-0.5 text-[9px] font-bold text-moss">{findings.estado}</span>}
                  {findings.apto === false && <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-[9px] font-bold text-rust">NO APTO</span>}
                  {typeof findings.n_sanciones === "number" && findings.n_sanciones > 0 && <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-[9px] font-bold text-rust">{findings.n_sanciones} sanciones</span>}
                </div>
              )}
              {findings.socios.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-mute">socios</span>
                  {findings.socios.slice(0, 6).map((s: string, i: number) => <span key={i} className="rounded-md border border-line bg-paperDeep/60 px-2 py-0.5 text-[11px] text-ink">{s}</span>)}
                </div>
              )}
              {findings.senales.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-mute">señales</span>
                  {findings.senales.slice(0, 6).map((s: string, i: number) => <span key={i} className="rounded-full bg-crimson-soft px-2 py-0.5 text-[10px] font-bold text-rust">{fmtRegla(s)}</span>)}
                </div>
              )}
            </div>
          ) : <p className="text-[12px] text-dim">Aún sin hallazgos…</p>}
        </div>
        )}

        {/* Traza de invocaciones (compacta: verbo + acción) — ídem, requiere el trace fino */}
        {!override && (
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-mute">Traza · últimos pasos</div>
          {recent.length ? (
            <div className="flex flex-col gap-1">
              {recent.slice(-6).map((s, i) => (
                <div key={i} className="flex items-baseline gap-1.5 text-[10px] leading-snug text-mute">
                  <span className="shrink-0 font-mono font-bold" style={{ color: VERB_HEX[s.v] }}>{s.v}</span>
                  <span className="truncate">{s.m}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-dim">Esperando el primer paso…</p>}
        </div>
        )}

        {/* Leyenda */}
        <div className="pointer-events-auto rounded-2xl border border-line bg-paperSoft/95 p-3.5 shadow-lg backdrop-blur">
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-mute">Leyenda</div>
          <div className="flex flex-col gap-1.5 text-[12px] text-mute">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.orch.stroke }} />Orquestador (núcleo)</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.agent.stroke }} />Agente especializado</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.src.stroke }} />Fuente de datos</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: G_COLOR.store.stroke }} />Persistencia</div>
          </div>
        </div>
      </div>

      {/* BARRA DE NARRACIÓN (paso actual) */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-320px)] items-center gap-3 rounded-full border border-line bg-paperSoft/95 px-5 py-2.5 shadow-lg backdrop-blur">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: curStep ? VERB_HEX[curStep.v] : stroke(activeId) }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: curStep ? VERB_HEX[curStep.v] : stroke(activeId) }} />
        </span>
        {override?.narracion ? (
          <span className="truncate font-serif text-[14px] font-semibold text-ink">
            <span style={{ color: stroke(activeId) }}>{nm(activeId)}</span> · {override.narracion}
          </span>
        ) : curStep ? (
          <span className="truncate font-serif text-[14px] font-semibold text-ink">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: VERB_HEX[curStep.v] }}>{curStep.v}</span>
            {" "}<span style={{ color: stroke(curStep.f) }}>{nm(curStep.f)}</span> {curStep.m}
          </span>
        ) : (
          <span className="font-serif text-[14px] font-semibold text-ink">Orquestador · armando el plan y despachando a los agentes…</span>
        )}
      </div>
    </div>
  );
}
