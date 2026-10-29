import { ArrowUpRight, Code2, FileSearch, ShieldCheck, SquareDashed, UserCheck } from "lucide-react";
import { plural } from "@/lib/formato";

/**
 * Por qué creerle.
 *
 * Antes esta sección tenía un recuadro de "Cuentas claras del mes pasado" con
 * tres costos y un total (S/ 845) que no salían de ningún lado, y se presentaba
 * como "organización sin fines de lucro" sin un registro que lo respaldara. En
 * una herramienta que le exige evidencia al Estado, eso no puede estar. Lo que
 * cuesta leer un contrato ya está, con su desglose real, en la sección de
 * aliados.
 *
 * Quedan cuatro compromisos, cada uno verificable desde la propia plataforma:
 * el código es público, las señales citan la ley y la fuente, cada análisis deja
 * su bitácora, y lo dudoso no se publica sin que lo mire una persona (la cifra
 * de lo que está en revisión llega del API; sin ella, la frase no la inventa).
 */
export function ConfianzaSection({ enRevision }: { enRevision: number | null }) {
  const compromisos = [
    {
      Icono: ShieldCheck,
      t: "Señala, no acusa.",
      d: "Cada señal viene con la ley que la sustenta y el documento oficial de donde sale. Investigar y denunciar formalmente le toca a Fiscalía, Contraloría y la prensa.",
    },
    {
      Icono: UserCheck,
      t: "Si duda, lo revisa una persona.",
      d:
        enRevision != null && enRevision > 0
          ? `Cuando el análisis no está seguro de lo que encontró, no se publica solo: queda en revisión humana. Hoy hay ${plural(enRevision, "contrato", "contratos")} en revisión.`
          : "Cuando el análisis no está seguro de lo que encontró, no se publica solo: queda en revisión humana.",
    },
    {
      Icono: FileSearch,
      t: "Todo queda registrado.",
      d: "Cada análisis deja una bitácora pública, paso por paso: qué leyó, qué consultó y qué concluyó. Se puede volver a ver cuando quieras.",
    },
    {
      Icono: Code2,
      t: "El código es público.",
      d: "Cualquiera puede revisar cómo funciona por dentro. Una herramienta de transparencia cerrada sería una contradicción.",
      href: "https://github.com/EdwinSotto123/vigia-peru",
    },
  ];

  return (
    <section id="organizacion" aria-labelledby="confianza-titulo" className="scroll-mt-16 border-t border-line bg-paperSoft py-20 sm:py-24">
      <div className="container-page grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div className="min-w-0">
          <h2 id="confianza-titulo" className="max-w-[16ch] text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">
            Hecho para que no tengas que creerle a nadie.
          </h2>
          {/* La regla que sostiene a todas, dibujada como lo que dice: un hueco que se deja vacío. Antes cerraba la
              sección de fuentes, suelta y sin forma. */}
          <div className="mt-8 rounded-2xl border-2 border-dashed border-line px-5 py-5 sm:mt-10">
            <SquareDashed size={22} className="text-mute" aria-hidden />
            <h3 className="mt-3 font-display text-bloque font-bold leading-snug text-ink">Si un dato no está, queda vacío.</h3>
            <p className="mt-1.5 text-cuerpo leading-relaxed text-inkSoft">
              No se rellena el hueco con un valor plausible: un dato inventado en una herramienta anticorrupción vale lo mismo
              que una acusación inventada.
            </p>
          </div>
        </div>
        <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
          {compromisos.map(({ Icono, t, d, href }) => (
            <li key={t} className="border-t border-line pt-5">
              <Icono size={20} className="text-granate" aria-hidden />
              <h3 className="mt-3 font-display text-bloque leading-7 font-bold text-ink">{t}</h3>
              <p className="mt-1.5 text-cuerpo leading-relaxed text-inkSoft">{d}</p>
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex min-h-11 sm:min-h-8 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
                >
                  Ver el código <ArrowUpRight size={13} aria-hidden />
                  <span className="sr-only">(se abre en una pestaña nueva)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
