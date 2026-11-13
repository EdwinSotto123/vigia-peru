import type { ResumenContratos } from "@/lib/contratos";
import { numero } from "@/lib/formato";
import { P_INV, P_OBRA, type ResumenObras } from "@/lib/obras";
import { SENAL, type ParamsPersonas, type ResumenPersonas } from "@/lib/personas";
import { nombreCruce, type FilaConteo } from "./BloquesInicio";

/**
 * Las señales de cada fuente de una ficha como filas de `ListaConteos`, para elegir las tres que más pesan
 * (`elegirHallazgos`, components/inicio/ResumenFicha.tsx): sus contratos, las personas que contrató y sus obras. Cada
 * fila con su total (la barra y el %), su lista ya filtrada y, en `detalle`, de dónde sale. Sin estado.
 */

type Href = (filtro: Record<string, string>) => string;

/**
 * Sus contratos: los ganados por alguien con un antecedente grave, los que Vigía leyó con riesgo alto y los dos
 * antecedentes más frecuentes (sin `sinTipos`: los que ya cuenta una bandera de la cabecera, como la captura).
 */
export function hallazgosContratos(
  r: Pick<ResumenContratos, "porRiesgo" | "porCruces"> & { total?: number | null } | null | undefined,
  href: Href,
  { sinTipos = [], unidad = "En sus contratos" }: { sinTipos?: string[]; unidad?: string } = {},
): FilaConteo[] {
  if (!r) return [];
  const c = r.porCruces;
  const total = r.total != null && c ? Math.max(r.total, c.con) : undefined;
  const riesgo = r.porRiesgo ?? {};
  const leidos = (riesgo.alto ?? 0) + (riesgo.medio ?? 0) + (riesgo.bajo ?? 0) + (riesgo.en_revision ?? 0);
  return [
    ...(c ? [{ etiqueta: "Los ganó alguien con un antecedente grave", n: c.alta, grave: true, href: href({ cruces: "alta" }), de: total, detalle: unidad }] : []),
    ...(leidos > 0 ? [{ etiqueta: "Vigía los leyó y les dio riesgo alto", n: riesgo.alto ?? 0, grave: true, href: href({ riesgo: "alto" }), de: leidos, detalle: `De ${numero(leidos)} que leyó Vigía` }] : []),
    // recorte: los dos más frecuentes; todos, en el filtro «Antecedentes» de la lista
    ...Object.entries(c?.tipos ?? {})
      .filter(([tipo, n]) => n > 0 && !sinTipos.includes(tipo))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([tipo, n]) => ({ etiqueta: nombreCruce(tipo), n, tipo, href: href({ cruces: tipo }), de: total, detalle: "Antecedente de quien ganó" })),
  ];
}

/** Las personas que contrató: las de una señal grave y la señal más frecuente (sin el nepotismo, que es una bandera). */
export function hallazgosPersonas(r: ResumenPersonas | null | undefined, href: Href, P: ParamsPersonas, { sinSenales = ["nepotismo"] }: { sinSenales?: string[] } = {}): FilaConteo[] {
  if (!r?.filas) return [];
  const quienes = r.filas === r.personas ? "Personas" : "Contrataciones";
  const top = r.porSenal.filter((s) => s.n > 0 && !sinSenales.includes(s.tipo)).sort((a, b) => b.n - a.n)[0];
  return [
    { etiqueta: `${quienes} con una señal grave`, n: r.alta, grave: true, href: href({ [P.severidad]: "alta" }), de: r.filas, detalle: "En las personas contratadas por órdenes de servicio" },
    ...(top ? [{ etiqueta: SENAL[top.tipo]?.titulo ?? top.tipo, n: top.n, tipo: top.tipo, href: href({ [P.senal]: top.tipo }), de: r.filas, detalle: "En las personas contratadas" }] : []),
  ];
}

/** Sus obras (INFOBRAS) y sus inversiones (Invierte.pe): las banderas graves y las demás, como en la pestaña Obras. */
export function hallazgosObras(r: ResumenObras | null | undefined, ruta: string): FilaConteo[] {
  const o = r?.obras;
  const i = r?.inversiones;
  const obras = (bandera: string) => `${ruta}?${new URLSearchParams({ seccion: "obras", [P_OBRA.bandera]: bandera })}`;
  const inversiones = (bandera: string) => `${ruta}?${new URLSearchParams({ seccion: "obras", vista: "inversiones", [P_INV.bandera]: bandera })}`;
  const deObras = o?.total ? `De sus ${numero(o.total)} obras en INFOBRAS` : "";
  const deInv = i?.total ? `De sus ${numero(i.total)} inversiones en Invierte.pe` : "";
  const obra = (etiqueta: string, bandera: string, tipo: string, grave = false): FilaConteo => ({ etiqueta, n: o?.porBandera?.[bandera] ?? 0, href: obras(bandera), de: o?.total, tipo, grave, detalle: deObras });
  const inv = (etiqueta: string, bandera: string, tipo: string, grave = false): FilaConteo => ({ etiqueta, n: i?.porBandera?.[bandera] ?? 0, href: inversiones(bandera), de: i?.total, tipo, grave, detalle: deInv });
  return [
    ...(o?.total
      ? [
          obra("Obras paralizadas hoy", "paralizada", "obra_paralizada", true),
          obra("Obras atrasadas 20 puntos o más frente a lo programado", "atraso", "obra_atraso", true),
          obra("Obras pagadas por encima de lo construido", "pago", "obra_pagado_sin_avance", true),
          obra("Obras con adicionales por más del 15 % del contrato", "adicionales_tope", "obra_adicionales_sobre_tope", true),
          obra("Obras con el plazo ampliado a la mitad o más", "plazo", "obra_plazo_ampliado"),
          obra("Obras con informes de la Contraloría", "control", "obra_informe_control"),
        ]
      : []),
    ...(i?.total
      ? [inv("Inversiones que cuestan 1.5 veces o más lo aprobado", "sobrecosto", "inversion_sobrecosto", true), inv("Inversiones con laudos arbitrales", "laudo", "inversion_laudo")]
      : []),
  ];
}
