import Link from "next/link";
import { ArrowRight, HeartHandshake, Scale, ShieldCheck, Trophy } from "lucide-react";
import { MuroAliados } from "@/components/aliados/MuroAliados";
import { getEstadoGlobal } from "@/lib/financiamiento";

export const metadata = {
  title: "Aliados de transparencia — Vigía Perú",
  description:
    "Empresas, organizaciones y personas que financian la capacidad de leer contratos públicos. Reconocimiento público, proporcional y verificable.",
};

export const revalidate = 300;

export default async function AliadosPage() {
  const estado = await getEstadoGlobal();
  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="border-b border-line bg-paperDeep">
        <div className="container-page grid gap-8 py-14 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
              <HeartHandshake size={12} /> Reconocimiento público
            </span>
            <h1 className="mt-4 font-serif text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              Aliados de transparencia
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
              Nadie compra un resultado ni una región. Quienes aparecen aquí financiaron la <strong className="text-ink">capacidad de leer</strong>{" "}
              contratos públicos que ya eran de todos, y aceptaron que lo que se encuentre se publique aunque los señale a ellos.
              El reconocimiento es proporcional a los contratos que hicieron posible auditar.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="Aliados" value={estado?.financiadores ?? 0} />
            <Kpi label="Contratos financiados" value={estado?.contratosFinanciados ?? 0} />
            <Kpi label="Señales halladas" value={estado?.senalesHalladas ?? 0} />
          </div>
        </div>
      </section>

      {/* ─── MURO ─── */}
      <section className="container-page py-12">
        <MuroAliados />
      </section>

      {/* ─── REGLAS + CTA ─── */}
      <section className="border-t border-line bg-paperDeep py-12">
        <div className="container-page grid gap-6 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-start">
          <Regla icon={<Trophy size={16} />} titulo="Se cuenta en contratos">
            Trescientos vecinos que financian 300 contratos valen lo mismo que una empresa que financia 300. El ranking nunca mide soles.
          </Regla>
          <Regla icon={<Scale size={16} />} titulo="Nadie elige qué se audita">
            Los contratos se asignan por antigüedad, en código. El pipeline no sabe quién financió. Los resultados se publican siempre.
          </Regla>
          <Regla icon={<ShieldCheck size={16} />} titulo="Conflicto de interés automático">
            Una empresa con sanción vigente o señalada en alertas de la zona puede aportar, pero no aparece en este muro.
          </Regla>
          <div className="rounded-2xl border border-line bg-paper p-5 lg:max-w-xs">
            <div className="text-sm font-semibold text-ink">Súmate al muro</div>
            <p className="mt-1 text-[13px] text-mute">Desde 5 contratos. Con tu nombre, como colectivo o de forma anónima.</p>
            <Link href="/app/financiar" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]">
              Financiar una auditoría <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-2xl font-semibold text-ink">{value.toLocaleString("es-PE")}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-mute">{label}</div>
    </div>
  );
}

function Regla({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="inline-flex items-center gap-2 text-ink">{icon}<h3 className="font-semibold">{titulo}</h3></div>
      <p className="mt-1 text-sm leading-relaxed text-mute">{children}</p>
    </div>
  );
}
