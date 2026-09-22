import Link from "next/link";
import Image from "next/image";
import { Building2, User, Users } from "lucide-react";
import type { RankingRow } from "@/lib/financiamiento";

const MEDAL = ["🥇", "🥈", "🥉"];

export function RankingTable({ rows, compact = false }: { rows: RankingRow[]; compact?: boolean }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-mute">
        Todavía no hay aportes confirmados. El primero abre el ranking.
      </div>
    );
  }
  const list = compact ? rows.slice(0, 3) : rows;
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
      {list.map((r) => (
        <li key={r.id} className="flex items-center gap-3 bg-paper px-4 py-3 transition-colors hover:bg-paperDeep">
          <span className="w-8 text-center font-mono text-sm text-mute">{MEDAL[r.posicion - 1] ?? r.posicion}</span>
          <Avatar tipo={r.tipo} logoUrl={r.logoUrl} nombre={r.nombre} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">
              {r.slug ? <Link href={`/aliado/${r.slug}`} className="hover:underline">{r.nombre}</Link> : r.nombre}
            </div>
            {!compact && (
              <div className="text-[11px] text-mute">
                {r.zonas} {r.zonas === 1 ? "zona" : "zonas"} · {r.contratosProcesados} procesados · {r.senalesHalladas} señales
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-semibold text-ink">{r.contratosFinanciados.toLocaleString("es-PE")}</div>
            <div className="text-[10px] uppercase tracking-wide text-mute">contratos</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Avatar({ tipo, logoUrl, nombre }: { tipo: RankingRow["tipo"]; logoUrl: string | null; nombre: string }) {
  if (logoUrl) {
    return <Image src={logoUrl} alt={nombre} width={32} height={32} className="h-8 w-8 rounded-lg border border-line object-contain" loading="lazy" unoptimized={!/^https:\/\/(storage\.googleapis\.com|[a-z0-9.-]+\.run\.app)\//.test(logoUrl)} />;
  }
  const Icon = tipo === "empresa" ? Building2 : tipo === "organizacion" ? Users : User;
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-paperDeep text-mute">
      <Icon size={15} />
    </span>
  );
}
