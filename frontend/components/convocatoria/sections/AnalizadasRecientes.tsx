"use client";

/**
 * Los análisis publicados, como tabla densa (DESIGN_SYSTEM.md §10.7 y §14 "Listado"): una fila
 * por contrato —peso del riesgo, qué se contrató y quién compra, tipo, zona, monto, señales y
 * cuándo se leyó— y el dossier a un clic. Antes cada contrato era una tarjeta con el puntaje
 * gigante centrado en una franja de color y el objeto en dos líneas: se leía como un blog.
 *
 * El campo de búsqueda es el único de la página: filtra la tabla mientras se escribe y, con
 * Enter, abre el análisis si el código coincide exacto o si queda uno solo. Si la lista no
 * cargó, Enter abre el dossier por su código y que el dossier diga si existe.
 *
 * Conteos: la cifra de cabecera, los chips y las filas salen del mismo arreglo y de la misma
 * función de nivel (conteoRiesgo), así que siempre suman lo mismo. El tipo también: los que no
 * se pudieron clasificar tienen su chip ("Sin tipo") y no se pierden de la suma.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Shuffle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { esAlertaDemo } from "@/lib/semillas";
import { CORTE_ALTA, CORTE_MEDIA } from "@/lib/severidad";
import { numero, relativo, soles } from "@/lib/formato";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { ICONO_SEVERIDAD, Severidad } from "@/components/ui/Severidad";
import { Paginacion } from "@/components/ui/Paginacion";
import { Skeleton } from "@/components/ui/Skeleton";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { codigoCorto, inferCategoria } from "../utils";
import type { CatFilter, SortKey } from "../types";
import { CAT_LABEL, CAT_TONE } from "../constants";
import { contarPorNivel, NIVEL_ANALISIS, NIVELES, nivelDeAnalisis, UI_NIVEL, type NivelAnalisis } from "./conteoRiesgo";

type FiltroNivel = "todos" | NivelAnalisis;
/** `todas` = cualquier tipo; `sin_tipo` = el objeto no dejó deducir uno (inferCategoria → "todas"). */
type FiltroTipo = CatFilter | "sin_tipo";

const TAM = 24;
const TIPOS: CatFilter[] = ["bienes", "servicios", "obras", "consultoria"];
const ORDEN: { valor: SortKey; etiqueta: string }[] = [
  { valor: "reciente", etiqueta: "Más recientes" },
  { valor: "score", etiqueta: "Mayor puntaje" },
  { valor: "monto", etiqueta: "Mayor monto" },
];

/** Columnas de la tabla: 5 desde lg, 7 desde xl (tipo y zona salen de la línea de datos a su columna). */
const COLUMNAS =
  "lg:grid-cols-[132px_minmax(0,1fr)_100px_92px_68px] xl:grid-cols-[132px_minmax(0,1fr)_88px_104px_100px_92px_68px]";

/** Solo análisis reales: nunca las alertas de demo sembradas ni filas sin OCID o sin fecha de análisis. */
export const esAnalisisPublicado = (it: any) => !!it && !esAlertaDemo(it) && !!it.ocid && !!it.analizado_en;

const hrefDe = (it: any) => `/app/convocatoria/${encodeURIComponent(codigoCorto(it.codigo_convocatoria || it.ocid))}`;

