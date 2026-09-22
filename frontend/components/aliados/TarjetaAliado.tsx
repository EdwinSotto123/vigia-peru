import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Building2, User, Users } from "lucide-react";
import type { RankingRow } from "@/lib/financiamiento";

/**
 * Presentación de un aliado, en dos formatos que son el mismo dato.
 *
 * Lo que se fue de acá, y no vuelve:
 *  - Las medallas de oro/plata/bronce, que además eran emoji: los únicos
 *    usados como iconografía en todo el producto (el resto es lucide), y
 *    montaban un marco competitivo sobre gente que, por diseño, no compite:
 *    nadie elige qué se audita.
 *  - El `BorderBeam` del puesto 1: una animación infinita puesta encima de
 *    quien paga, en una herramienta que acusa a otros de falta de
 *    transparencia. Es exactamente la lectura que hay que evitar.
 *  - El número de puesto. El orden del libro mayor ya se ve; ponerle un "1"
 *    al lado lo convierte en podio otra vez.
 *
 * `ficha` es para cuando hay pocos aliados (hoy: uno) y una fila de tabla se
 * vería como un error. `FilaAliado` es para cuando hay muchos, que es el
 * caso que el diseño tiene que aguantar sin rediseñarse.
 *
 * Toda cifra viaja con su denominador: "33 de 45 financiados", nunca un 33
 * suelto en una caja.
 */

const TIPO_LABEL: Record<RankingRow["tipo"], string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

/** Vigía Perú se autofinancia con capital semilla: aparece en su propio muro y se dice tal cual. */
export const esFundador = (row: { slug: string | null }) => row.slug === "vigia-peru";

const num = (n: number) => n.toLocaleString("es-PE");

const desdeTxt = (desde: string | null) =>
  desde ? new Date(desde).toLocaleDateString("es-PE", { month: "short", year: "numeric" }) : null;

