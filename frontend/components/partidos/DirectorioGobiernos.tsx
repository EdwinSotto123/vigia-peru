"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Search, SearchX, X } from "lucide-react";
import { nombreDepartamento } from "@/components/mapa/region-match";
import { Tabla, type Columna, type Fila } from "@/components/listado/Tabla";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { PaginacionNumerada } from "@/components/ui/PaginacionNumerada";
import { Skeleton } from "@/components/ui/Skeleton";
import { numero, solesCompacto } from "@/lib/formato";
import {
  COLOR_OTRAS,
  PALETA_ORG,
  TIPO_ORG_LABEL,
  cargarAutoridades,
  claveOrg,
  coloresDeFilas,
  conteos,
  normalizar,
  orgDe,
  pct,
  type Anio,
  type AutoridadesDatos,
  type Nivel,
  type TipoOrg,
} from "@/lib/partidos";
import { cn } from "@/lib/utils";

/**
 * El directorio de TODOS los gobiernos del país en un período (Elecciones Regionales y Municipales, JNE):
 * quién gobierna cada región, provincia y distrito, con su partido, y todas las organizaciones, no solo las
 * más grandes. Los datos llegan del archivo público /data/autoridades-<año>.json (179 KB), se piden al
 * montar y se filtran y paginan acá, en el navegador: un filtro no espera al servidor.
 *
 * El estado vive en la URL (`?nivel=&q=&region=&org=&orden=&pagina=`): se comparte, y el botón atrás lo
 * deshace. Los filtros la reescriben con history.replaceState (Next la sigue con useSearchParams); la
 * paginación y las pestañas de vista son enlaces. Cuenta quién ganó, no qué hizo: nada acá acusa a nadie.
 *
 * Lo que llega del servidor son datos planos y nodos ya armados (`contratosNode`, `mapaNode`), nunca funciones.
 */

export type Vista = "gobiernos" | "partidos" | "contratos" | "mapa";

export interface ContratosDeUnPartido {
  contratos: number;
  leidos: number;
  enCola: number;
  /** Procesos adjudicados de sus gobiernos en el período (CONOSCE, migración 65) y lo adjudicado en soles. */
  procesos?: number;
  montoAdjudicadoPen?: number;
}

const TAM = 25;

const NIVELES: { id: Nivel; etiqueta: string }[] = [
  { id: "regional", etiqueta: "Regiones" },
  { id: "provincial", etiqueta: "Provincias" },
  { id: "distrital", etiqueta: "Distritos" },
];

const ORDENES = [
  { valor: "lugar", etiqueta: "Lugar, de la A a la Z" },
  { valor: "partido", etiqueta: "Partido" },
  { valor: "votos", etiqueta: "Más votos primero" },
] as const;
type Orden = (typeof ORDENES)[number]["valor"];

const CAMPO =
  "h-10 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

/** Colores por organización para TODO el período: las 12 con más gobiernos, el resto gris. */
function coloresDelPeriodo(d: AutoridadesDatos) {
  return coloresDeFilas([...d.regional, ...d.provincial, ...d.distrital]);
}

/** El nombre de la organización como una pastilla con su color: el punto lleva el color, el fondo apenas lo insinúa. */
function ChipPartido({ nombre, tipo, color }: { nombre: string; tipo: TipoOrg; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium leading-snug text-ink"
      style={{ backgroundColor: `${color}22`, borderColor: `${color}66` }}
      title={`${nombre}, ${TIPO_ORG_LABEL[tipo].toLowerCase()}`}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{nombre}</span>
    </span>
  );
}

interface FilaGobierno {
  id: string;
  lugar: string;
  /** Provincia y región, para que dos distritos con el mismo nombre se distingan. */
  sub: string | null;
  region: string;
  autoridad: string;
  o: number;
  p: number | null;
}

