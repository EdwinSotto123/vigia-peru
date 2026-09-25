"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useCuenta } from "@/lib/cuentas";
import { REGIONES } from "@/lib/peru-data";
import { getReportes, getAlertas } from "@/lib/api-client";
import { getZonas, getEstadoGlobal, type EstadoGlobal, type Zona } from "@/lib/financiamiento";
import { getContratosGeo, type ContratoResumen, type ContratoZona } from "@/lib/contratos";
import { numero } from "@/lib/formato";
import { EncabezadoPagina } from "@/components/patrones";
import { Llamita } from "@/components/marca";
import { MapaContratosContext, type MapaContratos } from "./contratos/ContratosLista";
import { colorPorEstado, radioPorTotal } from "./contratos/ContratoPin";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { REGION_UBIGEO, UBIGEO_REGION } from "./mapa/region-match";
import { type RangoMes } from "./mapa/FiltroMes";
import { BarraMapa } from "./mapa/BarraMapa";
import { FichaRegion } from "./mapa/FichaRegion";
import { NumeroVivo } from "./mapa/NumeroVivo";
import { SenalesRecientes } from "./mapa/SenalesRecientes";
import { RastroMapa } from "./mapa/RastroMapa";
import { PanelZonaMovil } from "./mapa/PanelZonaMovil";
import { fraseEnCurso, useEnCurso } from "./mapa/useEnCurso";
import { puntosDeDenuncias, puntosDeSenales } from "./mapa/puntos";
import { construirEscala, formatoSoles, medidaPorId, pasaFiltro, type FiltroZona, type MedidaId } from "./mapa/escala";
import type { ZonaTab } from "./mapa/ZonaHubPanel";
import type { MapPoint, ZonaPintada } from "./PeruChoropleth";

const PeruChoropleth = dynamic(() => import("./PeruChoropleth").then((m) => m.PeruChoropleth), {
  ssr: false,
  loading: () => <MapaEsqueleto />,
});

const enteros = (n: number) => numero(n);

/** Zona de contratos vacía: sirve para decir "0" sin inventar una fila. */
const CERO: Pick<ContratoZona, "total" | "enCola" | "procesados" | "conSenales" | "montoPen" | "documentosListos"> = {
  total: 0,
  enCola: 0,
  procesados: 0,
  conSenales: 0,
  montoPen: 0,
  documentosListos: 0,
};

