import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, PieDetalle, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
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
  type FiltroSecundario,
  type Fila,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { Paginacion } from "@/components/ui/Paginacion";
import { fechaCorta, numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { SENAL_PLAZA, TIPOS_PLAZA, getPlazas, type PaginaPlazas, type Plaza, type TipoPlaza } from "@/lib/planilla";
import { peorSeveridad } from "@/lib/severidad";
import { uno } from "@/lib/utils";

const TAM = 20;
type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Los filtros de las plazas en la URL, con `z` delante. */
export const P_PLAZAS = { senal: "zsenal", severidad: "zsev", orden: "zord", page: "zpag", q: "zq" } as const;

/** La etiqueta corta de cada señal para la celda (`CrucesCelda`, una línea con su ícono de severidad). */
const CORTO_PLAZA = Object.fromEntries(TIPOS_PLAZA.map((t) => [t, SENAL_PLAZA[t].corto]));
/** Y su explicación (title del chip): la de la señal de la plaza. */
const EXPLICA_PLAZA = Object.fromEntries(TIPOS_PLAZA.map((t) => [t, SENAL_PLAZA[t].explica]));

/**
 * Las plazas CAS de un alcance (una entidad, una región o todo el país), de SERVIR Talento Perú, con sus señales de
 * plaza a la medida por fila; cada fila abre sus requisitos. La severidad, con el vocabulario de todo el producto
 * (`Severidad`: «Señal alta / media / baja», color, ícono y palabra), no «Grave / Para revisar / Dato». Server component.
 */
export function ListaPlazas({
  alcance,
  sp,
  ruta,
  base,
  deEntidad = false,
  visiblesExtra = [],
}: {
  alcance: { entidad?: string; dep?: string };
  sp: Busqueda;
  ruta: string;
  base: Parametros;
  deEntidad?: boolean;
  /** Filtros del alcance a la vista (la región en /app/personas). Sus valores ya vienen en `base`. */
  visiblesExtra?: FiltroSecundario[];
}) {
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
  const filtrada = !!(f.senal || f.severidad || f.q) || visiblesExtra.some((x) => !!base[x.param]);
  // La entidad que llega de su ficha: un chip que se quita (en la ficha de la propia entidad, no: es el alcance).
  const entidad = !deEntidad && alcance.entidad ? alcance.entidad : undefined;
  return (
    <div className="space-y-4">
      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras pagina={paginaP} ruta={ruta} base={base} />
      </Suspense>
      <Listado ruta={ruta} parametros={parametros} paramPagina={P.page}>
        <Suspense fallback={<Barra r={null} visiblesExtra={visiblesExtra} entidad={entidad ? { ruc: entidad, nombre: null } : null} />}>
          <BarraAsync pagina={paginaP} visiblesExtra={visiblesExtra} entidad={entidad} />
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

async function Cifras({ pagina, ruta, base }: { pagina: Promise<PaginaPlazas | null>; ruta: string; base: Parametros }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) q.set(k, String(v));
    return `${ruta}?${q.toString()}`;
  };
  const items: Indicador[] = [
    { valor: numero(r.plazas), etiqueta: "plazas CAS publicadas", contexto: r.desde ? `desde el ${fechaCorta(r.desde)}` : undefined, ayuda: <AyudaTermino clave="cas" /> },
    { valor: numero(r.vacantes), etiqueta: "vacantes", contexto: `en ${numero(r.plazas)} plazas` },
    { valor: r.medianaSueldo != null ? soles(r.medianaSueldo) : null, etiqueta: "sueldo mediano", contexto: `de ${numero(r.plazas)} plazas; la mitad paga menos`, ayuda: <AyudaTermino clave="mediana" /> },
    { valor: numero(r.conSenales), etiqueta: "con alguna señal", contexto: `de ${numero(r.plazas)} (plaza a la medida)`, tono: r.conSenales > 0 ? "media" : "neutro", href: href({ [P_PLAZAS.severidad]: "con" }) },
  ];
  return <Indicadores items={items} />;
}

async function BarraAsync({ pagina, visiblesExtra, entidad }: { pagina: Promise<PaginaPlazas | null>; visiblesExtra: FiltroSecundario[]; entidad?: string }) {
  const pg = await pagina;
  const nombre = entidad ? pg?.data.find((x) => x.entidadRuc === entidad)?.entidad ?? null : null;
  return <Barra r={pg?.resumen ?? null} visiblesExtra={visiblesExtra} entidad={entidad ? { ruc: entidad, nombre } : null} />;
}

function Barra({ r, visiblesExtra, entidad }: { r: PaginaPlazas["resumen"] | null; visiblesExtra: FiltroSecundario[]; entidad: { ruc: string; nombre: string | null } | null }) {
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
        ...visiblesExtra,
        {
          param: P.senal,
          etiqueta: "Señal",
          corta: "Señal",
          todas: "Toda señal",
          opciones: (r?.porSenal ?? []).map((s) => ({ valor: s.tipo, etiqueta: SENAL_PLAZA[s.tipo]?.corto ?? s.tipo, conteo: s.n })),
        },
      ]}
      filtros={
        entidad
          ? [{ param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", opciones: [{ valor: entidad.ruc, etiqueta: entidad.nombre ? tituloNatural(entidad.nombre) : `RUC ${entidad.ruc}` }] }]
          : []
      }
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
  const paginas = Math.max(1, Math.ceil(pagina.total / pagina.size));
  const pag = (subir: boolean) => (
    <Paginacion actual={props.actual} paginas={paginas} total={pagina.total} tam={pagina.size}
      navegacion="url" hrefBase={props.ruta} query={props.parametros} paramPagina={P_PLAZAS.page} cargando={false} nombre="plazas" subir={subir} />
  );
  // Sin la línea suelta «N plazas»: el total ya lo dicen el chip «Todas» y el paginador.
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={columnas(props.deEntidad)} filas={pagina.data.map((p) => fila(p, props.deEntidad))} etiqueta="Plazas CAS" />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
    </div>
  );
}

