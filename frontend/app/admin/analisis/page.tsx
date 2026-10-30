"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, ArrowDownUp, ArrowRight, ChevronRight, ExternalLink, FileSearch, Loader2, Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Listado, ZonaResultados, useListado } from "@/components/listado/Listado";
import { Buscador } from "@/components/listado/BarraFiltros";
import { Severidad } from "@/components/ui/Severidad";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { useDespacho, type Despacho } from "@/components/convocatoria/useDespacho";
import { SortearSeace } from "@/components/convocatoria/sections/SortearSeace";
import { LoadingView } from "@/components/convocatoria/sections/LoadingView";
import { ChipNivel } from "@/components/convocatoria/TablaAnalisis";
import { codigoCorto } from "@/components/convocatoria/utils";
import { NIVELES, type NivelAnalisis } from "@/components/convocatoria/sections/conteoRiesgo";
import {
  analisisQueryParams,
  codigoDe,
  esAnalisisPublicado,
  ETIQUETA_TIPO,
  facetasAnalisis,
  filtrarAnalisis,
  hayFiltros,
  hrefAnalisis,
  ORDENES,
  ORDEN_POR_DEFECTO,
  ordenarAnalisis,
  parseAnalisisQuery,
  RIESGO_URL,
  tipoDe,
  TOPE_API,
  type AnalisisPublicado,
  type AnalisisQuery,
  type Opcion,
} from "@/components/convocatoria/analisisPublicados";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { rutaContrato } from "@/lib/rutas";
import { fechaConAnio, numero, soles } from "@/lib/formato";
import { CORTE_ALTA, CORTE_MEDIA } from "@/lib/severidad";
import { cn } from "@/lib/utils";
import { Aviso, claseBoton, DataTable, EmptyState, ErrorBanner, FilterChips, PageSection, SkeletonTabla, fmtNum, type Columna, type OpcionChip, type Tone } from "@/components/admin/ui";

/**
 * Análisis a demanda (herramienta interna): pegar un código SEACE y despachar los agentes, sortear
 * una convocatoria y, debajo, los análisis publicados. El público ya no analiza a demanda: los
 * contratos de la cola se leen con el fondo común (ver /admin/procesamientos).
 *
 * Rediseño del 2026-10-30 (4.7 pantallas en el celular): el aviso de costo es una línea bajo el título
 * del despacho; los filtros de la lista (riesgo, tipo, zona y orden) van en UNA fila que en el celular se
 * desliza de costado; la lista es la DataTable del panel, paginada, y en el celular cada análisis ocupa
 * dos renglones. Antes todo esto vivía en ConvocatoriaSearch + AnalisisPublicadosPanel (sólo los usaba
 * esta página); se arma acá con las mismas piezas: useDespacho, SortearSeace, LoadingView y los filtros,
 * conteos y orden de analisisPublicados.ts, así que filtra y cuenta igual que /app/convocatoria.
 *
 * Seguridad (sin cambios): `?run=` no dispara nada; `?ocid=<código>` sólo PRELLENA el campo (lo usa
 * "Procesar ahora" del informe); las rutas /api/agent/analyze*, /upload-doc y /random exigen la
 * cookie de admin verificada contra el API (401 si no).
 */

/** Filas por página: con 25 la lista sola pasaba de 3 pantallas en el celular. */
const POR_PAGINA = 20;

/** Las palabras cortas de cada nivel en los chips: la fila ya dice «Riesgo» delante (en cada fila, «Riesgo alto»). */
const NIVEL_CORTO: Record<NivelAnalisis, string> = { alta: "Alto", media: "Medio", baja: "Bajo", sin_senales: "Sin señales" };
const TONO_NIVEL: Record<NivelAnalisis, Tone> = { alta: "danger", media: "warn", baja: "neutral", sin_senales: "ok" };
const TODOS = "todos";

