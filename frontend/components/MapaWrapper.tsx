"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Coins,
  FileSearch,
  GitMerge,
  ChevronUp,
  ChevronDown,
  MessageSquareWarning,
  Landmark,
  Bell,
} from "lucide-react";
import { useCuenta } from "@/lib/cuentas";
import { REGIONES, type MetricaId, metricLabel } from "@/lib/peru-data";
import { formatSoles, ALERTAS_MOCK } from "@/lib/mock-data";
import { getReportes, getAlertas } from "@/lib/api-client";
import { getZonas, getAlcance, alcanceCorto, ESTADO_FILL, ESTADO_LABEL, type Alcance, type Zona, type ZonaEstado } from "@/lib/financiamiento";
import { coordsForRegionWithJitter } from "@/lib/region-coords";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { REGION_UBIGEO, UBIGEO_REGION, belongsToRegion } from "./mapa/region-match";
import { FiltroMes, type RangoMes } from "./mapa/FiltroMes";
import type { ZonaTab } from "./mapa/ZonaHubPanel";
import { MapaContratosContext, type MapaContratos } from "./contratos/ContratosLista";
import { ContratoPinLeyenda, colorPorEstado, radioPorTotal } from "./contratos/ContratoPin";
import { getContratosGeo, type ContratoResumen, type ContratoZona } from "@/lib/contratos";
import { Marquee } from "./magicui/Marquee";
import { PulseDot } from "./ui/PulseDot";
import { cn } from "@/lib/utils";
import type { MapPoint } from "./PeruChoropleth";

const PeruChoropleth = dynamic(
  () => import("./PeruChoropleth").then((m) => m.PeruChoropleth),
  { ssr: false, loading: () => <MapSkeleton /> },
);

const METRICS: { id: MetricaId; label: string; icon: React.ReactNode }[] = [
  { id: "alertas", label: "Alertas", icon: <AlertTriangle size={14} /> },
  { id: "convergentes", label: "Convergentes", icon: <GitMerge size={14} /> },
  { id: "monto", label: "Monto S/.", icon: <Coins size={14} /> },
  { id: "score", label: "Score", icon: <Activity size={14} /> },
];

