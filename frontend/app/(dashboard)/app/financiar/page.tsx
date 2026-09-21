import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck, Landmark } from "lucide-react";
import { ZonaPicker } from "@/components/financiar/ZonaPicker";
import { RankingTable } from "@/components/financiar/RankingTable";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { getEstadoGlobal, getRanking, getRecientes, getZonas, formatPEN } from "@/lib/financiamiento";

export const metadata = {
  title: "Financia una auditoría — Vigía Perú",
  description:
    "Cada región del Perú tiene contratos públicos que nadie ha leído. Financia la capacidad de auditarlos: S/ 3 por contrato, resultados públicos, reconocimiento verificable.",
};

export const revalidate = 120;

export default async function FinanciarPage({ searchParams }: { searchParams?: { ubigeo?: string } }) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);
  const [zonas, estado, ranking, recientes] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getRanking("todo"),
    getRecientes(),
  ]);
  const precio = estado?.tarifa.precioPen ?? 3;
  const conCola = (zonas ?? []).filter((z) => z.totalCola > 0).length;

  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="border-b border-line bg-paperDeep">
        <div className="container-page grid gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
              <Landmark size={12} /> Financiamiento de auditoría independiente
            </span>
            <h1 className="mt-5 font-serif text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
              El Estado publica todos sus contratos.<br />
              <em className="text-clay">Nadie tiene capacidad de leerlos.</em>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
              Vigía lee contratos públicos con un pipeline de 11 agentes y publica las señales de riesgo.
              Cada contrato cuesta <strong className="text-ink">{formatPEN(precio)}</strong> de cómputo e IA.
              Elige una zona y <strong className="text-ink">financia la capacidad de auditar</strong> sus
              contratos pendientes. Los resultados son públicos, siempre.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#zonas" className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]">
                Elegir mi zona <ArrowRight size={16} />
              </a>
              <a href="#independencia" className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep">
                <ShieldCheck size={16} /> Cómo se protege la independencia
              </a>
            </div>
          </div>

          {/* Métricas globales */}
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Contratos financiados" value={estado?.contratosFinanciados ?? 0} />
            <Metric label="Destinado a auditoría" value={estado?.montoPen ?? 0} prefix="S/ " />
            <Metric label="Contratos procesados" value={estado?.contratosProcesados ?? 0} />
            <Metric label="Señales de riesgo halladas" value={estado?.senalesHalladas ?? 0} />
            <Metric label="Regiones con auditoría activa" value={estado?.regionesConAuditoria ?? 0} />
            <Metric label="Contratos en cola hoy" value={estado?.colaGlobal ?? 0} hint={`${conCola} regiones`} />
          </div>
        </div>
      </section>

      {/* ─── ELIGE TU ZONA (sin mapa: el mapa vive en /app/mapa) ─── */}
      <section id="zonas" className="container-page scroll-mt-20 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl font-bold text-ink">Elige la zona que quieres auditar</h2>
            <p className="mt-1 max-w-2xl text-sm text-mute">
              Busca tu departamento, provincia o distrito. Verás cuántos contratos esperan lectura y cuánto cuesta cubrirlos.
              Si prefieres verlo en el mapa, <Link href="/app/mapa" className="underline">ábrelo aquí</Link>.
            </p>
          </div>
          <div className="text-xs text-mute">Fuente: SEACE/OECE vía OCDS · actualizado a diario</div>
        </div>
        <ZonaPicker zonas={zonas ?? []} precioPen={precio} />
      </section>

      {/* ─── RANKING + RECIENTES ─── */}
      <section className="container-page grid gap-10 py-16 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-3xl font-bold text-ink">Ranking de impacto</h2>
            <span className="text-xs text-mute">se cuenta en contratos, no en soles</span>
          </div>
          <div className="mt-4">
            <RankingTable rows={ranking ?? []} />
          </div>
        </div>
        <div>
          <h2 className="font-serif text-3xl font-bold text-ink">Últimos aportes</h2>
          <div className="mt-4">
            <RecientesFeed items={recientes ?? []} />
          </div>
        </div>
      </section>

      {/* ─── INDEPENDENCIA ─── */}
      <section id="independencia" className="scroll-mt-20 border-t border-line bg-ink py-16 text-paper">
        <div className="container-page grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <ShieldCheck size={28} className="text-amber" />
            <h2 className="mt-4 font-serif text-3xl font-bold">Financias capacidad, no resultados</h2>
            <p className="mt-3 text-paper/70">
              Esto no es comprar una región ni patrocinar un informe. Es pagar el cómputo para que contratos
              que ya son públicos sean, por fin, leídos. Las reglas están en el código, no en una promesa.
            </p>
            <Link href="/preguntas#cuentas" className="mt-4 inline-block text-sm text-amber underline-offset-2 hover:underline">
              Ver el balance público y el código →
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            <Rule title="Sin selección">La asignación es FIFO por zona, en SQL. Ninguna API acepta un contrato elegido por el financiador.</Rule>
            <Rule title="Sin edición">El pipeline de análisis no lee quién financió. Los prompts no reciben ese dato.</Rule>
            <Rule title="Conflicto automático">Empresa con sanción vigente o con alertas activas en la zona: el aporte procesa contratos igual, pero no aparece en ranking ni muro.</Rule>
            <Rule title="Publicación incondicional">Si el análisis que financiaste te detecta a ti, se publica igual. Tu comprobante lo mostrará.</Rule>
            <Rule title="Reconocimiento aditivo">Varios aliados pueden apoyar la misma zona. Nadie la "tiene".</Rule>
            <Rule title="Trazabilidad">Cada comprobante enlaza a los dossiers y a la traza de observabilidad de cada contrato.</Rule>
          </ul>
        </div>
      </section>

    </div>
  );
}

function Metric({ label, value, prefix = "", hint }: { label: string; value: number; prefix?: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-2xl font-semibold text-ink">
        {prefix}{value.toLocaleString("es-PE")}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-mute">{label}</div>
      {hint && <div className="text-[11px] text-mute">{hint}</div>}
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-paper/15 bg-paper/5 p-4">
      <div className="text-sm font-semibold text-paper">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-paper/65">{children}</p>
    </li>
  );
}
