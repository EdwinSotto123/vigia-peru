import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Cifras } from "@/components/ui/Cifras";
import { Severidad } from "@/components/ui/Severidad";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { fecha as fechaLarga, numero, soles } from "@/lib/formato";

/**
 * La cadena completa de un aliado: aporte → contratos asignados → señal.
 *
 * Esto es lo que justifica que exista una ficha de aliado en un producto que,
 * por principio, no le da escenario a quien paga: no es un agradecimiento,
 * es la trazabilidad de en qué se convirtió cada sol. El aporte se abre en un
 * panel lateral (`Revelar`) en vez de navegar, para que la línea de tiempo
 * siga a la vista mientras se mira un aporte concreto.
 *
 * Todo el dato es real y ya resuelto en el servidor: `/financiamiento/aliados/
 * :slug` da la línea de tiempo y `/financiamiento/impacto/:codigo` el detalle
 * por contrato. Lo que el API no trae —el desglose de regiones, el monto por
 * aliado— no se pinta.
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

/**
 * Mismo vocabulario que el panel de contribuciones del admin; sin movimiento en loop.
 * Financiada y en proceso = granate (la marca acompañando el trámite); leída = moss
 * (positivo: el trabajo terminó); pendiente = neutro. Nunca ámbar: es "Señal media".
 */
const ESTADO_CONTRIB: Record<string, { label: string; cls: string }> = {
  pendiente_pago: { label: "Pendiente de pago", cls: "bg-paperDeep text-inkSoft border-line" },
  pagada: { label: "Financiada", cls: "bg-granate-soft text-granate border-granate/20" },
  en_proceso: { label: "En proceso", cls: "bg-granate-soft text-granate border-granate/20" },
  procesada: { label: "Leída y publicada", cls: "bg-moss/10 text-mossTexto border-moss/30" },
  rechazada: { label: "Rechazada", cls: "bg-crimson-soft text-crimsonTexto border-crimson/30" },
  reembolsada: { label: "Reembolsada", cls: "bg-paperDeep text-inkSoft border-line" },
};

const num = numero;
const fecha = (iso: string) => fechaLarga(iso);

const bandera = (s: string | null): "alta" | "media" | "baja" | null =>
  s === "alta" || s === "media" || s === "baja" ? s : null;

function PildoraEstado({ estado }: { estado: string }) {
  const cfg = ESTADO_CONTRIB[estado] ?? { label: estado.replace(/_/g, " "), cls: "bg-paperDeep text-mute border-line" };
  return <span className={`pill ${cfg.cls}`}>{cfg.label}</span>;
}