/** ¿El análisis coincide con lo que se escribió en el campo de despacho? (código, OCID, objeto, entidad o RUC). */
const coincide = (it: AnalisisPublicado, qLower: string) =>
  [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(qLower);

export default function AdminAnalisisPage() {
  return (
    <AdminShell
      title="Análisis a demanda"
      subtitle="Despacha los agentes a mano o revisa lo publicado"
      actions={
        <>
          {/* En el celular, «Procesamiento» a secas: los dos botones caben en un renglón. */}
          <Link href="/admin/procesamientos" className={claseBoton("secundario")}>
            <Activity size={12} aria-hidden /> Procesamiento<span className="hidden sm:inline">&nbsp;automático</span>
          </Link>
          <Link href="/app/auditoria" target="_blank" className={claseBoton("secundario")}>
            <ExternalLink size={12} aria-hidden /> Tablero público
          </Link>
        </>
      }
    >
      <AnalisisDemanda />
    </AdminShell>
  );
}

/** Los análisis publicados (GET /api/agent/history, hasta 500): la lista de abajo y el autocompletado del campo, con un solo pedido. */
function useAnalisisPublicados() {
  const [items, setItems] = useState<AnalisisPublicado[] | null>(null);
  const [parcial, setParcial] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vigente = true;
    setFallo(null);
    getAnalyzedList(500)
      .then((d) => {
        if (!vigente) return;
        if (d?.error) return setFallo(String(d.detail || d.error));
        const crudos: unknown[] = Array.isArray(d?.items) ? d.items : [];
        setItems(crudos.filter(esAnalisisPublicado));
        // /api/agent/history pagina el API hasta 500; parcial si el total real es mayor.
        setParcial(typeof d?.total === "number" ? d.total > 500 : crudos.length >= TOPE_API);
      })
      .catch((e) => {
        if (vigente) setFallo((e as Error)?.message || "sin conexión");
      });
    return () => {
      vigente = false;
    };
  }, [intento]);
  return { items, parcial, fallo, reintentar: () => setIntento((n) => n + 1) };
}

function AnalisisDemanda() {
  const d = useDespacho();
  const { items, parcial, fallo, reintentar } = useAnalisisPublicados();
  // El código del campo vive acá y no en el campo: si la corrida falla, al volver sigue escrito.
  const [id, setId] = useState("");

  // `?ocid=<código>` sólo PRELLENA el campo: nunca despacha nada solo.
  useEffect(() => {
    try {
      const pre = new URLSearchParams(window.location.search).get("ocid");
      if (pre) setId(pre.trim().slice(0, 120));
    } catch {
      /* sin window.location: nada que prellenar */
    }
  }, []);

  // Mientras corre un análisis, su progreso ocupa el lugar del campo y de la lista; al terminar se va al informe.
  if (d.cargando) return <LoadingView stepIdx={d.stepIdx} elapsed={d.elapsed} codigo={d.codigo} liveEvents={d.liveEvents} />;

  return (
    <div className="space-y-6">
      <CampoDespacho d={d} id={id} setId={setId} analizados={items ?? []} />
      {/* useSearchParams (los filtros en la URL) pide un límite de Suspense; mientras, la forma de la lista. */}
      <Suspense fallback={<SkeletonTabla filas={8} columnas={5} />}>
        <Publicados items={items} parcial={parcial} fallo={fallo} reintentar={reintentar} />
      </Suspense>
    </div>
  );
}

