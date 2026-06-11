"use client";

import { useMemo, useState } from "react";
import { ExternalLink, X, MousePointerClick, Lock } from "lucide-react";
import {
  FLAG_META,
  type EmpresaNetwork,
  type NodoTipo,
  type ConexionTipo,
  type Capa,
  type Nivel,
  type NodeInfo,
  type Conexion,
} from "@/lib/mock-network";
import { cn } from "@/lib/utils";

// ─── Layout constants ────────────────────────────────────
const W = 1200;
const H = 760;

const COL_X: Record<Exclude<Capa, "externo">, number> = {
  compradora: 210,
  aprueban: 600,
  proveedor: 990,
};

const ROW_Y: Record<Nivel, number> = {
  institucion: 130,
  cabeza: 300,
  miembro: 480,
};

const EXT_Y = 650;

// Sizes
const INST_W = 270, INST_H = 100;
const PERS_W = 230, PERS_H = 92;
const SOC_W = 158, SOC_H = 118;
const EXT_W = 230, EXT_H = 92;
const EMPRESA_W = 295;
const EMPRESA_H = 104;

const PAD = 10;
const HEADER_H = 32;
const NAME_LINE_H = 15;
const FOOTER_H = 30;

interface NodeBox {
  id: string;
  tipo: NodoTipo;
  nombre: string;
  detalle?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capa: Capa;
  nivel?: Nivel;
  info?: NodeInfo;
}

const TIPO_STYLE: Record<
  NodoTipo,
  {
    fill: string;
    stroke: string;
    text: string;
    sub: string;
    icon: string;
    chipBg: string;
    divider: string;
    capaLabel: string;
    onDark: boolean;
  }
> = {
  empresa: { fill: "#1B1611", stroke: "#000", text: "#F4EEDD", sub: "#A89887", icon: "🏢", chipBg: "rgba(244,238,221,0.13)", divider: "rgba(244,238,221,0.18)", capaLabel: "EMPRESA", onDark: true },
  persona: { fill: "#F4EEDD", stroke: "#BFB29B", text: "#1B1611", sub: "#76695A", icon: "👤", chipBg: "rgba(27,22,17,0.06)", divider: "rgba(27,22,17,0.10)", capaLabel: "PERSONA", onDark: false },
  entidad_publica: { fill: "#E8DFC7", stroke: "#76695A", text: "#1B1611", sub: "#76695A", icon: "🏛", chipBg: "rgba(27,22,17,0.08)", divider: "rgba(27,22,17,0.10)", capaLabel: "INSTITUCIÓN", onDark: false },
  comite: { fill: "#F2E0B8", stroke: "#B5752C", text: "#1B1611", sub: "#76695A", icon: "📋", chipBg: "rgba(160,81,45,0.13)", divider: "rgba(160,81,45,0.18)", capaLabel: "COMITÉ", onDark: false },
  funcionario: { fill: "#FAF6E9", stroke: "#A0512D", text: "#1B1611", sub: "#76695A", icon: "🕴", chipBg: "rgba(160,81,45,0.10)", divider: "rgba(160,81,45,0.15)", capaLabel: "FUNCIONARIO", onDark: false },
  partido_politico: { fill: "#FEE2E2", stroke: "#8B2A1E", text: "#1B1611", sub: "#76695A", icon: "🚩", chipBg: "rgba(139,42,30,0.10)", divider: "rgba(139,42,30,0.20)", capaLabel: "PARTIDO", onDark: false },
  organo_sancionador: { fill: "#1F2A44", stroke: "#0B1220", text: "#F4EEDD", sub: "#94A3B8", icon: "⚖", chipBg: "rgba(244,238,221,0.10)", divider: "rgba(244,238,221,0.15)", capaLabel: "ÓRGANO DE CONTROL", onDark: true },
};

const CONEXION_STYLE: Record<
  ConexionTipo,
  { stroke: string; dash?: string; width: number; arrow: "rust" | "mute"; label: string }
