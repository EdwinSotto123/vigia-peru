import { Check, Clock, ExternalLink, Sparkles, X } from "lucide-react";
import {
  CATEGORIA_LABEL,
  type FuenteRef,
  type FuenteEstado,
} from "@/lib/mock-network";
import { cn } from "@/lib/utils";

type FuenteRow = FuenteRef & { estado: FuenteEstado; hallazgos: number };

export function FuentesConsultadas({ fuentes }: { fuentes: FuenteRow[] }) {
  const agrupadas = groupBy(fuentes, (f) => f.categoria);
  const total = fuentes.length;
  const conHallazgo = fuentes.filter((f) => f.estado === "coincidencia").length;
  const pendientes = fuentes.filter((f) => f.estado === "pendiente").length;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paperDeep px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
            <Sparkles size={11} className="-mt-0.5 mr-1 inline" /> Fuentes consultadas
          </div>
          <h3 className="mt-0.5 font-serif text-xl font-bold text-ink">
            {total} fuentes oficiales cruzadas
          </h3>
        </div>
        <div className="flex gap-4 text-xs">
          <Stat label="con hallazgos" value={conHallazgo} tone="rust" />
          <Stat label="sin coincidencia" value={total - conHallazgo - pendientes} tone="moss" />
          <Stat label="pendientes" value={pendientes} tone="mute" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(agrupadas).map(([cat, items]) => (
          <div key={cat} className="bg-paperSoft p-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-mute">
              {CATEGORIA_LABEL[cat as keyof typeof CATEGORIA_LABEL]}
            </div>
            <ul className="space-y-1.5">
              {items.map((f) => (
                <FuenteRow key={f.id} fuente={f} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function FuenteRow({ fuente }: { fuente: FuenteRow }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <StatusIcon estado={fuente.estado} />
      <a
        href={fuente.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-ink hover:text-clay hover:underline"
      >
        {fuente.nombre}
      </a>
      {fuente.hallazgos > 0 && (
        <span className="shrink-0 rounded-full bg-rust px-1.5 py-0.5 text-[9px] font-bold text-paper">
          {fuente.hallazgos}
        </span>
      )}
      <ExternalLink size={10} className="shrink-0 text-mute" />
    </li>
  );
}

function StatusIcon({ estado }: { estado: FuenteEstado }) {
  switch (estado) {
    case "coincidencia":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rust text-paper">
          <X size={9} strokeWidth={3} />
        </span>
      );
    case "sin_coincidencias":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-moss text-paper">
          <Check size={9} strokeWidth={3} />
        </span>
      );
    case "pendiente":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line bg-paperDeep text-mute">
          <Clock size={9} />
        </span>
      );
    case "error":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber text-paper">
          !
        </span>
      );
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rust" | "moss" | "mute";
}) {
  const color =
    tone === "rust" ? "text-rust" : tone === "moss" ? "text-moss" : "text-mute";
  return (
    <div className="text-right">
      <div className={cn("font-mono text-base font-bold", color)}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}

function groupBy<T, K extends string>(arr: T[], key: (t: T) => K): Record<K, T[]> {
  return arr.reduce(
    (acc, item) => {
      const k = key(item);
      (acc[k] = acc[k] || []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}
