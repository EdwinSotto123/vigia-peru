import { Ayuda } from "@/components/patrones";
import type { Indicador } from "@/components/listado";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { numero, plural, solesCompacto } from "@/lib/formato";

/**
 * Las cifras de un aporte (DESIGN_SYSTEM.md §14.1, `Indicadores`): las mismas en su
 * comprobante público (/impacto/[codigo]) y en el panel del aporte dentro de la ficha
 * de un aliado. Antes cada superficie las armaba a su manera —cuatro cajas en una, una
 * fila de cinco cifras en la otra— y con denominadores distintos.
 */

/** Señal publicada: leída, con al menos una bandera y fuera de revisión humana (mismo filtro que el backend). */
export const esSenalPublicada = (k: ComprobanteContrato) => k.procesadaAt != null && k.alertaEstado !== "revision" && k.banderas > 0;

const suma = (xs: ComprobanteContrato[]) => xs.reduce((n, k) => n + (k.valorReferencial ?? 0), 0);

export function indicadoresAporte(c: Comprobante, esperandoDocumentos = 0): Indicador[] {
  const r = c.resumen;
  const leidos = c.detalle.filter((k) => k.procesadaAt);
  const valorLeido = suma(leidos);
  const valorAsignado = suma(c.detalle);
  // "Por leer" = pagados menos leídos: restar de los asignados hacía que un aporte sin
  // asignar dijera "Por leer 0" con cinco contratos pagados.
  const porLeer = Math.max(0, c.contratos - r.procesados);
  const sinAsignar = Math.max(0, c.contratos - r.asignados);
  const conSenal = r.contratosConSenal ?? leidos.filter(esSenalPublicada).length;
  const enRevision = r.enRevision ?? 0;

  return [
    {
      valor: numero(r.procesados),
      etiqueta: "leídos",
      contexto: `de ${numero(c.contratos)} del aporte${enRevision > 0 ? `, ${numero(enRevision)} en revisión` : ""}`,
      ayuda:
        enRevision > 0 ? (
          <Ayuda titulo="¿Por qué en revisión?">
            La autoevaluación no alcanzó el umbral para publicar y una persona decide. No cuentan como señal.
          </Ayuda>
        ) : undefined,
    },
    {
      valor: numero(porLeer),
      etiqueta: "por leer",
      contexto:
        esperandoDocumentos > 0
          ? `${numero(esperandoDocumentos)} esperan sus documentos`
          : sinAsignar > 0 && porLeer > 0
            ? c.estado === "pendiente_pago"
              ? "se asignan al validar el pago"
              : `${numero(sinAsignar)} todavía sin asignar`
            : undefined,
    },
    {
      valor: numero(conSenal),
      etiqueta: "con señales",
      contexto:
        r.procesados > 0
          ? `de ${numero(r.procesados)} leídos, ${plural(r.senales, "señal", "señales")} en total`
          : "ningún contrato leído todavía",
    },
    {
      // Compacto, como toda cifra de tarjeta (§10.3): millones en soles completos no entran en la celda.
      valor: solesCompacto(valorLeido),
      etiqueta: "valor referencial leído",
      contexto:
        valorAsignado > valorLeido
          ? `de ${solesCompacto(valorAsignado)} asignados`
          : r.asignados === 0
            ? "todavía sin contratos asignados"
            : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué es el valor referencial?">
          Lo que la entidad convocó, no lo que terminó pagando. Sólo cuenta lo ya leído: un contrato asignado que sigue en
          la cola no es dinero mirado.
        </Ayuda>
      ),
    },
  ];
}
