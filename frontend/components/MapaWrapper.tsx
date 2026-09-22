"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useCuenta } from "@/lib/cuentas";
import { REGIONES } from "@/lib/peru-data";
import { getReportes, getAlertas } from "@/lib/api-client";
import { getZonas, getAlcance, alcanceCorto, type Alcance, type Zona } from "@/lib/financiamiento";
import { getContratosGeo, type ContratoResumen, type ContratoZona } from "@/lib/contratos";
import { nivelDeScore, severidadDeScore, type NivelSeveridad } from "@/lib/severidad";
import { coordsForRegionWithJitter } from "@/lib/region-coords";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { MapaContratosContext, type MapaContratos } from "./contratos/ContratosLista";
import { colorPorEstado, radioPorTotal } from "./contratos/ContratoPin";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { REGION_UBIGEO, UBIGEO_REGION } from "./mapa/region-match";
import { type RangoMes } from "./mapa/FiltroMes";
import { BarraMapa } from "./mapa/BarraMapa";
import { FichaRegion } from "./mapa/FichaRegion";
import { SenalesRecientes } from "./mapa/SenalesRecientes";
import { construirEscala, formatoSoles, medidaPorId, type MedidaId } from "./mapa/escala";
import type { ZonaTab } from "./mapa/ZonaHubPanel";
import { cn } from "@/lib/utils";
import type { MapPoint, ZonaPintada } from "./PeruChoropleth";

const PeruChoropleth = dynamic(() => import("./PeruChoropleth").then((m) => m.PeruChoropleth), {
  ssr: false,
  loading: () => <MapaEsqueleto />,
});

const enteros = (n: number) => n.toLocaleString("es-PE");

/** Render de la severidad en el SVG. La clasificación sigue siendo de `lib/severidad`. */
const FILL_SEVERIDAD: Record<NivelSeveridad, string> = {
  alta: "fill-rust",
  media: "fill-amber",
  baja: "fill-moss",
  sin_analizar: "fill-mute",
};
const RADIO_SEVERIDAD: Record<NivelSeveridad, number> = { alta: 4.2, media: 3.5, baja: 3, sin_analizar: 2.8 };

/** Zona de contratos vacía: sirve para decir "0" sin inventar una fila. */
const CERO: Pick<ContratoZona, "total" | "enCola" | "procesados" | "conSenales" | "montoPen" | "documentosListos"> = {
  total: 0,
  enCola: 0,
  procesados: 0,
  conSenales: 0,
  montoPen: 0,
  documentosListos: 0,
};

