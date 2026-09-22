import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Building2, PanelRightOpen, User, Users } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { cn } from "@/lib/utils";
import type { RankingRow } from "@/lib/financiamiento";
import { SelloMaqueta } from "./AvisoMaqueta";

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
 * Lo que sí ganó, porque quien financia es la razón de que las auditorías
 * existan y estaba reducido a una fila de tabla:
 *  - **El logo es la afordancia principal y lleva a su ficha.** Antes no era
 *    clickeable: el único camino a `/aliado/[slug]` era un link de texto al
 *    costado.
 *  - **Resumen al vuelo.** `<Revelar>` abre sus aportes, sus regiones y lo que
 *    salió en sus contratos en un panel lateral, sin perder el muro. Navegar
 *    cuesta el contexto; acá el contexto es el muro entero.
 *  - **Identidad propia, sin podio.** Todas las tarjetas tienen la misma
 *    estructura y el mismo peso: lo que las diferencia son sus barras, que
 *    están a escala real. Destacar una sería volver al escenario.
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

const ANILLO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

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
 * Ficha del aliado dentro del muro. Se usa cuando el muro cabe en tarjetas
 * (hasta una docena de nombres); pasado eso manda la tabla.
 */
export function TarjetaAliado({
  row,
  financiadosMuro,
  regionesConCola,
  plano = false,
  href,
  resumen,
  esMaqueta = false,
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
  /** Href de su ficha, ya armado (puede llevar `?maqueta=1`). Sin slug, no hay ficha. */
  href?: string;
  /**
   * Contenido del panel de resumen, ya renderizado en el servidor. ReactNode,
   * nunca una función: un Server Component no puede pasar funciones a un Client
   * Component — compila, pasa `tsc` y rompe sólo en producción.
   */
  resumen?: ReactNode;
  esMaqueta?: boolean;
}) {
  const zonas = (
    <p className="mt-3 text-[12px] leading-relaxed text-mute">
      Alcanzó <span className="font-mono text-inkSoft">{num(row.zonas)}</span> de las{" "}
      <span className="font-mono text-inkSoft">{num(regionesConCola)}</span> regiones con cola abierta
      {(row.enRevision ?? 0) > 0 && (
        <>
          {" "}· <span className="font-mono text-inkSoft">{num(row.enRevision ?? 0)}</span> de sus contratos
          leídos {(row.enRevision ?? 0) === 1 ? "espera" : "esperan"} revisión humana y todavía no{" "}
          {(row.enRevision ?? 0) === 1 ? "cuenta" : "cuentan"} como señal
        </>
      )}
      .
    </p>
  );

  return (
    <article
      className={cn(
        "flex h-full flex-col",
        plano
          ? "py-4 first:pt-0 last:pb-0"
          : esMaqueta
            ? "rounded-2xl border border-dashed border-amber/60 bg-amber-soft/30 p-5 sm:p-6"
            : "rounded-2xl border border-line bg-paper p-5 sm:p-6",
      )}
    >
      <div className="flex items-start gap-4">
        {href ? (
          // Duplicado deliberado del link del nombre: el logo es la afordancia que
          // el ojo busca, pero un segundo tab-stop al mismo destino sólo hace ruido
          // en teclado y lector de pantalla.
          <Link href={href} tabIndex={-1} aria-hidden className="shrink-0">
            <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" maqueta={esMaqueta} />
          </Link>
        ) : (
          <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" maqueta={esMaqueta} />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl font-bold leading-tight text-ink">
            {href ? (
              <Link href={href} className={cn("rounded hover:underline", ANILLO)}>
                {row.nombre}
              </Link>
            ) : (
              row.nombre
            )}
          </h3>
          <p className="mt-0.5 text-[13px] leading-snug text-mute">{identidadAliado(row)}</p>
        </div>
        {esMaqueta && <SelloMaqueta className="shrink-0" />}
      </div>

      <div className={cn("mt-5 space-y-3 border-t pt-4", esMaqueta ? "border-amber/40" : "border-line")}>
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
          leyenda="de los leídos traían al menos una señal"
          tono="neutro"
        />
      </div>
      {zonas}

      {(resumen || href) && (
        <div
          className={cn(
            "mt-auto flex flex-wrap items-center gap-2",
            // En la landing la tarjeta ya vive entre divisores del padre: un borde
            // propio acá sería una raya de más cada dos filas.
            !plano && "border-t pt-3",
            !plano && (esMaqueta ? "border-amber/40" : "border-line"),
            plano && "mt-3",
          )}
        >
          {resumen && (
            <Revelar
              titulo={row.nombre}
              descripcion={identidadAliado(row)}
              ancho="lg"
              etiqueta={`Ver el resumen de ${row.nombre} sin salir del muro`}
              className={cn(
                "w-auto inline-flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-1.5 text-[13px] font-medium text-ink",
                "transition-colors duration-rapido hover:bg-paperDeep",
                ANILLO,
              )}
              pie={
                href ? (
                  <Link href={href} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink hover:underline">
                    Ver la ficha completa de {row.nombre} <ArrowUpRight size={13} aria-hidden />
                  </Link>
                ) : undefined
              }
              detalle={resumen}
            >
              <PanelRightOpen size={13} aria-hidden /> Resumen
            </Revelar>
          )}
          {href && (
            <Link
              href={href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium text-ink",
                "transition-colors duration-rapido hover:bg-paperDeep",
                ANILLO,
              )}
            >
              Su ficha y sus contratos <ArrowUpRight size={13} aria-hidden />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Fila del libro mayor. Es un `<tr>`: la tabla que la contiene pone los
 * encabezados, que es donde vive la unidad de cada columna.
 */
export function FilaAliado({
  row,
  regionesConCola,
  href,
  esMaqueta = false,
}: {
  row: RankingRow;
  regionesConCola: number;
  href?: string;
  esMaqueta?: boolean;
}) {
  const d = desdeTxt(row.desde);
  return (
    <tr className="border-t border-line transition-colors duration-rapido hover:bg-paperSoft">
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        <div className="flex items-center gap-2.5">
          {href ? (
            <Link href={href} tabIndex={-1} aria-hidden className="shrink-0">
              <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="sm" maqueta={esMaqueta} />
            </Link>
          ) : (
            <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="sm" maqueta={esMaqueta} />
          )}
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              {href ? (
                <Link href={href} className={cn("truncate rounded hover:underline", ANILLO)}>
                  {row.nombre}
                </Link>
              ) : (
                <span className="truncate">{row.nombre}</span>
              )}
              {esMaqueta && <SelloMaqueta className="shrink-0" />}
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
        {href && (
          <Link href={href} className={cn("inline-flex items-center gap-1 rounded text-[13px] font-medium text-ink hover:underline", ANILLO)}>
            <span className="hidden sm:inline">Ver</span>
            <ArrowUpRight size={13} aria-hidden />
            <span className="sr-only">los contratos de {row.nombre}</span>
          </Link>
        )}
      </td>
    </tr>
  );
}

export function AvatarAliado({
  tipo,
  logoUrl,
  nombre,
  size = "sm",
  maqueta = false,
}: {
  tipo: RankingRow["tipo"];
  logoUrl: string | null;
  nombre: string;
  size?: "sm" | "lg" | "xl";
  /** Marca el avatar de un aliado inventado: borde punteado, para distinguirlo de un vistazo. */
  maqueta?: boolean;
}) {
  const dims = size === "xl" ? "h-20 w-20 rounded-3xl" : size === "lg" ? "h-14 w-14 rounded-2xl" : "h-8 w-8 rounded-lg";
  const marco = maqueta ? "border-dashed border-amber/70 bg-amber-soft/50" : "border-line bg-paper";
  if (logoUrl) {
    const px = size === "xl" ? 80 : size === "lg" ? 56 : 32;
    // El logo de Vigía Perú (el propio aliado-fundador) llega del API como URL absoluta
    // a este mismo dominio — sin normalizar, el optimizador de Next lo trata como una
    // cache key distinta de cualquier otro <Image> que ya pidió ese mismo archivo por
    // ruta relativa (p.ej. el logo del header), duplicando trabajo de redimensionado
    // para el mismo PNG.
    const src = logoUrl.replace(/^https?:\/\/[^/]+\.run\.app/, "");
    return <Image src={src} alt={nombre} width={px} height={px} className={cn(dims, "shrink-0 border object-contain", marco)} loading="lazy" unoptimized={!/^(https:\/\/(storage\.googleapis\.com|[a-z0-9.-]+\.run\.app)\/|\/)/.test(src)} />;
  }
  const Icon = tipo === "empresa" ? Building2 : tipo === "organizacion" ? Users : User;
  return (
    <span
      className={cn(
        dims,
        "inline-flex shrink-0 items-center justify-center border",
        maqueta ? `${marco} text-amberTexto` : "border-transparent bg-paperDeep text-mute",
      )}
      aria-hidden
    >
      <Icon size={size === "xl" ? 32 : size === "lg" ? 24 : 15} />
    </span>
  );
}
