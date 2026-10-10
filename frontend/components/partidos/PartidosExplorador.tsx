"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Search, Swords, Trophy } from "lucide-react";
import { PeruChoropleth, type ZonaPintada } from "@/components/PeruChoropleth";
import { nombreDepartamento } from "@/components/mapa/region-match";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import {
  COLOR_OTRAS,
  NIVEL_LABEL,
  TIPO_ORG_LABEL,
  cargarAutoridades,
  coloresDeFilas,
  coloresPorOrg,
  orgDe,
  pct,
  type AutoridadesDatos,
  type Nivel,
} from "@/lib/partidos";
import { DueloPartidos, MiDistrito, RankingPartidos } from "./PartidosPaneles";

/**
 * El explorador de partidos: un mapa del país pintado por la organización que ganó cada
 * gobierno regional en 2022 (al abrir una región, por la que ganó cada provincia), y a un lado
 * tres paneles: quién gobierna más, el duelo entre dos organizaciones y el buscador de distrito.
 *
 * Todo sale de `public/data/autoridades-2022.json` (JNE, Infogob). El archivo se baja una vez
 * en el navegador; mientras llega se ve un esqueleto. Si falla, se dice y se deja un enlace.
 */

type Panel = "ranking" | "duelo" | "distrito";

const PANELES: { id: Panel; label: string; Icono: typeof Trophy }[] = [
  { id: "ranking", label: "Quién gobierna más", Icono: Trophy },
  { id: "duelo", label: "Duelo", Icono: Swords },
  { id: "distrito", label: "Mi distrito", Icono: Search },
];

