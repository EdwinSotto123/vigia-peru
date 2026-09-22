"use client";

/**
 * Lo que faltaba del hero: al hacer clic en una región del mapa, una tarjeta flotante
 * con sus datos reales (no un mockup fijo) — y una segunda tarjeta con un contrato real
 * ya procesado. Client component porque necesita estado (qué región está seleccionada,
 * compartido con HeroKpis vía HeroMapSync); CampaignMap.tsx gana `onRegionClick`,
 * `colorBy` y `selectedCode`, todos opcionales y aditivos, sin tocar su comportamiento
 * en /app/financiar (que no los pasa).
 */

import { AlertTriangle, ArrowUpRight, MapPin, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CampaignMap, VB_H, VB_W } from "@/components/financiar/CampaignMap";
import { UBIGEO_REGION, belongsToRegion } from "@/components/mapa/region-match";
import type { Zona } from "@/lib/financiamiento";
import type { Alerta } from "@/types";
import { LlamaHero } from "./LlamaHero";
import { useHeroMapSync } from "./HeroMapSync";

function formatPEN(n: number) {
  return `S/ ${Math.round(n).toLocaleString("es-PE")}`;
}

// La tarjeta se ancla en píxeles reales del contenedor (ver cardStyle más abajo), no en
// % del viewBox: el mismo % representa un ancho real distinto según el mapa sea angosto
// (mobile) o ancho (desktop), y un "flip" por umbral fijo no puede corregir eso en todos
// los tamaños — por eso el clamp usa containerWidth medido, no un porcentaje.
// El chip anclado al mapa (antes acá vivía una tarjeta de 235×180; la ficha se
// mudó a la columna derecha y lo que queda sobre el lienzo es una píldora).
const CARD_W = 210;
const CARD_H_MAX = 34;
const EDGE_MARGIN = 10;