> = {
  adjudico: { stroke: "#8B2A1E", width: 2.6, arrow: "rust", label: "adjudicó" },
  aprobo: { stroke: "#A0512D", width: 2, arrow: "rust", label: "aprobó" },
  convoca: { stroke: "#76695A", width: 1.6, arrow: "mute", label: "convoca" },
  preside: { stroke: "#76695A", width: 1.4, arrow: "mute", label: "preside" },
  representa: { stroke: "#BFB29B", width: 1.2, arrow: "mute", label: "representa" },
  pertenece: { stroke: "#76695A", width: 1.4, dash: "3 3", arrow: "mute", label: "pertenece" },
  aporte: { stroke: "#8B2A1E", width: 2, dash: "6 3", arrow: "rust", label: "aportó" },
  familiar: { stroke: "#8B2A1E", width: 2, dash: "6 3", arrow: "rust", label: "familiar" },
  sanciono: { stroke: "#8B2A1E", width: 1.6, arrow: "rust", label: "sancionó" },
  denuncio: { stroke: "#B5752C", width: 1.4, dash: "3 3", arrow: "mute", label: "denunció" },
};

const COLUSION_TYPES = new Set<ConexionTipo>(["familiar", "aporte"]);

// ─── Component ───────────────────────────────────────────

export function GrafoConexiones({ data }: { data: EmpresaNetwork }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [stickyId, setStickyId] = useState<string | null>(null);
  const focusId = stickyId ?? hoverId;

  const { allNodes, edges, colusionCount } = useMemo(() => {
    const externos = data.entidadesRelacionadas ?? [];
    const nodes: NodeBox[] = [];

    const compInst = externos.find((e) => e.capa === "compradora" && e.nivel === "institucion");
    if (compInst) {
      nodes.push({ ...compInst, capa: "compradora", x: COL_X.compradora, y: ROW_Y.institucion, w: INST_W, h: INST_H });
    }
    externos
      .filter((e) => e.capa === "compradora" && e.nivel === "cabeza")
      .forEach((c, i) => {
        nodes.push({ ...c, capa: "compradora", x: COL_X.compradora, y: ROW_Y.cabeza + i * (PERS_H + 18), w: PERS_W, h: PERS_H });
      });

    const aprInst = externos.find((e) => e.capa === "aprueban" && e.nivel === "institucion");
    if (aprInst) {
      nodes.push({ ...aprInst, capa: "aprueban", x: COL_X.aprueban, y: ROW_Y.institucion, w: INST_W, h: INST_H });
    }
    externos
      .filter((e) => e.capa === "aprueban" && e.nivel === "cabeza")
      .forEach((c, i) => {
        nodes.push({ ...c, capa: "aprueban", x: COL_X.aprueban, y: ROW_Y.cabeza + i * (PERS_H + 18), w: PERS_W, h: PERS_H });
      });

    nodes.push({
      id: "empresa",
      tipo: "empresa",
      capa: "proveedor",
      nivel: "institucion",
      nombre: data.razonSocial,
      detalle: `RUC ${data.ruc}`,
      x: COL_X.proveedor,
      y: ROW_Y.institucion,
      w: EMPRESA_W,
      h: EMPRESA_H,
    });

    const socios = data.socios;
    socios.forEach((s, i) => {
      const cols = socios.length;
      const cw = SOC_W + 10;
      const totalW = cols * cw - 10;
      const startX = COL_X.proveedor - totalW / 2 + SOC_W / 2;
      nodes.push({
        id: s.dni,
        tipo: "persona",
        capa: "proveedor",
        nivel: "miembro",
        nombre: s.nombre,
        detalle: s.rol,
        x: startX + i * cw,
        y: ROW_Y.miembro,
        w: SOC_W,
        h: SOC_H,
        info: s.info,
      });
    });

    const extNodes = externos.filter((e) => e.capa === "externo");
    extNodes.forEach((e, i) => {
      const n = extNodes.length;
      const totalW = n * (EXT_W + 30) - 30;
      const startX = (W - totalW) / 2 + EXT_W / 2;
      nodes.push({ ...e, capa: "externo", x: startX + i * (EXT_W + 30), y: EXT_Y, w: EXT_W, h: EXT_H });
    });

    const conexionesData = data.conexiones ?? [];
    const implicitas: Conexion[] = socios.map((s) => ({
      from: "empresa",
      to: s.dni,
      tipo: "representa",
      label: s.participacion != null ? `${s.participacion}%` : undefined,
    }));
    const implicitasFinal = implicitas.filter(
      (e) => !conexionesData.some((c) => c.from === e.from && c.to === e.to && c.tipo === e.tipo),
    );
    const allEdges = [...conexionesData, ...implicitasFinal];
    const colusionCount = conexionesData.filter((c) => COLUSION_TYPES.has(c.tipo)).length;

    return { allNodes: nodes, edges: allEdges, colusionCount };
  }, [data]);

  const nodeById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  if (data.socios.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-2xl border border-dashed border-line bg-paperDeep text-sm text-mute">
        Esperando expansión por <code className="ml-1 font-mono">network_agent</code>…
      </div>
    );
  }

  const focusNode = focusId ? allNodes.find((n) => n.id === focusId) : null;
  const focusSocio = focusId ? data.socios.find((s) => s.dni === focusId) : null;
  const focusConnections = focusId
    ? edges.filter((e) => e.from === focusId || e.to === focusId)
    : [];

  const involvedByFocus = (nodeId: string): boolean => {
    if (!focusId) return true;
    if (nodeId === focusId) return true;
    return edges.some(
      (e) => (e.from === focusId && e.to === nodeId) || (e.to === focusId && e.from === nodeId),
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paperDeep">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-paperSoft px-4 py-2.5">
        <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest">
          <span className="text-mute">QUIÉN PIDE</span>
          <span className="text-mute">→</span>
          <span className="text-mute">QUIÉN APRUEBA</span>
          <span className="text-mute">→</span>
          <span className="text-mute">QUIÉN EJECUTA</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          {colusionCount > 0 && (
            <span className="rounded-full bg-crimson-soft px-2 py-0.5 font-semibold text-rust">
              {colusionCount} conexión{colusionCount > 1 ? "es" : ""} de colusión
            </span>
          )}
          <span className="flex items-center gap-1 text-mute">
            <MousePointerClick size={11} /> click un nodo para detalle
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <defs>
          <filter id="g-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#1B1611" floodOpacity="0.16" />
          </filter>
          <marker id="arr-rust" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#8B2A1E" />
          </marker>
          <marker id="arr-mute" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#76695A" />
          </marker>
        </defs>

        {/* Bandas de columnas */}
        <g pointerEvents="none">
          {(["compradora", "aprueban", "proveedor"] as const).map((c) => {
            const x = COL_X[c];
            const wBand = 340;
            return (
              <g key={c}>
                <rect x={x - wBand / 2} y={60} width={wBand} height={H - 140} fill="#FAF6E9" stroke="#D9CFB7" strokeWidth="1" strokeDasharray="2 4" rx={14} opacity={0.5} />
                <text x={x} y={42} textAnchor="middle" fontSize="11" fontWeight="700" fill="#76695A" letterSpacing="2">
                  {{ compradora: "COMPRADORA", aprueban: "APRUEBAN", proveedor: "PROVEEDOR" }[c]}
                </text>
                <text x={x} y={55} textAnchor="middle" fontSize="9" fill="#A89887">
                  {{ compradora: "quien pide y firma", aprueban: "comité que evalúa", proveedor: "empresa y socios" }[c]}
                </text>
              </g>
            );
          })}
          <text x={W / 2} y={EXT_Y - 26} textAnchor="middle" fontSize="11" fontWeight="700" fill="#76695A" letterSpacing="2">
            EXTERNOS · INFLUENCIA Y CONTROL
          </text>
        </g>

        {edges.map((e, i) => {
          const from = nodeById.get(e.from);
          const to = nodeById.get(e.to);
          if (!from || !to) return null;
          const visible = !focusId || e.from === focusId || e.to === focusId;
          return (
            <Edge key={`e-${i}`} from={from} to={to} tipo={e.tipo} label={e.label} severidad={e.severidad} dim={!visible} isColusion={COLUSION_TYPES.has(e.tipo)} />
          );
        })}

        {allNodes.map((n) => {
          const isFocus = focusId === n.id;
          const isDimmed = !involvedByFocus(n.id) && !!focusId;
          const socio = data.socios.find((s) => s.dni === n.id);
          return (
            <g
              key={n.id}
              style={{ cursor: "pointer", opacity: isDimmed ? 0.22 : 1, transition: "opacity 200ms ease" }}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={(e) => {
                e.stopPropagation();
                setStickyId(stickyId === n.id ? null : n.id);
              }}
            >
              <NodeCard node={n} socio={socio} focused={isFocus} sticky={stickyId === n.id} />
            </g>
          );
        })}
      </svg>

      {focusNode ? (
        <NodeDetailPanel
          node={focusNode}
          socio={focusSocio ?? undefined}
          connections={focusConnections}
          allNodes={allNodes}
          sticky={stickyId === focusNode.id}
          onClose={() => setStickyId(null)}
          empresaInfo={
            focusNode.id === "empresa"
              ? {
                  fields: [
                    { label: "RUC", value: data.ruc, mono: true },
                    { label: "Razón social", value: data.razonSocial },
                    { label: "Edad RUC", value: `${data.edadRucDias} días al ganar contrato` },
                    { label: "Capital social", value: data.capitalSocial ? `S/. ${data.capitalSocial.toLocaleString("es-PE")}` : "—" },
                    { label: "Domicilio fiscal", value: data.domicilio ?? "—" },
                  ],
                }
              : undefined
          }
        />
      ) : (
        <LegendStrip />
      )}
    </div>
  );
}

