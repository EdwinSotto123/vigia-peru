import { Ayuda, CuerpoDetalle, DatosClave, EstadoVacio, FuenteDato, PieDetalle } from "@/components/patrones";
import { BarraFiltros, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { TIPO_CRUCE, esTipoObra } from "@/lib/cruces";
import { fraseBandera, type BanderaObra } from "@/lib/obras";
import { fechaCorta, hoyLima, numero, oracion, plural, soles } from "@/lib/formato";
import {
  CLARIDAD_ONPE,
  CONOSCE_BUSCADOR,
  CONTRATACIONES_ABIERTAS,
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
import { CORTO_EMPRESA, rutaEmpresa, type AntecedenteEmpresa, type ClienteEmpresa } from "@/lib/empresas";
import { RANGO_SEVERIDAD, SEVERIDAD, peorSeveridad } from "@/lib/severidad";
import { txtONumero } from "@/lib/utils";
import { conAnio, NoCargo, paraClave } from "./comun";
import { P_ORDENES } from "./ordenes";

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
};

const txt = txtONumero;

/** Si una sanción sigue hoy: por su fecha de fin y, sin ella, por el estado que publica el Tribunal. */
function hoySancion(tipo: string | null, hasta: string | null, estado: string | null): string | null {
  // El día de Lima, no el UTC: desde las 19:00 de Lima el día UTC ya es mañana.
  const hoy = hoyLima();
  if (hasta) return hasta >= hoy ? "Vigente" : `Ya terminó (el ${fechaCorta(hasta)})`;
  if (estado) return estado.toUpperCase() === "VIGENTE" ? "Vigente" : "No vigente, según el Tribunal";
  return tipo === "definitivo" ? "Definitiva, sin fecha de fin" : null;
}

/** Lo que dice cada antecedente en pares rótulo/valor, según su tipo (los campos de `detalle` de cruces_proveedor). */
function datosDe(a: AntecedenteEmpresa): { etiqueta: string; valor: string | null; mono?: boolean }[] {
  const d = a.detalle;
  const f = (v: unknown) => (txt(v) && /^\d{4}-\d{2}-\d{2}/.test(txt(v)!) ? fechaCorta(txt(v)!) : txt(v));
  const persona = a.socios[0];
  const visita = a.visitas[0] as Record<string, unknown> | undefined;
  const items: { etiqueta: string; valor: string | null; mono?: boolean }[] = [];
  if (persona) items.push({ etiqueta: "Quién", valor: `${persona.nombre}${persona.rol ? ` (${persona.rol})` : ""}` });
  if (visita) {
    items.push(
      { etiqueta: "Visitante", valor: txt(visita.visitante) },
      { etiqueta: "Entidad visitada", valor: txt(visita.entidad) ? tituloNatural(txt(visita.entidad)!) : null },
      { etiqueta: "Cargo de quien la recibió", valor: txt(visita.cargoFuncionario) ? tituloNatural(txt(visita.cargoFuncionario)!) : null },
      { etiqueta: "Motivo", valor: txt(visita.motivo) },
    );
  }
  if (a.tipo === "sancion" || a.tipo === "sancion_vigente") {
    items.push(
      { etiqueta: "Sanción", valor: txt(d.tipo) ? oracion(txt(d.tipo)!) : null },
      { etiqueta: "Vigencia", valor: [f(d.desde), f(d.hasta)].filter(Boolean).join(" a ") || null },
      { etiqueta: "Hoy", valor: hoySancion(txt(d.tipo), txt(d.hasta), txt(d.estado)) },
      { etiqueta: "Infracción", valor: txt(d.infraccion)?.replace(/^[-\s]*[a-z]\)\s*/i, "") ?? null },
      { etiqueta: "Resolución", valor: txt(d.resolucion), mono: true },
    );
  } else if (a.tipo === "fraccionamiento") {
    // Los días con el año siempre: el rango cruza años («10 dic. 2020 al 19 feb.» no decía de qué año era el final).
    const desde = txt(d.desde)?.slice(0, 10);
    const hasta = txt(d.hasta)?.slice(0, 10);
    const rango = desde && hasta ? (desde === hasta ? `el ${conAnio(desde)}` : `del ${conAnio(desde)} al ${conAnio(hasta)}`) : null;
    const dias = typeof d.dias === "number" ? plural(d.dias, "día", "días") : null;
    items.push(
      { etiqueta: "Días", valor: [dias, rango].filter(Boolean).join(", ") || null },
      { etiqueta: "Órdenes", valor: txt(d.ordenes) },
      { etiqueta: "Juntas suman", valor: typeof d.total === "number" ? soles(d.total) : null, mono: true },
    );
  } else if (a.tipo === "recurrente") {
    items.push(
      { etiqueta: "Procesos ganados en la entidad", valor: txt(d.procesos) },
      { etiqueta: "Entre", valor: [f(d.desde), f(d.hasta)].filter(Boolean).join(" y ") || null },
    );
  } else if (a.tipo === "sobreprecio") {
    const peor = (d.peor ?? {}) as Record<string, unknown>;
    items.push(
      { etiqueta: "Ítem", valor: txt(peor.descripcion) ? oracion(txt(peor.descripcion)!) : null },
      { etiqueta: "Precio unitario", valor: typeof peor.unitario === "number" ? soles(peor.unitario) : null, mono: true },
      { etiqueta: "Mediana de otras entidades", valor: typeof peor.mediana === "number" ? `${soles(peor.mediana)} (${numero(Number(peor.entidades ?? 0))} entidades)` : null },
      { etiqueta: "Pagó de más en total", valor: typeof d.exceso === "number" ? soles(d.exceso) : null, mono: true },
    );
  } else if (esTipoObra(a.tipo)) {
    // La obra que construye o supervisa en ese contrato (INFOBRAS) o la inversión de su CUI (Invierte.pe): la frase con sus
    // números, la obra y la inversión. La causa de una paralización o de un atraso puede ser de la entidad.
    const obra = txt(d.nombre_obra);
    const inversion = txt(d.nombre_inversion);
    items.push(
      { etiqueta: "Lo que registra la fuente", valor: fraseBandera({ ...d, tipo: a.tipo, severidad: a.severidad } as BanderaObra, d.rol === "supervision" ? "La obra que supervisa" : a.tipo.startsWith("inversion_") ? "La inversión" : "La obra") },
      { etiqueta: d.rol === "supervision" ? "Obra que supervisa" : "Obra", valor: obra ? `${oracion(obra)}${txt(d.obra) ? ` (INFOBRAS ${txt(d.obra)})` : ""}` : null },
      { etiqueta: "Inversión", valor: inversion ? `${oracion(inversion)}${txt(d.cui) ? ` (CUI ${txt(d.cui)})` : ""}` : null },
    );
  } else {
    const org = txt(d.organizacion) ?? txt(d.partido);
    if (org) items.push({ etiqueta: "Organización política", valor: org });
    if (txt(d.cargo)) items.push({ etiqueta: "Cargo", valor: tituloNatural(txt(d.cargo)!) });
    if (txt(d.proceso)) items.push({ etiqueta: "Proceso electoral", valor: txt(d.proceso) });
    if (txt(d.entidad_contratante)) items.push({ etiqueta: "Entidad", valor: tituloNatural(txt(d.entidad_contratante)!) });
  }
  if (a.montoSoles != null && !esTipoObra(a.tipo) && !items.some((i) => i.etiqueta.startsWith("Juntas") || i.etiqueta.startsWith("Pagó"))) {
    items.push({ etiqueta: "Monto", valor: soles(a.montoSoles), mono: true });
  }
  if (a.fecha && !items.some((i) => i.etiqueta === "Vigencia" || i.etiqueta === "Días" || i.etiqueta === "Entre")) {
    items.push({ etiqueta: "Fecha", valor: fechaCorta(a.fecha), mono: true });
  }
  return items.filter((i) => i.valor);
}

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
export const P_ANTECEDENTES = { tipo: "atipo", gravedad: "agrav" } as const;

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
          const datos = datosDe(a);
          return {
            id: `${tipo}-${k}`,
            // Cada caso abre su panel: todo lo que dice el registro, el enlace a su registro oficial y el proceso en que pesa.
            // «Órdenes que pasan 8 UIT»: el caso son órdenes, no el proceso; su panel lleva a esas órdenes y al proceso.
            detalle: a.tipo === "fraccionamiento" ? detalleFraccionamiento(a, datos, ruc, rucDe) : detalleCaso(a, datos),
            // Sin nombres de personas (socio, visitante, funcionario): no se buscan (docs/PRIVACIDAD.md).
            buscable: `${datos.filter((x) => !["Quién", "Visitante", "A quién visitó"].includes(x.etiqueta)).map((x) => x.valor).join(" ")} ${a.entidad ?? ""} ${a.codigo ?? ""}`,
            celdas: {
              detalle: (
                <ul className="space-y-0.5 text-meta">
                  {datos.slice(0, 4).map((x) => (
                    <li key={x.etiqueta} className="min-w-0 break-words">
                      <span className="text-mute">{x.etiqueta}: </span>
                      <span className={x.mono ? "font-mono tabular-nums text-ink" : "text-ink"}>{x.valor}</span>
                    </li>
                  ))}
                  {datos.length > 4 && <li className="text-mute">{`Y ${plural(datos.length - 4, "dato más", "datos más")} en su detalle`}</li>}
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

/**
 * El panel de un caso: todo lo que dice el registro (la fila muestra hasta cuatro datos), la entidad y el proceso en que
 * pesa, y su fuente con el enlace a su registro oficial. Antes la fila llevaba directo a la ficha del proceso y el único
 * enlace a la fuente era el del primer caso del tipo; la ficha del proceso queda a un clic, en el pie.
 */
function detalleCaso(a: AntecedenteEmpresa, datos: ReturnType<typeof datosDe>): NonNullable<Fila["detalle"]> {
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  const proceso = a.codigo ?? a.ocid;
  return {
    titulo: a.etiqueta,
    etiqueta: `Ver el caso${proceso ? ` del proceso ${proceso}` : ""}${entidad ? `, ${entidad}` : ""}`,
    descripcion: entidad ?? (a.ocid ? undefined : "De la empresa, no de un proceso"),
    contenido: (
      <CuerpoDetalle>
        <DatosClave
          items={[
            ...datos.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, mono: x.mono })),
            // (los datos de algunos tipos ya traen su «Entidad»: va una vez)
            ...(entidad && !datos.some((x) => x.etiqueta === "Entidad") ? [{ etiqueta: "Entidad", valor: entidad }] : []),
            ...(proceso ? [{ etiqueta: "Pesa sobre el proceso", valor: proceso, mono: true }] : []),
          ]}
        />
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={a.ocid ? <EnlaceAccion href={rutaContrato(a.ocid)} flecha>Abrir el proceso</EnlaceAccion> : undefined}
        secundarias={<FuenteCaso a={a} />}
      />
    ),
  };
}

/**
 * El panel de un caso de «Órdenes que pasan 8 UIT»: qué días, cuántas órdenes y cuánto suman, y adónde ir a verlas. La
 * API todavía no marca cada orden con su bandera: el enlace abre la lista de Órdenes de la empresa filtrada por esa
 * entidad (y por el año, si los días caen en uno solo). La ficha del proceso trae cada día con sus órdenes.
 */
function detalleFraccionamiento(
  a: AntecedenteEmpresa,
  datos: ReturnType<typeof datosDe>,
  ruc: string,
  rucDe: Map<string, string | null>,
): NonNullable<Fila["detalle"]> {
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  const rucEntidad = a.entidad ? rucDe.get(claveEntidad(a.entidad)) ?? null : null;
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
        <DatosClave
          items={[
            ...datos.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, mono: x.mono })),
            { etiqueta: "Entidad", valor: entidad },
            { etiqueta: "Pesa sobre el proceso", valor: a.codigo ?? a.ocid },
          ]}
        />
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
            {a.ocid && <EnlaceAccion href={rutaContrato(a.ocid)} variante="secundario">Abrir el proceso</EnlaceAccion>}
            <FuenteCaso a={a} />
          </>
        }
      />
    ),
  };
}
