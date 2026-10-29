"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Eye,
  FileText,
  HandCoins,
  HardHat,
  Hourglass,
  MapPinned,
  Package,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SIN_REDUCIR, useEscenaGsap } from "@/lib/gsap";
import { numero, porcentaje } from "@/lib/formato";
import { Ayuda } from "@/components/patrones";
import { Carrusel } from "@/components/ui/Carrusel";
import type { AnioEscala, TipoEscala } from "@/lib/landing";
import { CONTRALORIA_CORRUPCION } from "@/lib/costoCorrupcion";

/**
 * "El problema", la primera mitad del pitch: el Estado publica miles de contratos y casi nadie los
 * lee. La segunda mitad es el mapa (PartidosSeccion): lo que Vigía hace al respecto.
 *
 * Es UNA sección corta, no tres pantallas:
 *  1. El titular, en una frase, con el monto total al lado.
 *  2. Una franja de puntos (cada punto, 20 contratos) que hace VER que los leídos son una rendija.
 *  3. Una fila de tarjetas que se desliza a los lados con las seis cifras que cuentan el problema:
 *     publicados, leídos a fondo, con riesgo alto, faltan, se pueden financiar hoy y regiones con
 *     lectura. La acción de financiar vive en la tarjeta de "se pueden financiar hoy": una sola.
 *  4. Los contratos por tipo, en una línea de chips.
 *
 * Cada cifra llega por props desde el servidor, que las lee de la API. Si la API no responde, la
 * sección no se dibuja: una portada que estima cuántos contratos quedaron sin leer es lo que este
 * producto le reprocha al Estado.
 *
 * Animación (sólo sin movimiento reducido): la franja se construye con el scroll, la masa sin leer
 * primero y los puntos lima al final, porque el orden ES el argumento, y los números cuentan desde
 * cero una vez. El HTML del servidor trae todo en su valor final y nada con opacidad cero.
 */

const POR_PUNTO = 20;
const COLUMNAS = 100;

const ICONO: Record<TipoEscala["clave"], LucideIcon> = {
  bienes: Package,
  servicios: Wrench,
  obras: HardHat,
  consultoria: ClipboardList,
  otros: FileText,
};

type Tono = "neutro" | "lima" | "alerta";