export function MapaWrapper({
  initialRegionId = null,
  initialTab,
}: {
  /** Región preseleccionada (p. ej. desde `/app/mapa?region=ancash`). */
  initialRegionId?: string | null;
  /** Pestaña inicial del panel de zona. */
  initialTab?: ZonaTab;
} = {}) {
  // ─── Estado de navegación ────────────────────────────────────────────────
  const [medida, setMedida] = useState<MedidaId>("monto");
  const [regionUb, setRegionUb] = useState<string | null>(
    (initialRegionId && REGION_UBIGEO[initialRegionId]) || null,
  );
  /** Provincia (4 díg.) o distrito (6 díg.) elegido dentro del departamento abierto. */
  const [zonaSel, setZonaSel] = useState<{ ubigeo: string; nombre: string } | null>(null);
  const [activa, setActiva] = useState<{ ubigeo: string; nombre: string; nivel: "departamento" | "provincia" } | null>(null);
  const [ancla, setAncla] = useState<DOMRect | null>(null);
  const [mes, setMes] = useState<RangoMes | null>(null);
  const [panelTab, setPanelTab] = useState<ZonaTab | undefined>(initialTab);
  const [drawerAbierto, setDrawerAbierto] = useState(false);
  const [ocidSel, setOcidSel] = useState<string | null>(null);
  const [hoverUbigeo, setHoverUbigeo] = useState<string | null>(null);
  const [hoverPunto, setHoverPunto] = useState<string | null>(null);

  // ─── Capas ───────────────────────────────────────────────────────────────
  const [verSenales, setVerSenales] = useState(true);
  const [verDenuncias, setVerDenuncias] = useState(true);
  const [verMisZonas, setVerMisZonas] = useState(false);

  // ─── Datos (null = todavía no llegó · [] = llegó vacío) ──────────────────
  const [geoPais, setGeoPais] = useState<ContratoZona[] | null>(null);
  const [geoProv, setGeoProv] = useState<ContratoZona[] | null>(null);
  const [geoDist, setGeoDist] = useState<ContratoZona[] | null>(null);
  const [zonas, setZonas] = useState<Zona[] | null>(null);
  const [alcance, setAlcance] = useState<Alcance | null>(null);
  const [alertas, setAlertas] = useState<any[] | null>(null);
  const [reportes, setReportes] = useState<any[] | null>(null);

  // Si una fuente no responde, se DICE. Nunca se rellena con otra cosa.
  const [falloGeo, setFalloGeo] = useState(false);
  const [falloSenales, setFalloSenales] = useState(false);
  const [falloDenuncias, setFalloDenuncias] = useState(false);
  const [intento, setIntento] = useState(0);
  const reintentoRef = useRef<number | null>(null);

  const reintentar = useCallback(() => {
    if (reintentoRef.current != null) return;
    reintentoRef.current = window.setTimeout(() => {
      reintentoRef.current = null;
      setIntento((i) => i + 1);
    }, 12000);
  }, []);
  useEffect(
    () => () => {
      if (reintentoRef.current != null) window.clearTimeout(reintentoRef.current);
    },
    [],
  );

  const { perfil } = useCuenta();
  const misRegiones = useMemo(() => {
    const out = new Set<string>();
    for (const u of perfil?.zonasSeguidas ?? []) out.add(u.slice(0, 2));
    return out;
  }, [perfil]);

  const geoCache = useRef<Map<string, ContratoZona[]>>(new Map());
  const pedirGeo = useCallback(
    async (nivel: "departamento" | "provincia" | "distrito", ubigeo?: string, desde?: string, hasta?: string) => {
      const key = `${nivel}|${ubigeo ?? ""}|${desde ?? ""}`;
      const cached = geoCache.current.get(key);
      if (cached) return cached;
      const d = await getContratosGeo({ nivel, ubigeo, desde, hasta });
      if (d) geoCache.current.set(key, d);
      return d;
    },
    [],
  );

  // Señales, denuncias y alcance
  useEffect(() => {
    let vivo = true;
    getAlertas({ limit: 200 })
      .then((d) => {
        if (!vivo) return;
        setAlertas(d as any[]);
        setFalloSenales(false);
      })
      .catch(() => {
        if (!vivo) return;
        setAlertas([]);
        setFalloSenales(true);
        reintentar();
      });
    getReportes({ limit: 200 })
      .then((d) => {
        if (!vivo) return;
        setReportes(d as any[]);
        setFalloDenuncias(false);
      })
      .catch(() => {
        if (!vivo) return;
        setReportes([]);
        setFalloDenuncias(true);
        reintentar();
      });
    getAlcance().then((a) => vivo && setAlcance(a));
    getZonas("departamento").then((z) => vivo && setZonas(z ?? []));
    return () => {
      vivo = false;
    };
  }, [intento, reintentar]);

  // Coropleto del país (siempre) — es la fuente del color de los departamentos.
  useEffect(() => {
    let vivo = true;
    pedirGeo("departamento", undefined, mes?.desde, mes?.hasta).then((d) => {
      if (!vivo) return;
      if (d) {
        setGeoPais(d);
        setFalloGeo(false);
      } else {
        setGeoPais([]);
        setFalloGeo(true);
        reintentar();
      }
    });
    return () => {
      vivo = false;
    };
  }, [mes, intento, pedirGeo, reintentar]);

  // Con un departamento abierto: sus provincias (relleno) y sus distritos (puntos).
  useEffect(() => {
    if (!regionUb) {
      setGeoProv(null);
      setGeoDist(null);
      return;
    }
    let vivo = true;
    setGeoProv(null);
    setGeoDist(null);
    const recibir = (set: (v: ContratoZona[]) => void) => (d: ContratoZona[] | null) => {
      if (!vivo) return;
      set(d ?? []);
      if (!d) {
        setFalloGeo(true);
        reintentar();
      }
    };
    pedirGeo("provincia", regionUb, mes?.desde, mes?.hasta).then(recibir(setGeoProv));
    pedirGeo("distrito", regionUb, mes?.desde, mes?.hasta).then(recibir(setGeoDist));
    return () => {
      vivo = false;
    };
  }, [regionUb, mes, intento, pedirGeo, reintentar]);

  // ─── Estado ↔ URL (sin navegar) ──────────────────────────────────────────
  const urlLeida = useRef(false);
  useEffect(() => {
    if (urlLeida.current) return;
    urlLeida.current = true;
    const sp = new URLSearchParams(window.location.search);
    const u = sp.get("ubigeo");
    const o = sp.get("ocid");
    if (u && /^\d{4}(\d{2})?$/.test(u)) {
      setZonaSel({ ubigeo: u, nombre: "" });
      setRegionUb((r) => r ?? u.slice(0, 2));
      setPanelTab("cola");
    }
    if (o && /^[\w.-]{1,64}$/.test(o)) setOcidSel(o);
  }, []);

  useEffect(() => {
    if (!urlLeida.current) return;
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null | undefined) => (v ? sp.set(k, v) : sp.delete(k));
    set("region", regionUb ? UBIGEO_REGION[regionUb] : null);
    set("tab", regionUb ? panelTab : null);
    set("ubigeo", regionUb ? zonaSel?.ubigeo : null);
    set("ocid", regionUb ? ocidSel : null);
    const qs = sp.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [regionUb, panelTab, zonaSel, ocidSel]);

  // Nombre de la zona cuando llegó sólo el ubigeo por URL.
  useEffect(() => {
    if (!zonaSel || zonaSel.nombre) return;
    const fuente = zonaSel.ubigeo.length === 4 ? geoProv : geoDist;
    const z = fuente?.find((g) => g.ubigeo === zonaSel.ubigeo);
    if (z) setZonaSel({ ubigeo: z.ubigeo, nombre: z.nombre });
  }, [geoProv, geoDist, zonaSel]);

  // ─── Escalas y relleno ───────────────────────────────────────────────────
  const m = medidaPorId(medida);
  const cargandoPais = geoPais === null;
  const cargandoProv = regionUb != null && geoProv === null;

  const escalaPais = useMemo(() => construirEscala((geoPais ?? []).map(m.valor)), [geoPais, m]);
  const escalaProv = useMemo(() => construirEscala((geoProv ?? []).map(m.valor)), [geoProv, m]);
  const escalaActiva = regionUb ? escalaProv : escalaPais;

  const zonaPorUbigeo = useMemo(() => {
    const map = new Map<string, ContratoZona>();
    for (const z of geoPais ?? []) map.set(z.ubigeo, z);
    for (const z of geoProv ?? []) map.set(z.ubigeo, z);
    for (const z of geoDist ?? []) map.set(z.ubigeo, z);
    return map;
  }, [geoPais, geoProv, geoDist]);

  const financiamientoPorUbigeo = useMemo(() => {
    const map = new Map<string, Zona>();
    for (const z of zonas ?? []) map.set(z.ubigeo, z);
    return map;
  }, [zonas]);

  const resumenDe = useCallback(
    (z: ContratoZona | undefined, sinDato: boolean) => {
      if (sinDato) return "sin dato de la API";
      const c = z ?? (CERO as ContratoZona);
      return `${enteros(c.total)} contratos ingresados, ${formatoSoles(c.montoPen)} contratados, ${enteros(
        c.enCola,
      )} en cola, ${enteros(c.procesados)} leídos, ${enteros(c.conSenales)} con señal`;
    },
    [],
  );

  const regiones = useMemo(() => {
    const out: Record<string, ZonaPintada> = {};
    const sinDato = cargandoPais || falloGeo;
    for (const ub of Object.values(REGION_UBIGEO)) {
      const z = geoPais?.find((x) => x.ubigeo === ub);
      out[ub] = {
        color: escalaPais.color(z ? m.valor(z) : 0),
        sinDato,
        resumen: resumenDe(z, sinDato),
        destacada: verMisZonas && misRegiones.has(ub),
      };
    }
    return out;
  }, [geoPais, escalaPais, m, cargandoPais, falloGeo, verMisZonas, misRegiones, resumenDe]);

  const provincias = useMemo(() => {
    if (!regionUb) return undefined;
    const out: Record<string, ZonaPintada> = {};
    const sinDato = cargandoProv || falloGeo;
    for (const z of geoProv ?? []) {
      out[z.ubigeo] = { color: escalaProv.color(m.valor(z)), sinDato, resumen: resumenDe(z, sinDato) };
    }
    return out;
  }, [regionUb, geoProv, escalaProv, m, cargandoProv, falloGeo, resumenDe]);

  // Una provincia que /contratos/geo no devolvió no tiene contratos ingresados:
  // eso es un cero, y un cero es un dato. Sólo se raya como "sin dato" mientras
  // la consulta está en vuelo o falló.
  const provinciaPorDefecto = useMemo<ZonaPintada | undefined>(() => {
    if (!regionUb) return undefined;
    const sinDato = cargandoProv || falloGeo;
    return {
      color: escalaProv.color(0),
      sinDato,
      resumen: sinDato ? "sin dato de la API" : "sin contratos ingresados",
    };
  }, [regionUb, escalaProv, cargandoProv, falloGeo]);

  // ─── Puntos ──────────────────────────────────────────────────────────────
  const puntosDistrito = useMemo<MapPoint[]>(() => {
    if (!regionUb || !geoDist?.length) return [];
    const max = Math.max(...geoDist.map((z) => z.total), 1);
    return geoDist.map((z) => ({
      id: `c-${z.ubigeo}`,
      kind: "contratos" as const,
      lat: z.lat,
      lon: z.lon,
      label: z.nombre,
      ubigeo: z.ubigeo,
      total: z.total,
      r: radioPorTotal(z.total, max),
      color: colorPorEstado(z),
      selected: zonaSel?.ubigeo === z.ubigeo || hoverUbigeo === z.ubigeo,
      hovered: hoverPunto === z.ubigeo,
    }));
  }, [regionUb, geoDist, zonaSel, hoverUbigeo, hoverPunto]);

  const puntos = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (verSenales) {
      for (const a of alertas ?? []) {
        let lat: number | null = typeof a.lat === "number" ? a.lat : null;
        let lon: number | null = typeof a.lon === "number" ? a.lon : null;
        if (lat == null || lon == null) {
          const d = coordsForRegionWithJitter(a.region, a.id || a.codigo || "");
          if (d) {
            lat = d.lat;
            lon = d.lon;
          }
        }
        if (lat == null || lon == null) continue;
        const nivel = nivelDeScore(a.score);
        out.push({
          id: `a-${a.id || a.codigo}`,
          kind: "alerta",
          lat,
          lon,
          score: a.score,
          label: a.objeto?.slice(0, 80),
          // La palabra de severidad viaja con el punto: el color solo nunca basta.
          titulo: `${severidadDeScore(a.score).etiqueta} · score ${a.score ?? "—"} · ${a.region ?? ""} · ${a.objeto ?? ""}`.trim(),
          colorClase: FILL_SEVERIDAD[nivel],
          r: RADIO_SEVERIDAD[nivel],
          href: `/app/convocatoria/${a.codigoconvocatoria || a.codigo?.replace("OECE-", "") || a.id}`,
        });
      }
    }
    if (verDenuncias) {
      for (const r of reportes ?? []) {
        let lat: number | null = typeof r.lat === "number" ? r.lat : null;
        let lon: number | null = typeof r.lon === "number" ? r.lon : null;
        if (lat == null || lon == null) {
          const d = coordsForRegionWithJitter(r.region, r.id);
          if (d) {
            lat = d.lat;
            lon = d.lon;
          }
        }
        if (lat == null || lon == null) continue;
        out.push({
          id: `r-${r.id}`,
          kind: "reporte",
          lat,
          lon,
          categoria: r.categoria,
          label: r.descripcion?.slice(0, 80),
          titulo: `Denuncia ciudadana ${r.confirmado ? "confirmada" : "en validación"} · ${r.categoria ?? ""} · ${r.descripcion ?? ""}`.trim(),
          colorClase: r.confirmado ? "fill-rust" : "fill-clay",
          r: 3.4,
          confirmado: !!r.confirmado,
          href: `/app/denuncias/${r.id}`,
        });
      }
    }
    // Los distritos van debajo: las señales y denuncias quedan clicables encima.
    return [...puntosDistrito, ...out];
  }, [verSenales, verDenuncias, alertas, reportes, puntosDistrito]);

  // ─── Acciones ────────────────────────────────────────────────────────────
  const cerrarFicha = useCallback(() => {
    setActiva(null);
    setAncla(null);
  }, []);

  const elegirRegion = useCallback(
    (ub: string | null) => {
      cerrarFicha();
      setRegionUb(ub);
      setZonaSel(null);
      setOcidSel(null);
      setHoverUbigeo(null);
      setDrawerAbierto(ub !== null);
      setPanelTab(ub === null ? initialTab : "resumen");
    },
    [initialTab, cerrarFicha],
  );

  const elegirZona = useCallback((ubigeo: string, nombre: string) => {
    cerrarFicha();
    setZonaSel((z) => (z?.ubigeo === ubigeo ? null : { ubigeo, nombre }));
    setOcidSel(null);
    setPanelTab("cola");
    setDrawerAbierto(true);
  }, [cerrarFicha]);

  const mapRef = useRef<HTMLDivElement>(null);
  const seleccionarContrato = useCallback((c: ContratoResumen | null) => {
    setOcidSel(c?.ocid ?? null);
    if (c && typeof window !== "undefined" && window.innerWidth < 1024) {
      mapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const onPuntoClick = useCallback(
    (pt: MapPoint) => {
      if (pt.kind !== "contratos" || !pt.ubigeo) return;
      elegirZona(pt.ubigeo, pt.label ?? "");
    },
    [elegirZona],
  );

  const mapaContratos = useMemo<MapaContratos>(
    () => ({
      activa: regionUb !== null,
      distritoUbigeo: zonaSel?.ubigeo ?? null,
      distritoNombre: zonaSel?.nombre || null,
      ocidSeleccionado: ocidSel,
      seleccionar: seleccionarContrato,
      hover: (c) => setHoverUbigeo(c?.ubigeo ?? null),
      limpiarDistrito: () => {
        setZonaSel(null);
        setOcidSel(null);
      },
    }),
    [regionUb, zonaSel, ocidSel, seleccionarContrato],
  );

  // ─── Encabezado que refleja el estado ────────────────────────────────────
  const region = regionUb ? REGIONES.find((r) => r.id === UBIGEO_REGION[regionUb]) ?? null : null;
  const zPais = regionUb ? zonaPorUbigeo.get(regionUb) : undefined;
  const fPais = regionUb ? financiamientoPorUbigeo.get(regionUb) : undefined;
  const totalPais = useMemo(
    () => (geoPais ?? []).reduce((acc, z) => ({ total: acc.total + z.total, leidos: acc.leidos + z.procesados }), { total: 0, leidos: 0 }),
    [geoPais],
  );

  const sinConexion = [
    falloGeo ? "los contratos" : null,
    falloSenales ? "las señales" : null,
    falloDenuncias ? "las denuncias" : null,
  ].filter(Boolean) as string[];

  const ambito = regionUb
    ? geoProv
      ? `las ${geoProv.length} provincias de ${region?.nombre ?? "la región"}`
      : `las provincias de ${region?.nombre ?? "la región"}`
    : geoPais && geoPais.length > 0
      ? `los ${geoPais.length} departamentos`
      : "los departamentos del país";

  // ─── Ficha flotante anclada a la zona ────────────────────────────────────
  const zonaActiva = activa ? zonaPorUbigeo.get(activa.ubigeo) : undefined;
  const finActiva = activa && activa.nivel === "departamento" ? financiamientoPorUbigeo.get(activa.ubigeo) : undefined;
  const fichaFilas = useMemo(() => {
    if (!activa) return [];
    const z = zonaActiva ?? (CERO as ContratoZona);
    const filas = [
      { etiqueta: "En cola", valor: enteros(z.enCola), de: `${enteros(z.total)} ingresados`, tono: "text-ink" },
      {
        etiqueta: "Financiados",
        valor: enteros(finActiva?.financiados ?? 0),
        de: finActiva ? `${enteros(finActiva.totalCola)} en cola` : `${enteros(z.enCola)} en cola`,
        tono: "text-ink",
      },
      { etiqueta: "Con señal", valor: enteros(z.conSenales), de: `${enteros(z.procesados)} leídos`, tono: "text-rust" },
    ];
    return activa.nivel === "provincia" ? filas.filter((f) => f.etiqueta !== "Financiados") : filas;
  }, [activa, zonaActiva, finActiva]);

  return (
    <MapaContratosContext.Provider value={mapaContratos}>
      <div className="space-y-5">
        <PageHeader
          title={region ? region.nombre : "Elige tu región"}
          subtitle={
            region
              ? cargandoPais || !zPais
                ? `Cargando los contratos de ${region.nombre}. Toca una provincia para acotar la lista, o un punto para ver un distrito.`
                : `${enteros(zPais.enCola)} de ${enteros(zPais.total)} contratos de ${region.nombre} están en cola de lectura (${alcanceCorto(alcance?.procesamiento)}). Toca una provincia para acotar la lista, o un punto para ver un distrito.`
              : "Cada departamento tiene contratos públicos esperando ser leídos. Toca uno para ver su cola de auditoría, las señales halladas, quién contrata y qué denuncian los vecinos — y financiar o denunciar desde ahí."
          }
          contexto={
            cargandoPais ? (
              <span className="inline-block h-4 w-44 animate-pulse rounded bg-paperDeep" aria-hidden />
            ) : region ? (
              <span className="block text-right font-mono tabular-nums">
                <span className="block">
                  {enteros(fPais?.financiados ?? 0)} financiados de {enteros(zPais?.enCola ?? 0)} en cola
                </span>
                <span className="block">
                  {enteros(zPais?.conSenales ?? 0)} con señal de {enteros(zPais?.procesados ?? 0)} leídos
                </span>
              </span>
            ) : (
              <span className="font-mono tabular-nums">
                {enteros(totalPais.leidos)} leídos de {enteros(totalPais.total)} contratos ingresados
              </span>
            )
          }
          actions={
            region ? (
              <button
                type="button"
                onClick={() => elegirRegion(null)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep"
              >
                <ArrowLeft size={14} aria-hidden /> Volver al Perú
              </button>
            ) : undefined
          }
        />

        <SenalesRecientes alertas={alertas ?? []} fallo={falloSenales} />

        {/* Sin `.surface`: ese atajo traía borde + paperSoft + sombra. El borde se
            va (lo reemplaza el salto de tono contra el suelo teñido) y el fondo
            pasa a blanco. */}
        <div className="relative overflow-hidden rounded-3xl bg-paper shadow-card">
          {/* Una sola franja de control hundida: filtros, leyenda y migaja son
              la misma cosa —"qué estoy viendo y cómo lo filtro"— y el usuario no
              necesita distinguirlas entre sí. Antes eran dos contenedores con
              fondo propio separados por reglas. El tono hundido y el `shadow-inset`
              las despegan del lienzo blanco sin una sola línea. */}
          <div className="bg-paperSoft shadow-inset">
          <BarraMapa
            medida={medida}
            onMedida={setMedida}
            escala={escalaActiva}
            medidaActual={m}
            ambito={ambito}
            conPines={regionUb !== null}
            cargando={regionUb ? cargandoProv : cargandoPais}
            mes={mes}
            onMes={setMes}
            alertas={verSenales}
            onAlertas={() => setVerSenales((v) => !v)}
            nAlertas={(alertas ?? []).length}
            denuncias={verDenuncias}
            onDenuncias={() => setVerDenuncias((v) => !v)}
            nDenuncias={(reportes ?? []).length}
            misZonas={verMisZonas}
            onMisZonas={() => setVerMisZonas((v) => !v)}
            nMisZonas={misRegiones.size}
            sinConexion={sinConexion}
          />

          {/* Rastro de navegación: dónde estoy y cómo vuelvo */}
          <nav
            aria-label="Dónde estás en el mapa"
            // La migaja tenía fondo propio (paperDeep) y borde inferior, emparedada
            // entre dos superficies idénticas: tres líneas de 1px del mismo color
            // en los primeros 137px del bloque. La migaja es contexto de lo que la
            // barra controla —se llevan bien—, así que las separa el espacio, no
            // una regla. Queda una sola franja de control hundida.
            className="flex items-center gap-1.5 px-4 pb-3 font-mono text-[11px] sm:px-5"
          >
            <button
              type="button"
              onClick={() => elegirRegion(null)}
              disabled={!regionUb}
              className="text-inkSoft transition-colors duration-rapido hover:text-heroViolet disabled:cursor-default disabled:text-ink disabled:hover:text-ink"
            >
              Perú
            </button>
            {region && (
              <>
                <ChevronRight size={12} className="text-mute" aria-hidden />
                <button
                  type="button"
                  onClick={() => setZonaSel(null)}
                  disabled={!zonaSel}
                  className="font-semibold text-ink transition-colors duration-rapido hover:text-heroViolet disabled:cursor-default disabled:hover:text-ink"
                >
                  {region.nombre}
                </button>
              </>
            )}
            {zonaSel && (
              <>
                <ChevronRight size={12} className="text-mute" aria-hidden />
                <span className="text-ink">{zonaSel.nombre || zonaSel.ubigeo}</span>
                <button
                  type="button"
                  onClick={() => setZonaSel(null)}
                  className="ml-1 rounded px-1 text-inkSoft transition-colors duration-rapido hover:text-rust"
                >
                  quitar
                </button>
              </>
            )}
          </nav>
          </div>

          <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px]">
            <div className="relative" ref={mapRef}>
              {/* `aspect-[480/700]` estaba muerta: a 632 px de ancho pedía 921 px
                  de alto y `max-h` lo cortaba a 680, así que la altura la fijaba
                  `max-h` y la clase de aspecto sólo servía para que el SVG
                  quedara en letterbox. El lienzo lo pinta ESTE contenedor, no un
                  rect dentro del SVG: así el área sobrante del encuadre y el
                  área dibujada son el mismo color y la costura vertical que se
                  veía a los costados no puede existir. */}
              <div className="h-[680px] w-full overflow-hidden bg-paper">
                <PeruChoropleth
                  regiones={regiones}
                  provincias={provincias}
                  provinciaPorDefecto={provinciaPorDefecto}
                  seleccion={regionUb}
                  zonaSel={zonaSel?.ubigeo ?? null}
                  activaUbigeo={activa?.ubigeo ?? null}
                  onZonaActiva={(z, rect) => {
                    setActiva(z);
                    setAncla(rect);
                  }}
                  onSelectRegion={elegirRegion}
                  onSelectProvincia={elegirZona}
                  points={puntos}
                  onPointClick={onPuntoClick}
                  onPointHover={(pt) => setHoverPunto(pt?.kind === "contratos" ? pt.ubigeo ?? null : null)}
                />
              </div>

              {!regionUb && (
                <p className="pointer-events-none absolute inset-x-4 bottom-3 text-center text-[11px] text-mute lg:hidden">
                  Toca un departamento para abrirlo
                </p>
              )}
            </div>

            {/* Panel de zona (escritorio) */}
            {/* Era un border-l de 890px de alto sobre un lienzo de 680: los últimos
                210px separaban el panel de la nada. Y el tono a ambos lados era
                idéntico, así que la línea cargaba el 100% de la separación. El
                panel no es vecino del lienzo, es una capa que se apoya encima:
                eso lo dice una sombra direccional, no una regla. */}
            <aside className="relative z-mapa hidden shadow-drawer lg:block">
              <RegionDetailPanel
                region={region}
                onClose={() => elegirRegion(null)}
                alertasApi={alertas ?? []}
                reportes={reportes ?? []}
                totalIngresados={zPais?.total ?? null}
                initialTab={panelTab}
              />
            </aside>

            {/* Panel de zona (móvil) */}
            {region && (
              <div
                className={cn(
                  "fixed inset-x-0 bottom-0 z-panel transition-transform duration-panel ease-salida lg:hidden",
                  drawerAbierto ? "translate-y-0" : "translate-y-[calc(100%-62px)]",
                )}
              >
                <div className="rounded-t-3xl border-t border-line bg-paperSoft shadow-drawer" role="region" aria-label={`Panel de ${region.nombre}`}>
                  <button
                    type="button"
                    onClick={() => setDrawerAbierto((v) => !v)}
                    aria-expanded={drawerAbierto}
                    aria-controls="panel-zona-movil"
                    className="flex w-full items-center justify-between gap-3 border-b border-line bg-paperDeep px-5 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-serif text-base font-bold leading-tight text-ink">{region.nombre}</span>
                      <span className="block text-[11px] text-inkSoft">
                        {enteros(zPais?.enCola ?? 0)} de {enteros(zPais?.total ?? 0)} en cola ·{" "}
                        {enteros(fPais?.financiados ?? 0)} de {enteros(zPais?.enCola ?? 0)} financiados ·{" "}
                        {enteros(zPais?.conSenales ?? 0)} de {enteros(zPais?.procesados ?? 0)} con señal
                      </span>
                    </span>
                    {drawerAbierto ? (
                      <ChevronDown size={18} className="shrink-0 text-mute" aria-hidden />
                    ) : (
                      <ChevronUp size={18} className="shrink-0 text-mute" aria-hidden />
                    )}
                  </button>
                  <div id="panel-zona-movil" className="max-h-[72vh] overflow-y-auto">
                    <RegionDetailPanel
                      region={region}
                      onClose={() => elegirRegion(null)}
                      alertasApi={alertas ?? []}
                      reportes={reportes ?? []}
                      totalIngresados={zPais?.total ?? null}
                      initialTab={panelTab}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Ficha contextual: top layer, así el overflow-hidden del lienzo no la recorta */}
        <FichaRegion
          abierto={!!activa && !!ancla}
          ancla={ancla}
          titulo={activa?.nombre ?? ""}
          contexto={
            activa
              ? activa.nivel === "provincia"
                ? `Provincia · ${m.sustantivo(zonaActiva ? m.valor(zonaActiva) : 0)}`
                : `Departamento · ${m.sustantivo(zonaActiva ? m.valor(zonaActiva) : 0)}`
              : undefined
          }
          filas={fichaFilas}
          pie={
            activa
              ? activa.nivel === "departamento"
                ? "Enter abre la región"
                : "Enter acota la lista a esta provincia"
              : undefined
          }
        />
      </div>
    </MapaContratosContext.Provider>
  );
}

function MapaEsqueleto() {
  return (
    <div className="flex h-[680px] w-full items-center justify-center bg-paperDeep">
      <div className="h-[86%] w-[52%] animate-pulse rounded-[45%_55%_48%_52%] bg-paperEdge" />
      <span className="sr-only">Cargando el mapa del Perú</span>
    </div>
  );
}
