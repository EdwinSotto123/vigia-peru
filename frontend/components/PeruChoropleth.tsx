"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { geoMercator, geoPath } from "d3-geo";
import type { Feature } from "geojson";
import { ContratoPin } from "./contratos/ContratoPin";
import { nivelDeEtiqueta, tintaSobre, SIN_DATO, SIN_DATO_TRAMA } from "./mapa/escala";
import { nombreDepartamento } from "./mapa/region-match";
import { colocarEtiquetas, posicionesEnEspiral } from "./mapa/geometria";
import { useGeoPeru, type DeptFeature, type ProvFeature } from "./mapa/useGeoPeru";
import { ENCUADRE_PAIS, useZoomAnimado, type Encuadre } from "./mapa/useZoomAnimado";
import { ErrorMapa, MapaEsqueleto } from "./mapa/EstadosMapa";
import { conAcentos } from "@/lib/financiamiento";

const VB_W = 480;
const VB_H = 700;

/**
 * Los colores que el SVG escribe como atributo (fill/stroke dinámicos), en UN
 * lugar y con el nombre de su token de tailwind.config. Neutros cálidos: los
 * grises fríos que había (#E7EAEE, #D2D7DE, #5B6B7A) eran de otra paleta.
 */
const COLOR = {
  ink: "#1E191B",
  paper: "#FFFFFF",
  paperDeep: "#F0EBE8",
  paperEdge: "#E3DCD8",
  mute: "#6B6166",
  granate: "#711C30",
} as const;

export interface MapPoint {
  id: string;
  /** Coordenadas reales, cuando la fuente las trae (distritos, denuncias con GPS). */
  lat?: number;
  lon?: number;
  /**
   * Zona donde se ancla el punto cuando no hay coordenadas: provincia (4 díg.)
   * o departamento (2 díg.). Se dibuja en el centroide de ESE polígono del
   * geojson, no en un desplazamiento inventado alrededor de la capital.
   */
  zona?: string;
  /** Posición dentro de los puntos que comparten `zona`: se abren en espiral alrededor del centroide, a pocos píxeles. */
  grupo?: { i: number; n: number };
  kind: "alerta" | "reporte" | "contratos";
  label?: string;
  /** Texto completo del `<title>` nativo: ya trae la palabra de severidad, no sólo el color. */
  titulo?: string;
  /** Clase Tailwind `fill-*` derivada de `lib/severidad`. El contenedor es el único que clasifica. */
  colorClase?: string;
  // Para alertas: 0-100. Para reportes: categoria.
  score?: number;
  categoria?: string;
  confirmado?: boolean;
  href?: string;
  // Para "contratos" (punto agregado por zona): radio en unidades del viewBox,
  // color por estado operativo, total de contratos y ubigeo de la zona.
  r?: number;
  color?: string;
  total?: number;
  ubigeo?: string;
  selected?: boolean;
  hovered?: boolean;
}

/** Cómo se pinta una zona y qué se dice de ella. Todo viene ya resuelto del contenedor. */
export interface ZonaPintada {
  color: string;
  /** No hay dato de la API para esta zona (≠ tener cero). Se raya y se nombra en la leyenda. */
  sinDato: boolean;
  /** Cifras en palabras para el `aria-label`: "4.704 contratos, 892 en cola, 19 leídos". */
  resumen: string;
  /** Zona seguida por el usuario ("Mis zonas"): contorno, nunca relleno — el relleno es el dato. */
  destacada?: boolean;
  /**
   * La zona no cumple el filtro activo. Se apaga a gris, no se esconde: el país
   * tiene que seguir entero para que "dónde SÍ pasa esto" se lea contra "dónde
   * no". Un mapa al que le faltan pedazos deja de ser un mapa.
   */
  apagada?: boolean;
}

