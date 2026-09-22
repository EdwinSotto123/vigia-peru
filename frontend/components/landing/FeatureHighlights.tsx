import { Cpu, Database, Leaf, Users } from "lucide-react";
import { BlurFade } from "@/components/magicui/BlurFade";

const FEATURES = [
  { icon: Database, t: "Datos abiertos", d: "SEACE, OECE, SUNAT, ONPE/JNE y más — sin editar." },
  { icon: Cpu, t: "Agentes de IA", d: "Diez agentes leen, clasifican y priorizan cada contrato." },
  { icon: Users, t: "Participación ciudadana", d: "Cualquiera puede financiar una auditoría o denunciar." },
  { icon: Leaf, t: "Un Perú más transparente", d: "Cada señal de riesgo cita su norma y su fuente oficial." },
];

/**
 * Reemplaza a MascotBand: la llama ya vive en el hero (LlamaHero, junto al mapa), así
 * que esta franja vuelve a ser lo que el usuario mostró en su referencia — una barra de
 * valor, no un segundo lugar para el mismo motivo.
 */
export function FeatureHighlights() {
  return (
    <section className="bg-heroViolet-deep py-10">
      <div className="container-page max-w-[1600px]">
        <h2 className="mb-6 font-serif text-lg font-semibold text-paper/90">
          La vigilancia también construye país.
        </h2>
        {/* Antes: ícono + texto flotando directo sobre el fondo violeta, sin borde ni
            fondo propio — la única franja de toda la landing sin ningún tratamiento de
            tarjeta. Ahora cada dato es su propia caja, igual que en el resto de la página. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* BlurFade escalonado: única sección de la landing donde una grilla entraba
              toda de golpe mientras sus vecinas (ComoFuncionaCompacto, AliadosSection,
              ConfianzaSection, ExpansionSection) ya hacen cascada. */}
          {FEATURES.map(({ icon: Icon, t, d }, i) => (
            <BlurFade
              key={t}
              delayMs={i * 90}
              className="rounded-2xl border border-paper/15 bg-paper/[0.06] p-4 transition-colors duration-200 hover:bg-paper/10"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-heroGreen text-paper">
                <Icon size={16} />
              </span>
              <div className="mt-3 text-sm font-semibold text-paper">{t}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-paper/60">{d}</p>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}
