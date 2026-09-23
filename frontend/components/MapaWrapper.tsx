"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useCuenta } from "@/lib/cuentas";
import { REGIONES } from "@/lib/peru-data";
import { getReportes, getAlertas } from "@/lib/api-client";
import { getZonas, getEstadoGlobal, type EstadoGlobal, type Zona } from "@/lib/financiamiento";
import { getContratosGeo, type ContratoResumen, type ContratoZona } from "@/lib/contratos";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { nivelDeScore, severidadDeScore, type NivelSeveridad } from "@/lib/severidad";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { MapaContratosContext, type MapaContratos } from "./contratos/ContratosLista";
import { colorPorEstado, radioPorTotal } from "./contratos/ContratoPin";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { REGION_UBIGEO, UBIGEO_REGION, nombreDepartamento } from "./mapa/region-match";
import { PROVINCIA_NOMBRE } from "./mapa/provincias";
import { alertaHref, esSenal, zonaDeAlerta } from "./mapa/senales";
import { estaConfirmada, tieneUbicacion } from "@/lib/denuncias-meta";
import { type RangoMes } from "./mapa/FiltroMes";
import { BarraMapa } from "./mapa/BarraMapa";
import { FichaRegion } from "./mapa/FichaRegion";
import { NumeroVivo } from "./mapa/NumeroVivo";
import { SenalesRecientes } from "./mapa/SenalesRecientes";
import { construirEscala, formatoSoles, medidaPorId, pasaFiltro, type FiltroZona, type MedidaId } from "./mapa/escala";
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

/** Contratos financiados que ahora mismo se están leyendo o esperan su lectura, por departamento. */
interface EnCurso {
  leyendo: number;
  enCola: number;
  esperandoDocs: number;
}

