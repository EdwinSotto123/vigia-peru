import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { Ayuda, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import {
  BarraFiltros,
  CeldaFecha,
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
import { fechaCorta, numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { SENAL_PLAZA, TIPOS_PLAZA, getPlazas, type PaginaPlazas, type Plaza, type TipoPlaza } from "@/lib/planilla";
import { SEVERIDAD_TEXTO } from "@/lib/personas";
import { VARIANTE_SEVERIDAD } from "./SenalesPersona";
import { uno } from "@/lib/utils";

const TAM = 20;
type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Los filtros de las plazas en la URL, con `z` delante. */
export const P_PLAZAS = { senal: "zsenal", severidad: "zsev", orden: "zord", page: "zpag", q: "zq" } as const;

/**
 * Las plazas CAS de un alcance (una entidad, una región o todo el país), de SERVIR Talento Perú, con sus señales de
 * plaza a la medida por fila; cada fila abre sus requisitos. Server component.
 */
export function ListaPlazas({ alcance, sp, ruta, base, deEntidad = false }: { alcance: { entidad?: string; dep?: string }; sp: Busqueda; ruta: string; base: Parametros; deEntidad?: boolean }) {
  const P = P_PLAZAS;
  const senal = uno(sp?.[P.senal]);
  const sev = uno(sp?.[P.severidad]);
  const orden = uno(sp?.[P.orden]);
  const q = uno(sp?.[P.q])?.slice(0, 80);
  const f = {
    senal: senal && (TIPOS_PLAZA as readonly string[]).includes(senal) ? senal : undefined,
    severidad: sev && ["alta", "media", "baja", "con", "sin"].includes(sev) ? sev : undefined,
    orden: orden && ["senales", "reciente", "sueldo"].includes(orden) ? orden : undefined,
    q: q && q.length >= 2 ? q : undefined,
    page: Math.max(1, Number(uno(sp?.[P.page])) || 1),
  };
  const paginaP = getPlazas({ ...alcance, ...f, size: TAM });
  const parametros: Parametros = { ...base, [P.senal]: f.senal, [P.severidad]: f.severidad, [P.orden]: f.orden, [P.q]: f.q };
  const filtrada = !!(f.senal || f.severidad || f.q);
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

async function Cifras({ pagina }: { pagina: Promise<PaginaPlazas | null> }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  const items: Indicador[] = [
    { valor: numero(r.plazas), etiqueta: "plazas CAS publicadas", contexto: r.desde ? `desde el ${fechaCorta(r.desde)}` : undefined },
    { valor: numero(r.vacantes), etiqueta: "vacantes" },
    { valor: r.medianaSueldo != null ? soles(r.medianaSueldo) : null, etiqueta: "sueldo mediano", contexto: "la mitad paga menos" },
    { valor: numero(r.conSenales), etiqueta: "con alguna señal", contexto: "de plaza a la medida", tono: r.conSenales > 0 ? "media" : "neutro" },
  ];
  return <Indicadores items={items} />;
}

async function BarraAsync({ pagina }: { pagina: Promise<PaginaPlazas | null> }) {
  return <Barra r={(await pagina)?.resumen ?? null} />;
}

function Barra({ r }: { r: PaginaPlazas["resumen"] | null }) {
  const P = P_PLAZAS;
  return (
    <BarraFiltros
      busqueda={{ param: P.q, placeholder: "Buscar por puesto, entidad o lugar…", etiqueta: "Buscar en las plazas CAS", min: 3 }}
      faceta={{
        param: P.severidad,
        etiqueta: "Señales",
        todas: "Todas",
        conteoTodas: r?.plazas ?? null,
        nombreEnChip: false,
        opciones: [
          { valor: "con", etiqueta: "Con señales", conteo: r?.conSenales ?? null },
          { valor: "sin", etiqueta: "Sin señales", conteo: r ? r.plazas - r.conSenales : null },
        ],
      }}
      visibles={[
        {
          param: P.senal,
          etiqueta: "Señal",
          corta: "Señal",
          todas: "Toda señal",
          opciones: (r?.porSenal ?? []).map((s) => ({ valor: s.tipo, etiqueta: SENAL_PLAZA[s.tipo]?.corto ?? s.tipo, conteo: s.n })),
        },
      ]}
      orden={{ param: P.orden, porDefecto: "senales", opciones: [{ valor: "senales", etiqueta: "Más señales" }, { valor: "reciente", etiqueta: "Más recientes" }, { valor: "sueldo", etiqueta: "Mayor sueldo" }] }}
    />
  );
}

const columnas = (deEntidad: boolean): Columna[] => [
  { clave: "fecha", titulo: "Publicada", ancho: "92px", desde: "md" },
  { clave: "plaza", titulo: "Plaza", ancho: "minmax(0,1.6fr)" },
  {
    clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas señales?">
        Rasgos de una plaza hecha a la medida de alguien: pide experiencia en la propia entidad, paga mucho y pide poco,
        estuvo publicada muy poco tiempo, paga el doble que plazas parecidas o la entidad ya pagaba ese trabajo por órdenes.
        No prueban un direccionamiento.
      </Ayuda>
    ),
  },
  { clave: "sueldo", titulo: "Sueldo", ancho: "108px", alinear: "der" },
];

async function Resultados(props: { pagina: Promise<PaginaPlazas | null>; parametros: Parametros; ruta: string; actual: number; deEntidad: boolean; filtrada: boolean }) {
  const pagina = await props.pagina;
  if (!pagina) return <EstadoError titulo="No pudimos cargar las plazas">Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>;
  if (!pagina.total) {
    return props.filtrada ? (
      <EstadoVacio compacto titulo="Ninguna plaza coincide con estos filtros">Quita el filtro más restrictivo.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Sin plazas CAS cargadas">No encontramos plazas de esta entidad en SERVIR Talento Perú desde que las guardamos.</EstadoVacio>
    );
  }
  const pag = (
    <Paginacion actual={props.actual} paginas={Math.max(1, Math.ceil(pagina.total / pagina.size))} total={pagina.total} tam={pagina.size}
      navegacion="url" hrefBase={props.ruta} query={props.parametros} paramPagina={P_PLAZAS.page} cargando={false} nombre="plazas" />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">{plural(pagina.total, "plaza", "plazas")}{props.filtrada ? " con estos filtros" : ""}</p>
        {pag}
      </div>
      <Tabla columnas={columnas(props.deEntidad)} filas={pagina.data.map((p) => fila(p, props.deEntidad))} etiqueta="Plazas CAS" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function fila(p: Plaza, deEntidad: boolean): Fila {
  const titulo = oracion(p.titulo.replace(/^CONTRATACI[OÓ]N ADMINISTRATIVA DE SERVICIOS DE UN\(A\)\s*/i, ""));
  const datos: DatoClave[] = [
    { etiqueta: "Entidad", valor: p.entidadRuc ? <Link href={`/entidad/${p.entidadRuc}`} className="text-granate hover:underline">{tituloNatural(p.entidad)}</Link> : tituloNatural(p.entidad) },
    { etiqueta: "Convocatoria", valor: p.numero, mono: true },
    { etiqueta: "Vacantes", valor: p.vacantes != null ? numero(p.vacantes) : null },
    { etiqueta: "Sueldo", valor: p.remuneracion != null ? soles(p.remuneracion) : null, mono: true },
    { etiqueta: "Publicada", valor: [p.fechaInicio && fechaCorta(p.fechaInicio), p.fechaFin && fechaCorta(p.fechaFin)].filter(Boolean).join(" al ") || null },
    { etiqueta: "Experiencia", valor: p.experiencia },
    { etiqueta: "Formación", valor: p.formacion },
    { etiqueta: "Especialización", valor: p.especializacion },
    { etiqueta: "Conocimientos", valor: p.conocimiento },
  ];
  return {
    id: String(p.aviso),
    celdas: {
      fecha: <CeldaFecha fecha={p.fechaInicio} />,
      plaza: (
        <CeldaPrincipal
          titulo={titulo}
          dosLineas
          meta={[
            deEntidad
              ? p.servicio && <Dato key="servicio" tipo="servicio">{p.servicio}</Dato>
              : <Dato key="entidad" tipo="entidad">{tituloNatural(p.entidad)}</Dato>,
            p.ubicacion && <Dato key="lugar" tipo="lugar">{tituloNatural(p.ubicacion)}</Dato>,
          ]}
        />
      ),
      senales: p.senales.length ? (
        <ul className="flex flex-wrap gap-1">
          {p.senales.slice(0, 3).map((s) => (
            <li key={s.tipo} title={SENAL_PLAZA[s.tipo]?.explica}>
              <Badge variant={VARIANTE_SEVERIDAD[s.severidad]}>{SENAL_PLAZA[s.tipo]?.corto ?? s.tipo}</Badge>
            </li>
          ))}
          {p.senales.length > 3 && (
            <li title={p.senales.slice(3).map((s) => SENAL_PLAZA[s.tipo]?.corto ?? s.tipo).join(", ")}>
              <Badge variant="neutral">{`+${p.senales.length - 3}`}</Badge>
            </li>
          )}
        </ul>
      ) : (
        <span className="text-meta text-mute">Ninguna</span>
      ),
      sueldo: <CeldaNumero sub={p.vacantes && p.vacantes > 1 ? plural(p.vacantes, "vacante", "vacantes") : undefined}>{p.remuneracion != null ? soles(p.remuneracion) : "Sin dato"}</CeldaNumero>,
    },
    detalle: {
      titulo,
      etiqueta: `Ver los requisitos de la plaza ${p.aviso}`,
      descripcion: <span className="font-mono">Aviso {p.aviso}</span>,
      contenido: (
        <div className="space-y-4">
          {p.senales.map((s) => (
            <div key={s.tipo} className="space-y-1.5 rounded-xl border border-line bg-paperSoft p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={VARIANTE_SEVERIDAD[s.severidad]}>{SEVERIDAD_TEXTO[s.severidad]}</Badge>
                <span className="text-dato font-semibold text-ink">{SENAL_PLAZA[s.tipo]?.titulo ?? s.tipo}</span>
              </div>
              <p className="text-meta text-inkSoft">{SENAL_PLAZA[s.tipo]?.explica}</p>
              <DetallePlaza tipo={s.tipo} d={s.detalle} />
            </div>
          ))}
          <DatosClave items={datos} />
        </div>
      ),
      pie: (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-rotulo text-mute">Fuente: SERVIR, Talento Perú (aviso {p.aviso})</span>
          {p.detalleUrl && (
            <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[40px] items-center gap-1.5 text-meta font-semibold text-granate hover:underline">
              Ver la convocatoria en la entidad <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </span>
      ),
    },
  };
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);

function DetallePlaza({ tipo, d }: { tipo: TipoPlaza; d: Record<string, unknown> }) {
  let items: DatoClave[] = [];
  if (tipo === "plazo_corto") items = [{ etiqueta: "Días publicada", valor: n(d.dias) != null ? numero(n(d.dias)) : null }];
  else if (tipo === "sueldo_alto") items = [{ etiqueta: "Mediana de plazas parecidas", valor: n(d.mediana) != null ? `${soles(n(d.mediana))} (${numero(n(d.plazas) ?? 0)} plazas)` : null }];
  else if (tipo === "ya_hay_locadores") items = [{ etiqueta: "Locadores de ese servicio", valor: n(d.personas) != null ? plural(n(d.personas) ?? 0, "persona", "personas") : null }];
  else if (tipo === "pide_poco") items = [{ etiqueta: "Experiencia general pedida", valor: n(d.exp_general) != null ? `${String(n(d.exp_general)).replace(".", ",")} años` : "No la pide" }];
  return items.length ? <DatosClave items={items} /> : null;
}
