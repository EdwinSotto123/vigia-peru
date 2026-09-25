import Link from "next/link";
import { MapPin } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Cifras } from "@/components/ui/Cifras";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";
import { IdentidadAliado } from "./IdentidadAliado";
import type { RegionAlcanzada } from "./perfil";

/**
 * Las dos preguntas que la ficha de un aliado no contestaba y ahora sí:
 * **en qué regiones cayó lo que pagó** y **qué se encontró en SUS contratos**.
 *
 * Hasta ahora había que abrir los cinco paneles de la cadena, uno por uno, para
 * enterarse de que en sus contratos salieron diecinueve señales. Eso no es
 * progresive disclosure: es esconder el resultado detrás del recibo.
 *
 * Nada de esto inventa dato: las regiones salen de los propios aportes y las
 * señales de `/financiamiento/impacto/:codigo`, que es el mismo comprobante
 * público que cualquiera puede consultar por código.
 */

const num = numero;

/** Cuántas señales se listan antes de mandar al resto a la cadena de aportes. */
const MAX_SENALES = 12;

export function RegionesDeAliado({
  regiones,
  financiados,
  titulo = "En qué zonas cayeron sus contratos",
}: {
  regiones: RegionAlcanzada[];
  /** Total de contratos financiados por el aliado: denominador de cada barra. */
  financiados: number;
  titulo?: string;
}) {
  if (regiones.length === 0) return null;
  return (
    <section>
      <h3 className="text-[13px] font-semibold text-ink">{titulo}</h3>
      <ol className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
        {regiones.map((r) => (
          <li key={r.ubigeo} className="px-3.5 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex min-w-0 items-baseline gap-1.5 text-[13px] font-medium text-ink">
                <MapPin size={12} className="shrink-0 translate-y-0.5 text-mute" aria-hidden />
                <span className="truncate">{r.zona}</span>
              </span>
              <span className="shrink-0 text-[12px] text-inkSoft">
                <span className="font-mono font-semibold tabular-nums text-ink">{num(r.contratos)}</span> de{" "}
                <span className="font-mono tabular-nums">{num(financiados)}</span> financiados
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
              <div
                className="h-1.5 min-w-[2px] rounded-full bg-granate"
                style={{ width: `${financiados > 0 ? (r.contratos / financiados) * 100 : 0}%` }}
              />
            </div>
            <Cifras
              as="div"
              tam="sm"
              className="mt-1.5"
              items={[
                { n: r.procesados, texto: "leídos" },
                { n: r.senales, texto: "con señales" },
                { n: r.aportes, texto: r.aportes === 1 ? "aporte" : "aportes" },
              ]}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface SenalDeAliado extends ComprobanteContrato {
  codigoAporte: string;
  zona: string;
}

/**
 * Extrae, de los comprobantes ya traídos, los contratos que salieron con señal.
 *
 * El filtro es exactamente el del backend —alerta PUBLICADA y al menos una
 * bandera— y no "tiene severidad". Con el filtro laxo esta lista contaba 30
 * mientras la misma página decía 19 dos bloques más arriba: un dictamen en
 * revisión humana trae severidad pero todavía no es una señal publicada, y
 * mostrarlo como tal es justo lo que este producto no puede hacer.
 */
export function senalesDeComprobantes(
  items: { comprobante: Comprobante | null }[],
): SenalDeAliado[] {
  const senales: SenalDeAliado[] = [];
  for (const { comprobante } of items) {
    if (!comprobante) continue;
    for (const d of comprobante.detalle) {
      const publicada = d.procesadaAt != null && d.alertaEstado !== "revision" && d.banderas > 0;
      if (publicada && (d.severidad === "alta" || d.severidad === "media" || d.severidad === "baja")) {
        senales.push({ ...d, codigoAporte: comprobante.codigo, zona: comprobante.zona });
      }
    }
  }
  return senales.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.banderas - a.banderas);
}

/**
 * Lo que salió en los contratos de este aliado, sin abrir un solo panel.
 * Ordenado por score: lo más fuerte primero, que es lo que un periodista busca.
 */
export function SenalesDeAliado({
  senales,
  nombre,
  esMaqueta = false,
}: {
  senales: SenalDeAliado[];
  nombre: string;
  /** Un contrato de maqueta no tiene OCID real: se muestra, pero no enlaza a ninguna parte. */
  esMaqueta?: boolean;
}) {
  if (senales.length === 0) return null;
  const visibles = senales.slice(0, MAX_SENALES);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-2">
        <h2 className="font-display text-lg font-bold text-ink">Qué se encontró en sus contratos</h2>
        <p className="text-[12px] text-mute">
          {visibles.length < senales.length ? (
            <>Mostrando <span className="font-mono tabular-nums">{num(visibles.length)}</span> de{" "}
              <span className="font-mono tabular-nums">{num(senales.length)}</span> contratos con señales</>
          ) : (
            <><span className="font-mono tabular-nums">{num(senales.length)}</span> {senales.length === 1 ? "contrato con señales" : "contratos con señales"}</>
          )}
        </p>
      </div>
      <p className="max-w-[72ch] text-[13px] leading-relaxed text-mute">
        Son señales, no acusaciones: cada una se publica con la norma citada y el documento oficial que la
        sostiene, y se publicó igual sin consultar a {nombre}.
      </p>
      <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {visibles.map((s) => (
          <li key={`${s.codigoAporte}-${s.ocid}`} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {esMaqueta ? (
                <span className="font-mono text-[12px] text-mute">{s.ocid}</span>
              ) : (
                <Link
                  href={`/app/contratos/${encodeURIComponent(s.ocid)}`}
                  className="font-mono text-[12px] text-ink hover:underline"
                >
                  {s.ocid}
                </Link>
              )}
              <Severidad bandera={s.severidad as "alta" | "media" | "baja"} formato="pastilla" />
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
              {s.titulo ?? "Sin objeto declarado en el expediente"}
            </p>
            {/* Cinco datos de naturaleza distinta —entidad, zona, cuántas señales,
                cuánta plata, qué aporte lo pagó— que antes iban en un renglón
                pegados con puntos medios. Cada uno lleva su propio ícono: se
                distinguen de un vistazo y se pueden escanear en columna. */}
            <IdentidadAliado
              as="div"
              tam="sm"
              className="mt-1.5"
              datos={[
                ...(s.entidad ? [{ icono: "entidad" as const, texto: s.entidad }] : []),
                { icono: "zona" as const, texto: s.zona },
                {
                  icono: "senal" as const,
                  texto: `${num(s.banderas)} ${s.banderas === 1 ? "señal" : "señales"} con norma citada`,
                },
                ...(s.valorReferencial != null
                  ? [
                      {
                        icono: "monto" as const,
                        texto: soles(s.valorReferencial),
                        titulo: "Valor referencial del contrato",
                      },
                    ]
                  : []),
                {
                  icono: "codigo" as const,
                  texto: s.codigoAporte,
                  titulo: "El aporte que pagó la lectura de este contrato",
                },
              ]}
            />
          </li>
        ))}
      </ol>
      {senales.length > visibles.length && (
        <p className="text-[12px] leading-relaxed text-mute">
          Las otras {num(senales.length - visibles.length)} están en la lista de abajo, dentro del aporte que
          pagó cada contrato.
        </p>
      )}
    </section>
  );
}
