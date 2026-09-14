import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { Avatar } from "@/components/financiar/RankingTable";
import { ESTADO_FILL, ESTADO_LABEL, formatPEN, getPago, getZona, pct } from "@/lib/financiamiento";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ubigeo: string } }) {
  const d = await getZona(params.ubigeo);
  return { title: d ? `Financiar auditoría · ${d.zona.nombre} — Vigía Perú` : "Zona — Vigía Perú" };
}

export default async function ZonaPage({ params }: { params: { ubigeo: string } }) {
  const [d, pago] = await Promise.all([getZona(params.ubigeo), getPago()]);
  if (!d) notFound();
  const { zona, breadcrumb, hijas, aliados, cola } = d;
  const metodos = pago ? [pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[] : [];
  const restantes = Math.max(0, zona.totalCola - zona.financiados);
  const pFin = pct(zona.financiados, zona.totalCola);
  const pProc = pct(zona.procesados, zona.totalCola);

  return (
    <div className="container-page py-10">
      {/* breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-mute">
        <Link href="/financiar" className="hover:underline">Perú</Link>
        {breadcrumb.map((b) => (
          <span key={b.ubigeo} className="flex items-center gap-1">
            <ChevronRight size={14} />
            {b.ubigeo === zona.ubigeo ? <span className="text-ink">{b.nombre}</span> : <Link href={`/financiar/${b.ubigeo}`} className="hover:underline">{b.nombre}</Link>}
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
          <div className="mt-6 rounded-2xl border border-line p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Big label="Cola de auditoría" v={zona.totalCola} unit="contratos" />
              <Big label="Costo de auditarla" v={zona.totalCola * zona.precioPen} prefix="S/ " />
              <Big label="Financiados" v={zona.financiados} unit={`de ${zona.totalCola}`} />
              <Big label="Procesados" v={zona.procesados} unit={`${zona.senales} señales`} />
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
          <div className="mt-6 rounded-2xl border border-line p-5">
            <h2 className="font-semibold text-ink">Qué hay en la cola</h2>
            <p className="mt-1 text-sm text-mute">
              Lo que sabemos de los contratos pendientes — sin listarlos uno por uno, porque el financiador no elige cuáles se procesan.
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Contratos</dt><dd className="font-mono text-ink">{cola.contratos.toLocaleString("es-PE")}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Monto contratado</dt><dd className="font-mono text-ink">{formatPEN(cola.montoReferencial)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-mute">Entidades</dt><dd className="font-mono text-ink">{cola.entidades}</dd></div>
            </dl>
          </div>

          {/* hijas */}
          {hijas.length > 0 && (
            <div className="mt-6">
              <h2 className="font-semibold text-ink">{zona.nivel === "departamento" ? "Provincias" : "Distritos"}</h2>
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
                {hijas.map((h) => (
                  <li key={h.ubigeo} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/financiar/${h.ubigeo}`} className="flex items-center gap-2 hover:underline">
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
            <span>Financias capacidad de análisis. Los contratos se asignan por antigüedad y los resultados se publican aunque señalen al financiador. <Link href="/financiar#independencia" className="underline">Reglas de independencia</Link>.</span>
          </div>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
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

function Big({ label, v, unit, prefix = "" }: { label: string; v: number; unit?: string; prefix?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="font-mono text-2xl font-semibold text-ink">{prefix}{v.toLocaleString("es-PE")}</div>
      {unit && <div className="text-[11px] text-mute">{unit}</div>}
    </div>
  );
}