export function AnalizadasRecientes({
  onSelect,
  conTitulo = false,
}: {
  onSelect: (ocidOrCodigo: string) => void;
  /** h2 propio: sólo donde la página no se llama ya "Análisis publicados" (panel del equipo). */
  conTitulo?: boolean;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<FiltroNivel>("todos");
  const [region, setRegion] = useState<string>("todas");
  const [cat, setCat] = useState<FiltroTipo>("todas");
  const [sort, setSort] = useState<SortKey>("reciente");
  const [page, setPage] = useState(1);

  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => {
        if (d?.error) setErr(d.error);
        else setItems((d.items || []).filter(esAnalisisPublicado));
      })
      .catch((e) => setErr(e.message));
  }, []);
  // Volver a la página 1 cuando cambian filtros/orden/búsqueda (no quedar en una página vacía).
  useEffect(() => {
    setPage(1);
  }, [q, sev, region, cat, sort]);

  // Filtrado en cliente: todos los datos ya vinieron en una sola query SQL.
  const todos = (items ?? []).map((it: any) => ({ ...it, _cat: inferCategoria(it.objeto) as CatFilter }));
  const qLower = q.trim().toLowerCase();
  const filtrados = todos.filter((it: any) => {
    if (qLower) {
      const texto = [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!texto.includes(qLower)) return false;
    }
    if (region !== "todas" && it.region !== region) return false;
    if (cat === "sin_tipo" ? it._cat !== "todas" : cat !== "todas" && it._cat !== cat) return false;
    // Mismo criterio que los contadores (conteoRiesgo): el nivel sale del puntaje.
    if (sev !== "todos" && nivelDeAnalisis(it) !== sev) return false;
    return true;
  });
  const ordenados = [...filtrados].sort((a, b) => {
    if (sort === "score") return (b.score || 0) - (a.score || 0);
    if (sort === "monto") return (b.monto || 0) - (a.monto || 0);
    return String(b.analizado_en || "").localeCompare(String(a.analizado_en || ""));
  });

  const paginas = Math.max(1, Math.ceil(ordenados.length / TAM));
  const actual = Math.min(Math.max(1, page), paginas);
  const visibles = ordenados.slice((actual - 1) * TAM, actual * TAM);
  const hayFiltros = !!qLower || sev !== "todos" || region !== "todas" || cat !== "todas";
  const limpiar = () => {
    setQ("");
    setSev("todos");
    setRegion("todas");
    setCat("todas");
  };

  /** Enter: abre el análisis si el código coincide exacto o si el filtro dejó uno solo. */
  const abrir = (e: React.FormEvent) => {
    e.preventDefault();
    const texto = q.trim();
    if (!texto) return;
    // Sin la lista (cargando o caída) no se sabe si existe: que lo diga el dossier.
    if (!items) {
      onSelect(codigoCorto(texto));
      return;
    }
    const c = codigoCorto(texto).toLowerCase();
    const exacto = items.find((it) => [it.codigo_convocatoria, it.ocid].some((v) => v && String(v).toLowerCase() === c));
    if (exacto) onSelect(exacto.codigo_convocatoria || exacto.ocid);
    else if (ordenados.length === 1) onSelect(ordenados[0].codigo_convocatoria || ordenados[0].ocid);
  };

  const sortear = () => {
    if (ordenados.length === 0) return;
    const it = ordenados[Math.floor(Math.random() * ordenados.length)];
    onSelect(it.codigo_convocatoria || it.ocid);
  };

  const conteo = contarPorNivel(todos);
  const ultima = todos.reduce<string | null>((max, it: any) => (!max || String(it.analizado_en) > max ? String(it.analizado_en) : max), null);
  const regiones = Array.from(new Set(todos.map((it: any) => it.region).filter(Boolean))).sort() as string[];
  const nSinTipo = todos.filter((it: any) => it._cat === "todas").length;

  return (
    <section
      aria-labelledby={conTitulo ? "publicados-titulo" : undefined}
      aria-label={conTitulo ? undefined : "Análisis publicados"}
      className="space-y-3"
    >
      {conTitulo && (
        <h2 id="publicados-titulo" className="font-display text-[20px] font-bold leading-tight text-ink">
          Análisis publicados
        </h2>
      )}

      {/* Barra: búsqueda, la cifra en una línea (§10.7) y orden/zona/sortear. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <form role="search" onSubmit={abrir} className="relative w-full sm:w-[340px]">
          <label htmlFor="buscar-analisis" className="sr-only">
            Buscar por código, OCID, objeto, entidad o RUC
          </label>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            id="buscar-analisis"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Código, objeto, entidad o RUC"
            autoComplete="off"
            inputMode="search"
            enterKeyHint="search"
            className="h-10 w-full rounded-xl border border-line bg-paper pl-9 pr-10 text-[13.5px] placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/20"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Borrar la búsqueda"
              className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-mute hover:bg-paperDeep hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </form>

        {items && items.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tabular-nums text-inkSoft" aria-live="polite">
            <span>
              <strong className="font-semibold text-ink">{numero(ordenados.length)}</strong>
              {hayFiltros ? ` de ${numero(items.length)}` : ""} análisis publicados
            </span>
            {!hayFiltros && ultima && (
              <span>
                última lectura <time dateTime={ultima}>{relativo(ultima)}</time>
              </span>
            )}
            {hayFiltros && (
              <button type="button" onClick={limpiar} className="inline-flex min-h-[24px] items-center gap-1 text-granate hover:underline">
                <X size={12} aria-hidden /> Quitar filtros
              </button>
            )}
          </p>
        )}

        {items && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <label className="sr-only" htmlFor="orden-analisis">
              Ordenar
            </label>
            <select id="orden-analisis" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={SELECT}>
              {ORDEN.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
            {regiones.length > 0 && (
              <>
                <label className="sr-only" htmlFor="zona-analisis">
                  Zona
                </label>
                <select id="zona-analisis" value={region} onChange={(e) => setRegion(e.target.value)} className={SELECT}>
                  <option value="todas">Toda zona</option>
                  {regiones.map((r) => (
                    <option key={r} value={r}>
                      {r} ({todos.filter((it: any) => it.region === r).length})
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              onClick={sortear}
              disabled={ordenados.length === 0}
              aria-label={`Sortear: abrir uno al azar de los ${ordenados.length} de la lista`}
              title={`Sortear: abrir uno al azar de los ${ordenados.length} de la lista`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-[12.5px] font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Shuffle size={13} aria-hidden />
              <span className="hidden sm:inline">Sortear</span>
            </button>
          </div>
        )}
      </div>

      {/* Filtros: chips con su conteo, en dos grupos. El número del chip es lo que queda al elegirlo. */}
      {items && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por peso del riesgo">
            <Chip activo={sev === "todos"} onClick={() => setSev("todos")}>
              Todos <Cuenta n={conteo.total} />
            </Chip>
            {NIVELES.map((k) => {
              const ui = UI_NIVEL[k];
              const Icono = ICONO_SEVERIDAD[ui.icono];
              const activo = sev === k;
              return (
                <Chip key={k} activo={activo} onClick={() => setSev(k)} titulo={NIVEL_ANALISIS[k].rango}>
                  <Icono size={13} className={activo ? "text-paper" : ui.texto} aria-hidden />
                  {ui.etiqueta} <Cuenta n={conteo[k]} />
                </Chip>
              );
            })}
            <Ayuda titulo="¿Qué es el peso del riesgo?">
              El tramo del puntaje (0 a 100), que suma el peso de cada señal publicada: alto desde {CORTE_ALTA}, medio desde{" "}
              {CORTE_MEDIA}, bajo por debajo. &ldquo;Sin señales&rdquo; son los leídos y publicados sin ninguna.
            </Ayuda>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por tipo de contrato">
            <Chip activo={cat === "todas"} onClick={() => setCat("todas")}>
              Todo tipo <Cuenta n={todos.length} />
            </Chip>
            {TIPOS.map((k) => {
              const n = todos.filter((it: any) => it._cat === k).length;
              if (n === 0) return null;
              return (
                <Chip key={k} activo={cat === k} onClick={() => setCat(k)}>
                  <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", CAT_TONE[k])} />
                  {CAT_LABEL[k]} <Cuenta n={n} />
                </Chip>
              );
            })}
            {nSinTipo > 0 && (
              <Chip activo={cat === "sin_tipo"} onClick={() => setCat("sin_tipo")}>
                Sin tipo <Cuenta n={nSinTipo} />
              </Chip>
            )}
            <Ayuda titulo="¿De dónde sale el tipo?">
              Se deduce de las palabras con que el SEACE describe el objeto (adquisición, servicio, obra, consultoría). Es
              aproximado: una compra &ldquo;para la obra&rdquo; puede quedar como obra.
            </Ayuda>
          </div>
        </div>
      )}

      <Cuerpo
        err={err}
        items={items}
        visibles={visibles}
        total={ordenados.length}
        q={q.trim()}
        hayFiltros={hayFiltros}
        limpiar={limpiar}
      />

      {ordenados.length > TAM && (
        <Paginacion
          actual={actual}
          paginas={paginas}
          total={ordenados.length}
          tam={TAM}
          navegacion="interna"
          onChange={setPage}
          cargando={false}
          nombre="análisis"
        />
      )}
    </section>
  );
}

