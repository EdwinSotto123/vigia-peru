"use client";

import { useRef } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ClipboardList,
  Eye,
  FileText,
  HardHat,
  Package,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SIN_REDUCIR, useEscenaGsap } from "@/lib/gsap";
import { numero, porcentaje } from "@/lib/formato";
import { Ayuda } from "@/components/patrones";
import { EnlaceAccion } from "./EnlaceAccion";
import type { AnioEscala, TipoEscala } from "@/lib/landing";

/**
 * La escala del dinero público, contada en TRES pasos que se leen de izquierda a derecha:
 *
 *   publicados  →  leídos a fondo  →  con riesgo alto
 *
 * La versión anterior ponía todo junto (monto, total, cinco cajitas por tipo con dos
 * porcentajes cada una, una matriz y otra cifra) y obligaba a adivinar qué era "leído" o
 * "riesgo alto". Ahora cada paso es una tarjeta con UNA cifra grande, una palabra clara y una
 * frase que dice qué significa; debajo, la matriz de puntos (cada punto, 20 contratos) hace
 * VER que los leídos son una rendija; y el desglose por tipo queda plegado, para quien lo quiera.
 *
 * Cada cifra llega por props desde el servidor, que las lee de la API. Si la API no responde,
 * la sección no se dibuja: una portada que estima cuántos contratos quedaron sin leer es lo que
 * este producto le reprocha al Estado.
 *
 * Animación (sólo sin movimiento reducido): las tarjetas entran una tras otra y sus números
 * cuentan desde cero; la matriz se construye con el scroll, la masa sin leer primero y los
 * puntos lima al final, porque el orden ES el argumento. El HTML del servidor trae todo en su
 * valor final: sin JS o con movimiento reducido se ve quieto y completo.
 */

const POR_PUNTO = 20;
const COLUMNAS = 46;

const ICONO: Record<TipoEscala["clave"], LucideIcon> = {
  bienes: Package,
  servicios: Wrench,
  obras: HardHat,
  consultoria: ClipboardList,
  otros: FileText,
};