function fila(p: Plaza, deEntidad: boolean): Fila {
  const titulo = oracion(p.titulo.replace(/^CONTRATACI[OÓ]N ADMINISTRATIVA DE SERVICIOS DE UN\(A\)\s*/i, ""));
  const entidad = tituloNatural(p.entidad);
  const datos: DatoClave[] = [
    { etiqueta: "Entidad", valor: entidad },
    { etiqueta: "Convocatoria", valor: p.numero, mono: true },
    { etiqueta: "Vacantes", valor: p.vacantes != null ? numero(p.vacantes) : null },
    { etiqueta: "Sueldo", valor: p.remuneracion != null ? soles(p.remuneracion) : null, mono: true },
    { etiqueta: "Publicada", valor: [p.fechaInicio && fechaCorta(p.fechaInicio), p.fechaFin && fechaCorta(p.fechaFin)].filter(Boolean).join(" al ") || null },
    { etiqueta: "Experiencia", valor: p.experiencia },
    { etiqueta: "Formación", valor: p.formacion },
    { etiqueta: "Especialización", valor: p.especializacion },
    { etiqueta: "Conocimientos", valor: p.conocimiento },
  ];
  const peor = peorSeveridad(p.senales);
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
              : <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
            p.ubicacion && <Dato key="lugar" tipo="lugar">{tituloNatural(p.ubicacion)}</Dato>,
          ]}
        />
      ),
      senales: p.senales.length ? <CrucesCelda cruces={p.senales} etiquetas={CORTO_PLAZA} explicaciones={EXPLICA_PLAZA} etiquetaLista="Señales de la plaza" /> : <span className="text-meta text-mute">Sin señales</span>,
      sueldo: <CeldaNumero sub={p.vacantes && p.vacantes > 1 ? plural(p.vacantes, "vacante", "vacantes") : undefined}>{p.remuneracion != null ? soles(p.remuneracion) : "Sin dato"}</CeldaNumero>,
    },
    detalle: {
      titulo,
      etiqueta: `Ver los requisitos de la plaza ${p.aviso}`,
      descripcion: <span className="font-mono">Aviso {p.aviso}</span>,
      contenido: (
        // §14.4: chips, datos y un bloque por tema; cada señal con su severidad en color, ícono y palabra.
        <CuerpoDetalle>
          {peor && (
            <ChipsDetalle>
              <Severidad bandera={peor} />
              <span className="text-meta text-inkSoft">{plural(p.senales.length, "señal de plaza a la medida", "señales de plaza a la medida")}</span>
            </ChipsDetalle>
          )}
          {p.senales.length > 0 && (
            <BloqueDetalle titulo="Lo que se encontró">
              <ul className="divide-y divide-line/70">
                {p.senales.map((s) => (
                  <li key={s.tipo} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                    <Severidad bandera={s.severidad} formato="linea" />
                    <p className="text-dato font-semibold leading-snug text-ink">{SENAL_PLAZA[s.tipo]?.titulo ?? s.tipo}</p>
                    {SENAL_PLAZA[s.tipo]?.explica && <p className="text-meta leading-snug text-inkSoft">{SENAL_PLAZA[s.tipo].explica}</p>}
                    <DetallePlaza tipo={s.tipo} d={s.detalle} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-rotulo leading-relaxed text-mute">Cada señal es un indicio de registros públicos para revisar, no una acusación.</p>
            </BloqueDetalle>
          )}
          <BloqueDetalle titulo="La convocatoria">
            <DatosClave items={datos} />
          </BloqueDetalle>
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <>
              {p.detalleUrl && (
                <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={claseAccion("primario")}>
                  Ver la convocatoria <ExternalLink size={14} aria-hidden />
                </a>
              )}
              {p.entidadRuc && (
                <EnlaceAccion href={`/entidad/${p.entidadRuc}`} variante={p.detalleUrl ? "secundario" : "primario"}>
                  La ficha de la entidad
                </EnlaceAccion>
              )}
            </>
          }
          secundarias={<span className="text-rotulo text-mute">Fuente: SERVIR, Talento Perú (aviso {p.aviso})</span>}
        />
      ),
    },
  };
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);

function DetallePlaza({ tipo, d }: { tipo: TipoPlaza; d: Record<string, unknown> }) {
  let items: DatoClave[] = [];
  if (tipo === "plazo_corto") items = [{ etiqueta: "Días publicada", valor: n(d.dias) != null ? numero(n(d.dias)) : null }];
  else if (tipo === "sueldo_alto") items = [{ etiqueta: "Mediana de plazas parecidas", valor: n(d.mediana) != null ? `${soles(n(d.mediana))} (${numero(n(d.plazas) ?? 0)} plazas)` : null, ayuda: <AyudaTermino clave="mediana" /> }];
  else if (tipo === "ya_hay_locadores") items = [{ etiqueta: "Locadores de ese servicio", valor: n(d.personas) != null ? plural(n(d.personas) ?? 0, "persona", "personas") : null, ayuda: <AyudaTermino clave="locacion" /> }];
  else if (tipo === "pide_poco") items = [{ etiqueta: "Experiencia general pedida", valor: n(d.exp_general) != null ? `${String(n(d.exp_general)).replace(".", ",")} años` : "No la pide" }];
  return items.length ? <DatosClave items={items} /> : null;
}
