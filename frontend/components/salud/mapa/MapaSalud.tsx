"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as EventoTeclado, type PointerEvent as EventoPuntero } from "react";
import { geoMercator, geoPath, type ExtendedFeature, type ExtendedFeatureCollection, type GeoProjection } from "d3-geo";
import { ArrowRight, Gavel, List, Loader2, Maximize2, Minus, MousePointerClick, Plus, RotateCw, SlidersHorizontal, X } from "lucide-react";
import { useGeoPeru } from "@/components/mapa/useGeoPeru";
import { FuenteFecha, InsigniaCategoria, InsigniaSector } from "@/components/salud/comun";
import { URL_RENIPRESS_CONSULTA } from "@/components/salud/fuentes/urls";
import { DEPARTAMENTOS, lugarIpress, nombreLugar, normalizar, qsLista, type FiltrosLista } from "@/components/salud/lista/filtros";
import { ConteoDenuncias, ConteoSanciones, InsigniaInternamiento, InsigniaQuirurgico, InsigniaRegistro } from "@/components/salud/lista/Insignias";
import { API_PUBLICA } from "@/lib/api-client";
import { rutaEn } from "@/lib/gobserva";
import { CATEGORIAS_ORDEN, SECTORES, fechaCorta, nombrePropio, numero, rutaFicha, type FilaIpress, type Mapa, type ResultadoBusqueda, type Sector } from "@/lib/gobserva-salud";
import { useModo } from "@/lib/modo";
import { cn } from "@/lib/utils";

/**
 * El mapa de Gobserva Salud (2026-11-20): todas las IPRESS con ubicación (unas 20 mil) en un <canvas> (no 20 mil nodos SVG),
 * con los departamentos dibujados con d3-geo. Color por sector; las que tienen una sanción firme llevan un anillo rojo
 * (el tono de la sanción firme) y van encima. Filtros (departamento: el mapa se acerca a él), que viajan en la URL sin
 * recargar; al pasar el mouse, lo básico del punto más cercano; al tocarlo, su ficha breve (GET /salud/buscar?q=<código>)
 * en el panel (en el celular, una hoja desde abajo) con el enlace a su ficha. Arrastrar mueve, la rueda o el pellizco
 * acercan; también los botones y el teclado (flechas, + y −). Sin animaciones: nada que reducir con movimiento reducido.
 * Los colores salen de las variables de globals.css (cambian con el modo día o noche).
 */
export interface FiltrosMapaCliente {
  departamento: string;
  sector: "" | Sector;
  categoria: string;
  sanciones: boolean;
  quirurgico: boolean;
  todos: boolean;
}

type Transformacion = { k: number; x: number; y: number };
const IDENTIDAD: Transformacion = { k: 1, x: 0, y: 0 };
const K_MAX = 80;

type Colores = Record<"publico" | "privado" | "otro" | "sancion" | "tierra" | "borde" | "bordeFuerte" | "ink" | "paper", string>;

/** Las variables de color de globals.css, como colores de canvas («rgb(68,136,220)»). */
function leerColores(): Colores {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => `rgb(${s.getPropertyValue(n).trim().split(/\s+/).join(",")})`;
  return {
    publico: v("--serie-1"),
    privado: v("--serie-3"),
    otro: v("--serie-4"),
    sancion: v("--rust"),
    tierra: v("--paper-deep"),
    borde: v("--paper-edge"),
    bordeFuerte: v("--ink-soft"),
    ink: v("--ink"),
    paper: v("--paper"),
  };
}

/** Los puntos ya proyectados (coordenadas de pantalla con el mapa sin acercar). */
interface Puntos {
  n: number;
  codigos: string[];
  categorias: (string | null)[];
  xs: Float32Array;
  ys: Float32Array;
  /** 0 público, 1 privado, 2 otro. */
  sector: Uint8Array;
  activo: Uint8Array;
  sanciones: Uint16Array;
  quirurgico: Int8Array;
  conSancion: number[];
}

const SECTOR_DE: Record<string, number> = { p: 0, v: 1, o: 2 };
const SECTOR_NOMBRE: Sector[] = ["publico", "privado", "otro"];

const aLista = (f: FiltrosMapaCliente): FiltrosLista => ({
  departamento: f.departamento || undefined,
  sector: f.sector || undefined,
  categoria: f.categoria || undefined,
  sanciones: f.sanciones ? "con" : undefined,
  quirurgico: f.quirurgico ? "si" : undefined,
  estado: f.todos ? "todos" : undefined,
});