function filasDe(d: AutoridadesDatos, nivel: Nivel): FilaGobierno[] {
  if (nivel === "regional") {
    return d.regional.map((g) => ({ id: g.u, lugar: nombreDepartamento(g.u), sub: null, region: g.u, autoridad: g.g, o: g.o, p: g.p }));
  }
  if (nivel === "provincial") {
    return d.provincial.map((g) => ({ id: g.u, lugar: g.n, sub: nombreDepartamento(g.u), region: g.u.slice(0, 2), autoridad: g.a, o: g.o, p: g.p }));
  }
  return d.distrital.map((g, i) => ({
    id: `${g.u}-${i}`,
    lugar: g.n,
    sub: `${g.pv}, ${nombreDepartamento(g.u)}`,
    region: g.u.slice(0, 2),
    autoridad: g.a,
    o: g.o,
    p: g.p,
  }));
}

const alfabetico = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

export function DirectorioGobiernos({
  anio,
  periodos,
  vista,
  contratos,
  contratosNode,
  mapaNode,
}: {
  anio: number;
  periodos: { anio: number; texto: string }[];
  vista: Vista;
  /** Contratos asociados a cada partido del período, por clave. `null`: la API no respondió. */
  contratos: Record<string, ContratosDeUnPartido> | null;
  contratosNode: ReactNode;
  mapaNode: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [datos, setDatos] = useState<AutoridadesDatos | null>(null);
  const [fallo, setFallo] = useState(false);

  // El archivo del período: se pide al montar y al cambiar de período.
  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setFallo(false);
    cargarAutoridades(anio as Anio).then((d) => {
      if (!vivo) return;
      if (d) setDatos(d);
      else setFallo(true);
    });
    return () => {
      vivo = false;
    };
  }, [anio]);

  const nivel = (NIVELES.find((n) => n.id === params.get("nivel"))?.id ?? "regional") as Nivel;
  const q = params.get("q") ?? "";
  const region = params.get("region") ?? "";
  const org = params.get("org") ?? "";
  const orden = (ORDENES.find((o) => o.valor === params.get("orden"))?.valor ?? "lugar") as Orden;
  const pagina = Math.max(1, Number(params.get("pagina")) || 1);

  /** Cambia filtros sin pedirle nada al servidor: reescribe la URL; volver a filtrar vuelve a la página 1. */
  const fijar = useCallback(
    (cambio: Record<string, string | undefined>) => {
      const p = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(cambio)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      if (!("pagina" in cambio)) p.delete("pagina");
      const qs = p.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const resumen = useMemo(() => {
    if (!datos) return null;
    const porOrg = conteos(datos);
    return {
      colores: coloresDelPeriodo(datos),
      porOrg,
      organizaciones: porOrg.length,
      claves: new Map(datos.orgs.map((o, i) => [claveOrg(o.n), i])),
    };
  }, [datos]);

  const hrefVista = (v: Vista) => {
    const p = new URLSearchParams({ anio: String(anio) });
    if (v !== "gobiernos") p.set("vista", v);
    if (v === "gobiernos" && nivel !== "regional") p.set("nivel", nivel);
    return `${pathname}?${p.toString()}`;
  };
  const hrefPeriodo = (a: number) => {
    const p = new URLSearchParams({ anio: String(a) });
    if (vista !== "gobiernos") p.set("vista", vista);
    if (vista === "gobiernos" && nivel !== "regional") p.set("nivel", nivel);
    return `${pathname}?${p.toString()}`;
  };

  const periodo = periodos.find((p) => p.anio === anio);

  return (
    <div className="space-y-4">
      {/* Período y vista: dos filas de pestañas, una sola decisión cada una. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <nav aria-label="Qué mirar" className="inline-flex flex-wrap gap-1 rounded-full border border-granate/25 bg-granate-50 p-1">
          {(
            [
              ["gobiernos", "Quién gobierna"],
              ["partidos", "Todos los partidos"],
              ["contratos", "Contratos por partido"],
              ["mapa", "En el mapa"],
            ] as const
          ).map(([v, texto]) => (
            <Link
              key={v}
              href={hrefVista(v)}
              prefetch={false}
              aria-current={vista === v ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-3.5 text-[13.5px] font-semibold transition-colors",
                vista === v ? "bg-granate text-paper shadow-sm" : "text-inkSoft hover:text-ink",
              )}
            >
              {texto}
            </Link>
          ))}
        </nav>
        <nav aria-label="Período de gobierno" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 hidden text-[12.5px] text-mute sm:inline">Gobiernos de</span>
          {periodos.map((p) => (
            <Link
              key={p.anio}
              href={hrefPeriodo(p.anio)}
              prefetch={false}
              aria-current={p.anio === anio ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] font-semibold transition-colors",
                p.anio === anio ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/50 hover:text-ink",
              )}
            >
              {p.texto}
            </Link>
          ))}
        </nav>
      </div>

      {(vista === "gobiernos" || vista === "partidos") && (
        <>
          {resumen && datos ? (
            <CifrasEnFila
              items={[
                { valor: numero(datos.regional.length), etiqueta: "gobiernos regionales", contexto: `elegidos en ${anio}` },
                { valor: numero(datos.provincial.length), etiqueta: "provincias" },
                { valor: numero(datos.distrital.length), etiqueta: "distritos" },
                { valor: numero(resumen.organizaciones), etiqueta: "organizaciones políticas", contexto: periodo ? `mandato ${periodo.texto}` : undefined },
              ]}
            />
          ) : (
            <div className="rounded-2xl border border-line bg-paper px-4 py-3" aria-hidden>
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {fallo && <EstadoVacio tono="error">No pudimos leer los resultados de {anio}. Recarga la página para reintentar.</EstadoVacio>}

          {datos && resumen && vista === "gobiernos" && (
            <Gobiernos datos={datos} resumen={resumen} nivel={nivel} q={q} region={region} org={org} orden={orden} pagina={pagina} fijar={fijar} anio={anio} />
          )}
          {datos && resumen && vista === "partidos" && (
            <TodosLosPartidos datos={datos} resumen={resumen} q={q} pagina={pagina} fijar={fijar} anio={anio} contratos={contratos} hrefGobiernos={(clave, nivelDe) => `${pathname}?${new URLSearchParams({ anio: String(anio), ...(nivelDe !== "regional" ? { nivel: nivelDe } : {}), org: clave }).toString()}`} />
          )}
          {!datos && !fallo && <TablaCargando />}
        </>
      )}

      {vista === "contratos" && contratosNode}
      {vista === "mapa" && mapaNode}
    </div>
  );
}

type Resumen = {
  colores: Map<number, string>;
  porOrg: ReturnType<typeof conteos>;
  organizaciones: number;
  claves: Map<string, number>;
};

function TablaCargando() {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <span className="sr-only">Cargando los gobiernos…</span>
      <div className="h-[34px] border-b border-line bg-paperSoft" aria-hidden />
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex h-[42px] items-center gap-4 border-b border-line/70 px-4 last:border-b-0" aria-hidden>
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="ml-auto h-5 w-1/4 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Quién gobierna: regiones, provincias o distritos ────────────────────────────────────────────

function Gobiernos({
  datos,
  resumen,
  nivel,
  q,
  region,
  org,
  orden,
  pagina,
  fijar,
  anio,
}: {
  datos: AutoridadesDatos;
  resumen: Resumen;
  nivel: Nivel;
  q: string;
  region: string;
  org: string;
  orden: Orden;
  pagina: number;
  fijar: (c: Record<string, string | undefined>) => void;
  anio: number;
}) {
  const pathname = usePathname();
  const base = useMemo(() => filasDe(datos, nivel), [datos, nivel]);
  const orgIndice = org ? resumen.claves.get(org) ?? -1 : null;
  // Los colores se reparten entre las organizaciones de ESTE nivel: así las regiones, las provincias y los distritos
  // se ven coloreados por quienes de verdad gobiernan ahí (con los de todo el período, casi todo quedaba gris).
  const colores = useMemo(() => coloresDeFilas(base), [base]);

  // Cuántos gobiernos tiene cada organización en ESTE nivel: para el reparto, el selector y las pastillas.
  const enEsteNivel = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of base) m.set(f.o, (m.get(f.o) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }, [base]);

  const filtradas = useMemo(() => {
    const k = normalizar(q);
    let f = base;
    if (region) f = f.filter((x) => x.region === region);
    if (orgIndice != null) f = f.filter((x) => x.o === orgIndice);
    if (k) {
      f = f.filter((x) => normalizar(`${x.lugar} ${x.sub ?? ""} ${x.autoridad} ${orgDe(datos, x.o).n}`).includes(k));
    }
    const orgNombre = (i: number) => orgDe(datos, i).n;
    return [...f].sort((a, b) => {
      if (orden === "votos") return (b.p ?? -1) - (a.p ?? -1) || alfabetico(a.lugar, b.lugar);
      if (orden === "partido") return alfabetico(orgNombre(a.o), orgNombre(b.o)) || alfabetico(a.lugar, b.lugar);
      return alfabetico(a.lugar, b.lugar) || alfabetico(a.sub ?? "", b.sub ?? "");
    });
  }, [base, region, orgIndice, q, orden, datos]);

  const ultima = Math.max(1, Math.ceil(filtradas.length / TAM));
  const actual = Math.min(pagina, ultima);
  const visibles = filtradas.slice((actual - 1) * TAM, actual * TAM);
  const hayFiltros = !!q || !!region || !!org || orden !== "lugar";

  const regiones = useMemo(() => datos.regional.map((g) => ({ valor: g.u, etiqueta: nombreDepartamento(g.u) })).sort((a, b) => alfabetico(a.etiqueta, b.etiqueta)), [datos]);

  const columnas: Columna[] = [
    { clave: "lugar", titulo: nivel === "regional" ? "Región" : nivel === "provincial" ? "Provincia" : "Distrito", ancho: "minmax(0,1.1fr)" },
    { clave: "autoridad", titulo: nivel === "regional" ? "Gobernador o gobernadora" : "Alcalde o alcaldesa", ancho: "minmax(0,1.1fr)", desde: "md" },
    { clave: "partido", titulo: "Partido u organización", ancho: "minmax(0,1.3fr)" },
    { clave: "votos", titulo: "Votos", ancho: "72px", alinear: "der", desde: "lg" },
  ];
  const filas: Fila[] = visibles.map((f) => {
    const o = orgDe(datos, f.o);
    const color = colores.get(f.o) ?? COLOR_OTRAS;
    return {
      id: f.id,
      celdas: {
        lugar: (
          <span className="block min-w-0">
            <span className="block truncate text-[14.5px] font-semibold text-ink">{f.lugar}</span>
            {f.sub && <span className="block truncate text-[12px] text-mute">{f.sub}</span>}
            {/* En el celular la autoridad baja bajo el lugar: la columna propia solo aparece desde md. */}
            <span className="block truncate text-[12.5px] text-inkSoft md:hidden">{f.autoridad}</span>
          </span>
        ),
        autoridad: <span className="block min-w-0 truncate text-[13.5px] text-ink" title={f.autoridad}>{f.autoridad}</span>,
        partido: <ChipPartido nombre={o.n} tipo={o.t} color={color} />,
        votos: <span className="font-mono text-[13px] tabular-nums text-inkSoft">{pct(f.p) ?? "Sin dato"}</span>,
      },
    };
  });

  const consulta: Record<string, string | undefined> = { anio: String(anio), nivel: nivel === "regional" ? undefined : nivel, q: q || undefined, region: region || undefined, org: org || undefined, orden: orden === "lugar" ? undefined : orden };

  return (
    <div className="space-y-3">
      <nav aria-label="Nivel de gobierno" className="flex flex-wrap items-center gap-2">
        {NIVELES.map((n) => {
          const total = n.id === "regional" ? datos.regional.length : n.id === "provincial" ? datos.provincial.length : datos.distrital.length;
          const activo = n.id === nivel;
          return (
            <button
              key={n.id}
              type="button"
              aria-pressed={activo}
              onClick={() => fijar({ nivel: n.id === "regional" ? undefined : n.id, org: org || undefined })}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors",
                activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/50 hover:text-ink",
              )}
            >
              {n.etiqueta}
              <span className={cn("rounded-full px-1.5 font-mono text-[12px] tabular-nums", activo ? "bg-paper/25" : "bg-paperDeep text-mute")}>{numero(total)}</span>
            </button>
          );
        })}
      </nav>

      {/* El reparto del poder en este nivel: cada tramo es una organización, con su color; tocar uno la filtra. */}
      <RepartoDelPoder
        enEsteNivel={enEsteNivel}
        datos={datos}
        colores={colores}
        total={base.length}
        nivel={nivel}
        orgIndice={orgIndice}
        onElegir={(i) => fijar({ org: i == null || i === orgIndice ? undefined : claveOrg(orgDe(datos, i).n) })}
      />

      <FiltrosDirectorio
        q={q}
        region={region}
        regiones={regiones}
        orden={orden}
        orgSeleccionada={orgIndice != null && orgIndice >= 0 ? orgDe(datos, orgIndice).n : ""}
        opcionesOrg={enEsteNivel.map(([i, n]) => ({ clave: claveOrg(orgDe(datos, i).n), nombre: orgDe(datos, i).n, n, color: colores.get(i) ?? COLOR_OTRAS }))}
        hayFiltros={hayFiltros}
        fijar={fijar}
      />

      {filas.length === 0 ? (
        <EstadoVacio icono={<SearchX size={16} aria-hidden />} accion={hayFiltros ? <LimpiarFiltros fijar={fijar} /> : undefined}>
          Ningún gobierno coincide con esos filtros.
        </EstadoVacio>
      ) : (
        <Tabla columnas={columnas} filas={filas} etiqueta={`Gobiernos ${NIVELES.find((n) => n.id === nivel)?.etiqueta.toLowerCase()} ${anio}`} densidad="compacta" />
      )}

      <PaginacionNumerada actual={actual} total={filtradas.length} tam={TAM} nombre={nivel === "regional" ? "regiones" : nivel === "provincial" ? "provincias" : "distritos"} hrefBase={pathname} query={consulta} />

      <p className="text-[12.5px] leading-relaxed text-mute">
        Cuenta quién ganó la elección de {anio}, no qué hizo cada gobierno: una vacancia, una revocatoria o un reemplazo dentro del período no está registrado.
        Una señal de Vigía es un motivo para revisar un contrato, nunca una acusación contra un partido ni una persona. Fuente: JNE, Plataforma Electoral (Infogob).
      </p>
    </div>
  );
}