// ─── NodeCard (estructura con secciones) ─────────────────

function NodeCard({
  node,
  socio,
  focused,
  sticky,
}: {
  node: NodeBox;
  socio?: EmpresaNetwork["socios"][number];
  focused?: boolean;
  sticky?: boolean;
}) {
  const style = TIPO_STYLE[node.tipo];
  const hasFlags = (socio?.flags.length ?? 0) > 0;
  const x = node.x - node.w / 2;
  const y = node.y - node.h / 2;
  const isEmpresa = node.tipo === "empresa";

  const strokeColor = sticky || focused ? "#A0512D" : hasFlags ? "#8B2A1E" : style.stroke;
  const strokeWidth = sticky ? 3 : focused ? 2.5 : hasFlags ? 2 : 1.2;

  // Cálculo de ancho disponible para texto
  const innerW = node.w - PAD * 2;
  const titleSize = isEmpresa ? 13.5 : 12;
  // Estimación: avg width = fontSize * 0.55 para sans, * 0.55 para Source Serif Pro (algo más angosto)
  const titleCharWidth = titleSize * 0.55;
  const titleMaxChars = Math.floor(innerW / titleCharWidth);
  const detalleSize = 10;
  const detalleCharWidth = detalleSize * 0.55;
  const detalleMaxChars = Math.floor(innerW / detalleCharWidth);

  const nameLines = wrapText(node.nombre, titleMaxChars, 2);
  const detalleLines = node.detalle ? splitDetalle(node.detalle, detalleMaxChars) : [];

  // Y positions
  const HEADER_Y = HEADER_H; // divider position
  const NAME_BASELINE = HEADER_Y + 22;
  const NAME_END = NAME_BASELINE + (nameLines.length - 1) * NAME_LINE_H;
  const DETALLE_BASELINE = NAME_END + 18;

  return (
    <g transform={`translate(${x},${y})`} filter="url(#g-shadow)">
      {/* Card background */}
      <rect width={node.w} height={node.h} rx={12} fill={style.fill} stroke={strokeColor} strokeWidth={strokeWidth} />

      {/* ── HEADER ── */}
      <g>
        <rect x={6} y={6} width={22} height={22} rx={5} fill={style.chipBg} />
        <text x={17} y={22} textAnchor="middle" fontSize="13">{style.icon}</text>

        <text
          x={36}
          y={20}
          textAnchor="start"
          fontSize="8.5"
          fontWeight="700"
          fill={style.sub}
          letterSpacing="1.5"
        >
          {style.capaLabel}
        </text>
      </g>

      {/* Header divider */}
      <line x1={6} y1={HEADER_Y} x2={node.w - 6} y2={HEADER_Y} stroke={style.divider} strokeWidth="0.8" />

      {/* ── BODY: name + role ── */}
      <text
        x={PAD}
        y={NAME_BASELINE}
        textAnchor="start"
        fontSize={titleSize}
        fontWeight="700"
        fill={style.text}
        fontFamily="'Source Serif Pro', Georgia, serif"
      >
        {nameLines.map((line, i) => (
          <tspan key={i} x={PAD} dy={i === 0 ? 0 : NAME_LINE_H}>
            {line}
          </tspan>
        ))}
      </text>

      {detalleLines.length > 0 && (
        <text x={PAD} y={DETALLE_BASELINE} textAnchor="start" fontSize={detalleSize} fill={style.sub}>
          {detalleLines.map((line, i) => (
            <tspan key={i} x={PAD} dy={i === 0 ? 0 : 13}>
              {line}
            </tspan>
          ))}
        </text>
      )}

      {/* ── FOOTER (socios con/sin flags) ── */}
      {socio && (
        <>
          <line x1={6} y1={node.h - FOOTER_H + 4} x2={node.w - 6} y2={node.h - FOOTER_H + 4} stroke={style.divider} strokeWidth="0.8" />
          <text x={PAD} y={node.h - 12} textAnchor="start" fontSize="9" fontWeight="700" fill={hasFlags ? "#8B2A1E" : style.sub}>
            {hasFlags ? `${socio.flags.length} señal${socio.flags.length > 1 ? "es" : ""}` : "Sin señales"}
          </text>
          {socio.flags.slice(0, 4).map((f, j) => (
            <text key={j} x={node.w - 12 - j * 16} y={node.h - 12} fontSize="12" textAnchor="end">
              {FLAG_META[f.tipo].icon}
            </text>
          ))}
        </>
      )}

      {/* Lock indicator */}
      {sticky && (
        <g transform={`translate(${node.w - 16},14)`}>
          <circle r={6} fill="#A0512D" />
        </g>
      )}
    </g>
  );
}

