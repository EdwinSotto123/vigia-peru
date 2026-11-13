import { Vistas } from "@/components/listado/Vistas";

/**
 * Las franjas de vistas que comparten varias rutas (2026-11-12, pedido del usuario: «el diseño estándar debería verse
 * como Partidos y gobiernos»; «evitar que saltemos de página»). Cada grupo era antes varias entradas del menú lateral
 * con páginas sueltas; ahora es UNA entrada y sus páginas son vistas de la misma franja, en el mismo lugar bajo la
 * cabecera, así que pasar de una a otra se lee como cambiar de pestaña.
 */

export type VistaComoTrabaja = "metodologia" | "fuentes" | "ia" | "auditoria" | "preguntas" | "glosario" | "privacidad";

const COMO_TRABAJA: { clave: VistaComoTrabaja; href: string; etiqueta: string }[] = [
  { clave: "metodologia", href: "/metodologia", etiqueta: "Metodología" },
  { clave: "fuentes", href: "/fuentes", etiqueta: "Fuentes" },
  { clave: "ia", href: "/app/ia", etiqueta: "Lo que leyó la IA" },
  { clave: "auditoria", href: "/app/auditoria", etiqueta: "Auditoría en vivo" },
  { clave: "preguntas", href: "/preguntas", etiqueta: "Preguntas" },
  { clave: "glosario", href: "/glosario", etiqueta: "Glosario" },
  { clave: "privacidad", href: "/privacidad", etiqueta: "Privacidad" },
];

/** Las rutas de «Cómo trabaja Vigía», para marcar activa su entrada del menú. */
export const RUTAS_COMO_TRABAJA = COMO_TRABAJA.map((v) => v.href);

export function VistasComoTrabaja({ activa }: { activa: VistaComoTrabaja }) {
  return <Vistas etiqueta="Cómo trabaja Vigía" vistas={COMO_TRABAJA.map((v) => ({ href: v.href, etiqueta: v.etiqueta, activa: v.clave === activa }))} />;
}

export type VistaSenales = "publicadas" | "revision" | "semana";

/**
 * Señales: las publicadas, las que están en revisión y lo nuevo de la semana. «Lo nuevo» era otra entrada del menú con
 * otra lista de contratos con antecedentes: es la misma pregunta («qué revisar») acotada a la última semana publicada.
 */
export function VistasSenales({ activa, publicadas, enRevision }: { activa: VistaSenales; publicadas?: number | null; enRevision?: number | null }) {
  return (
    <Vistas
      etiqueta="Qué señales ver"
      vistas={[
        { href: "/app/hallazgos", etiqueta: "Publicadas", conteo: publicadas, activa: activa === "publicadas" },
        { href: "/app/novedades", etiqueta: "Lo nuevo de la semana", activa: activa === "semana" },
        { href: "/app/hallazgos?vista=revision", etiqueta: "En revisión", conteo: enRevision, activa: activa === "revision" },
      ]}
    />
  );
}

export type VistaApoyo = "aportar" | "aliados" | "aportes" | "costos";

/**
 * Apoyar: aportar, el podio de aliados, todos los aportes y cuánto cuesta Vigía (2026-11-13, auditoría visual: «los
 * bloques de apoyo hasta tres veces»). Eran cuatro páginas (/app/apoyar, /app/aliados, /app/aliados/aportes y
 * /app/cuanto-cuesta) con dos entradas del menú y la meta del mes repetida en tres; ahora son pestañas de UNA página
 * (`?seccion=`) y las rutas viejas redirigen a la suya (next.config.js).
 */
export const HREF_APOYO: Record<VistaApoyo, string> = {
  aportar: "/app/apoyar",
  aliados: "/app/apoyar?seccion=aliados",
  aportes: "/app/apoyar?seccion=aportes",
  costos: "/app/apoyar?seccion=costos",
};

export const ETIQUETA_APOYO: Record<VistaApoyo, string> = {
  aportar: "Aportar",
  aliados: "Podio de aliados",
  aportes: "Todos los aportes",
  costos: "Cuánto cuesta",
};

export const VISTAS_APOYO = Object.keys(HREF_APOYO) as VistaApoyo[];

export function VistasApoyo({ activa }: { activa: VistaApoyo }) {
  return <Vistas etiqueta="Apoyar a Vigía" vistas={VISTAS_APOYO.map((v) => ({ href: HREF_APOYO[v], etiqueta: ETIQUETA_APOYO[v], activa: v === activa }))} />;
}