export interface PeruChoroplethProps {
  /** Relleno de departamentos, por ubigeo de 2 dígitos. */
  regiones: Record<string, ZonaPintada>;
  /** Relleno de provincias del departamento abierto, por ubigeo de 4 dígitos. */
  provincias?: Record<string, ZonaPintada>;
  /** Cómo se pinta una provincia que la API no devolvió. Una provincia ausente de
   *  `/contratos/geo` no tiene contratos ingresados — que es un cero real, no una
   *  incógnita. El contenedor decide, porque es quien sabe si la consulta falló. */
  provinciaPorDefecto?: ZonaPintada;
  /** Departamento abierto (ubigeo de 2 dígitos) o `null` para la vista país. */
  seleccion: string | null;
  /** Provincia o distrito elegido dentro del departamento (4 o 6 dígitos). */
  zonaSel?: string | null;
  /** Zona con el puntero o el foco encima, y su rectángulo para anclar la ficha. */
  onZonaActiva: (z: { ubigeo: string; nombre: string; nivel: "departamento" | "provincia" } | null, ancla: DOMRect | null) => void;
  activaUbigeo?: string | null;
  onSelectRegion: (ubigeo: string | null) => void;
  onSelectProvincia: (ubigeo: string, nombre: string) => void;
  points?: MapPoint[];
  onPointClick?: (pt: MapPoint) => void;
  onPointHover?: (pt: MapPoint | null) => void;
  /**
   * Departamentos (ubigeo de 2 dígitos) donde AHORA hay contratos leyéndose o
   * esperando su lectura, con la frase que lo dice. Se marcan con un contorno
   * que late (quieto con `prefers-reduced-motion`). Sólo llegan si son > 0.
   */
  pulsos?: Record<string, string>;
  /**
   * Cambia cada vez que el usuario cambia la medida o el mes. Al cambiar, los
   * departamentos se recolorean en una ola corta de oeste a este (0,3 s), así
   * se ve QUE el dato cambió y no sólo el resultado. Hover y selección no la disparan.
   */
  ola?: number;
}

