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
const CARD_W = 235; // debe matchear el w-[235px] del card más abajo
const CARD_H_MAX = 180; // alto máximo aproximado (4 stats + botón "Ver contratos")
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

  return (
    <div ref={containerRef} className="relative">
      {/* Wrapper propio para mapa+caption: la llama ancla a SU borde inferior, no al de
          todo el bloque (que también incluye "Más contratos en cola" más abajo) — antes
          el ancla -bottom-4/-right-4 quedaba pegada al fondo de ese bloque entero y los
          tiles de región (que pintan después en el DOM) tapaban la mitad de la llama. */}
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
        <p className="mt-1 text-center font-mono text-[10px] text-mute/70">SEACE · OECE · OCDS — datos oficiales, en vivo</p>
        <LlamaHero width={168} className="pointer-events-none absolute -bottom-4 -right-4 hidden drop-shadow-xl sm:block" />
      </div>

      {/* Tarjeta flotante: región elegida (datos reales, no fijos) */}
      {clicked && (
        <div
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-label={clicked.nombre}
          className={`animate-slideUp absolute z-10 w-[235px] overflow-hidden rounded-2xl border border-line bg-paper/95 shadow-paper backdrop-blur focus:outline-none ${cardStyle ? "" : "left-1 top-1"}`}
          style={cardStyle ?? undefined}
        >
          <RegionPhoto ubigeo={clicked.ubigeo} nombre={clicked.nombre} />
          <button
            onClick={closeCard}
            aria-label="Cerrar"
            className="absolute right-2 top-2 z-10 rounded-full bg-paper/80 p-1 text-mute shadow-sm backdrop-blur transition-colors hover:bg-paperDeep hover:text-ink"
          >
            <X size={12} />
          </button>
          <div className="p-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-heroViolet">
              <MapPin size={12} /> {clicked.nombre}
            </span>
            {clicked.totalCola > 0 ? (
              <>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
                  <Stat k="Contratos" v={clicked.totalCola.toLocaleString("es-PE")} />
                  <Stat k="Pendientes" v={clicked.pendientes.toLocaleString("es-PE")} />
                  <Stat k="Señales" v={clicked.senales.toLocaleString("es-PE")} />
                  <Stat k="Costo auditarla" v={formatPEN(costoAuditar)} />
                </dl>
                <Link
                  href={`/app/mapa?region=${UBIGEO_REGION[clicked.ubigeo] ?? ""}`}
                  className="mt-2.5 flex items-center justify-center gap-1 rounded-lg bg-heroGreen/10 py-1.5 text-[11px] font-semibold text-heroGreenTexto transition-colors hover:bg-heroGreen/20"
                >
                  Ver contratos <ArrowUpRight size={12} />
                </Link>
              </>
            ) : (
              <p className="mt-1.5 text-[12px] text-mute">Todavía no ingresamos contratos de esta zona.</p>
            )}
          </div>
        </div>
      )}

      {/* Tarjeta flotante: un contrato ya procesado, real — reacciona a la región elegida
          en vez de mostrar siempre el mismo caso (key=featured.id repite la animación de
          entrada cuando cambia, para que se note que es nuevo, no el mismo texto quieto). */}
      {featured && (
        <div key={featured.id} className="animate-slideUp absolute right-1 top-1 z-10 hidden w-[220px] rounded-2xl border border-line border-l-[3px] border-l-heroViolet bg-paper/95 p-3 shadow-paper backdrop-blur md:block">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-rust/10 px-2 py-0.5 text-[10px] font-bold text-rust">
              <AlertTriangle size={10} /> score {featured.score}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-mute">
              {featuredEsRegional ? `en ${clicked?.nombre}` : "a nivel nacional"}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-ink">{featured.entidad}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-mute">{featured.objeto}</p>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="font-mono text-[11px] text-ink">{formatPEN(featured.montoSoles)}</span>
            <Link
              href={`/app/convocatoria/${encodeURIComponent(featured.codigoconvocatoria)}`}
              className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-heroGreenTexto hover:underline"
            >
              Ver detalles <ArrowUpRight size={11} />
            </Link>
          </div>
        </div>
      )}

      {top.length > 0 && (
        <div className="mt-3">
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
