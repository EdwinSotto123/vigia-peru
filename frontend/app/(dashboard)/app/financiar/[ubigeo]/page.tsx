import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ChevronRight, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { Avatar } from "@/components/financiar/RankingTable";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { ESTADO_FILL, ESTADO_LABEL, alcanceCorto, alcanceLargo, formatPEN, getPago, getZona, pct } from "@/lib/financiamiento";
import { getProcesamientos } from "@/lib/auditoria";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ubigeo: string } }) {
  const d = await getZona(params.ubigeo);
  return { title: d ? `Financiar auditoría en ${d.zona.nombre}` : "Zona no encontrada" };
}

const num = (n: number) => n.toLocaleString("es-PE");

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
  const pFin = pct(zona.financiados, zona.totalCola);
  const pProc = pct(zona.procesados, zona.totalCola);
  const padre = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;

  return (
    <div className="container-page py-10">
      {/* breadcrumb */}
      <nav aria-label="Ubicación" className="flex flex-wrap items-center gap-1 text-sm text-inkSoft">
        <Link href="/app/financiar" className="hover:underline">Perú</Link>
        {breadcrumb.map((b) => (
          <span key={b.ubigeo} className="flex items-center gap-1">
            <ChevronRight size={14} aria-hidden />
            {b.ubigeo === zona.ubigeo ? <span className="text-ink" aria-current="page">{b.nombre}</span> : <Link href={`/app/financiar/${b.ubigeo}`} className="hover:underline">{b.nombre}</Link>}
          </span>
        ))}
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-mute">{zona.nivel}</div>
          <h1 className="font-serif text-4xl font-bold text-ink sm:text-5xl">{zona.nombre}</h1>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-inkSoft">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[zona.estado] }} aria-hidden />
            {ESTADO_LABEL[zona.estado]}
          </div>

          {/* progreso: cifras reales desde el servidor, sin contadores que arrancan en 0 */}
          <div className="mt-6 rounded-2xl border border-line bg-paper p-5 shadow-card">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Big label="En cola" v={num(enCola)} unit={`sin financiar (${alcanceCorto(d.alcance)})`} />
              <Big label="Costo de leerlos" v={formatPEN(enCola * zona.precioPen)} unit={`${formatPEN(zona.precioPen)} por contrato`} />
              <Big label="Financiados" v={num(zona.financiados)} unit={`de ${num(zona.totalCola)} en total`} />
              <Big label="Leídos" v={num(zona.procesados)} unit={`${num(zona.senales)} con señal${(zona.enRevision ?? 0) > 0 ? `, ${num(zona.enRevision ?? 0)} en revisión humana` : ""}`} />
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-inkSoft"><span>financiado {pFin}%</span><span>leído {pProc}%</span></div>
              <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-paperDeep" role="img" aria-label={`${pFin}% financiado y ${pProc}% leído de ${num(zona.totalCola)} contratos`}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-amber" style={{ width: `${pFin}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-moss" style={{ width: `${pProc}%` }} />
              </div>
            </div>
          </div>

          {/* qué hay en la cola */}
          <div className="mt-6 rounded-2xl border border-line bg-paper p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Qué hay en la cola</h2>
              <Link href={`/app/contratos?ubigeo=${zona.ubigeo}`} className="inline-flex items-center gap-1 text-xs text-inkSoft hover:underline">Ver los contratos <ChevronRight size={12} aria-hidden /></Link>
            </div>
            <p className="mt-1 text-sm text-inkSoft">
              Los contratos son públicos y puedes verlos, pero se leen en orden de llegada: quien financia no elige cuáles.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Contratos en cola</dt><dd className="font-mono text-ink">{num(cola.contratos)}</dd><dd className="text-[10px] text-mute">{alcanceCorto(d.alcance)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Monto contratado</dt><dd className="font-mono text-ink">{formatPEN(cola.montoReferencial)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Entidades</dt><dd className="font-mono text-ink">{num(cola.entidades)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Documentos listos</dt><dd className="font-mono text-ink">{num(cola.documentosListos ?? 0)}</dd><dd className="text-[10px] text-mute">otros tipos, análisis en preparación</dd></div>
            </dl>
            <details className="mt-3 text-[12px] text-inkSoft">
              <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2 hover:text-ink">¿Qué se analiza hoy?</summary>
              <p className="mt-1 leading-relaxed">{alcanceLargo(d.alcance)}</p>
            </details>
          </div>

          {/* en vivo ahora */}
          <div className="mt-6 rounded-2xl border border-line bg-paper p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 font-semibold text-ink">
                <Activity size={16} className={zona.financiados > 0 ? "text-moss" : "text-mute"} aria-hidden />
                En vivo ahora en {zona.nombre}
              </h2>
              {zona.financiados > 0 && (
                <Link href={`/app/auditoria?ubigeo=${zona.ubigeo.slice(0, 2)}`} className="inline-flex items-center gap-1 text-xs text-inkSoft hover:underline">
                  Ver tablero completo <ChevronRight size={12} aria-hidden />
                </Link>
              )}
            </div>
            {zona.financiados > 0 ? (
              <div className="mt-3">
                <TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} limit={60} initial={enVivo} compacto />
              </div>
            ) : (
              <p className="mt-1 text-sm text-inkSoft">
                Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis.
              </p>
            )}
          </div>

          {/* hijas */}
          {hijas.length > 0 && (
            <div className="mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-ink">{zona.nivel === "departamento" ? "Provincias" : "Distritos"}</h2>
                <span className="text-[11px] text-mute">financiados / en cola</span>
              </div>
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
                {hijas.map((h) => (
                  <li key={h.ubigeo} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <Link href={`/app/financiar/${h.ubigeo}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ESTADO_FILL[h.estado] }} aria-hidden />
                      <span className="truncate">{h.nombre}</span>
                    </Link>
                    {h.totalCola > 0 ? (
                      <span className="shrink-0 font-mono text-xs text-inkSoft">
                        {num(h.financiados)}<span className="text-mute"> / </span>{num(h.pendientes)}
                        <span className="sr-only"> ({num(h.financiados)} financiados, {num(h.pendientes)} en cola)</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-mute">sin contratos en cola</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* aliados */}
          <div className="mt-6">
            <h2 className="font-semibold text-ink">Auditoría financiada por</h2>
            {aliados.length ? (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {aliados.map((a) => (
                  <li key={a.nombre + a.contratos} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <Avatar tipo={a.tipo} logoUrl={a.logoUrl} nombre={a.nombre} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{a.slug ? <Link href={`/aliado/${a.slug}`} className="hover:underline">{a.nombre}</Link> : a.nombre}</div>
                      <div className="text-[11px] text-mute">{num(a.contratos)} contratos</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-inkSoft">Nadie ha financiado esta zona todavía.</p>
            )}
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[13px] text-inkSoft">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            <span>Financias capacidad de análisis. Los contratos se asignan por antigüedad y los resultados se publican aunque señalen al financiador. <Link href="/app/financiar#independencia" className="underline">Reglas de independencia</Link>.</span>
          </div>
        </div>

        {/* En móvil el formulario va PRIMERO (se llega desde "Financiar esta zona"); en escritorio, columna derecha pegajosa. */}
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
            <div className="rounded-2xl border border-dashed border-line p-6 text-sm text-inkSoft">
              Todavía no ingresamos contratos de <strong className="text-ink">{zona.nombre}</strong>. La ingesta diaria del OECE los va sumando; vuelve pronto o mira una zona vecina.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Cifra protagonista de la ficha. Valor ya formateado en el servidor: se ve igual antes y después de hidratar. */
function Big({ label, v, unit }: { label: string; v: string; unit?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="font-mono text-2xl font-semibold tabular-nums text-ink">{v}</div>
      {unit && <div className="text-[11px] leading-snug text-inkSoft">{unit}</div>}
    </div>
  );
}