function LimpiarFiltros({ fijar }: { fijar: (c: Record<string, string | undefined>) => void }) {
  return (
    <button type="button" onClick={() => fijar({ q: undefined, region: undefined, org: undefined, orden: undefined })} className="text-[13.5px] font-semibold text-granate underline-offset-4 hover:underline">
      Quitar filtros
    </button>
  );
}

/** Una barra de 14 px dividida por organización: se ve de un vistazo quién tiene más gobiernos, y cada tramo filtra. */
function RepartoDelPoder({
  enEsteNivel,
  datos,
  colores,
  total,
  nivel,
  orgIndice,
  onElegir,
}: {
  enEsteNivel: [number, number][];
  datos: AutoridadesDatos;
  colores: Map<number, string>;
  total: number;
  nivel: Nivel;
  orgIndice: number | null;
  onElegir: (i: number | null) => void;
}) {
  const grandes = enEsteNivel.slice(0, PALETA_ORG.length);
  const resto = enEsteNivel.slice(PALETA_ORG.length).reduce((s, [, n]) => s + n, 0);
  const etiqueta = NIVELES.find((n) => n.id === nivel)?.etiqueta.toLowerCase();
  return (
    <section aria-label={`Reparto de ${etiqueta} entre organizaciones`} className="rounded-2xl border border-granate/20 bg-gradient-to-br from-granate-50 via-paperSoft to-paper p-3 sm:p-4">
      <div className="flex h-3.5 w-full gap-px overflow-hidden rounded-full bg-paperDeep" role="group" aria-label="Tramos por organización">
        {grandes.map(([i, n]) => (
          <button
            key={i}
            type="button"
            onClick={() => onElegir(i)}
            aria-pressed={orgIndice === i}
            aria-label={`${orgDe(datos, i).n}: ${n} de ${total}`}
            title={`${orgDe(datos, i).n}: ${n}`}
            className={cn("h-full min-w-[3px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink", orgIndice != null && orgIndice !== i && "opacity-35")}
            style={{ width: `${(n / total) * 100}%`, backgroundColor: colores.get(i) ?? COLOR_OTRAS }}
          />
        ))}
        {resto > 0 && <span className="h-full" style={{ width: `${(resto / total) * 100}%`, backgroundColor: COLOR_OTRAS }} aria-hidden />}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
        {grandes.slice(0, 8).map(([i, n]) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onElegir(i)}
              aria-pressed={orgIndice === i}
              className={cn("inline-flex max-w-[16rem] items-center gap-1.5 rounded-full py-0.5 pr-1 text-inkSoft hover:text-ink", orgIndice === i && "font-semibold text-ink")}
            >
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colores.get(i) ?? COLOR_OTRAS }} />
              <span className="truncate">{orgDe(datos, i).n}</span>
              <span className="font-mono tabular-nums text-mute">{numero(n)}</span>
            </button>
          </li>
        ))}
        {enEsteNivel.length > 8 && <li className="py-0.5 text-mute">y otras {numero(enEsteNivel.length - 8)} organizaciones</li>}
      </ul>
    </section>
  );
}

