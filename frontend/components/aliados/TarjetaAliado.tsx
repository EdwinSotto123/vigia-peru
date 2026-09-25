import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Building2, PanelRightOpen, User, Users } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Cifras } from "@/components/ui/Cifras";
import { FranjaTextil } from "@/components/marca";
import { cn } from "@/lib/utils";
import { fechaCorta, numero } from "@/lib/formato";
import type { RankingRow } from "@/lib/financiamiento";
import { SelloMaqueta } from "./AvisoMaqueta";
import { IdentidadAliado, Insignias, insigniasDe, mesesDesde, type DatoIdentidad } from "./IdentidadAliado";

/**
 * La ficha de un aliado en el muro (la fila de la tabla, pasadas las doce fichas, la
 * arma `MuroAliados` con la `Tabla` de todo listado).
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
 *
 * Densidad (DESIGN_SYSTEM.md §10.7): la ficha del muro es identidad + una línea
 * de cifras + una barra (su peso en el muro). Las tres barras con su leyenda
 * larga que había acá repetían, en el muro, lo que el panel "Resumen" ya
 * muestra completo a un clic.
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

/** Vigía Perú se autofinancia con capital semilla: aparece en su propio muro y se dice tal cual. */
export const esFundador = (row: { slug: string | null }) => row.slug === "vigia-peru";

const num = numero;

/** "14 jun." o "14 jun. 2025": la fecha corta única del producto (lib/formato). */
const desdeTxt = (desde: string | null) => (desde ? fechaCorta(desde) : null);

/**
 * Identidad del aliado, en piezas con ícono — no en una cadena de puntos medios.
 *
 * Esto antes devolvía el string `"Organización · aporta desde jun 2026"`, que
 * es la mala práctica que el producto dejó de aceptar: un separador que no es
 * puntuación, pegando datos de distinta naturaleza en un renglón que hay que
 * leer entero para sacar uno solo.
 */
export function datosIdentidad(row: RankingRow): DatoIdentidad[] {
  const datos: DatoIdentidad[] = [
    esFundador(row)
      ? {
          icono: "tipo-organizacion",
          texto: "La propia plataforma",
          titulo: "Vigía Perú se autofinancia con capital semilla y aparece en su propio muro.",
        }
      : { icono: TIPO_ICONO[row.tipo], texto: TIPO_LABEL[row.tipo] },
  ];
  const d = desdeTxt(row.desde);
  if (d) datos.push({ icono: "fecha", texto: `Aporta desde ${d}` });
  return datos;
}

const ANILLO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/** Acción secundaria dentro de la tarjeta: píldora (el gesto de acción del sitio). */
const ACCION_TARJETA =
  "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink transition-colors duration-rapido";

/**
 * Ficha del aliado dentro del muro. Se usa cuando el muro cabe en tarjetas
 * (hasta una docena de nombres); pasado eso manda la tabla del listado.
 */