export function MapaWrapper({
  initialRegionId = null,
  initialTab,
}: {
  /** Región preseleccionada (p. ej. desde `/app/mapa?region=ancash`). */
  initialRegionId?: string | null;
  /** Pestaña inicial del panel de zona. */
  initialTab?: ZonaTab;
} = {}) {
  const [metric, setMetric] = useState<MetricaId>("alertas");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(
    initialRegionId && REGIONES.some((r) => r.id === initialRegionId) ? initialRegionId : null,
  );
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [provinciaActiva, setProvinciaActiva] = useState<any | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Toggle de capas de pines
  const [showAlertas, setShowAlertas] = useState(true);
  const [showDenuncias, setShowDenuncias] = useState(true);
  // Capa opcional: pinta cada departamento por estado de financiamiento de su auditoría.
  const [showFinanciamiento, setShowFinanciamiento] = useState(true);   // cola real por región; el selector de métricas mock se retiró
  const [zonas, setZonas] = useState<Zona[] | null>(null);
  // Capa "Mis zonas" (solo con sesión): resalta los departamentos de las zonas que el usuario sigue.
  const { perfil } = useCuenta();
  const misRegiones = useMemo(() => {
    const out = new Set<string>();
    for (const u of perfil?.zonasSeguidas ?? []) { const r = UBIGEO_REGION[u.slice(0, 2)]; if (r) out.add(r); }
    return out;
  }, [perfil]);
  const [showMisZonas, setShowMisZonas] = useState(false);
  // Panel inferior deslizable (móvil): arrastre vertical del asa.
  const touchY = useRef<number | null>(null);
  const [alcance, setAlcance] = useState<Alcance | null>(null);   // qué se analiza hoy (cola financiable, docs listos)
  const [reportes, setReportes] = useState<any[]>([]);
  const [alertasApi, setAlertasApi] = useState<any[]>([]);

  // Capa "Contratos": puntos agregados por zona (/contratos/geo). País → provincias;
  // con región elegida → sus distritos. Nunca 18 k puntos crudos.
  const [showContratos, setShowContratos] = useState(true);
  // `null` = todo el histórico. Antes no había ninguna forma de acotar los contratos del mapa
  // por fecha: todo se veía siempre mezclado, sin decir de qué mes es cada cosa.
  const [mesFiltro, setMesFiltro] = useState<RangoMes | null>(null);
  const [geo, setGeo] = useState<ContratoZona[]>([]);
  const geoCache = useRef<Map<string, ContratoZona[]>>(new Map());
  const [distrito, setDistrito] = useState<{ ubigeo: string; nombre: string } | null>(null);
  const [ocidSel, setOcidSel] = useState<string | null>(null);
  const [ubigeoSel, setUbigeoSel] = useState<string | null>(null);      // zona del contrato seleccionado en la lista
  const [hoverUbigeo, setHoverUbigeo] = useState<string | null>(null);  // fila con el mouse encima
  const [hoverPunto, setHoverPunto] = useState<string | null>(null);    // punto con el mouse encima
  const [panelTab, setPanelTab] = useState<ZonaTab | undefined>(initialTab);
  const mapRef = useRef<HTMLDivElement>(null);
  const urlLeida = useRef(false);
  const urlInicial = useRef<{ ubigeo: string | null; ocid: string | null } | null>(null);  // pendiente de absorber en el estado

  // Fetch alertas REALES + denuncias en paralelo
  useEffect(() => {
    let alive = true;
    getReportes({ limit: 200 })
      .then((data) => { if (alive) setReportes(data as any[]); })
      .catch(() => {});
    getAlertas({ limit: 200 })
      .then((data) => { if (alive) setAlertasApi(data as any[]); })
      .catch(() => {});
    getAlcance().then((a) => { if (alive) setAlcance(a); });
    return () => { alive = false; };
  }, []);

  // Estado de financiamiento por departamento: se pide una sola vez, al activar la capa.
  useEffect(() => {
    if (!showFinanciamiento || zonas !== null) return;
    let alive = true;
    getZonas("departamento").then((z) => { if (alive) setZonas(z ?? []); });
    return () => { alive = false; };
  }, [showFinanciamiento, zonas]);

  const fillFinanciamiento = useMemo<Record<string, string> | null>(() => {
    // "Mis zonas" manda sobre la capa de financiamiento: resalta las seguidas y atenúa el resto.
    if (showMisZonas && misRegiones.size > 0) {
      const out: Record<string, string> = {};
      for (const r of REGIONES) out[r.id] = misRegiones.has(r.id) ? "#F2C879" : "#EEF1F4";
      return out;
    }
    if (!showFinanciamiento) return null;
    const out: Record<string, string> = {};
    for (const z of zonas ?? []) {
      const regionId = UBIGEO_REGION[z.ubigeo];
      if (regionId) out[regionId] = ESTADO_FILL[z.estado];
    }
    return out;
  }, [showFinanciamiento, zonas, showMisZonas, misRegiones]);

  // Estado inicial desde la URL (?ubigeo=<distrito>&ocid=) — se lee una vez en el cliente.
  useEffect(() => {
    if (urlLeida.current) return;
    urlLeida.current = true;
    const sp = new URLSearchParams(window.location.search);
    const u = sp.get("ubigeo");
    const o = sp.get("ocid");
    const ubigeoOk = u && /^\d{6}$/.test(u) ? u : null;
    const ocidOk = o && /^[\w.-]{1,64}$/.test(o) ? o : null;
    urlInicial.current = { ubigeo: ubigeoOk, ocid: ocidOk };
    if (ubigeoOk) {
      setDistrito({ ubigeo: ubigeoOk, nombre: "" });
      const rid = UBIGEO_REGION[ubigeoOk.slice(0, 2)];
      if (rid && !selectedRegionId) setSelectedRegionId(rid);
      setPanelTab("cola");
    }
    if (ocidOk) setOcidSel(ocidOk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La URL refleja región, pestaña, distrito y contrato (sin navegar: replaceState).
  useEffect(() => {
    if (!urlLeida.current) return;
    // No pisar la URL hasta que el estado haya absorbido lo que traía (evita un parpadeo sin ?ubigeo/?ocid).
    const ini = urlInicial.current;
    if (ini && ((distrito?.ubigeo ?? null) !== ini.ubigeo || ocidSel !== ini.ocid)) return;
    urlInicial.current = null;
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null | undefined) => (v ? sp.set(k, v) : sp.delete(k));
    set("region", selectedRegionId);
    set("tab", selectedRegionId ? panelTab : null);
    set("ubigeo", selectedRegionId ? distrito?.ubigeo : null);
    set("ocid", selectedRegionId ? ocidSel : null);
    const qs = sp.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [selectedRegionId, panelTab, distrito, ocidSel]);

  // Puntos de contratos según nivel: sin región → provincias del país; con región → sus distritos.
  // El mes elegido entra en la key: cambiar de mes es, para el caché, una consulta distinta.
  const geoKey = `${selectedRegionId ? `distrito:${REGION_UBIGEO[selectedRegionId] ?? ""}` : "provincia:"}|${mesFiltro?.desde ?? ""}`;
  useEffect(() => {
    if (!showContratos) return;
    const cached = geoCache.current.get(geoKey);
    if (cached) { setGeo(cached); return; }
    let alive = true;
    const [nivel, ub] = geoKey.split("|")[0].split(":") as ["distrito" | "provincia", string];
    getContratosGeo({ nivel, ubigeo: ub || undefined, desde: mesFiltro?.desde, hasta: mesFiltro?.hasta }).then((d) => {
      if (!alive) return;
      geoCache.current.set(geoKey, d ?? []);
      setGeo(d ?? []);
    });
    return () => { alive = false; };
  }, [showContratos, geoKey, mesFiltro]);

  // Nombre del distrito cuando llegó por URL (solo el ubigeo).
  useEffect(() => {
    if (distrito && !distrito.nombre) {
      const z = geo.find((g) => g.ubigeo === distrito.ubigeo);
      if (z) setDistrito({ ubigeo: z.ubigeo, nombre: z.nombre });
    }
  }, [geo, distrito]);

  const totalContratos = useMemo(() => geo.reduce((n, z) => n + z.total, 0), [geo]);

  const puntosContratos = useMemo<MapPoint[]>(() => {
    if (!showContratos || !geo.length) return [];
    const max = Math.max(...geo.map((z) => z.total), 1);
    const resaltada = (u: string) => {
      const objetivo = hoverUbigeo ?? ubigeoSel;
      return !!objetivo && (objetivo === u || (u.length === 4 && objetivo.startsWith(u)));
    };
    return geo.map((z) => ({
      id: `c-${z.ubigeo}`,
      kind: "contratos" as const,
      lat: z.lat, lon: z.lon,
      label: z.nombre,
      ubigeo: z.ubigeo,
      total: z.total,
      r: radioPorTotal(z.total, max),
      color: colorPorEstado(z),
      selected: distrito?.ubigeo === z.ubigeo || resaltada(z.ubigeo),
      hovered: hoverPunto === z.ubigeo,
    }));
  }, [showContratos, geo, distrito, hoverUbigeo, ubigeoSel, hoverPunto]);

  const seleccionarContrato = useCallback((c: ContratoResumen | null) => {
    setOcidSel(c?.ocid ?? null);
    setUbigeoSel(c?.ubigeo ?? null);
    if (c && typeof window !== "undefined" && window.innerWidth < 1024) {
      mapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const onPointClick = useCallback((pt: MapPoint) => {
    if (pt.kind !== "contratos" || !pt.ubigeo) return;
    if (pt.ubigeo.length === 4) {
      // Provincia (vista país): entrar a su departamento; ahí se ven los distritos.
      const rid = UBIGEO_REGION[pt.ubigeo.slice(0, 2)];
      if (rid) { setSelectedRegionId(rid); setProvinciaActiva(null); setMobileDrawerOpen(true); }
      setDistrito(null); setOcidSel(null); setUbigeoSel(null);
      setPanelTab("cola");
      return;
    }
    setDistrito((d) => (d?.ubigeo === pt.ubigeo ? null : { ubigeo: pt.ubigeo!, nombre: pt.label ?? "" }));
    setOcidSel(null); setUbigeoSel(null);
    setPanelTab("cola");
    setMobileDrawerOpen(true);
  }, []);

  const mapaContratos = useMemo<MapaContratos>(() => ({
    activa: showContratos,
    distritoUbigeo: distrito?.ubigeo ?? null,
    distritoNombre: distrito?.nombre || null,
    ocidSeleccionado: ocidSel,
    seleccionar: seleccionarContrato,
    hover: (c) => setHoverUbigeo(c?.ubigeo ?? null),
    limpiarDistrito: () => { setDistrito(null); setOcidSel(null); setUbigeoSel(null); },
  }), [showContratos, distrito, ocidSel, seleccionarContrato]);

  // Construir lista de pines unificada.
  // Alertas: priorizamos API real con coords derivadas de la región contratante;
  // fallback al mock si la API no responde. Para alertas sin lat/lon, derivamos
  // del centroide de la región con jitter determinista (evita apilamientos).
  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (showAlertas) {
      const alertasFuente = alertasApi.length > 0 ? alertasApi : ALERTAS_MOCK;
      for (const a of alertasFuente) {
        let lat: number | null = typeof a.lat === "number" ? a.lat : null;
        let lon: number | null = typeof a.lon === "number" ? a.lon : null;
        // Si no hay lat/lon explícito → derivar del centroide de la región
        if (lat == null || lon == null) {
          const derived = coordsForRegionWithJitter(a.region, a.id || a.codigo || "");
          if (derived) { lat = derived.lat; lon = derived.lon; }
        }
        if (lat == null || lon == null) continue;
        out.push({
          id: `a-${a.id || a.codigo}`, kind: "alerta",
          lat, lon,
          score: a.score, label: a.objeto?.slice(0, 80),
          href: `/app/convocatoria/${a.codigoconvocatoria || a.codigo?.replace("OECE-", "") || a.id}`,
        });
      }
    }
    if (showDenuncias) {
      for (const r of reportes) {
        let lat: number | null = typeof r.lat === "number" ? r.lat : null;
        let lon: number | null = typeof r.lon === "number" ? r.lon : null;
        if (lat == null || lon == null) {
          const derived = coordsForRegionWithJitter(r.region, r.id);
          if (derived) { lat = derived.lat; lon = derived.lon; }
        }
        if (lat == null || lon == null) continue;
        out.push({
          id: `r-${r.id}`, kind: "reporte",
          lat, lon,
          categoria: r.categoria, label: r.descripcion?.slice(0, 80),
          confirmado: !!r.confirmado,
          href: `/app/denuncias/${r.id}`,
        });
      }
    }
    // Los puntos de contratos van primero (debajo): las alertas/denuncias quedan clicables encima.
    return [...puntosContratos, ...out];
  }, [showAlertas, showDenuncias, reportes, alertasApi, puntosContratos]);

  const selectedRegion = useMemo(
    () => REGIONES.find((r) => r.id === selectedRegionId) ?? null,
    [selectedRegionId],
  );


  const tickerAlertas = [...(alertasApi.length > 0 ? alertasApi : ALERTAS_MOCK)]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  // Abre el drawer móvil cuando se selecciona una región
  const handleSelectRegion = (id: string | null) => {
    setSelectedRegionId(id);
    setProvinciaActiva(null);
    setMobileDrawerOpen(id !== null);
    setDistrito(null);
    setOcidSel(null);
    setUbigeoSel(null);
    if (id === null) setPanelTab(initialTab);
  };

  return (
    <MapaContratosContext.Provider value={mapaContratos}>
    <div className="space-y-4">

      {/* Marquee de alertas */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-paperSoft py-1 shadow-card">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-paperSoft to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-paperSoft to-transparent" />
        {/* Mismo badge "en vivo" que la landing (page.tsx) -- le faltaba el PulseDot que
            ese sí tiene, pese a ser el mismo tipo de dato (alertas) refrescándose solo. */}
        <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full bg-rust px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-paper">
          <PulseDot color="paper" size={6} />
          en vivo
        </div>
        <Marquee className="[--duration:60s] [--gap:2.5rem] pl-24" pauseOnHover>
          {tickerAlertas.map((a: any) => (
            <div
              key={a.id ?? a.codigo}
              className="flex items-center gap-2 whitespace-nowrap text-xs"
            >
              <span className="rounded bg-amber-soft px-1.5 py-0.5 font-mono text-[10px] text-amber">
                score {a.score}
              </span>
              <span className="font-mono text-mute">{a.codigoconvocatoria}</span>
              <span className="text-ink">·</span>
              <span className="text-mute">{a.region}</span>
              <span className="text-ink">·</span>
              <span className="max-w-[420px] truncate text-ink">{a.objeto}</span>
              <span className="text-ink">·</span>
              <span className="font-mono text-heroViolet">{formatSoles(a.montoSoles)}</span>
            </div>
          ))}
        </Marquee>
      </div>

      {/* Main dashboard */}
      <div className="surface relative overflow-hidden rounded-3xl">
        {/* TOP STRIP */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paperDeep px-4 py-3 sm:px-5">
          {/* Layer toggles — pines de alertas/denuncias */}
          <div className="flex items-center gap-1 rounded-full border border-line bg-paperSoft p-1">
            <button
              onClick={() => setShowAlertas((v) => !v)}
              aria-pressed={showAlertas}
              title={`${showAlertas ? "Ocultar" : "Mostrar"} alertas en el mapa`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showAlertas ? "bg-amber text-paper" : "text-mute hover:bg-paper hover:text-ink",
              )}
            >
              <AlertTriangle size={13} />
              <span className="hidden sm:inline">Alertas</span>
              <span className="font-mono text-[10px] opacity-80">
                {(alertasApi.length > 0 ? alertasApi : ALERTAS_MOCK).length}
              </span>
            </button>
            <button
              onClick={() => setShowDenuncias((v) => !v)}
              aria-pressed={showDenuncias}
              title={`${showDenuncias ? "Ocultar" : "Mostrar"} denuncias en el mapa`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showDenuncias ? "bg-rust text-paper" : "text-mute hover:bg-paper hover:text-ink",
              )}
            >
              <MessageSquareWarning size={13} />
              <span className="hidden sm:inline">Denuncias</span>
              <span className="font-mono text-[10px] opacity-80">{reportes.length}</span>
            </button>
            <button
              onClick={() => setShowContratos((v) => !v)}
              aria-pressed={showContratos}
              title={`${showContratos ? "Ocultar" : "Mostrar"} contratos por zona`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showContratos ? "bg-ink text-paper" : "text-mute hover:bg-paper hover:text-ink",
              )}
            >
              <FileSearch size={13} />
              <span className="hidden sm:inline">Contratos</span>
              {totalContratos > 0 && <span className="font-mono text-[10px] opacity-80">{totalContratos.toLocaleString("es-PE")}</span>}
            </button>
            <button
              onClick={() => setShowFinanciamiento((v) => !v)}
              aria-pressed={showFinanciamiento}
              title={`${showFinanciamiento ? "Ocultar" : "Mostrar"} estado de financiamiento de la auditoría por región`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showFinanciamiento ? "bg-moss text-paper" : "text-mute hover:bg-paper hover:text-ink",
              )}
            >
              <Landmark size={13} />
              <span className="hidden sm:inline">Financiamiento</span>
            </button>
            {perfil && misRegiones.size > 0 && (
              <button
                onClick={() => setShowMisZonas((v) => !v)}
                aria-pressed={showMisZonas}
                title={`${showMisZonas ? "Ocultar" : "Resaltar"} las zonas que sigo`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  showMisZonas ? "bg-amber text-ink" : "text-mute hover:bg-paper hover:text-ink",
                )}
              >
                <Bell size={13} />
                <span className="hidden sm:inline">Mis zonas</span>
                <span className="font-mono text-[10px] opacity-80">{misRegiones.size}</span>
              </button>
            )}
          </div>

          {/* Filtro de mes: acota los CONTRATOS que se cuentan/pintan (no alertas/denuncias, que siempre son recientes). Antes no había ninguna forma de acotar por fecha. */}
          <FiltroMes valor={mesFiltro} onChange={setMesFiltro} />

          {/* Breadcrumb o quick totals */}
          <div className="flex items-center gap-3 text-xs">
            {!selectedRegion ? (
              <div className="hidden gap-4 md:flex" title={alcance ? `Cola financiable hoy: ${alcanceCorto(alcance.procesamiento)}` : undefined}>
                <Stat label="Alertas" value={alertasApi.length} accent="text-amber" />
                <Stat label="Denuncias" value={reportes.length} accent="text-rust" />
                <Stat label="Contratos" value={totalContratos} accent="text-ink" />
                <Stat label="En cola" value={alcance?.colaFinanciable ?? "—"} accent="text-heroViolet" />
                <Stat label="Docs listos" value={alcance?.documentosListos ?? "—"} accent="text-inkSoft" />
              </div>
            ) : (
              <div className="flex items-center gap-2 font-mono text-xs">
                <button
                  onClick={() => handleSelectRegion(null)}
                  className="text-mute hover:text-heroViolet"
                >
                  Perú
                </button>
                <ChevronRight size={12} className="text-mute" />
                <span className="font-semibold text-ink">{selectedRegion.nombre}</span>
                {provinciaActiva && (
                  <>
                    <ChevronRight size={12} className="text-mute" />
                    <span className="text-rust">{provinciaActiva.nombre}</span>
                  </>
                )}
                {distrito && (
                  <>
                    <ChevronRight size={12} className="text-mute" />
                    <button onClick={mapaContratos.limpiarDistrito} className="text-ink hover:text-heroViolet" title="Quitar filtro de distrito">
                      {distrito.nombre || distrito.ubigeo}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* MAP + PANEL */}
        <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px]">
          {/* Map area */}
          <div className="relative" ref={mapRef}>
            <div className="aspect-[480/700] max-h-[680px] w-full overflow-hidden">
              <PeruChoropleth
                metric={metric}
                selectedRegionId={selectedRegionId}
                hoveredRegionId={hoveredRegionId}
                onHoverRegion={setHoveredRegionId}
                onSelectRegion={handleSelectRegion}
                onSelectProvincia={(regionId, p) => {
                  setProvinciaActiva({ regionId, ...p });
                  setMobileDrawerOpen(true);
                }}
                points={points}
                fillOverride={fillFinanciamiento}
                onPointClick={onPointClick}
                onPointHover={(pt) => setHoverPunto(pt?.kind === "contratos" ? pt.ubigeo ?? null : null)}
              />
            </div>

            {/* Back button */}
            {selectedRegion && (
              <button
                onClick={() => handleSelectRegion(null)}
                className="absolute left-3 top-3 z-20 flex animate-fadeIn items-center gap-1.5 rounded-full border border-line bg-paperSoft/95 px-3 py-1.5 text-xs font-medium text-ink backdrop-blur-sm hover:bg-paper sm:left-4 sm:top-4 sm:px-3 sm:py-2"
              >
                <ArrowLeft size={14} />
                <span className="hidden sm:inline">Volver al Perú</span>
                <span className="sm:hidden">Volver</span>
              </button>
            )}

            {/* Metric label */}
            <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-2xl border border-line bg-paperSoft/95 px-3 py-1.5 backdrop-blur-sm sm:right-4 sm:top-4 sm:py-2">
              <div className="text-right text-[9px] font-semibold uppercase tracking-widest text-mute">
                Visualizando
              </div>
              <div className="text-right font-serif text-sm font-bold text-ink">
                {showFinanciamiento ? "Estado de financiamiento" : metricLabel(metric)}
              </div>
              {showContratos && (
                <div className="text-right text-[10px] text-mute">
                  contratos {mesFiltro ? `de ${mesFiltro.etiqueta}` : "· todo el histórico"}
                </div>
              )}
            </div>

            {/* Legend (vista país) */}
            {!selectedRegion && (
              <div className="absolute bottom-3 right-3 z-10 animate-fadeIn space-y-2 rounded-2xl border border-line bg-paperSoft/95 px-3 py-2 backdrop-blur-sm sm:bottom-4 sm:right-4">
                {showFinanciamiento ? (
                  <div>
                    <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute">
                      Auditoría por región
                    </div>
                    <div className="space-y-0.5 text-[9px] text-mute">
                      {(["pendiente", "parcial", "financiada", "procesada", "sin_datos"] as ZonaEstado[]).map((e) => (
                        <div key={e} className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-paperEdge" style={{ background: ESTADO_FILL[e] }} />
                          <span>{ESTADO_LABEL[e]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute">
                      Intensidad
                    </div>
                    <div className="flex items-center gap-1">
                      {["#E8DFC7", "#D9B97A", "#C28840", "#A05A1F", "#7A2E18", "#4A150C"].map(
                        (c) => (
                          <span
                            key={c}
                            className="h-3 w-5 rounded-sm border border-paperEdge"
                            style={{ background: c }}
                          />
                        ),
                      )}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-mute">
                      <span>0</span>
                      <span>más alertas</span>
                    </div>
                  </div>
                )}
                {showContratos && geo.length > 0 && (
                  <div className="border-t border-line pt-2">
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-mute">
                      Contratos por zona
                    </div>
                    <ContratoPinLeyenda />
                  </div>
                )}
                {(showAlertas || showDenuncias) && points.some((p) => p.kind !== "contratos") && (
                  <div className="border-t border-line pt-2">
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-mute">
                      Pines
                    </div>
                    <div className="space-y-0.5 text-[9px] text-mute">
                      {showAlertas && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#7A2E18" }} />
                          <span>Alerta score ≥ 85</span>
                        </div>
                      )}
                      {showAlertas && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#C28840" }} />
                          <span>Alerta 70-84</span>
                        </div>
                      )}
                      {showDenuncias && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#8B2A1E" }} />
                          <span>Denuncia confirmada</span>
                        </div>
                      )}
                      {showDenuncias && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#A05A1F" }} />
                          <span>Denuncia pendiente</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Leyenda compacta de la capa Contratos con región elegida */}
            {selectedRegion && showContratos && geo.length > 0 && (
              <div className="absolute bottom-3 left-3 z-10 hidden animate-fadeIn rounded-2xl border border-line bg-paperSoft/95 px-3 py-2 backdrop-blur-sm sm:bottom-4 sm:left-4 lg:block">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-mute">Contratos por distrito</div>
                <ContratoPinLeyenda />
              </div>
            )}

            {/* Hints */}
            {!selectedRegionId && (
              <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md rounded-2xl border border-line bg-paperSoft/95 px-4 py-2 text-center text-xs text-mute backdrop-blur-sm sm:inset-x-4 sm:bottom-4 lg:hidden">
                Toca un departamento para hacer zoom
              </div>
            )}
            {selectedRegion &&
              selectedRegion.provincias.filter((p) => p.alertas > 0).length > 0 &&
              !provinciaActiva &&
              !mobileDrawerOpen && (
                <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md animate-fadeIn rounded-2xl border border-rust/30 bg-crimson-soft px-4 py-2 text-center text-xs text-rust sm:inset-x-4 sm:bottom-4 lg:hidden">
                  Toca una provincia roja para abrir su detalle
                </div>
              )}
          </div>

          {/* DESKTOP SIDEBAR (lg+) */}
          <aside className="hidden border-l border-line lg:block">
            <RegionDetailPanel
              region={selectedRegion}
              provinciaActiva={provinciaActiva}
              onClose={() => handleSelectRegion(null)}
              onClearProvincia={() => setProvinciaActiva(null)}
              alertasApi={alertasApi}
              reportes={reportes}
              initialTab={panelTab}
            />
          </aside>

          {/* MOBILE DRAWER (< lg) */}
          {selectedRegion && (
            <div
              className={cn(
                "fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 lg:hidden",
                mobileDrawerOpen ? "translate-y-0" : "translate-y-[calc(100%-58px)]",
              )}
            >
              <div
                className="rounded-t-3xl border-t border-line bg-paperSoft shadow-paper"
                role="region"
                aria-label={`Panel de ${selectedRegion.nombre}`}
                onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null; }}
                onTouchEnd={(e) => {
                  const y0 = touchY.current; const y1 = e.changedTouches[0]?.clientY;
                  touchY.current = null;
                  if (y0 == null || y1 == null) return;
                  const dy = y1 - y0;
                  if (dy < -40) setMobileDrawerOpen(true);
                  else if (dy > 40 && (e.target as HTMLElement).closest("[data-asa]")) setMobileDrawerOpen(false);
                }}
              >
                {/* Asa: toca o desliza para abrir/cerrar */}
                <button
                  data-asa
                  onClick={() => setMobileDrawerOpen((v) => !v)}
                  aria-expanded={mobileDrawerOpen}
                  aria-controls="panel-zona-movil"
                  aria-label={mobileDrawerOpen ? "Contraer panel de la zona" : "Expandir panel de la zona"}
                  className="flex w-full items-center justify-between gap-3 border-b border-line bg-paperDeep px-5 py-3"
                >
                  <div className="flex items-center gap-2 text-left">
                    <div className="h-1 w-10 rounded-full bg-line" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-heroViolet">
                      {selectedRegion.nombre}
                    </div>
                    <div className="text-xs text-mute">
                      {(() => {
                        // cifras reales (no las de REGIONES mock): cola financiable y alertas publicadas de la región
                        const z = zonas?.find((x) => UBIGEO_REGION[x.ubigeo] === selectedRegion.id);
                        const nAl = alertasApi.filter((a) => belongsToRegion(a, selectedRegion.id)).length;
                        return `${z ? `${z.totalCola.toLocaleString("es-PE")} en cola · ${z.financiados} financiados · ` : ""}${nAl} alertas`;
                      })()}
                    </div>
                  </div>
                  {mobileDrawerOpen ? (
                    <ChevronDown size={18} className="text-mute" />
                  ) : (
                    <ChevronUp size={18} className="text-mute" />
                  )}
                </button>
                <div id="panel-zona-movil" className="max-h-[72vh] overflow-y-auto">
                  <RegionDetailPanel
                    region={selectedRegion}
                    provinciaActiva={provinciaActiva}
                    onClose={() => handleSelectRegion(null)}
                    onClearProvincia={() => setProvinciaActiva(null)}
                    alertasApi={alertasApi}
                    reportes={reportes}
                    initialTab={panelTab}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </MapaContratosContext.Provider>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase tracking-widest text-mute">{label}</div>
      <div className={"font-mono text-sm font-semibold " + accent}>
        {typeof value === "number" ? value.toLocaleString("es-PE") : value}
      </div>
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="flex h-[680px] items-center justify-center bg-paperDeep">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-heroViolet/30 border-t-heroViolet" />
        <p className="mt-3 text-sm text-mute">Cargando mapa…</p>
      </div>
    </div>
  );
}
