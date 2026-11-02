"use client";

import type { ReactNode } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { cargarMe, type Me } from "@/lib/gobserva-cuenta";
import type { Producto } from "@/lib/gobserva";
import { NIVEL, NIVELES_ORDEN, REGIONES_EMPLEO, nombreRegion as nombreRegionEmpleo, slugRegion } from "@/lib/empleo";
import { REGIONES_UBIGEO, TIPOS, nombreRegion as nombreRegionLic, nombreTipo } from "@/lib/licitaciones";
import { FASES, NIVELES, ORDEN_FASES, SECTORES, TIPOS_PROYECTO, nombreNivel, nombreSector } from "@/lib/gobserva-obras";
import { cn } from "@/lib/utils";

/** Los campos de los formularios de la cuenta (los mismos de la lista de espera). */
export const CAMPO =
  "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
export const ETIQUETA = "mb-1.5 block text-meta font-semibold text-ink";

/** Un aviso en su tono: error (rojo), ok (verde) o nota (neutro). */
export function Aviso({ tono = "nota", children, className }: { tono?: "error" | "ok" | "nota"; children: ReactNode; className?: string }) {
  const Icono = tono === "error" ? AlertTriangle : tono === "ok" ? CheckCircle2 : Info;
  return (
    <p
      role={tono === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-dato leading-relaxed",
        tono === "error" && "border-crimson/30 bg-crimson-soft text-crimsonTexto",
        tono === "ok" && "border-granate/30 bg-granate-50 text-ink",
        tono === "nota" && "border-line bg-paperSoft text-inkSoft",
        className,
      )}
    >
      <Icono size={17} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** La sesión de Firebase, con lo que importa para Gobserva: una cuenta de Vigía (correo sintético) no sirve aquí. */
export function useSesion() {
  const { user, loading } = useAuth();
  const esVigia = !!user?.email && /@vigia\.local$/i.test(user.email);
  return { user, loading, esVigia, conCuenta: !!user && !esVigia };
}

/** La cuenta en este producto (perfil, planes, límites y uso). Se revalida al volver a la pestaña. */
export function useMe(producto: Producto) {
  const { user, conCuenta } = useSesion();
  const r = useSWR<Me>(conCuenta && user ? ["gobserva-me", user.uid, producto] : null, () => cargarMe(producto), {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  return { ...r, me: r.data ?? null };
}

/** Un bloque gris mientras carga. */
export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl bg-paperDeep", className)} />;
}

// ─── Filtros de las alertas, por producto ────────────────────────────────────────────────────────────────────────────

export interface CampoFiltro {
  clave: string;
  etiqueta: string;
  tipo: "texto" | "numero" | "opcion";
  placeholder?: string;
  opciones?: { valor: string; etiqueta: string }[];
  /** Cómo se muestra el valor en un chip: «Cusco», «Desde S/ 3,000». */
  mostrar?: (v: string) => string;
}

const MILES = new Intl.NumberFormat("es-PE");

export const FILTROS: Record<Producto, CampoFiltro[]> = {
  empleo: [
    { clave: "q", etiqueta: "Palabras", tipo: "texto", placeholder: "Abogado, enfermera, chofer", mostrar: (v) => `«${v}»` },
    {
      clave: "region", etiqueta: "Región", tipo: "opcion",
      opciones: REGIONES_EMPLEO.map((r) => ({ valor: slugRegion(r), etiqueta: nombreRegionEmpleo(r) })),
      mostrar: (v) => nombreRegionEmpleo(v.replace(/-/g, " ").toUpperCase()),
    },
    {
      clave: "nivel", etiqueta: "Estudios que tienes", tipo: "opcion",
      opciones: NIVELES_ORDEN.filter((n) => n !== "sin_dato").map((n) => ({ valor: n, etiqueta: NIVEL[n].largo })),
      mostrar: (v) => NIVEL[v as keyof typeof NIVEL]?.corto ?? v,
    },
    { clave: "sueldo", etiqueta: "Sueldo mínimo (S/)", tipo: "numero", placeholder: "2500", mostrar: (v) => `Desde S/ ${MILES.format(Number(v))}` },
    { clave: "exp", etiqueta: "Años de experiencia que tienes", tipo: "numero", placeholder: "2", mostrar: (v) => `Hasta ${v} ${v === "1" ? "año" : "años"} de experiencia` },
  ],
  licitaciones: [
    { clave: "q", etiqueta: "Qué vendes", tipo: "texto", placeholder: "Combustible, uniformes, obras viales", mostrar: (v) => `«${v}»` },
    {
      clave: "region", etiqueta: "Región", tipo: "opcion",
      opciones: REGIONES_UBIGEO.map((r) => ({ valor: r.ubigeo, etiqueta: r.nombre })),
      mostrar: (v) => nombreRegionLic(v),
    },
    { clave: "tipo", etiqueta: "Tipo", tipo: "opcion", opciones: TIPOS.map((t) => ({ valor: t.clave, etiqueta: t.nombre })), mostrar: (v) => nombreTipo(v) },
    { clave: "min", etiqueta: "Valor desde (S/)", tipo: "numero", placeholder: "50000", mostrar: (v) => `Desde S/ ${MILES.format(Number(v))}` },
    { clave: "max", etiqueta: "Valor hasta (S/)", tipo: "numero", placeholder: "2000000", mostrar: (v) => `Hasta S/ ${MILES.format(Number(v))}` },
  ],
  obras: [
    { clave: "q", etiqueta: "Qué obras", tipo: "texto", placeholder: "Agua potable, colegio, carretera", mostrar: (v) => `«${v}»` },
    {
      clave: "region", etiqueta: "Región", tipo: "opcion",
      opciones: REGIONES_UBIGEO.map((r) => ({ valor: r.ubigeo, etiqueta: r.nombre })),
      mostrar: (v) => nombreRegionLic(v),
    },
    { clave: "sector", etiqueta: "Sector", tipo: "opcion", opciones: SECTORES.map((x) => ({ valor: x.clave, etiqueta: x.nombre })), mostrar: (v) => nombreSector(v) },
    { clave: "nivel", etiqueta: "Quién la hace", tipo: "opcion", opciones: NIVELES.map((x) => ({ valor: x.clave, etiqueta: x.nombre })), mostrar: (v) => nombreNivel(v) },
    {
      clave: "fase", etiqueta: "Fase", tipo: "opcion",
      opciones: ORDEN_FASES.map((f) => ({ valor: f, etiqueta: FASES[f].nombre })),
      mostrar: (v) => FASES[v as keyof typeof FASES]?.corto ?? v,
    },
    { clave: "tipo", etiqueta: "Tipo", tipo: "opcion", opciones: TIPOS_PROYECTO.map((x) => ({ valor: x.clave, etiqueta: x.nombre })), mostrar: (v) => (v === "equipamiento" ? "Compra de equipos" : "Obras") },
    { clave: "min", etiqueta: "Costo desde (S/)", tipo: "numero", placeholder: "1000000", mostrar: (v) => `Desde S/ ${MILES.format(Number(v))}` },
    { clave: "max", etiqueta: "Costo hasta (S/)", tipo: "numero", placeholder: "50000000", mostrar: (v) => `Hasta S/ ${MILES.format(Number(v))}` },
  ],
};

/** Los filtros de una alerta como chips legibles. */
export function chipsFiltros(producto: Producto, filtros: Record<string, unknown>): string[] {
  return FILTROS[producto]
    .filter((c) => filtros[c.clave] != null && filtros[c.clave] !== "")
    .map((c) => (c.mostrar ? c.mostrar(String(filtros[c.clave])) : `${c.etiqueta}: ${String(filtros[c.clave])}`));
}

/** De los parámetros de una búsqueda (la URL de la lista), sólo los que sirven para una alerta. */
export function filtrosDeBusqueda(producto: Producto, params: Record<string, string | undefined>): Record<string, string> {
  const validas = new Set(FILTROS[producto].map((c) => c.clave));
  return Object.fromEntries(Object.entries(params).filter(([k, v]) => validas.has(k) && v != null && v !== "")) as Record<string, string>;
}

/** El nombre de la alerta que se propone para una búsqueda: «combustible en Cusco». */
export function nombreSugerido(producto: Producto, filtros: Record<string, string>): string {
  const partes = chipsFiltros(producto, filtros).map((c) => c.replace(/[«»]/g, ""));
  return (partes.slice(0, 2).join(", ") || { empleo: "Plazas nuevas", licitaciones: "Oportunidades nuevas", obras: "Proyectos nuevos" }[producto]).slice(0, 80);
}

/** Cómo llamar a lo que avisa cada producto. */
export const COSAS: Record<Producto, { una: string; varias: string; lista: string }> = {
  empleo: { una: "plaza", varias: "plazas", lista: "/plazas" },
  licitaciones: { una: "oportunidad", varias: "oportunidades", lista: "/oportunidades" },
  obras: { una: "proyecto", varias: "proyectos", lista: "/proyectos" },
};
