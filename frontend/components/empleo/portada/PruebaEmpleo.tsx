import { Pruebalo, type OpcionPrueba } from "@/components/gobserva/portada/Pruebalo";
import {
  NIVEL,
  NIVELES_PERSONA,
  diasParaCierre,
  entidadNombre,
  plazasHasta,
  puesto,
  textoCierre,
  type NivelPersona,
  type ResumenEmpleo,
} from "@/lib/empleo";
import { numero } from "@/lib/formato";

/** Lo que responde quien llega: hasta dónde estudió. «Universidad» es egresado o estudiante (lo más bajo que acepta). */
const RESPUESTAS: { nivel: NivelPersona; etiqueta: string }[] = [
  { nivel: "secundaria", etiqueta: "Secundaria" },
  { nivel: "tecnica", etiqueta: "Técnica" },
  { nivel: "egresado", etiqueta: "Universidad" },
  { nivel: "bachiller", etiqueta: "Bachiller" },
  { nivel: "titulo", etiqueta: "Título" },
];

/** Un puesto largo («Ejecutivo en asuntos jurídicos para la dirección general de…»), cortado en una palabra. */
function corto(s: string, max = 56): string {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  return `${c.slice(0, Math.max(c.lastIndexOf(" "), 24)).replace(/[,;:\s]+$/, "")}…`;
}

/** Un sueldo creíble para citarlo (SERVIR trae algunos «9999999»). */
const sueldoCreible = (s: number | null) => s != null && s >= 500 && s <= 50_000;

/**
 * El «Pruébalo» del héroe de Gobserva Empleo (2026-11-22): «¿Hasta dónde estudiaste?» y, para cada respuesta, a cuántas
 * plazas abiertas puedes postular hoy (las que piden ese nivel o uno menor, `plazasHasta`), un caso real (la primera que
 * cierra de las que puedes postular) o, si no hay, lo que paga la mitad de las de ese nivel, y el enlace a /plazas con
 * `tengo`. Todo sale de GET /empleo/resumen: sin resumen o sin conteos, no se muestra. Server-safe.
 */
export function PruebaEmpleo({ e, plazas, className }: { e: ResumenEmpleo | null; plazas: string; className?: string }) {
  if (!e?.porNivel?.length) return null;
  const opciones: OpcionPrueba[] = RESPUESTAS.flatMap(({ nivel, etiqueta }) => {
    const n = plazasHasta(e.porNivel, nivel);
    if (!n) return [];
    const hasta = NIVELES_PERSONA.indexOf(nivel);
    const caso = e.cierranPronto.find((p) => p.nivel !== "sin_dato" && NIVELES_PERSONA.indexOf(p.nivel as NivelPersona) <= hasta);
    const mediana = e.porNivel.find((c) => c.clave === nivel)?.mediana;
    const detalle = caso ? (
      <>
        La que cierra primero: <b className="font-semibold text-paper">{corto(puesto(caso.titulo))}</b> ({entidadNombre(caso.entidad)})
        {sueldoCreible(caso.remuneracion) ? `, S/ ${numero(Math.round(caso.remuneracion as number))} al mes` : ""}.{" "}
        {textoCierre(diasParaCierre(caso.fechaFin))}.
      </>
    ) : mediana && sueldoCreible(mediana) ? (
      <>
        La mitad de las que piden {NIVEL[nivel].largo.toLowerCase()} paga <b className="font-semibold text-paper">S/ {numero(Math.round(mediana))}</b> al mes o
        más.
      </>
    ) : undefined;
    return [
      {
        etiqueta,
        cifra: numero(n),
        unidad: n === 1 ? "plaza que puedes postular hoy" : "plazas que puedes postular hoy",
        detalle,
        href: `${plazas}?tengo=${nivel}`,
        accion: n === 1 ? "Ver esa plaza" : `Ver mis ${numero(n)} plazas`,
      },
    ];
  });
  if (!opciones.length) return null;
  return <Pruebalo oscuro pregunta="¿Hasta dónde estudiaste?" opciones={opciones} auto={3800} className={className} />;
}
