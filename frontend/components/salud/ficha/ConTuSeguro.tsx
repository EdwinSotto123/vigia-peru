import { Clock3, ExternalLink, ShieldPlus, Siren } from "lucide-react";
import { URL_LEY_SALUD, atiende24, seguroIpress } from "@/lib/salud-seguros";
import { cn } from "@/lib/utils";

/**
 * «Con qué seguro te atienden» (Gobserva Salud, 2026-11-22; el usuario: «útil para una persona de a pie que quiera
 * atenderse»): lo primero de la pestaña «Para atenderte». Por la institución que declaró en RENIPRESS (lib/salud-
 * seguros.ts): con SIS gratis en el MINSA y los gobiernos regionales, EsSalud para sus asegurados, privado pagando o con
 * tu seguro; si declaró atender las 24 horas; y que una emergencia o un parto se atienden en cualquiera, con o sin seguro
 * (Ley 26842, artículos 3 y 39). Un convenio puntual no está en RENIPRESS: siempre se dice que se pregunte. Server-safe.
 */
export function ConTuSeguro({ institucion, horario, className }: { institucion: string | null; horario: string | null; className?: string }) {
  const s = seguroIpress(institucion);
  const h24 = atiende24(horario);
  return (
    <div className={cn("grid gap-x-6 gap-y-3 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]", className)}>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-snug text-ink">
          <ShieldPlus size={19} aria-hidden className="shrink-0 text-granate" />
          {s.titulo}
        </h3>
        <p className="mt-1 max-w-[68ch] text-dato leading-relaxed text-inkSoft">
          {s.texto}
          {s.enlace && (
            <>
              {" "}
              <a href={s.enlace.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                {s.enlace.texto}
                <ExternalLink size={12} aria-hidden />
                <span className="sr-only"> (gob.pe, se abre en otra pestaña)</span>
              </a>
            </>
          )}
        </p>
        {h24 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-moss/10 px-2.5 py-1 text-meta font-semibold text-mossTexto">
            <Clock3 size={14} aria-hidden />
            Declaró atender las 24 horas
          </p>
        )}
      </div>
      <p role="note" className="flex min-w-0 gap-2.5 self-start rounded-xl border border-crimson/25 bg-crimson-soft/40 px-3.5 py-3 text-meta leading-relaxed text-ink">
        <Siren size={16} aria-hidden className="mt-0.5 shrink-0 text-crimsonTexto" />
        <span>
          <b className="font-semibold">Emergencia o parto:</b> aquí y en cualquier otro establecimiento te tienen que atender, con o sin seguro, mientras
          tu vida o tu salud estén en riesgo; el pago se ve después.{" "}
          <a href={URL_LEY_SALUD} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
            Ley General de Salud<span className="sr-only">, artículos 3 y 39 (gob.pe, se abre en otra pestaña)</span>
          </a>
        </span>
      </p>
    </div>
  );
}