// ── Filtros en una sola línea ───────────────────────────────────────────────────────────────────

function FiltrosDirectorio({
  q,
  region,
  regiones,
  orden,
  orgSeleccionada,
  opcionesOrg,
  hayFiltros,
  fijar,
}: {
  q: string;
  region: string;
  regiones: { valor: string; etiqueta: string }[];
  orden: Orden;
  orgSeleccionada: string;
  opcionesOrg: { clave: string; nombre: string; n: number; color: string }[];
  hayFiltros: boolean;
  fijar: (c: Record<string, string | undefined>) => void;
}) {
  const [texto, setTexto] = useState(q);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTexto(q), [q]);
  useEffect(() => () => { if (reloj.current) clearTimeout(reloj.current); }, []);
  const escribir = (v: string) => {
    setTexto(v);
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(() => {
      const t = v.trim();
      fijar({ q: t.length >= 2 ? t : undefined });
    }, 250);
  };

  return (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <label className="relative block min-w-[220px] flex-1">
        <span className="sr-only">Buscar por lugar, autoridad o partido</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
        <input
          type="search"
          value={texto}
          onChange={(e) => escribir(e.target.value)}
          placeholder="Buscar un lugar, una autoridad o un partido"
          autoComplete="off"
          enterKeyHint="search"
          className={cn(CAMPO, "w-full pl-9 pr-9")}
        />
        {texto && (
          <button type="button" onClick={() => { setTexto(""); fijar({ q: undefined }); }} aria-label="Borrar la búsqueda" className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-mute hover:text-ink">
            <X size={15} aria-hidden />
          </button>
        )}
      </label>

      <label className="block">
        <span className="sr-only">Región</span>
        <select value={region} onChange={(e) => fijar({ region: e.target.value || undefined })} className={cn(CAMPO, "w-full sm:w-auto", region && "border-granate/60 font-medium")}>
          <option value="">Todo el Perú</option>
          {regiones.map((r) => (
            <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
          ))}
        </select>
      </label>

      <SelectorPartido seleccionada={orgSeleccionada} opciones={opcionesOrg} onElegir={(clave) => fijar({ org: clave })} />

      <label className="block">
        <span className="sr-only">Ordenar por</span>
        <select value={orden} onChange={(e) => fijar({ orden: e.target.value === "lugar" ? undefined : e.target.value })} className={cn(CAMPO, "w-full sm:w-auto")}>
          {ORDENES.map((o) => (
            <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
          ))}
        </select>
      </label>

      {hayFiltros && <LimpiarFiltros fijar={fijar} />}
    </div>
  );
}

