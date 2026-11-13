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
import { cn } from "@/lib/utils";
import { Ayuda } from "@/components/patrones";
import type { AnioEscala, TipoEscala } from "@/lib/landing";
import { DeCadaCien } from "@/components/financiar/DeCadaCien";

/**
 * "El problema", la primera mitad del pitch: el Estado publica miles de contratos y casi nadie los
 * lee. La segunda mitad es el mapa (PartidosSeccion): lo que Vigía hace al respecto.
 *
 * Es UNA banda, armada como un tablero (2026-11-13): antes era una pila de cuatro bloques a lo ancho, con las seis cifras
 * en un carrusel que mostraba una y media y cortaba la siguiente en el borde, y los tipos en una fila de chips que
 * también se cortaba. Ahora:
 *  1. El titular, en una frase, con el monto total al lado.
 *  2. A la izquierda, la franja de puntos (cada punto, 20 contratos) que hace VER que los leídos son una rendija, y
 *     debajo cada tipo de contrato con su barra: el largo es lo publicado y lo lima, lo leído.
 *  3. A la derecha (desde xl; antes, debajo), las seis cifras en una grilla, todas a la vista, cada una con su barra cuando es parte de algo.
 *     La acción de leer vive en la cifra de "listos para leer": una sola. Debajo, lo que cuesta no leerlos.
 *
 * Cada cifra llega por props desde el servidor, que las lee de la API. Si la API no responde, la
 * sección no se dibuja: una portada que estima cuántos contratos quedaron sin leer es lo que este
 * producto le reprocha al Estado.
 *
 * Animación (sólo sin movimiento reducido): los puntos lima aparecen una vez, cuando la franja entra en pantalla, y los
 * números cuentan desde cero una vez. La masa sin leer está siempre entera: antes se construía con el scroll (`scrub`) y
 * al volver arriba se deshacía, así que una captura de la página entera, o quien bajaba rápido, veía una caja vacía (la
 * «banda vacía» de la auditoría del 2026-11-13). El HTML del servidor trae todo en su valor final.
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

/** El ⓘ sobre la banda oscura. */
const AYUDA_OSCURA = "text-paper/60 hover:bg-paper/10 hover:text-maiz";

