import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Clock, Code2, ShieldCheck } from "lucide-react";
import { ZonaPicker } from "@/components/financiar/ZonaPicker";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { EncabezadoPagina, FuenteDato, Seccion } from "@/components/patrones";
import { FranjaTextil } from "@/components/marca";
import { numero, porcentaje, soles } from "@/lib/formato";
import {
  alcanceCorto,
  frasePartesTarifa,
  getEstadoGlobal,
  getPago,
  getRecientes,
  getZonas,
  partesTarifa,
  type EstadoGlobal,
  type ParteTarifa,
} from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";

const REPO = "https://github.com/EdwinSotto123/vigia-peru";

export async function generateMetadata() {
  const estado = await getEstadoGlobal();
  const precio = estado?.tarifa.precioPen;
  return {
    title: "Financia una auditoría",
    description: `Cada región del Perú tiene contratos públicos que nadie ha leído. Financia la capacidad de auditarlos${precio != null ? `: ${soles(precio)} por contrato` : ""}, con resultados públicos y reconocimiento contado en contratos.`,
  };
}

export const revalidate = 120;

/**
 * /app/financiar — plantilla de conversión (DESIGN_SYSTEM.md §14): una pregunta por
 * pantalla, "¿qué zona quieres que se lea?". Arriba, por qué hace falta (el déficit de
 * lectura, con su denominador); al medio, la respuesta (el selector de zona); al cierre,
 * en granate profundo, por qué financiar esto no compra nada.
 */
