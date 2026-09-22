import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Severidad } from "@/components/ui/Severidad";
import { formatPEN, type Comprobante, type ComprobanteContrato } from "@/lib/financiamiento";

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

/** Mismo vocabulario que el panel de contribuciones del admin; sin movimiento en loop. */
const ESTADO_CONTRIB: Record<string, { label: string; cls: string }> = {
  pendiente_pago: { label: "Pendiente de pago", cls: "bg-amber-soft text-amberTexto border-amber/30" },
  pagada: { label: "Pagada", cls: "bg-moss/10 text-moss border-moss/30" },
  en_proceso: { label: "Leyéndose ahora", cls: "bg-moss/10 text-moss border-moss/30" },
  procesada: { label: "Leída y publicada", cls: "bg-moss text-paper border-moss" },
  rechazada: { label: "Rechazada", cls: "bg-crimson-soft text-crimsonTexto border-crimson/30" },
  reembolsada: { label: "Reembolsada", cls: "bg-paperDeep text-mute border-line" },
};

const num = (n: number) => n.toLocaleString("es-PE");
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });

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
      <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm leading-relaxed text-mute">
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
              titulo={`${c.codigo} · ${c.zona}`}
              descripcion={`${num(c.contratos)} contratos financiados el ${fecha(c.pagadaAt)}. Los contratos salieron de la cola por antigüedad.`}
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
        <div className="mt-0.5 text-[11px] text-mute">
          <span className="font-mono">{c.codigo}</span> · {fecha(c.pagadaAt)}
        </div>
      </div>
      <p className="text-[13px] leading-snug text-inkSoft">
        <span className="font-mono font-semibold text-ink">{num(c.procesados)}</span> leídos de{" "}
        <span className="font-mono">{num(c.contratos)}</span> financiados ·{" "}
        <span className="font-mono font-semibold text-ink">{num(c.senales)}</span> con señal
        {(c.enRevision ?? 0) > 0 && (
          <>
            {" "}· <span className="font-mono">{num(c.enRevision ?? 0)}</span> en revisión humana
          </>
        )}
      </p>
      {interactivo && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-mute group-hover:text-ink">
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
  return (
    <div className="space-y-4">
      {esMaqueta && (
        <p className="rounded-xl border border-dashed border-amber/60 bg-amber-soft px-3.5 py-3 text-[12px] leading-relaxed text-inkSoft">
          <strong className="font-semibold text-ink">Aporte de maqueta.</strong> Ni este aporte ni estos
          contratos existen: están generados para ver cómo se lee la lista con volumen. Sus identificadores
          llevan prefijo <span className="font-mono">MAQUETA-</span> y no enlazan a ningún expediente.
        </p>
      )}
      <p className="rounded-xl border border-heroViolet/25 bg-heroViolet-soft/60 px-3.5 py-3 text-[12px] leading-relaxed text-inkSoft">
        {r.asignados === 0 ? (
          <>
            Este aporte está pagado y todavía no tiene contratos asignados: la cola de {contribucion.zona}{" "}
            los entrega por antigüedad, y cuando salgan aparecen acá uno por uno. Ni {nombre} ni Vigía Perú
            eligen cuáles.
          </>
        ) : (
          <>
            Estos {num(r.asignados)} contratos salieron de la cola de {contribucion.zona} por antigüedad el{" "}
            {fecha(contribucion.pagadaAt)}. Ni {nombre} ni Vigía Perú los eligieron, y los agentes que los
            leyeron no reciben el nombre de quien financió.
          </>
        )}
      </p>

      <dl className="space-y-1.5 text-[13px] leading-relaxed text-inkSoft">
        <div>
          <dt className="inline text-mute">Asignados y leídos: </dt>
          <dd className="inline">
            <span className="font-mono font-semibold text-ink">{num(r.procesados)}</span> de{" "}
            <span className="font-mono">{num(r.asignados)}</span>
            {r.pendientes > 0 && (
              <span className="text-mute"> · {num(r.pendientes)} todavía sin asignar de los {num(comprobante.contratos)} pagados</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="inline text-mute">Con al menos una señal: </dt>
          <dd className="inline">
            <span className="font-mono font-semibold text-ink">{num(r.contratosConSenal ?? 0)}</span> de{" "}
            <span className="font-mono">{num(r.procesados)}</span> leídos
            <span className="text-mute"> · {num(r.senales)} señales en total</span>
            {(r.enRevision ?? 0) > 0 && (
              <span className="text-mute"> · {num(r.enRevision ?? 0)} esperando revisión humana</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="inline text-mute">Dinero público mirado: </dt>
          <dd className="inline font-mono font-semibold text-ink">{formatPEN(r.montoAuditado)}</dd>
        </div>
      </dl>

      {comprobante.detalle.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-mute">
            Los {num(comprobante.detalle.length)} contratos, uno por uno
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
          <span className="font-mono text-[12px] text-inkSoft">{formatPEN(d.valorReferencial)}</span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
        {d.titulo ?? "Sin objeto declarado en el expediente"}
      </p>
      {d.entidad && <p className="mt-0.5 truncate text-[11px] text-mute">{d.entidad}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
        {d.procesadaAt == null ? (
          <span>Todavía sin leer · sigue en la cola</span>
        ) : enRevision ? (
          <span>Leído · el dictamen espera revisión humana, todavía no cuenta como señal</span>
        ) : sev ? (
          <>
            <Severidad bandera={sev} formato="linea" />
            <span>
              {num(d.banderas)} {d.banderas === 1 ? "señal" : "señales"} con norma citada
            </span>
          </>
        ) : (
          <span>Leído · salió sin señal</span>
        )}
      </div>
    </li>
  );
}