// ─── Helpers ──────────────────────────────────────────────

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const lines: string[] = [];
  let remaining = text.trim();

  for (let i = 0; i < maxLines - 1; i++) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      return lines;
    }
    let splitAt = remaining.lastIndexOf(" ", maxChars);
    if (splitAt < maxChars * 0.5) splitAt = maxChars;
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > maxChars) {
    lines.push(remaining.slice(0, maxChars - 1) + "…");
  } else if (remaining) {
    lines.push(remaining);
  }

  return lines;
}

function splitDetalle(text: string, maxChars: number): string[] {
  // Si el detalle tiene " · " lo separamos en 2 líneas (rol · qualifier)
  if (text.includes(" · ")) {
    const [first, ...rest] = text.split(" · ");
    const second = rest.join(" · ");
    const line1 = first.length > maxChars ? first.slice(0, maxChars - 1) + "…" : first;
    const line2 = second.length > maxChars ? second.slice(0, maxChars - 1) + "…" : second;
    return [line1, line2];
  }
  return wrapText(text, maxChars, 2);
}

// ─── Edge ────────────────────────────────────────────────

function Edge({
  from,
  to,
  tipo,
  label,
  severidad,
  dim,
  isColusion,
}: {
  from: NodeBox;
  to: NodeBox;
  tipo: ConexionTipo;
  label?: string;
  severidad?: "alta" | "media" | "baja";
  dim?: boolean;
  isColusion?: boolean;
}) {
  const styleBase = CONEXION_STYLE[tipo];
  const stroke = severidad === "alta" ? "#8B2A1E" : severidad === "media" ? "#B5752C" : styleBase.stroke;

  const { x1, y1, x2, y2 } = computeEdgePoints(from, to);
  const isHorizontal = Math.abs(from.y - to.y) < 30;
  const isVertical = Math.abs(from.x - to.x) < 30;

  let path: string;
  let labelX: number;
  let labelY: number;

  if (isVertical) {
    path = `M${x1},${y1} L${x2},${y2}`;
    labelX = x1 + 4;
    labelY = (y1 + y2) / 2;
  } else if (isHorizontal) {
    path = `M${x1},${y1} L${x2},${y2}`;
    labelX = (x1 + x2) / 2;
    labelY = y1 - 12;
  } else {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) > Math.abs(dy)) {
      path = `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = (y1 + y2) / 2 - 8;
    } else {
      path = `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = (y1 + y2) / 2;
    }
  }

  const arrowId = styleBase.arrow === "rust" || severidad === "alta" ? "arr-rust" : "arr-mute";

  return (
    <g style={{ opacity: dim ? 0.08 : 1, transition: "opacity 200ms ease" }}>
      {isColusion && !dim && (
        <path d={path} stroke="#FEE2E2" strokeWidth={styleBase.width + 4} fill="none" strokeLinecap="round" />
      )}
      <path
        d={path}
        stroke={stroke}
        strokeWidth={styleBase.width}
        fill="none"
        strokeDasharray={styleBase.dash}
        markerEnd={`url(#${arrowId})`}
      />
      {label && !dim && <EdgeLabel x={labelX} y={labelY} text={label} stroke={stroke} />}
    </g>
  );
}

