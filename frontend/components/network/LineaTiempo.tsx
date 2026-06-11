import { ExternalLink, Clock } from "lucide-react";
import type { EventoTimeline } from "@/lib/mock-network";
import { cn } from "@/lib/utils";

const TIPO_META: Record<
  EventoTimeline["tipo"],
  { icon: string; label: string; tone: "rust" | "amber" | "clay" | "ink" | "mute" }
> = {
  ruc_alta: { icon: "🆕", label: "Alta de RUC", tone: "amber" },
  buena_pro: { icon: "🏛", label: "Buena pro", tone: "ink" },
  sancion: { icon: "🛑", label: "Sanción", tone: "rust" },
  aporte_politico: { icon: "🪙", label: "Aporte político", tone: "rust" },
  designacion: { icon: "📜", label: "Designación", tone: "clay" },
  dji: { icon: "👥", label: "DJ Intereses", tone: "rust" },
  investigacion: { icon: "📰", label: "Investigación", tone: "amber" },
  contratacion: { icon: "📝", label: "Contratación previa", tone: "mute" },
  otro: { icon: "•", label: "Evento", tone: "mute" },
};

export function LineaTiempo({ eventos }: { eventos: EventoTimeline[] }) {
  if (eventos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-paperDeep p-6 text-center text-sm text-mute">
        <Clock size={18} className="mx-auto mb-2" />
        Aún no hay eventos cronológicos. El agente los compondrá una vez expanda
        la red.
      </div>
    );
  }

  return (
    <ol className="surface space-y-0 overflow-hidden p-0">
      {eventos.map((e, i) => {
        const meta = TIPO_META[e.tipo];
        const isLast = i === eventos.length - 1;
        const isBuenaPro = e.tipo === "buena_pro";
        const toneRing =
          meta.tone === "rust"
            ? "bg-rust text-paper"
            : meta.tone === "amber"
              ? "bg-amber text-paper"
              : meta.tone === "clay"
                ? "bg-clay text-paper"
                : meta.tone === "ink"
                  ? "bg-ink text-paper"
                  : "bg-line text-ink";
        return (
          <li
            key={i}
            className={cn(
              "relative grid grid-cols-[110px,32px,1fr] gap-3 px-5 py-4",
              i > 0 && "border-t border-line",
              isBuenaPro && "bg-paperDeep",
            )}
          >
            {/* Fecha */}
            <div className="pt-0.5 text-right">
              <div className="font-mono text-xs font-semibold text-ink">
                {formatDate(e.fecha)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-mute">
                {meta.label}
              </div>
            </div>

            {/* Marker line */}
            <div className="relative flex flex-col items-center">
              <div
                className={cn(
                  "z-10 flex h-7 w-7 items-center justify-center rounded-full text-sm",
                  toneRing,
                )}
              >
                <span className="leading-none">{meta.icon}</span>
              </div>
              {!isLast && (
                <div className="absolute top-7 h-[calc(100%+1rem)] w-px bg-line" />
              )}
            </div>

            {/* Contenido */}
            <div className="min-w-0 pt-0.5">
              <div
                className={cn(
                  "font-serif font-semibold leading-snug",
                  isBuenaPro ? "text-base text-ink" : "text-sm text-ink",
                )}
              >
                {e.titulo}
              </div>
              {e.descripcion && (
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-mute">
                  {e.descripcion}
                </p>
              )}
              {e.fuente && (
                <a
                  href={e.fuente.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline"
                >
                  <ExternalLink size={10} /> {e.fuente.nombre}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatDate(iso: string): string {
  // "2026-04-22" → "22 abr 2026" o "22/abr/26"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [_, y, mo, d] = m;
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${d} ${months[Number(mo) - 1]} ${y}`;
}
