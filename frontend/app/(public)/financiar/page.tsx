import Link from "next/link";
import { ArrowRight, ShieldCheck, Scale, Receipt, Trophy, Landmark, Users, Building2 } from "lucide-react";
import { CampaignMap } from "@/components/financiar/CampaignMap";
import { RankingTable } from "@/components/financiar/RankingTable";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { getEstadoGlobal, getRanking, getRecientes, getZonas, formatPEN } from "@/lib/financiamiento";

export const metadata = {
  title: "Financia una auditoría — Vigía Perú",
  description:
    "Cada región del Perú tiene contratos públicos que nadie ha leído. Financia la capacidad de auditarlos: S/ 3 por contrato, resultados públicos, reconocimiento verificable.",
};

export const revalidate = 120;

export default async function FinanciarPage() {
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
        <div className="container-page grid gap-10 py-16 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
              <Landmark size={12} /> Financiamiento de auditoría independiente
            </span>
            <h1 className="mt-5 font-serif text-5xl font-bold leading-[1.02] tracking-tight text-ink sm:text-6xl">
              El Estado publica todos sus contratos.<br />
              <em className="text-clay">Nadie tiene capacidad de leerlos.</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mute">
              Vigía lee contratos públicos con un pipeline de 11 agentes y publica las señales de riesgo.
              Cada contrato cuesta <strong className="text-ink">{formatPEN(precio)}</strong> de cómputo e IA.
              Elige una zona y <strong className="text-ink">financia la capacidad de auditar</strong> sus
              contratos pendientes. Los resultados son públicos, siempre.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#mapa" className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]">
                Ver el mapa de auditoría <ArrowRight size={16} />
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

      {/* ─── MAPA ─── */}
      <section id="mapa" className="container-page scroll-mt-20 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl font-bold text-ink">Mapa de auditoría</h2>
            <p className="mt-1 max-w-2xl text-sm text-mute">
              Cada región muestra cuántos contratos esperan análisis y cuánto falta para cubrirlos.
              Haz clic para ver provincias y financiar una zona concreta.
            </p>
          </div>
          <div className="text-xs text-mute">Actualizado cada 5 minutos · fuente: SEACE/OECE vía OCDS</div>
        </div>
        {zonas ? (
          <CampaignMap zonas={zonas} />
        ) : (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-mute">
            El servicio de datos no respondió. Vuelve a intentar en unos minutos.
          </div>
        )}
      </section>

      {/* ─── CÓMO FUNCIONA ─── */}
      <section className="border-y border-line bg-paperDeep py-16">
        <div className="container-page">
          <h2 className="font-serif text-3xl font-bold text-ink">Cómo funciona</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-4">
            <Step n="1" icon={<Landmark size={18} />} title="Elige una zona">
              Departamento, provincia o distrito. Ves cuántos contratos hay en cola y cuánto cuesta auditarlos.
            </Step>
            <Step n="2" icon={<Receipt size={18} />} title="Financia N contratos">
              {formatPEN(precio)} por contrato. Mínimo 5. Empresa, organización o persona — también anónimo.
            </Step>
            <Step n="3" icon={<Scale size={18} />} title="Vigía audita en orden">
              Los contratos se asignan por antigüedad (FIFO). Nadie elige cuáles. El pipeline no sabe quién financió.
            </Step>
            <Step n="4" icon={<Trophy size={18} />} title="Recibes tu comprobante de impacto">
              Página pública con cada contrato procesado, las señales halladas y tu lugar en el ranking.
            </Step>
          </div>
        </div>
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
            <Link href="/preguntas#transparencia" className="mt-4 inline-block text-sm text-amber underline-offset-2 hover:underline">
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

      {/* ─── PARA QUIÉN ─── */}
      <section className="container-page py-16">
        <div className="grid gap-6 md:grid-cols-2">
          <Audience icon={<Building2 size={20} />} title="Empresas y organizaciones">
            Reconocimiento público proporcional: "Auditoría financiada por …", insignia para tu web y memoria,
            ranking de impacto y un comprobante con cada contrato que tu aporte hizo posible leer.
          </Audience>
          <Audience icon={<Users size={20} />} title="Ciudadanos y colectivos">
            Desde 5 contratos ({formatPEN(precio * 5)}). Puedes aparecer con tu nombre, como colectivo ("Vecinos de …")
            o anónimo. El ranking cuenta contratos: 300 vecinos valen lo mismo que una empresa.
          </Audience>
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

function Step({ n, icon, title, children }: { n: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-center gap-2 text-clay">
        <span className="font-mono text-xs">{n}</span>{icon}
      </div>
      <h3 className="mt-2 font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-mute">{children}</p>
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

function Audience({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-6">
      <div className="flex items-center gap-2 text-ink">{icon}<h3 className="font-serif text-xl font-bold">{title}</h3></div>
      <p className="mt-2 text-sm leading-relaxed text-mute">{children}</p>
    </div>
  );
}
