import Link from "next/link";
import { FileText } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila } from "@/components/listado";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { ChipAporte } from "@/components/financiar/EstadoAporte";
import { indicadoresAporte } from "@/components/financiar/indicadoresAporte";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { fecha, numero, soles } from "@/lib/formato";

/**
 * La cadena completa de un aliado: aporte → contratos asignados → señal.
 *
 * Esto es lo que justifica que exista una ficha de aliado en un producto que,
 * por principio, no le da escenario a quien paga: no es un agradecimiento,
 * es la trazabilidad de en qué se convirtió cada sol.
 *
 * Con la `Tabla` de todo listado (DESIGN_SYSTEM.md §14.1): una fila por aporte
 * —estado (chip) · zona y código · leídos · con señales · fecha · ›— y el aporte
 * abierto en el panel lateral, con las mismas cifras que su comprobante público y sus
 * contratos en otra tabla. Todo el dato es real y ya resuelto en el servidor.
 */

export interface ContribucionAliado {
  codigo: string;
  contratos: number;
  estado: string;
  pagadaAt: string;
  ubigeo: string;
  zona: string;
  procesados: number;
  senales: number;
  enRevision?: number;
}

const num = numero;

const bandera = (s: string | null): "alta" | "media" | "baja" | null =>
  s === "alta" || s === "media" || s === "baja" ? s : null;

