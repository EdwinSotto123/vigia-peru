import { ArrowUpRight, Code2, FileSearch, ShieldCheck, SquareDashed, UserCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Por qué creerle: la pestaña «Por qué creerle» de «Cómo trabaja Vigía» (ComoFunciona). Hasta el 2026-11-13 era una
 * banda propia con un titular de tres renglones («Hecho para que no tengas que creerle a nadie») y los compromisos en
 * texto corrido; ahora son cinco cajas en una fila, y la cifra de lo que está en revisión se ve como cifra.
 *
 * Antes esta sección tenía un recuadro de "Cuentas claras del mes pasado" con tres costos y un total (S/ 845) que no
 * salían de ningún lado, y se presentaba como "organización sin fines de lucro" sin un registro que lo respaldara. En
 * una herramienta que le exige evidencia al Estado, eso no puede estar.
 *
 * Quedan los compromisos, cada uno verificable desde la propia plataforma: lo que no se sabe queda vacío, las señales
 * citan la ley y la fuente, lo dudoso no se publica sin que lo mire una persona (la cifra de lo que está en revisión
 * llega del API; sin ella, la frase no la inventa), cada análisis deja su bitácora y el código es público.
 */
interface Compromiso {
  Icono: LucideIcon;
  t: string;
  d: string;
  /** Una cifra que lo prueba, si el API la dio. */
  cifra?: { n: number; texto: string } | null;
  enlace?: { href: string; texto: string; externo?: boolean };
  /** La regla que sostiene a todas: dibujada como lo que dice, un hueco con borde punteado. */
  hueco?: boolean;
}

export function ConfianzaSection({ enRevision }: { enRevision: number | null }) {
  const compromisos: Compromiso[] = [
    {
      Icono: SquareDashed,
      t: "Si un dato no está, queda vacío.",
      d: "No se rellena el hueco con un valor plausible: un dato inventado vale lo mismo que una acusación inventada.",
      hueco: true,
    },
    {
      Icono: ShieldCheck,
      t: "Señala, no acusa.",
      d: "Cada señal viene con la ley que la sustenta y el documento oficial de donde sale. Denunciar le toca a Fiscalía, Contraloría y la prensa.",
    },
    {
      Icono: UserCheck,
      t: "Si duda, lo revisa una persona.",
      d: "Cuando el análisis no está seguro de lo que encontró, no se publica solo: queda en revisión humana.",
      cifra: enRevision != null && enRevision > 0 ? { n: enRevision, texto: enRevision === 1 ? "contrato en revisión hoy" : "contratos en revisión hoy" } : null,
    },
    {
      Icono: FileSearch,
      t: "Todo queda registrado.",
      d: "Cada análisis deja una bitácora pública, paso por paso: qué leyó, qué consultó y qué concluyó.",
      enlace: { href: "/app/auditoria", texto: "Ver la bitácora" },
    },
    {
      Icono: Code2,
      t: "El código es público.",
      d: "Cualquiera puede revisar cómo funciona por dentro. Una herramienta de transparencia cerrada sería una contradicción.",
      enlace: { href: "https://github.com/Gobserva-Cloud/vigia-peru", texto: "Ver el código", externo: true },
    },
  ];

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Por qué creerle">
      {compromisos.map(({ Icono, t, d, cifra, enlace, hueco }) => (
        <li
          key={t}
          className={cn(
            "flex flex-col rounded-2xl p-4",
            hueco ? "border-2 border-dashed border-paperEdge" : "border border-line bg-paper",
          )}
        >
          <Icono size={19} className={hueco ? "text-mute" : "text-granate"} aria-hidden />
          <h3 className="mt-2.5 font-display text-cuerpo font-bold leading-snug text-ink">{t}</h3>
          <p className="mt-1 text-meta leading-relaxed text-inkSoft">{d}</p>
          {cifra && (
            <p className="mt-3 border-t border-line pt-2.5">
              <span className="block font-display text-cifra font-bold leading-none tabular-nums text-ink">{numero(cifra.n)}</span>
              <span className="mt-1 block text-rotulo text-mute">{cifra.texto}</span>
            </p>
          )}
          {enlace &&
            (enlace.externo ? (
              <a
                href={enlace.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex min-h-10 items-center gap-1 pt-2 text-dato font-semibold text-granate underline-offset-4 hover:underline"
              >
                {enlace.texto} <ArrowUpRight size={13} aria-hidden />
                <span className="sr-only">(se abre en una pestaña nueva)</span>
              </a>
            ) : (
              <Link
                href={enlace.href}
                className="mt-auto inline-flex min-h-10 items-center gap-1 pt-2 text-dato font-semibold text-granate underline-offset-4 hover:underline"
              >
                {enlace.texto} <ArrowUpRight size={13} aria-hidden />
              </Link>
            ))}
        </li>
      ))}
    </ul>
  );
}