export function TarjetaAliado({
  row,
  financiadosMuro,
  regionesConCola,
  plano = false,
  href,
  resumen,
  esMaqueta = false,
  regionesAlcanzadas,
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
  /**
   * Regiones (departamentos) distintas que alcanzó, contadas desde su perfil. El ranking
   * trae `zonas` = ubigeos distintos, y Huaral y Lima contaban como dos regiones.
   * Sin perfil (tabla, o el API no respondió) se usa `row.zonas`.
   */
  regionesAlcanzadas?: number;
}) {
  const enRevision = row.enRevision ?? 0;
  const regiones = regionesAlcanzadas ?? row.zonas;
  const pesoMuro = financiadosMuro > 0 ? (row.contratosFinanciados / financiadosMuro) * 100 : 0;

  return (
    <article
      className={cn(
        "flex h-full flex-col",
        plano
          ? "py-4 first:pt-0 last:pb-0"
          : esMaqueta
            ? "rounded-2xl border border-dashed border-amber/60 bg-amber-soft/30"
            : "overflow-hidden rounded-2xl border border-line bg-paper",
      )}
    >
      {/* La franja textil de 8 px es la firma de marca de una tarjeta de aliado
          (DESIGN_SYSTEM.md §6). Un aliado de maqueta no la lleva: no es Vigía
          reconociendo a nadie, es un borrador que tiene que verse como tal. */}
      {!plano && !esMaqueta && <FranjaTextil alto={8} />}
      <div className={cn("flex flex-1 flex-col", !plano && "p-5")}>
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
            {/* El sello de maqueta va en la línea del nombre y baja de renglón si no cabe:
                como columna aparte empujaba la tarjeta a 399 px en un teléfono de 390. */}
            <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-xl font-bold leading-tight text-ink">
              {href ? (
                <Link href={href} className={cn("min-w-0 break-words rounded hover:underline", ANILLO)}>
                  {row.nombre}
                </Link>
              ) : (
                <span className="min-w-0 break-words">{row.nombre}</span>
              )}
              {esMaqueta && <SelloMaqueta className="shrink-0 font-sans" />}
            </h3>
            <IdentidadAliado datos={datosIdentidad(row)} className="mt-1" />
            {/* Las insignias también acá, no sólo en la ficha: el muro es donde
                de verdad mira la gente, y esta página existe para enaltecer a
                quien financia. Sólo las propias de este aliado: "Sin conflicto de
                interés" la tienen TODOS los del muro (estar acá es el chequeo), así
                que se dice una vez, en el ⓘ del muro, y en la ficha completa. Se
                topan en dos; todas se derivan de sus cifras, ninguna a dedo. */}
            <Insignias
              className="mt-2"
              limite={2}
              insignias={insigniasDe({
                esFundador: esFundador(row),
                financiados: row.contratosFinanciados,
                leidos: row.contratosProcesados,
                regiones,
                regionesConCola,
                mesesAportando: mesesDesde(row.desde),
              }).filter((i) => i.clave !== "limpio")}
            />
          </div>
        </div>

        {/* Lo que hizo leer, en una línea de cifras con su denominador, y su peso en el muro
            como barra a escala real (granate: alguien pagó). */}
        <div className={cn("mb-4 mt-4 space-y-2 border-t pt-3", esMaqueta ? "border-amber/40" : "border-line")}>
          <Cifras
            className="gap-x-4"
            items={[
              // Sin `titulo` acá: el panel "Resumen" explica cada cifra con su frase completa.
              { n: row.contratosFinanciados, de: financiadosMuro, texto: "financiados" },
              { n: row.contratosProcesados, de: row.contratosFinanciados, texto: "leídos" },
              { n: row.senalesHalladas, de: row.contratosProcesados, texto: "con señales" },
              { n: regiones, de: regionesConCola, texto: "regiones" },
              { n: enRevision, texto: "en revisión", ocultarEnCero: true },
            ]}
          />
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-paperDeep"
            role="img"
            aria-label={`${num(row.contratosFinanciados)} de ${num(financiadosMuro)} contratos financiados del muro`}
          >
            <div className="h-1.5 min-w-[2px] rounded-full bg-granate" style={{ width: `${pesoMuro}%` }} />
          </div>
        </div>

        {(resumen || href) && (
          <div
            className={cn(
              "mt-auto flex flex-wrap items-center gap-2 pt-3",
              // En la landing la tarjeta ya vive entre divisores del padre: un borde
              // propio acá sería una raya de más cada dos filas.
              !plano && "border-t",
              !plano && (esMaqueta ? "border-amber/40" : "border-line"),
              plano && "mt-3",
            )}
          >
            {resumen && (
              <Revelar
                titulo={row.nombre}
                descripcion={<IdentidadAliado datos={datosIdentidad(row)} />}
                ancho="lg"
                etiqueta={`Ver el resumen de ${row.nombre} sin salir del muro`}
                className={cn(ACCION_TARJETA, "w-auto border border-line bg-paper hover:border-granate/40 hover:bg-granate-50", ANILLO)}
                pie={
                  href ? (
                    <Link href={href} className="inline-flex min-h-[24px] items-center gap-1.5 text-[13px] font-semibold text-granate underline-offset-2 hover:underline">
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
              <Link href={href} className={cn(ACCION_TARJETA, "hover:bg-paperDeep", ANILLO)}>
                Su ficha <ArrowUpRight size={13} aria-hidden />
              </Link>
            )}
          </div>
        )}
      </div>
    </article>
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
  const dims = size === "xl" ? "h-20 w-20 rounded-2xl" : size === "lg" ? "h-14 w-14 rounded-xl" : "h-8 w-8 rounded-lg";
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