function Cuerpo({
  err,
  items,
  visibles,
  total,
  q,
  hayFiltros,
  limpiar,
}: {
  err: string | null;
  items: any[] | null;
  visibles: any[];
  total: number;
  q: string;
  hayFiltros: boolean;
  limpiar: () => void;
}) {
  if (err) {
    return (
      <EstadoError titulo="No pudimos cargar los análisis publicados" detalle={err}>
        Suele ser momentáneo: recarga en unos segundos. Si tienes el código, escríbelo arriba y pulsa Enter.
      </EstadoError>
    );
  }
  if (!items) return <EsqueletoTabla />;
  if (items.length === 0) {
    return (
      <EstadoVacio titulo="Todavía no hay análisis publicados">
        Vigía lee los contratos en orden de cola, cuando alguien financia la lectura de su zona.
      </EstadoVacio>
    );
  }
  if (total === 0) {
    // Con texto escrito, lo más probable es que ese contrato todavía no se haya leído: se dice y se da la salida.
    return q ? (
      <EstadoVacio
        compacto
        titulo={`Ningún análisis publicado coincide con «${q}»`}
        accion={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/app/contratos?q=${encodeURIComponent(codigoCorto(q))}`} className={claseAccion("secundario")}>
              Buscarlo entre los contratos del SEACE
            </Link>
            <Link href="/app/financiar" className={claseAccion("primario")}>
              Financiar la lectura de su zona
            </Link>
          </div>
        }
      >
        Vigía no analiza a pedido: lee los contratos en orden de cola, cuando alguien financia la lectura de su zona.
      </EstadoVacio>
    ) : (
      <EstadoVacio
        compacto
        titulo="Ningún análisis coincide con los filtros"
        accion={
          hayFiltros ? (
            <button type="button" onClick={limpiar} className={claseAccion("secundario")}>
              Quitar los filtros
            </button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div
        className={cn(
          "hidden items-center gap-x-3 border-b border-line bg-paperSoft px-4 py-2 text-[11px] font-semibold text-mute lg:grid",
          COLUMNAS,
        )}
        aria-hidden
      >
        <span>Riesgo</span>
        <span>Contrato</span>
        <span className="hidden xl:block">Tipo</span>
        <span className="hidden xl:block">Zona</span>
        <span className="text-right">Adjudicado</span>
        <span>Señales</span>
        <span>Leído</span>
      </div>
      <ul>
        {visibles.map((it: any) => (
          <li key={it.codigo_convocatoria || it.ocid} className="border-b border-line/70 last:border-b-0">
            <Fila it={it} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Una fila: el título es el enlace al dossier y su `::after` cubre la fila entera (toda la fila
 * se toca, y el nombre accesible es el objeto del contrato, no una ristra de celdas). En el
 * escritorio el objeto va en una línea con el texto completo en `title`; en el celular, dos.
 */
function Fila({ it }: { it: any }) {
  const titulo = String(it.objeto || "").trim() || "Contrato sin objeto registrado";
  const codigo = codigoCorto(it.codigo_convocatoria || it.ocid);
  const tipo = it._cat !== "todas" ? CAT_LABEL[it._cat as CatFilter] : null;
  const zona: string | null = it.region || null;
  return (
    <div
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-2.5 transition-colors duration-rapido focus-within:bg-paperSoft hover:bg-paperSoft lg:items-center",
        COLUMNAS,
      )}
    >
      <div className="min-w-0">
        <ChipNivel it={it} conPuntaje />
      </div>

      <div className="col-span-2 min-w-0 lg:col-span-1">
        <Link
          href={hrefDe(it)}
          prefetch={false}
          title={titulo}
          className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink outline-none after:absolute after:inset-0 hover:text-granate focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate lg:truncate"
        >
          {titulo}
        </Link>
        <p className="mt-0.5 flex min-w-0 items-baseline gap-x-2.5 text-[12px] text-mute">
          <span className="shrink-0 font-mono tabular-nums text-inkSoft">{codigo}</span>
          {zona && <span className="shrink-0 xl:hidden">{zona}</span>}
          {tipo && <span className="shrink-0 xl:hidden">{tipo}</span>}
          <span className="min-w-0 truncate">{it.entidad || "Entidad sin dato"}</span>
        </p>
      </div>

      <span className="hidden text-[12.5px] text-inkSoft xl:inline-flex xl:items-center xl:gap-1.5">
        {tipo ? (
          <>
            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CAT_TONE[it._cat as CatFilter])} />
            {tipo}
          </>
        ) : (
          <span className="text-mute">Sin tipo</span>
        )}
      </span>
      <span className="hidden truncate text-[12.5px] text-inkSoft xl:block" title={zona ?? undefined}>
        {zona ?? <span className="text-mute">Sin dato</span>}
      </span>

      <span className="font-mono text-[12.5px] tabular-nums text-inkSoft lg:text-right">
        {it.monto > 0 ? (
          <>
            <span className="sr-only">Adjudicado </span>
            {soles(it.monto)}
          </>
        ) : (
          <span className="font-sans text-mute">
            <span className="lg:hidden">Monto </span>
            <span className="lg:hidden">sin dato</span>
            <span className="hidden lg:inline">Sin dato</span>
          </span>
        )}
      </span>

      <ConteoFila it={it} />

      <span className="col-start-2 row-start-1 justify-self-end text-[12px] tabular-nums text-mute lg:col-start-auto lg:row-start-auto lg:justify-self-auto">
        <span className="lg:hidden">leído </span>
        <time dateTime={it.analizado_en}>{relativo(it.analizado_en)}</time>
      </span>
    </div>
  );
}

/** Señales publicadas del contrato: el total y, al lado, cuántas de cada severidad (ícono + número). */
function ConteoFila({ it }: { it: any }) {
  const n = Number(it.n_banderas) || 0;
  const partes = (["alta", "media", "baja"] as const).filter((k) => Number(it[`n_${k}`]) > 0);
  return (
    <span className="inline-flex items-center gap-2 justify-self-end text-[12.5px] tabular-nums lg:justify-self-auto">
      <span className={n > 0 ? "font-semibold text-ink" : "text-mute"}>
        {numero(n)}
        <span className="lg:sr-only"> {n === 1 ? "señal" : "señales"}</span>
      </span>
      {partes.map((k) => (
        <span key={k} className="inline-flex items-center gap-0.5 text-inkSoft">
          <Severidad bandera={k} formato="punto" />
          {numero(Number(it[`n_${k}`]))}
        </span>
      ))}
    </span>
  );
}

/**
 * El peso del riesgo de un análisis, con la palabra de lib/severidad. Con señales puede llevar
 * el puntaje al lado (nunca sin señales, §10.4). Lo usa también el autocompletado del equipo.
 */
export function ChipNivel({ it, conPuntaje = false }: { it: any; conPuntaje?: boolean }) {
  const nivel = nivelDeAnalisis(it);
  if (!nivel) return <span className="pill border-line bg-paperDeep text-mute">Sin dato</span>;
  const ui = UI_NIVEL[nivel];
  const Icono = ICONO_SEVERIDAD[ui.icono];
  const puntaje = conPuntaje && nivel !== "sin_senales" && typeof it.score === "number" ? Math.round(it.score) : null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("pill whitespace-nowrap", ui.fondo, ui.texto, ui.borde)} title={NIVEL_ANALISIS[nivel].rango}>
        <Icono size={11} aria-hidden />
        {ui.etiqueta}
      </span>
      {puntaje != null && (
        <span className="font-mono text-[12px] tabular-nums text-inkSoft">
          <span className="sr-only">puntaje </span>
          {puntaje}
          <span className="sr-only"> de 100</span>
        </span>
      )}
    </span>
  );
}

const SELECT =
  "h-9 rounded-full border border-line bg-paper px-3 text-[12.5px] font-medium text-ink transition-colors duration-rapido hover:border-granate/40 focus:border-granate focus:outline-none";

/** Chip de filtro: granate = elegido (la marca), como en /app/hallazgos; nunca un nivel de riesgo. */
function Chip({
  activo,
  onClick,
  titulo,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={titulo}
      className={cn(
        "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors duration-rapido",
        activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
      )}
    >
      {children}
    </button>
  );
}

function Cuenta({ n }: { n: number }) {
  return <span className="font-semibold tabular-nums">{numero(n)}</span>;
}

/** La forma de la tabla que va a llegar, sin cifras provisionales. */
function EsqueletoTabla({ filas = 8 }: { filas?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper" aria-busy="true" aria-label="Cargando los análisis publicados…">
      <div className="border-b border-line bg-paperSoft px-4 py-2.5">
        <Skeleton className="h-3 w-48" />
      </div>
      <ul>
        {Array.from({ length: filas }).map((_, i) => (
          <li key={i} className={cn("grid grid-cols-1 items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0", COLUMNAS)}>
            <Skeleton className="h-5 w-24 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="hidden h-3 w-14 xl:block" />
            <Skeleton className="hidden h-3 w-16 xl:block" />
            <Skeleton className="hidden h-3 w-16 lg:block" />
            <Skeleton className="hidden h-3 w-12 lg:block" />
            <Skeleton className="hidden h-3 w-10 lg:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
