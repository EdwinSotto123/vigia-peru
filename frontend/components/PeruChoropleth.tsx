"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { AlertCircle, Terminal } from "lucide-react";
import { ContratoPin } from "./contratos/ContratoPin";
import { nivelDeEtiqueta, tintaSobre } from "./mapa/escala";

const VB_W = 480;
const VB_H = 700;

interface DepartmentProps {
  name: string;
  id: string;
  code?: string;
}

interface ProvinceProps {
  name: string;
  departamento: string;
  regionId: string;
  id: string;
  code?: string;
}

type DeptFeature = Feature<Geometry, DepartmentProps>;
type ProvFeature = Feature<Geometry, ProvinceProps>;
type DeptGeo = FeatureCollection<Geometry, DepartmentProps>;
type ProvGeo = FeatureCollection<Geometry, ProvinceProps>;

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
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
}: PeruChoroplethProps) {
  const [deptData, setDeptData] = useState<DeptGeo | null>(null);
  const [provData, setProvData] = useState<ProvGeo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [foco, setFoco] = useState<string | null>(null);
  // Estado animado del transform — actualizado por RAF
  const [animTransform, setAnimTransform] = useState({ tx: 0, ty: 0, s: 1 });

  /**
   * Cuántos píxeles de pantalla mide una unidad del viewBox.
   *
   * Sin esto, declarar `fontSize: 9` no significa 9 px: significa 9 unidades de
   * un viewBox de 480×700 que el navegador escala para entrar en su caja. Medido
   * en producción: 8,74 px en escritorio y **6,19 px en un teléfono de 390**,
   * con la frontera de departamento cayendo a 0,41 px. El mapa era
   * tipográficamente ilegible justo en el dispositivo donde más se usa.
   *
   * Con este factor, pedir 12 px da 12 px reales en 1440 y en 390.
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/peru-departments.json")
      .then((r) => {
        if (r.status === 404) throw new Error("missing");
        if (!r.ok) throw new Error("error");
        return r.json();
      })
      .then((data: DeptGeo) => {
        if (!alive) return;
        setDeptData(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setStatus(err.message === "missing" ? "missing" : "error");
      });
    fetch("/peru-provinces.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProvGeo | null) => {
        if (alive && data) setProvData(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
    return (deptData.features as DeptFeature[])
      .map((feat) => ({
        ubigeo: feat.properties.code ?? "",
        id: feat.properties.id,
        name: feat.properties.name,
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
      .map((f) => ({
        ubigeo: f.properties.code ?? "",
        name: f.properties.name,
        d: pg(f as any) || "",
        centroid: pg.centroid(f as any) as [number, number],
      }))
      .filter((p) => !!p.ubigeo)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [provData, projection, seleccion]);

  /**
   * Qué nombres de departamento se imprimen sobre el mapa.
   *
   * Colocación codiciosa por prioridad, que es como resuelve esto cualquier
   * motor de rotulación: se ordenan los nombres por importancia —el escalón de
   * la medida activa, derivado del relleno— y se van colocando; el que choca
   * con uno ya colocado no se imprime. Sin esto había tres solapamientos
   * medidos (Cajamarca×Lambayeque, Ayacucho×Apurímac y Callao×Lima), que es lo
   * que hacía ver el mapa sucio en la zona norte y en la sierra sur.
   *
   * Lo que no se imprime no se pierde: el nombre y las cifras están en la ficha
   * flotante al pasar por encima o al llegar con Tab.
   */
  const etiquetasVisibles = useMemo(() => {
    if (!deptPaths.length) return new Set<string>();
    const prioridad = (u: string) => {
      const n = nivelDeEtiqueta(regiones[u]?.color ?? "#FFFFFF");
      return n === "alto" ? 0 : n === "medio" ? 1 : 2;
    };
    // Tamaños nominales en unidades de viewBox (sin el factor de pantalla: acá
    // sólo importan las proporciones entre etiquetas, no su tamaño final).
    const tam = (u: string) => {
      const n = nivelDeEtiqueta(regiones[u]?.color ?? "#FFFFFF");
      return n === "alto" ? 14 : n === "medio" ? 12 : 10;
    };
    const candidatos = deptPaths
      .filter((p) => !p.name.toLowerCase().includes("callao"))
      .sort((a, b) => prioridad(a.ubigeo) - prioridad(b.ubigeo) || a.name.localeCompare(b.name, "es"));

    const colocadas: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const visibles = new Set<string>();
    for (const p of candidatos) {
      const f = tam(p.ubigeo) / (fitScale || 1);
      const w = p.name.length * f * 0.52;
      const h = f * 1.1;
      const [cx, cy] = p.centroid;
      const caja = { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
      // ¿Entra en su propio departamento?
      if (w > (p.bounds[1][0] - p.bounds[0][0]) * 1.15) continue;
      // ¿Choca con alguna ya colocada?
      const choca = colocadas.some((c) => caja.x1 < c.x2 && caja.x2 > c.x1 && caja.y1 < c.y2 && caja.y2 > c.y1);
      if (choca) continue;
      colocadas.push(caja);
      visibles.add(p.ubigeo);
    }
    return visibles;
  }, [deptPaths, regiones, fitScale]);

  // Computa target transform basado en el departamento abierto
  const targetTransform = useMemo(() => {
    if (!seleccion || !deptPaths.length) return { tx: 0, ty: 0, s: 1 };
    const sel = deptPaths.find((p) => p.ubigeo === seleccion);
    if (!sel || !sel.bounds) return { tx: 0, ty: 0, s: 1 };
    const [[x0, y0], [x1, y1]] = sel.bounds;
    const w = x1 - x0 || 1;
    const h = y1 - y0 || 1;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const padding = 0.78;
    const s = Math.min((VB_W * padding) / w, (VB_H * padding) / h);
    return { tx: VB_W / 2 - cx * s, ty: VB_H / 2 - cy * s, s };
  }, [seleccion, deptPaths]);

  // Animación con requestAnimationFrame — cubic ease out, 240 ms (duration-panel).
  // Antes eran 700 ms: fuera de la banda de 150-250 ms del sistema, y en un mapa
  // que es el primer paso del producto se sentía como una espera, no como un
  // cambio de estado.
  useEffect(() => {
    const reducido =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const to = targetTransform;
    if (reducido) {
      setAnimTransform(to);
      return;
    }
    const duration = 240;
    const start = performance.now();
    const from = animTransform;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimTransform({
        tx: from.tx + (to.tx - from.tx) * eased,
        ty: from.ty + (to.ty - from.ty) * eased,
        s: from.s + (to.s - from.s) * eased,
      });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTransform.tx, targetTransform.ty, targetTransform.s]);

  if (status === "loading") return <MapaEsqueleto />;
  if (status === "missing") return <MissingGeoJSON />;
  if (status === "error") return <FetchError />;

  const { tx, ty, s: zoomScale } = animTransform;
  const transformStr = `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${zoomScale.toFixed(4)})`;

  /**
   * Tamaños pedidos en PÍXELES REALES de pantalla.
   *
   * Antes se dividía sólo por `zoomScale`, que compensa el zoom de región pero
   * no la escala con la que el SVG entra en su caja. `px()` divide por las dos,
   * así que el número que se escribe acá es el que se ve.
   *
   * Las tres medidas de etiqueta son la jerarquía: un departamento del escalón
   * más alto de la medida activa se imprime más grande que uno del más bajo,
   * porque en un mapa el tamaño del nombre ES un dato. Los ratios 14/12 = 1,17
   * y 12/10 = 1,20 caen dentro de la banda de la escala tipográfica del sistema.
   */
  const px = (objetivo: number) => objetivo / (fitScale * zoomScale);
  const fs = {
    deptAlto: px(14),
    deptMedio: px(12),
    deptBajo: px(10),
    deptSelected: px(15),
    prov: px(11),
  };
  const sw = {
    // La frontera pasa de 0,6 a 0,9 px: con 0,6 (0,41 px reales en móvil) los
    // departamentos vecinos que comparten escalón se fundían en una sola mancha.
    dept: px(0.9),
    deptSelected: px(1.8),
    province: px(0.7),
    provinceSel: px(1.8),
    foco: px(2.6),
    destacada: px(2),
    // El halo baja de 2,8 a 2,2 unidades de viewBox reales: con el texto ahora
    // invirtiendo su color según el escalón, el halo deja de ser lo único que
    // sostiene la legibilidad y vuelve a ser lo que debe ser, una separación
    // fina. Un halo grueso hace que se lea un bulto blanco, no una palabra.
    labelHalo: px(2.2),
    labelHaloSm: px(1.8),
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
            <rect width="5" height="5" fill="#E8DFC7" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#B9AE93" strokeWidth="1.1" />
          </pattern>

          <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="1.5" dy="3" stdDeviation="2.5" floodColor="#1B1611" floodOpacity="0.22" />
          </filter>
        </defs>

        {/* Acá había dos rectángulos de fondo (#FFFFFF y una trama diagonal de
            "océano") que cubrían el viewBox y SOLO el viewBox. Como el SVG se
            ajusta con preserveAspectRatio, el dibujo se encoge y se centra, así
            que esos rectángulos terminaban pintando un bloque blanco de 680 px
            de alto con 83 px de gris a cada lado en la vista país — y 323 px por
            lado con una región abierta. Dos costuras verticales duras que nadie
            decidió: no eran un borde, eran un artefacto de encuadre, y son
            exactamente lo que se veía horrible.

            El lienzo ahora lo pinta el contenedor. Sin una segunda superficie
            dentro del SVG no hay costura posible, cualquiera sea el encuadre.
            La trama diagonal se va con ellos: era textura decorativa sobre un
            fondo, justo lo que el detector de Impeccable marca. */}

        <g transform={transformStr}>
          {/* Departamentos — cada uno es un control: foco, Enter/Espacio y etiqueta con cifras. */}
          <g filter="url(#paper-shadow)">
            {deptPaths.map((p) => {
              const z = regiones[p.ubigeo];
              const isSelected = seleccion === p.ubigeo;
              const isDimmed = seleccion !== null && !isSelected;
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
                  // Atenuar con opacity 0.25 componía el color del dato contra el
                  // lienzo y daba beiges y rosas apagados; como los 24 departamentos
                  // no elegidos cubren casi todo, el mapa entero se teñía de rosa
                  // polvoriento. Eso era buena parte del aspecto sucio. Ahora el
                  // contexto es un gris plano: deja de competir y deja de ensuciar.
                  fill={isDimmed ? "#E7EAEE" : z ? (z.sinDato ? "url(#sin-dato)" : z.color) : "url(#sin-dato)"}
                  // La frontera era #76695A, un tono medio cuyo contraste contra los
                  // cinco escalones daba 2,84 / 1,75 / 1,01 / 1,76 / 2,81: sobre el
                  // escalón central es el mismo valor, así que los 15 pares de
                  // departamentos vecinos que comparten relleno se fundían en una
                  // sola mancha. El blanco se lee siempre, porque la rampa nunca
                  // llega al blanco.
                  stroke={isSelected ? "#14171A" : z?.destacada ? "#4F3D96" : isDimmed ? "#D2D7DE" : "#FFFFFF"}
                  strokeWidth={isSelected ? sw.deptSelected : z?.destacada ? sw.destacada : sw.dept}
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
                    transition: "fill 200ms ease, stroke 200ms ease, filter 200ms ease",
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
                    key={p.ubigeo}
                    d={p.d}
                    role="button"
                    tabIndex={0}
                    aria-pressed={elegida}
                    aria-label={`Provincia de ${p.name}. ${z?.resumen ?? "sin dato"}`}
                    className="foco-propio"
                    fill={z ? (z.sinDato ? "url(#sin-dato)" : z.color) : "url(#sin-dato)"}
                    fillOpacity={0.92}
                    stroke={elegida ? "#1B1611" : "#F4EEDD"}
                    strokeWidth={elegida ? sw.provinceSel : sw.province}
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
                    style={{ cursor: "pointer", transition: "fill 200ms, filter 200ms", filter: activa ? "brightness(1.08)" : undefined }}
                  />
                );
              })}
            </g>
          )}

          {/* Pines de contratos (distritos), alertas y denuncias */}
          {projection && points.length > 0 && (
            <g pointerEvents="auto">
              {points.map((pt) => {
                const proj = projection([pt.lon, pt.lat]);
                if (!proj) return null;
                const [px, py] = proj;
                if (pt.kind === "contratos") {
                  return (
                    <ContratoPin
                      key={`pt-${pt.id}`}
                      px={px}
                      py={py}
                      r={pt.r ?? 3}
                      color={pt.color ?? "#5B6B7A"}
                      total={pt.total ?? 0}
                      nombre={pt.label ?? ""}
                      zoom={zoomScale}
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
                const sw2 = 0.8 / zoomScale;
                return (
                  <circle
                    key={`pt-${pt.id}`}
                    cx={px}
                    cy={py}
                    r={r}
                    className={pt.colorClase}
                    fill={pt.color ?? "#687180"}
                    stroke="#FFFFFF"
                    strokeWidth={sw2}
                    style={{ cursor: pt.href ? "pointer" : "default" }}
                    onClick={() => {
                      if (pt.href) window.location.assign(pt.href);
                      else onPointClick?.(pt);
                    }}
                  >
                    <title>{pt.titulo ?? pt.label ?? ""}</title>
                  </circle>
                );
              })}
            </g>
          )}

          {/* Los rótulos van DESPUÉS de los puntos: en SVG lo que se dibuja
              último queda encima, y con los puntos arriba seis nombres
              —Áncash, Cusco, Lima, Piura, Tacna, Tumbes— quedaban perforados
              por un círculo en el medio de la palabra. En cartografía el rótulo
              va sobre todo lo demás: es lo último que se puede tapar. */}
          {/* Etiquetas de departamento */}
          <g pointerEvents="none">
            {deptPaths.map((p) => {
              const isSelected = seleccion === p.ubigeo;
              const isDimmed = seleccion !== null && !isSelected;
              if (isDimmed) return null;
              // Callao mide 16 px² de polígono y su nombre ocupa 270 px²:
              // diecisiete veces más grande que el departamento que nombra, y
              // encima pisa a Lima. Un mapa de prensa no lo rotula sobre el
              // mapa; se lee al pasar por encima, donde ya está la ficha con
              // sus cifras.
              // El departamento abierto siempre lleva su nombre; el resto,
              // sólo si la colocación codiciosa les dio lugar.
              if (!isSelected && !etiquetasVisibles.has(p.ubigeo)) return null;

              const [cx, cy] = p.centroid;
              const relleno = regiones[p.ubigeo]?.color ?? "#FFFFFF";
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
                  <text textAnchor="middle" dy="0.35em" fontSize={fFinal} fontWeight={peso} fill={tinta.texto}>
                    {p.name}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Etiquetas de provincia (solo con departamento abierto) */}
          {seleccion && (
            <g pointerEvents="none">
              {provincePaths.map((p) => {
                const [cx, cy] = p.centroid;
                return (
                  <g key={`lb-prov-${p.ubigeo}`} transform={`translate(${cx},${cy})`}>
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      fontSize={fs.prov}
                      fontWeight="600"
                      fill="#14171A"
                      stroke="#FFFFFF"
                      strokeWidth={sw.labelHaloSm}
                      strokeOpacity="0.95"
                      style={{ paintOrder: "stroke" }}
                    >
                      {p.name}
                    </text>
                    <text textAnchor="middle" dy="0.35em" fontSize={fs.prov} fontWeight="600" fill="#14171A">
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
              stroke="#4F3D96"
              strokeWidth={sw.foco}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
    </div>
  );
}

function MapaEsqueleto() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-paperDeep">
      <div className="h-[86%] w-[52%] animate-pulse rounded-[45%_55%_48%_52%] bg-paperEdge" />
      <span className="sr-only">Cargando la geometría del Perú</span>
    </div>
  );
}

function FetchError() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-rust/40 bg-crimson-soft p-6 text-center">
        <AlertCircle size={32} className="text-rust" />
        <h3 className="font-serif text-lg font-bold text-ink">No se pudo cargar el mapa</h3>
        <p className="text-sm text-mute">La geometría del Perú no llegó. Recarga la página para volver a intentarlo.</p>
      </div>
    </div>
  );
}

function MissingGeoJSON() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-paperEdge bg-paperSoft p-7 text-center shadow-card">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-paperDeep text-heroViolet">
          <Terminal size={22} />
        </div>
        <h3 className="font-serif text-xl font-bold text-ink">Falta la geometría del Perú</h3>
        <p className="text-sm leading-relaxed text-mute">Generala una vez con:</p>
        <pre className="w-full rounded-xl border border-line bg-paperDeep px-4 py-3 text-left font-mono text-xs leading-relaxed text-ink">
          python backend/scripts/fetch_peru_geo.py
        </pre>
      </div>
    </div>
  );
}
