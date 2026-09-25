import Link from "next/link";
import { FileText, TriangleAlert } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila } from "@/components/listado";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { ChipAporte } from "@/components/financiar/EstadoAporte";
import { indicadoresAporte } from "@/components/financiar/indicadoresAporte";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { fecha, numero } from "@/lib/formato";
import { SelloMaqueta } from "./AvisoMaqueta";

/**
 * La cadena completa de un aliado: aporte → contratos asignados → señal. Es lo que
 * justifica que exista un perfil de aliado en un producto que no le da escenario a
 * quien paga: no es un agradecimiento, es la trazabilidad de en qué se convirtió
 * cada aporte.
 *
 * Una fila por aporte —estado (chip) · zona y código · leídos · con señales · fecha · ›—
 * y el aporte abierto en el panel lateral con el formato de todo panel (DESIGN_SYSTEM.md
 * §14.4): chips → cifras → datos clave → bloques. Sin montos en soles (§14.6): ni el del
 * aporte ni el valor de cada contrato; ése está en la ficha del contrato.
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

export function CadenaAliado({
  nombre,
  items,
  esMaqueta = false,
}: {
  nombre: string;
  /** Contribución + su comprobante ya resuelto (o `null` si no se trajo el detalle). */
  items: { contribucion: ContribucionAliado; comprobante: Comprobante | null }[];
  /**
   * Aliado inventado (`lib/maqueta-aliados.ts`). Cambia dos cosas que no pueden
   * mentir: los contratos dejan de enlazar —su OCID no existe— y el aporte deja de
   * ofrecer un comprobante público que nadie podría consultar.
   */
  esMaqueta?: boolean;
}) {
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
        titulo: `Aporte a ${c.zona}`,
        etiqueta: `Ver los contratos que pagó el aporte ${c.codigo}`,
        descripcion: <span className="font-mono">{c.codigo}</span>,
        contenido: <DetalleAporte nombre={nombre} contribucion={c} comprobante={comprobante} esMaqueta={esMaqueta} />,
        pie: esMaqueta ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-mute">
            <FileText size={13} aria-hidden /> Un aporte de maqueta no tiene comprobante público.
          </span>
        ) : (
          <Link
            href={`/impacto/${c.codigo}`}
            className="inline-flex min-h-[24px] items-center gap-1.5 text-[13px] font-semibold text-granate underline-offset-2 hover:underline"
          >
            <FileText size={13} aria-hidden /> Ver el comprobante público de {c.codigo}
          </Link>
        ),
      };
    } else if (!esMaqueta) {
      // Sin detalle traído (pasado el tope del perfil): la fila lleva al comprobante.
      fila.href = `/impacto/${c.codigo}`;
    }
    return fila;
  });
  return <Tabla columnas={COLUMNAS} filas={filas} etiqueta={`Aportes de ${nombre}`} />;
}

/** El panel de un aporte (§14.4): qué es, sus cifras, sus datos y qué contratos pagó. */
function DetalleAporte({
  nombre,
  contribucion: c,
  comprobante,
  esMaqueta,
}: {
  nombre: string;
  contribucion: ContribucionAliado;
  comprobante: Comprobante;
  esMaqueta: boolean;
}) {
  const r = comprobante.resumen;
  // Las mismas cifras que su comprobante público, sin la de soles: el perfil se cuenta en contratos.
  const cifras = indicadoresAporte(comprobante).filter((i) => !/valor/i.test(i.etiqueta));
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <ChipAporte estado={c.estado} />
        {esMaqueta && <SelloMaqueta />}
      </ChipsDetalle>

      {esMaqueta && (
        <p className="flex items-center gap-1.5 text-[13px] text-amberTexto">
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          Ni este aporte ni estos contratos existen.
          <Ayuda titulo="¿Qué es inventado?">
            Están generados para ver cómo se lee la lista con volumen. Sus códigos llevan prefijo MAQ- y MAQUETA-, y no
            enlazan a ningún expediente.
          </Ayuda>
        </p>
      )}

      <Indicadores items={cifras} />

      <DatosClave
        items={[
          { etiqueta: "Código", valor: c.codigo, mono: true },
          { etiqueta: "Zona", valor: c.zona },
          { etiqueta: "Financiado el", valor: fecha(c.pagadaAt) },
          { etiqueta: "Contratos financiados", valor: num(c.contratos) },
          { etiqueta: "Ya asignados", valor: num(r.asignados) },
          {
            etiqueta: "Cómo se eligieron",
            valor: "Por antigüedad en la cola",
            ayuda: (
              <Ayuda titulo="¿Quién elige los contratos?">
                Nadie: salen de la cola de {c.zona} por antigüedad. Ni {nombre} ni Vigía Perú los eligen, y su lectura se
                hace sin conocer el nombre de quien financió.
              </Ayuda>
            ),
          },
        ]}
      />

      <BloqueDetalle titulo={r.asignados > 0 ? `Contratos que pagó (${num(comprobante.detalle.length)})` : "Contratos que pagó"}>
        {comprobante.detalle.length > 0 ? (
          // Dentro del panel (~670 px): las columnas se deciden por el ancho de la tabla, no de la pantalla.
          <Tabla
            medida="contenedor"
            columnas={COLUMNAS_CONTRATOS}
            filas={comprobante.detalle.map((d) => filaContrato(d, esMaqueta))}
            etiqueta={`Contratos del aporte ${comprobante.codigo}`}
          />
        ) : (
          <p className="text-[13px] text-mute">Todavía sin contratos asignados: la cola de {c.zona} los entrega por antigüedad.</p>
        )}
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

const COLUMNAS_CONTRATOS: Columna[] = [
  { clave: "estado", desde: "md", apilar: true, titulo: "Estado", ancho: "132px" },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "senales", titulo: "Señales", ancho: "72px", alinear: "der", desde: "lg" },
];

/**
 * Un contrato del aporte. La columna de estado es siempre un chip: sin leer, en revisión,
 * sin señales o la severidad de su señal más fuerte. Uno de maqueta no enlaza.
 */
function filaContrato(d: ComprobanteContrato, esMaqueta: boolean): Fila {
  const sev = bandera(d.severidad);
  const enRevision = d.alertaEstado === "revision";
  const leido = d.procesadaAt != null;
  const estado = !leido ? (
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
      contrato: <CeldaPrincipal titulo={d.titulo ?? "Sin objeto declarado en el expediente"} meta={d.entidad ?? undefined} />,
      // Sin leer o en revisión todavía no hay señales publicadas: "Sin dato", no un 0.
      senales: leido && !enRevision ? <CeldaNumero>{num(sev ? d.banderas : 0)}</CeldaNumero> : undefined,
    },
  };
}
