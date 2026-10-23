import { ArrowUpRight } from "lucide-react";
import { EstadoVacio } from "@/components/patrones";
import { BarraFiltros, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { TIPO_CRUCE } from "@/lib/cruces";
import { fecha, fechaCorta, hoyLima, numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { CORTO_EMPRESA, type AntecedenteEmpresa } from "@/lib/empresas";
import { RANGO_SEVERIDAD, peorSeveridad } from "@/lib/severidad";
import { txtONumero } from "@/lib/utils";
import { NoCargo, SEV, VARIANTE } from "./comun";

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
    items.push(
      { etiqueta: "Días", valor: [f(d.desde), f(d.hasta)].filter((v, i, xs) => v && xs.indexOf(v) === i).join(" a ") || null },
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
  } else {
    const org = txt(d.organizacion) ?? txt(d.partido);
    if (org) items.push({ etiqueta: "Organización política", valor: org });
    if (txt(d.cargo)) items.push({ etiqueta: "Cargo", valor: tituloNatural(txt(d.cargo)!) });
    if (txt(d.proceso)) items.push({ etiqueta: "Proceso electoral", valor: txt(d.proceso) });
    if (txt(d.entidad_contratante)) items.push({ etiqueta: "Entidad", valor: tituloNatural(txt(d.entidad_contratante)!) });
  }
  if (a.montoSoles != null && !items.some((i) => i.etiqueta.startsWith("Juntas") || i.etiqueta.startsWith("Pagó"))) {
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
  { clave: "gravedad", titulo: "Gravedad", ancho: "112px" },
];

/**
 * Cada tipo de antecedente una vez, numerado (1, 2, 3…), de lo más grave a lo más leve: cuántas veces aparece y con qué
 * gravedad, qué quiere decir y, debajo, cada caso en una tabla paginada (lo que dice el registro, el proceso en que pesa
 * con su evidencia, la fuente). Antes iba un caso por tarjeta: 160 tarjetas casi iguales.
 */
export const P_ANTECEDENTES = { tipo: "atipo", gravedad: "agrav" } as const;

export async function AntecedentesEmpresa({
  datos,
  tipo: tipoElegido,
  gravedad,
}: {
  datos: Promise<{ total: number; data: AntecedenteEmpresa[] } | null>;
  tipo?: string;
  gravedad?: string;
}) {
  const d = await datos;
  if (!d) return <NoCargo que="sus antecedentes" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Ningún otro registro la nombra">
        No figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de campaña, las autoridades y candidatos,
        ni en los demás cruces de Vigía.
      </EstadoVacio>
    );
  }
  // Los conteos de cada opción, sobre el otro filtro (como en las listas del servidor).
  const porGravedad = d.data.filter((a) => !tipoElegido || a.tipo === tipoElegido);
  const porTipo = d.data.filter((a) => !gravedad || a.severidad === gravedad);
  const tiposConteo = [...porTipo.reduce((m, a) => m.set(a.tipo, { n: (m.get(a.tipo)?.n ?? 0) + 1, etiqueta: a.etiqueta }), new Map<string, { n: number; etiqueta: string }>())]
    .sort((a, b) => b[1].n - a[1].n);
  const barra = (
    <BarraFiltros
      faceta={{
        param: P_ANTECEDENTES.gravedad,
        etiqueta: "Gravedad",
        todas: "Todas",
        conteoTodas: porGravedad.length,
        nombreEnChip: false,
        opciones: (["alta", "media", "baja"] as const)
          .map((sv) => ({ valor: sv, etiqueta: SEV[sv], conteo: porGravedad.filter((a) => a.severidad === sv).length, ...(sv === "alta" ? { tono: "alta" as const, icono: "alerta" as const } : sv === "media" ? { tono: "media" as const, icono: "atencion" as const } : {}) }))
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
        <EstadoVacio compacto titulo="Ningún antecedente con estos filtros">Quita el filtro de tipo o de gravedad.</EstadoVacio>
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
        const filas: Fila[] = casos.map((a, k) => {
          const datos = datosDe(a);
          return {
            id: `${tipo}-${k}`,
            href: a.ocid ? rutaContrato(a.ocid) : undefined,
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
              gravedad: <Badge variant={VARIANTE[a.severidad]}>{SEV[a.severidad]}</Badge>,
            },
          };
        });
        return (
          <li key={tipo} className="flex gap-3 rounded-xl border border-line/80 bg-paperSoft p-3.5">
            <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="space-y-1.5">
                <h4 className="text-cuerpo font-semibold text-ink">{casos[0].etiqueta}</h4>
                <ul className="flex flex-wrap gap-1.5">
                  {porSev.map((x) => (
                    <li key={x.sv}><Badge variant={VARIANTE[x.sv]}>{`${plural(x.n, "vez", "veces")}, ${SEV[x.sv].toLowerCase()}`}</Badge></li>
                  ))}
                </ul>
                {TIPO_CRUCE[tipo]?.explica && <p className="max-w-prose text-meta leading-relaxed text-inkSoft">{TIPO_CRUCE[tipo].explica}</p>}
              </div>
              <TablaPaginada
                columnas={COLUMNAS_CASOS}
                filas={filas}
                etiqueta={casos[0].etiqueta}
                tam={5}
                nombre="casos"
                densidad="compacta"
                medida="contenedor"
                buscar={{ placeholder: "Buscar por entidad, código o dato…", etiqueta: `Buscar en ${casos[0].etiqueta.toLowerCase()}` }}
              />
              <p className="flex flex-wrap items-center gap-1 text-rotulo text-mute">
                Fuente: {fuente ? FUENTE[fuente] ?? fuente : "Cruces de Vigía"}
                {casos[0].fuenteUrl && (
                  <a href={casos[0].fuenteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-granate underline-offset-2 hover:underline">
                    abrir <ArrowUpRight size={12} aria-hidden />
                  </a>
                )}
                {casos.some((c) => c.ocid) && <span>. Cada proceso abre su ficha con la evidencia.</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
    </div>
  );
}
