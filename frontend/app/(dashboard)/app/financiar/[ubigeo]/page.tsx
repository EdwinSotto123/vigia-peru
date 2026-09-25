import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ChevronRight, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { Avatar } from "@/components/financiar/RankingTable";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TarjetaConfirmacion } from "@/components/financiar/TarjetaConfirmacion";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { ESTADO_LABEL, ESTADO_PUNTO, alcanceCorto, alcanceLargo, getPago, getZona } from "@/lib/financiamiento";
import { numero, porcentaje, soles } from "@/lib/formato";
import { getProcesamientos } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ubigeo: string } }) {
  const d = await getZona(params.ubigeo);
  return { title: d ? `Financiar auditoría en ${d.zona.nombre}` : "Zona no encontrada" };
}

const NIVEL: Record<string, string> = { departamento: "Región", provincia: "Provincia", distrito: "Distrito" };

/** Porcentaje legible: con un decimal bajo 10 %, entero arriba ("0.3 %", "42 %"). */
const pctTxt = (v: number) => porcentaje(v, { decimales: v > 0 && v < 10 ? 1 : 0 });

/**
 * Ficha de una zona para financiar su lectura. Una sola pregunta: ¿cuántos contratos de
 * esta zona quieres que se lean? La respuesta (el formulario, o por qué hoy no se puede)
 * va primero en el celular y pegada a la derecha en escritorio; a la izquierda, lo que
 * hace falta para decidir: cuánto hay en cola, cuánto ya se financió y leyó, y quién.
 */
