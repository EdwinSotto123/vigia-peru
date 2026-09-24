"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CON_MOVIMIENTO, gsap, useGSAP } from "@/lib/gsap";

/**
 * La escena del mapa: tres cosas que el país ya dice, y una pregunta.
 *
 *  1. El dinero llega a todas las regiones (el mapa, pintado por monto).
 *  2. Vigía ya leyó contratos en muchas de ellas (se apaga el monto, se
 *     encienden en verde las que tienen al menos un contrato leído, de norte a
 *     sur).
 *  3. En varias encontró señales (aparecen los círculos, a escala).
 *  4. ¿Y en la tuya? El mapa pasa a ser un control: se elige una región y se
 *     leen sus números.
 *
 * Cada paso cambia UNA cosa del mapa, y el texto dice exactamente esa cosa. Si
 * el mapa cambiara color, forma y círculos a la vez, no habría forma de saber
 * qué mirar.
 *
 * Sin movimiento (o en pantalla angosta) no hay pin: el mapa queda en su estado
 * final —leídas en verde, señales a la vista— y los cuatro textos se leen en
 * fila. El estado inicial de la animación lo pone GSAP, nunca el CSS: con JS
 * roto, la sección está completa.
 *
 * La región elegida se dibuja ENCIMA, en una capa aparte, en vez de recolorear
 * su recorrido: GSAP escribe `fill` en línea sobre los recorridos y un color
 * puesto por React debajo de ese estilo no se vería nunca.
 */

/** Las cifras que muestra la ficha: de una región, o del país entero. */
export interface CifrasZona {
  nombre: string;
  contratos: number;
  montoMillones: string;
  leidos: number;
  conSenales: number;
  enCola: number;
}

export interface RegionMapa extends CifrasZona {
  codigo: string;
  /** Slug que entiende `/app/mapa?region=`. */
  id: string;
  d: string;
  cx: number;
  cy: number;
  colorMonto: string;
  colorLeido: string;
}

interface Resumen {
  totalRegiones: number;
  mayor: { nombre: string; millones: string } | null;
  menor: { nombre: string; millones: string } | null;
  conLectura: number;
  leidosTotal: number;
  conSenal: number;
  masSenales: { nombre: string; n: number }[];
}

const n = (v: number) => v.toLocaleString("es-PE");