const COLUMNAS: Columna[] = [
  { clave: "estado", desde: "md", apilar: true, titulo: "Estado", ancho: "150px" },
  { clave: "aporte", titulo: "Aporte", ancho: "minmax(0,1fr)" },
  { clave: "leidos", titulo: "Leídos", ancho: "96px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "112px", alinear: "der", desde: "lg" },
  { clave: "fecha", titulo: "Financiado", ancho: "104px", desde: "lg" },
];

/**
 * Dentro del panel de resumen del muro (≤ 672 px aunque la ventana sea ancha): menos
 * columnas, porque los cortes de la tabla son por ancho de ventana, no del panel.
 */
const COLUMNAS_COMPACTAS: Columna[] = [
  { clave: "estado", desde: "md", apilar: true, titulo: "Estado", ancho: "150px" },
  { clave: "aporte", titulo: "Aporte", ancho: "minmax(0,1fr)" },
  { clave: "leidos", titulo: "Leídos", ancho: "88px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "104px", alinear: "der", desde: "md" },
];

export function CadenaAliado({
  nombre,
  items,
  esMaqueta = false,
  compacta = false,
}: {
  nombre: string;
  /** Contribución + su comprobante ya resuelto (o `null` si no se pudo traer el detalle). */
  items: { contribucion: ContribucionAliado; comprobante: Comprobante | null }[];
  /**
   * Aliado inventado (`lib/maqueta-aliados.ts`). Cambia dos cosas que no pueden
   * mentir: los contratos dejan de enlazar —su OCID no existe— y el aporte deja
   * de ofrecer un comprobante público que nadie podría consultar.
   */
  esMaqueta?: boolean;
  /** Para el panel de resumen del muro: sin fecha y con menos columnas. */
  compacta?: boolean;
}) {
  if (items.length === 0) {
    // Sin la llamita de `EstadoVacio`: esta ficha nombra a una persona u organización (§2.3).
    return (
      <p className="rounded-2xl border border-dashed border-line bg-paperSoft px-5 py-6 text-sm leading-relaxed text-inkSoft">
        {nombre} todavía no tiene aportes confirmados. Cuando el primero se confirme, cada contrato que haga leer
        aparece acá con su entidad y su dictamen.
      </p>
    );
  }
  const filas: Fila[] = items.map(({ contribucion: c, comprobante }) => {
    const enRevision = c.enRevision ?? 0;
    const fila: Fila = {
      id: c.codigo,
      celdas: {
        estado: <ChipAporte estado={c.estado} />,
        aporte: <CeldaPrincipal titulo={c.zona} meta={<span className="font-mono">{c.codigo}</span>} />,
        leidos: <CeldaNumero sub={`de ${num(c.contratos)}`}>{num(c.procesados)}</CeldaNumero>,
        senales: (
          <CeldaNumero sub={enRevision > 0 ? `${num(enRevision)} en revisión` : undefined}>{num(c.senales)}</CeldaNumero>
        ),
        fecha: <CeldaFecha fecha={c.pagadaAt} />,
      },
    };
    if (comprobante) {
      // El aporte se abre en el panel: la lista de aportes sigue a la vista.
      fila.detalle = {
        titulo: c.zona,
        etiqueta: `Ver los contratos que pagó el aporte ${c.codigo}`,
        descripcion: (
          <span className="block">
            <span className="font-mono text-inkSoft">{c.codigo}</span>
            <span className="mt-0.5 block">
              {num(c.contratos)} contratos financiados el {fecha(c.pagadaAt)}. Salieron de la cola por antigüedad.
            </span>
          </span>
        ),
        contenido: <DetalleContribucion nombre={nombre} contribucion={c} comprobante={comprobante} esMaqueta={esMaqueta} />,
        pie: esMaqueta ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-mute">
            <FileText size={13} aria-hidden /> Un aporte de maqueta no tiene comprobante público: {c.codigo} no existe.
          </span>
        ) : (
          <Link href={`/impacto/${c.codigo}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink hover:underline">
            <FileText size={13} aria-hidden /> Ver el comprobante público de {c.codigo}
          </Link>
        ),
      };
    } else if (!esMaqueta) {
      // Sin detalle traído (pasado el tope de la ficha): la fila lleva al comprobante.
      fila.href = `/impacto/${c.codigo}`;
    }
    return fila;
  });
  return <Tabla columnas={compacta ? COLUMNAS_COMPACTAS : COLUMNAS} filas={filas} etiqueta={`Aportes de ${nombre}`} />;
}

/** Contenido del panel: las cifras del aporte y qué contratos concretos pagó, uno por uno. */
function DetalleContribucion({
  nombre,
  contribucion,
  comprobante,
  esMaqueta = false,
}: {
  nombre: string;
  contribucion: ContribucionAliado;
  comprobante: Comprobante;
  esMaqueta?: boolean;
}) {
  const r = comprobante.resumen;
  return (
    <div className="space-y-4">
      {esMaqueta && (
        <p className="rounded-xl border border-dashed border-amber/60 bg-amber-soft px-3.5 py-3 text-[12px] leading-relaxed text-inkSoft">
          <strong className="font-semibold text-ink">Aporte de maqueta.</strong> Ni este aporte ni estos
          contratos existen: están generados para ver cómo se lee la lista con volumen. Sus identificadores
          llevan prefijo <span className="font-mono">MAQUETA-</span> y no enlazan a ningún expediente.
        </p>
      )}
      <p className="rounded-xl border border-granate/20 bg-granate-50 px-3.5 py-3 text-[12px] leading-relaxed text-inkSoft">
        {r.asignados === 0 ? (
          <>
            Este aporte está financiado y todavía no tiene contratos asignados: la cola de {contribucion.zona}{" "}
            los entrega por antigüedad. Ni {nombre} ni Vigía Perú eligen cuáles.
          </>
        ) : (
          <>
            Estos {num(r.asignados)} contratos salieron de la cola de {contribucion.zona} por antigüedad. Ni {nombre} ni
            Vigía Perú los eligieron, y su lectura se hizo sin conocer el nombre de quien financió.
          </>
        )}
      </p>

      {/* Las mismas cifras que el comprobante público del aporte. */}
      <Indicadores items={indicadoresAporte(comprobante)} />

      {comprobante.detalle.length > 0 && (
        <Tabla
          columnas={COLUMNAS_CONTRATOS}
          filas={comprobante.detalle.map((d) => filaContrato(d, esMaqueta))}
          etiqueta={`Contratos del aporte ${comprobante.codigo}`}
        />
      )}
    </div>
  );
}

const COLUMNAS_CONTRATOS: Columna[] = [
  { clave: "estado", desde: "md", apilar: true, titulo: "Estado", ancho: "132px" },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "valor", titulo: "Valor referencial", ancho: "124px", alinear: "der", desde: "md" },
];

/**
 * Un contrato del aporte. La columna de estado es siempre un chip: sin leer, en revisión,
 * sin señales (los tres, con el mismo chip que la lista de contratos) o la severidad de su
 * señal más fuerte. Un contrato de maqueta no enlaza: su OCID no existe.
 */
function filaContrato(d: ComprobanteContrato, esMaqueta: boolean): Fila {
  const sev = bandera(d.severidad);
  const enRevision = d.alertaEstado === "revision";
  const estado =
    d.procesadaAt == null ? (
      <PesoRiesgo score={null} formato="pastilla" />
    ) : enRevision ? (
      <PesoRiesgo score={null} enRevision formato="pastilla" />
    ) : sev && d.banderas > 0 ? (
      <Severidad bandera={sev} />
    ) : (
      <PesoRiesgo score={0} banderas={0} formato="pastilla" />
    );
  return {
    id: d.ocid,
    href: esMaqueta ? undefined : `/app/contratos/${encodeURIComponent(d.ocid)}`,
    celdas: {
      estado,
      contrato: (
        <CeldaPrincipal
          titulo={d.titulo ?? "Sin objeto declarado en el expediente"}
          meta={[d.entidad, d.banderas > 0 && !enRevision ? `${num(d.banderas)} ${d.banderas === 1 ? "señal" : "señales"}` : null]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
      valor: <CeldaNumero>{d.valorReferencial != null ? soles(d.valorReferencial) : "Sin dato"}</CeldaNumero>,
    },
  };
}
