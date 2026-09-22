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
  /** Único aliado destacado (ej. solo el fundador todavía): layout horizontal, logo y
   * cifras más grandes -- la empresa protagoniza la tarjeta en vez de quedar angosta con
   * huecos vacíos al lado en una grilla pensada para 3. */
  spotlight?: boolean;
}

/**
 * Tarjeta de reconocimiento de un aliado de transparencia. En modo destacado
 * (top 3 del mes) el avatar es grande y lleva medalla; en modo compacto es
 * una fila para grillas densas.
 */
export function TarjetaAliado({ row, posicion, destacado = false, spotlight = false }: Props) {
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

  if (spotlight) {
    const etiquetaTipo = esFundador(row) ? "Fundador · capital semilla" : `${TIPO_LABEL[row.tipo]} · aliado de transparencia`;
    const desdeTxt = row.desde ? `desde ${new Date(row.desde).toLocaleDateString("es-PE", { month: "short", year: "numeric" })}` : "";
    return (
      <article className="relative flex w-full flex-col gap-6 overflow-hidden rounded-3xl border border-line bg-paper p-6 transition-all hover:-translate-y-0.5 hover:shadow-card sm:flex-row sm:items-center sm:gap-8 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-heroViolet/[0.06] blur-3xl" />
        {medalla && (
          <span className="absolute right-5 top-5 text-3xl" title={medalla.label} aria-label={medalla.label}>{medalla.emoji}</span>
        )}
        <div className="flex items-center gap-5 sm:flex-col sm:items-start sm:gap-4">
          <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="xl" />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-mute">{etiquetaTipo}</div>
            <h3 className="mt-0.5 font-serif text-2xl font-bold text-ink sm:text-3xl">{nombre}</h3>
            {desdeTxt && <div className="mt-1 text-[11px] text-mute">{desdeTxt}</div>}
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-4 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
          <EstadisticaAliado etiqueta={row.contratosFinanciados === 1 ? "Contrato financiado" : "Contratos financiados"} valor={row.contratosFinanciados} grande />
          <EstadisticaAliado etiqueta={row.zonas === 1 ? "Zona" : "Zonas"} valor={row.zonas} grande />
          <EstadisticaAliado etiqueta={row.senalesHalladas === 1 ? "Señal hallada" : "Señales halladas"} valor={row.senalesHalladas} tono={row.senalesHalladas > 0 ? "rust" : undefined} grande />
          <EstadisticaAliado etiqueta="Procesados" valor={row.contratosProcesados} tono="verde" grande />
        </dl>
        {row.slug && (
          <Link href={`/aliado/${row.slug}`} className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paperDeep sm:self-center">
            Ver perfil <ArrowUpRight size={14} aria-hidden />
          </Link>
        )}
      </article>
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
function EstadisticaAliado({ etiqueta, valor, tono, grande }: { etiqueta: string; valor: number; tono?: "rust" | "verde"; grande?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-mute">{etiqueta}</dt>
      <dd className={`font-mono font-bold ${grande ? "text-2xl sm:text-3xl" : "text-base"} ${tono === "rust" ? "text-rust" : tono === "verde" ? "text-heroGreen" : "text-ink"}`}>
        {valor.toLocaleString("es-PE")}
      </dd>
    </div>
  );
}

export function AvatarAliado({ tipo, logoUrl, nombre, size = "sm" }: { tipo: RankingRow["tipo"]; logoUrl: string | null; nombre: string; size?: "sm" | "lg" | "xl" }) {
  const dims = size === "xl" ? "h-24 w-24 rounded-3xl" : size === "lg" ? "h-14 w-14 rounded-2xl" : "h-8 w-8 rounded-lg";
  if (logoUrl) {
    const px = size === "xl" ? 96 : size === "lg" ? 56 : 32;
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
      <Icon size={size === "xl" ? 36 : size === "lg" ? 24 : 15} />
    </span>
  );
}