function fraseEnCurso(e: EnCurso): string {
  const partes: string[] = [];
  if (e.leyendo > 0) partes.push(`${enteros(e.leyendo)} leyéndose ahora`);
  if (e.enCola > 0) partes.push(`${enteros(e.enCola)} en turno para leerse`);
  if (e.esperandoDocs > 0) partes.push(`${enteros(e.esperandoDocs)} esperando sus documentos`);
  const total = e.leyendo + e.enCola + e.esperandoDocs;
  return `${total === 1 ? "1 contrato financiado" : `${enteros(total)} contratos financiados`}: ${partes.join(", ")}`;
}

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
  const [filtro, setFiltro] = useState<FiltroZona>("todas");
  const [regionUb, setRegionUb] = useState<string | null>(
    (initialRegionId && REGION_UBIGEO[initialRegionId]) || null,
  );
  /** Provincia (4 díg.) o distrito (6 díg.) elegido dentro del departamento abierto. */
  const [zonaSel, setZonaSel] = useState<{ ubigeo: string; nombre: string } | null>(null);
  const [activa, setActiva] = useState<{ ubigeo: string; nombre: string; nivel: "departamento" | "provincia" } | null>(null);
  const [ancla, setAncla] = useState<DOMRect | null>(null);
  const [mes, setMes] = useState<RangoMes | null>(null);
  /** La pestaña del panel vive acá (no en el panel) para poder escribirla en `?tab=`. */
  const [panelTab, setPanelTab] = useState<ZonaTab>(initialTab ?? "resumen");
  const [drawerAbierto, setDrawerAbierto] = useState(false);
  const [ocidSel, setOcidSel] = useState<string | null>(null);
  const [hoverUbigeo, setHoverUbigeo] = useState<string | null>(null);
  const [hoverPunto, setHoverPunto] = useState<string | null>(null);

  // ─── Capas ───────────────────────────────────────────────────────────────
  const [verSenales, setVerSenales] = useState(true);
  const [verDenuncias, setVerDenuncias] = useState(true);
  const [verMisZonas, setVerMisZonas] = useState(false);

  // ─── Datos (null = todavía no llegó; [] = llegó vacío) ───────────────────
  /** Departamentos SIN filtro de mes: la fuente del panel, que muestra todo el histórico. */
  const [geoBase, setGeoBase] = useState<ContratoZona[] | null>(null);
  /** Departamentos del mes elegido (sólo con un mes elegido). */
  const [geoMes, setGeoMes] = useState<ContratoZona[] | null>(null);
  const [geoProv, setGeoProv] = useState<ContratoZona[] | null>(null);
  const [geoDist, setGeoDist] = useState<ContratoZona[] | null>(null);
  const [zonas, setZonas] = useState<Zona[] | null>(null);
  const [estado, setEstado] = useState<EstadoGlobal | null>(null);
  const [alertas, setAlertas] = useState<any[] | null>(null);
  const [reportes, setReportes] = useState<any[] | null>(null);
  const [enCurso, setEnCurso] = useState<Record<string, EnCurso>>({});

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

  // Señales, denuncias, financiamiento y estado global. Si una falla, se queda en
  // "cargando" (null) y se reintenta: un cero mientras tanto sería un dato falso.
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
        setFalloDenuncias(true);
        reintentar();
      });
    getZonas("departamento").then((z) => vivo && setZonas(z ?? []));
    getEstadoGlobal().then((e) => vivo && setEstado(e));
    return () => {
      vivo = false;
    };
  }, [intento, reintentar]);

  // Departamentos: siempre el histórico completo (panel) y, si hay mes, también el del mes (color y encabezado).
  useEffect(() => {
    let vivo = true;
    pedirGeo("departamento").then((d) => {
      if (!vivo) return;
      if (d) {
        setGeoBase(d);
        setFalloGeo(false);
      } else {
        setFalloGeo(true);
        reintentar();
      }
    });
    return () => {
      vivo = false;
    };
  }, [intento, pedirGeo, reintentar]);

  useEffect(() => {
    if (!mes) {
      setGeoMes(null);
      return;
    }
    let vivo = true;
    setGeoMes(null);
    pedirGeo("departamento", undefined, mes.desde, mes.hasta).then((d) => {
      if (!vivo) return;
      if (d) setGeoMes(d);
      else {
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
      if (d) set(d);
      else {
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

  // Dónde se está leyendo AHORA. Sólo datos reales: si no hay nada en curso, no late nada.
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store" });
        if (!r.ok) return;
        const res = await r.json();
        const pe = res?.porEstado ?? {};
        const vivos = (pe.procesando ?? 0) + (pe.encolado ?? 0) + (pe.pendiente_de_procesamiento ?? 0) + (pe.esperando_documentos ?? 0);
        if (vivos <= 0) {
          if (vivo) setEnCurso({});
          return;
        }
        // El resumen trae `activos` sin ubigeo; la lista sí lo trae. Van primero los que se procesan.
        const l = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?limit=300`, { cache: "no-store" });
        if (!l.ok) return;
        const lj = await l.json();
        const por: Record<string, EnCurso> = {};
        for (const p of (lj?.data ?? []) as { ubigeo?: string; estado?: string }[]) {
          const ub = String(p.ubigeo ?? "").slice(0, 2);
          if (!UBIGEO_REGION[ub]) continue;
          const e = (por[ub] ??= { leyendo: 0, enCola: 0, esperandoDocs: 0 });
          if (p.estado === "procesando") e.leyendo++;
          else if (p.estado === "encolado" || p.estado === "pendiente_de_procesamiento") e.enCola++;
          else if (p.estado === "esperando_documentos") e.esperandoDocs++;
        }
        for (const k of Object.keys(por)) if (por[k].leyendo + por[k].enCola + por[k].esperandoDocs === 0) delete por[k];
        if (vivo) setEnCurso(por);
      } catch {
        // Sin conexión: no se marca nada. Un pulso inventado sería peor que ninguno.
      }
    };
    cargar();
    const t = window.setInterval(cargar, 60_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, []);

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

  // `history.replaceState` y no `router.replace`: desde Next 14.1 el router lo
  // registra (useSearchParams se entera), y no pide la página al servidor de
  // nuevo en cada cambio de pestaña, que es lo que hacía router.replace sobre
  // una página que lee searchParams.
  useEffect(() => {
    if (!urlLeida.current) return;
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null | undefined) => (v ? sp.set(k, v) : sp.delete(k));
    set("region", regionUb ? UBIGEO_REGION[regionUb] : null);
    set("tab", regionUb && panelTab !== "resumen" ? panelTab : null);
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

  // La ola de recoloreo: cada cambio de medida o de mes (no el primer render).
  const [ola, setOla] = useState(0);
  const primeraOla = useRef(true);
  useEffect(() => {
    if (primeraOla.current) {
      primeraOla.current = false;
      return;
    }
    setOla((o) => o + 1);
  }, [medida, mes]);

  // ─── Escalas y relleno ───────────────────────────────────────────────────
  const m = medidaPorId(medida);
  const geoPais = mes ? geoMes : geoBase;
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

  const resumenDe = useCallback((z: ContratoZona | undefined, cargando: boolean, fallo: boolean) => {
    if (cargando) return "cifras cargando";
    if (fallo && !z) return "sin conexión con el servicio de contratos";
    const c = z ?? (CERO as ContratoZona);
    return `${enteros(c.total)} contratos ingresados, ${formatoSoles(c.montoPen)} contratados, ${enteros(
      c.enCola,
    )} esperando lectura, ${enteros(c.procesados)} leídos, ${enteros(c.conSenales)} con señal`;
  }, []);

  const regiones = useMemo(() => {
    const out: Record<string, ZonaPintada> = {};
    const sinDato = cargandoPais || (falloGeo && !geoPais);
    for (const ub of Object.values(REGION_UBIGEO)) {
      const z = geoPais?.find((x) => x.ubigeo === ub);
      out[ub] = {
        color: escalaPais.color(z ? m.valor(z) : 0),
        sinDato,
        resumen: resumenDe(z, cargandoPais, falloGeo),
        destacada: verMisZonas && misRegiones.has(ub),
        apagada: !pasaFiltro(filtro, z, financiamientoPorUbigeo.get(ub)),
      };
    }
    return out;
  }, [geoPais, escalaPais, m, cargandoPais, falloGeo, verMisZonas, misRegiones, resumenDe, filtro, financiamientoPorUbigeo]);

  const provincias = useMemo(() => {
    if (!regionUb) return undefined;
    const out: Record<string, ZonaPintada> = {};
    for (const z of geoProv ?? []) {
      out[z.ubigeo] = { color: escalaProv.color(m.valor(z)), sinDato: false, resumen: resumenDe(z, false, false) };
    }
    return out;
  }, [regionUb, geoProv, escalaProv, m, resumenDe]);

  // Una provincia que /contratos/geo no devolvió no tiene contratos ingresados:
  // eso es un cero, y un cero es un dato. Sólo se raya como "sin dato" mientras
  // la consulta está en vuelo o falló.
  const provinciaPorDefecto = useMemo<ZonaPintada | undefined>(() => {
    if (!regionUb) return undefined;
    const sinDato = cargandoProv;
    return {
      color: escalaProv.color(0),
      sinDato,
      resumen: sinDato ? (falloGeo ? "sin conexión con el servicio de contratos" : "cifras cargando") : "sin contratos ingresados",
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

  /**
   * Un punto por contrato CON SEÑAL, anclado a su provincia. `/alertas` trae la
   * provincia en `region`; antes se buscaba en una tabla de 25 capitales y las
   * que no eran capital (45 de 94) no se dibujaban, y a las demás se les
   * sumaba un desplazamiento de hasta 33 km que dejaba puntos en el mar.
   * `null` mientras cargan: el contador de la capa dice exactamente lo dibujado.
   */
  const puntosSenal = useMemo<MapPoint[] | null>(() => {
    if (!alertas) return null;
    const senales = alertas
      .filter(esSenal)
      .map((a) => ({ a, zona: zonaDeAlerta(a) }))
      .filter((x) => x.zona || (typeof x.a.lat === "number" && typeof x.a.lon === "number"))
      .sort((x, y) => (y.a.score ?? 0) - (x.a.score ?? 0));
    const n = new Map<string, number>();
    for (const x of senales) if (x.zona) n.set(x.zona, (n.get(x.zona) ?? 0) + 1);
    const i = new Map<string, number>();
    return senales.map(({ a, zona }) => {
      const nivel = nivelDeScore(a.score);
      const conGps = typeof a.lat === "number" && typeof a.lon === "number";
      const idx = zona ? i.get(zona) ?? 0 : 0;
      if (zona) i.set(zona, idx + 1);
      const lugar = zona ? (zona.length === 4 ? PROVINCIA_NOMBRE[zona] ?? a.region : nombreDepartamento(zona)) : a.region;
      return {
        id: `a-${a.id || a.codigo}`,
        kind: "alerta" as const,
        ...(conGps ? { lat: a.lat, lon: a.lon } : { zona: zona ?? undefined, grupo: zona ? { i: idx, n: n.get(zona) ?? 1 } : undefined }),
        score: a.score,
        label: a.objeto?.slice(0, 80),
        // La palabra de severidad viaja con el punto: el color solo nunca basta.
        titulo: `${severidadDeScore(a.score).etiqueta}, puntaje ${a.score ?? 0} de 100. ${lugar ?? ""}. ${a.objeto ?? ""}`.trim(),
        colorClase: FILL_SEVERIDAD[nivel],
        r: RADIO_SEVERIDAD[nivel],
        href: alertaHref(a),
      };
    });
  }, [alertas]);

  /**
   * Denuncias ciudadanas reales (las de demo ya las saca `getReportes`), SÓLO
   * con su GPS. Una denuncia sin ubicación no se dibuja: antes se le inventaba
   * un punto cerca del centro de la región. Sigue contándose en su pestaña.
   */
  const puntosDenuncia = useMemo<MapPoint[] | null>(() => {
    if (!reportes) return null;
    return reportes.filter(tieneUbicacion).map((r) => {
      const confirmada = estaConfirmada(r);
      return {
        id: `r-${r.id}`,
        kind: "reporte" as const,
        lat: Number(r.lat),
        lon: Number(r.lon),
        categoria: r.categoria,
        label: r.descripcion?.slice(0, 80),
        titulo: `Denuncia ciudadana ${confirmada ? "confirmada" : "en validación"}. ${r.categoria ?? ""}. ${r.descripcion ?? ""}`.trim(),
        colorClase: confirmada ? "fill-rust" : "fill-clay",
        r: 3.4,
        confirmado: confirmada,
        href: `/app/denuncias/${r.id}`,
      };
    });
  }, [reportes]);

  const puntos = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (verSenales && puntosSenal) out.push(...puntosSenal);
    if (verDenuncias && puntosDenuncia) out.push(...puntosDenuncia);
    // Los distritos van debajo: las señales y denuncias quedan clicables encima.
    return [...puntosDistrito, ...out];
  }, [verSenales, verDenuncias, puntosSenal, puntosDenuncia, puntosDistrito]);

  const pulsos = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [ub, e] of Object.entries(enCurso)) out[ub] = fraseEnCurso(e);
    return out;
  }, [enCurso]);

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
      setPanelTab("resumen");
    },
    [cerrarFicha],
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
  /** Cifras del departamento abierto: las del mes si hay mes (encabezado), las del histórico para el panel. */
  const zPais = regionUb ? zonaPorUbigeo.get(regionUb) ?? (geoPais ? (CERO as ContratoZona) : undefined) : undefined;
  const zBase = regionUb && geoBase ? geoBase.find((z) => z.ubigeo === regionUb) ?? (CERO as ContratoZona) : undefined;
  const fPais = regionUb ? financiamientoPorUbigeo.get(regionUb) : undefined;
  const totalPais = useMemo(
    () =>
      (geoPais ?? []).reduce(
        (acc, z) => ({ total: acc.total + z.total, leidos: acc.leidos + z.procesados, conSenales: acc.conSenales + z.conSenales }),
        { total: 0, leidos: 0, conSenales: 0 },
      ),
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

  /**
   * "Esperando" y "financiados" como un solo par, de una sola fuente
   * (`/financiamiento/zonas`: `pendientes` + `financiados`). Antes el
   * encabezado decía "10 financiados de 594 en cola" (594 ya excluía a los 10)
   * y la ficha "Financiados 10 de 604": dos denominadores para lo mismo.
   * Con un mes elegido el financiamiento no se puede acotar por mes, así que se
   * dice sólo lo que sí: cuántos del mes esperan lectura.
   */
  const esperandoDe = (z: ContratoZona | undefined, f: Zona | undefined) => (mes ? z?.enCola : f?.pendientes ?? z?.enCola);

  // ─── Ficha flotante anclada a la zona ────────────────────────────────────
  const zonaActiva = activa ? zonaPorUbigeo.get(activa.ubigeo) : undefined;
  const finActiva = activa && activa.nivel === "departamento" && !mes ? financiamientoPorUbigeo.get(activa.ubigeo) : undefined;
  const fichaFilas = useMemo(() => {
    if (!activa) return [];
    if (cargandoPais) return [{ etiqueta: "Cifras", valor: "cargando" }];
    const z = zonaActiva ?? (CERO as ContratoZona);
    const esperando = mes || !finActiva ? z.enCola : finActiva.pendientes;
    const filas: { etiqueta: string; valor: string; detalle?: string; tono?: string }[] = [
      { etiqueta: "Esperando lectura", valor: enteros(esperando), detalle: `de ${enteros(z.total)} ingresados`, tono: "text-ink" },
    ];
    if (finActiva) {
      filas.push({
        etiqueta: "Financiados",
        valor: enteros(finActiva.financiados),
        detalle: finActiva.financiados > 0 ? "con la lectura pagada" : undefined,
        tono: "text-ink",
      });
    }
    filas.push({ etiqueta: "Con señal", valor: enteros(z.conSenales), detalle: `de ${enteros(z.procesados)} leídos`, tono: "text-rust" });
    const ahora = activa.nivel === "departamento" ? enCurso[activa.ubigeo] : undefined;
    if (ahora) {
      const n = ahora.leyendo + ahora.enCola + ahora.esperandoDocs;
      filas.push({ etiqueta: "Ahora", valor: enteros(n), detalle: n === 1 ? "financiado en curso" : "financiados en curso", tono: "text-moss" });
    }
    return filas;
  }, [activa, zonaActiva, finActiva, mes, cargandoPais, enCurso]);

  const hoy = estado && (estado.ingresadosHoy > 0 || estado.procesadosHoy > 0) ? estado : null;
  const deptosEnCurso = Object.keys(enCurso).sort((a, b) => nombreDepartamento(a).localeCompare(nombreDepartamento(b), "es"));

  const contextoHeader = cargandoPais ? (
    <span className="block space-y-1" aria-busy>
      <span className="block h-4 w-48 animate-pulse rounded bg-paperEdge" />
      <span className="block h-4 w-40 animate-pulse rounded bg-paperEdge" />
      <span className="sr-only">Cargando las cifras</span>
    </span>
  ) : region ? (
    <span className="block font-mono tabular-nums sm:text-right">
      <span className="block">
        {!mes && fPais ? (
          <>
            <NumeroVivo valor={fPais.financiados} /> financiados, <NumeroVivo valor={fPais.pendientes} /> esperando
          </>
        ) : (
          <>
            <NumeroVivo valor={esperandoDe(zPais, fPais) ?? 0} /> esperando lectura
          </>
        )}
      </span>
      <span className="block">
        <NumeroVivo valor={zPais?.conSenales ?? 0} /> con señal de <NumeroVivo valor={zPais?.procesados ?? 0} /> leídos
        {mes ? ` en ${mes.etiqueta}` : ""}
      </span>
    </span>
  ) : (
    <span className="block font-mono tabular-nums sm:text-right">
      <span className="block">
        <NumeroVivo valor={totalPais.leidos} /> leídos de <NumeroVivo valor={totalPais.total} /> ingresados
        {mes ? ` en ${mes.etiqueta}` : ""}
      </span>
      <span className="block">
        <NumeroVivo valor={totalPais.conSenales} /> con señal
        {hoy && !mes ? `; hoy, ${enteros(hoy.ingresadosHoy)} ingresados y ${enteros(hoy.procesadosHoy)} leídos` : ""}
      </span>
    </span>
  );

  return (
    <MapaContratosContext.Provider value={mapaContratos}>
      <div className="space-y-4 sm:space-y-5">
        <PageHeader
          title={region ? region.nombre : "Elige tu región"}
          subtitle={
            region
              ? "Toca una provincia para acotar la lista, o un punto para ver un distrito."
              : "Toca un departamento para ver qué se contrata y qué se encontró."
          }
          contexto={contextoHeader}
          actions={
            region ? (
              <button
                type="button"
                onClick={() => elegirRegion(null)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paperSoft px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep"
              >
                <ArrowLeft size={14} aria-hidden /> Volver al Perú
              </button>
            ) : undefined
          }
        />

        {/* Sin `.surface`: ese atajo traía borde + paperSoft + sombra. El borde se
            va (lo reemplaza el salto de tono contra el suelo teñido) y el fondo
            pasa a blanco. */}
        <div className="relative overflow-hidden rounded-3xl bg-paper shadow-card">
          {/* Una sola franja de control hundida: filtros, leyenda y migaja son
              la misma cosa ("qué estoy viendo y cómo lo filtro"). El tono
              hundido y el `shadow-inset` las despegan del lienzo sin una línea. */}
          <div className="bg-paperSoft shadow-inset">
            <BarraMapa
              medida={medida}
              onMedida={setMedida}
              filtro={filtro}
              onFiltro={setFiltro}
              escala={escalaActiva}
              medidaActual={m}
              ambito={ambito}
              conPines={regionUb !== null}
              cargando={regionUb ? cargandoProv : cargandoPais}
              mes={mes}
              onMes={setMes}
              alertas={verSenales}
              onAlertas={() => setVerSenales((v) => !v)}
              nAlertas={puntosSenal ? puntosSenal.length : null}
              denuncias={verDenuncias}
              onDenuncias={() => setVerDenuncias((v) => !v)}
              nDenuncias={puntosDenuncia ? puntosDenuncia.length : null}
              misZonas={verMisZonas}
              onMisZonas={() => setVerMisZonas((v) => !v)}
              nMisZonas={misRegiones.size}
              sinConexion={sinConexion}
            />

            {/* Rastro de navegación: dónde estoy y cómo vuelvo */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-3 sm:px-5">
              <nav aria-label="Dónde estás en el mapa" className="flex items-center gap-1.5 font-mono text-[11px]">
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

              {/* Lo que se está leyendo AHORA. Sólo aparece si hay algo en curso. */}
              {deptosEnCurso.length > 0 && (
                <p className="flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-inkSoft" role="status">
                  <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-[#2FA84C] motion-safe:animate-pulseSoft" aria-hidden />
                  <span>
                    <span className="font-semibold text-ink">Ahora: </span>
                    {deptosEnCurso.map((ub, i) => (
                      <span key={ub}>
                        {i > 0 ? "; " : ""}
                        <Link href={`/app/auditoria?ubigeo=${ub}`} className="font-medium text-heroViolet underline-offset-2 hover:underline">
                          {nombreDepartamento(ub)}
                        </Link>
                        , {fraseEnCurso(enCurso[ub]).replace(/^[^:]+: /, "")}
                      </span>
                    ))}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px]">
            <div className="relative" ref={mapRef}>
              {/* El lienzo lo pinta ESTE contenedor, no un rect dentro del SVG:
                  así el área sobrante del encuadre y el área dibujada son el
                  mismo color. En móvil la altura sigue al ancho (130vw, tope
                  560 px) para que el país entre en el primer pantallazo. */}
              <div className="h-[min(560px,130vw)] w-full overflow-hidden bg-paper lg:h-[680px]">
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
                  pulsos={pulsos}
                  ola={ola}
                />
              </div>

              {/* Arriba y no abajo: abajo lo tapaba el botón flotante de navegación. */}
              {!regionUb && (
                <p className="pointer-events-none absolute inset-x-4 top-3 text-center text-[12px] text-inkSoft lg:hidden">
                  Toca un departamento para abrirlo
                </p>
              )}
            </div>

            {/* Panel de zona (escritorio). Alto fijo al del lienzo y scroll propio:
                antes Lima estiraba el panel a ~900 px junto a un mapa de 680. */}
            <aside className="relative z-mapa hidden h-[680px] shadow-drawer lg:block">
              <RegionDetailPanel
                region={region}
                onClose={() => elegirRegion(null)}
                alertasApi={alertas}
                reportes={reportes}
                geo={geoBase ? zBase : falloGeo ? null : undefined}
                tab={panelTab}
                onTab={setPanelTab}
              />
            </aside>

            {/* Panel de zona (móvil) */}
            {region && (
              <div
                className={cn(
                  "fixed inset-x-0 bottom-0 z-panel transition-transform duration-panel ease-salida lg:hidden",
                  drawerAbierto ? "translate-y-0" : "translate-y-[calc(100%-64px)]",
                )}
              >
                <div className="rounded-t-3xl border-t border-line bg-paperSoft shadow-drawer" role="region" aria-label={`Panel de ${region.nombre}`}>
                  <button
                    type="button"
                    onClick={() => setDrawerAbierto((v) => !v)}
                    aria-expanded={drawerAbierto}
                    aria-controls="panel-zona-movil"
                    className="flex h-16 w-full items-center justify-between gap-3 border-b border-line bg-paperDeep px-5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-serif text-base font-bold leading-tight text-ink">{region.nombre}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-inkSoft">
                        {zBase && fPais ? (
                          <>
                            {enteros(fPais.pendientes)} esperando, {enteros(fPais.financiados)} financiados,{" "}
                            {enteros(zBase.conSenales)} con señal
                          </>
                        ) : zBase ? (
                          <>
                            {enteros(zBase.enCola)} esperando, {enteros(zBase.conSenales)} con señal
                          </>
                        ) : (
                          <span className="inline-block h-3 w-40 animate-pulse rounded bg-paperEdge align-middle" aria-label="Cargando cifras" />
                        )}
                      </span>
                    </span>
                    {drawerAbierto ? (
                      <ChevronDown size={18} className="shrink-0 text-mute" aria-hidden />
                    ) : (
                      <ChevronUp size={18} className="shrink-0 text-mute" aria-hidden />
                    )}
                  </button>
                  <div id="panel-zona-movil" className="h-[72vh]">
                    <RegionDetailPanel
                      region={region}
                      onClose={() => elegirRegion(null)}
                      alertasApi={alertas}
                      reportes={reportes}
                      geo={geoBase ? zBase : falloGeo ? null : undefined}
                      tab={panelTab}
                      onTab={setPanelTab}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Debajo del mapa: arriba empujaba el lienzo fuera del primer pantallazo. */}
        <SenalesRecientes alertas={alertas} fallo={falloSenales && alertas === null} />

        {/* Ficha contextual: top layer, así el overflow-hidden del lienzo no la recorta */}
        <FichaRegion
          abierto={!!activa && !!ancla}
          ancla={ancla}
          titulo={activa?.nombre ?? ""}
          contexto={
            activa
              ? `${activa.nivel === "provincia" ? "Provincia" : "Departamento"}, ${m.sustantivo(zonaActiva ? m.valor(zonaActiva) : 0)}${
                  mes ? ` en ${mes.etiqueta}` : ""
                }`
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
    <div className="flex h-full min-h-[320px] w-full items-center justify-center bg-paperDeep">
      <div className="h-[86%] w-[52%] animate-pulse rounded-[45%_55%_48%_52%] bg-paperEdge" />
      <span className="sr-only">Cargando el mapa del Perú</span>
    </div>
  );
}
