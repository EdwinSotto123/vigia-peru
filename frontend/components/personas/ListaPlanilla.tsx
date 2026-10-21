import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Ayuda, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
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
import { Paginacion } from "@/components/ui/Paginacion";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { REGIMEN, SENAL_PLANILLA, TIPOS_PLANILLA, getPlanilla, type PaginaPlanilla, type PersonaPlanilla, type TipoPlanilla } from "@/lib/planilla";
import { SEVERIDAD_TEXTO } from "@/lib/personas";
import { VARIANTE_SEVERIDAD } from "./SenalesPersona";

const TAM = 20;
type Busqueda = Record<string, string | string[] | undefined> | undefined;
const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Los filtros de la planilla en la URL: con `l` delante (no chocan con los de los contratos ni los de las personas). */
export const P_PLANILLA = { senal: "lsenal", severidad: "lsev", regimen: "lreg", orden: "lord", page: "lpag" } as const;

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
  const f = {
    senal: senal && (TIPOS_PLANILLA as readonly string[]).includes(senal) ? senal : undefined,
    severidad: sev && ["alta", "media", "baja", "con", "sin"].includes(sev) ? sev : undefined,
    regimen: REGIMEN[reg] ? reg : undefined,
    orden: orden && ["senales", "sueldo", "meses"].includes(orden) ? orden : undefined,
    page: Math.max(1, Number(uno(sp?.[P.page])) || 1),
  };
  const paginaP = getPlanilla({ ...alcance, ...f, size: TAM });
  const parametros: Parametros = { ...base, [P.senal]: f.senal, [P.severidad]: f.severidad, [P.regimen]: f.regimen ? String(f.regimen) : undefined, [P.orden]: f.orden };
  const filtrada = !!(f.senal || f.severidad || f.regimen);
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
    { valor: solesCompacto(r.totalMes), etiqueta: "al mes", contexto: "suma de su último mes publicado" },
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
  { clave: "regimen", titulo: "Régimen", ancho: "112px", desde: "lg" },
  { clave: "total", titulo: deEntidad ? "Sueldo del mes" : "Sueldo", ancho: "112px", alinear: "der" },
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
        <p className="text-[13px] text-inkSoft">{plural(pagina.total, "persona", "personas")}{props.filtrada ? " con estos filtros" : ""}</p>
        {pag}
      </div>
      <Tabla columnas={columnas(props.deEntidad)} filas={pagina.data.map((p) => fila(p, props.deEntidad))} etiqueta="Personal en planilla" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function Chips({ senales }: { senales: PersonaPlanilla["senales"] }) {
  if (!senales?.length) return <span className="text-[12.5px] text-mute">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
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
  const datos: DatoClave[] = [
    { etiqueta: "Cargo", valor: p.cargo ? tituloNatural(p.cargo) : null },
    { etiqueta: "Oficina", valor: p.dependencia ? tituloNatural(p.dependencia) : null },
    { etiqueta: "Régimen", valor: p.regimen ? REGIMEN[p.regimen] ?? String(p.regimen) : null },
    { etiqueta: "Sueldo del último mes", valor: p.total != null ? soles(p.total) : null, mono: true },
    { etiqueta: "Meses en planilla", valor: `${numero(p.meses)} (${[p.primerMes, p.ultimoMes].filter(Boolean).join(" a ")})` },
    ...(!deEntidad && entidad ? [{ etiqueta: "Entidad", valor: <Link href={`/entidad/${p.entidadRuc}`} className="text-granate hover:underline">{entidad}</Link> }] : []),
  ];
  return {
    id: `${p.entidadRuc}-${p.nombre}-${p.ultimoMes}`,
    celdas: {
      persona: <CeldaPrincipal titulo={p.nombre} meta={deEntidad ? [p.cargo ? tituloNatural(p.cargo) : null, p.dependencia ? tituloNatural(p.dependencia) : null] : [p.cargo ? tituloNatural(p.cargo) : null, entidad]} />,
      senales: <Chips senales={p.senales} />,
      regimen: <span className="text-[13px] text-inkSoft">{p.regimen ? REGIMEN[p.regimen] ?? p.regimen : "Sin dato"}</span>,
      total: <CeldaNumero sub={p.ultimoMes ?? undefined}>{p.total != null ? soles(p.total) : "Sin dato"}</CeldaNumero>,
    },
    detalle: {
      titulo: p.nombre,
      etiqueta: `Ver el detalle de ${p.nombre}`,
      descripcion: p.cargo ? tituloNatural(p.cargo) : undefined,
      contenido: (
        <div className="space-y-4">
          <DatosClave items={datos} />
          {p.senales.map((s) => (
            <div key={s.tipo} className="space-y-1.5 rounded-xl border border-line bg-paperSoft p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={VARIANTE_SEVERIDAD[s.severidad]}>{SEVERIDAD_TEXTO[s.severidad]}</Badge>
                <span className="text-[14px] font-semibold text-ink">{SENAL_PLANILLA[s.tipo]?.titulo ?? s.tipo}</span>
              </div>
              <p className="text-[13px] text-inkSoft">{SENAL_PLANILLA[s.tipo]?.explica}</p>
              <DetalleSenal tipo={s.tipo} d={s.detalle} />
            </div>
          ))}
        </div>
      ),
      pie: (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-mute">Fuente: Portal de Transparencia Estándar, rubro Personal</span>
          {p.codigo && (
            <Link href={`/app/personas/${p.codigo}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-1.5 text-[13px] font-semibold text-paper hover:bg-granate-deep">
              Ver sus órdenes de servicio <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </span>
      ),
    },
  };
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

function DetalleSenal({ tipo, d }: { tipo: TipoPlanilla; d: Record<string, unknown> }) {
  let items: DatoClave[] = [];
  if (tipo === "brecha_cargo") {
    items = [
      { etiqueta: "Su sueldo", valor: n(d.total) != null ? soles(n(d.total)) : null, mono: true },
      { etiqueta: "Mediana de su cargo", valor: n(d.mediana) != null ? `${soles(n(d.mediana))} (${numero(n(d.personas) ?? 0)} personas)` : null },
      { etiqueta: "Diferencia", valor: n(d.veces) != null ? `${String(n(d.veces)).replace(".", ",")} veces` : null },
    ];
  } else if (tipo === "tambien_ordenes") {
    items = [
      { etiqueta: "Meses con las dos cosas", valor: lista(d.meses).map(String).join(", ") || null },
      { etiqueta: "Órdenes esos meses", valor: n(d.ordenes) != null ? `${numero(n(d.ordenes) ?? 0)} por ${soles(n(d.monto) ?? 0)}` : null },
    ];
  } else if (tipo === "antes_locador") {
    items = [
      { etiqueta: "Primera orden", valor: t(d.primera_orden)?.slice(0, 10) ?? null },
      { etiqueta: "Entró a la planilla", valor: t(d.primer_mes_planilla)?.slice(0, 7) ?? null },
    ];
  } else if (tipo === "apellidos_autoridad") {
    items = lista(d.autoridades).map((a, i) => ({ etiqueta: t(a.cargo) ? tituloNatural(t(a.cargo)!) : `Autoridad ${i + 1}`, valor: [t(a.nombre), t(a.partido)].filter(Boolean).join(", ") }));
  } else if (tipo === "apellidos_directivo") {
    items = lista(d.funcionarios_designados).map((f, i) => ({ etiqueta: t(f.cargo) ? tituloNatural(t(f.cargo)!) : `Directivo ${i + 1}`, valor: t(f.nombre) }));
  } else if (tipo === "candidato_gobierna") {
    items = [
      { etiqueta: "Partido que gobierna", valor: t(d.partido) },
      ...lista(d.candidaturas).map((c, i) => ({ etiqueta: `Candidatura ${i + 1}`, valor: [t(c.anio), t(c.cargo) ? tituloNatural(t(c.cargo)!) : null, t(c.partido)].filter(Boolean).join(", ") })),
    ];
  }
  return items.length ? <DatosClave items={items} /> : null;
}