export function PeruChoropleth({
  regiones,
  provincias,
  provinciaPorDefecto,
  seleccion,
  zonaSel = null,
  onZonaActiva,
  activaUbigeo = null,
  onSelectRegion,
  onSelectProvincia,
  points = [],
  onPointClick,
  onPointHover,
  pulsos,
  ola = 0,
}: PeruChoroplethProps) {
  const router = useRouter();
  const [focoPunto, setFocoPunto] = useState<string | null>(null);
  const [reducido, setReducido] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const leer = () => setReducido(mq.matches);
    leer();
    mq.addEventListener?.("change", leer);
    return () => mq.removeEventListener?.("change", leer);
  }, []);

  // La ola de recoloreo: sólo mientras dura, así hover y selección siguen instantáneos.
  const [escalonando, setEscalonando] = useState(false);
  const olaPrevia = useRef(ola);
  useEffect(() => {
    if (olaPrevia.current === ola) return;
    olaPrevia.current = ola;
    setEscalonando(true);
    const t = window.setTimeout(() => setEscalonando(false), 700);
    return () => window.clearTimeout(t);
  }, [ola]);
  // Las provincias (846 KB) se piden recién al abrir un departamento (ver mapa/useGeoPeru).
  const { deptData, provData, status } = useGeoPeru(seleccion !== null);
  const [foco, setFoco] = useState<string | null>(null);
  /** El grupo que se mueve con el zoom: su `transform` lo escribe `useZoomAnimado`, no React. */
  const grupoRef = useRef<SVGGElement>(null);

  /**
   * Cuántos píxeles de pantalla mide una unidad del viewBox. Sin esto, `fontSize: 9`
   * daba 6,19 px reales en un teléfono de 390 (medido): con este factor, pedir 12 px
   * da 12 px reales en 1440 y en 390.
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const svgListo = status === "ready";
  useEffect(() => {
    // El <svg> recién existe cuando llegó la geometría: antes este efecto corría al montar,
    // con el esqueleto en pantalla, y el factor se quedaba en 1 para siempre.
    const el = svgRef.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setFitScale(Math.min(r.width / VB_W, r.height / VB_H) || 1);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgListo]);

  const projection = useMemo(() => {
    if (!deptData) return null;
    return geoMercator().fitExtent(
      [
        [16, 24],
        [VB_W - 16, VB_H - 16],
      ],
      deptData as any,
    );
  }, [deptData]);

  // Orden alfabético: el recorrido con Tab por los 25 departamentos tiene que
  // ser predecible, no el orden arbitrario del geojson.
  const deptPaths = useMemo(() => {
    if (!deptData || !projection) return [];
    const pg = geoPath(projection);
    // El geojson trae los nombres sin tilde ("Ancash", "Huanuco", "Madre De
    // Dios"): el nombre que se imprime y se lee sale del catálogo del producto.
    return (deptData.features as DeptFeature[])
      .map((feat) => ({
        ubigeo: feat.properties.code ?? "",
        id: feat.properties.id,
        name: feat.properties.code ? nombreDepartamento(feat.properties.code) : feat.properties.name,
        d: pg(feat as any) || "",
        centroid: pg.centroid(feat as any) as [number, number],
        bounds: pg.bounds(feat as any),
      }))
      .filter((p) => !!p.ubigeo)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [deptData, projection]);

  const provincePaths = useMemo(() => {
    if (!provData || !projection || !seleccion) return [];
    const pg = geoPath(projection);
    return (provData.features as ProvFeature[])
      .filter((f) => (f.properties.code ?? "").startsWith(seleccion))
      .map((f, i) => ({
        // El geojson parte dos provincias en dos polígonos con el mismo código
        // ("Piura"/"Puira", "Victor Fajardo"/"Victor Fafardo"): la llave no puede ser sólo el código.
        key: `${f.properties.code ?? ""}-${i}`,
        ubigeo: f.properties.code ?? "",
        name: conAcentos(f.properties.name),
        d: pg(f as any) || "",
        centroid: pg.centroid(f as any) as [number, number],
        area: pg.area(f as any),
      }))
      .filter((p) => !!p.ubigeo)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [provData, projection, seleccion]);

  /**
   * Centroide proyectado de cada zona (departamento y provincia), para anclar
   * los puntos que no traen coordenadas. De una provincia partida en dos
   * polígonos se usa el más grande.
   */
  const centroides = useMemo(() => {
    const out = new Map<string, [number, number]>();
    if (!projection) return out;
    const pg = geoPath(projection);
    for (const p of deptPaths) out.set(p.ubigeo, p.centroid);
    if (provData) {
      const area = new Map<string, number>();
      for (const f of provData.features as ProvFeature[]) {
        const code = f.properties.code;
        if (!code) continue;
        const a = pg.area(f as any);
        if (a > (area.get(code) ?? -1)) {
          area.set(code, a);
          out.set(code, pg.centroid(f as any) as [number, number]);
        }
      }
    }
    return out;
  }, [projection, deptPaths, provData]);

  /** Qué nombres de departamento caben sobre el mapa (colocación codiciosa, ver mapa/geometria). */
  const etiquetasVisibles = useMemo(() => colocarEtiquetas(deptPaths, regiones, fitScale), [deptPaths, regiones, fitScale]);

  // El encuadre final: el país entero o el departamento abierto. Todo lo que se dibuja a
  // tamaño de pantalla se calcula para ESTE encuadre; el zoom sólo mueve el grupo hasta él.
  const targetTransform = useMemo<Encuadre>(() => {
    if (!seleccion || !deptPaths.length) return ENCUADRE_PAIS;
    const sel = deptPaths.find((p) => p.ubigeo === seleccion);
    if (!sel || !sel.bounds) return ENCUADRE_PAIS;
    const [[x0, y0], [x1, y1]] = sel.bounds;
    const w = x1 - x0 || 1;
    const h = y1 - y0 || 1;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const padding = 0.78;
    const s = Math.min((VB_W * padding) / w, (VB_H * padding) / h);
    return { tx: VB_W / 2 - cx * s, ty: VB_H / 2 - cy * s, s };
  }, [seleccion, deptPaths]);

  /** Dónde va cada punto anclado a una zona: espiral dentro de su polígono (ver mapa/geometria). */
  const posiciones = useMemo(() => {
    if (!projection || !deptData) return new Map<string, [number, number]>();
    const poligonosPorZona = new Map<string, Feature[]>();
    for (const f of deptData.features as DeptFeature[]) if (f.properties.code) poligonosPorZona.set(f.properties.code, [f]);
    for (const f of (provData?.features ?? []) as ProvFeature[]) {
      const code = f.properties.code;
      if (code) poligonosPorZona.set(code, [...(poligonosPorZona.get(code) ?? []), f]);
    }
    // Sin las provincias todavía (se piden al abrir un departamento), el punto anclado a una
    // provincia se abre en la espiral de su departamento en vez de quedarse sin dibujar.
    const anclados = provData ? points : points.map((pt) => (pt.zona && pt.zona.length > 2 ? { ...pt, zona: pt.zona.slice(0, 2) } : pt));
    return posicionesEnEspiral({ points: anclados, projection, poligonosPorZona, centroides, escala: (fitScale || 1) * (targetTransform.s || 1) });
  }, [points, projection, deptData, provData, centroides, fitScale, targetTransform.s]);

  const animando = useZoomAnimado(grupoRef, targetTransform, status === "ready");

  if (status === "loading") return <MapaEsqueleto />;
  if (status === "missing" || status === "error") return <ErrorMapa faltaArchivo={status === "missing"} />;

  const zoomScale = targetTransform.s;
  /** Lo que se dibuja a tamaño de pantalla (etiquetas, puntos) no se ve mientras dura el zoom. */
  const capaPantalla = {
    opacity: animando ? 0 : 1,
    transition: animando || reducido ? "none" : "opacity 120ms ease-out",
  } as const;

  /**
   * Tamaños pedidos en PÍXELES REALES de pantalla: `px()` divide por el zoom de
   * región y por la escala con que el SVG entra en su caja. Las tres medidas de
   * etiqueta son jerarquía: en un mapa el tamaño del nombre ES un dato.
   */
  const px = (objetivo: number) => objetivo / (fitScale * zoomScale);
  const fs = {
    deptAlto: px(14),
    deptMedio: px(12),
    deptBajo: px(10),
    deptSelected: px(15),
    prov: px(11),
  };
  /**
   * Bordes en PÍXELES REALES: van con `vector-effect: non-scaling-stroke`, así su grosor no
   * depende del zoom ni de la escala del SVG, y se ven bien también durante el zoom (que ya
   * no re-dibuja nada por cuadro). Los halos de las etiquetas siguen en unidades del viewBox.
   */
  const sw = {
    // La frontera pasa de 0,6 a 0,9 px: con 0,6 (0,41 px reales en móvil) los
    // departamentos vecinos que comparten escalón se fundían en una sola mancha.
    dept: 0.9,
    deptSelected: 1.8,
    province: 0.7,
    provinceSel: 1.8,
    foco: 2.6,
    destacada: 2,
    pulso: 2.4,
    // El halo baja de 2,8 a 2,2 unidades de viewBox reales: con el texto ahora
    // invirtiendo su color según el escalón, el halo deja de ser lo único que
    // sostiene la legibilidad y vuelve a ser lo que debe ser, una separación
    // fina. Un halo grueso hace que se lea un bulto blanco, no una palabra.
    labelHalo: px(2.2),
    labelHaloSm: px(1.8),
  };

  /** Dónde va un punto, en unidades del viewBox: su lugar en la espiral de su zona, o la proyección de sus coordenadas. */
  const posicionDe = (pt: MapPoint): [number, number] | null => {
    const anclada = posiciones.get(pt.id);
    if (anclada) return anclada;
    if (typeof pt.lat === "number" && typeof pt.lon === "number" && projection) return projection([pt.lon, pt.lat]) as [number, number] | null;
    return null;
  };

  const focoPath =
    (foco && provincePaths.find((p) => p.ubigeo === foco)?.d) ||
    (foco && deptPaths.find((p) => p.ubigeo === foco)?.d) ||
    null;

  const activar = (ubigeo: string) => onSelectRegion(seleccion === ubigeo ? null : ubigeo);

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        // `role="img"` sacaba del árbol de accesibilidad a los 25 departamentos
        // —medido en producción: 25 paths, 0 alcanzables por teclado—. Con
        // `group` los hijos siguen expuestos y cada uno es un control real.
        role="group"
        aria-label={
          seleccion
            ? `Mapa de ${deptPaths.find((p) => p.ubigeo === seleccion)?.name ?? "la región"}, por provincias`
            : "Mapa del Perú por departamentos"
        }
        onKeyDown={(e) => {
          if (e.key === "Escape" && seleccion) {
            e.preventDefault();
            onSelectRegion(null);
          }
        }}
      >
        <defs>
          {/* Patrón océano: trazos cruzados sutiles */}
          {/* "Sin dato" va rayado, no en un tono más claro de la misma rampa:
              un tono más claro se lee como "poco", y acá el mensaje es "no sabemos". */}
          <pattern id="sin-dato" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={SIN_DATO} />
            <line x1="0" y1="0" x2="0" y2="5" stroke={SIN_DATO_TRAMA} strokeWidth="1.1" />
          </pattern>

          <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="1.5" dy="3" stdDeviation="2.5" floodColor={COLOR.ink} floodOpacity="0.22" />
          </filter>
        </defs>

        {/* Sin rectángulos de fondo dentro del SVG: con preserveAspectRatio pintaban
            SOLO el viewBox y dejaban dos costuras verticales. El lienzo lo pinta el
            contenedor, así no hay costura posible cualquiera sea el encuadre. */}

        {/* Sin `transform` en el JSX: lo escribe useZoomAnimado directo en el DOM. */}
        <g ref={grupoRef}>
          {/* Departamentos — cada uno es un control: foco, Enter/Espacio y etiqueta con cifras. */}
          <g filter="url(#paper-shadow)">
            {deptPaths.map((p) => {
              const z = regiones[p.ubigeo];
              const isSelected = seleccion === p.ubigeo;
              // Apagado por filtro o por tener otra region abierta: mismo gris.
              const isDimmed = (seleccion !== null && !isSelected) || !!z?.apagada;
              const activa = activaUbigeo === p.ubigeo;
              return (
                <path
                  key={p.ubigeo}
                  d={p.d}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${p.name}. ${z?.resumen ?? "sin dato"}${z?.destacada ? ". Zona que sigues" : ""}`}
                  className="foco-propio"
                  // Atenuado = un neutro plano (con opacidad el mapa entero se teñía de rosa).
                  fill={isDimmed ? COLOR.paperDeep : z ? (z.sinDato ? "url(#sin-dato)" : z.color) : "url(#sin-dato)"}
                  // Frontera blanca: se lee sobre los cinco escalones, porque la rampa nunca llega al blanco.
                  stroke={isSelected ? COLOR.ink : z?.destacada ? COLOR.granate : isDimmed ? COLOR.paperEdge : COLOR.paper}
                  strokeWidth={isSelected ? sw.deptSelected : z?.destacada ? sw.destacada : sw.dept}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  onMouseEnter={(e) =>
                    onZonaActiva({ ubigeo: p.ubigeo, nombre: p.name, nivel: "departamento" }, e.currentTarget.getBoundingClientRect())
                  }
                  onMouseLeave={() => onZonaActiva(null, null)}
                  onFocus={(e) => {
                    setFoco(p.ubigeo);
                    onZonaActiva({ ubigeo: p.ubigeo, nombre: p.name, nivel: "departamento" }, e.currentTarget.getBoundingClientRect());
                  }}
                  onBlur={() => {
                    setFoco((f) => (f === p.ubigeo ? null : f));
                    onZonaActiva(null, null);
                  }}
                  onClick={() => activar(p.ubigeo)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      activar(p.ubigeo);
                    }
                  }}
                  style={{
                    cursor: "pointer",
                    transition: reducido ? "none" : "fill 260ms ease, stroke 200ms ease, filter 200ms ease",
                    // La ola va de oeste a este según el centroide: de 0 a 280 ms.
                    transitionDelay: escalonando && !reducido ? `${Math.round((p.centroid[0] / VB_W) * 280)}ms` : "0ms",
                    filter: activa && !isSelected ? "brightness(1.08)" : undefined,
                  }}
                />
              );
            })}
          </g>

          {/* Provincias del departamento abierto: mismo dato, escala recalculada dentro de la región. */}
          {seleccion && provincePaths.length > 0 && (
            <g>
              {provincePaths.map((p) => {
                const z = provincias?.[p.ubigeo] ?? provinciaPorDefecto;
                const elegida = !!zonaSel && (zonaSel === p.ubigeo || zonaSel.startsWith(p.ubigeo));
                const activa = activaUbigeo === p.ubigeo;
                return (
                  <path
                    key={p.key}
                    d={p.d}
                    role="button"
                    tabIndex={0}
                    aria-pressed={elegida}
                    aria-label={`Provincia de ${p.name}. ${z?.resumen ?? "sin dato"}`}
                    className="foco-propio"
                    fill={z ? (z.sinDato ? "url(#sin-dato)" : z.color) : "url(#sin-dato)"}
                    fillOpacity={0.92}
                    stroke={elegida ? COLOR.ink : COLOR.paper}
                    strokeWidth={elegida ? sw.provinceSel : sw.province}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    onMouseEnter={(e) =>
                      onZonaActiva({ ubigeo: p.ubigeo, nombre: p.name, nivel: "provincia" }, e.currentTarget.getBoundingClientRect())
                    }
                    onMouseLeave={() => onZonaActiva(null, null)}
                    onFocus={(e) => {
                      setFoco(p.ubigeo);
                      onZonaActiva({ ubigeo: p.ubigeo, nombre: p.name, nivel: "provincia" }, e.currentTarget.getBoundingClientRect());
                    }}
                    onBlur={() => {
                      setFoco((f) => (f === p.ubigeo ? null : f));
                      onZonaActiva(null, null);
                    }}
                    onClick={() => onSelectProvincia(p.ubigeo, p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectProvincia(p.ubigeo, p.name);
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      transition: reducido ? "none" : "fill 260ms, filter 200ms",
                      transitionDelay: escalonando && !reducido ? `${Math.round((p.centroid[0] / VB_W) * 280)}ms` : "0ms",
                      filter: activa ? "brightness(1.08)" : undefined,
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Pines de contratos (distritos), alertas y denuncias */}
          {/* Departamentos donde ahora mismo hay contratos leyéndose o esperando
              su lectura: un contorno que late. Sólo con datos reales > 0. */}
          {pulsos && Object.keys(pulsos).length > 0 && (
            <g pointerEvents="none">
              {deptPaths
                .filter((p) => pulsos[p.ubigeo])
                .map((p) => (
                  // En vivo = moss (lo positivo), nunca el acento de marca.
                  <path
                    key={`pulso-${p.ubigeo}`}
                    d={p.d}
                    fill="none"
                    strokeWidth={sw.pulso}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    className="stroke-moss motion-safe:animate-pulseSoft"
                  >
                    <title>{`${p.name}: ${pulsos[p.ubigeo]}`}</title>
                  </path>
                ))}
            </g>
          )}

          {projection && points.length > 0 && (
            <g pointerEvents={animando ? "none" : "auto"} style={capaPantalla}>
              {points.map((pt) => {
                const pos = posicionDe(pt);
                if (!pos) return null;
                const [px, py] = pos;
                if (pt.kind === "contratos") {
                  return (
                    <ContratoPin
                      key={`pt-${pt.id}`}
                      px={px}
                      py={py}
                      r={pt.r ?? 3}
                      color={pt.color ?? COLOR.mute}
                      total={pt.total ?? 0}
                      nombre={pt.label ?? ""}
                      zoom={zoomScale}
                      escalaPantalla={fitScale}
                      selected={pt.selected}
                      hovered={pt.hovered}
                      onClick={onPointClick ? () => onPointClick(pt) : undefined}
                      onHover={onPointHover ? (on) => onPointHover(on ? pt : null) : undefined}
                    />
                  );
                }
                // El radio lo decide el contenedor (`r`), que es quien conoce la
                // clasificación de `lib/severidad`: acá no se compara ningún score.
                const r = (pt.r ?? 3.4) / zoomScale;
                // Anillo blanco de 1,6 px REALES: separa el punto del relleno aunque el
                // brillo de los dos colores casi coincida (hasta 1,03:1, medido).
                const sw2 = 1.6 / (fitScale * zoomScale);
                // Área que se toca: al menos 12 px reales de diámetro aunque el punto mida 6.
                const rToque = Math.max(r, 6 / (fitScale * zoomScale));
                const ir = () => {
                  if (pt.href) router.push(pt.href);
                  else onPointClick?.(pt);
                };
                const enfocado = focoPunto === pt.id;
                return (
                  <g
                    key={`pt-${pt.id}`}
                    role={pt.href ? "link" : "button"}
                    tabIndex={0}
                    aria-label={pt.titulo ?? pt.label ?? ""}
                    className="foco-propio"
                    style={{ cursor: "pointer" }}
                    onClick={ir}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || (!pt.href && e.key === " ")) {
                        e.preventDefault();
                        ir();
                      }
                    }}
                    onFocus={() => setFocoPunto(pt.id)}
                    onBlur={() => setFocoPunto((f) => (f === pt.id ? null : f))}
                  >
                    <circle cx={px} cy={py} r={rToque} fill="transparent" />
                    {enfocado && (
                      <circle cx={px} cy={py} r={r + 3.2 / (fitScale * zoomScale)} fill="none" stroke={COLOR.granate} strokeWidth={2.2 / (fitScale * zoomScale)} />
                    )}
                    <circle cx={px} cy={py} r={r} className={pt.colorClase} fill={pt.color ?? COLOR.mute} stroke={COLOR.paper} strokeWidth={sw2}>
                      <title>{pt.titulo ?? pt.label ?? ""}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          )}

          {/* Etiquetas de departamento: DESPUÉS de los puntos (en SVG lo último queda
              encima), así ningún círculo perfora un nombre. */}
          <g pointerEvents="none" style={capaPantalla}>
            {deptPaths.map((p) => {
              const isSelected = seleccion === p.ubigeo;
              const isDimmed = seleccion !== null && !isSelected;
              if (isDimmed) return null;
              // El departamento abierto siempre lleva su nombre; el resto (Callao nunca:
              // su nombre es 17 veces su polígono), sólo si la colocación les dio lugar.
              if (!isSelected && !etiquetasVisibles.has(p.ubigeo)) return null;

              const [cx, cy] = p.centroid;
              const relleno = regiones[p.ubigeo]?.color ?? COLOR.paper;
              const tinta = tintaSobre(relleno);
              const nivel = nivelDeEtiqueta(relleno);
              const f = isSelected
                ? fs.deptSelected
                : nivel === "alto"
                  ? fs.deptAlto
                  : nivel === "medio"
                    ? fs.deptMedio
                    : fs.deptBajo;
              const peso = isSelected ? 700 : nivel === "alto" ? 700 : nivel === "medio" ? 600 : 500;
              const fFinal = f;
              return (
                <g key={`lb-${p.ubigeo}`} transform={`translate(${cx},${cy})`}>
                  {/* Un solo <text>: con `paint-order: stroke` el halo queda debajo del
                      relleno. La copia de sólo relleno que iba encima no cambiaba el dibujo
                      y hacía que cada nombre se leyera dos veces ("Amazonas Amazonas"). */}
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fontSize={fFinal}
                    fontWeight={peso}
                    fill={tinta.texto}
                    stroke={tinta.halo}
                    strokeWidth={sw.labelHalo}
                    strokeOpacity="0.9"
                    style={{ paintOrder: "stroke" }}
                  >
                    {p.name}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Etiquetas de provincia (solo con departamento abierto) */}
          {seleccion && (
            <g pointerEvents="none" style={capaPantalla}>
              {provincePaths.map((p) => {
                // De una provincia partida en dos polígonos se rotula sólo el más grande.
                if (provincePaths.some((q) => q.ubigeo === p.ubigeo && q.area > p.area)) return null;
                const [cx, cy] = p.centroid;
                return (
                  <g key={`lb-prov-${p.key}`} transform={`translate(${cx},${cy})`}>
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      fontSize={fs.prov}
                      fontWeight="600"
                      fill={COLOR.ink}
                      stroke={COLOR.paper}
                      strokeWidth={sw.labelHaloSm}
                      strokeOpacity="0.95"
                      style={{ paintOrder: "stroke" }}
                    >
                      {p.name}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Anillo de foco, dibujado en el SVG y encima de todo: el `outline` del
              navegador sobre un `<path>` traza la caja, no la forma del departamento. */}
          {focoPath && (
            <path
              d={focoPath}
              fill="none"
              stroke={COLOR.granate}
              strokeWidth={sw.foco}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
    </div>
  );
}