export function EscalaDinero({
  montoTotal,
  publicados,
  leidos,
  senalAlta,
  tipos,
  anio,
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
}) {
  const raiz = useRef<HTMLElement>(null);

  const puntos = Math.ceil(publicados / POR_PUNTO);
  const filas = Math.ceil(puntos / COLUMNAS);
  const puntosLeidos = Math.max(1, Math.round(leidos / POR_PUNTO));
  const milMillones = Math.floor(montoTotal / 1e9);
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;
  const unaDeCada = leidos > 0 ? Math.round(publicados / leidos) : null;
  const faltan = Math.max(0, publicados - leidos);

  useEscenaGsap(
    raiz,
    SIN_REDUCIR,
    ({ gsap }) => {
      // La matriz: se construye con el scroll y termina cuando llega al centro de la pantalla.
      const matriz = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: ".matriz", start: "top 88%", end: "center 58%", scrub: 0.6 },
      });
      matriz
        .fromTo(".matriz-recorte", { attr: { width: 0 } }, { attr: { width: COLUMNAS }, duration: 0.72 })
        .fromTo(
          ".punto-leido",
          { scale: 0, transformOrigin: "50% 50%" },
          { scale: 1, duration: 0.18, stagger: 0.02, ease: "back.out(3)" },
          0.74,
        );

      // Cuenta hacia arriba cada número marcado con data-valor, dentro de una línea de tiempo.
      const contar = (tl: ReturnType<typeof gsap.timeline>, el: HTMLElement, en: number, duracion = 1.1) => {
        const fin = Number(el.dataset.valor ?? 0);
        const v = { v: 0 };
        el.textContent = "0";
        tl.to(v, { v: fin, duration: duracion, ease: "power2.out", onUpdate: () => (el.textContent = numero(v.v)) }, en);
      };

      // Las tres tarjetas: entran una tras otra y cuentan, una sola vez. Atenuadas, nunca
      // ocultas: un hueco en blanco se lee como "no cargó".
      const tarjetas = gsap.utils.toArray<HTMLElement>(".paso-escala");
      gsap.set(tarjetas, { opacity: 0.25, y: 18 });
      const tl = gsap.timeline({ scrollTrigger: { trigger: ".pasos-escala", start: "top 82%", once: true } });
      tl.to(tarjetas, { opacity: 1, y: 0, duration: 0.55, stagger: 0.18, ease: "power2.out", clearProps: "opacity,transform" }, 0);
      gsap.utils.toArray<HTMLElement>(".paso-escala .cuenta").forEach((el, i) => contar(tl, el, 0.1 + i * 0.18, 1.3));
    },
    { diferido: true },
  );

  return (
    <section ref={raiz} data-tema="oscuro" aria-labelledby="escala-titulo" className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
      <div className="container-page relative pb-20 pt-16 sm:pb-24 sm:pt-24">
        {/* ── La idea, en una frase ─────────────────────────────── */}
        <div className="max-w-3xl">
          <p className="etiqueta-mono mb-4 !text-maiz">El tamaño del problema</p>
          <h2 id="escala-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            El Estado publicó <span className="text-maiz">{numero(publicados)}</span> contratos
            {anio ? ` en ${anio.anio}` : ""}.
          </h2>
          <p className="mt-5 flex flex-wrap items-center gap-x-1.5 text-xl leading-snug text-paper/80 sm:text-2xl">
            <span>Juntos suman más de S/ {numero(milMillones)} mil millones. Casi nadie los lee.</span>
            <Ayuda titulo="¿De dónde salen estas cifras?" className="text-paper/60 hover:bg-paper/10 hover:text-maiz">
              <span className="block">
                Son las convocatorias publicadas en el SEACE que Vigía tiene en su base. El monto es la suma del valor referencial de
                cada convocatoria, no lo pagado.
              </span>
              {anio && (
                <span className="mt-2 block text-mute">
                  {numero(anio.enAnio)} de {numero(publicados)} se convocaron en {anio.anio}; el resto no tiene fecha de convocatoria o es
                  anterior.
                </span>
              )}
            </Ayuda>
          </p>
        </div>

        {/* ── Tres pasos: publicados, leídos, con riesgo alto ────── */}
        <ol className="pasos-escala mt-12 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch md:gap-4" aria-label="De los publicados a los que tienen riesgo alto">
          <Paso
            Icono={FileText}
            titulo="Publicados"
            valor={publicados}
            frase="Todo lo que las entidades subieron al SEACE, el portal de compras del Estado."
          />
          <Flecha />
          <Paso
            Icono={Eye}
            titulo="Leídos a fondo"
            valor={leidos}
            resaltado
            apoyo={unaDeCada ? `1 de cada ${numero(unaDeCada)} (${porcentaje(pct, { decimales: 1 })})` : undefined}
            frase="Vigía revisó el expediente completo (bases, actas y contrato) y lo cruzó con registros oficiales."
          />
          <Flecha />
          <Paso
            Icono={AlertTriangle}
            titulo="Con riesgo alto"
            valor={senalAlta}
            alerta
            apoyo={`de los ${numero(leidos)} leídos`}
            frase="Tienen señales fuertes. Son los primeros que conviene revisar."
          />
        </ol>

        {/* ── La imagen que lo dice sin números ───────────────────── */}
        <figure className="matriz mt-14">
          <svg
            viewBox={`0 0 ${COLUMNAS} ${filas}`}
            className="h-auto w-full text-paper/30"
            role="img"
            aria-label={`${numero(publicados)} contratos en una matriz de ${numero(puntos)} puntos. Los ${numero(puntosLeidos)} puntos lima son los ${numero(leidos)} que Vigía leyó.`}
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
          <figcaption className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[14px] text-paper/80">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-paper/40" /> Cada punto son {POR_PUNTO} contratos
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-maiz" /> Los que Vigía ya leyó
            </span>
          </figcaption>
        </figure>

        {/* ── La invitación ───────────────────────────────────────── */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-2xl border border-maiz/30 bg-maiz/[0.07] p-5 sm:p-6">
          <p className="max-w-2xl text-lg leading-snug text-paper sm:text-xl">
            Faltan <span className="font-display text-2xl font-bold tabular-nums text-maiz sm:text-3xl">{numero(faltan)}</span> por leer.
            Cada lectura la financia alguien.
          </p>
          <EnlaceAccion href="/app/financiar" variante="oscuro" tamano="lg">
            Financiar una lectura
          </EnlaceAccion>
        </div>

        {/* ── Por tipo, para quien lo quiera ─────────────────────── */}
        {tipos.length > 0 && (
          <details className="group mt-6 rounded-2xl border border-paper/12 bg-paper/[0.03]">
            <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[15px] font-semibold text-paper/90 marker:hidden [&::-webkit-details-marker]:hidden">
              Ver los contratos por tipo
              <ChevronDown size={18} aria-hidden className="shrink-0 text-maiz transition-transform duration-normal group-open:rotate-180" />
            </summary>
            <div className="border-t border-paper/10 px-5 pb-4 pt-2">
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-x-3 py-2 text-[12px] font-medium text-paper/60 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
                <span>Tipo</span>
                <span className="text-right">Publicados</span>
                <span className="text-right">Leídos</span>
              </div>
              <ul>
                {tipos.map((t) => {
                  const Icono = ICONO[t.clave];
                  return (
                    <li
                      key={t.clave}
                      className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-3 border-t border-paper/10 py-3 text-[14px] sm:grid-cols-[minmax(0,1fr)_7rem_7rem]"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-paper/90">
                        <Icono size={16} className="shrink-0 text-maiz/90" aria-hidden />
                        <span className="truncate">{t.etiqueta}</span>
                      </span>
                      <span className="text-right font-mono tabular-nums text-paper">{numero(t.total)}</span>
                      <span className="text-right font-mono tabular-nums">
                        {t.leidos == null ? (
                          <span className="text-paper/60">Sin dato</span>
                        ) : t.leidos > 0 ? (
                          <span className="font-semibold text-maiz">{numero(t.leidos)}</span>
                        ) : (
                          <span className="text-paper/60">Ninguno</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

/** Una tarjeta del embudo: el nombre del paso, UNA cifra grande y una frase que dice qué significa. */
function Paso({
  Icono,
  titulo,
  valor,
  frase,
  apoyo,
  resaltado = false,
  alerta = false,
}: {
  Icono: LucideIcon;
  titulo: string;
  valor: number;
  frase: string;
  apoyo?: string;
  resaltado?: boolean;
  alerta?: boolean;
}) {
  return (
    <li
      className={
        "paso-escala flex min-w-0 flex-col rounded-2xl border p-5 sm:p-6 " +
        (resaltado ? "border-maiz/50 bg-maiz/[0.08]" : alerta ? "border-crimson/40 bg-crimson/[0.07]" : "border-paper/12 bg-paper/[0.04]")
      }
    >
      <p className={"flex items-center gap-2 text-[14px] font-semibold " + (resaltado ? "text-maiz" : alerta ? "text-[#FF8B7E]" : "text-paper/85")}>
        <Icono size={17} aria-hidden /> {titulo}
      </p>
      <p
        className={
          "mt-3 font-display text-6xl font-bold leading-none tabular-nums sm:text-7xl " +
          (resaltado ? "text-maiz" : alerta ? "text-[#FF8B7E]" : "text-paper")
        }
      >
        <span className="cuenta" data-valor={valor}>
          {numero(valor)}
        </span>
      </p>
      {apoyo && <p className="mt-2 text-[14px] font-medium text-paper/85">{apoyo}</p>}
      <p className="mt-3 text-[14.5px] leading-snug text-paper/70">{frase}</p>
    </li>
  );
}

/** La flecha entre pasos: a la derecha en pantalla ancha, hacia abajo en el celular. */
function Flecha() {
  return (
    <li aria-hidden className="flex items-center justify-center text-maiz/80 md:px-0">
      <ArrowRight size={26} className="hidden md:block" />
      <ChevronDown size={24} className="md:hidden" />
    </li>
  );
}