export function EscalaDinero({
  montoTotal,
  publicados,
  leidos,
  senalAlta,
  tipos,
  anio,
  financiables,
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
      // Los puntos lima, una vez, al entrar la franja en pantalla. Sin `immediateRender`: hasta ese momento se ven (una
      // captura sin scroll no los pierde).
      gsap.fromTo(
        ".punto-leido",
        { scale: 0, transformOrigin: "50% 50%" },
        {
          scale: 1,
          duration: 0.3,
          stagger: { amount: 0.9 },
          ease: "back.out(3)",
          immediateRender: false,
          scrollTrigger: { trigger: ".matriz", start: "top 85%", once: true },
        },
      );

      // Cada número marcado con .cuenta cuenta desde cero, una sola vez. Las tarjetas no se ocultan ni se atenúan: un
      // hueco se lee como "no cargó".
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
      <div className="container-page relative py-10 sm:py-12">
        {/* ── La idea, en una frase ─────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
          <h2 id="escala-titulo" className="max-w-3xl text-balance font-display text-cifra font-bold leading-[1.08] tracking-tight sm:text-titulo">
            El Estado publicó <span className="text-maiz">{numero(publicados)}</span> contratos{anio ? ` en ${anio.anio}` : ""} y casi nadie los
            lee.
          </h2>
          <p className="flex max-w-xs items-start gap-x-1.5 text-cuerpo leading-snug text-paper/80">
            <span>Juntos suman más de S/ {numero(milMillones)} mil millones.</span>
            <Ayuda titulo="¿De dónde salen estas cifras?" className={AYUDA_OSCURA}>
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

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-6">
          {/* ── Izquierda: la imagen que lo dice sin números, y los tipos ── */}
          <div className="min-w-0 space-y-5">
            <figure className="matriz rounded-2xl border border-paper/15 p-4">
              <svg
                viewBox={`0 0 ${COLUMNAS} ${filas}`}
                className="h-auto w-full text-paper/35"
                role="img"
                aria-label={`${numero(publicados)} contratos en una franja de ${numero(puntos)} puntos. Los ${numero(puntosLeidos)} puntos lima son los ${numero(leidos)} que Vigía leyó.`}
              >
                <defs>
                  {/* `currentColor` hereda del <svg> (text-paper/30): el contenido de un patrón toma el color de su lugar en el DOM. */}
                  <pattern id="punto-contrato" width="1" height="1" patternUnits="userSpaceOnUse">
                    <circle cx="0.5" cy="0.5" r="0.34" fill="currentColor" />
                  </pattern>
                </defs>
                {/* La última fila, sólo hasta donde llegan los puntos: la franja cuenta los publicados, no un rectángulo. */}
                <rect x="0" y="0" width={COLUMNAS} height={filas - 1} fill="url(#punto-contrato)" />
                <rect x="0" y={filas - 1} width={puntos - (filas - 1) * COLUMNAS} height="1" fill="url(#punto-contrato)" />
                {Array.from({ length: puntosLeidos }, (_, i) => (
                  <circle key={i} className="punto-leido fill-maiz" cx={i + 0.5} cy={0.5} r={0.42} />
                ))}
              </svg>
              <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-paper/75">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-paper/40" /> Cada punto son {POR_PUNTO} contratos
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-maiz" /> Los que Vigía ya leyó
                </span>
              </figcaption>
            </figure>

            {tipos.length > 0 && <PorTipo tipos={tipos} />}
          </div>

          {/* ── Derecha: las cifras, todas a la vista ──────────────── */}
          <div className="min-w-0 space-y-5">
            <ul aria-label="Las cifras del problema" className="cifras-escala grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Cifra
                Icono={FileText}
                titulo="Publicados"
                valor={publicados}
                apoyo="en el SEACE"
                ayuda="Todo lo que las entidades subieron al SEACE, el portal de compras del Estado."
              />
              <Cifra
                Icono={Eye}
                titulo="Leídos a fondo"
                valor={leidos}
                tono="lima"
                parte={publicados > 0 ? leidos / publicados : null}
                apoyo={unaDeCada ? `1 de cada ${numero(unaDeCada)} (${porcentaje(pct, { decimales: 1 })})` : undefined}
                ayuda="Bases, actas y contrato, cruzados con registros oficiales."
              />
              <Cifra
                Icono={AlertTriangle}
                titulo="Con riesgo alto"
                valor={senalAlta}
                tono="alerta"
                parte={leidos > 0 ? senalAlta / leidos : null}
                apoyo={`de los ${numero(leidos)} leídos`}
                ayuda="Los primeros que conviene revisar. Una señal es para revisar, nunca una acusación."
              />
              <Cifra
                Icono={Hourglass}
                titulo="Faltan por leer"
                valor={faltan}
                parte={publicados > 0 ? faltan / publicados : null}
                apoyo="de los publicados"
                ayuda="Se leen según lo que aportamos entre todos."
              />
              {financiables != null && (
                <Cifra
                  Icono={HandCoins}
                  titulo="Listos para leer"
                  valor={financiables}
                  tono="lima"
                  ayuda="Ya están adjudicados y con documentos. Se leen primero los más graves, con lo que aportamos entre todos."
                  accion={{ href: "/app/apoyar", texto: "Ayúdanos a leerlos" }}
                />
              )}
              {regionesConLectura != null && (
                <Cifra
                  Icono={MapPinned}
                  titulo="Regiones"
                  valor={regionesConLectura}
                  sufijo={` de ${numero(regionesTotal)}`}
                  parte={regionesConLectura / regionesTotal}
                  apoyo={sinLectura && sinLectura > 0 ? `con algo leído; ${numero(sinLectura)} sin ninguno` : "Todas con algo leído"}
                  ayuda="Regiones donde Vigía ya leyó al menos un contrato. La región es la sede de la entidad que contrata."
                />
              )}
            </ul>

            {/* Lo que cuesta no leerlos, dibujado: la cifra de la Contraloría en cien cuadros, con sus dos montos y la
                fuente (DeCadaCien, el mismo de /app/apoyar). */}
            <div className="rounded-2xl border border-paper/15 p-4 sm:p-5">
              <h3 className="font-display text-bloque font-bold leading-tight text-paper">Y no leerlos tiene precio.</h3>
              <DeCadaCien horizontal className="mt-4" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Los contratos por tipo, como barras (antes, una fila de chips que se cortaba en el borde): el largo es lo publicado
 * de ese tipo frente al mayor, y la parte lima lo que Vigía ya leyó. El número de leídos va escrito, porque una rendija
 * de 1 % no se mide a ojo.
 */
function PorTipo({ tipos }: { tipos: TipoEscala[] }) {
  const maximo = Math.max(1, ...tipos.map((t) => t.total));
  return (
    <div className="rounded-2xl border border-paper/15 p-4">
      <h3 className="text-cuerpo font-semibold text-paper/85">Por tipo de contrato</h3>
      <ul aria-label="Contratos publicados y leídos por tipo" className="mt-3 space-y-2.5">
        {tipos.map((t) => {
          const Icono = ICONO[t.clave];
          const leidos = t.leidos ?? 0;
          return (
            <li key={t.clave} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-x-3">
              <span className="flex min-w-0 items-center gap-2 text-dato text-paper/90">
                <Icono size={15} className="shrink-0 text-maiz/90" aria-hidden />
                <span className="truncate">{t.etiqueta}</span>
              </span>
              <span
                role="img"
                aria-label={`${t.etiqueta}: ${numero(t.total)} publicados${t.leidos != null ? `, ${numero(leidos)} leídos` : ""}`}
                className="block h-2.5 overflow-hidden rounded-full bg-paper/[0.06]"
              >
                <span className="relative block h-full rounded-full bg-paper/30" style={{ width: `${Math.max(3, (t.total / maximo) * 100)}%` }}>
                  {leidos > 0 && (
                    <span className="absolute inset-y-0 left-0 rounded-full bg-maiz" style={{ width: `${Math.max(4, (leidos / Math.max(1, t.total)) * 100)}%` }} />
                  )}
                </span>
              </span>
              <span className="text-right font-mono text-meta leading-tight tabular-nums">
                <span className="block text-paper">{numero(t.total)}</span>
                <span className="block text-rotulo text-maiz">{t.leidos == null ? "Sin dato" : `${numero(leidos)} leídos`}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Una cifra de la grilla: el nombre (con su ⓘ), UNA cifra grande, su barra cuando es parte de un todo y una línea de
 * contexto. Sin fondo teñido: el color va sólo en el número (lima lo leído, rojo el riesgo).
 */
function Cifra({
  Icono,
  titulo,
  valor,
  apoyo,
  ayuda,
  parte = null,
  sufijo,
  tono = "neutro",
  accion,
}: {
  Icono: LucideIcon;
  titulo: string;
  valor: number;
  apoyo?: string;
  /** Qué significa, a un toque: antes era un párrafo de tres líneas en cada tarjeta. */
  ayuda?: string;
  /** Qué parte (0 a 1) de su todo es la cifra: dibuja la barra. */
  parte?: number | null;
  /** Texto que sigue a la cifra, sin contar ("de 25"). */
  sufijo?: string;
  tono?: Tono;
  /** La única acción de la tarjeta, si la tiene. */
  accion?: { href: string; texto: string };
}) {
  const color = tono === "lima" ? "text-maiz" : tono === "alerta" ? "text-alertaBanda" : "text-paper";
  const barra = tono === "alerta" ? "bg-alertaBanda" : tono === "lima" ? "bg-maiz" : "bg-paper/70";
  return (
    <li className="flex min-w-0 flex-col rounded-2xl border border-paper/15 p-3.5 sm:p-4">
      <p className="flex min-w-0 items-start gap-1.5 text-meta font-semibold leading-snug text-paper/85">
        <Icono size={15} className={cn("mt-0.5 shrink-0", tono === "neutro" ? "text-paper/70" : color)} aria-hidden />
        {/* En dos líneas si no entra (el celular): cortada, «Con riesgo a…» no decía qué cuenta. */}
        <span className="min-w-0">{titulo}</span>
        {ayuda && (
          <Ayuda titulo={titulo} className={AYUDA_OSCURA}>
            {ayuda}
          </Ayuda>
        )}
      </p>
      <p className={cn("mt-2 font-display text-cifra font-bold leading-none tabular-nums", color)}>
        {/* El valor real en el HTML desde el servidor; la cuenta animada es sólo para la vista, el lector oye el número. */}
        <span className="cuenta" data-valor={valor} aria-hidden>
          {numero(valor)}
        </span>
        <span className="sr-only">{numero(valor)}</span>
        {sufijo && <span className="ml-1 text-bloque font-semibold text-paper/70">{sufijo}</span>}
      </p>
      {parte != null && (
        <span aria-hidden className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-paper/10">
          <span className={cn("block h-full rounded-full", barra)} style={{ width: `${Math.max(2, Math.min(1, parte) * 100)}%` }} />
        </span>
      )}
      {apoyo && <p className="mt-1.5 text-meta leading-snug text-paper/75">{apoyo}</p>}
      {accion && (
        <Link
          href={accion.href}
          className="mt-auto inline-flex min-h-10 items-center gap-1.5 pt-2 text-dato font-semibold text-maiz underline-offset-4 hover:underline"
        >
          {accion.texto} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </li>
  );
}
