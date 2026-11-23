import Link from "next/link";
import { Pruebalo, type OpcionPrueba } from "@/components/gobserva/portada/Pruebalo";
import { numero, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { getProyectos, lugarProyecto, nombreProyecto, paramsApi, type ResumenObras } from "@/lib/gobserva-obras";
import { nombreRegion } from "@/lib/licitaciones";

/** Un nombre de proyecto del MEF puede pasar las 30 palabras: en la portada, hasta ~90 letras y en una palabra entera. */
function corto(s: string, max = 90): string {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  return `${c.slice(0, Math.max(c.lastIndexOf(" "), 40)).replace(/[,;:\s]+$/, "")}…`;
}

/** Lo que alguien construye, dicho como lo diría, y el sector del MEF que lo agrupa (la función de Invierte.pe). */
const QUE_CONSTRUYES: { etiqueta: string; sector: string; de: string }[] = [
  { etiqueta: "Agua y desagüe", sector: "saneamiento", de: "agua y saneamiento" },
  { etiqueta: "Pistas y carreteras", sector: "transporte", de: "transporte" },
  { etiqueta: "Colegios", sector: "educacion", de: "educación" },
  { etiqueta: "Postas y hospitales", sector: "salud", de: "salud" },
  { etiqueta: "Riego", sector: "agro", de: "agro y riego" },
];

/**
 * «¿Qué construyes?» en el héroe de Gobserva Obras (2026-11-22, portadas vivas): cada respuesta es un sector y, debajo,
 * cuántos proyectos de ese sector se vienen hoy (viables o con expediente técnico, sin contratista), por cuánta plata, el
 * más grande que ya tiene expediente técnico y el enlace a la lista con ese filtro. Las cifras son las del resumen de la
 * portada; el proyecto, un GET /proyectos/lista por sector (los cinco a la vez, en la misma caché de 10 minutos). Si uno
 * falla, esa respuesta sale sin su proyecto; sin resumen, no se muestra.
 */
export async function PruebaObras({ r, base, className }: { r: ResumenObras | null; base: string; className?: string }) {
  if (!r) return null;
  const filas = QUE_CONSTRUYES.map((q) => ({ q, x: r.porSector.find((s) => s.clave === q.sector) })).filter(
    (f): f is { q: (typeof QUE_CONSTRUYES)[number]; x: NonNullable<typeof f.x> } => !!f.x && f.x.seVienen > 0,
  );
  if (filas.length < 2) return null;
  const mayores = await Promise.all(
    filas.map(({ q }) =>
      getProyectos(paramsApi({ sector: q.sector, fase: "expediente" }, 1))
        .then((p) => p?.data[0] ?? null)
        .catch(() => null),
    ),
  );
  const ruta = (p: string) => rutaEn(base, p);
  const opciones: OpcionPrueba[] = filas.map(({ q, x }, i) => {
    const p = mayores[i];
    return {
      etiqueta: q.etiqueta,
      cifra: numero(x.seVienen),
      unidad: (
        <>
          proyectos de {q.de} se vienen, por <span className="whitespace-nowrap">{solesCompacto(x.seVienenMonto)}</span>
        </>
      ),
      detalle: p ? (
        <>
          El más grande con expediente técnico:{" "}
          <Link href={ruta(`/proyecto/${p.cui}`)} className="font-semibold text-paper underline decoration-paper/40 underline-offset-2 hover:decoration-paper">
            {corto(nombreProyecto(p.nombre, p))}
          </Link>
          , en {p.region ? nombreRegion(p.region) : lugarProyecto(p)}
          {p.costo ? `, por ${solesCompacto(p.costo)}` : ""}.
        </>
      ) : undefined,
      href: ruta(`/proyectos?sector=${q.sector}`),
      accion: `Ver los ${numero(x.seVienen)} proyectos`,
    };
  });
  return <Pruebalo oscuro pregunta="¿Qué construyes? Mira lo que se viene hoy" opciones={opciones} auto={4200} className={className} />;
}