export function CadenaAliado({
  nombre,
  items,
  esMaqueta = false,
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
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-paperSoft px-5 py-6 text-sm leading-relaxed text-inkSoft">
        {nombre} todavía no tiene aportes confirmados. Cuando el primero se confirme, cada contrato que
        haga leer aparece acá con su entidad y su dictamen.
      </p>
    );
  }
  return (
    <ol className="overflow-hidden rounded-2xl border border-line bg-paper">
      {items.map(({ contribucion: c, comprobante }) => (
        <li key={c.codigo} className="border-t border-line first:border-t-0">
          {comprobante ? (
            <Revelar
              titulo={c.zona}
              descripcion={
                <span className="block">
                  <span className="font-mono text-inkSoft">{c.codigo}</span>
                  <span className="mt-0.5 block">
                    {num(c.contratos)} contratos financiados el {fecha(c.pagadaAt)}. Salieron de la cola por
                    antigüedad.
                  </span>
                </span>
              }
              ancho="xl"
              etiqueta={`Ver los contratos que pagó el aporte ${c.codigo}`}
              className="transition-colors duration-rapido hover:bg-paperSoft"
              pie={
                esMaqueta ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-mute">
                    <FileText size={13} aria-hidden /> Un aporte de maqueta no tiene comprobante público:{" "}
                    {c.codigo} no existe.
                  </span>
                ) : (
                  <Link
                    href={`/impacto/${c.codigo}`}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink hover:underline"
                  >
                    <FileText size={13} aria-hidden /> Ver el comprobante público de {c.codigo}
                  </Link>
                )
              }
              detalle={
                <DetalleContribucion nombre={nombre} contribucion={c} comprobante={comprobante} esMaqueta={esMaqueta} />
              }
            >
              <ResumenContribucion c={c} interactivo />
            </Revelar>
          ) : esMaqueta ? (
            <ResumenContribucion c={c} interactivo={false} />
          ) : (
            <Link href={`/impacto/${c.codigo}`} className="block transition-colors duration-rapido hover:bg-paperSoft">
              <ResumenContribucion c={c} interactivo />
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

/** La fila visible del aporte. Sin enlaces adentro: vive dentro del botón de `Revelar`. */
function ResumenContribucion({ c, interactivo }: { c: ContribucionAliado; interactivo: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-ink">{c.zona}</span>
          <PildoraEstado estado={c.estado} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 text-[11px] text-mute">
          <span className="font-mono">{c.codigo}</span>
          <span>{fecha(c.pagadaAt)}</span>
        </div>
      </div>
      <Cifras
        as="div"
        items={[
          { n: c.procesados, de: c.contratos, texto: "financiados ya leídos" },
          { n: c.senales, texto: "con señales" },
          { n: c.enRevision ?? 0, texto: "en revisión humana", ocultarEnCero: true },
        ]}
      />
      {interactivo && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-granate group-hover:underline">
          Ver los contratos <ChevronRight size={13} aria-hidden />
        </span>
      )}
    </div>
  );
}

/** Contenido del panel: qué contratos concretos pagó este aporte, uno por uno. */
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
  const valorAsignado = comprobante.detalle.reduce((n, d) => n + (d.valorReferencial ?? 0), 0);
  const valorLeido = comprobante.detalle
    .filter((d) => d.procesadaAt != null)
    .reduce((n, d) => n + (d.valorReferencial ?? 0), 0);
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
            los entrega por antigüedad, y cuando salgan aparecen acá uno por uno. Ni {nombre} ni Vigía Perú
            eligen cuáles.
          </>
        ) : (
          <>
            Estos {num(r.asignados)} contratos salieron de la cola de {contribucion.zona} por antigüedad el{" "}
            {fecha(contribucion.pagadaAt)}. Ni {nombre} ni Vigía Perú los eligieron, y su lectura se hizo sin
            conocer el nombre de quien financió.
          </>
        )}
      </p>

      {/* Antes eran tres renglones de "etiqueta: valor" con los matices colgados
          de un punto medio ("3 de 5 · 2 todavía sin asignar · 19 señales en
          total"). Cada cifra pasa a ser su propio elemento; lo que las separa
          es espacio y contraste, no una raya. */}
      <Cifras
        className="gap-x-6"
        tam="lg"
        items={[
          { n: r.procesados, de: r.asignados, texto: "asignados ya leídos" },
          {
            n: r.pendientes,
            texto: `todavía sin asignar de los ${num(comprobante.contratos)} pagados`,
            ocultarEnCero: true,
          },
          { n: r.contratosConSenal ?? 0, de: r.procesados, texto: "leídos con al menos una señal" },
          { n: r.senales, texto: "señales en total" },
          { n: r.enRevision ?? 0, texto: "esperando revisión humana", ocultarEnCero: true },
        ]}
      />
      {/* Sólo lo LEÍDO: `resumen.montoAuditado` del API suma también los asignados que
          siguen en la cola, y un contrato sin leer no es dinero mirado. */}
      <p className="border-t border-line pt-3 text-[12px] text-inkSoft">
        Valor referencial de los contratos ya leídos:{" "}
        <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">{soles(valorLeido)}</span>
        {valorAsignado > valorLeido && <> de {soles(valorAsignado)} asignados</>}
      </p>

      {comprobante.detalle.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-ink">
            {comprobante.detalle.length === 1 ? "El contrato" : `Los ${num(comprobante.detalle.length)} contratos, uno por uno`}
          </h3>
          <ol className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {comprobante.detalle.map((d) => (
              <ContratoDeAporte key={d.ocid} d={d} esMaqueta={esMaqueta} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ContratoDeAporte({ d, esMaqueta = false }: { d: ComprobanteContrato; esMaqueta?: boolean }) {
  const sev = bandera(d.severidad);
  const enRevision = d.alertaEstado === "revision";
  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {esMaqueta ? (
          <span className="font-mono text-[12px] text-mute">{d.ocid}</span>
        ) : (
          <Link
            href={`/app/contratos/${encodeURIComponent(d.ocid)}`}
            className="font-mono text-[12px] text-ink hover:underline"
          >
            {d.ocid}
          </Link>
        )}
        {d.valorReferencial != null && (
          <span className="font-mono text-[12px] tabular-nums text-inkSoft">{soles(d.valorReferencial)}</span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
        {d.titulo ?? "Sin objeto declarado en el expediente"}
      </p>
      {d.entidad && <p className="mt-0.5 truncate text-[11px] text-mute">{d.entidad}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
        {d.procesadaAt == null ? (
          <span>Sigue en la cola, todavía sin leer</span>
        ) : enRevision ? (
          <span>En revisión: el dictamen espera revisión humana y todavía no cuenta como señal</span>
        ) : sev && d.banderas > 0 ? (
          <>
            <Severidad bandera={sev} formato="linea" />
            <span>
              {num(d.banderas)} {d.banderas === 1 ? "señal" : "señales"} con norma citada
            </span>
          </>
        ) : (
          <span>Leído, sin señales</span>
        )}
      </div>
    </li>
  );
}
