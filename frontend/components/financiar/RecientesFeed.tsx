import Link from "next/link";
import { mensajePublicoVisible, type ContribucionReciente } from "@/lib/financiamiento";
import { Avatar } from "./RankingTable";

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function RecientesFeed({ items }: { items: ContribucionReciente[] }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-mute">
        Sin aportes confirmados todavía.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((c) => {
        const mensaje = mensajePublicoVisible(c.mensajePublico, c.pasarela);
        return (
        <li key={c.codigo} className="flex items-start gap-3 rounded-xl border border-line bg-paper px-4 py-3">
          <Avatar tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="text-ink">
              <span className="font-semibold">{c.financiador}</span> financió la auditoría de{" "}
              <span className="font-mono">{c.contratos}</span> contratos en{" "}
              <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold hover:underline">{c.zona}</Link>
            </div>
            {mensaje && <div className="mt-0.5 text-[13px] italic text-mute">“{mensaje}”</div>}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[11px] text-mute">
              <span>{timeAgo(c.pagadaAt)}</span>
              <Link href={`/impacto/${c.codigo}`} className="font-mono hover:underline">{c.codigo}</Link>
            </div>
          </div>
        </li>
        );
      })}
    </ul>
  );
}