export function HeroMapPanel({ zonas, top, alertas }: { zonas: Zona[]; top: Zona[]; alertas: Alerta[] }) {
  // `ubigeo`/`zona` viven en el Context (compartidos con HeroKpis, ver HeroMapSync) —
  // clickear el mapa o la lista top-5 ahora mueve también las cifras del hero.
  const { ubigeo: clickedCode, zona: clicked, setUbigeo: setClickedCode } = useHeroMapSync();
  const [clickedCentroid, setClickedCentroid] = useState<[number, number] | null>(null);

  // El contrato "destacado" ya no queda fijo en el de mayor score de todo el Perú para
  // siempre: si hay una región elegida, se prioriza el de mayor score DE ESA región (si
  // existe) — la tarjeta pasa a reaccionar al mapa en vez de ser un dato congelado al
  // costado. Sin región elegida, o si esa región no tiene ninguna alerta presentable,
  // cae al de mayor score de todo el país (comportamiento original).
  const { featured, featuredEsRegional } = useMemo(() => {
    const porScore = (a: Alerta, b: Alerta) => (b.score ?? 0) - (a.score ?? 0);
    if (clicked) {
      const regionId = UBIGEO_REGION[clicked.ubigeo];
      const deLaRegion = regionId ? alertas.filter((a) => belongsToRegion(a, regionId)).sort(porScore) : [];
      if (deLaRegion[0]) return { featured: deLaRegion[0], featuredEsRegional: true };
    }
    const nacional = [...alertas].sort(porScore)[0] ?? null;
    return { featured: nacional, featuredEsRegional: false };
  }, [clicked, alertas]);
  // Ancho real (px) del contenedor del mapa, medido con ResizeObserver — es lo que permite
  // anclar la tarjeta con matemática de píxeles reales en vez de un umbral de % fijo.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // "monto monitoreado": lo único real y honesto que se puede afirmar sin un agregado de
  // montoSoles por zona en el API — el costo de leer toda su cola, al precio vigente.
  const costoAuditar = clicked ? clicked.totalCola * clicked.precioPen : 0;

  function handleMapClick(code: string, centroid: [number, number]) {
    setClickedCode(code);
    setClickedCentroid(centroid);
  }

  function handleQuickPick(code: string) {
    setClickedCode(code);
    setClickedCentroid(null); // no viene de un clic en el mapa: la tarjeta usa la posición por defecto
  }

  function closeCard() {
    setClickedCode(null);
    setClickedCentroid(null);
  }

  // Clic/Enter en el mapa es la única vía a esta tarjeta (el mapa no es alcanzable con
  // mouse only de otra forma) — sin mover el foco acá, un usuario de teclado la abre pero
  // el foco se queda perdido en el <path> de atrás.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (clicked) cardRef.current?.focus();
  }, [clicked]);

  // Ancla la tarjeta cerca del punto real del clic (no una esquina fija) y la clampea
  // dentro del contenedor en PÍXELES reales (containerWidth de arriba), no en % del
  // viewBox. A 390px de viewport un card de 235px ya es ~60% del ancho disponible: un
  // centroide al 55-60% del viewBox todavía desbordaba por la derecha con el umbral de
  // flip fijo anterior (62%), porque ese % nunca conocía el ancho real del contenedor ni
  // el ancho real del card. El clamp en píxeles no tiene ese punto ciego — el borde de la
  // tarjeta nunca sale del contenedor, sea angosto (mobile) o ancho (desktop) — crítico
  // para regiones del sur/este (p.ej. Puno, Loreto).
  const cardStyle: CSSProperties | null = useMemo(() => {
    if (!clickedCentroid || !containerWidth) return null;
    const scale = containerWidth / VB_W; // el SVG conserva su aspect ratio (width 100%, height auto)
    const containerHeight = VB_H * scale;
    const pointX = clickedCentroid[0] * scale;
    const pointY = clickedCentroid[1] * scale;
    const maxLeft = Math.max(EDGE_MARGIN, containerWidth - CARD_W - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, containerHeight - CARD_H_MAX - EDGE_MARGIN);
    return {
      left: `${Math.min(Math.max(pointX, EDGE_MARGIN), maxLeft)}px`,
      top: `${Math.min(Math.max(pointY, EDGE_MARGIN), maxTop)}px`,
    };
  }, [clickedCentroid, containerWidth]);

  const topMax = top[0]?.totalCola ?? 0;

  const regionId = clicked ? UBIGEO_REGION[clicked.ubigeo] ?? "" : "";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_296px] xl:gap-6">
      {/* ─── COLUMNA DEL MEDIO: el mapa ─────────────────────────────────── */}
      {/* El ref de medición va ACÁ, en la columna del mapa: el chip se ancla al
          centroide de la región en píxeles reales del LIENZO, así que medir la
          grilla entera (mapa + ficha) lo mandaba fuera del mapa. */}
      <div ref={containerRef} className="min-w-0">
        <div className="relative">
          {zonas.length > 0 ? (
            <CampaignMap
              zonas={zonas}
              compact
              landingVariant
              colorBy="cola"
              selectedCode={clickedCode}
              onRegionClick={handleMapClick}
            />
          ) : (
            <div className="p-10 text-center text-sm text-mute">Mapa no disponible por ahora.</div>
          )}

          {/* Chip anclado a la región elegida. Antes acá vivía la ficha entera,
              flotando ENCIMA del mapa y tapando justo la geografía que el
              usuario acababa de tocar. La ficha se fue a la columna de la
              derecha; lo que queda sobre el lienzo es sólo el nombre y la
              cifra que confirman qué se eligió. */}
          {clicked && (
            <div
              ref={cardRef}
              tabIndex={-1}
              role="status"
              aria-label={clicked.nombre}
              className={`animate-slideUp absolute z-10 flex items-center gap-2 rounded-full border border-line bg-paper/95 py-1.5 pl-2.5 pr-1.5 shadow-paper backdrop-blur focus:outline-none ${cardStyle ? "" : "left-2 top-2"}`}
              style={cardStyle ?? undefined}
            >
              <MapPin size={13} className="shrink-0 text-heroViolet" aria-hidden />
              <span className="text-[12px] font-semibold text-ink">{clicked.nombre}</span>
              <span className="font-mono text-[11px] tabular-nums text-mute">
                {clicked.totalCola.toLocaleString("es-PE")} en cola
              </span>
              <button
                onClick={closeCard}
                aria-label="Quitar la región elegida"
                className="rounded-full p-1 text-mute transition-colors hover:bg-paperDeep hover:text-ink"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
        {/* Tres fuentes: una lista, no una cadena de puntos medios. */}
        <ul className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 font-mono text-[10px] text-mute/70">
          {["SEACE", "OECE", "OCDS"].map((f) => (
            <li key={f}>{f}</li>
          ))}
          <li className="font-sans">datos oficiales, en vivo</li>
        </ul>
      </div>

      {/* ─── COLUMNA DERECHA: qué hay en esa zona, y la llama ────────────── */}
      <aside className="relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-3xl border border-line bg-paper/70 p-4 pb-0 backdrop-blur-sm">
        {/* Machu Picchu de fondo: es una lámina muy clara, así que se apoya
            abajo y se desvanece hacia arriba para no competir con el texto. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-cover bg-bottom opacity-45"
          style={{
            backgroundImage: "url(/assets/fondo/fondo_machupichu.jpg)",
            maskImage: "linear-gradient(to top, black 55%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to top, black 55%, transparent 100%)",
          }}
        />

        {clicked ? (
          <FichaZona zona={clicked} costo={costoAuditar} regionId={regionId} />
        ) : featured ? (
          <FichaContrato alerta={featured} />
        ) : null}

        {/* Leyenda. Dice lo que el mapa REALMENTE codifica —intensidad de cola,
            en una rampa violeta— y no los estados de la referencia, que este
            mapa no pinta. Una leyenda que no corresponde al dibujo es peor que
            ninguna. */}
        <div className="rounded-2xl border border-line bg-paper/85 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-inkSoft">Contratos esperando lectura</p>
          <div
            aria-hidden
            className="mt-1.5 h-2 w-full rounded-full"
            style={{ background: "linear-gradient(to right, hsl(252 42% 92%), hsl(252 42% 68%), hsl(252 42% 38%))" }}
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-mute">
            <span>menos</span>
            <span>más</span>
          </div>
          <p className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-mute">
            Cada zona se pinta por cuántos contratos suyos esperan que alguien financie su lectura.
          </p>
        </div>

        <LlamaHero width={150} className="pointer-events-none -mb-1 self-end drop-shadow-xl" />
      </aside>

      {/* Atajo a las zonas con más cola. Va debajo de las dos columnas, no
          dentro de una: es un control del mapa entero. */}
      {top.length > 0 && (
        <div className="xl:col-span-2">
          <p className="mb-1.5 text-center font-mono text-[9px] uppercase tracking-widest text-mute/70">
            Más contratos en cola
          </p>
          <ul className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {top.map((z) => {
              const widthPct = topMax > 0 ? Math.max(6, (z.totalCola / topMax) * 100) : 0;
              return (
                <li key={z.ubigeo}>
                  <button
                    onClick={() => handleQuickPick(z.ubigeo)}
                    aria-pressed={clickedCode === z.ubigeo}
                    title={z.nombre}
                    className={`relative block w-full overflow-hidden rounded-xl border px-2 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-card ${
                      clickedCode === z.ubigeo ? "border-heroViolet bg-heroViolet/5" : "border-line bg-paper hover:bg-paperDeep"
                    }`}
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 bg-heroViolet/40" style={{ width: `${widthPct}%` }} />
                    <span className="relative block truncate text-[11px] font-semibold text-ink">{z.nombre}</span>
                    <span className="relative block font-mono text-[11px] text-mute">{z.totalCola.toLocaleString("es-PE")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Qué hay en la zona que el usuario acaba de tocar. Es la respuesta a "¿y en mi
 * región qué pasa?", que es la única pregunta con la que un vecino entra a este
 * sitio. Cada cifra va con su unidad en la misma línea, nunca suelta.
 */
function FichaZona({ zona, costo, regionId }: { zona: Zona; costo: number; regionId: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper/90 shadow-card">
      <RegionPhoto ubigeo={zona.ubigeo} nombre={zona.nombre} />
      <div className="p-3">
        <h3 className="font-serif text-lg font-bold leading-tight text-ink">{zona.nombre}</h3>
        {zona.totalCola > 0 ? (
          <>
            <dl className="mt-2 space-y-1.5 text-[12px]">
              <Fila k="Contratos en cola" v={zona.totalCola.toLocaleString("es-PE")} />
              <Fila k="Sin financiar" v={zona.pendientes.toLocaleString("es-PE")} />
              <Fila k="Señales halladas" v={zona.senales.toLocaleString("es-PE")} destacado={zona.senales > 0} />
              <Fila k="Leerla entera cuesta" v={formatPEN(costo)} />
            </dl>
            <Link
              href={`/app/mapa?region=${regionId}`}
              className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-heroViolet py-2 text-[12px] font-semibold text-paper transition-colors hover:bg-heroViolet-deep"
            >
              Ver sus contratos <ArrowUpRight size={13} />
            </Link>
          </>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-mute">
            Todavía no ingresamos contratos de esta zona. Aparecen acá cuando el lote nocturno los trae del SEACE.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Sin zona elegida la columna no se queda vacía: muestra un contrato REAL ya
 * leído, con su señal y su monto. Es la prueba de que esto no es una maqueta —
 * y es lo que la referencia tenía como tarjeta de entidad, pero con un caso que
 * existe de verdad.
 */
function FichaContrato({ alerta }: { alerta: Alerta }) {
  return (
    <div className="rounded-2xl border border-line bg-paper/90 p-3 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-mute">Lo último que encontramos</p>
      <p className="mt-1.5 line-clamp-2 font-semibold leading-snug text-ink">{alerta.entidad}</p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-mute">{alerta.objeto}</p>
      <dl className="mt-2.5 space-y-1.5 border-t border-line pt-2.5 text-[12px]">
        <Fila k="Monto adjudicado" v={formatPEN(alerta.montoSoles)} />
        <Fila k="Riesgo" v={`${alerta.score}/100`} destacado />
      </dl>
      <Link
        href={`/app/convocatoria/${encodeURIComponent(alerta.codigoconvocatoria)}`}
        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-line bg-paperSoft py-2 text-[12px] font-semibold text-ink transition-colors hover:bg-paperDeep"
      >
        Ver el dictamen <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}

function Fila({ k, v, destacado }: { k: string; v: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-mute">{k}</dt>
      <dd className={`font-mono font-semibold tabular-nums ${destacado ? "text-rust" : "text-ink"}`}>{v}</dd>
    </div>
  );
}

/**
 * Foto real de la región (public/assets/regiones/{ubigeo}.jpg), si existe. Se van
 * agregando de a poco — mientras un ubigeo no tenga archivo, onError la oculta del todo
 * (la tarjeta vuelve a verse como antes, sin hueco roto). next/image porque los archivos
 * que se van subiendo vienen del tamaño que sea (una llegó a pesar 3.8MB) — acá se sirven
 * ya redimensionadas a lo que la tarjeta realmente necesita, no el original entero.
 */
function RegionPhoto({ ubigeo, nombre }: { ubigeo: string; nombre: string }) {
  const [fallo, setFallo] = useState(false);
  if (fallo) return null;
  return (
    <div className="relative h-24 w-full">
      <Image
        src={`/assets/regiones/${ubigeo}.jpg`}
        alt={nombre}
        fill
        sizes="235px"
        className="object-cover"
        onError={() => setFallo(true)}
      />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className="font-mono font-semibold text-ink">{v}</dd>
    </div>
  );
}