export default async function FinanciarPage({ searchParams }: { searchParams?: { ubigeo?: string } }) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);
  const [zonas, estado, recientes, resumenContratos, pago] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getRecientes(),
    getResumenContratos(),
    getPago(),
  ]);
  const precio = estado?.tarifa.precioPen ?? null;
  const partes = partesTarifa(estado?.tarifa.nota);
  const conCola = (zonas ?? []).filter((z) => z.totalCola > 0).length;
  const pagosAbiertos = !!pago?.configurado;

  // "Leídos" es la misma cifra de la portada y de /app/contratos (DESIGN_SYSTEM.md §10.1):
  // todo contrato cuyo análisis terminó, por cualquier vía. Los financiados leídos son un
  // subconjunto y se nombran como tal; antes esta página llamaba "leídos" sólo a esos.
  const r = resumenContratos?.porRiesgo;
  const leidos = r ? (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0) : null;

  return (
    <div className="bg-paper">
      {/* ─── LA PREGUNTA, Y POR QUÉ HACE FALTA ─── */}
      <section className="border-b border-line bg-paperSoft">
        <div className="container-page grid gap-8 py-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div>
            {/* La pregunta de la pantalla va de título (plantilla de conversión, §14); el porqué, debajo. */}
            <EncabezadoPagina
              titulo="¿Qué contratos de tu zona quieres que se lean?"
              bajada={
                <>
                  El Estado publica todos sus contratos, pero{" "}
                  <strong className="font-semibold text-granate">nadie tiene capacidad de leerlos</strong>. Vigía lee
                  cada uno completo, lo cruza con registros públicos y publica sus señales con la norma que las
                  respalda.
                  {precio != null && (
                    <>
                      {" "}Leer un contrato cuesta <strong className="text-ink">{soles(precio)}</strong>
                      {partes.length > 0 ? <>: {frasePartesTarifa(partes)}.</> : "."}
                    </>
                  )}{" "}
                  Elige una zona y <strong className="text-ink">financia la lectura</strong> de sus contratos en cola.
                  Los resultados son públicos, siempre.
                </>
              }
            />
            {!pagosAbiertos && (
              <p className="mt-5 flex max-w-xl items-start gap-2.5 rounded-2xl border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-inkSoft" role="note">
                <Clock size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                <span>
                  <strong className="text-ink">Los aportes todavía no están abiertos:</strong> aún no hay un medio de
                  pago conectado. Hoy la lectura la paga Vigía Perú con su propio capital semilla. Puedes elegir una
                  zona para ver su cola, seguirla y mirar cómo avanza.
                </span>
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <EnlaceAccion href="#zonas">
                {pagosAbiertos ? "Elegir mi zona" : "Ver las zonas"} <ArrowRight size={16} aria-hidden />
              </EnlaceAccion>
              <EnlaceAccion variante="fantasma" href="#independencia">
                <ShieldCheck size={16} className="text-granate" aria-hidden /> Cómo se protege la independencia
              </EnlaceAccion>
            </div>
          </div>

          {/* El bloque ES la comparación: leídos contra publicados. Ninguna cifra viaja sola. */}
          <BalanceLectura estado={estado} publicados={resumenContratos?.total ?? null} leidos={leidos} conCola={conCola} />
        </div>
      </section>

      <div className="container-page space-y-16 py-12">
        {/* ─── ELIGE TU ZONA (sin mapa: el mapa vive en /app/mapa) ─── */}
        <Seccion
          id="zonas"
          titulo="Elige la zona que quieres que se lea"
          descripcion={
            <>
              Busca tu departamento, provincia o distrito: verás cuántos contratos esperan financiamiento y cuánto
              cuesta leerlos. Si prefieres verlo en el mapa,{" "}
              <Link href="/app/mapa" className="font-medium text-granate underline underline-offset-2">ábrelo aquí</Link>.
            </>
          }
          acciones={<FuenteDato fuente="OECE, API OCDS" />}
        >
          <ZonaPicker zonas={zonas ?? []} precioPen={precio ?? 0} partes={partes} alcance={alcanceCorto(estado?.alcance)} />
        </Seccion>

        {/* ─── ÚLTIMOS APORTES (el orden por aliado vive en /app/aliados) ─── */}
        <Seccion
          titulo="Últimos aportes"
          descripcion="Cada aporte se cuenta en contratos, no en soles, y enlaza a su comprobante público."
          acciones={
            <Link href="/app/aliados" className="inline-flex min-h-[24px] items-center gap-1.5 text-sm font-semibold text-granate underline-offset-2 hover:underline">
              Ver el muro de aliados <ArrowRight size={14} aria-hidden />
            </Link>
          }
        >
          <div className="max-w-3xl">
            {recientes ? (
              <RecientesFeed items={recientes} />
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm text-mute">
                No se pudo leer la lista de aportes ahora mismo. Los aportes siguen registrados: vuelve a intentarlo en
                un momento.
              </p>
            )}
          </div>
        </Seccion>
      </div>

      {/* ─── INDEPENDENCIA: el cierre de marca, en granate profundo ─── */}
      <section id="independencia" className="sobre-oscuro scroll-mt-20 bg-granate-deep text-paper">
        <FranjaTextil alto={12} />
        <div className="container-page grid gap-10 py-16 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <ShieldCheck size={28} className="text-maiz" aria-hidden />
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight text-balance">Financias capacidad, no resultados</h2>
            <p className="mt-3 max-w-[60ch] leading-relaxed text-paper/80">
              Esto no es comprar una región ni patrocinar un informe. Es pagar la lectura de contratos que ya son
              públicos para que, por fin, alguien los lea. Las reglas están en el código, no en una promesa.
            </p>
            {precio != null && <Desglose precio={precio} partes={partes} />}
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={claseAccion("oscuro", "mt-6")}>
              <Code2 size={15} aria-hidden /> Ver el código en GitHub
            </a>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            <Regla titulo="Sin selección">La asignación es por antigüedad dentro de la zona, en SQL. Ninguna API acepta un contrato elegido por quien financia.</Regla>
            <Regla titulo="Sin edición">Quien lee los contratos no recibe el nombre de quien financió: ese dato no entra en sus instrucciones.</Regla>
            <Regla titulo="Conflicto automático">Empresa con sanción vigente del OECE o con alertas activas: su aporte hace leer contratos igual, pero no recibe reconocimiento público.</Regla>
            <Regla titulo="Publicación incondicional">Si la lectura que financiaste termina señalándote, se publica igual. Tu comprobante lo mostrará.</Regla>
            <Regla titulo="Reconocimiento aditivo">Varios aliados pueden apoyar la misma zona. Nadie la &quot;tiene&quot;.</Regla>
            <Regla titulo="Trazabilidad">Cada comprobante lista sus contratos y enlaza a la lectura de cada uno, paso por paso.</Regla>
          </ul>
        </div>
      </section>
    </div>
  );
}

/** Cuánto cuesta leer un contrato y en qué se va, tal como lo publica la tarifa del API. */
function Desglose({ precio, partes }: { precio: number; partes: ParteTarifa[] }) {
  return (
    <div className="mt-6 max-w-md rounded-2xl border border-paper/15 bg-paper/[0.06] p-4">
      <p className="text-sm text-paper/80">
        Leer un contrato cuesta <strong className="font-mono tabular-nums text-maiz">{soles(precio)}</strong>
        {partes.length > 0 ? ":" : "."}
      </p>
      {partes.length > 0 && (
        <dl className="mt-2 space-y-1 text-[13px]">
          {partes.map((p) => (
            <div key={p.concepto} className="flex items-baseline gap-3">
              <dt className="w-10 shrink-0 font-mono tabular-nums text-maiz">{soles(p.monto)}</dt>
              <dd className="text-paper/80">{p.concepto}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * El déficit de lectura, que es la razón de existir del producto.
 *
 * La barra no es decoración: a escala real lo leído es una astilla contra el
 * total publicado, y ver esa astilla explica en un segundo por qué hace falta
 * financiar. Por eso la astilla tiene ancho mínimo: si se dibujara a escala
 * exacta (0,24 %) sería medio píxel y no se vería nada.
 *
 * Ninguna cifra viaja sola, y ninguna es un monto: lo financiado se cuenta en
 * contratos, igual que en el muro de aliados. Lo que no se pudo leer dice
 * "Sin dato"; nunca un cero que parezca un dato.
 */
function BalanceLectura({
  estado,
  publicados,
  leidos,
  conCola,
}: {
  estado: EstadoGlobal | null;
  /** Contratos publicados en la base (resumen de /contratos). */
  publicados: number | null;
  /** Leídos por cualquier vía (misma cifra que la portada). */
  leidos: number | null;
  /** Respaldo de "regiones con cola" si el estado no lo trae. */
  conCola: number;
}) {
  const base = publicados != null && publicados > 0 && leidos != null ? { publicados, leidos } : null;
  const pct = base ? (base.leidos / base.publicados) * 100 : 0;
  const anchoLeido = base ? Math.max(0.8, pct) : 0;

  return (
    <div className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <p className="text-[13px] leading-relaxed text-inkSoft">
        De los{" "}
        <strong className="font-mono font-semibold tabular-nums text-ink">{numero(publicados)}</strong> contratos
        publicados que Vigía tiene descargados, se han leído
      </p>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        {leidos != null ? (
          <span className="font-display text-4xl font-extrabold leading-none tabular-nums text-ink">{numero(leidos)}</span>
        ) : (
          <span className="text-lg font-semibold text-mute">Sin dato</span>
        )}
        {base && (
          <span className="text-sm text-inkSoft">{porcentaje(pct, { decimales: pct < 1 ? 2 : 1 })} del total</span>
        )}
      </div>

      {base && (
        <div
          className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep"
          role="img"
          aria-label={`${numero(base.leidos)} contratos leídos de ${numero(base.publicados)} publicados`}
        >
          <div className="h-full rounded-full bg-moss" style={{ width: `${anchoLeido}%` }} />
        </div>
      )}

      {estado ? (
        <dl className="mt-4 space-y-2 border-t border-line pt-3 text-[13px]">
          <Fila termino="Financiados">
            <strong className="font-mono tabular-nums text-ink">{numero(estado.contratosFinanciados)}</strong> contratos
            {estado.regionesConAuditoria > 0 && (
              <> en {estado.regionesConAuditoria === 1 ? "1 región" : `${numero(estado.regionesConAuditoria)} regiones`}</>
            )}
            {estado.financiadores > 0 && <>, de {estado.financiadores === 1 ? "1 aliado" : `${numero(estado.financiadores)} aliados`}</>}
          </Fila>
          <Fila termino="Financiados leídos">
            <strong className="font-mono tabular-nums text-ink">{numero(estado.contratosProcesados)}</strong> de{" "}
            {numero(estado.contratosFinanciados)}
          </Fila>
          <Fila termino="Financiados con señales">
            <strong className="font-mono tabular-nums text-ink">{numero(estado.senalesHalladas)}</strong> de los{" "}
            {numero(estado.contratosProcesados)} financiados leídos
          </Fila>
          <Fila termino="En cola">
            <strong className="font-mono tabular-nums text-ink">{numero(estado.colaGlobal)}</strong> esperan financiamiento, en{" "}
            {numero(estado.regionesConCola ?? conCola)} regiones
          </Fila>
        </dl>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-[13px] leading-relaxed text-mute">
          No se pudo leer el estado del financiamiento ahora mismo. Preferimos decirlo antes que mostrar cifras en cero
          que parezcan un dato.
        </p>
      )}
    </div>
  );
}

function Fila({ termino, children }: { termino: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-inkSoft">{termino}</dt>
      <dd className="text-right text-inkSoft">{children}</dd>
    </div>
  );
}

function Regla({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-paper/15 bg-paper/[0.06] p-4">
      <p className="text-sm font-semibold text-paper">{titulo}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-paper/75">{children}</p>
    </li>
  );
}
