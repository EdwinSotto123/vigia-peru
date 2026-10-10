"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, MapPin, Search, Swords, Trophy } from "lucide-react";
import { PeruChoropleth, type ZonaPintada } from "@/components/PeruChoropleth";
import { nombreDepartamento } from "@/components/mapa/region-match";
import { RAMPA, construirEscala } from "@/components/mapa/escala";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";
import {
  ANIO_ACTUAL,
  COLOR_OTRAS,
  NIVEL_LABEL,
  PERIODOS,
  TIPO_ORG_LABEL,
  cargarAutoridades,
  cargoRegional,
  coloresDeFilas,
  coloresPorOrg,
  ganoProvincia,
  ganoRegion,
  orgDe,
  pct,
  type Anio,
  type AutoridadesDatos,
  type Cobertura,
  type Gano,
  type Nivel,
} from "@/lib/partidos";
import { DueloPartidos, MiDistrito, RankingPartidos } from "./PartidosPaneles";

/**
 * El explorador de partidos: un mapa del país pintado por la organización que ganó cada
 * gobierno regional en la elección que se elija (2014, 2018 o 2022), y a un lado tres paneles:
 * quién gobierna más, el duelo entre dos organizaciones y el buscador de distrito.
 *
 * El PERÍODO se elige arriba: todo lo de abajo (mapa, ranking, duelo, buscador) se recalcula
 * con esa elección. Las elecciones de 2026 aparecen como pendientes y se activan cuando el JNE
 * proclame los resultados y se carguen. Al tocar una región o provincia, la ficha muestra
 * también quién ganó en los otros períodos: así se ve quién se mantuvo y quién cambió.
 *
 * Los archivos salen de `public/data/autoridades-<año>.json` (JNE, Infogob); se bajan una vez
 * cada uno en el navegador. Mientras llegan se ve un esqueleto; si fallan, se dice.
 */

type Panel = "ranking" | "duelo" | "distrito";

const PANELES: { id: Panel; label: string; Icono: typeof Trophy }[] = [
  { id: "ranking", label: "Quién gobierna más", Icono: Trophy },
  { id: "duelo", label: "Duelo", Icono: Swords },
  { id: "distrito", label: "Mi distrito", Icono: Search },
];

const ANIOS_CARGADOS = PERIODOS.filter((p) => p.cargado).map((p) => p.anio as Anio);

type Modo = "ganador" | "dinero" | "vigilancia";