function EdgeLabel({ x, y, text, stroke }: { x: number; y: number; text: string; stroke: string }) {
  const t = text.length > 26 ? text.slice(0, 25) + "…" : text;
  const width = t.length * 5.4 + 14;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect x={-width / 2} y={-9} width={width} height={18} rx={9} fill="#F4EEDD" stroke="#BFB29B" strokeWidth={0.8} />
      <text textAnchor="middle" dy={4} fontSize="9.5" fontWeight="600" fill={stroke}>
        {t}
      </text>
    </g>
  );
}

// ─── Detail panel ────────────────────────────────────────

function NodeDetailPanel({
  node,
  socio,
  connections,
  allNodes,
  sticky,
  onClose,
  empresaInfo,
}: {
  node: NodeBox;
  socio?: EmpresaNetwork["socios"][number];
  connections: Conexion[];
  allNodes: NodeBox[];
  sticky: boolean;
  onClose: () => void;
  empresaInfo?: NodeInfo;
}) {
  const style = TIPO_STYLE[node.tipo];
  const info = node.info ?? socio?.info ?? empresaInfo;

  return (
    <div className="animate-slideUp border-t border-line bg-paperSoft">
      <div className="flex items-start gap-4 border-b border-line bg-paperDeep px-5 py-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: style.fill, color: style.text }}
        >
          {style.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
            {style.capaLabel}
            {node.capa !== "externo" && (
              <span className="ml-1.5 text-mute">
                · {{ compradora: "compradora", aprueban: "aprueban", proveedor: "proveedor", externo: "" }[node.capa]}
              </span>
            )}
          </div>
          <h3 className="mt-0.5 font-serif text-xl font-bold leading-tight text-ink">{node.nombre}</h3>
          {node.detalle && <div className="mt-0.5 text-sm text-mute">{node.detalle}</div>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {sticky && (
            <span className="inline-flex items-center gap-1 rounded-full bg-clay/15 px-2 py-0.5 text-[10px] font-semibold text-clay">
              <Lock size={10} /> fijado
            </span>
          )}
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paperSoft text-mute hover:bg-paper hover:text-ink" aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[1fr,320px]">
        <div>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-mute">Datos del nodo</h4>
          {info ? (
            <>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {info.fields.map((f, i) => (
                  <div key={i} className="border-b border-line py-1.5">
                    <dt className="text-[10px] uppercase tracking-wider text-mute">{f.label}</dt>
                    <dd className={cn("mt-0.5 text-sm leading-tight text-ink", f.mono && "font-mono")}>
                      {f.link ? (
                        <a href={f.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-clay hover:underline">
                          {f.value} <ExternalLink size={10} />
                        </a>
                      ) : (
                        f.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {info.note && (
                <div className="mt-3 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-xs text-rust">
                  <strong>Observación del agente:</strong> {info.note}
                </div>
              )}
              {info.fuente && (
                <a href={info.fuente.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-clay hover:underline">
                  <ExternalLink size={11} /> {info.fuente.nombre}
                </a>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-paperDeep p-4 text-sm text-mute">
              Datos detallados pendientes. <code className="font-mono">network_agent</code> los va a llenar.
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-mute">Conexiones ({connections.length})</h4>
          {connections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-paperDeep p-3 text-xs text-mute">
              Sin conexiones detectadas en este nodo.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {connections.map((c, i) => {
                const otherId = c.from === node.id ? c.to : c.from;
                const direction = c.from === node.id ? "→" : "←";
                const other = allNodes.find((n) => n.id === otherId);
                const conexStyle = CONEXION_STYLE[c.tipo];
                const isColusion = COLUSION_TYPES.has(c.tipo);
                return (
                  <li
                    key={i}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs",
                      isColusion ? "border-rust/40 bg-crimson-soft" : "border-line bg-paperDeep",
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-base leading-none text-mute">{direction}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{other?.nombre ?? otherId}</div>
                        <div className="text-[10px] text-mute">{TIPO_STYLE[other?.tipo ?? "persona"].capaLabel}</div>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                        style={{ background: isColusion ? "#8B2A1E" : "#E8DFC7", color: isColusion ? "#F4EEDD" : "#1B1611" }}
                      >
                        {conexStyle.label}
                      </span>
                      {c.label && <span className="text-[11px] text-inkSoft">{c.label}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendStrip() {
  return (
    <div className="border-t border-line bg-paperSoft px-4 py-2.5 text-[10px] text-mute">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <LegendItem label="adjudicó / aprobó" color="rust" />
        <LegendItem label="aporte / familiar (colusión)" color="rust" dashed />
        <LegendItem label="convoca / preside" color="mute" />
        <LegendItem label="pertenece" color="mute" dashed />
        <span className="ml-auto flex items-center gap-1">
          <MousePointerClick size={11} />
          Pasá el cursor por un nodo · click para fijar y ver el detalle abajo
        </span>
      </div>
    </div>
  );
}

function LegendItem({ label, color, dashed }: { label: string; color: "rust" | "mute"; dashed?: boolean }) {
  const stroke = color === "rust" ? "#8B2A1E" : "#76695A";
  return (
    <span className="flex items-center gap-1.5">
      <svg width="28" height="6">
        <line x1="0" y1="3" x2="28" y2="3" stroke={stroke} strokeWidth="2" strokeDasharray={dashed ? "4 2" : ""} />
      </svg>
      <span className="text-ink">{label}</span>
    </span>
  );
}

function computeEdgePoints(from: NodeBox, to: NodeBox) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fromHalfW = from.w / 2;
  const fromHalfH = from.h / 2;
  const toHalfW = to.w / 2;
  const toHalfH = to.h / 2;

  let x1: number, y1: number, x2: number, y2: number;
  if (Math.abs(dy) > Math.abs(dx) * 0.6) {
    x1 = from.x;
    y1 = from.y + (dy > 0 ? fromHalfH : -fromHalfH);
    x2 = to.x;
    y2 = to.y + (dy > 0 ? -toHalfH : toHalfH);
  } else {
    x1 = from.x + (dx > 0 ? fromHalfW : -fromHalfW);
    y1 = from.y;
    x2 = to.x + (dx > 0 ? -toHalfW : toHalfW);
    y2 = to.y;
  }
  return { x1, y1, x2, y2 };
}