/** Un selector de partido buscable: la lista tiene más de 100 organizaciones, un <select> nativo no se puede buscar. */
function SelectorPartido({
  seleccionada,
  opciones,
  onElegir,
}: {
  seleccionada: string;
  opciones: { clave: string; nombre: string; n: number; color: string }[];
  onElegir: (clave: string | undefined) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [filtro, setFiltro] = useState("");
  const lista = useMemo(() => {
    const k = normalizar(filtro);
    return k ? opciones.filter((o) => normalizar(o.nombre).includes(k)) : opciones;
  }, [opciones, filtro]);
  const cerrar = () => {
    if (ref.current) ref.current.open = false;
    setFiltro("");
  };
  return (
    <details ref={ref} className="relative">
      <summary
        className={cn(CAMPO, "flex max-w-[15rem] cursor-pointer list-none items-center gap-2 sm:w-auto [&::-webkit-details-marker]:hidden", seleccionada && "border-granate/60 font-medium")}
        aria-label="Partido u organización"
      >
        <span className="truncate">{seleccionada || "Todos los partidos"}</span>
        <ChevronDown size={14} className="ml-auto shrink-0 text-mute" aria-hidden />
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-[min(22rem,90vw)] rounded-xl border border-line bg-paper p-2 shadow-lg">
        <label className="relative block">
          <span className="sr-only">Buscar un partido</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar un partido"
            autoComplete="off"
            className="h-9 w-full rounded-lg border border-line bg-paperSoft pl-8 pr-2 text-[13.5px] text-ink focus:border-granate"
          />
        </label>
        <ul className="mt-1.5 max-h-64 overflow-y-auto">
          <li>
            <button type="button" onClick={() => { onElegir(undefined); cerrar(); }} className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-paperDeep">
              Todos los partidos
            </button>
          </li>
          {lista.map((o) => (
            <li key={o.clave}>
              <button type="button" onClick={() => { onElegir(o.clave); cerrar(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-paperDeep">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: o.color }} />
                <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                <span className="font-mono text-[12px] tabular-nums text-mute">{o.n}</span>
              </button>
            </li>
          ))}
          {lista.length === 0 && <li className="px-2.5 py-2 text-[13px] text-mute">Ningún partido se llama así.</li>}
        </ul>
      </div>
    </details>
  );
}

// ── Todos los partidos del período ──────────────────────────────────────────────────────────────

function TodosLosPartidos({
  datos,
  resumen,
  q,
  pagina,
  fijar,
  anio,
  contratos,
  hrefGobiernos,
}: {
  datos: AutoridadesDatos;
  resumen: Resumen;
  q: string;
  pagina: number;
  fijar: (c: Record<string, string | undefined>) => void;
  anio: number;
  contratos: Record<string, ContratosDeUnPartido> | null;
  hrefGobiernos: (clave: string, nivel: Nivel) => string;
}) {
  const pathname = usePathname();
  const [texto, setTexto] = useState(q);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTexto(q), [q]);
  useEffect(() => () => { if (reloj.current) clearTimeout(reloj.current); }, []);

  const filas = useMemo(() => {
    const k = normalizar(q);
    return resumen.porOrg
      .map((c) => ({ ...c, o: orgDe(datos, c.org), clave: claveOrg(orgDe(datos, c.org).n) }))
      .filter((c) => !k || normalizar(c.o.n).includes(k));
  }, [resumen, datos, q]);
  const maximo = Math.max(1, ...resumen.porOrg.map((c) => c.total));
  const ultima = Math.max(1, Math.ceil(filas.length / TAM));
  const actual = Math.min(pagina, ultima);
  const visibles = filas.slice((actual - 1) * TAM, actual * TAM);

  return (
    <div className="space-y-3">
      <div role="search" className="flex flex-wrap items-center gap-2">
        <label className="relative block min-w-[220px] flex-1">
          <span className="sr-only">Buscar un partido</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            type="search"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              if (reloj.current) clearTimeout(reloj.current);
              const v = e.target.value.trim();
              reloj.current = setTimeout(() => fijar({ q: v.length >= 2 ? v : undefined }), 250);
            }}
            placeholder="Buscar un partido, movimiento o alianza"
            autoComplete="off"
            className={cn(CAMPO, "w-full pl-9")}
          />
        </label>
        <p className="text-[13px] text-inkSoft">
          {numero(resumen.organizaciones)} organizaciones gobernaron algo en {anio}, todas aquí, de la que más gobiernos tiene a la que menos.
        </p>
      </div>

      {visibles.length === 0 ? (
        <EstadoVacio icono={<SearchX size={16} aria-hidden />}>Ninguna organización se llama así.</EstadoVacio>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {visibles.map((c, i) => {
            const color = resumen.colores.get(c.org) ?? COLOR_OTRAS;
            const k = contratos?.[c.clave];
            const orden = (actual - 1) * TAM + i + 1;
            return (
              <li key={c.org} className="grid min-h-[48px] items-center gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-[1.75rem_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                <span className="hidden font-mono text-[13px] tabular-nums text-mute sm:block" aria-hidden>{orden}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-3 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate text-[14.5px] font-semibold text-ink" title={c.o.n}>{c.o.n}</span>
                  </span>
                  <span className="block pl-3.5 text-[12px] text-mute">
                    {TIPO_ORG_LABEL[c.o.t]}: {c.regional > 0 && `${c.regional} ${c.regional === 1 ? "región" : "regiones"}, `}
                    {c.provincial > 0 && `${c.provincial} ${c.provincial === 1 ? "provincia" : "provincias"}, `}
                    {numero(c.distrital)} {c.distrital === 1 ? "distrito" : "distritos"}
                  </span>
                </span>
                <span className="min-w-0" role="img" aria-label={`${c.total} gobiernos, frente a ${maximo} de la organización con más`}>
                  <span className="block h-2 overflow-hidden rounded-full bg-paperDeep">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (c.total / maximo) * 100)}%`, backgroundColor: color }} />
                  </span>
                  <span className="mt-0.5 block text-[12px] tabular-nums text-inkSoft">{numero(c.total)} {c.total === 1 ? "gobierno" : "gobiernos"}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] sm:justify-end">
                  <Link href={hrefGobiernos(c.clave, c.regional > 0 ? "regional" : c.provincial > 0 ? "provincial" : "distrital")} prefetch={false} className="inline-flex min-h-9 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                    Ver sus gobiernos <ChevronRight size={14} aria-hidden />
                  </Link>
                  {k && ((k.procesos ?? 0) > 0 || k.contratos > 0) ? (
                    // Sus procesos de CONOSCE (desde 2018); antes, sólo los contratos de la base de Vigía (2026), y los
                    // períodos anteriores decían "Sin contratos en la base".
                    <Link href={`/app/partidos/${c.clave}?anio=${anio}`} prefetch={false} className="inline-flex min-h-9 items-center gap-1 text-inkSoft underline-offset-4 hover:text-ink hover:underline">
                      <span className="font-mono tabular-nums text-ink">{numero(k.procesos ?? k.contratos)}</span> {(k.procesos ?? 0) > 0 ? "procesos" : "contratos"}
                      {(k.montoAdjudicadoPen ?? 0) > 0 && <span className="text-mute">· {solesCompacto(k.montoAdjudicadoPen ?? 0)}</span>}
                    </Link>
                  ) : (
                    contratos && <span className="text-mute">Sin procesos registrados</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <PaginacionNumerada actual={actual} total={filas.length} tam={TAM} nombre="organizaciones" hrefBase={pathname} query={{ anio: String(anio), vista: "partidos", q: q || undefined }} />
    </div>
  );
}