export function PartidosExplorador({ compacto = false, cobertura = null }: { compacto?: boolean; cobertura?: Cobertura | null }) {
  const [datos, setDatos] = useState<Partial<Record<number, AutoridadesDatos>>>({});
  const [error, setError] = useState(false);
  const [anio, setAnio] = useState<number>(ANIO_ACTUAL);
  const [panel, setPanel] = useState<Panel>("ranking");
  const [modo, setModo] = useState<Modo>("ganador");
  const [nivel, setNivel] = useState<Nivel>("regional");
  const [resaltar, setResaltar] = useState<number | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [provSel, setProvSel] = useState<string | null>(null);
  const [activa, setActiva] = useState<{ ubigeo: string; nivel: "departamento" | "provincia" } | null>(null);

  // Primero el período elegido; después, sin apuro, los otros (los necesita la ficha para el "antes").
  useEffect(() => {
    let vivo = true;
    const pedir = (a: Anio, esElegido: boolean) =>
      cargarAutoridades(a).then((x) => {
        if (!vivo) return;
        if (x) setDatos((prev) => (prev[a] ? prev : { ...prev, [a]: x }));
        else if (esElegido) setError(true);
      });
    pedir(ANIO_ACTUAL, true).then(() => {
      for (const a of ANIOS_CARGADOS) if (a !== ANIO_ACTUAL) void pedir(a, false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const d = datos[anio];
  const periodo = PERIODOS.find((p) => p.anio === anio);

  const cambiarAnio = (a: number) => {
    setAnio(a);
    setResaltar(null); // los índices de organización son de cada archivo
    setActiva(null);
    setProvSel(null);
  };

  // Con una región abierta, los colores se reparten entre las organizaciones de ESA región:
  // si no, la leyenda nombra organizaciones que el mapa pinta de gris.
  const colores = useMemo(() => {
    if (!d) return new Map<number, string>();
    return seleccion ? coloresDeFilas(d.provincial.filter((p) => p.u.startsWith(seleccion))) : coloresPorOrg(d, "regional");
  }, [d, seleccion]);
  const nivelMapa: Nivel = seleccion ? "provincial" : "regional";

  // Modo "qué tanto vigilamos": las regiones se pintan por cuántos contratos ya leyó Vigía en ellas.
  const vigilando = modo === "vigilancia" && !!cobertura && !seleccion;
  // Modo "cuánto se contrata": el valor referencial convocado en la sede de cada región (misma cuenta que /app/mapa).
  const conDinero = modo === "dinero" && !!cobertura && !seleccion;
  const escalaDinero = useMemo(
    () => (cobertura ? construirEscala(Object.values(cobertura.porRegion).map((r) => r.monto)) : null),
    [cobertura],
  );
  // Por PARTE de los contratos de la región que ya se leyó (no por cantidad): una región con 2 leídos de
  // 1.416 no está vigilada, aunque 2 sea más que 0. Los tramos son fijos, así todas se ven por lo que son.
  const colorLectura = (leidos: number, total: number) => {
    if (leidos === 0 || total === 0) return "#1F2A2A";
    const p = (leidos / total) * 100;
    return p < 0.5 ? RAMPA[0] : p < 1 ? RAMPA[1] : p < 2 ? RAMPA[2] : p < 3 ? RAMPA[3] : RAMPA[4];
  };

  const regiones = useMemo(() => {
    const out: Record<string, ZonaPintada> = {};
    if (!d) return out;
    if (conDinero && cobertura && escalaDinero) {
      for (const g of d.regional) {
        const r = cobertura.porRegion[g.u];
        out[g.u] = {
          color: escalaDinero.color(r?.monto ?? null),
          sinDato: false,
          resumen: `${nombreDepartamento(g.u)}: ${solesCompacto(r?.monto ?? 0)} en ${numero(r?.total ?? 0)} contratos`,
        };
      }
      return out;
    }
    if (vigilando && cobertura) {
      for (const g of d.regional) {
        const r = cobertura.porRegion[g.u];
        const n = r?.leidos ?? 0;
        out[g.u] = {
          color: colorLectura(n, r?.total ?? 0),
          sinDato: false,
          resumen: `${nombreDepartamento(g.u)}: ${numero(n)} de ${numero(r?.total ?? 0)} contratos leídos por Vigía`,
        };
      }
      return out;
    }
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
  }, [d, resaltar, nivel, vigilando, conDinero, cobertura, escalaDinero]);

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

  /** La ficha del lugar que se mira: quién gobierna en el período elegido y quién ganó en los demás. */
  const ficha = useMemo(() => {
    if (!d || !foco) return null;
    const esProv = foco.length === 4;
    const gano = (x: AutoridadesDatos | undefined): Gano | null => (esProv ? ganoProvincia(x, foco) : ganoRegion(x, foco));
    const ahora = gano(d);
    if (!ahora) return null;
    const nombre = esProv ? (d.provincial.find((x) => x.u === foco)?.n ?? foco) : nombreDepartamento(foco);
    const fuente = !esProv ? d.regional.find((x) => x.u === foco)?.s : undefined;
    const historial = PERIODOS.filter((p) => p.cargado).map((p) => ({ anio: p.anio, gano: gano(datos[p.anio]) }));
    const lectura = !esProv && cobertura ? (cobertura.porRegion[foco] ?? { total: 0, leidos: 0, enCola: 0, monto: 0, conSenales: 0 }) : null;
    return {
      titulo: esProv ? `${nombre}, ${nombreDepartamento(foco)}` : nombre,
      cargo: esProv ? NIVEL_LABEL.provincial.cargo : cargoRegional(anio),
      gano: ahora,
      fuente,
      historial,
      lectura,
      region: !esProv ? foco : null,
    };
  }, [d, foco, datos, anio, cobertura]);

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

  return (
    <div>
      {/* ── El período ──────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="etiqueta-mono flex items-center gap-2">
          <CalendarDays size={14} aria-hidden /> Período electoral
        </p>
        <div role="tablist" aria-label="Elecciones de" className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            const activo = p.anio === anio;
            return (
              <button
                key={p.anio}
                role="tab"
                type="button"
                aria-selected={activo}
                disabled={!p.cargado}
                title={p.cargado ? `Mandato ${p.mandato}` : "Pendiente: se carga cuando el JNE proclame los resultados"}
                onClick={() => p.cargado && cambiarAnio(p.anio)}
                className={cn(
                  "inline-flex min-h-10 flex-col items-start justify-center rounded-xl border px-4 py-1.5 text-left transition-colors",
                  activo ? "border-granate bg-granate text-paper" : "border-line text-inkSoft hover:border-paperEdge hover:text-ink",
                  !p.cargado && "cursor-not-allowed border-dashed opacity-60 hover:border-line hover:text-inkSoft",
                )}
              >
                <span className="font-mono text-[15px] font-bold tabular-nums leading-tight">{p.anio}</span>
                <span className={cn("text-[11.5px] leading-tight", activo ? "text-paper/80" : "text-mute")}>
                  {p.cargado ? `Mandato ${p.mandato}` : "Pendiente"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!d ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-busy>
          <div className="h-[28rem] animate-pulseSoft rounded-2xl bg-paperSoft" />
          <div className="h-[28rem] animate-pulseSoft rounded-2xl bg-paperSoft" />
        </div>
      ) : (
        <div className={cn("grid gap-6 lg:gap-8", compacto ? "lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]" : "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]")}>
          {/* ── El mapa ─────────────────────────────────────────── */}
          <div className="min-w-0">
            <div className="relative overflow-hidden rounded-2xl border border-line bg-paperSoft">
              <div className="flex items-center justify-between gap-3 px-4 pt-4">
                {cobertura && !seleccion ? (
                  <div role="tablist" aria-label="Qué pinta el mapa" className="inline-flex rounded-full border border-line bg-paperDeep p-1">
                    {(
                      [
                        ["ganador", "Quién gobierna"],
                        ["dinero", "Cuánto se contrata"],
                        ["vigilancia", "Qué tanto vigilamos"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        type="button"
                        aria-selected={modo === id}
                        onClick={() => setModo(id)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                          modo === id ? "bg-granate text-paper" : "text-inkSoft hover:text-ink",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="etiqueta-mono">
                    {seleccion ? `Provincias de ${nombreDepartamento(seleccion)}, ${anio}` : `${anio <= 2014 ? "Presidentes" : "Gobernadores"} regionales ${anio}`}
                  </p>
                )}
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
              {conDinero ? (
                <div className="border-t border-line px-4 py-3">
                  <p className="text-[12.5px] text-inkSoft">Valor de los contratos convocados en la sede de cada región. No es lo pagado.</p>
                  <div className="mt-2 flex items-center gap-2 text-[12px] text-mute">
                    <span>Menos</span>
                    <span aria-hidden className="h-2.5 flex-1 rounded-sm" style={{ background: `linear-gradient(90deg, ${RAMPA.join(", ")})` }} />
                    <span>Más</span>
                  </div>
                </div>
              ) : vigilando ? (
                <div className="border-t border-line px-4 py-3">
                  <p className="text-[12.5px] text-inkSoft">Qué parte de los contratos de cada región ya leyó Vigía</p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-mute">
                    {(
                      [
                        ["#1F2A2A", "Ninguno"],
                        [RAMPA[0], "menos de 0,5 %"],
                        [RAMPA[1], "0,5 a 1 %"],
                        [RAMPA[2], "1 a 2 %"],
                        [RAMPA[3], "2 % o más"],
                      ] as const
                    ).map(([c, t]) => (
                      <li key={t} className="flex items-center gap-1.5">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
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
              )}
            </div>

            {/* Quién gobierna donde apunta el cursor (o lo elegido), y cómo votó antes. */}
            <div className="mt-4 min-h-[8.5rem] rounded-2xl border border-line bg-paperSoft p-4" aria-live="polite">
              {ficha ? (
                <>
                  <p className="etiqueta-mono flex items-center gap-1.5">
                    <MapPin size={13} aria-hidden /> {ficha.titulo}
                  </p>
                  <p className="mt-2 font-display text-[22px] font-bold leading-tight text-ink">{ficha.gano.org.n}</p>
                  <p className="mt-1 text-[14px] text-inkSoft">
                    {ficha.cargo}: <span className="font-semibold text-ink">{ficha.gano.persona}</span>
                  </p>
                  <p className="mt-1 text-[13px] text-mute">
                    {TIPO_ORG_LABEL[ficha.gano.org.t]}
                    {pct(ficha.gano.p) ? `, ${pct(ficha.gano.p)} de los votos` : ""}
                  </p>
                  {ficha.fuente && <p className="mt-1 text-[12px] text-mute">Fuente: {ficha.fuente}</p>}
                  <ol className="mt-3 space-y-1 border-t border-line pt-3">
                    {ficha.historial.map((h) => (
                      <li key={h.anio} className={cn("grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 text-[13px]", h.anio === anio ? "text-ink" : "text-inkSoft")}>
                        <span className="font-mono tabular-nums text-mute">{h.anio}</span>
                        <span className={cn("truncate", h.anio === anio && "font-semibold")} title={h.gano?.org.n}>
                          {h.gano ? h.gano.org.n : "Sin dato"}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {ficha.lectura && (
                    <p className="mt-3 rounded-lg bg-paperDeep px-3 py-2 text-[13px] leading-snug text-inkSoft">
                      Se contratan <span className="font-mono font-bold tabular-nums text-ink">{solesCompacto(ficha.lectura.monto)}</span>.{" "}
                      Vigía leyó{" "}
                      <span className="font-mono font-bold tabular-nums text-ink">{numero(ficha.lectura.leidos)}</span> de{" "}
                      <span className="font-mono tabular-nums">{numero(ficha.lectura.total)}</span> contratos de esta región.
                      {ficha.lectura.leidos === 0 ? " Con tu ayuda se puede empezar." : ""}
                    </p>
                  )}
                  {ficha.region && (
                    <Link href={`/app/financiar/${ficha.region}`} className="mt-3 inline-block text-[13.5px] font-semibold text-granate underline-offset-4 hover:underline">
                      Financiar la lectura de esta región
                    </Link>
                  )}
                </>
              ) : (
                <p className="text-[15px] leading-relaxed text-mute">
                  Pasa el cursor o toca una región para ver quién la gobierna en {anio} y quién ganó en los otros períodos. Toca una región para abrir
                  sus provincias.
                </p>
              )}
            </div>
          </div>

          {/* ── Los paneles ─────────────────────────────────────── */}
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
              {panel === "ranking" && <RankingPartidos key={anio} d={d} nivel={nivel} onNivel={setNivel} resaltar={resaltar} onResaltar={setResaltar} />}
              {panel === "duelo" && <DueloPartidos key={anio} d={d} />}
              {panel === "distrito" && <MiDistrito d={d} anio={anio} datos={datos} />}
            </div>
            <p className="mt-3 text-[12.5px] leading-snug text-mute">
              Elecciones {anio} (mandato {periodo?.mandato}): {numero(d.regional.length)} gobiernos regionales, {numero(d.provincial.length)} provinciales
              y {numero(d.distrital.length)} distritales. Fuente: {d.fuente}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