function paramsMapa(f: FiltrosMapaCliente): string {
  const u = new URLSearchParams();
  if (f.departamento) u.set("departamento", f.departamento);
  if (f.sector) u.set("sector", f.sector);
  if (f.categoria) u.set("categoria", f.categoria);
  if (f.sanciones) u.set("sanciones", "con");
  if (f.quirurgico) u.set("quirurgico", "si");
  if (f.todos) u.set("estado", "todos");
  return u.toString();
}

const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Acerca (o aleja) la vista por `factor` dejando quieto el punto (px, py) de la pantalla. */
function zoomEn(t: Transformacion, px: number, py: number, factor: number): Transformacion {
  const k = limitar(t.k * factor, 1, K_MAX);
  const f = k / t.k;
  return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
}

/** Que el mapa no se vaya del todo fuera de la vista al arrastrarlo. */
function encuadrar(t: Transformacion, w: number, h: number): Transformacion {
  return { k: t.k, x: limitar(t.x, -w * t.k + w * 0.25, w * 0.75), y: limitar(t.y, -h * t.k + h * 0.25, h * 0.75) };
}

type Detalle = { estado: "cargando" } | { estado: "listo"; fila: FilaIpress } | { estado: "error" };

export function MapaSalud({
  base,
  inicial,
  renipressAl,
  sancionesAl,
  cobertura,
}: {
  base: string;
  inicial: FiltrosMapaCliente;
  renipressAl: string | null;
  sancionesAl: string | null;
  cobertura: { leidas: number; total: number } | null;
}) {
  const [filtros, setFiltros] = useState<FiltrosMapaCliente>(inicial);
  const [abiertos, setAbiertos] = useState(false);
  const [datos, setDatos] = useState<Mapa | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);
  const { deptData, status: estadoGeo } = useGeoPeru(false);
  const modo = useModo();
  const [colores, setColores] = useState<Colores | null>(null);
  const envoltura = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [ancho, setAncho] = useState(0);
  const [t, setT] = useState<Transformacion>(IDENTIDAD);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const cache = useRef(new Map<string, FilaIpress>());

  const alto = ancho === 0 ? 0 : ancho < 640 ? Math.round(ancho * 1.25) : limitar(Math.round(ancho * 1.02), 480, 760);
  const qs = paramsMapa(filtros);

  // Los colores, al montar y cada vez que cambia el modo (día o noche).
  useEffect(() => setColores(leerColores()), [modo]);

  // El ancho disponible.
  useEffect(() => {
    const el = envoltura.current?.parentElement;
    if (!el) return;
    const medir = () => setAncho(Math.floor(el.getBoundingClientRect().width));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Los filtros en la URL, sin recargar la página (el enlace se comparte y «ver en la lista» lleva los mismos).
  useEffect(() => {
    const q = qsLista(aLista(filtros));
    const url = `${window.location.pathname}${q}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [filtros]);

  // Los puntos (GET /salud/mapa con los filtros; una hora en caché en la API).
  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    fetch(`${API_PUBLICA}/salud/mapa?${qs}`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Mapa>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        setDatos(m);
        setError(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setCargando(false);
      });
    return () => ac.abort();
  }, [qs, intento]);

  // A qué se ajusta el mapa: el departamento elegido o el país.
  const objetivo = useMemo(() => {
    if (!deptData) return null;
    if (filtros.departamento) {
      const f = deptData.features.find((x) => normalizar(x.properties.name) === filtros.departamento);
      if (f) return f as unknown as ExtendedFeature;
    }
    return deptData as unknown as ExtendedFeatureCollection;
  }, [deptData, filtros.departamento]);

  const proyeccion = useMemo<GeoProjection | null>(() => {
    if (!objetivo || !ancho || !alto) return null;
    return geoMercator().fitExtent(
      [
        [14, 14],
        [ancho - 14, alto - 14],
      ],
      objetivo,
    );
  }, [objetivo, ancho, alto]);

  useEffect(() => setT(IDENTIDAD), [proyeccion]);

  const puntos = useMemo<Puntos | null>(() => {
    if (!datos || !proyeccion) return null;
    const n = datos.puntos.length;
    const p: Puntos = {
      n,
      codigos: new Array(n),
      categorias: new Array(n),
      xs: new Float32Array(n),
      ys: new Float32Array(n),
      sector: new Uint8Array(n),
      activo: new Uint8Array(n),
      sanciones: new Uint16Array(n),
      quirurgico: new Int8Array(n),
      conSancion: [],
    };
    datos.puntos.forEach((x, i) => {
      const xy = proyeccion([x[2], x[1]]);
      p.codigos[i] = x[0];
      p.categorias[i] = x[3];
      p.xs[i] = xy ? xy[0] : -9999;
      p.ys[i] = xy ? xy[1] : -9999;
      p.sector[i] = SECTOR_DE[x[4]] ?? 2;
      p.activo[i] = x[5];
      p.sanciones[i] = Math.min(65535, x[6]);
      p.quirurgico[i] = x[7] == null ? -1 : x[7];
      if (x[6] > 0) p.conSancion.push(i);
    });
    return p;
  }, [datos, proyeccion]);

  const conteos = useMemo(() => {
    const c = { publico: 0, privado: 0, otro: 0, sancion: 0, inactivas: 0 };
    if (!puntos) return c;
    for (let i = 0; i < puntos.n; i++) {
      c[SECTOR_NOMBRE[puntos.sector[i]]]++;
      if (!puntos.activo[i]) c.inactivas++;
    }
    c.sancion = puntos.conSancion.length;
    return c;
  }, [puntos]);

  const seleccionado = useMemo(() => (codigo && puntos ? puntos.codigos.indexOf(codigo) : -1), [codigo, puntos]);

  // ── Dibujo ──────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = lienzo.current;
    if (!c || !proyeccion || !colores || !ancho || !alto) return;
    const id = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(ancho * dpr) || c.height !== Math.round(alto * dpr)) {
        c.width = Math.round(ancho * dpr);
        c.height = Math.round(alto * dpr);
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);
      // Los departamentos con la misma transformación que los puntos (Mercator: escalar y trasladar es lineal).
      const [tx0, ty0] = proyeccion.translate();
      const vista = geoMercator()
        .scale(proyeccion.scale() * t.k)
        .translate([tx0 * t.k + t.x, ty0 * t.k + t.y]);
      const camino = geoPath(vista, ctx);
      if (deptData) {
        ctx.beginPath();
        for (const f of deptData.features) camino(f as unknown as ExtendedFeature);
        ctx.fillStyle = colores.tierra;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = colores.borde;
        ctx.stroke();
        if (filtros.departamento && objetivo && objetivo.type === "Feature") {
          ctx.beginPath();
          camino(objetivo);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = colores.bordeFuerte;
          ctx.stroke();
        }
      }
      if (!puntos) return;
      const r = limitar(1.1 + Math.sqrt(t.k) * 0.6, 1.4, 5);
      const fuera = (x: number, y: number) => x < -10 || y < -10 || x > ancho + 10 || y > alto + 10;
      const tonos = [colores.publico, colores.privado, colores.otro];
      // Por sector: un solo trazo por color (rápido con 20 mil). Las inactivas, más tenues.
      for (const activo of [0, 1]) {
        ctx.globalAlpha = activo ? 0.85 : 0.3;
        for (let s = 0; s < 3; s++) {
          ctx.beginPath();
          for (let i = 0; i < puntos.n; i++) {
            if (puntos.sector[i] !== s || puntos.activo[i] !== activo) continue;
            const x = puntos.xs[i] * t.k + t.x;
            const y = puntos.ys[i] * t.k + t.y;
            if (fuera(x, y)) continue;
            if (r < 2.2) ctx.rect(x - r, y - r, r * 2, r * 2);
            else {
              ctx.moveTo(x + r, y);
              ctx.arc(x, y, r, 0, Math.PI * 2);
            }
          }
          ctx.fillStyle = tonos[s];
          ctx.fill();
        }
      }
      // Con sanción firme: encima, con su anillo.
      // De lejos el anillo es más fino y pegado al punto: en Lima Metropolitana cientos se superponen.
      const anillo = r + (t.k < 2 ? 1.4 : 2.2);
      ctx.globalAlpha = t.k < 2 ? 0.85 : 1;
      ctx.lineWidth = t.k < 2 ? 1 : 1.75;
      ctx.strokeStyle = colores.sancion;
      ctx.beginPath();
      for (const i of puntos.conSancion) {
        const x = puntos.xs[i] * t.k + t.x;
        const y = puntos.ys[i] * t.k + t.y;
        if (fuera(x, y)) continue;
        ctx.moveTo(x + anillo, y);
        ctx.arc(x, y, anillo, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // El punto bajo el mouse y el elegido.
      const marcar = (i: number, grande: boolean) => {
        const x = puntos.xs[i] * t.k + t.x;
        const y = puntos.ys[i] * t.k + t.y;
        ctx.beginPath();
        ctx.arc(x, y, r + (grande ? 7 : 5), 0, Math.PI * 2);
        ctx.lineWidth = grande ? 3 : 2;
        ctx.strokeStyle = colores.paper;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r + (grande ? 7 : 5), 0, Math.PI * 2);
        ctx.lineWidth = grande ? 1.75 : 1.25;
        ctx.strokeStyle = colores.ink;
        ctx.stroke();
      };
      if (hover && hover.i < puntos.n && hover.i !== seleccionado) marcar(hover.i, false);
      if (seleccionado >= 0) marcar(seleccionado, true);
    });
    return () => cancelAnimationFrame(id);
  }, [proyeccion, colores, ancho, alto, t, deptData, puntos, hover, seleccionado, filtros.departamento, objetivo]);

  // ── Interacción ─────────────────────────────────────────────────────────────────────────────────
  const tRef = useRef(t);
  tRef.current = t;
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const arrastre = useRef<{ x: number; y: number; t: Transformacion; movio: boolean } | null>(null);
  const pellizco = useRef<{ d: number; mx: number; my: number } | null>(null);

  const cercano = useCallback(
    (px: number, py: number, radio: number): number => {
      if (!puntos) return -1;
      const { k, x: tx, y: ty } = tRef.current;
      let mejor = -1;
      let md = radio * radio;
      for (let i = 0; i < puntos.n; i++) {
        const dx = puntos.xs[i] * k + tx - px;
        if (dx > radio || dx < -radio) continue;
        const dy = puntos.ys[i] * k + ty - py;
        const d = dx * dx + dy * dy;
        // A igual distancia gana la que tiene sanciones (va dibujada encima).
        if (d < md || (d === md && puntos.sanciones[i] > 0)) {
          md = d;
          mejor = i;
        }
      }
      return mejor;
    },
    [puntos],
  );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = lienzo.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  const alBajar = (e: EventoPuntero<HTMLCanvasElement>) => {
    const p = local(e);
    punteros.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (punteros.current.size === 1) arrastre.current = { x: p.x, y: p.y, t: tRef.current, movio: false };
    else if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()];
      pellizco.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (arrastre.current) arrastre.current.movio = true;
    }
  };

  const alMover = (e: EventoPuntero<HTMLCanvasElement>) => {
    const p = local(e);
    if (punteros.current.has(e.pointerId)) punteros.current.set(e.pointerId, p);
    if (punteros.current.size === 2 && pellizco.current) {
      const [a, b] = [...punteros.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const prev = pellizco.current;
      setT((t0) => {
        const z = zoomEn(t0, prev.mx, prev.my, d / prev.d);
        return encuadrar({ k: z.k, x: z.x + mx - prev.mx, y: z.y + my - prev.my }, ancho, alto);
      });
      pellizco.current = { d, mx, my };
      return;
    }
    const a = arrastre.current;
    if (a && punteros.current.size === 1) {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      if (!a.movio && Math.hypot(dx, dy) > 5) a.movio = true;
      if (a.movio) setT(encuadrar({ k: a.t.k, x: a.t.x + dx, y: a.t.y + dy }, ancho, alto));
      return;
    }
    if (e.pointerType === "mouse") {
      const i = cercano(p.x, p.y, 14);
      setHover(i >= 0 ? { i, x: p.x, y: p.y } : null);
    }
  };

  const alSubir = (e: EventoPuntero<HTMLCanvasElement>) => {
    const p = local(e);
    const a = arrastre.current;
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pellizco.current = null;
    if (punteros.current.size === 0) {
      if (a && !a.movio && puntos) {
        const i = cercano(p.x, p.y, e.pointerType === "mouse" ? 14 : 24);
        setCodigo(i >= 0 ? puntos.codigos[i] : null);
      }
      arrastre.current = null;
    }
  };

  // La rueda acerca (listener no pasivo para que la página no se mueva a la vez).
  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const alGirar = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setT((t0) => encuadrar(zoomEn(t0, px, py, Math.exp(-e.deltaY * 0.0018)), r.width, r.height));
    };
    c.addEventListener("wheel", alGirar, { passive: false });
    return () => c.removeEventListener("wheel", alGirar);
  }, []);

  const acercar = (factor: number) => setT((t0) => encuadrar(zoomEn(t0, ancho / 2, alto / 2, factor), ancho, alto));

  const alTeclear = (e: EventoTeclado<HTMLCanvasElement>) => {
    const paso = 48;
    const mover = (dx: number, dy: number) => setT((t0) => encuadrar({ k: t0.k, x: t0.x + dx, y: t0.y + dy }, ancho, alto));
    if (e.key === "ArrowLeft") mover(paso, 0);
    else if (e.key === "ArrowRight") mover(-paso, 0);
    else if (e.key === "ArrowUp") mover(0, paso);
    else if (e.key === "ArrowDown") mover(0, -paso);
    else if (e.key === "+" || e.key === "=") acercar(1.5);
    else if (e.key === "-" || e.key === "_") acercar(1 / 1.5);
    else if (e.key === "0") setT(IDENTIDAD);
    else return;
    e.preventDefault();
  };

  // La ficha breve del punto elegido (GET /salud/buscar?q=<código>, liviana), con caché.
  useEffect(() => {
    if (!codigo) {
      setDetalle(null);
      return;
    }
    const guardada = cache.current.get(codigo);
    if (guardada) {
      setDetalle({ estado: "listo", fila: guardada });
      return;
    }
    const ac = new AbortController();
    setDetalle({ estado: "cargando" });
    fetch(`${API_PUBLICA}/salud/buscar?q=${encodeURIComponent(codigo)}`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ResultadoBusqueda>) : Promise.reject(new Error(String(r.status)))))
      .then((r) => {
        const fila = r.establecimientos.find((x) => x.codigo === codigo) ?? null;
        if (fila) {
          cache.current.set(codigo, fila);
          setDetalle({ estado: "listo", fila });
        } else setDetalle({ estado: "error" });
      })
      .catch(() => {
        if (!ac.signal.aborted) setDetalle({ estado: "error" });
      });
    return () => ac.abort();
  }, [codigo]);

  // Escape cierra la ficha.
  useEffect(() => {
    if (!codigo) return;
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCodigo(null);
    };
    window.addEventListener("keydown", alTecla);
    return () => window.removeEventListener("keydown", alTecla);
  }, [codigo]);

  const cambiar = (c: Partial<FiltrosMapaCliente>) => {
    setFiltros((f) => ({ ...f, ...c }));
    setHover(null);
  };
  const puestos = [filtros.departamento, filtros.sector, filtros.categoria, filtros.sanciones, filtros.quirurgico, filtros.todos].filter(Boolean).length;
  const enLista = `${rutaEn(base, "/establecimientos")}${qsLista(aLista(filtros))}`;
  const zona = filtros.departamento ? nombreLugar(filtros.departamento) : "Todo el Perú";
  const hoverInfo = hover && puntos && hover.i < puntos.n ? hover : null;

  return (
    <div>
      {/* ── Filtros ───────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-paper p-2.5 sm:p-3 md:p-4">
        <button
          type="button"
          onClick={() => setAbiertos((x) => !x)}
          aria-expanded={abiertos}
          aria-controls="mapa-filtros"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3.5 text-dato font-semibold text-ink md:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal size={16} aria-hidden className="text-granate" /> Filtros
            {puestos > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1.5 text-micro font-bold tabular-nums text-paper">{puestos}</span>
            )}
          </span>
          <span className="truncate text-meta font-medium text-inkSoft">{zona}</span>
        </button>
        <div
          id="mapa-filtros"
          className={cn(
            "gap-2.5 max-md:mt-2.5 md:grid md:grid-cols-3 md:gap-3 lg:grid-cols-[minmax(0,13rem)_minmax(0,10rem)_minmax(0,10rem)_minmax(0,1fr)] lg:items-end",
            abiertos ? "grid grid-cols-2" : "hidden",
          )}
        >
          <label className="col-span-2 block min-w-0 md:col-span-1">
            <span className="text-rotulo font-medium text-inkSoft">Departamento</span>
            <select value={filtros.departamento} onChange={(e) => cambiar({ departamento: e.target.value })} className={CAMPO}>
              <option value="">Todo el Perú</option>
              {DEPARTAMENTOS.map((d) => (
                <option key={d} value={d}>
                  {nombreLugar(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-rotulo font-medium text-inkSoft">Sector</span>
            <select value={filtros.sector} onChange={(e) => cambiar({ sector: e.target.value as FiltrosMapaCliente["sector"] })} className={CAMPO}>
              <option value="">Todos</option>
              {(Object.keys(SECTORES) as Sector[]).map((s) => (
                <option key={s} value={s}>
                  {SECTORES[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-rotulo font-medium text-inkSoft">Categoría</span>
            <select value={filtros.categoria} onChange={(e) => cambiar({ categoria: e.target.value })} className={CAMPO}>
              <option value="">Todas</option>
              {filtros.categoria.includes(",") && <option value={filtros.categoria}>Varias</option>}
              {CATEGORIAS_ORDEN.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="SIN">Sin categoría</option>
            </select>
          </label>
          <fieldset className="col-span-2 min-w-0 md:col-span-3 lg:col-span-1">
            <legend className="sr-only">Más filtros</legend>
            <div className="flex flex-wrap gap-2">
              <Conmutador marcado={filtros.sanciones} cambiar={(v) => cambiar({ sanciones: v })}>
                Con sanción firme
              </Conmutador>
              <Conmutador marcado={filtros.quirurgico} cambiar={(v) => cambiar({ quirurgico: v })}>
                Con centro quirúrgico
              </Conmutador>
              <Conmutador marcado={filtros.todos} cambiar={(v) => cambiar({ todos: v })}>
                Incluir inactivos
              </Conmutador>
            </div>
          </fieldset>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-5">
        {/* ── El mapa ───────────────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div
            ref={envoltura}
            className="relative overflow-hidden rounded-2xl border border-line bg-paper"
            style={{ height: alto || undefined, minHeight: alto ? undefined : 420 }}
          >
            <canvas
              ref={lienzo}
              tabIndex={0}
              role="img"
              aria-label={`Mapa de ${zona}: ${numero(datos?.total ?? 0)} establecimientos de salud con ubicación, ${numero(conteos.sancion)} con una sanción firme. Toca un punto para ver su ficha breve; flechas para mover, + y − para acercar. La lista con los mismos filtros está debajo del mapa.`}
              onPointerDown={alBajar}
              onPointerMove={alMover}
              onPointerUp={alSubir}
              onPointerCancel={(e) => {
                punteros.current.delete(e.pointerId);
                pellizco.current = null;
                arrastre.current = null;
              }}
              onPointerLeave={() => setHover(null)}
              onKeyDown={alTeclear}
              className={cn(
                "block h-full w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
                hoverInfo ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
              )}
              style={{ width: ancho || "100%", height: alto || "100%" }}
            />

            <p className="pointer-events-none absolute left-3 top-3 rounded-lg bg-paper/90 px-2.5 py-1.5 text-meta font-semibold text-ink shadow-caja">
              {zona}
              {datos && <span className="ml-2 font-normal tabular-nums text-inkSoft">{numero(datos.total)}</span>}
            </p>

            <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-caja">
              <BotonMapa etiqueta="Acercar" onClick={() => acercar(1.6)}>
                <Plus size={17} aria-hidden />
              </BotonMapa>
              <BotonMapa etiqueta="Alejar" onClick={() => acercar(1 / 1.6)} borde>
                <Minus size={17} aria-hidden />
              </BotonMapa>
              <BotonMapa etiqueta="Ver todo" onClick={() => setT(IDENTIDAD)} borde>
                <Maximize2 size={15} aria-hidden />
              </BotonMapa>
            </div>

            {hoverInfo && puntos && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-10 w-56 rounded-xl border border-line bg-paper px-3 py-2 text-meta shadow-pop"
                style={{
                  left: Math.min(hoverInfo.x + 14, ancho - 236),
                  top: hoverInfo.y + 14 + 96 > alto ? hoverInfo.y - 96 : hoverInfo.y + 14,
                }}
              >
                <p className="font-mono font-semibold text-ink">IPRESS {puntos.codigos[hoverInfo.i]}</p>
                <p className="mt-0.5 text-inkSoft">
                  {SECTORES[SECTOR_NOMBRE[puntos.sector[hoverInfo.i]]]}, {puntos.categorias[hoverInfo.i] ?? "sin categoría"}
                  {!puntos.activo[hoverInfo.i] && ", inactiva"}
                </p>
                {puntos.sanciones[hoverInfo.i] > 0 && (
                  <p className="mt-0.5 font-semibold text-crimsonTexto">
                    {puntos.sanciones[hoverInfo.i] === 1 ? "1 sanción firme" : `${numero(puntos.sanciones[hoverInfo.i])} sanciones firmes`}
                  </p>
                )}
                <p className="mt-1 text-rotulo text-mute">Haz clic para ver su ficha breve</p>
              </div>
            )}

            {(cargando || estadoGeo === "loading") && (
              <div role="status" className="absolute inset-x-0 bottom-3 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-2 text-meta font-semibold text-ink shadow-pop">
                  <Loader2 size={15} aria-hidden className="motion-safe:animate-spin" />
                  {datos ? "Actualizando los puntos…" : "Cargando unos 20 mil establecimientos…"}
                </span>
              </div>
            )}
            {(error || estadoGeo === "error" || estadoGeo === "missing") && !cargando && (
              <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper/90 p-6 text-center">
                <p className="text-cuerpo font-semibold text-ink">No pudimos cargar el mapa</p>
                <p className="max-w-[40ch] text-dato text-inkSoft">Suele ser momentáneo. Mientras tanto, la lista tiene los mismos establecimientos.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIntento((x) => x + 1)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/40"
                  >
                    <RotateCw size={15} aria-hidden /> Volver a intentar
                  </button>
                  <Link href={enLista} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep">
                    <List size={15} aria-hidden /> Ver la lista
                  </Link>
                </div>
              </div>
            )}
          </div>
          <p className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={renipressAl} />
            <span className="text-rotulo text-mute">Arrastra para moverte; rueda, pellizco o botones para acercar.</span>
          </p>
        </div>

        {/* ── Panel: la ficha breve y la leyenda ────────────────────────────────────── */}
        <aside className="min-w-0 space-y-4" aria-label="Detalle y leyenda del mapa">
          {codigo ? (
            <section
              aria-label="Establecimiento elegido"
              aria-live="polite"
              className="rounded-2xl border border-line bg-paper p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-overlay max-lg:max-h-[72vh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0 max-lg:pb-[calc(env(safe-area-inset-bottom)+1rem)] max-lg:shadow-dialog sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-meta font-semibold text-inkSoft">IPRESS {codigo}</p>
                <button
                  type="button"
                  onClick={() => setCodigo(null)}
                  aria-label="Cerrar la ficha breve"
                  className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-mute hover:bg-ink/[0.06] hover:text-ink"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>
              {!detalle || detalle.estado === "cargando" ? (
                <div role="status" className="space-y-2.5 py-1">
                  <span className="sr-only">Cargando la ficha breve…</span>
                  <span aria-hidden className="block h-5 w-4/5 rounded-md bg-ink/[0.07] motion-safe:animate-pulse" />
                  <span aria-hidden className="block h-4 w-3/5 rounded-md bg-ink/[0.07] motion-safe:animate-pulse" />
                  <span aria-hidden className="block h-4 w-2/5 rounded-md bg-ink/[0.07] motion-safe:animate-pulse" />
                </div>
              ) : detalle.estado === "error" ? (
                <div className="py-1">
                  <p className="text-dato text-inkSoft">No pudimos leer este establecimiento ahora.</p>
                  <Link href={rutaEn(base, rutaFicha(codigo))} className="mt-3 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                    Abrir su ficha <ArrowRight size={15} aria-hidden />
                  </Link>
                </div>
              ) : (
                <FichaBreve x={detalle.fila} base={base} renipressAl={renipressAl} sancionesAl={sancionesAl} />
              )}
            </section>
          ) : (
            <p className="hidden items-start gap-2.5 rounded-2xl border border-dashed border-line bg-paper px-4 py-3.5 text-dato leading-relaxed text-inkSoft lg:flex">
              <MousePointerClick size={17} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              <span>Haz clic en un punto para ver qué establecimiento es, su estado y sus sanciones firmes.</span>
            </p>
          )}

          <section aria-labelledby="leyenda-t" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h2 id="leyenda-t" className="font-display text-bloque font-bold text-ink">
              Cómo leer el mapa
            </h2>
            <ul className="mt-3 space-y-2 text-dato">
              <Leyenda color="--serie-1" etiqueta="Público" n={conteos.publico} />
              <Leyenda color="--serie-3" etiqueta="Privado" n={conteos.privado} />
              <Leyenda color="--serie-4" etiqueta="Otro sector" n={conteos.otro} />
              <li className="flex items-center justify-between gap-3 border-t border-line pt-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className="relative grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-rust">
                    <span className="h-1.5 w-1.5 rounded-full bg-mute" />
                  </span>
                  <span className="min-w-0">
                    <span className="inline-flex items-center gap-1 font-semibold text-crimsonTexto">
                      <Gavel size={13} aria-hidden /> Con sanción firme
                    </span>
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-ink">{numero(conteos.sancion)}</span>
              </li>
              {filtros.todos && (
                <li className="flex items-center justify-between gap-3 text-inkSoft">
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-mute/40" />
                    Inactivos (más tenues)
                  </span>
                  <span className="tabular-nums">{numero(conteos.inactivas)}</span>
                </li>
              )}
            </ul>
            <p className="mt-3 text-meta leading-relaxed text-inkSoft">
              La sanción es de la institución, no de sus médicos.{" "}
              {sancionesAl && <>Registro de Sanciones de SUSALUD al {fechaCorta(sancionesAl)}.</>}
            </p>
            {datos && datos.sinUbicacion > 0 && (
              <p className="mt-3 rounded-xl bg-paperSoft px-3 py-2.5 text-meta leading-relaxed text-inkSoft">
                <b className="font-semibold tabular-nums text-ink">{numero(datos.sinUbicacion)}</b> establecimientos con estos filtros no tienen ubicación
                en RENIPRESS y no aparecen en el mapa: están en la lista.
              </p>
            )}
            {filtros.quirurgico && cobertura && (
              <p className="mt-3 text-meta leading-relaxed text-inkSoft">
                El centro quirúrgico se conoce sólo de los establecimientos cuyo detalle ya leímos: {numero(cobertura.leidas)} de {numero(cobertura.total)}.
              </p>
            )}
            <Link
              href={enLista}
              className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate"
            >
              <List size={16} aria-hidden /> Ver estos establecimientos en una lista
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

const CAMPO =
  "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-caja px-3 py-2.5 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";

function Conmutador({ marcado, cambiar, children }: { marcado: boolean; cambiar: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-caja px-3.5 text-dato text-ink transition-colors duration-rapido hover:border-granate/40 has-[:checked]:border-granate/50 has-[:checked]:bg-granate-50 has-[:checked]:font-semibold">
      <input type="checkbox" checked={marcado} onChange={(e) => cambiar(e.target.checked)} className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]" />
      {children}
    </label>
  );
}

function BotonMapa({ etiqueta, onClick, borde = false, children }: { etiqueta: string; onClick: () => void; borde?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn("grid h-11 w-11 place-items-center text-ink transition-colors duration-rapido hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate", borde && "border-t border-line")}
    >
      {children}
    </button>
  );
}

function Leyenda({ color, etiqueta, n }: { color: string; etiqueta: string; n: number }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: `rgb(var(${color}))` }} />
        <span className="min-w-0 text-ink">{etiqueta}</span>
      </span>
      <span className="font-semibold tabular-nums text-ink">{numero(n)}</span>
    </li>
  );
}

/** Lo básico de un establecimiento, con el enlace a su ficha completa. */
function FichaBreve({ x, base, renipressAl, sancionesAl }: { x: FilaIpress; base: string; renipressAl: string | null; sancionesAl: string | null }) {
  return (
    <div>
      <h3 className="mt-1 font-display text-bloque font-bold leading-snug text-ink">{nombrePropio(x.nombre)}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <InsigniaCategoria categoria={x.categoria} />
        <InsigniaSector sector={x.sector} />
        <InsigniaRegistro activo={x.activo} estado={x.estado} />
      </div>
      <dl className="mt-3 space-y-1.5 text-meta">
        <div>
          <dt className="sr-only">Lugar</dt>
          <dd className="text-ink">{lugarIpress(x)}</dd>
          {x.direccion && <dd className="text-inkSoft">{nombrePropio(x.direccion)}</dd>}
        </div>
        {x.clasificacion && (
          <div>
            <dt className="sr-only">Qué es</dt>
            <dd className="text-inkSoft">{nombrePropio(x.clasificacion)}</dd>
          </div>
        )}
        {x.horario && (
          <div>
            <dt className="sr-only">Horario</dt>
            <dd className="text-inkSoft">Horario: {x.horario.toLocaleLowerCase("es-PE")}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        {x.sanciones > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-meta text-inkSoft">
            <ConteoSanciones n={x.sanciones} />
            {x.ultimaSancion && <span>la más reciente del {fechaCorta(x.ultimaSancion)}</span>}
          </p>
        ) : (
          <p className="text-meta leading-relaxed text-inkSoft">
            No figura en el Registro de Sanciones de SUSALUD revisado el {sancionesAl ? fechaCorta(sancionesAl) : "último viernes"}.
          </p>
        )}
        {(x.denuncias ?? 0) > 0 && <ConteoDenuncias n={x.denuncias ?? 0} anio={x.denunciasDe} />}
        {(x.quirurgico != null || x.internamiento) && (
          <p className="flex flex-wrap gap-1.5">
            <InsigniaQuirurgico quirurgico={x.quirurgico} />
            {x.internamiento && <InsigniaInternamiento />}
          </p>
        )}
      </div>
      <p className="mt-3">
        <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={renipressAl} />
      </p>
      <Link
        href={rutaEn(base, rutaFicha(x.codigo))}
        className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-full bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
      >
        Ver su verificación completa <ArrowRight size={15} aria-hidden />
      </Link>
    </div>
  );
}
