import { ArrowUpRight } from "lucide-react";
import { Ayuda, CuerpoDetalle, DatosClave, EstadoVacio, PieDetalle } from "@/components/patrones";
import { BarraFiltros, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { TIPO_CRUCE, esTipoObra } from "@/lib/cruces";
import { fraseBandera, type BanderaObra } from "@/lib/obras";
import { fechaCorta, hoyLima, numero, oracion, plural, soles } from "@/lib/formato";
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
      { etiqueta: "A quién visitó", valor: [txt(visita.funcionario), txt(visita.cargoFuncionario)].filter(Boolean).join(", ") || null },
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
        const filas: Fila[] = casos.map((a, k) => {
          const datos = datosDe(a);
          return {
            id: `${tipo}-${k}`,
            // «Órdenes que pasan 8 UIT»: el caso son órdenes, no el proceso. Su panel lleva a esas órdenes y al proceso.
            ...(a.tipo === "fraccionamiento" ? { detalle: detalleFraccionamiento(a, datos, ruc, rucDe) } : { href: a.ocid ? rutaContrato(a.ocid) : undefined }),
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
              <p className="flex flex-wrap items-center gap-1 text-rotulo text-mute">
                Fuente: {fuente ? FUENTE[fuente] ?? fuente : "Cruces de Vigía"}
                {casos[0].fuenteUrl && (
                  <a href={casos[0].fuenteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-granate underline-offset-2 hover:underline">
                    abrir <ArrowUpRight size={12} aria-hidden />
                  </a>
                )}
                {tipo === "fraccionamiento"
                  ? <span>. Cada caso abre sus órdenes y el proceso en que pesa.</span>
                  : casos.some((c) => c.ocid) && <span>. Cada proceso abre su ficha con la evidencia.</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
    </div>
  );
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
        secundarias={a.ocid ? <EnlaceAccion href={rutaContrato(a.ocid)} variante="secundario">Abrir el proceso</EnlaceAccion> : undefined}
      />
    ),
  };
}