export default async function ZonaPage({ params }: { params: { ubigeo: string } }) {
  const [d, pago] = await Promise.all([getZona(params.ubigeo), getPago()]);
  if (!d) notFound();
  const { zona, breadcrumb, hijas, aliados, cola } = d;
  const enVivo = zona.financiados > 0 ? await getProcesamientos({ ubigeo: zona.ubigeo, limit: 60 }) : null;
  const metodos = pago ? [pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[] : [];
  // Una sola base para "en cola" en toda la página: lo que nadie financió todavía (`pendientes`).
  // `totalCola` = pendientes + financiados; usarlo como "en cola" hacía que la misma zona dijera
  // 604 arriba y 594 en el formulario.
  const enCola = zona.pendientes;
  const pFin = zona.totalCola > 0 ? Math.min(100, (zona.financiados / zona.totalCola) * 100) : 0;
  const pProc = zona.totalCola > 0 ? Math.min(100, (zona.procesados / zona.totalCola) * 100) : 0;
  const padre = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;
  const enRevision = zona.enRevision ?? 0;

  return (
    <div className="container-page py-8 sm:py-10">
      <nav aria-label="Ubicación" className="flex flex-wrap items-center gap-1 text-sm text-inkSoft">
        <Link href="/app/financiar" className="inline-flex min-h-[24px] items-center underline-offset-2 hover:text-ink hover:underline">Perú</Link>
        {breadcrumb.map((b) => (
          <span key={b.ubigeo} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-mute" aria-hidden />
            {b.ubigeo === zona.ubigeo ? (
              <span className="text-ink" aria-current="page">{b.nombre}</span>
            ) : (
              <Link href={`/app/financiar/${b.ubigeo}`} className="inline-flex min-h-[24px] items-center underline-offset-2 hover:text-ink hover:underline">{b.nombre}</Link>
            )}
          </span>
        ))}
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0 space-y-6">
          {/* Identidad de la zona: nombre, qué es y en qué estado está. Sin kicker encima del título. */}
          <header>
            <h1 className="font-display text-[32px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[40px]">{zona.nombre}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-inkSoft">
              <span>{NIVEL[zona.nivel] ?? zona.nivel}</span>
              <span className="pill border-line bg-paper text-inkSoft">
                <span className={cn("h-2 w-2 rounded-full", ESTADO_PUNTO[zona.estado])} aria-hidden />
                {ESTADO_LABEL[zona.estado]}
              </span>
            </p>
          </header>

          {/* Progreso: cifras reales desde el servidor, cada una con su contexto. */}
          <section aria-labelledby="progreso-titulo" className="rounded-2xl border border-line bg-paper p-5">
            <h2 id="progreso-titulo" className="sr-only">Cuánto se financió y se leyó en {zona.nombre}</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Dato etiqueta="En cola" valor={numero(enCola)} contexto={`esperan financiamiento (${alcanceCorto(d.alcance)})`} />
              <Dato etiqueta="Costo de leerlos" valor={soles(enCola * zona.precioPen)} contexto={`${soles(zona.precioPen)} por contrato`} />
              <Dato etiqueta="Financiados" valor={numero(zona.financiados)} contexto={`de ${numero(zona.totalCola)} que entraron a la cola`} />
              <Dato
                etiqueta="Financiados leídos"
                valor={numero(zona.procesados)}
                contexto={
                  zona.financiados > 0 ? (
                    <>
                      de {numero(zona.financiados)}; {numero(zona.senales)} con señales
                      {enRevision > 0 && <>, {numero(enRevision)} en revisión</>}
                    </>
                  ) : (
                    "ningún contrato financiado todavía"
                  )
                }
              />
            </dl>
            <div className="mt-5">
              <div
                className="relative h-2.5 overflow-hidden rounded-full bg-paperDeep"
                role="img"
                aria-label={`${pctTxt(pFin)} financiado y ${pctTxt(pProc)} leído de ${numero(zona.totalCola)} contratos`}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-granate-300" style={{ width: `${pFin > 0 ? Math.max(1, pFin) : 0}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-moss" style={{ width: `${pProc > 0 ? Math.max(1, pProc) : 0}%` }} />
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-inkSoft">
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-granate-300" aria-hidden /> Financiado: <span className="font-mono tabular-nums text-ink">{pctTxt(pFin)}</span>
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-moss" aria-hidden /> Leído: <span className="font-mono tabular-nums text-ink">{pctTxt(pProc)}</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Qué hay en la cola */}
          <section aria-labelledby="cola-titulo" className="rounded-2xl border border-line bg-paper p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="cola-titulo" className="font-display text-lg font-bold text-ink">Qué hay en la cola</h2>
              <Link href={`/app/contratos?ubigeo=${zona.ubigeo}`} className="inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline">
                Ver los contratos <ChevronRight size={13} aria-hidden />
              </Link>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-inkSoft">
              Los contratos son públicos y puedes verlos, pero se leen en orden de llegada: quien financia no elige cuáles.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <DatoCola etiqueta="Contratos en cola" valor={numero(cola.contratos)} nota={alcanceCorto(d.alcance)} />
              <DatoCola etiqueta="Valor referencial" valor={soles(cola.montoReferencial)} nota="lo convocado, no lo pagado" />
              <DatoCola etiqueta="Entidades" valor={numero(cola.entidades)} />
              <DatoCola etiqueta="Documentos listos" valor={numero(cola.documentosListos)} nota="de tipos que aún no entran a la cola" />
            </dl>
            <details className="mt-3 text-[13px] text-inkSoft">
              <summary className="inline-flex min-h-[24px] cursor-pointer select-none items-center font-medium text-granate underline decoration-dotted underline-offset-2">
                ¿Qué se lee hoy?
              </summary>
              <p className="mt-1 leading-relaxed">{alcanceLargo(d.alcance)}</p>
            </details>
          </section>

          {/* En vivo ahora */}
          <section aria-labelledby="vivo-titulo" className="rounded-2xl border border-line bg-paper p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="vivo-titulo" className="inline-flex items-center gap-2 font-display text-lg font-bold text-ink">
                <Activity size={16} className={zona.financiados > 0 ? "text-moss" : "text-mute"} aria-hidden />
                En vivo en {zona.nombre}
              </h2>
              {zona.financiados > 0 && (
                <Link href={`/app/auditoria?ubigeo=${zona.ubigeo.slice(0, 2)}`} className="inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline">
                  Ver el tablero completo <ChevronRight size={13} aria-hidden />
                </Link>
              )}
            </div>
            {zona.financiados > 0 ? (
              <div className="mt-3">
                <TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} limit={60} initial={enVivo} compacto />
              </div>
            ) : (
              <p className="mt-1 text-sm leading-relaxed text-inkSoft">
                Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola a la lectura.
              </p>
            )}
          </section>

          {/* Zonas hijas */}
          {hijas.length > 0 && (
            <section aria-labelledby="hijas-titulo">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="hijas-titulo" className="font-display text-lg font-bold text-ink">{zona.nivel === "departamento" ? "Provincias" : "Distritos"}</h2>
                <span className="text-[12px] text-mute">financiados / en cola</span>
              </div>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                {hijas.map((h) => (
                  <li key={h.ubigeo}>
                    <Link href={`/app/financiar/${h.ubigeo}`} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-paperSoft">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", ESTADO_PUNTO[h.estado])} aria-hidden />
                        <span className="sr-only">{ESTADO_LABEL[h.estado]}:</span>
                        <span className="truncate font-medium text-ink">{h.nombre}</span>
                      </span>
                      {h.totalCola > 0 ? (
                        <span className="shrink-0 font-mono text-[12px] tabular-nums text-inkSoft">
                          {numero(h.financiados)}<span className="text-mute"> / </span>{numero(h.pendientes)}
                          <span className="sr-only"> ({numero(h.financiados)} financiados, {numero(h.pendientes)} en cola)</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[12px] text-mute">sin contratos en cola</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Aliados: reconocimiento en contratos, nunca en soles */}
          <section aria-labelledby="aliados-titulo">
            <h2 id="aliados-titulo" className="font-display text-lg font-bold text-ink">Quién financió la lectura aquí</h2>
            {aliados.length ? (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {aliados.map((a) => (
                  <li key={a.nombre + a.contratos} className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-3 py-2.5">
                    <Avatar tipo={a.tipo} logoUrl={a.logoUrl} nombre={a.nombre} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {a.slug ? <Link href={`/aliado/${a.slug}`} className="underline-offset-2 hover:underline">{a.nombre}</Link> : a.nombre}
                      </p>
                      <p className="text-[12px] text-mute">
                        <span className="font-mono tabular-nums">{numero(a.contratos)}</span> {a.contratos === 1 ? "contrato financiado" : "contratos financiados"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-inkSoft">
                Nadie ha financiado la lectura de {zona.nombre} todavía. El primer aporte abre esta lista.
              </p>
            )}
          </section>

          <p className="flex items-start gap-2.5 rounded-2xl bg-paperSoft p-4 text-[13px] leading-relaxed text-inkSoft">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />
            <span>
              Financias capacidad de lectura. Los contratos se asignan por antigüedad y los resultados se publican aunque
              señalen a quien financió.{" "}
              <Link href="/app/financiar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>.
            </span>
          </p>
        </div>

        {/* En móvil la respuesta va PRIMERO (se llega desde "Financiar esta zona"); en escritorio, columna derecha pegajosa. */}
        <div className="order-first lg:order-last lg:sticky lg:top-24 lg:self-start" id="aportar">
          {zona.totalCola > 0 ? (
            <ContribuirForm
              ubigeo={zona.ubigeo}
              zonaNombre={zona.nombre}
              precioPen={zona.precioPen}
              restantes={enCola}
              metodos={metodos}
              pagoConfigurado={!!pago?.configurado}
              padre={padre ? { ubigeo: padre.ubigeo, nombre: padre.nombre } : null}
              financiados={zona.financiados}
              procesados={zona.procesados}
            />
          ) : (
            <TarjetaConfirmacion
              titulo={`Todavía no hay contratos de ${zona.nombre} en la cola`}
              acciones={
                padre ? (
                  <EnlaceAccion href={`/app/financiar/${padre.ubigeo}`}>Ver {padre.nombre}</EnlaceAccion>
                ) : (
                  <EnlaceAccion href="/app/financiar#zonas">Elegir otra zona</EnlaceAccion>
                )
              }
            >
              Cuando el OECE publique contratos de esta zona que entren a la cola, podrás financiar su lectura aquí.
              Mientras tanto, mira una zona vecina.
            </TarjetaConfirmacion>
          )}
        </div>
      </div>
    </div>
  );
}

/** Una cifra de la ficha con su contexto. Valor ya formateado en el servidor: se ve igual antes y después de hidratar. */
function Dato({ etiqueta, valor, contexto }: { etiqueta: string; valor: string; contexto: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold text-ink">{etiqueta}</dt>
      <dd className="mt-1 font-display text-xl font-extrabold leading-none tabular-nums text-ink sm:text-2xl">{valor}</dd>
      <dd className="mt-1 text-[12px] leading-snug text-mute">{contexto}</dd>
    </div>
  );
}

/** Dato de la cola: etiqueta, valor en mono y, si hace falta, qué significa. */
function DatoCola({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-mute">{etiqueta}</dt>
      <dd className={cn("font-mono tabular-nums", valor === "Sin dato" ? "text-mute" : "text-ink")}>{valor}</dd>
      {nota && <dd className="text-[11px] leading-snug text-mute">{nota}</dd>}
    </div>
  );
}
