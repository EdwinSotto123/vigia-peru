"use client";

import type { ReactNode } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { cargarMe, type Me } from "@/lib/gobserva-cuenta";
import { COOKIE_SESION, type Producto } from "@/lib/gobserva";
import { NIVEL, NIVELES_ORDEN, REGIONES_EMPLEO, nombreRegion as nombreRegionEmpleo, slugRegion } from "@/lib/empleo";
import { REGIONES_UBIGEO, TIPOS, nombreRegion as nombreRegionLic, nombreTipo } from "@/lib/licitaciones";
import { FASES, MODALIDADES, NIVELES, ORDEN_FASES, PESTANAS, SECTORES, TIPOS_PROYECTO, nombreNivel, nombreSector } from "@/lib/gobserva-obras";
import { SENAL_PLAZA, TIPOS_PLAZA, type TipoPlaza } from "@/lib/planilla";
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

/** Pone o borra la marca de sesión (lib/gobserva.ts, COOKIE_SESION) que lee el middleware. */
export function marcarSesion(abierta: boolean) {
  try {
    const seguro = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = abierta
      ? `${COOKIE_SESION}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${seguro}`
      : `${COOKIE_SESION}=; Path=/; Max-Age=0; SameSite=Lax${seguro}`;
  } catch {
    // Sin cookies: la portada se queda como está.
  }
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
  /** No va en el formulario de la alerta, pero se conserva: la entidad, que se elige desde su página o su lista. */
  oculto?: boolean;
}

/** La entidad de una alerta, por su RUC (el de una institución pública, no un dato personal). */
const ENTIDAD: CampoFiltro = { clave: "entidad", etiqueta: "Entidad", tipo: "texto", oculto: true, mostrar: (v) => `Entidad con RUC ${v}` };
const CIERRE: Record<string, string> = { hoy: "Cierran hoy", "2dias": "Cierran en 2 días", semana: "Cierran esta semana" };
/** Un CUI (el código único de inversión del MEF): una búsqueda que sigue a un solo proyecto. */
const esCui = (v: string | undefined) => !!v && /^\d{6,8}$/.test(v.trim());

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
      // Lo que tiene quien busca: las plazas que piden su nivel o uno menor (antes `nivel`, el nivel exacto de la plaza).
      clave: "tengo", etiqueta: "Tus estudios", tipo: "opcion",
      opciones: NIVELES_ORDEN.filter((n) => n !== "sin_dato").map((n) => ({ valor: n, etiqueta: NIVEL[n].largo })),
      mostrar: (v) => `Con ${NIVEL[v as keyof typeof NIVEL]?.corto.toLocaleLowerCase("es") ?? v}`,
    },
    // El nivel exacto que pide la plaza: llega de la lista («Qué estudios piden» de la portada) y de alertas viejas.
    { clave: "nivel", etiqueta: "Estudios que piden", tipo: "opcion", oculto: true, mostrar: (v) => `Piden ${NIVEL[v as keyof typeof NIVEL]?.corto.toLocaleLowerCase("es") ?? v}` },
    { clave: "sueldo", etiqueta: "Sueldo mínimo (S/)", tipo: "numero", placeholder: "2500", mostrar: (v) => `Desde S/ ${MILES.format(Number(v))}` },
    { clave: "exp", etiqueta: "Años de experiencia que tienes", tipo: "numero", placeholder: "2", mostrar: (v) => `Hasta ${v} ${v === "1" ? "año" : "años"} de experiencia` },
    {
      clave: "cierra", etiqueta: "Cierran", tipo: "opcion",
      opciones: [{ valor: "hoy", etiqueta: "Hoy" }, { valor: "2dias", etiqueta: "En los próximos 2 días" }, { valor: "semana", etiqueta: "Esta semana" }],
      mostrar: (v) => CIERRE[v] ?? v,
    },
    {
      clave: "senal", etiqueta: "Señal de Vigía", tipo: "opcion",
      opciones: TIPOS_PLAZA.map((t) => ({ valor: t, etiqueta: SENAL_PLAZA[t].corto })),
      mostrar: (v) => SENAL_PLAZA[v as TipoPlaza]?.corto ?? v,
    },
    ENTIDAD,
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
    ENTIDAD,
  ],
  obras: [
    { clave: "q", etiqueta: "Qué obras (o un CUI)", tipo: "texto", placeholder: "Agua potable, colegio, 2470018", mostrar: (v) => (esCui(v) ? `CUI ${v.trim()}` : `«${v}»`) },
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
    {
      clave: "modalidad", etiqueta: "Modalidad", tipo: "opcion",
      opciones: MODALIDADES.map((m) => ({ valor: m.clave, etiqueta: m.nombre })),
      mostrar: (v) => MODALIDADES.find((m) => m.clave === v)?.nombre ?? v,
    },
    // «Cualquiera» en el formulario = todos los proyectos (lo que hace la API sin pestaña).
    {
      clave: "pestana", etiqueta: "Qué proyectos", tipo: "opcion",
      opciones: PESTANAS.filter((x) => x.clave !== "todos").map((x) => ({ valor: x.clave, etiqueta: x.nombre })),
      mostrar: (v) => PESTANAS.find((x) => x.clave === v)?.nombre ?? v,
    },
    ENTIDAD,
  ],
};

/** Los filtros de una alerta como chips legibles. */
export function chipsFiltros(producto: Producto, filtros: Record<string, unknown>): string[] {
  return FILTROS[producto]
    .filter((c) => filtros[c.clave] != null && filtros[c.clave] !== "")
    .map((c) => (c.mostrar ? c.mostrar(String(filtros[c.clave])) : `${c.etiqueta}: ${String(filtros[c.clave])}`));
}

/**
 * De los parámetros de una búsqueda (la URL de la lista), sólo los que sirven para una alerta. En Obras la lista sin
 * pestaña muestra «Se vienen»: la alerta se queda con esa, salvo que se siga un CUI (avisa cuando cambia de fase, en
 * cualquier pestaña); «todos» es lo mismo que no tener pestaña.
 */
export function filtrosDeBusqueda(producto: Producto, params: Record<string, string | undefined>): Record<string, string> {
  const validas = new Set(FILTROS[producto].map((c) => c.clave));
  const f = Object.fromEntries(Object.entries(params).filter(([k, v]) => validas.has(k) && v != null && v !== "")) as Record<string, string>;
  if (producto === "obras") {
    if (f.pestana === "todos" || esCui(f.q)) delete f.pestana;
    else if (!f.pestana) f.pestana = "se_vienen";
  }
  return f;
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
