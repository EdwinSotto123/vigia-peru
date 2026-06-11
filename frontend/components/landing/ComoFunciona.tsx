import { Database, Cpu, GitMerge, ArrowRight } from "lucide-react";

/**
 * Explicación llana de QUÉ hace Vigía, en 3 pasos. Va arriba (después del hero)
 * para que cualquiera que llega entienda el producto en segundos — sin jerga,
 * sin animación. Clarity > cleverness.
 */
const PASOS = [
  {
    icon: Database,
    n: "01",
    titulo: "Ingesta de datos públicos",
    desc: "Recolecta contratos y datos de 14 portales del Estado —SEACE, SUNAT, INFOBRAS, ONPE, MEF— en tiempo real.",
  },
  {
    icon: Cpu,
    n: "02",
    titulo: "Los agentes detectan",
    desc: "Una red de agentes de IA cruza los datos y marca patrones de riesgo —RUC nuevo que gana millones, único postor, sobreprecio—, citando la norma y la opinión OECE.",
  },
  {
    icon: GitMerge,
    n: "03",
    titulo: "Convergencia → caso",
    desc: "Cuando una alerta automática coincide con un reporte ciudadano sobre la misma obra, se vuelve un caso priorizado: listo para un fiscal o un periodista.",
  },
];

export function ComoFunciona() {
  return (
    <section id="como" className="container-page scroll-mt-20 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
          Cómo funciona
        </div>
        <h2 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
          De un dato público a un <em className="text-rust">caso priorizado</em>, en tres pasos.
        </h2>
        <p className="mt-3 text-mute">
          Vigía no acusa: detecta <strong className="text-ink">señales de riesgo</strong> y las
          respalda con evidencia oficial. La denuncia la hacen los humanos.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
        {PASOS.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={p.n} className="relative">
              <div className="flex h-full flex-col rounded-2xl border border-line bg-paperSoft p-6 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-amber">
                    <Icon size={20} />
                  </span>
                  <span className="font-mono text-2xl font-bold text-paperEdge">{p.n}</span>
                </div>
                <h3 className="mt-4 font-serif text-lg font-bold text-ink">{p.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">{p.desc}</p>
              </div>
              {/* conector entre pasos (desktop) */}
              {i < PASOS.length - 1 && (
                <ArrowRight
                  size={20}
                  className="absolute -right-[18px] top-1/2 z-10 hidden -translate-y-1/2 text-paperEdge md:block"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
