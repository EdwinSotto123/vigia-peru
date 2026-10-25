import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Ayuda, AyudaTermino, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaNumero,
  CeldaPrincipal,
  Indicadores,
  IndicadoresSkeleton,
  Listado,
  Tabla,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type Fila,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { REGIMEN, SENAL_PLANILLA, TIPOS_PLANILLA, getPlanilla, rutaPlanilla, type PaginaPlanilla, type PersonaPlanilla } from "@/lib/planilla";
import { SenalesPlanillaLista } from "./SenalesPlanilla";
import { VARIANTE_SEVERIDAD } from "./SenalesPersona";
import { uno } from "@/lib/utils";

const TAM = 20;
type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Los filtros de la planilla en la URL: con `l` delante (no chocan con los de los contratos ni los de las personas). */
export const P_PLANILLA = { senal: "lsenal", severidad: "lsev", regimen: "lreg", orden: "lord", page: "lpag", q: "lq", dudoso: "ldud" } as const;

/**
 * La planilla de un alcance (una entidad, una región o todo el país): el personal que publican las entidades en su
 * Portal de Transparencia, con sus señales por fila; cada fila abre su detalle. Server component.
 */
export function ListaPlanilla({ alcance, sp, ruta, base, deEntidad = false }: { alcance: { entidad?: string; dep?: string }; sp: Busqueda; ruta: string; base: Parametros; deEntidad?: boolean }) {
  const P = P_PLANILLA;
  const senal = uno(sp?.[P.senal]);
  const sev = uno(sp?.[P.severidad]);
  const reg = Number(uno(sp?.[P.regimen]));
  const orden = uno(sp?.[P.orden]);
  const q = uno(sp?.[P.q])?.slice(0, 80);
  const f = {
    senal: senal && (TIPOS_PLANILLA as readonly string[]).includes(senal) ? senal : undefined,
    severidad: sev && ["alta", "media", "baja", "con", "sin"].includes(sev) ? sev : undefined,
    regimen: REGIMEN[reg] ? reg : undefined,
    orden: orden && ["senales", "sueldo", "meses"].includes(orden) ? orden : undefined,
    q: q && q.length >= 2 ? q : undefined,
    dudoso: uno(sp?.[P.dudoso]) === "si" ? "si" : undefined,
    page: Math.max(1, Number(uno(sp?.[P.page])) || 1),
  };
  const paginaP = getPlanilla({ ...alcance, ...f, size: TAM });
  const parametros: Parametros = {
    ...base, [P.senal]: f.senal, [P.severidad]: f.severidad, [P.regimen]: f.regimen ? String(f.regimen) : undefined, [P.orden]: f.orden,
    [P.q]: f.q, [P.dudoso]: f.dudoso,
  };
  const filtrada = !!(f.senal || f.severidad || f.regimen || f.q || f.dudoso);
  return (
    <div className="space-y-4">
      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras pagina={paginaP} />
      </Suspense>
      <Listado ruta={ruta} parametros={parametros} paramPagina={P.page}>
        <Suspense fallback={<Barra r={null} />}>
          <BarraAsync pagina={paginaP} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={columnas(deEntidad)} filas={10} />}>
            <Resultados pagina={paginaP} parametros={parametros} ruta={ruta} actual={f.page} deEntidad={deEntidad} filtrada={filtrada} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

async function Cifras({ pagina }: { pagina: Promise<PaginaPlanilla | null> }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  const items: Indicador[] = [
    { valor: numero(r.personas), etiqueta: "personas en planilla", contexto: r.ultimoMes ? `hasta ${r.ultimoMes}` : undefined },
    {
      valor: solesCompacto(r.totalMes),
      etiqueta: "al mes",
      contexto: r.dudosos
        ? `suma de su último mes publicado; aparte, ${plural(r.dudosos, "sueldo", "sueldos")} con posible error de la entidad`
        : "suma de su último mes publicado",
    },
    { valor: numero(r.conSenales), etiqueta: "con alguna señal", contexto: "lo que dicen otros registros" },
    { valor: numero(r.alta), etiqueta: "con una señal grave", contexto: "cobran también por órdenes, candidatos del que gobierna", tono: r.alta > 0 ? "alta" : "neutro" },
  ];
  return <Indicadores items={items} />;
}

async function BarraAsync({ pagina }: { pagina: Promise<PaginaPlanilla | null> }) {
  return <Barra r={(await pagina)?.resumen ?? null} />;
}

function Barra({ r }: { r: PaginaPlanilla["resumen"] | null }) {
  const P = P_PLANILLA;
  return (
    <BarraFiltros
      busqueda={{ param: P.q, placeholder: "Buscar por nombre, cargo, oficina o entidad…", etiqueta: "Buscar en la planilla", min: 3 }}
      faceta={{
        param: P.severidad,
        etiqueta: "Señales",
        todas: "Todas",
        conteoTodas: r?.personas ?? null,
        nombreEnChip: false,
        opciones: [
          { valor: "con", etiqueta: "Con señales", conteo: r?.conSenales ?? null },
          { valor: "alta", etiqueta: "Graves", conteo: r?.alta ?? null, tono: "alta", icono: "alerta" },
          { valor: "media", etiqueta: "Para revisar", conteo: r?.media ?? null, tono: "media", icono: "atencion" },
        ],
      }}
      visibles={[
        {
          param: P.senal,
          etiqueta: "Señal",
          corta: "Señal",
          todas: "Toda señal",
          opciones: (r?.porSenal ?? []).map((s) => ({ valor: s.tipo, etiqueta: SENAL_PLANILLA[s.tipo]?.corto ?? s.tipo, conteo: s.n })),
        },
        {
          param: P.regimen,
          etiqueta: "Régimen",
          corta: "Régimen",
          todas: "Todo régimen",
          opciones: (r?.porRegimen ?? []).filter((x) => x.regimen != null).map((x) => ({ valor: String(x.regimen), etiqueta: REGIMEN[x.regimen!] ?? String(x.regimen), conteo: x.n })),
        },
      ]}
      filtros={[
        {
          param: P.dudoso,
          etiqueta: "Calidad del dato",
          todas: "Todos los datos",
          opciones: [{ valor: "si", etiqueta: "Con posible error de carga", conteo: r?.dudosos ?? null }],
        },
      ]}
      orden={{ param: P.orden, porDefecto: "senales", opciones: [{ valor: "senales", etiqueta: "Más señales" }, { valor: "sueldo", etiqueta: "Mayor sueldo" }, { valor: "meses", etiqueta: "Más meses" }] }}
    />
  );
}

const columnas = (deEntidad: boolean): Columna[] => [
  { clave: "persona", titulo: "Persona", ancho: "minmax(0,1.3fr)" },
  {
    clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas señales?">
        Lo que otros registros dicen de esta persona: si también cobra por órdenes de servicio, si gana el doble que su mismo
        cargo, si tiene los apellidos de una autoridad o un directivo, si fue candidata del partido que gobierna. No prueban
        nada.
      </Ayuda>
    ),
  },
  { clave: "regimen", titulo: "Régimen", ancho: "112px", desde: "lg", ayuda: <AyudaTermino clave="regimen" /> },
  { clave: "total", titulo: "Sueldo", ancho: "112px", alinear: "der" },
];