/** "Cusco tiene 7, Lima 6 y Puno 5". */
function enumerar(xs: { nombre: string; n: number }[]): string {
  const partes = xs.map((x, i) => (i === 0 ? `${x.nombre} tiene ${x.n}` : `${x.nombre} ${x.n}`));
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

const radio = (senales: number) => 7 + Math.sqrt(senales) * 4.5;

export function MapaRegionesEscena({
  ancho,
  alto,
  regiones,
  pais,
  resumen,
  coloresMonto,
  verdeLeido,
  grisSinLeer,
}: {
  ancho: number;
  alto: number;
  regiones: RegionMapa[];
  pais: CifrasZona;
  resumen: Resumen;
  coloresMonto: string[];
  verdeLeido: string;
  grisSinLeer: string;
}) {
  const raiz = useRef<HTMLElement>(null);
  const idSelector = useId();
  const [elegida, setElegida] = useState<string | null>(null);
  const [encima, setEncima] = useState<string | null>(null);
  const region = regiones.find((r) => r.codigo === elegida) ?? null;
  const resaltada = regiones.find((r) => r.codigo === encima) ?? region;
  // Sin región elegida, la ficha muestra el país: nunca un hueco en blanco.
  const ficha: CifrasZona = region ?? pais;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(CON_MOVIMIENTO, () => {
        const pila = raiz.current!.querySelector<HTMLElement>(".pasos-mapa")!;
        const zonas = gsap.utils.toArray<SVGPathElement>(".zona");
        const senales = gsap.utils.toArray<SVGGElement>(".senal");
        const pasos = gsap.utils.toArray<HTMLElement>(".paso-mapa");

        // Los cuatro textos pasan a ocupar la misma celda y se relevan.
        pila.classList.add("apilado");
        gsap.set(zonas, { fill: (_i: number, el: SVGPathElement) => el.dataset.monto! });
        gsap.set(senales, { scale: 0, transformOrigin: "50% 50%" });
        gsap.set(pasos.slice(1), { autoAlpha: 0, y: 24 });

        const sale = { autoAlpha: 0, y: -24, duration: 0.07 };
        const entra = { autoAlpha: 1, y: 0, duration: 0.07 };
        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: ".mapa-escena",
            start: "top 64px",
            end: "+=280%",
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
          },
        });

        tl.to(pasos[0], sale, 0.2)
          .to(zonas, { fill: (_i: number, el: SVGPathElement) => el.dataset.leido!, duration: 0.1, stagger: 0.005, ease: "none" }, 0.2)
          .to(pasos[1], entra, 0.26)
          .to(pasos[1], sale, 0.46)
          .to(senales, { scale: 1, duration: 0.08, stagger: 0.008, ease: "back.out(2)" }, 0.47)
          .to(pasos[2], entra, 0.52)
          .to(pasos[2], sale, 0.72)
          .to(pasos[3], entra, 0.78)
          .to({}, { duration: 0.15 });

        return () => pila.classList.remove("apilado");
      });
      return () => mm.revert();
    },
    { scope: raiz },
  );

  const hrefRegion = region?.id ? `/app/mapa?region=${region.id}` : "/app/mapa";

  return (
    <section ref={raiz} id="regiones" aria-labelledby="regiones-titulo" className="relative scroll-mt-16 bg-paper">
      <div className="mapa-escena container-page max-w-[1400px] py-16 lg:flex lg:min-h-[calc(100dvh-4rem)] lg:flex-col lg:justify-center lg:py-8">
        <h2 id="regiones-titulo" className="max-w-[24ch] font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
          Del país entero a tu región.
        </h2>

        <div className="mt-8 grid gap-10 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
          {/* ── Los cuatro pasos ── */}
          {/* `group`: lo que sólo tiene sentido mientras el mapa está pintado por
              monto (la frase del color y su leyenda) se muestra con
              `group-[.apilado]:`. Sin animación el mapa queda en su estado final
              —leídas en verde— y hablar de "más oscuro" no describiría nada. */}
          <div className="pasos-mapa group flex flex-col gap-12 [&.apilado>*]:col-start-1 [&.apilado>*]:row-start-1 [&.apilado]:grid [&.apilado]:content-center">
            <Paso
              titulo={`El dinero público se reparte en las ${resumen.totalRegiones} regiones.`}
              texto={
                <>
                  <span className="hidden group-[.apilado]:inline">Cuanto más oscuro, más plata en contratos. </span>
                  {resumen.mayor && resumen.menor
                    ? `${resumen.mayor.nombre} suma S/ ${resumen.mayor.millones} millones; ${resumen.menor.nombre}, S/ ${resumen.menor.millones} millones.`
                    : null}
                </>
              }
            >
              <div className="hidden items-center gap-3 text-[13px] text-mute group-[.apilado]:flex">
                <span>menos</span>
                <span className="flex h-2.5 w-40 overflow-hidden rounded-full" aria-hidden>
                  {coloresMonto.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </span>
                <span>más</span>
              </div>
            </Paso>

            <Paso
              titulo={`Vigía ya leyó contratos en ${resumen.conLectura} de ellas.`}
              texto={`Son ${n(resumen.leidosTotal)} contratos leídos a fondo, uno por uno. En verde, las regiones donde ya hay al menos uno.`}
            >
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-mute">
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-3 w-3 rounded-sm ring-1 ring-heroGreen/40" style={{ background: verdeLeido }} />
                  con contratos leídos
                </li>
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-3 w-3 rounded-sm ring-1 ring-line" style={{ background: grisSinLeer }} />
                  todavía ninguno
                </li>
              </ul>
            </Paso>

            <Paso
              titulo={`En ${resumen.conSenal} encontró señales que merecen una segunda mirada.`}
              texto={
                resumen.masSenales.length > 0
                  ? `Contratos con señales, por región: ${enumerar(resumen.masSenales)}. Cuanto más grande el círculo, más contratos con señales.`
                  : "Cuanto más grande el círculo, más contratos con señales."
              }
            >
              <p className="flex items-center gap-2 text-[13px] text-mute">
                <span aria-hidden className="h-3 w-3 rounded-full bg-crimson ring-2 ring-paper" />
                contratos con al menos una señal
              </p>
            </Paso>

            <div className="paso-mapa">
              <h3 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">¿Y en tu región?</h3>
              <p className="mt-3 max-w-[44ch] text-base leading-relaxed text-inkSoft">
                Elige una para ver cuánto se contrata, cuánto se leyó y cuánto espera todavía.
              </p>

              <label htmlFor={idSelector} className="mt-5 block text-[13px] font-medium text-inkSoft">
                Tu región
              </label>
              <select
                id={idSelector}
                value={elegida ?? ""}
                onChange={(e) => setElegida(e.target.value || null)}
                className="mt-1.5 w-full max-w-xs rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[15px] text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50"
              >
                <option value="">Todo el Perú</option>
                {[...regiones]
                  .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
                  .map((r) => (
                    <option key={r.codigo} value={r.codigo}>
                      {r.nombre}
                    </option>
                  ))}
              </select>

              <div aria-live="polite" className="mt-4">
                <div className="max-w-md rounded-2xl border border-line bg-paperSoft p-4 text-[13px]">
                  <p className="font-serif text-lg font-bold text-ink">{ficha.nombre}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
                    <Cifra t="Contratos publicados" v={n(ficha.contratos)} />
                    <Cifra t="Monto" v={`S/ ${ficha.montoMillones} millones`} />
                    <Cifra t="Leídos a fondo" v={n(ficha.leidos)} />
                    <Cifra t="Con señales" v={n(ficha.conSenales)} fuerte={ficha.conSenales > 0} />
                  </dl>
                  <p className="mt-3 border-t border-line pt-3 text-inkSoft">
                    <span className="font-mono font-semibold text-ink">{n(ficha.enCola)}</span>{" "}
                    {ficha.enCola === 1 ? "contrato ya puede leerse" : "contratos ya pueden leerse"} si alguien
                    financia su lectura.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  href={hrefRegion}
                  className="group inline-flex items-center gap-2 rounded-full bg-heroViolet px-6 py-3.5 text-[15px] font-semibold text-paper shadow-card transition-transform duration-rapido hover:-translate-y-0.5 active:translate-y-0"
                >
                  Ver mi región
                  <ArrowRight size={16} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
                </Link>
                {region && region.enCola > 0 && (
                  <Link
                    href={`/app/financiar/${region.codigo}`}
                    className="inline-flex items-center rounded-full px-4 py-3.5 text-[15px] font-semibold text-heroViolet underline-offset-4 hover:underline"
                  >
                    Financiar una auditoría
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* ── El mapa ── */}
          {/* Sin pin (movimiento reducido) los textos quedan en columna y el mapa
              los acompaña pegado arriba; con pin, la escena ya ocupa la pantalla. */}
          <figure className="order-first lg:sticky lg:top-24 lg:order-none lg:self-start [.apilado+&]:static [.apilado+&]:self-auto">
            <svg
              viewBox={`0 0 ${ancho} ${alto}`}
              // `lg:max-w-full`: con alto fijo, `w-auto` sacaba el ancho de la
              // proporción del mapa (500 px a 1024 de ventana) y desbordaba su
              // columna de 454, con barra de scroll horizontal en toda la página.
              className="mx-auto h-auto max-h-[70vh] w-full lg:h-[calc(100dvh-4rem-9rem)] lg:max-h-[46rem] lg:w-auto lg:max-w-full"
              role="img"
              aria-label="Mapa del Perú por regiones. Los números de cada región están en el selector “Tu región”."
              onMouseLeave={() => setEncima(null)}
            >
              <g>
                {regiones.map((r) => (
                  <path
                    key={r.codigo}
                    className="zona cursor-pointer"
                    d={r.d}
                    data-monto={r.colorMonto}
                    data-leido={r.colorLeido}
                    fill={r.colorLeido}
                    stroke="#FFFFFF"
                    strokeWidth={0.9}
                    strokeLinejoin="round"
                    onMouseEnter={() => setEncima(r.codigo)}
                    onClick={() => setElegida(r.codigo)}
                  />
                ))}
              </g>
              {region && (
                <path d={region.d} fill="#4F3D96" stroke="#FFFFFF" strokeWidth={1.4} pointerEvents="none" />
              )}
              {resaltada && resaltada !== region && (
                <path d={resaltada.d} fill="none" stroke="#14171A" strokeWidth={1.8} pointerEvents="none" />
              )}
              <g pointerEvents="none">
                {regiones
                  .filter((r) => r.conSenales > 0)
                  .map((r) => (
                    <g key={r.codigo} className="senal">
                      <circle cx={r.cx} cy={r.cy} r={radio(r.conSenales)} fill="#CF3A2C" fillOpacity={0.92} stroke="#FFFFFF" strokeWidth={1.6} />
                      <text
                        x={r.cx}
                        y={r.cy}
                        dy="0.35em"
                        textAnchor="middle"
                        className="fill-paper font-sans text-[12px] font-bold"
                      >
                        {r.conSenales}
                      </text>
                    </g>
                  ))}
              </g>
            </svg>
            <figcaption className="mt-2 min-h-[1.5rem] text-center text-[13px] text-inkSoft">
              {resaltada ? (
                <>
                  <span className="font-semibold text-ink">{resaltada.nombre}</span>: S/ {resaltada.montoMillones} millones
                  en {n(resaltada.contratos)} contratos, {n(resaltada.leidos)}{" "}
                  {resaltada.leidos === 1 ? "leído" : "leídos"}.
                </>
              ) : (
                <span className="text-mute">Pasa el cursor o toca una región.</span>
              )}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function Paso({ titulo, texto, children }: { titulo: string; texto: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="paso-mapa">
      <h3 className="max-w-[20ch] text-balance font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
        {titulo}
      </h3>
      <p className="mt-3 max-w-[46ch] text-base leading-relaxed text-inkSoft">{texto}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Cifra({ t, v, fuerte = false }: { t: string; v: string; fuerte?: boolean }) {
  return (
    <div>
      <dt className="text-mute">{t}</dt>
      <dd className={`mt-0.5 font-mono text-[15px] font-semibold ${fuerte ? "text-crimsonTexto" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
