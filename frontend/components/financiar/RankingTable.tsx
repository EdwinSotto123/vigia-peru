import Image from "next/image";
import { Building2, User, Users } from "lucide-react";
import type { RankingRow } from "@/lib/financiamiento";

/*
 * Aquí vivía también `RankingTable`, la tabla "Ranking de impacto" de /app/financiar con
 * medallas emoji. Duplicaba el muro de /app/aliados (que ya ordena por contratos, sin podio
 * de medallas), así que se fue: /app/financiar enlaza al muro. Queda el avatar, que usan
 * el feed de aportes, la ficha de zona y el comprobante.
 *
 * El avatar siempre va al lado del nombre del financiador, así que es decorativo: sin
 * `alt` que repita el nombre al lector de pantalla.
 */

export function Avatar({ tipo, logoUrl, nombre }: { tipo: RankingRow["tipo"]; logoUrl: string | null; nombre: string }) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt=""
        title={nombre}
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 rounded-xl border border-line bg-paper object-contain"
        loading="lazy"
        unoptimized={!/^https:\/\/(storage\.googleapis\.com|[a-z0-9.-]+\.run\.app)\//.test(logoUrl)}
      />
    );
  }
  const Icon = tipo === "empresa" ? Building2 : tipo === "organizacion" ? Users : User;
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-mute" aria-hidden>
      <Icon size={15} />
    </span>
  );
}
