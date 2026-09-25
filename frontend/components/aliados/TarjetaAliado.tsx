import Image from "next/image";
import { Building2, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RankingRow } from "@/lib/financiamiento";
import type { DatoIdentidad } from "./IdentidadAliado";

/**
 * Piezas de identidad de un aliado que comparten el ranking, su perfil, la portada y
 * la configuración de la cuenta: el avatar (logo o ícono por tipo) y sus datos cortos.
 *
 * La tarjeta del muro que vivía acá se fue con el muro: /app/aliados es ahora un ranking
 * (podio + `Tabla`) y cada fila lleva al perfil. El archivo conserva su nombre porque la
 * portada y la configuración importan estas piezas desde aquí.
 */

const TIPO_LABEL: Record<RankingRow["tipo"], string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

const TIPO_ICONO: Record<RankingRow["tipo"], DatoIdentidad["icono"]> = {
  empresa: "tipo-empresa",
  organizacion: "tipo-organizacion",
  persona: "tipo-persona",
};

/** Vigía Perú se autofinancia con capital semilla: aparece en su propio ranking y se dice tal cual. */
export const esFundador = (row: { slug: string | null }) => row.slug === "vigia-peru";

const DIMS = {
  sm: { clase: "h-8 w-8 rounded-lg", px: 32, icono: 15 },
  lg: { clase: "h-14 w-14 rounded-xl", px: 56, icono: 24 },
  xl: { clase: "h-20 w-20 rounded-2xl", px: 80, icono: 32 },
  /** El del perfil: grande y superpuesto a la portada, como la foto de un perfil social. */
  perfil: { clase: "h-24 w-24 rounded-2xl sm:h-28 sm:w-28", px: 112, icono: 44 },
} as const;

export function AvatarAliado({
  tipo,
  logoUrl,
  nombre,
  size = "sm",
}: {
  tipo: RankingRow["tipo"];
  logoUrl: string | null;
  nombre: string;
  size?: keyof typeof DIMS;
}) {
  const d = DIMS[size];
  if (logoUrl) {
    // El logo de Vigía Perú llega del API como URL absoluta a este mismo dominio: sin
    // normalizarla, el optimizador de Next la trata como otra cache key que la del logo
    // de la cabecera y redimensiona dos veces el mismo PNG.
    const src = logoUrl.replace(/^https?:\/\/[^/]+\.run\.app/, "");
    return (
      <Image
        src={src}
        alt={nombre}
        width={d.px}
        height={d.px}
        className={cn(d.clase, "shrink-0 border border-line bg-paper object-contain")}
        {...(size === "perfil" ? { priority: true } : { loading: "lazy" as const })}
        unoptimized={!/^(https:\/\/(storage\.googleapis\.com|[a-z0-9.-]+\.run\.app)\/|\/)/.test(src)}
      />
    );
  }
  const Icon = tipo === "empresa" ? Building2 : tipo === "organizacion" ? Users : User;
  return (
    <span
      className={cn(d.clase, "inline-flex shrink-0 items-center justify-center border border-transparent bg-paperDeep text-mute")}
      aria-hidden
    >
      <Icon size={d.icono} />
    </span>
  );
}
