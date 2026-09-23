import Image from "next/image";
import { Building2, User, Users } from "lucide-react";
import type { RankingRow } from "@/lib/financiamiento";

/*
 * Aquí vivía también `RankingTable`, la tabla "Ranking de impacto" de /app/financiar con
 * medallas emoji. Duplicaba el muro de /app/aliados (que ya ordena por contratos, sin podio
 * de medallas), así que se fue: /app/financiar enlaza al muro. Queda el avatar, que usan
 * el feed de aportes, la ficha de zona y el comprobante.
 */

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