async function Resultados(props: { pagina: Promise<PaginaPlanilla | null>; parametros: Parametros; ruta: string; actual: number; deEntidad: boolean; filtrada: boolean }) {
  const pagina = await props.pagina;
  if (!pagina) return <EstadoError titulo="No pudimos cargar la planilla">Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>;
  if (!pagina.total) {
    return props.filtrada ? (
      <EstadoVacio compacto titulo="Nadie coincide con estos filtros">Quita el filtro más restrictivo.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Sin planilla publicada">
        La entidad no publicó su personal en el Portal de Transparencia en los meses cargados, o aún no lo encontramos.
      </EstadoVacio>
    );
  }
  const pag = (
    <Paginacion actual={props.actual} paginas={Math.max(1, Math.ceil(pagina.total / pagina.size))} total={pagina.total} tam={pagina.size}
      navegacion="url" hrefBase={props.ruta} query={props.parametros} paramPagina={P_PLANILLA.page} cargando={false} nombre="personas" />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">{plural(pagina.total, "persona", "personas")}{props.filtrada ? " con estos filtros" : ""}</p>
        {pag}
      </div>
      <Tabla columnas={columnas(props.deEntidad)} filas={pagina.data.map((p) => fila(p, props.deEntidad))} etiqueta="Personal en planilla" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function Chips({ senales, dudoso }: { senales: PersonaPlanilla["senales"]; dudoso: PersonaPlanilla["dudoso"] }) {
  const motivo = motivoDudoso(dudoso?.motivo);
  if (!senales?.length && !motivo) return <span className="text-meta text-mute">Ninguna</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {motivo && (
        <li>
          <BanderaDato motivo={motivo} fuente="pte_personal" />
        </li>
      )}
      {senales.slice(0, 3).map((s) => (
        <li key={s.tipo} title={SENAL_PLANILLA[s.tipo]?.explica}>
          <Badge variant={VARIANTE_SEVERIDAD[s.severidad]}>{SENAL_PLANILLA[s.tipo]?.corto ?? s.tipo}</Badge>
        </li>
      ))}
      {senales.length > 3 && <li><Badge variant="neutral">+{senales.length - 3}</Badge></li>}
    </ul>
  );
}

function fila(p: PersonaPlanilla, deEntidad: boolean): Fila {
  const entidad = p.entidad ? tituloNatural(p.entidad) : null;
  const motivo = motivoDudoso(p.dudoso?.motivo);
  const cargo = p.cargo ? <Dato key="cargo" tipo="cargo">{tituloNatural(p.cargo)}</Dato> : null;
  const oficina = p.dependencia ? <Dato key="oficina" tipo="dependencia" nombre="Oficina">{tituloNatural(p.dependencia)}</Dato> : null;
  const datos: DatoClave[] = [
    { etiqueta: "Cargo", valor: p.cargo ? tituloNatural(p.cargo) : null },
    { etiqueta: "Oficina", valor: p.dependencia ? tituloNatural(p.dependencia) : null },
    { etiqueta: "Régimen", valor: p.regimen ? REGIMEN[p.regimen] ?? String(p.regimen) : null },
    { etiqueta: "Sueldo del último mes", valor: p.base != null ? soles(p.base) : null, mono: true },
    { etiqueta: "Total cobrado ese mes", valor: p.total != null ? soles(p.total) : null, mono: true },
    ...(p.extra ? [{ etiqueta: "Fuera del sueldo", valor: `${soles(p.extra)} (otros beneficios, gratificación, incentivo)` }] : []),
    { etiqueta: "Meses en planilla", valor: `${numero(p.meses)} (${[p.primerMes, p.ultimoMes].filter(Boolean).join(" a ")})` },
    ...(!deEntidad && entidad ? [{ etiqueta: "Entidad", valor: <Link href={`/entidad/${p.entidadRuc}`} className="text-granate hover:underline">{entidad}</Link> }] : []),
  ];
  return {
    id: `${p.entidadRuc}-${p.nombre}-${p.ultimoMes}`,
    ...(p.ficha ? { href: rutaPlanilla(p.ficha) } : {}),
    celdas: {
      persona: (
        <CeldaPrincipal
          titulo={p.nombre}
          meta={deEntidad ? [cargo, oficina] : [cargo, entidad ? <Dato key="entidad" tipo="entidad">{entidad}</Dato> : null]}
        />
      ),
      senales: <Chips senales={p.senales} dudoso={p.dudoso} />,
      regimen: <span className="text-meta text-inkSoft">{p.regimen ? REGIMEN[p.regimen] ?? p.regimen : "Sin dato"}</span>,
      total: motivo ? (
        <CeldaNumero sub="posible error de la entidad">{p.base != null ? soles(p.base) : p.total != null ? soles(p.total) : "Sin dato"}</CeldaNumero>
      ) : (
        <CeldaNumero sub={p.extra && p.total != null && p.total > (p.base ?? 0) ? `${solesCompacto(p.total)} con todo` : p.ultimoMes ?? undefined}>
          {p.base != null ? soles(p.base) : p.total != null ? soles(p.total) : "Sin dato"}
        </CeldaNumero>
      ),
    },
    detalle: p.ficha ? undefined : {
      titulo: p.nombre,
      etiqueta: `Ver el detalle de ${p.nombre}`,
      descripcion: p.cargo ? tituloNatural(p.cargo) : undefined,
      contenido: (
        <div className="space-y-4">
          {motivo && (
            <AvisoDato motivo={motivo} fuente="pte_personal">
              {`Su planilla de ${p.ultimoMes ?? "su último mes"} trae ${p.dudoso?.total != null ? soles(p.dudoso.total) : "un monto"} en total.`}
            </AvisoDato>
          )}
          <DatosClave items={datos} />
          {(p.historia?.length ?? 0) > 1 && (() => {
            // La señal "tambien_ordenes" trae los meses en que además cobró por órdenes de servicio y su monto total.
            const det = p.senales.find((s) => s.tipo === "tambien_ordenes")?.detalle;
            const mesesOrden = Array.isArray(det?.meses) ? (det!.meses as unknown[]).map(String) : [];
            const montoOrden = typeof det?.monto === "number" ? (det!.monto as number) : null;
            return (
              <section className="space-y-2">
                <h3 className="font-display text-bloque font-bold text-ink">Cobros al Estado, mes a mes</h3>
                <LineaMeses
                  puntos={(p.historia ?? []).map((h) => ({ mes: h.mes, base: h.base, extra: h.extra, dudoso: h.dudoso }))}
                  etiqueta={`Cobros al Estado mes a mes de ${p.nombre}`}
                  ordenes={mesesOrden.length ? { meses: mesesOrden, monto: montoOrden } : undefined}
                />
              </section>
            );
          })()}
          {p.senales.length > 0 && <SenalesPlanillaLista senales={p.senales} />}
        </div>
      ),
      pie: (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-rotulo text-mute">Fuente: Portal de Transparencia Estándar, rubro Personal</span>
          {p.codigo && (
            <Link href={`/app/personas/${p.codigo}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-1.5 text-meta font-semibold text-paper hover:bg-granate-deep">
              Ver sus órdenes de servicio <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </span>
      ),
    },
  };
}
