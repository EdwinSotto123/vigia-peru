import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Ayuda, BloqueDetalle, CuerpoDetalle, DatosClave, EstadoVacio, FuenteDato, PieDetalle } from "@/components/patrones";
import { BarraFiltros, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { TIPO_CRUCE } from "@/lib/cruces";
import { fechaCorta, numero, plural, soles } from "@/lib/formato";
import {
  CLARIDAD_ONPE,
  CONOSCE_BUSCADOR,
  CONSULTA_RUC_SUNAT,
  CONTRATACIONES_ABIERTAS,
  DJI_CONSULTA,
  DATASET_PENALIDADES,
  DATASET_SANCIONADOS,
  DATASET_SOCIOS_RNP,
  INFOBRAS,
  PLATAFORMA_JNE,
  VISITAS_EN_LINEA,
  enlacesProceso,
  inversionSsi,
  obraInfobras,
  type EnlaceFuente,
} from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { CORTO_EMPRESA, rutaEmpresa, type AntecedenteEmpresa, type ClienteEmpresa, type ReferenciasAntecedente } from "@/lib/empresas";
import { P_CONTRATOS } from "@/lib/parametrosEmpresa";
import { RANGO_SEVERIDAD, SEVERIDAD, peorSeveridad } from "@/lib/severidad";
import { txtONumero } from "@/lib/utils";
import { NoCargo, paraClave } from "./comun";
import { P_ORDENES } from "./ordenes";
import { aSuGente, datosDe, type DatoCaso } from "./casoAntecedente";
import { EvidenciaDelAntecedente } from "./EvidenciaAntecedente";
import { CON_EVIDENCIA, ENLACE, ValorCaso, VisitasDelCaso } from "./PanelAntecedente";

/** La pestaña Antecedentes: sanciones, penalidades, aportes y demás cruces, como hechos. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Antecedentes ─────────────────────────────────────────────────────────────

const FUENTE: Record<string, string> = {
  onpe_aportantes: "Claridad de la ONPE",
  onpe_candidatos: "Claridad de la ONPE",
  jne_autoridades: "Autoridades electas del JNE",
  penalidades: "Penalidades del OECE",
  osce_sancionados: "Sancionados del Tribunal de Contrataciones",
  visitas_entidades: "Registro de visitas",
  rnp_conformacion_juridica: "Conformación jurídica del RNP",
  onpe_gastos_proveedores: "Gastos de campaña de la ONPE",
  conosce_adjudicaciones: "Adjudicaciones de CONOSCE",
  conosce_contratos: "Contratos de CONOSCE",
  conosce_ordenes: "Órdenes de compra y de servicio de CONOSCE",
  precio_item: "Ítems del OCDS (OECE) y CONOSCE",
  // La obra del contrato (INFOBRAS) y su inversión (Invierte.pe), migración 160.
  infobras: "INFOBRAS (Contraloría)",
  invierte_pe: "Invierte.pe (MEF)",
  // Las fuentes de los cruces más nuevos (antes salía su clave: «sunat», «dji_vinculos»).
  sunat: "Consulta RUC de la SUNAT",
  oece_ocds: "Contrataciones Abiertas del OECE",
  persona_entidad: "Órdenes de servicio de CONOSCE",
  conosce_postores: "Postores de CONOSCE",
  dji: "Declaraciones Juradas de Intereses (Contraloría)",
  dji_vinculos: "Declaraciones Juradas de Intereses (Contraloría)",
};

/**
 * La consulta de cada fuente: el enlace del pie de un tipo cuyos casos van a registros distintos (el de cada caso va en
 * su panel). Si todos van al mismo (la ficha de la empresa en el RNP), el pie lleva a ése.
 */
const PORTADA: Record<string, string> = {
  onpe_aportantes: CLARIDAD_ONPE,
  onpe_candidatos: CLARIDAD_ONPE,
  onpe_gastos_proveedores: CLARIDAD_ONPE,
  jne_autoridades: PLATAFORMA_JNE,
  penalidades: DATASET_PENALIDADES,
  osce_sancionados: DATASET_SANCIONADOS,
  visitas_entidades: VISITAS_EN_LINEA,
  rnp_conformacion_juridica: DATASET_SOCIOS_RNP,
  conosce_adjudicaciones: CONOSCE_BUSCADOR,
  conosce_contratos: CONOSCE_BUSCADOR,
  conosce_ordenes: CONOSCE_BUSCADOR,
  precio_item: CONTRATACIONES_ABIERTAS,
  infobras: INFOBRAS,
  sunat: CONSULTA_RUC_SUNAT,
  oece_ocds: CONTRATACIONES_ABIERTAS,
  persona_entidad: CONOSCE_BUSCADOR,
  conosce_postores: CONOSCE_BUSCADOR,
  dji: DJI_CONSULTA,
  dji_vinculos: DJI_CONSULTA,
};

const txt = txtONumero;

const COLUMNAS_CASOS: Columna[] = [
  { clave: "detalle", titulo: "Qué dice el registro", ancho: "minmax(0,1.6fr)" },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  { clave: "gravedad", titulo: "Severidad", ancho: "112px" },
];

/** El nombre de una entidad como clave para cruzarlo con sus clientes: sin tildes, mayúsculas ni espacios dobles. */
const claveEntidad = (t: string) => paraClave(t).replace(/\s+/g, " ");

/**
 * El RUC de cada entidad cliente por su nombre. Un antecedente trae el nombre de la entidad de su proceso, no su RUC: con
 * el RUC, sus «Órdenes que pasan 8 UIT» llevan a la lista de Órdenes filtrada por esa entidad. Un nombre que tienen dos
 * entidades distintas queda fuera (`null`): no se adivina cuál es.
 */
function rucPorNombre(clientes: ClienteEmpresa[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const c of clientes) {
    if (!c.entidad) continue;
    const k = claveEntidad(c.entidad);
    m.set(k, m.has(k) && m.get(k) !== c.entidadRuc ? null : c.entidadRuc);
  }
  return m;
}

/**
 * Cada tipo de antecedente una vez, numerado (1, 2, 3…), de la señal más alta a la más baja: cuántas veces aparece y con
 * qué severidad, qué quiere decir (en su ⓘ) y cada caso en una tabla paginada (lo que dice el registro, el proceso en que
 * pesa con su evidencia, la fuente). Antes iba un caso por tarjeta: 160 tarjetas casi iguales.
 */
export { P_ANTECEDENTES } from "@/lib/parametrosEmpresa";
import { P_ANTECEDENTES } from "@/lib/parametrosEmpresa";

export async function AntecedentesEmpresa({
  datos,
  clientes,
  ruc,
  tipo: tipoElegido,
  gravedad,
}: {
  datos: Promise<{ total: number; data: AntecedenteEmpresa[] } | null>;
  /** Sus clientes (la misma promesa de la pestaña Clientes): el RUC de la entidad de cada caso, por su nombre. */
  clientes: Promise<{ total: number; data: ClienteEmpresa[] } | null>;
  ruc: string;
  tipo?: string;
  gravedad?: string;
}) {
  const [d, cl] = await Promise.all([datos, clientes]);
  if (!d) return <NoCargo que="sus antecedentes" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Ningún otro registro la nombra">
        No figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de campaña, las autoridades y candidatos,
        ni en los demás cruces de Vigía.
      </EstadoVacio>
    );
  }
  const rucDe = rucPorNombre(cl?.data ?? []);
  // Los conteos de cada opción, sobre el otro filtro (como en las listas del servidor).
  const porGravedad = d.data.filter((a) => !tipoElegido || a.tipo === tipoElegido);
  const porTipo = d.data.filter((a) => !gravedad || a.severidad === gravedad);
  const tiposConteo = [...porTipo.reduce((m, a) => m.set(a.tipo, { n: (m.get(a.tipo)?.n ?? 0) + 1, etiqueta: a.etiqueta }), new Map<string, { n: number; etiqueta: string }>())]
    .sort((a, b) => b[1].n - a[1].n);
  const barra = (
    <BarraFiltros
      faceta={{
        param: P_ANTECEDENTES.gravedad,
        etiqueta: "Severidad",
        todas: "Todas",
        conteoTodas: porGravedad.length,
        nombreEnChip: false,
        opciones: (["alta", "media", "baja"] as const)
          .map((sv) => ({
            valor: sv,
            etiqueta: SEVERIDAD[sv].etiqueta,
            conteo: porGravedad.filter((a) => a.severidad === sv).length,
            tono: sv,
            icono: SEVERIDAD[sv].icono,
          }))
          .filter((o) => o.conteo > 0 || gravedad === o.valor),
      }}
      visibles={[
        {
          param: P_ANTECEDENTES.tipo, etiqueta: "Tipo de antecedente", corta: "Tipo", todas: "Todo tipo",
          opciones: tiposConteo.map(([t, x]) => ({ valor: t, etiqueta: CORTO_EMPRESA[t] ?? TIPO_CRUCE[t]?.corto ?? x.etiqueta, conteo: x.n })),
        },
      ]}
    />
  );
  const vistos = d.data.filter((a) => (!tipoElegido || a.tipo === tipoElegido) && (!gravedad || a.severidad === gravedad));
  if (!vistos.length) {
    return (
      <div className="space-y-3">
        {barra}
        <EstadoVacio compacto titulo="Ningún antecedente con estos filtros">Quita el filtro de tipo o de severidad.</EstadoVacio>
      </div>
    );
  }
  const grupos = new Map<string, AntecedenteEmpresa[]>();
  for (const a of vistos) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const tipos = [...grupos.entries()].sort(
    ([, a], [, b]) => RANGO_SEVERIDAD[peorSeveridad(a) ?? "baja"] - RANGO_SEVERIDAD[peorSeveridad(b) ?? "baja"] || b.length - a.length,
  );
  return (
    <div className="space-y-3">
    {barra}
    <ol className="space-y-3">
      {tipos.map(([tipo, casos], i) => {
        const porSev = (["alta", "media", "baja"] as const).map((sv) => ({ sv, n: casos.filter((c) => c.severidad === sv).length })).filter((x) => x.n);
        const fuente = casos[0]?.fuente;
        const titulo = casos[0].etiqueta;
        const explica = TIPO_CRUCE[tipo]?.explica;
        // El pie del tipo lleva al registro de sus casos si es uno solo para todos (la ficha de la empresa en el RNP); si
        // no, a la consulta de la fuente. Antes llevaba al del primer caso, que no era el de los demás.
        const urls = new Set(casos.map((c) => c.fuenteUrl));
        const enlaceTipo = urls.size === 1 && casos[0].fuenteUrl ? casos[0].fuenteUrl : fuente ? PORTADA[fuente] ?? null : null;
        const filas: Fila[] = casos.map((a, k) => {
          const datos = datosDe(a, ruc);
          // La fila: lo que distingue este caso de los otros del mismo tipo (la entidad y el proceso van en su columna).
          const enFila = datos.filter((x) => !x.soloPanel);
          return {
            id: `${tipo}-${k}`,
            // Cada caso abre su panel: todo lo que dice el registro con la referencia de cada dato, los registros de la
            // fuente y el proceso en que pesa. «Órdenes que pasan 8 UIT»: el caso son órdenes; su panel lleva a esas órdenes.
            detalle: a.tipo === "fraccionamiento" ? detalleFraccionamiento(a, datos, ruc, rucDe) : detalleCaso(a, datos, ruc, explica),
            // Sin nombres de personas (socio, visitante, funcionario): no se buscan (docs/PRIVACIDAD.md).
            buscable: `${datos.filter((x) => !ES_PERSONA.has(x.etiqueta)).map((x) => x.valor).join(" ")} ${a.entidad ?? ""} ${a.codigo ?? ""}`,
            celdas: {
              detalle: (
                <ul className="space-y-0.5 text-meta">
                  {enFila.slice(0, 4).map((x) => (
                    <li key={x.etiqueta} className="min-w-0 break-words">
                      <span className="text-mute">{x.etiqueta}: </span>
                      <span className={x.mono ? "font-mono tabular-nums text-ink" : "text-ink"}>{x.valor}</span>
                    </li>
                  ))}
                  {datos.length > Math.min(4, enFila.length) && (
                    <li className="text-mute">{`Y ${plural(datos.length - Math.min(4, enFila.length), "dato más", "datos más")} en su detalle`}</li>
                  )}
                  {!datos.length && <li className="text-mute">Sin más detalle en el registro</li>}
                </ul>
              ),
              proceso: a.ocid ? (
                <span className="text-meta text-ink">
                  {`Proceso ${a.codigo ?? a.ocid}`}
                  {a.entidad && <span className="block text-inkSoft">{tituloNatural(a.entidad)}</span>}
                </span>
              ) : (
                <span className="text-meta text-mute">De la empresa, no de un proceso</span>
              ),
              gravedad: <Severidad bandera={a.severidad} />,
            },
          };
        });
        return (
          // `tarjeta`: la tabla de sus casos va sin marco propio dentro (antes, una caja con borde dentro de otra).
          <li key={tipo} className="tarjeta flex gap-3 rounded-xl border border-line/80 bg-paperSoft p-3.5">
            <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <h3 className="text-cuerpo font-semibold text-ink">{titulo}</h3>
                  {explica && <Ayuda titulo="¿Qué quiere decir?" etiqueta={`Qué quiere decir «${titulo}»`}>{explica}</Ayuda>}
                </div>
                <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Cuántas veces, por severidad">
                  {porSev.map((x) => (
                    <li key={x.sv} className="inline-flex items-center gap-1.5">
                      <Severidad bandera={x.sv} />
                      <span className="text-meta tabular-nums text-inkSoft">{plural(x.n, "vez", "veces")}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <TablaPaginada
                columnas={COLUMNAS_CASOS}
                filas={filas}
                etiqueta={titulo}
                tam={5}
                nombre="casos"
                densidad="compacta"
                medida="contenedor"
                buscar={{ placeholder: "Buscar por entidad, código o dato…", etiqueta: `Buscar en ${titulo.toLowerCase()}` }}
              />
              <div className="space-y-0.5">
                <FuenteDato fuente={fuente ? FUENTE[fuente] ?? fuente : "Cruces de Vigía"} href={enlaceTipo} />
                <p className="text-rotulo text-mute">
                  {tipo === "fraccionamiento"
                    ? "Cada caso abre sus órdenes, el proceso en que pesa y su fuente."
                    : casos.some((c) => c.ocid)
                      ? "Cada caso abre su detalle con el enlace a su registro oficial y al proceso en que pesa."
                      : "Cada caso abre su detalle con el enlace a su registro oficial."}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
    </div>
  );
}

/**
 * La fuente de un caso, con el enlace a SU registro (la API ya da el más preciso: el proceso en el OECE, la ficha de la
 * empresa en el RNP, el reporte de visitas de su mes) y, debajo, el proceso en que pesa en Contrataciones Abiertas, la
 * obra en INFOBRAS y la inversión en el seguimiento del MEF, si los tiene. Sin repetir el de la fuente.
 */
function FuenteCaso({ a }: { a: AntecedenteEmpresa }) {
  const obra = txt(a.detalle.obra);
  const cui = txt(a.detalle.cui);
  const todos: EnlaceFuente[] = [
    ...(a.ocid ? enlacesProceso(a.ocid, { codigo: a.codigo }) : []),
    ...(obra ? [{ texto: `La obra ${obra} en INFOBRAS`, href: obraInfobras(obra) }] : []),
    ...(cui ? [{ texto: `La inversión ${cui} en el seguimiento del MEF`, href: inversionSsi(cui) }] : []),
  ];
  const enlaces = todos.filter((x, i) => x.href !== a.fuenteUrl && todos.findIndex((y) => y.href === x.href) === i);
  return <FuenteDato fuente={FUENTE[a.fuente] ?? a.fuente} href={a.fuenteUrl ?? PORTADA[a.fuente] ?? null} enlaces={enlaces} />;
}

/** Las etiquetas de los datos que nombran a una persona: no entran a la búsqueda de la tabla (docs/PRIVACIDAD.md). */
const ES_PERSONA = new Set(["Quién", "Quién fue", "Quién lo declaró"]);

/**
 * ¿Le vende al gobierno que encabeza? La autoridad electa de su gente y lo que cada entidad de ese gobierno (la
 * municipalidad; un gobierno regional y sus unidades) le compró a la empresa mientras ejercía, según CONOSCE. Es lo que
 * decide si el antecedente pesa: la ley impide contratar con la entidad donde la autoridad ejerce.
 */
function GobiernoQueEncabeza({ r, cargo, ruc }: { r: ReferenciasAntecedente; cargo: string | null; ruc: string }) {
  const g = r.gobierno;
  if (!g) return null;
  const c = (cargo ?? "").toUpperCase();
  const integra = /REGIDOR|CONSEJER/.test(c);
  const sujeto = g.nivel === "regional" ? "el gobierno regional" : "la municipalidad";
  const verbo = integra ? (r.vigente === false ? "que integró" : "que integra") : r.vigente === false ? "que encabezó" : "que encabeza";
  const desde = g.desde?.slice(0, 4);
  const hasta = r.vigente ? "hoy" : g.hasta?.slice(0, 4);
  const periodo = desde ? `entre ${desde} y ${hasta ?? "hoy"}` : "en su periodo";
  const compraron = g.entidades.filter((e) => e.ordenes + e.procesos > 0);
  const principal = g.entidades[0];
  return (
    <BloqueDetalle titulo={`¿Le vende a ${sujeto} ${verbo}?`}>
      {compraron.length === 0 ? (
        <p className="text-dato text-inkSoft">
          <b className="font-semibold text-ink">No.</b>{" "}
          {g.entidades.length === 1 && principal ? (
            <>
              <Link href={`/entidad/${principal.ruc}`} className={ENLACE}>{principal.nombre ? tituloNatural(principal.nombre) : `RUC ${principal.ruc}`}</Link>{" "}
              no le dio órdenes ni le adjudicó procesos {periodo}, según CONOSCE.
            </>
          ) : (
            <>Ninguna de las {numero(g.entidades.length)} entidades de {sujeto} le dio órdenes ni le adjudicó procesos {periodo}, según CONOSCE.</>
          )}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-dato text-inkSoft">
            <b className="font-semibold text-ink">Sí.</b> {compraron.length === 1 ? "Esta entidad le compró" : `Estas ${numero(compraron.length)} entidades le compraron`} {periodo}, según CONOSCE:
          </p>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {compraron.map((e) => (
              <li key={e.ruc} className="space-y-1 px-3.5 py-2.5">
                <Link href={`/entidad/${e.ruc}`} className={`${ENLACE} text-dato`}>{e.nombre ? tituloNatural(e.nombre) : `RUC ${e.ruc}`}</Link>
                <ul className="space-y-0.5 text-meta text-inkSoft">
                  {e.procesos > 0 && (
                    <li>
                      <Link href={rutaEmpresa(ruc, "contratos", { [P_CONTRATOS.entidad]: e.ruc })} className={ENLACE}>
                        {plural(e.procesos, "proceso", "procesos")}
                      </Link>{" "}
                      por <span className="font-mono tabular-nums text-ink">{soles(e.montoProcesos)}</span>
                    </li>
                  )}
                  {e.ordenes > 0 && (
                    <li>
                      <Link href={rutaEmpresa(ruc, "ordenes", { [P_ORDENES.entidad]: e.ruc })} className={ENLACE}>
                        {plural(e.ordenes, "orden", "órdenes")}
                      </Link>{" "}
                      por <span className="font-mono tabular-nums text-ink">{soles(e.montoOrdenes)}</span>
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </BloqueDetalle>
  );
}

/**
 * El panel de un caso: todo lo que dice el registro con la referencia de cada dato (la persona en «Su gente», el partido,
 * la entidad, la otra empresa, el proceso), lo que pesa (en una autoridad, si le vende al gobierno que encabeza; en un
 * patrón de visitas, cada visita), los registros de la fuente (a pedido) y por qué se marca. Antes: datos sin enlaces y,
 * en 20 tipos, sólo la fecha.
 */
function detalleCaso(a: AntecedenteEmpresa, datos: DatoCaso[], ruc: string, explica?: string): NonNullable<Fila["detalle"]> {
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  const proceso = a.codigo ?? a.ocid;
  const gente = aSuGente(a, ruc);
  const patronVisitas = a.tipo !== "visita_previa" && a.tipo.startsWith("visita_") && a.visitas.length > 0;
  return {
    titulo: a.etiqueta,
    etiqueta: `Ver el caso${proceso ? ` del proceso ${proceso}` : ""}${entidad ? `, ${entidad}` : ""}`,
    descripcion: entidad ?? (a.ocid ? undefined : "De la empresa, no de un proceso"),
    contenido: (
      <CuerpoDetalle>
        <DatosClave items={datos.map((x) => ({ etiqueta: x.etiqueta, valor: <ValorCaso x={x} />, mono: x.mono }))} />
        {a.tipo === "autoridad" && a.referencias?.gobierno && (
          <GobiernoQueEncabeza r={a.referencias} cargo={(a.detalle.cargo as string | undefined) ?? a.referencias.cargo ?? null} ruc={ruc} />
        )}
        {patronVisitas && <VisitasDelCaso visitas={a.visitas} />}
        {a.referencias?.clave && CON_EVIDENCIA.test(a.tipo) && (
          <BloqueDetalle titulo="Los registros de la fuente">
            <EvidenciaDelAntecedente ruc={ruc} tipo={a.tipo} clave={a.referencias.clave} />
          </BloqueDetalle>
        )}
        {explica && (
          <BloqueDetalle titulo="Por qué se marca">
            <p className="text-dato text-inkSoft">{explica}</p>
          </BloqueDetalle>
        )}
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={
          a.ocid ? (
            <EnlaceAccion href={rutaContrato(a.ocid, "ficha", { seccion: "antecedentes" })} flecha>Abrir el proceso</EnlaceAccion>
          ) : gente ? (
            <EnlaceAccion href={gente.href} flecha>{gente.texto}</EnlaceAccion>
          ) : undefined
        }
        secundarias={
          <>
            {a.ocid && gente && <EnlaceAccion href={gente.href} variante="secundario">{gente.texto}</EnlaceAccion>}
            <FuenteCaso a={a} />
          </>
        }
      />
    ),
  };
}

/**
 * El panel de un caso de «Órdenes que pasan 8 UIT»: qué días, cuántas órdenes y cuánto suman, cada día con sus órdenes
 * (a pedido) y adónde ir a verlas: la lista de Órdenes de la empresa filtrada por esa entidad (y por el año, si los días
 * caen en uno solo).
 */
function detalleFraccionamiento(
  a: AntecedenteEmpresa,
  datos: DatoCaso[],
  ruc: string,
  rucDe: Map<string, string | null>,
): NonNullable<Fila["detalle"]> {
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  const rucEntidad = a.entidadRuc ?? (a.entidad ? rucDe.get(claveEntidad(a.entidad)) ?? null : null);
  const desde = txt(a.detalle.desde)?.slice(0, 4);
  const hasta = txt(a.detalle.hasta)?.slice(0, 4);
  const anio = desde && desde === hasta && Number(desde) >= 2018 ? desde : undefined;
  const ordenes = rucEntidad ? rutaEmpresa(ruc, "ordenes", { [P_ORDENES.entidad]: rucEntidad, [P_ORDENES.anio]: anio }) : null;
  return {
    titulo: entidad ? `Órdenes de ${entidad}` : "Órdenes que pasan 8 UIT",
    etiqueta: `Ver las órdenes que pasan 8 UIT${entidad ? ` de ${entidad}` : ""}`,
    descripcion: "Órdenes menores del mismo día que juntas pasan el tope de 8 UIT",
    contenido: (
      <CuerpoDetalle>
        <DatosClave items={datos.map((x) => ({ etiqueta: x.etiqueta, valor: <ValorCaso x={x} />, mono: x.mono }))} />
        {a.referencias?.clave && (
          <BloqueDetalle titulo="Cada día, con sus órdenes">
            <EvidenciaDelAntecedente ruc={ruc} tipo={a.tipo} clave={a.referencias.clave} />
          </BloqueDetalle>
        )}
        {!ordenes && (
          <p className="text-meta text-mute">
            No ubicamos esta entidad entre sus clientes por su nombre: búscala en la lista de Órdenes con el filtro de entidad.
          </p>
        )}
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={
          ordenes ? (
            <EnlaceAccion href={ordenes} flecha>
              {anio ? `Ver sus órdenes de ${anio} en esa entidad` : "Ver sus órdenes en esa entidad"}
            </EnlaceAccion>
          ) : (
            <EnlaceAccion href={rutaEmpresa(ruc, "ordenes")} flecha>Ver todas sus órdenes</EnlaceAccion>
          )
        }
        secundarias={
          <>
            {a.ocid && <EnlaceAccion href={rutaContrato(a.ocid, "ficha", { seccion: "antecedentes" })} variante="secundario">Abrir el proceso</EnlaceAccion>}
            <FuenteCaso a={a} />
          </>
        }
      />
    ),
  };
}
