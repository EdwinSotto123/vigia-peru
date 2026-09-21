import { Cpu, Database, Leaf, Users } from "lucide-react";

const FEATURES = [
  { icon: Database, t: "Datos abiertos", d: "SEACE, OECE, SUNAT, ONPE/JNE y más — sin editar." },
  { icon: Cpu, t: "Agentes de IA", d: "Once agentes leen, clasifican y priorizan cada contrato." },
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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
          {FEATURES.map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-heroGreen text-paper">
                <Icon size={16} />
              </span>
              <div>
                <div className="text-sm font-semibold text-paper">{t}</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-paper/60">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