/**
 * El hub público: el mapa ES la interfaz. Palabras de DESIGN_SYSTEM.md §10.1:
 * "publicados" (convocatorias del SEACE en la base), "leídos" (análisis
 * terminado), "financiados". `conSenales` de /contratos/geo cuenta score ≥ 40,
 * así que en pantalla se dice "de riesgo medio o alto", nunca "con señal".
 */
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
  const enCurso = useEnCurso();

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
  // nuevo en cada cambio de pestaña.
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

  /** Las cifras de una zona en palabras, para el `aria-label` de su polígono. */
  const resumenDe = useCallback((z: ContratoZona | undefined, cargando: boolean, fallo: boolean) => {
    if (cargando) return "cifras cargando";
    if (fallo && !z) return "sin conexión con el servicio de contratos";
    const c = z ?? (CERO as ContratoZona);
    return `${enteros(c.total)} contratos publicados, ${formatoSoles(c.montoPen)} en valor referencial, ${enteros(
      c.enCola,
    )} esperando lectura, ${enteros(c.procesados)} leídos, ${enteros(c.conSenales)} de riesgo medio o alto`;
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

  // Una provincia que /contratos/geo no devolvió no tiene contratos publicados:
  // eso es un cero, y un cero es un dato. Sólo se raya como "sin dato" mientras
  // la consulta está en vuelo o falló.
  const provinciaPorDefecto = useMemo<ZonaPintada | undefined>(() => {
    if (!regionUb) return undefined;
    const sinDato = cargandoProv;
    return {
      color: escalaProv.color(0),
      sinDato,
      resumen: sinDato ? (falloGeo ? "sin conexión con el servicio de contratos" : "cifras cargando") : "sin contratos publicados",
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

  /** `null` mientras cargan: el contador de la capa dice exactamente lo dibujado. */
  const puntosSenal = useMemo<MapPoint[] | null>(() => (alertas ? puntosDeSenales(alertas) : null), [alertas]);
  const puntosDenuncia = useMemo<MapPoint[] | null>(() => (reportes ? puntosDeDenuncias(reportes) : null), [reportes]);

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
   * (`/financiamiento/zonas`: `pendientes` + `financiados`). Con un mes elegido el
   * financiamiento no se puede acotar por mes, así que se dice sólo lo que sí:
   * cuántos del mes esperan lectura.
   */
  const esperandoDe = (z: ContratoZona | undefined, f: Zona | undefined) => (mes ? z?.enCola : f?.pendientes ?? z?.enCola);

  // ─── Ficha flotante anclada a la zona ────────────────────────────────────
  const zonaActiva = activa ? zonaPorUbigeo.get(activa.ubigeo) : undefined;
  const finActiva = activa && activa.nivel === "departamento" && !mes ? financiamientoPorUbigeo.get(activa.ubigeo) : undefined;
  const fichaFilas = useMemo(() => {
    if (!activa) return [];
    if (cargandoPais) return [{ etiqueta: "Cifras", valor: "cargando…" }];
    const z = zonaActiva ?? (CERO as ContratoZona);
    const esperando = mes || !finActiva ? z.enCola : finActiva.pendientes;
    const filas: { etiqueta: string; valor: string; detalle?: string; tono?: string }[] = [
      { etiqueta: "Esperando lectura", valor: enteros(esperando), detalle: `de ${enteros(z.total)} publicados`, tono: "text-ink" },
    ];
    if (finActiva) {
      filas.push({
        etiqueta: "Financiados",
        valor: enteros(finActiva.financiados),
        detalle: finActiva.financiados > 0 ? "con la lectura pagada" : undefined,
        tono: "text-ink",
      });
    }
    filas.push({ etiqueta: "Riesgo medio o alto", valor: enteros(z.conSenales), detalle: `de ${enteros(z.procesados)} leídos`, tono: "text-ink" });
    const ahora = activa.nivel === "departamento" ? enCurso[activa.ubigeo] : undefined;
    if (ahora) {
      const n = ahora.leyendo + ahora.enCola + ahora.esperandoDocs;
      filas.push({ etiqueta: "Ahora", valor: enteros(n), detalle: n === 1 ? "financiado en curso" : "financiados en curso", tono: "text-mossTexto" });
    }
    return filas;
  }, [activa, zonaActiva, finActiva, mes, cargandoPais, enCurso]);

  const hoy = estado && (estado.ingresadosHoy > 0 || estado.procesadosHoy > 0) ? estado : null;

  const contextoHeader = cargandoPais ? (
    <span className="block space-y-1" role="status" aria-busy>
      <span className="block h-4 w-48 animate-pulse rounded bg-paperEdge" />
      <span className="block h-4 w-40 animate-pulse rounded bg-paperEdge" />
      <span className="sr-only">Cargando las cifras…</span>
    </span>
  ) : region ? (
    <span className="block tabular-nums sm:text-right">
      <span className="block">
        {!mes && fPais ? (
          <>
            <NumeroVivo valor={fPais.financiados} className="font-semibold text-ink" /> financiados,{" "}
            <NumeroVivo valor={fPais.pendientes} className="font-semibold text-ink" /> esperando lectura
          </>
        ) : (
          <>
            <NumeroVivo valor={esperandoDe(zPais, fPais) ?? 0} className="font-semibold text-ink" /> esperando lectura
          </>
        )}
      </span>
      <span className="block">
        <NumeroVivo valor={zPais?.conSenales ?? 0} className="font-semibold text-ink" /> de riesgo medio o alto, de{" "}
        <NumeroVivo valor={zPais?.procesados ?? 0} className="font-semibold text-ink" /> leídos
        {mes ? ` en ${mes.etiqueta}` : ""}
      </span>
    </span>
  ) : (
    <span className="block tabular-nums sm:text-right">
      <span className="block">
        <NumeroVivo valor={totalPais.leidos} className="font-semibold text-ink" /> leídos de{" "}
        <NumeroVivo valor={totalPais.total} className="font-semibold text-ink" /> contratos publicados
        {mes ? ` en ${mes.etiqueta}` : ""}
      </span>
      <span className="block">
        <NumeroVivo valor={totalPais.conSenales} className="font-semibold text-ink" /> de riesgo medio o alto
        {hoy && !mes ? `; hoy, ${enteros(hoy.ingresadosHoy)} nuevos en la base y ${enteros(hoy.procesadosHoy)} leídos` : ""}
      </span>
    </span>
  );

  const resumenMovil =
    zBase && fPais
      ? `${enteros(fPais.pendientes)} esperando, ${enteros(fPais.financiados)} financiados, ${enteros(zBase.conSenales)} de riesgo medio o alto`
      : zBase
        ? `${enteros(zBase.enCola)} esperando, ${enteros(zBase.conSenales)} de riesgo medio o alto`
        : null;

  const panel = (
    <RegionDetailPanel
      region={region}
      onClose={() => elegirRegion(null)}
      alertasApi={alertas}
      reportes={reportes}
      geo={geoBase ? zBase : falloGeo ? null : undefined}
      tab={panelTab}
      onTab={setPanelTab}
    />
  );

  return (
    <MapaContratosContext.Provider value={mapaContratos}>
      <div className="space-y-4 sm:space-y-5">
        <EncabezadoPagina
          titulo={region ? region.nombre : "Elige tu región"}
          bajada={
            region
              ? "Toca una provincia para acotar la lista, o un punto para ver un distrito."
              : "Toca un departamento para ver qué se contrata y qué se encontró."
          }
          acciones={
            <>
              <div className="text-[13px] text-inkSoft" aria-live="polite">
                {contextoHeader}
              </div>
              {region && (
                <button
                  type="button"
                  onClick={() => elegirRegion(null)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
                >
                  <ArrowLeft size={14} aria-hidden /> Volver al Perú
                </button>
              )}
            </>
          }
        />

        {/* Un bloque blanco con borde sobre el suelo teñido: sin sombra en reposo (DESIGN_SYSTEM.md §5). */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-paper">
          {/* Una sola franja de control hundida: filtros, leyenda y migaja son
              la misma cosa ("qué estoy viendo y cómo lo filtro"). */}
          <div className="border-b border-line bg-paperSoft">
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

            <RastroMapa
              region={region?.nombre ?? null}
              zona={zonaSel ? zonaSel.nombre || zonaSel.ubigeo : null}
              onPeru={() => elegirRegion(null)}
              onRegion={() => setZonaSel(null)}
              onQuitarZona={() => setZonaSel(null)}
              enCurso={enCurso}
            />
          </div>

          <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px]">
            <div className="relative" ref={mapRef}>
              {/* El lienzo lo pinta ESTE contenedor, no un rect dentro del SVG: así el
                  área sobrante del encuadre y el área dibujada son el mismo color. En
                  móvil la altura sigue al ancho (130vw, tope 560 px) para que el país
                  entre en el primer pantallazo. */}
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

            {/* Panel de zona (escritorio). Alto fijo al del lienzo y scroll propio. */}
            <aside className="relative z-mapa hidden h-[680px] border-l border-line lg:block">{panel}</aside>

            {/* Panel de zona (móvil) */}
            {region && (
              <PanelZonaMovil
                titulo={region.nombre}
                resumen={resumenMovil}
                abierto={drawerAbierto}
                onAlternar={() => setDrawerAbierto((v) => !v)}
              >
                {panel}
              </PanelZonaMovil>
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

/** Mientras baja el mapa (es un módulo aparte): la llamita camina, y se dice qué se espera. */
function MapaEsqueleto() {
  return (
    <div className="flex h-full min-h-[320px] w-full flex-col items-center justify-center gap-3 bg-paperSoft" role="status">
      <Llamita caminando className="w-12 text-granate/70" />
      <span className="text-sm text-mute">Cargando el mapa del Perú…</span>
    </div>
  );
}
