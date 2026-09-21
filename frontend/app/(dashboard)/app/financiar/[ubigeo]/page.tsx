import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ChevronRight, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { Avatar } from "@/components/financiar/RankingTable";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { ESTADO_FILL, ESTADO_LABEL, alcanceCorto, alcanceLargo, formatPEN, getPago, getZona, pct } from "@/lib/financiamiento";
import { getProcesamientos } from "@/lib/auditoria";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ubigeo: string } }) {
  const d = await getZona(params.ubigeo);
  return { title: d ? `Financiar auditoría · ${d.zona.nombre} — Vigía Perú` : "Zona — Vigía Perú" };
}

export default async function ZonaPage({ params }: { params: { ubigeo: string } }) {
  const [d, pago] = await Promise.all([getZona(params.ubigeo), getPago()]);
  if (!d) notFound();
  const { zona, breadcrumb, hijas, aliados, cola } = d;
  const enVivo = zona.financiados > 0 ? await getProcesamientos({ ubigeo: zona.ubigeo, limit: 60 }) : null;
  const metodos = pago ? [pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[] : [];
  const restantes = Math.max(0, zona.totalCola - zona.financiados);
  const pFin = pct(zona.financiados, zona.totalCola);
  const pProc = pct(zona.procesados, zona.totalCola);

  return (
    <div className="container-page py-10">
      {/* breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-mute">
        <Link href="/app/financiar" className="hover:underline">Perú</Link>
        {breadcrumb.map((b) => (
          <span key={b.ubigeo} className="flex items-center gap-1">
            <ChevronRight size={14} />
            {b.ubigeo === zona.ubigeo ? <span className="text-ink">{b.nombre}</span> : <Link href={`/app/financiar/${b.ubigeo}`} className="hover:underline">{b.nombre}</Link>}
          </span>
        ))}
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-mute">{zona.nivel}</div>
          <h1 className="font-serif text-4xl font-bold text-ink sm:text-5xl">{zona.nombre}</h1>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-mute">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[zona.estado] }} />
            {ESTADO_LABEL[zona.estado]}
          </div>

          {/* progreso */}
          <div className="mt-6 rounded-2xl border border-line bg-paper p-5 shadow-card">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Big label={`En cola (${alcanceCorto(d.alcance)})`} v={zona.totalCola} unit="contratos" />
              <Big label="Costo de auditarla" v={zona.totalCola * zona.precioPen} format="pen" />
              <Big label="Financiados" v={zona.financiados} unit={`de ${zona.totalCola}`} />
              <Big label="Procesados" v={zona.procesados} unit={`${zona.senales} señales${(zona.enRevision ?? 0) > 0 ? ` · ${zona.enRevision} en revisión humana` : ""}`} />
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-mute"><span>financiado {pFin}%</span><span>procesado {pProc}%</span></div>
              <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-paperDeep">
                <div className="absolute inset-y-0 left-0 rounded-full bg-amber" style={{ width: `${pFin}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-moss" style={{ width: `${pProc}%` }} />
              </div>
            </div>
          </div>

          {/* qué hay en la cola */}
          <div className="mt-6 rounded-2xl border border-line bg-paper p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Qué hay en la cola</h2>
              <Link href={`/app/contratos?ubigeo=${zona.ubigeo}`} className="text-xs text-mute hover:underline">Ver los contratos →</Link>
            </div>
            <p className="mt-1 text-sm text-mute">
              Los contratos son públicos y puedes verlos, pero se procesan en orden de llegada: el financiador no elige cuáles.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Contratos en cola</dt><dd className="font-mono text-ink">{cola.contratos.toLocaleString("es-PE")}</dd><dd className="text-[10px] text-mute">{alcanceCorto(d.alcance)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Monto contratado</dt><dd className="font-mono text-ink">{formatPEN(cola.montoReferencial)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Entidades</dt><dd className="font-mono text-ink">{cola.entidades}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Documentos listos</dt><dd className="font-mono text-ink">{(cola.documentosListos ?? 0).toLocaleString("es-PE")}</dd><dd className="text-[10px] text-mute">otros tipos · análisis en preparación</dd></div>
            </dl>
            <details className="mt-3 text-[12px] text-mute">
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
                <Link href={`/app/auditoria?ubigeo=${zona.ubigeo.slice(0, 2)}`} className="text-xs text-mute hover:underline">
                  Ver tablero completo →
                </Link>
              )}
            </div>
            {zona.financiados > 0 ? (
              <div className="mt-3">
                <TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} limit={60} initial={enVivo} compacto />
              </div>
            ) : (
              <p className="mt-1 text-sm text-mute">
                Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis.
              </p>
            )}
          </div>

          {/* hijas */}
          {hijas.length > 0 && (
            <div className="mt-6">
              <h2 className="font-semibold text-ink">{zona.nivel === "departamento" ? "Provincias" : "Distritos"}</h2>
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
                {hijas.map((h) => (
                  <li key={h.ubigeo} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/app/financiar/${h.ubigeo}`} className="flex items-center gap-2 hover:underline">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[h.estado] }} />
                      {h.nombre}
                    </Link>
                    <span className="font-mono text-xs text-mute">{h.totalCola > 0 ? `${h.financiados}/${h.totalCola}` : "—"}</span>
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
                      <div className="text-[11px] text-mute">{a.contratos} contratos</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-mute">Nadie ha financiado esta zona todavía. El primer aporte abre la auditoría.</p>
            )}
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[13px] text-mute">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-moss" />
            <span>Financias capacidad de análisis. Los contratos se asignan por antigüedad y los resultados se publican aunque señalen al financiador. <Link href="/app/financiar#independencia" className="underline">Reglas de independencia</Link>.</span>
          </div>
        </div>

        {/* En móvil el formulario va PRIMERO (se llega desde "Financiar esta zona"); en escritorio, columna derecha pegajosa. */}
        <div className="order-first lg:order-last lg:sticky lg:top-24 lg:self-start" id="aportar">
          {zona.totalCola > 0 ? (
            <ContribuirForm ubigeo={zona.ubigeo} zonaNombre={zona.nombre} precioPen={zona.precioPen} restantes={restantes || zona.totalCola} metodos={metodos} />
          ) : (
            <div className="rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
              Todavía no ingresamos contratos de <strong className="text-ink">{zona.nombre}</strong>. La ingesta diaria del OECE los va sumando; vuelve pronto o financia una zona vecina.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Big({ label, v, unit, format = "entero" }: { label: string; v: number; unit?: string; format?: "entero" | "pen" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      {/* NumberTicker: mismas 4 cifras protagonistas de la ficha de zona, antes estáticas. */}
      <div className="font-mono text-2xl font-semibold text-ink">
        <NumberTicker value={v} format={format} />
      </div>
      {unit && <div className="text-[11px] text-mute">{unit}</div>}
    </div>
  );
}