function pctTxt(v: number, total: number): string {
  if (!total) return "—";
  const p = (v / total) * 100;
  const dec = p >= 10 ? 0 : p >= 1 ? 1 : 2;
  // Sin .replace(".", ","): es-PE usa COMA para miles y PUNTO para decimales.
  // Forzar la coma hacía que en la misma línea conviviera "18,394" (coma =
  // miles) con "0,18 %" (coma = decimal), o sea el mismo carácter con dos
  // significados en un producto que habla de plata. El locale decide, no nosotros.
  return `${p.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
}

/** Descripción de identidad sin kicker sobre el título: va debajo del nombre, en una línea. */
export function identidadAliado(row: RankingRow): string {
  const partes = [esFundador(row) ? "La propia plataforma · capital semilla" : TIPO_LABEL[row.tipo]];
  const d = desdeTxt(row.desde);
  if (d) partes.push(`aporta desde ${d}`);
  return partes.join(" · ");
}

/**
 * Una comparación con su barra a escala: "33 leídos de 45 financiados".
 * Nunca un número solo en una caja — esa plantilla es justo la que la
 * dirección rechaza, y aquí además borraría la única historia que importa,
 * que es la proporción.
 */
export function Proporcion({
  parte,
  total,
  leyenda,
  tono,
}: {
  parte: number;
  total: number;
  leyenda: string;
  tono: "financiado" | "leido" | "neutro";
}) {
  const barra = tono === "financiado" ? "bg-heroViolet" : tono === "leido" ? "bg-heroGreen" : "bg-inkSoft/40";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] leading-snug text-inkSoft">
          <span className="font-mono text-sm font-semibold text-ink">{num(parte)}</span> {leyenda}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-mute">{pctTxt(parte, total)}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
        <div
          className={`h-1.5 min-w-[2px] rounded-full ${barra}`}
          style={{ width: `${total > 0 ? (parte / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Ficha del aliado. Se usa cuando el muro tiene pocos nombres, y como
 * cabecera de su propia página.
 */
export function TarjetaAliado({
  row,
  financiadosMuro,
  regionesConCola,
  plano = false,
}: {
  row: RankingRow;
  /** Contratos financiados por TODO el muro: es el denominador de "de lo financiado". */
  financiadosMuro: number;
  /** Regiones con cola abierta: denominador de las zonas alcanzadas. */
  regionesConCola: number;
  /**
   * Sin superficie propia. El bloque de la landing ya vive dentro de un panel con
   * borde y sombra: dibujar otra tarjeta adentro sería una tarjeta anidada, que es
   * justo lo que la dirección prohíbe. La separación la ponen los divisores del padre.
   */
  plano?: boolean;
}) {
  return (
    <article className={plano ? "py-4 first:pt-0 last:pb-0" : "rounded-2xl border border-line bg-paper p-5 sm:p-6"}>
      <div className="flex flex-wrap items-start gap-4">
        <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl font-bold leading-tight text-ink">
            {row.slug ? (
              <Link href={`/aliado/${row.slug}`} className="hover:underline">
                {row.nombre}
              </Link>
            ) : (
              row.nombre
            )}
          </h3>
          <p className="mt-0.5 text-[13px] text-mute">{identidadAliado(row)}</p>
        </div>
        {row.slug && (
          <Link
            href={`/aliado/${row.slug}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep"
          >
            Ver sus contratos <ArrowUpRight size={13} aria-hidden />
          </Link>
        )}
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <Proporcion
          parte={row.contratosFinanciados}
          total={financiadosMuro}
          leyenda={`de los ${num(financiadosMuro)} contratos financiados en el muro`}
          tono="financiado"
        />
        <Proporcion
          parte={row.contratosProcesados}
          total={row.contratosFinanciados}
          leyenda={`de sus ${num(row.contratosFinanciados)} contratos ya leídos`}
          tono="leido"
        />
        <Proporcion
          parte={row.senalesHalladas}
          total={row.contratosProcesados}
          leyenda={`de los leídos traían al menos una señal`}
          tono="neutro"
        />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-mute">
        Alcanzó <span className="font-mono text-inkSoft">{num(row.zonas)}</span> de las{" "}
        <span className="font-mono text-inkSoft">{num(regionesConCola)}</span> regiones con cola abierta
        {(row.enRevision ?? 0) > 0 && (
          <>
            {" "}· <span className="font-mono text-inkSoft">{num(row.enRevision ?? 0)}</span> de sus contratos
            leídos esperan revisión humana y todavía no cuentan como señal
          </>
        )}
        .
      </p>
    </article>
  );
}

/**
 * Fila del libro mayor. Es un `<tr>`: la tabla que la contiene pone los
 * encabezados, que es donde vive la unidad de cada columna.
 */
export function FilaAliado({ row, regionesConCola }: { row: RankingRow; regionesConCola: number }) {
  const d = desdeTxt(row.desde);
  return (
    <tr className="border-t border-line transition-colors duration-rapido hover:bg-paperSoft">
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        <div className="flex items-center gap-2.5">
          <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">
              {row.slug ? (
                <Link href={`/aliado/${row.slug}`} className="hover:underline">
                  {row.nombre}
                </Link>
              ) : (
                row.nombre
              )}
            </span>
            <span className="block truncate text-[11px] text-mute">
              {esFundador(row) ? "La propia plataforma" : TIPO_LABEL[row.tipo]}
              {d ? ` · desde ${d}` : ""}
            </span>
          </span>
        </div>
      </th>
      <td className="py-2.5 pl-3 text-right font-mono text-sm text-ink">{num(row.contratosFinanciados)}</td>
      <td className="py-2.5 pl-3 text-right font-mono text-sm text-ink">
        {num(row.contratosProcesados)}
        <span className="text-mute"> / {num(row.contratosFinanciados)}</span>
      </td>
      <td className="py-2.5 pl-3 text-right font-mono text-sm text-ink">
        {num(row.senalesHalladas)}
        <span className="text-mute"> / {num(row.contratosProcesados)}</span>
      </td>
      <td className="hidden py-2.5 pl-3 text-right font-mono text-sm text-ink sm:table-cell">
        {num(row.zonas)}
        <span className="text-mute"> / {num(regionesConCola)}</span>
      </td>
      <td className="py-2.5 pl-3 text-right">
        {row.slug && (
          <Link
            href={`/aliado/${row.slug}`}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-ink hover:underline"
          >
            <span className="hidden sm:inline">Ver</span>
            <ArrowUpRight size={13} aria-hidden />
            <span className="sr-only">los contratos de {row.nombre}</span>
          </Link>
        )}
      </td>
    </tr>
  );
}

export function AvatarAliado({ tipo, logoUrl, nombre, size = "sm" }: { tipo: RankingRow["tipo"]; logoUrl: string | null; nombre: string; size?: "sm" | "lg" | "xl" }) {
  const dims = size === "xl" ? "h-20 w-20 rounded-3xl" : size === "lg" ? "h-14 w-14 rounded-2xl" : "h-8 w-8 rounded-lg";
  if (logoUrl) {
    const px = size === "xl" ? 80 : size === "lg" ? 56 : 32;
    // El logo de Vigía Perú (el propio aliado-fundador) llega del API como URL absoluta
    // a este mismo dominio — sin normalizar, el optimizador de Next lo trata como una
    // cache key distinta de cualquier otro <Image> que ya pidió ese mismo archivo por
    // ruta relativa (p.ej. el logo del header), duplicando trabajo de redimensionado
    // para el mismo PNG.
    const src = logoUrl.replace(/^https?:\/\/[^/]+\.run\.app/, "");
    return <Image src={src} alt={nombre} width={px} height={px} className={`${dims} shrink-0 border border-line bg-paper object-contain`} loading="lazy" unoptimized={!/^(https:\/\/(storage\.googleapis\.com|[a-z0-9.-]+\.run\.app)\/|\/)/.test(src)} />;
  }
  const Icon = tipo === "empresa" ? Building2 : tipo === "organizacion" ? Users : User;
  return (
    <span className={`inline-flex ${dims} shrink-0 items-center justify-center bg-paperDeep text-mute`} aria-hidden>
      <Icon size={size === "xl" ? 32 : size === "lg" ? 24 : 15} />
    </span>
  );
}