export function EscalaDinero({
  montoTotal,
  publicados,
  leidos,
  senalAlta,
  tipos,
  anio,
  financiables,
  precioPen,
  regionesConLectura,
  regionesTotal = 25,
}: {
  /** Suma del monto de los contratos de las 25 regiones, en soles. */
  montoTotal: number;
  publicados: number;
  leidos: number;
  senalAlta: number;
  /** El desglose por tipo; suma `publicados`. Vacío si su lectura falló. */
  tipos: TipoEscala[];
  /** El año de la convocatoria, sólo si casi todo es de ese año. */
  anio: AnioEscala | null;
  /** Contratos que ya se pueden financiar hoy (adjudicados y con documentos). null si no se pudo leer. */
  financiables: number | null;
  /** Lo que cuesta leer un contrato, en soles. null si no se pudo leer. */
  precioPen: number | null;
  /** Regiones donde Vigía ya leyó al menos un contrato. null si no se pudo leer. */
  regionesConLectura: number | null;
  regionesTotal?: number;
}) {
  const raiz = useRef<HTMLElement>(null);

  const puntos = Math.ceil(publicados / POR_PUNTO);
  const filas = Math.ceil(puntos / COLUMNAS);
  const puntosLeidos = Math.max(1, Math.round(leidos / POR_PUNTO));
  const milMillones = Math.floor(montoTotal / 1e9);
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;
  const unaDeCada = leidos > 0 ? Math.round(publicados / leidos) : null;
  const faltan = Math.max(0, publicados - leidos);
  const sinLectura = regionesConLectura != null ? Math.max(0, regionesTotal - regionesConLectura) : null;

  useEscenaGsap(
    raiz,
    SIN_REDUCIR,
    ({ gsap }) => {
      // La franja: se construye con el scroll y termina cuando llega al centro de la pantalla.
      const matriz = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: ".matriz", start: "top 92%", end: "center 62%", scrub: 0.6 },
      });
      matriz
        .fromTo(".matriz-recorte", { attr: { width: 0 } }, { attr: { width: COLUMNAS }, duration: 0.72 })
        .fromTo(
          ".punto-leido",
          { scale: 0, transformOrigin: "50% 50%" },
          { scale: 1, duration: 0.18, stagger: 0.02, ease: "back.out(3)" },
          0.74,
        );

      // Cada número marcado con .cuenta cuenta desde cero, una sola vez. Las tarjetas no se ocultan ni se atenúan:
      // algunas están fuera de pantalla en el carrusel y un hueco se lee como "no cargó".
      // El cero aparece recién cuando la cuenta ARRANCA (`onStart`), no al montar: antes el DOM decía "0" hasta que la
      // fila entraba en pantalla, y eso leían el lector de pantalla, Ctrl+F y la impresión (cero es un dato, §10.2).
      const cuentas = gsap.utils.toArray<HTMLElement>(".cifras-escala .cuenta");
      const real = (el: HTMLElement) => numero(Number(el.dataset.valor ?? 0));
      const tl = gsap.timeline({
        scrollTrigger: { trigger: ".cifras-escala", start: "top 88%", once: true },
        onStart: () => cuentas.forEach((el) => (el.textContent = "0")),
      });
      cuentas.forEach((el, i) => {
        const fin = Number(el.dataset.valor ?? 0);
        const v = { v: 0 };
        tl.to(v, { v: fin, duration: 1.2, ease: "power2.out", onUpdate: () => (el.textContent = numero(v.v)), onComplete: () => (el.textContent = real(el)) }, 0.06 * i);
      });
      // Si la escena se desarma a mitad de la cuenta, cada número vuelve a su valor real (nunca queda uno intermedio).
      return () => cuentas.forEach((el) => (el.textContent = real(el)));
    },
    { diferido: true },
  );

  return (
    <section
      ref={raiz}
      id="escala"
      data-tema="oscuro"
      aria-labelledby="escala-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden bg-ink text-paper"
    >
      <div className="container-page relative py-14 sm:py-16">
        {/* ── La idea, en una frase ─────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="max-w-3xl">
            <h2 id="escala-titulo" className="text-balance font-display text-3xl font-bold leading-[1.06] tracking-tight sm:text-5xl">
              El Estado publicó <span className="text-maiz">{numero(publicados)}</span> contratos{anio ? ` en ${anio.anio}` : ""} y casi nadie los
              lee.
            </h2>
          </div>
          <p className="flex max-w-xs items-start gap-x-1.5 text-cuerpo leading-snug text-paper/80">
            <span>Juntos suman más de S/ {numero(milMillones)} mil millones.</span>
            <Ayuda titulo="¿De dónde salen estas cifras?" className="text-paper/60 hover:bg-paper/10 hover:text-maiz">
              <span className="block">
                Son las convocatorias publicadas en el SEACE{anio ? ` en ${anio.anio}` : ""}, las que Vigía lee. El monto es la suma del valor
                referencial de cada convocatoria, no lo pagado.
              </span>
              <span className="mt-2 block text-mute">
                La base trae además las de años anteriores, desde 2015: se ven en Contratos, en cada entidad y en cada partido.
              </span>
            </Ayuda>
          </p>
        </div>

        {/* ── La imagen que lo dice sin números ───────────────────── */}
        <figure className="matriz mt-7">
          <svg
            viewBox={`0 0 ${COLUMNAS} ${filas}`}
            className="h-auto w-full text-paper/30"
            role="img"
            aria-label={`${numero(publicados)} contratos en una franja de ${numero(puntos)} puntos. Los ${numero(puntosLeidos)} puntos lima son los ${numero(leidos)} que Vigía leyó.`}
          >
            <defs>
              {/* `currentColor` hereda del <svg> (text-paper/30): el contenido de un patrón toma el color de su lugar en el DOM. */}
              <pattern id="punto-contrato" width="1" height="1" patternUnits="userSpaceOnUse">
                <circle cx="0.5" cy="0.5" r="0.3" fill="currentColor" />
              </pattern>
              <clipPath id="recorte-matriz">
                <rect className="matriz-recorte" x="0" y="0" width={COLUMNAS} height={filas} />
              </clipPath>
            </defs>
            <rect x="0" y="0" width={COLUMNAS} height={filas} fill="url(#punto-contrato)" clipPath="url(#recorte-matriz)" />
            {Array.from({ length: puntosLeidos }, (_, i) => (
              <circle key={i} className="punto-leido fill-maiz" cx={i + 0.5} cy={0.5} r={0.42} />
            ))}
          </svg>
          <figcaption className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-meta text-paper/75">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-paper/40" /> Cada punto son {POR_PUNTO} contratos
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-maiz" /> Los que Vigía ya leyó
            </span>
          </figcaption>
        </figure>

        {/* Lo que cuesta no leerlos, en cosas y no sólo en cifras, con la estimación de la Contraloría y su fuente. */}
        <p className="mt-8 max-w-[64ch] text-pretty text-bloque leading-relaxed text-paper/85">
          Y no leerlos tiene precio. Según la Contraloría, en {CONTRALORIA_CORRUPCION.anio} la corrupción y la inconducta funcional se habrían
          llevado <strong className="font-semibold text-paper">S/ {numero(CONTRALORIA_CORRUPCION.millones)} millones</strong>, casi 13 de cada
          100 soles del presupuesto: la plata de carreteras, hospitales y colegios.{" "}
          <a
            href={CONTRALORIA_CORRUPCION.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-maiz underline decoration-maiz/50 underline-offset-2 hover:decoration-maiz"
          >
            Ver la fuente<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </p>

        {/* ── Las cifras, en una fila que se desliza ──────────────── */}
        <div className="cifras-escala mt-8">
          <Carrusel etiqueta="Las cifras del problema" oscuro anchoTarjeta="w-[80%] sm:w-[17.5rem]">
            <Cifra Icono={FileText} titulo="Publicados" valor={publicados} frase="Todo lo que las entidades subieron al SEACE, el portal de compras del Estado." />
            <Cifra
              Icono={Eye}
              titulo="Leídos a fondo"
              valor={leidos}
              tono="lima"
              apoyo={unaDeCada ? `1 de cada ${numero(unaDeCada)} (${porcentaje(pct, { decimales: 1 })})` : undefined}
              frase="Bases, actas y contrato, cruzados con registros oficiales."
            />
            <Cifra
              Icono={AlertTriangle}
              titulo="Con riesgo alto"
              valor={senalAlta}
              tono="alerta"
              apoyo={`de los ${numero(leidos)} leídos`}
              frase="Los primeros que conviene revisar. Una señal es para revisar, nunca una acusación."
            />
            <Cifra Icono={Hourglass} titulo="Faltan por leer" valor={faltan} frase="Se leen según lo que aportamos entre todos." />
            {financiables != null && (
              <Cifra
                Icono={HandCoins}
                titulo="Listos para leer"
                valor={financiables}
                tono="lima"
                frase="Ya están adjudicados y con documentos. Se leen primero los más graves, con lo que aportamos entre todos."
                accion={{ href: "/app/apoyar", texto: "Ayúdanos a leerlos" }}
              />
            )}
            {regionesConLectura != null && (
              <Cifra
                Icono={MapPinned}
                titulo="Regiones con lectura"
                valor={regionesConLectura}
                sufijo={` de ${numero(regionesTotal)}`}
                frase={
                  sinLectura && sinLectura > 0
                    ? `En ${numero(sinLectura)} regiones todavía no se leyó ningún contrato.`
                    : "En todas hay al menos un contrato leído."
                }
              />
            )}
          </Carrusel>
        </div>

        {/* ── Por tipo, en una línea ──────────────────────────────── */}
        {tipos.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-meta font-semibold text-paper/75">Por tipo</p>
            <ul aria-label="Contratos publicados y leídos por tipo" className="carrusel-lista -mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {tipos.map((t) => {
                const Icono = ICONO[t.clave];
                return (
                  <li key={t.clave} className="flex shrink-0 items-center gap-2 rounded-full border border-paper/15 bg-paper/[0.04] px-3.5 py-2 text-dato">
                    <Icono size={15} className="shrink-0 text-maiz/90" aria-hidden />
                    <span className="text-paper/90">{t.etiqueta}</span>
                    <span className="font-mono tabular-nums text-paper">{numero(t.total)}</span>
                    {t.leidos != null && t.leidos > 0 && (
                      <span className="font-mono text-meta tabular-nums text-maiz">{numero(t.leidos)} leídos</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Una tarjeta del carrusel: el nombre, UNA cifra grande y una frase que dice qué significa. */
function Cifra({
  Icono,
  titulo,
  valor,
  frase,
  apoyo,
  sufijo,
  tono = "neutro",
  accion,
}: {
  Icono: LucideIcon;
  titulo: string;
  valor: number;
  frase: string;
  apoyo?: string;
  /** Texto que sigue a la cifra, sin contar ("de 25"). */
  sufijo?: string;
  tono?: Tono;
  /** La única acción de la tarjeta, si la tiene. */
  accion?: { href: string; texto: string };
}) {
  const color = tono === "lima" ? "text-maiz" : tono === "alerta" ? "text-alertaBanda" : "text-paper";
  return (
    <div
      className={
        "flex h-full min-w-0 flex-col rounded-2xl border p-5 " +
        (tono === "lima" ? "border-maiz/45 bg-maiz/[0.07]" : tono === "alerta" ? "border-crimson/40 bg-crimson/[0.07]" : "border-paper/15 bg-paper/[0.04]")
      }
    >
      <p className={"flex items-center gap-2 text-dato font-semibold " + (tono === "neutro" ? "text-paper/85" : color)}>
        <Icono size={17} aria-hidden /> {titulo}
      </p>
      <p className={"mt-3 font-display text-5xl font-bold leading-none tabular-nums sm:text-[3.4rem] " + color}>
        {/* El valor real en el HTML desde el servidor; la cuenta animada es sólo para la vista, el lector oye el número. */}
        <span className="cuenta" data-valor={valor} aria-hidden>
          {numero(valor)}
        </span>
        <span className="sr-only">{numero(valor)}</span>
        {sufijo && <span className="ml-1 text-2xl font-semibold text-paper/70 sm:text-3xl">{sufijo}</span>}
      </p>
      {apoyo && <p className="mt-2 text-dato font-medium text-paper/90">{apoyo}</p>}
      <p className="mt-2 text-dato leading-snug text-paper/70">{frase}</p>
      {accion && (
        <Link
          href={accion.href}
          className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-3 text-dato font-semibold text-maiz underline-offset-4 hover:underline"
        >
          {accion.texto} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}