export function PartidosExplorador({ compacto = false }: { compacto?: boolean }) {
  const [d, setD] = useState<AutoridadesDatos | null>(null);
  const [error, setError] = useState(false);
  const [panel, setPanel] = useState<Panel>("ranking");
  const [nivel, setNivel] = useState<Nivel>("regional");
  const [resaltar, setResaltar] = useState<number | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [provSel, setProvSel] = useState<string | null>(null);
  const [activa, setActiva] = useState<{ ubigeo: string; nivel: "departamento" | "provincia" } | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarAutoridades().then((x) => {
      if (!vivo) return;
      if (x) setD(x);
      else setError(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Con una región abierta el mapa pinta provincias; el ranking sigue el nivel que se mire.
  const nivelMapa: Nivel = seleccion ? "provincial" : "regional";
  // Con una región abierta, los colores se reparten entre las organizaciones de ESA región:
  // si no, la leyenda nombra organizaciones que el mapa pinta de gris.
  const colores = useMemo(() => {
    if (!d) return new Map<number, string>();
    return seleccion ? coloresDeFilas(d.provincial.filter((p) => p.u.startsWith(seleccion))) : coloresPorOrg(d, "regional");
  }, [d, seleccion]);

  const regiones = useMemo(() => {
    const out: Record<string, ZonaPintada> = {};
    if (!d) return out;
    const colReg = coloresPorOrg(d, "regional");
    for (const g of d.regional) {
      const o = orgDe(d, g.o);
      out[g.u] = {
        color: colReg.get(g.o) ?? COLOR_OTRAS,
        sinDato: false,
        resumen: `${nombreDepartamento(g.u)}: ${g.g}, ${o.n}`,
        apagada: resaltar != null && nivel === "regional" && g.o !== resaltar,
      };
    }
    return out;
  }, [d, resaltar, nivel]);

  const provincias = useMemo(() => {
    const out: Record<string, ZonaPintada> = {};
    if (!d || !seleccion) return out;
    for (const p of d.provincial) {
      if (!p.u.startsWith(seleccion)) continue;
      const o = orgDe(d, p.o);
      out[p.u] = {
        color: colores.get(p.o) ?? COLOR_OTRAS,
        sinDato: false,
        resumen: `${p.n}: ${p.a}, ${o.n}`,
        apagada: resaltar != null && nivel === "provincial" && p.o !== resaltar,
      };
    }
    return out;
  }, [d, seleccion, colores, resaltar, nivel]);

  const foco = activa?.ubigeo ?? provSel ?? seleccion;
  const ficha = useMemo(() => {
    if (!d || !foco) return null;
    if (foco.length === 4) {
      const p = d.provincial.find((x) => x.u === foco);
      if (!p) return null;
      return { titulo: `${p.n}, ${nombreDepartamento(foco)}`, cargo: NIVEL_LABEL.provincial.cargo, persona: p.a, o: p.o, p: p.p, s: undefined as string | undefined, ubigeo: foco };
    }
    const g = d.regional.find((x) => x.u === foco);
    if (!g) return null;
    return { titulo: nombreDepartamento(foco), cargo: NIVEL_LABEL.regional.cargo, persona: g.g, o: g.o, p: g.p, s: g.s, ubigeo: foco };
  }, [d, foco]);

  const leyenda = useMemo(() => {
    if (!d) return [];
    const filas = nivelMapa === "regional" ? d.regional : d.provincial.filter((p) => p.u.startsWith(seleccion ?? "##"));
    const n = new Map<number, number>();
    for (const f of filas) n.set(f.o, (n.get(f.o) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [d, nivelMapa, seleccion]);

  if (error) {
    return (
      <p className="rounded-xl border border-line bg-paperSoft p-5 text-[15px] text-inkSoft">
        No pudimos traer los resultados electorales ahora. Vuelve a intentarlo en unos minutos.
      </p>
    );
  }
  if (!d) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-busy>
        <div className="h-[28rem] animate-pulseSoft rounded-2xl bg-paperSoft" />
        <div className="h-[28rem] animate-pulseSoft rounded-2xl bg-paperSoft" />
      </div>
    );
  }

  return (
    <div className={cn("grid gap-6 lg:gap-8", compacto ? "lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]" : "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]")}>
      {/* ── El mapa ─────────────────────────────────────────────── */}
      <div className="min-w-0">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-paperSoft">
          <div className="flex items-center justify-between gap-3 px-4 pt-4">
            <p className="etiqueta-mono">{seleccion ? `Provincias de ${nombreDepartamento(seleccion)}` : "Gobernadores regionales 2022"}</p>
            {seleccion && (
              <button
                type="button"
                onClick={() => {
                  setSeleccion(null);
                  setProvSel(null);
                  setActiva(null);
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3 text-[13px] font-semibold text-ink hover:bg-paperDeep"
              >
                <ArrowLeft size={14} aria-hidden /> Todo el Perú
              </button>
            )}
          </div>
          <div className="mx-auto h-[26rem] max-w-md sm:h-[32rem]">
            <PeruChoropleth
              regiones={regiones}
              provincias={provincias}
              provinciaPorDefecto={{ color: COLOR_OTRAS, sinDato: true, resumen: "Sin dato en los resultados" }}
              seleccion={seleccion}
              zonaSel={provSel}
              onZonaActiva={(z) => setActiva(z ? { ubigeo: z.ubigeo, nivel: z.nivel } : null)}
              activaUbigeo={activa?.ubigeo ?? null}
              onSelectRegion={(u) => {
                setSeleccion(u);
                setProvSel(null);
                setActiva(null);
              }}
              onSelectProvincia={(u) => setProvSel(u)}
            />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-3">
            {leyenda.map(([o, n]) => (
              <li key={o} className="flex items-center gap-1.5 text-[12.5px] text-inkSoft">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: colores.get(o) ?? COLOR_OTRAS }} />
                <span className="max-w-[11rem] truncate" title={orgDe(d, o).n}>
                  {orgDe(d, o).n}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-mute">{n}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-[12.5px] text-mute">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_OTRAS }} /> Otras
            </li>
          </ul>
        </div>

        {/* Quién gobierna donde apunta el cursor (o lo elegido). */}
        <div className="mt-4 min-h-[8.5rem] rounded-2xl border border-line bg-paperSoft p-4" aria-live="polite">
          {ficha ? (
            <>
              <p className="etiqueta-mono flex items-center gap-1.5">
                <MapPin size={13} aria-hidden /> {ficha.titulo}
              </p>
              <p className="mt-2 font-display text-[22px] font-bold leading-tight text-ink">{orgDe(d, ficha.o).n}</p>
              <p className="mt-1 text-[14px] text-inkSoft">
                {ficha.cargo}: <span className="font-semibold text-ink">{ficha.persona}</span>
              </p>
              <p className="mt-1 text-[13px] text-mute">
                {TIPO_ORG_LABEL[orgDe(d, ficha.o).t]}
                {pct(ficha.p) ? `, ${pct(ficha.p)} de los votos` : ""}
              </p>
              {ficha.s && <p className="mt-1 text-[12px] text-mute">Fuente: {ficha.s}</p>}
              {ficha.ubigeo.length === 2 && (
                <Link href={`/app/financiar/${ficha.ubigeo}`} className="mt-2 inline-block text-[13.5px] font-semibold text-granate underline-offset-4 hover:underline">
                  Ver contratos de esta región en Vigía
                </Link>
              )}
            </>
          ) : (
            <p className="text-[15px] leading-relaxed text-mute">
              Pasa el cursor o toca una región para ver quién la gobierna. Toca una región dos veces para abrir sus provincias.
            </p>
          )}
        </div>
      </div>

      {/* ── Los paneles ─────────────────────────────────────────── */}
      <div className="min-w-0">
        <div role="tablist" aria-label="Qué quieres ver" className="mb-5 flex flex-wrap gap-2">
          {PANELES.map(({ id, label, Icono }) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={panel === id}
              onClick={() => setPanel(id)}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors",
                panel === id ? "border-granate bg-granate text-paper" : "border-line text-inkSoft hover:border-paperEdge hover:text-ink",
              )}
            >
              <Icono size={15} aria-hidden /> {label}
            </button>
          ))}
        </div>
        <div className="rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
          {panel === "ranking" && <RankingPartidos d={d} nivel={nivel} onNivel={setNivel} resaltar={resaltar} onResaltar={setResaltar} />}
          {panel === "duelo" && <DueloPartidos d={d} />}
          {panel === "distrito" && <MiDistrito d={d} />}
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-mute">
          {numero(d.regional.length)} gobiernos regionales, {numero(d.provincial.length)} provinciales y {numero(d.distrital.length)} distritales.
          Fuente: {d.fuente}.
        </p>
      </div>
    </div>
  );
}
