"use client";

import { Severidad } from "@/components/ui/Severidad";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Network, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import type { GraphNode, GraphEdge } from "../types";
import { wrapText } from "../utils";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { buildRelationshipGraphData } from "./RelationshipGraph.layout";

export function RelationshipGraph({
  person,
  web,
  proveedor,
  ctx,
}: { person: any; web: any; proveedor: any; ctx?: any }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Posiciones override por drag — { [nodeId]: {x,y} }; vacío usa layout polar
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({});
  // ViewBox state — para zoom y pan del SVG (no de nodos individuales)
  // Default amplio (1440×940 sobre canvas base 920×600) para que entren todos
  // los clusters (entidad + postores rivales + visitas) sin necesidad de pan.
  const [viewBox, setViewBox] = useState({ x: -260, y: -170, w: 1440, h: 940 });
  const draggedRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ mx: number; my: number; nx: number; ny: number } | null>(null);
  const wasDraggedRef = useRef(false);
  // Pan refs: cuando el user arrastra el FONDO (no un nodo)
  const panningRef = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const graphData = buildRelationshipGraphData(person, web, proveedor, ctx);
  // El `return null` va DESPUÉS de los hooks: cortarlo acá arriba cambiaba la
  // cantidad de hooks entre renders cuando el grafo pasaba de vacío a lleno.
  const nodes: GraphNode[] = graphData?.nodes ?? [];
  const edges: GraphEdge[] = graphData?.edges ?? [];
  const positions = graphData?.positions ?? new Map<string, { x: number; y: number }>();
  // Aplicar overrides por drag (el user arrastró esos nodos) — el viewBox base
  // es 920×600 pero al haber zoom + pan, los nodos pueden ir más allá; no
  // clampeamos, el user puede arrastrar el grafo con pan.
  Object.entries(posOverride).forEach(([id, p]) => {
    if (positions.has(id)) positions.set(id, p);
  });

  // Estilos por tipo
  const styleNode = (kind: GraphNode["kind"]) => {
    switch (kind) {
      case "person":              return { fill: "#843022", stroke: "#843022", text: "#FFFFFF", r: 38 };
      case "pareja":              return { fill: "#FBF3F5", stroke: "#8E2A45", text: "#4A1020", r: 24 };
      case "company_main":        return { fill: "#FFFFFF", stroke: "#B7462A", text: "#1E191B", r: 30 };
      case "company_titular":     return { fill: "#FDF3DC", stroke: "#BE7B26", text: "#8A5A15", r: 24 };
      case "company_domicilio":   return { fill: "#FBE3DF", stroke: "#A81E12", text: "#8F2318", r: 22 };
      case "party":               return { fill: "#FBE3DF", stroke: "#8F2318", text: "#8F2318", r: 22 };
      case "cargo_pasado":        return { fill: "#F8F5F3", stroke: "#6B6166", text: "#1E191B", r: 20 };
      case "autoridad":           return { fill: "#FDF3DC", stroke: "#C47F3E", text: "#95612C", r: 22 };
      case "firmante_conflicto":  return { fill: "#FBE3DF", stroke: "#A81E12", text: "#8F2318", r: 22 };
      case "contract":            return { fill: "#FDF3DC", stroke: "#95612C", text: "#95612C", r: 18 };
      // Nuevos: cluster entidad contratante
      case "entidad":             return { fill: "#2D3E6F", stroke: "#2D3E6F", text: "#FFFFFF",    r: 34 };
      case "alcalde":             return { fill: "#E4E9F4", stroke: "#2D3E6F", text: "#2D3E6F", r: 26 };
      case "funcionario_designado":return { fill: "#EEF1F8", stroke: "#4360B0", text: "#2D3E6F", r: 22 };
      // Cargo público de un familiar → municipio donde trabaja
      case "municipio_familiar":  return { fill: "#F6E4E8", stroke: "#711C30", text: "#4A1020", r: 24 };
      // Partido político derivado (del municipio del familiar)
      case "partido_compartido":  return { fill: "#FBE3DF", stroke: "#8F2318", text: "#8F2318", r: 20 };
      // Postor rival (no ganador)
      case "postor_rival":        return { fill: "#FDF3DC", stroke: "#843022", text: "#843022", r: 24 };
      // Socio del postor rival que es funcionario público — bandera ALTA
      case "socio_postor_conflicto": return { fill: "#FBE3DF", stroke: "#A81E12", text: "#8F2318", r: 26 };
      // Entidad secundaria por doble vinculación de un funcionario
      case "entidad_secundaria":  return { fill: "#EEF4EE", stroke: "#3E7B4F", text: "#2F6B36", r: 22 };
    }
  };
  const styleEdge = (kind: GraphEdge["kind"]) => {
    switch (kind) {
      case "titular":              return { color: "#BE7B26", width: 2,   dash: "" };
      case "domicilio":            return { color: "#A81E12", width: 2,   dash: "4 4" };
      case "candidato":            return { color: "#8F2318", width: 1.5, dash: "6 3" };
      case "aporte":               return { color: "#A81E12", width: 2,   dash: "" };
      case "cargo":                return { color: "#6B6166", width: 1.5, dash: "2 3" };
      case "contrato":             return { color: "#95612C", width: 1.2, dash: "" };
      case "pareja":               return { color: "#8E2A45", width: 2.5, dash: "" };
      case "autoridad":            return { color: "#C47F3E", width: 2,   dash: "5 2" };
      case "firma_conflicto":      return { color: "#A81E12", width: 3,   dash: "" };
      // Nuevos
      case "adjudicacion":         return { color: "#2D3E6F", width: 3,   dash: "" };
      case "preside_entidad":      return { color: "#2D3E6F", width: 2,   dash: "" };
      case "designado_por":        return { color: "#4360B0", width: 1.5, dash: "3 3" };
      case "conflicto_funcionario":return { color: "#A81E12", width: 3,   dash: "" };
      // Familiar trabaja en municipio
      case "trabaja_en":           return { color: "#711C30", width: 1.5, dash: "" };
      // Partido del municipio (cuando NO coincide con el contratante)
      case "partido_de":           return { color: "#8F2318", width: 1.2, dash: "4 4" };
      // ⚠ MISMO PARTIDO que el municipio que contrata — alerta cruzada
      case "mismo_partido_que":    return { color: "#A81E12", width: 3.5, dash: "2 4" };
      // Postor rival compitió por el contrato
      case "compitio":             return { color: "#843022", width: 1.2, dash: "5 3" };
      // Socio de postor rival
      case "socio_de":             return { color: "#843022", width: 1.5, dash: "" };
      // Funcionario visitó otra entidad
      case "visito":               return { color: "#3E7B4F", width: 1.2, dash: "3 3" };
      // Doble vinculación inter-municipal
      case "doble_vinculacion":    return { color: "#3E7B4F", width: 2,   dash: "5 2" };
    }
  };

  // ─── Convertir coord de mouse a SVG ───
  const mouseToSvg = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const handleNodeMouseDown = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const pos = positions.get(id);
    if (!pos) return;
    draggedRef.current = id;
    dragStartRef.current = { mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y };
    wasDraggedRef.current = false;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Si se está arrastrando un nodo
      if (draggedRef.current && dragStartRef.current) {
        const start = dragStartRef.current;
        const moved = Math.hypot(e.clientX - start.mx, e.clientY - start.my);
        if (moved > 4) wasDraggedRef.current = true;
        const startSvg = mouseToSvg(start.mx, start.my);
        const nowSvg = mouseToSvg(e.clientX, e.clientY);
        if (!startSvg || !nowSvg) return;
        const dx = nowSvg.x - startSvg.x;
        const dy = nowSvg.y - startSvg.y;
        const newPos = { x: start.nx + dx, y: start.ny + dy };
        setPosOverride(prev => ({ ...prev, [draggedRef.current!]: newPos }));
        return;
      }
      // Si se está paneando el fondo
      if (panningRef.current) {
        const start = panningRef.current;
        // Movimiento del mouse en px → traducir a unidades SVG según escala actual
        const scaleX = viewBox.w / (svgRef.current?.clientWidth || viewBox.w);
        const scaleY = viewBox.h / (svgRef.current?.clientHeight || viewBox.h);
        const dx = (e.clientX - start.mx) * scaleX;
        const dy = (e.clientY - start.my) * scaleY;
        setViewBox(v => ({ ...v, x: start.vx - dx, y: start.vy - dy }));
      }
    };
    const onUp = () => {
      draggedRef.current = null;
      dragStartRef.current = null;
      panningRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [viewBox.w, viewBox.h]);

  // Pan: drag del fondo del SVG (no de un nodo)
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    panningRef.current = {
      mx: e.clientX, my: e.clientY,
      vx: viewBox.x, vy: viewBox.y,
    };
  };

  // Zoom con wheel: factor depende del scroll, centrado en el cursor
  // Base = 1440 (viewBox default amplio) → "100%" en el indicador
  const VBASE_W = 1440;
  const VBASE_H = 940;
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const minW = VBASE_W * 0.25, maxW = VBASE_W * 3;
    const newW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
    const newH = newW * (VBASE_H / VBASE_W);
    const svgPt = mouseToSvg(e.clientX, e.clientY);
    if (!svgPt) return;
    const dx = (svgPt.x - viewBox.x) * (newW / viewBox.w - 1);
    const dy = (svgPt.y - viewBox.y) * (newH / viewBox.h - 1);
    setViewBox({ x: viewBox.x - dx, y: viewBox.y - dy, w: newW, h: newH });
  };

  const handleZoom = (factor: number) => {
    const minW = VBASE_W * 0.25, maxW = VBASE_W * 3;
    const newW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
    const newH = newW * (VBASE_H / VBASE_W);
    const cxv = viewBox.x + viewBox.w / 2;
    const cyv = viewBox.y + viewBox.h / 2;
    setViewBox({ x: cxv - newW / 2, y: cyv - newH / 2, w: newW, h: newH });
  };

  const resetViewBox = () => setViewBox({ x: -260, y: -170, w: 1440, h: 940 });

  const handleNodeClick = (id: string) => () => {
    // Si el user arrastró el nodo, no abrir panel de detalle
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    setSelectedId(prev => prev === id ? null : id);
  };

  // Reset de overrides cuando cambia la data subyacente
  const dataSignature = `${nodes.length}-${edges.length}`;
  useEffect(() => {
    setPosOverride({});
  }, [dataSignature]);

  // Panel resumen: contar nodos por tipo y banderas red
  const nodesByKind = nodes.reduce((acc: Record<string, number>, n) => {
    acc[n.kind] = (acc[n.kind] || 0) + 1;
    return acc;
  }, {});
  const edgesByKind = edges.reduce((acc: Record<string, number>, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, {});
  const banderasRed: any[] = Array.isArray(person?.banderas_red) ? person.banderas_red : [];
  const banderasAlta = banderasRed.filter((b) => b.severidad === "alta");
  const banderasMedia = banderasRed.filter((b) => b.severidad === "media");

  const summaryCards = [
    {
      key: "personas",
      label: "Personas mapeadas",
      count: (nodesByKind.person || 0) + (nodesByKind.pareja || 0) + (nodesByKind.autoridad || 0)
           + (nodesByKind.alcalde || 0) + (nodesByKind.funcionario_designado || 0),
      hint: "proveedor + autoridades + designados",
      color: "",
    },
    {
      key: "empresas",
      label: "Empresas vinculadas",
      count: (nodesByKind.company_main || 0) + (nodesByKind.company_titular || 0) + (nodesByKind.company_domicilio || 0),
      hint: "con mismo titular o domicilio",
      color: "",
    },
    {
      key: "vinculos",
      label: "Vínculos detectados",
      count: edges.length,
      hint: edgesByKind.titular ? `${edgesByKind.titular} de titularidad` : "relaciones formales",
      color: "",
    },
    {
      key: "banderas_red",
      label: "Señales en la red",
      count: banderasRed.length,
      hint: banderasAlta.length > 0
        ? `${banderasAlta.length} alta${banderasAlta.length === 1 ? "" : "s"}, ${banderasMedia.length} media${banderasMedia.length === 1 ? "" : "s"}`
        : banderasRed.length > 0 ? "ninguna alta" : "ninguna en la red",
      color: "",
    },
  ];

  if (!graphData) return null;

  return (
    <div className="border-t border-line bg-paperSoft px-5 py-5">
      {/* PANEL RESUMEN — primero, antes del grafo */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaryCards.map((c) => (
          <div key={c.key} className={cn("rounded-xl border border-line bg-paper px-3 py-2", c.color)}>
            <div className="font-mono text-xl font-semibold leading-none tabular-nums text-ink">{c.count}</div>
            <div className="mt-1 text-[12px] font-medium text-ink">{c.label}</div>
            <div className="mt-0.5 text-[11px] text-mute">{c.hint}</div>
          </div>
        ))}
      </div>

      {/* HALLAZGOS DE RED — bullets clave */}
      {banderasRed.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-paper px-3 py-2.5">
          <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Lo que más pesa en la red empresarial</h3>
          <ul className="space-y-1">
            {banderasRed.slice(0, 6).map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className="mt-0.5 shrink-0">
                  {b.severidad === "alta" || b.severidad === "media" || b.severidad === "baja" ? (
                    <Severidad bandera={b.severidad} formato="punto" />
                  ) : (
                    <span className="text-[11px] text-mute">info</span>
                  )}
                </span>
                <div>
                  <span className="font-semibold text-ink">{redactDnis(String(b.titulo || b.tipo || "Hallazgo"))}</span>
                  {b.requiere_verificacion && (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-paperDeep px-2 py-0 text-[11px] font-medium text-inkSoft">requiere verificación</span>
                  )}
                  {b.descripcion && (
                    <div className="text-inkSoft">{redactDnis(String(b.descripcion).slice(0, 220))}{String(b.descripcion).length > 220 ? "…" : ""}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">
            <Network size={13} className="mr-1 inline text-mute" aria-hidden />
            Grafo de relaciones
          </h3>
          <p className="text-[12px] text-mute">Arrastra los nodos para reorganizarlos.</p>
        </div>
        {Object.keys(posOverride).length > 0 && (
          <button
            type="button"
            onClick={() => setPosOverride({})}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-semibold text-ink hover:bg-paperDeep"
          >
            <RotateCcw size={12} aria-hidden /> Volver al orden automático
          </button>
        )}
        <div className="flex flex-wrap gap-2 text-[9px] text-mute">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#BE7B26" }} />
            titular
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#A81E12", backgroundImage: "repeating-linear-gradient(90deg,#A81E12 0 2px,transparent 2px 4px)" }} />
            mismo domicilio
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#A81E12" }} />
            aporte ONPE
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#6B6166", backgroundImage: "repeating-linear-gradient(90deg,#6B6166 0 1px,transparent 1px 3px)" }} />
            cargo público
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#95612C" }} />
            contrato
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#8E2A45" }} />
            pareja / familia
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#C47F3E", backgroundImage: "repeating-linear-gradient(90deg,#C47F3E 0 3px,transparent 3px 5px)" }} />
            autoridad pública
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#A81E12", height: 4 }} />
            firmante en conflicto
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-line bg-paper">
        {/* Controles de zoom flotantes */}
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-lg border border-line bg-paper/95 p-1 shadow-card backdrop-blur-sm">
          <button
            type="button"
            onClick={() => handleZoom(0.85)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Acercar"
            aria-label="Acercar el grafo"
          >
            <span className="text-base font-bold leading-none">+</span>
          </button>
          <button
            type="button"
            onClick={() => handleZoom(1.18)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Alejar"
            aria-label="Alejar el grafo"
          >
            <span className="text-base font-bold leading-none">−</span>
          </button>
          <button
            type="button"
            onClick={resetViewBox}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Volver al zoom inicial"
            aria-label="Volver al zoom inicial"
          >
            <RotateCcw size={12} />
          </button>
          <div className="text-center text-[8px] font-mono text-mute">
            {Math.round(1440 / viewBox.w * 100)}%
          </div>
        </div>

        {/* Hint sutil */}
        <div className="absolute left-2 top-2 z-10 rounded-md bg-paperDeep/80 px-2 py-0.5 text-[9px] text-mute backdrop-blur-sm">
          Rueda para acercar. Arrastra el fondo para moverte. Clic en un nodo para ver el detalle.
        </div>

        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="block h-[600px] w-full select-none"
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: panningRef.current ? "grabbing" : "default" }}
          onWheel={handleWheel}
          onMouseDown={handleBackgroundMouseDown}
        >
          {/* Fondo invisible para capturar pan en zonas sin nodos */}
          <rect
            x={viewBox.x - 1000} y={viewBox.y - 1000}
            width={viewBox.w + 2000} height={viewBox.h + 2000}
            fill="transparent"
          />

          {/* Aristas */}
          {edges.map((e, i) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const st = styleEdge(e.kind);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            return (
              <g key={`e_${i}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={st.color} strokeWidth={st.width} strokeDasharray={st.dash}
                      opacity={0.7} />
                {e.label && (
                  <text x={mx} y={my - 4} fontSize="9" fill={st.color}
                        textAnchor="middle" style={{ paintOrder: "stroke", stroke: "#FFFFFF", strokeWidth: 3 }}>
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodos */}
          {nodes.map((n) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const s = styleNode(n.kind);
            const isSelected = selectedId === n.id;
            // Wrap inteligente: dividir el label en líneas de ~16 chars
            const lines = wrapText(n.label, 16, 3);
            const longestLine = lines.reduce((m, l) => Math.max(m, l.length), 0);
            // Ancho del rect = max línea × ancho promedio de char + padding
            const wRect = Math.max(80, Math.min(220, longestLine * 6.2 + 16));
            // Alto del rect = base + extra por cada línea adicional
            const baseH = n.sublabel ? 22 : 14;
            const lineH = 12;
            const hRect = baseH + lines.length * lineH;

            if (n.kind === "person") {
              const initials = (n.label || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
              return (
                <g key={n.id} onClick={handleNodeClick(n.id)} onMouseDown={handleNodeMouseDown(n.id)} style={{ cursor: "grab" }}>
                  <title>{`${n.tooltip || n.label}\nArrastra para mover, clic para ver el detalle`}</title>
                  {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={s.r + 6} fill="none" stroke={s.stroke} strokeWidth={2} opacity={0.4}>
                      <animate attributeName="r" values={`${s.r + 6};${s.r + 10};${s.r + 6}`} dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={pos.x} cy={pos.y} r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={isSelected ? 3 : 2} />
                  <text x={pos.x} y={pos.y + 5} fontSize="20" fontWeight="700" fill={s.text} textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {initials || "?"}
                  </text>
                  {/* Label multilinea */}
                  <text x={pos.x} y={pos.y + s.r + 13} fontSize="11" fontWeight="700" fill="#1E191B" textAnchor="middle"
                        style={{ paintOrder: "stroke", stroke: "#FFFFFF", strokeWidth: 3, pointerEvents: "none" }}>
                    {lines.map((l, idx) => (
                      <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : 13}>{l}</tspan>
                    ))}
                  </text>
                  {n.sublabel && (
                    <text x={pos.x} y={pos.y + s.r + 13 + lines.length * 13 + 2} fontSize="9" fill="#6B6166" textAnchor="middle"
                          style={{ paintOrder: "stroke", stroke: "#FFFFFF", strokeWidth: 3, pointerEvents: "none" }}>
                      {n.sublabel}
                    </text>
                  )}
                </g>
              );
            }
            return (
              <g key={n.id} onClick={handleNodeClick(n.id)} onMouseDown={handleNodeMouseDown(n.id)} style={{ cursor: "grab" }}>
                <title>{`${n.tooltip || n.label}\nArrastra para mover, clic para ver el detalle`}</title>
                {isSelected && (
                  <rect x={pos.x - wRect / 2 - 4} y={pos.y - hRect / 2 - 4} width={wRect + 8} height={hRect + 8} rx={10}
                        fill="none" stroke={s.stroke} strokeWidth={2} opacity={0.5}>
                    <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite" />
                  </rect>
                )}
                <rect x={pos.x - wRect / 2} y={pos.y - hRect / 2} width={wRect} height={hRect} rx={8}
                      fill={s.fill} stroke={s.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                {/* Texto principal con wrap multilinea */}
                <text
                  x={pos.x}
                  y={pos.y - hRect / 2 + 12}
                  fontSize="10"
                  fontWeight="700"
                  fill={s.text}
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {lines.map((l, idx) => (
                    <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : 11}>{l}</tspan>
                  ))}
                </text>
                {n.sublabel && (
                  <text
                    x={pos.x}
                    y={pos.y - hRect / 2 + 12 + lines.length * 11 + 4}
                    fontSize="8.5"
                    fill={s.text}
                    opacity={0.75}
                    textAnchor="middle"
                    style={{ pointerEvents: "none" }}
                  >
                    {n.sublabel.length > 28 ? n.sublabel.slice(0, 26) + "…" : n.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Panel de detalle del nodo seleccionado */}
      {selectedId && (() => {
        const node = nodes.find(n => n.id === selectedId);
        if (!node) return null;
        return (
          <NodeDetailPanel
            node={node}
            onClose={() => setSelectedId(null)}
            onVigiaSearch={(ruc) => router.push(`/app/convocatoria?q=${encodeURIComponent(ruc)}`)}
          />
        );
      })()}

    </div>
  );
}
