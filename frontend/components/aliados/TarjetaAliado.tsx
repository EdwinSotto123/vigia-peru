import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Building2, User, Users } from "lucide-react";
import { BorderBeam } from "@/components/magicui/BorderBeam";
import type { RankingRow } from "@/lib/financiamiento";

const MEDALLA: Record<number, { emoji: string; label: string; ring: string }> = {
  1: { emoji: "🥇", label: "Primer lugar", ring: "ring-amber/40" },
  2: { emoji: "🥈", label: "Segundo lugar", ring: "ring-paperEdge" },
  3: { emoji: "🥉", label: "Tercer lugar", ring: "ring-clay/30" },
};

const TIPO_LABEL: Record<RankingRow["tipo"], string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

/** Vigía Perú aparece en su propio ranking cuando se autofinancia (capital semilla) —
 * se etiqueta distinto para no leerse como un aliado externo más. */
const esFundador = (row: RankingRow) => row.slug === "vigia-peru";

interface Props {
  row: RankingRow;
  posicion: number;
  destacado?: boolean;
}

/**
 * Tarjeta de reconocimiento de un aliado de transparencia. En modo destacado
 * (top 3 del mes) el avatar es grande y lleva medalla; en modo compacto es
 * una fila para grillas densas.
 */
export function TarjetaAliado({ row, posicion, destacado = false }: Props) {
  const medalla = MEDALLA[posicion];
  const nombre = row.slug ? (
    <Link href={`/aliado/${row.slug}`} className="hover:underline">{row.nombre}</Link>
  ) : (
    row.nombre
  );
  const zonasTxt = `${row.zonas} ${row.zonas === 1 ? "zona" : "zonas"}`;
  const contratosTxt = `${row.contratosFinanciados.toLocaleString("es-PE")} ${row.contratosFinanciados === 1 ? "contrato" : "contratos"}`;

  if (!destacado) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 transition-all hover:shadow-card">
        <span className="w-6 shrink-0 text-center font-mono text-xs text-mute">{posicion}</span>
        <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{nombre}</div>
          <div className="truncate text-[11px] text-mute">
            {contratosTxt} · {zonasTxt} · {row.senalesHalladas} {row.senalesHalladas === 1 ? "señal" : "señales"}
          </div>
        </div>
        {row.slug && (
          <Link href={`/aliado/${row.slug}`} className="shrink-0 text-mute hover:text-ink" aria-label={`Perfil de ${row.nombre}`}>
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
    );
  }

  return (
    <article className={`relative flex flex-col overflow-hidden rounded-2xl border border-line bg-paper p-5 transition-all hover:-translate-y-0.5 hover:shadow-card ${medalla ? `ring-1 ${medalla.ring}` : ""}`}>
      {posicion === 1 && <BorderBeam size={80} duration={7} />}
      {medalla && (
        <span className="absolute right-4 top-4 text-2xl" title={medalla.label} aria-label={medalla.label}>{medalla.emoji}</span>
      )}
      <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" />
      <div className="mt-3 text-[11px] uppercase tracking-wide text-mute">
        {esFundador(row) ? "Fundador · capital semilla" : `${TIPO_LABEL[row.tipo]} · aliado de transparencia`}
      </div>
      <h3 className="mt-0.5 truncate font-serif text-xl font-bold text-ink">{nombre}</h3>
      {/* Datos como tarjeta de cifras (mismo lenguaje que HeroKpis/AliadosStats), no una
          oración corrida con los números metidos adentro. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line pt-3">
        <EstadisticaAliado etiqueta={row.contratosFinanciados === 1 ? "Contrato financiado" : "Contratos financiados"} valor={row.contratosFinanciados} />
        <EstadisticaAliado etiqueta={row.zonas === 1 ? "Zona" : "Zonas"} valor={row.zonas} />
        <EstadisticaAliado etiqueta={row.senalesHalladas === 1 ? "Señal hallada" : "Señales halladas"} valor={row.senalesHalladas} tono={row.senalesHalladas > 0 ? "rust" : undefined} />
        <EstadisticaAliado etiqueta="Procesados" valor={row.contratosProcesados} tono="verde" />
      </dl>
      <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-mute">
        <span>{row.desde ? `desde ${new Date(row.desde).toLocaleDateString("es-PE", { month: "short", year: "numeric" })}` : ""}</span>
        {row.slug && (
          <Link href={`/aliado/${row.slug}`} className="inline-flex items-center gap-1 font-medium text-ink hover:underline">
            Ver perfil <ArrowUpRight size={12} aria-hidden />
          </Link>
        )}
      </div>
    </article>
  );
}

/** Una cifra del aliado como dato, no como palabra dentro de una frase — reusa el mismo
 * patrón label-chico/número-grande que ya usan HeroKpis y AliadosStats en el hero. */
function EstadisticaAliado({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: "rust" | "verde" }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-mute">{etiqueta}</dt>
      <dd className={`font-mono text-base font-bold ${tono === "rust" ? "text-rust" : tono === "verde" ? "text-heroGreen" : "text-ink"}`}>
        {valor.toLocaleString("es-PE")}
      </dd>
    </div>
  );
}

export function AvatarAliado({ tipo, logoUrl, nombre, size = "sm" }: { tipo: RankingRow["tipo"]; logoUrl: string | null; nombre: string; size?: "sm" | "lg" }) {
  const dims = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-8 w-8 rounded-lg";
  if (logoUrl) {
    const px = size === "lg" ? 56 : 32;
    // El logo de Vigía Perú (el propio aliado-fundador) llega del API como URL absoluta
    // a este mismo dominio — sin normalizar, el optimizador de Next lo trata como una
    // cache key distinta de cualquier otro <Image> que ya pidió ese mismo archivo por
    // ruta relativa (p.ej. el logo del header), duplicando trabajo de redimensionado
    // para el mismo PNG.
    const src = logoUrl.replace(/^https?:\/\/[^/]+\.run\.app/, "");
    return <Image src={src} alt={nombre} width={px} height={px} className={`${dims} border border-line bg-paper object-contain`} loading="lazy" unoptimized={!/^(https:\/\/(storage\.googleapis\.com|[a-z0-9.-]+\.run\.app)\/|\/)/.test(src)} />;
  }
  const Icon = tipo === "empresa" ? Building2 : tipo === "organizacion" ? Users : User;
  return (
    <span className={`inline-flex ${dims} items-center justify-center bg-paperDeep text-mute`} aria-hidden>
      <Icon size={size === "lg" ? 24 : 15} />
    </span>
  );
}