/** El despacho: el campo con su botón, el autocompletado con lo ya publicado y el sorteo. El aviso de costo, en una línea. */
function CampoDespacho({ d, id, setId, analizados }: { d: Despacho; id: string; setId: (v: string) => void; analizados: AnalisisPublicado[] }) {
  const router = useRouter();
  const [showSugg, setShowSugg] = useState(false);
  const qLower = id.trim().toLowerCase();
  // Autocompletado con los análisis ya publicados: abrir uno en vez de volver a pagarlo.
  const sugerencias = showSugg && qLower ? analizados.filter((it) => coincide(it, qLower)).slice(0, 6) : [];
  const despachar = (e: React.FormEvent) => {
    e.preventDefault();
    void d.despachar(id);
  };

  return (
    <PageSection
      titulo="Analiza un contrato del SEACE"
      ayuda={
        <Ayuda titulo="¿Qué hace despachar?">
          Pega el código de la convocatoria o su OCID: los {TOTAL_AGENTES} agentes leen el expediente y el informe queda
          público al terminar. Si ya está analizado, elígelo en la lista que aparece al escribir y se abre sin volver a
          procesarlo. Sirve para verificar un contrato puntual o para una demo: la cola se procesa sola.
        </Ayuda>
      }
      descripcion={
        <span className="inline-flex items-start gap-1.5 text-inkSoft">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
          <span>
            <strong className="font-semibold text-ink">Cada corrida cuesta ≈ S/ 1</strong> y no se acredita a ningún aporte.
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-start gap-3">
        <form onSubmit={despachar} className="relative min-w-0 flex-1 basis-[420px]" role="search">
          <label htmlFor="despachar-convocatoria" className="sr-only">
            Código u OCID de la convocatoria
          </label>
          <Search size={17} aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input
            id="despachar-convocatoria"
            type="text"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setShowSugg(true);
            }}
            onFocus={() => setShowSugg(true)}
            onBlur={() => setTimeout(() => setShowSugg(false), 180)}
            placeholder="Código de convocatoria u OCID"
            autoComplete="off"
            inputMode="search"
            // 16 px: el celular no hace zoom al tocar el campo. A la derecha, el lugar del botón (más corto en el celular).
            className="h-12 w-full rounded-xl border border-line bg-paperSoft pl-11 pr-32 font-mono text-destacado placeholder:font-sans placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20 sm:pr-44"
          />
          <button
            type="submit"
            disabled={!id.trim()}
            className="absolute right-1.5 top-1/2 inline-flex min-h-[40px] -translate-y-1/2 items-center gap-2 rounded-full bg-granate px-4 py-2 text-dato leading-5 font-semibold text-paper transition-colors hover:bg-granate-deep disabled:opacity-50"
          >
            Despachar<span className="hidden sm:inline">&nbsp;agentes</span> <ArrowRight size={15} aria-hidden />
          </button>

          {sugerencias.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-dialog">
              <p className="border-b border-line bg-paperSoft px-4 py-2 text-rotulo font-semibold text-inkSoft">
                {sugerencias.length === 1
                  ? "1 ya analizado: ábrelo sin volver a procesarlo"
                  : `${sugerencias.length} ya analizados: ábrelos sin volver a procesarlos`}
              </p>
              <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                {sugerencias.map((it) => (
                  <li key={it.codigo_convocatoria || it.ocid}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        router.push(hrefAnalisis(it));
                      }}
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-paperDeep"
                    >
                      <ChipNivel it={it} />
                      <span className="min-w-0">
                        <span className="block truncate text-meta font-medium text-ink">{it.objeto}</span>
                        <span className="block truncate text-rotulo text-mute">
                          <span className="font-mono">{codigoCorto(it.codigo_convocatoria || it.ocid)}</span> {it.entidad || "Entidad sin dato"}
                        </span>
                      </span>
                      <ChevronRight size={13} aria-hidden className="text-mute" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>

        <SortearSeace
          onRunNew={(codigo) => {
            setId(codigo);
            void d.despachar(codigo);
          }}
        />
      </div>

      {d.error && (
        <Aviso tono="danger" className="mt-3">
          {d.error}
        </Aviso>
      )}
    </PageSection>
  );
}

/**
 * Los análisis publicados: los filtros viven en la URL (los mismos parámetros que /app/convocatoria:
 * q, riesgo, tipo, zona, orden) vía `Listado`; filtrar, ordenar y contar salen de analisisPublicados.ts.
 */
function Publicados({ items, parcial, fallo, reintentar }: { items: AnalisisPublicado[] | null; parcial: boolean; fallo: string | null; reintentar: () => void }) {
  const ruta = usePathname() || "/admin/analisis";
  const qs = useSearchParams().toString();
  const query = useMemo(() => parseAnalisisQuery(new URLSearchParams(qs)), [qs]);
  const filtrados = useMemo(() => (items ? ordenarAnalisis(filtrarAnalisis(items, query), query) : null), [items, query]);

  return (
    <PageSection
      titulo="Análisis publicados"
      meta={items ? `${fmtNum(items.length)}${parcial ? " más recientes" : ""}` : undefined}
      ayuda={
        <Ayuda titulo="¿Qué lista es esta?">
          Los análisis ya publicados, del más reciente al más antiguo: toca uno para abrir su informe. La lista junta hasta
          los 500 más recientes; uno anterior sigue publicado y se abre por su código.
        </Ayuda>
      }
    >
      {fallo ? (
        <ErrorBanner error={fallo} titulo="No se pudieron cargar los análisis publicados" onReintentar={reintentar} />
      ) : (
        <Listado ruta={ruta} parametros={analisisQueryParams(query)}>
          <div className="space-y-3">
            {items && items.length > 0 && <BarraPublicados items={items} query={query} />}
            <ZonaResultados>
              <DataTable
                columnas={COLUMNAS}
                filas={filtrados}
                // El código de la alerta es único; el de la convocatoria puede repetirse si se releyó.
                claveFila={(it) => `${it.codigo ?? ""}-${codigoDe(it)}`}
                etiqueta="Análisis publicados"
                hrefFila={(it) => hrefAnalisis(it)}
                cargando={!items}
                porPagina={POR_PAGINA}
                compactoMovil
                vacio={
                  items && items.length > 0 ? (
                    <SinResultados query={query} ruta={ruta} />
                  ) : (
                    <EmptyState
                      compacto
                      icono={<FileSearch size={18} />}
                      titulo="Todavía no hay análisis publicados"
                      descripcion="Lo que se lea de la cola o se despache desde aquí aparece en esta lista."
                    />
                  )
                }
              />
            </ZonaResultados>
          </div>
        </Listado>
      )}
    </PageSection>
  );
}

/**
 * La barra de la lista: el buscador y, debajo, riesgo, tipo, zona y orden en UNA fila. En el celular esa fila
 * se desliza de costado (sin barra) en vez de partirse en renglones; desde sm, si no cabe, baja de línea.
 */
function BarraPublicados({ items, query }: { items: AnalisisPublicado[]; query: AnalisisQuery }) {
  const { navegar, pendiente } = useListado();
  const f = useMemo(() => facetasAnalisis(items, query), [items, query]);
  // Sin opciones que lleven a cero, salvo la elegida (se ve con su conteo real).
  const riesgo: OpcionChip<string>[] = [
    { valor: TODOS, etiqueta: "Todos", cuenta: f.riesgoTodas },
    ...NIVELES.filter((n) => f.riesgo[n] > 0 || query.riesgo === n).map((n) => ({ valor: RIESGO_URL[n], etiqueta: NIVEL_CORTO[n], cuenta: f.riesgo[n], tono: TONO_NIVEL[n] })),
  ];

  return (
    <div className="space-y-2">
      <Buscador
        placeholder="Código, objeto, entidad o RUC"
        etiqueta="Buscar por código, OCID, objeto, entidad o RUC"
        valor={query.q ?? ""}
        onBuscar={(v) => navegar({ q: v || undefined })}
      />
      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        <span className="mr-0.5 shrink-0 text-rotulo font-medium text-inkSoft" aria-hidden>
          Riesgo
        </span>
        <FilterChips
          etiqueta="Riesgo"
          className="flex-nowrap"
          opciones={riesgo}
          valor={query.riesgo ? RIESGO_URL[query.riesgo] : TODOS}
          onCambiar={(v) => navegar({ riesgo: v === TODOS ? undefined : v })}
        />
        <Desplegable etiqueta="Tipo de contrato" todas="Todo tipo" valor={query.tipo} opciones={f.tipo} nombres={ETIQUETA_TIPO} onCambio={(v) => navegar({ tipo: v || undefined })} />
        <Desplegable etiqueta="Zona" todas="Toda zona" valor={query.zona} opciones={f.zona} onCambio={(v) => navegar({ zona: v || undefined })} />
        <label className="relative inline-flex shrink-0 items-center">
          <span className="sr-only">Ordenar por</span>
          <ArrowDownUp size={13} className="pointer-events-none absolute left-3 text-mute" aria-hidden />
          <select
            value={query.orden}
            onChange={(e) => navegar({ orden: e.target.value === ORDEN_POR_DEFECTO ? undefined : e.target.value })}
            className="h-[34px] rounded-full border border-line bg-paper pl-8 pr-8 text-meta text-ink transition-colors duration-rapido hover:bg-paperSoft focus:border-granate"
          >
            {ORDENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </label>
        {hayFiltros(query) && (
          <button type="button" onClick={() => navegar({ q: undefined, riesgo: undefined, tipo: undefined, zona: undefined })} className={claseBoton("fantasma", "sm", "shrink-0")}>
            Quitar filtros
          </button>
        )}
        {pendiente && <Loader2 size={15} className="shrink-0 animate-spin text-mute" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * Un filtro de la fila: un desplegable con forma de chip; elegido, en lima. Cada opción con su conteo. `nombres`:
 * cómo se llama un valor elegido que ya no está entre las opciones (lo trajo un enlace), en vez de la clave cruda.
 */
function Desplegable({
  etiqueta,
  todas,
  valor,
  opciones,
  nombres,
  onCambio,
}: {
  etiqueta: string;
  todas: string;
  valor?: string;
  opciones: Opcion[];
  nombres?: Record<string, string>;
  onCambio: (v: string) => void;
}) {
  return (
    <label className={cn("inline-flex shrink-0 items-center rounded-full border bg-paper transition-colors duration-rapido hover:bg-paperSoft focus-within:border-granate", valor ? "border-granate" : "border-line")}>
      <span className="sr-only">{etiqueta}</span>
      <select
        value={valor ?? ""}
        onChange={(e) => onCambio(e.target.value)}
        disabled={!opciones.length && !valor}
        className={cn("h-[34px] max-w-[13rem] truncate rounded-full border-0 bg-transparent pl-3.5 pr-8 text-meta text-ink focus:outline-none focus:ring-0", valor && "font-semibold text-granate")}
      >
        <option value="">{todas}</option>
        {/* El valor elegido puede no estar entre las opciones cruzadas: se agrega para que el desplegable no se vacíe. */}
        {valor && !opciones.some((o) => o.valor === valor) && <option value={valor}>{nombres?.[valor] ?? valor}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta} ({numero(o.n)})
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Las columnas: en escritorio, la anatomía de siempre (riesgo, qué y quién, zona y tipo, adjudicado, señales,
 * leído). En el celular sólo va la principal, en dos renglones (qué se contrató; riesgo, código y entidad): las
 * demás son `soloEscritorio`. Zona y fecha aparecen desde lg y xl, cuando hay lugar.
 */
const COLUMNAS: Columna<AnalisisPublicado>[] = [
  {
    clave: "riesgo",
    titulo: (
      <span className="inline-flex items-center gap-1">
        Riesgo
        <Ayuda titulo="¿Qué es el peso del riesgo?">
          El tramo del puntaje (0 a 100), que suma el peso de cada señal publicada: alto desde {CORTE_ALTA}, medio desde{" "}
          {CORTE_MEDIA}, bajo por debajo. «Sin señales» son los leídos y publicados sin ninguna.
        </Ayuda>
      </span>
    ),
    etiquetaMovil: "Riesgo",
    soloEscritorio: true,
    className: "w-px whitespace-nowrap",
    celda: (it) => <ChipNivel it={it} />,
  },
  { clave: "contrato", titulo: "Contrato", principal: true, className: "max-w-md", celda: (it) => <CeldaContrato it={it} /> },
  {
    clave: "zona",
    titulo: (
      <span className="inline-flex items-center gap-1">
        Zona y tipo
        <Ayuda titulo="¿De dónde sale el tipo?">
          Se deduce de las palabras con que el SEACE describe el objeto (adquisición, servicio, obra, consultoría). Es
          aproximado: una compra «para la obra» puede quedar como obra.
        </Ayuda>
      </span>
    ),
    etiquetaMovil: "Zona y tipo",
    soloEscritorio: true,
    className: "hidden whitespace-nowrap text-rotulo lg:table-cell",
    celda: (it) => (
      <>
        <span className="block text-inkSoft">{it.region || "Zona sin dato"}</span>
        <span className="block text-mute">{ETIQUETA_TIPO[tipoDe(it)]}</span>
      </>
    ),
  },
  {
    clave: "adjudicado",
    titulo: "Adjudicado",
    alinear: "derecha",
    soloEscritorio: true,
    celda: (it) => (Number(it.monto) > 0 ? soles(Number(it.monto)) : <span className="font-sans text-mute">Sin dato</span>),
  },
  { clave: "senales", titulo: "Señales", alinear: "derecha", soloEscritorio: true, celda: (it) => <SenalesCelda it={it} /> },
  {
    clave: "leido",
    titulo: "Leído",
    soloEscritorio: true,
    className: "hidden whitespace-nowrap text-rotulo text-mute xl:table-cell",
    celda: (it) => fechaConAnio(it.analizado_en),
  },
];

/** Qué se contrató y, debajo, código y entidad. En el celular el riesgo encabeza esa línea (en escritorio tiene columna). */
function CeldaContrato({ it }: { it: AnalisisPublicado }) {
  const titulo = String(it.objeto || "").trim() || "Contrato sin objeto registrado";
  return (
    <span className="block min-w-0">
      <span className="block truncate text-dato font-medium leading-5 text-ink" title={titulo}>
        {titulo}
      </span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2 text-rotulo text-mute">
        <span className="shrink-0 md:hidden">
          <ChipNivel it={it} />
        </span>
        <span className="shrink-0 font-mono">{codigoDe(it)}</span>
        <span className="min-w-0 truncate">{it.entidad || "Entidad sin dato"}</span>
      </span>
    </span>
  );
}

/** Señales publicadas del contrato: el total y, debajo, cuántas de cada severidad (ícono y número). */
function SenalesCelda({ it }: { it: AnalisisPublicado }) {
  const n = Number(it.n_banderas) || 0;
  const porSeveridad = { alta: Number(it.n_alta) || 0, media: Number(it.n_media) || 0, baja: Number(it.n_baja) || 0 };
  const partes = (["alta", "media", "baja"] as const).filter((k) => porSeveridad[k] > 0);
  return (
    <span className="block">
      <span className={n > 0 ? "text-ink" : "text-mute"}>{numero(n)}</span>
      {partes.length > 0 && (
        <span className="mt-0.5 flex items-center justify-end gap-1.5 text-rotulo text-mute">
          {partes.map((k) => (
            <span key={k} className="inline-flex items-center gap-0.5">
              <Severidad bandera={k} formato="punto" />
              {numero(porSeveridad[k])}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** Filtrado vacío ≠ todavía no hay datos: con texto escrito, lo más probable es que ese contrato no se haya leído. */
function SinResultados({ query, ruta }: { query: AnalisisQuery; ruta: string }) {
  const q = query.q?.trim();
  const codigo = q ? codigoDe({ ocid: q }) : "";
  const pareceCodigo = !!q && /^(ocds-|oece-)?[\w-]*\d{5,}$/i.test(q);
  return (
    <EmptyState
      compacto
      titulo={q ? `Ningún análisis publicado coincide con «${q}»` : "Ningún análisis coincide con los filtros"}
      descripcion={q ? "Si todavía no se leyó, despáchalo desde el campo de arriba." : "Prueba quitando el último filtro que agregaste."}
      accion={
        <>
          {/* La lista trae los más recientes: por su código, el informe dice si existe. */}
          {pareceCodigo && (
            <Link href={rutaContrato(codigo, "dictamen")} className={claseBoton("secundario", "xs")}>
              Abrir el informe de {codigo}
            </Link>
          )}
          {q && (
            <Link href={`/app/contratos?q=${encodeURIComponent(codigo)}`} className={claseBoton("secundario", "xs")}>
              Buscarlo entre los contratos
            </Link>
          )}
          {hayFiltros(query) && (
            <Link href={ruta} className={claseBoton("secundario", "xs")}>
              Quitar los filtros
            </Link>
          )}
        </>
      }
    />
  );
}
