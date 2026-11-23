import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Database, Lock } from "lucide-react";
import { Migas } from "@/components/patrones/Migas";
import { CONSULTAS } from "@/components/car/consultas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { fechaCorta, numero } from "@/lib/gobserva-salud";
import { datosCar } from "@/lib/car-datos";

export const metadata: Metadata = {
  title: "Fuentes",
  description: "De dónde sale cada dato de Gobserva Car: los datos abiertos que cargamos y las consultas oficiales que enlazamos.",
  alternates: { canonical: urlCanonica("car", "/fuentes") },
};

// Las cifras y las fechas salen de las listas del MTC, que la fuente mtc_car vuelve a bajar cada lunes (lib/car-datos.ts).
export const revalidate = 3600;

/** De dónde sale cada cosa (Gobserva Car): lo que cargamos, con su fecha, y lo que sólo enlazamos porque pide captcha. */
export default async function FuentesCar() {
  const base = baseProducto("car");
  const [datos, licencia, gas] = await Promise.all([datosCar("citv"), datosCar("licencia"), datosCar("gas")]);
  const d = datos as { fuente: string; url: string; generadoAl: string | null; centros: unknown[] };
  // Cuándo las bajó la fuente mtc_car por última vez (el respaldo que trae la web no lo dice), en hora de Lima.
  const revisadas = [datos, licencia, gas].map((x) => x.actualizadoAl).filter((x): x is string => !!x).sort()[0];
  const revisadasLima = revisadas ? new Date(Date.parse(revisadas) - 5 * 3600_000).toISOString().slice(0, 10) : null;
  // Las listas del MTC que cargamos (Excel sin captcha): cuántos locales, qué traen y la fecha del archivo.
  const cargadas: { nombre: string; url: string; generadoAl: string | null; n: number; trae: string; ruta: string }[] = [
    { nombre: d.fuente, url: d.url, generadoAl: d.generadoAl, n: d.centros.length, trae: "Dirección, horario, líneas, resolución, días sin transmitir y sanción.", ruta: "/revision-tecnica" },
    { ...licencia.fuentes.medicos, n: licencia.medicos.length, trae: "Nombre y dirección.", ruta: "/licencia" },
    { ...licencia.fuentes.evaluacion, n: licencia.evaluacion.length, trae: "Nombre y dirección.", ruta: "/licencia?seccion=evaluacion" },
    { ...licencia.fuentes.escuelas, n: licencia.escuelas.length, trae: "Nombre y dirección.", ruta: "/licencia?seccion=escuelas" },
    { ...gas.fuentes.talleres, n: gas.talleres.length, trae: "Dirección, gas autorizado, resolución y teléfono.", ruta: "/gas" },
    { ...gas.fuentes.certificadoras, n: gas.certificadoras.length, trae: "Dirección, gas autorizado, resolución y teléfono.", ruta: "/gas?seccion=certificadoras" },
    { ...gas.fuentes.cilindros, n: gas.cilindros.length, trae: "Dirección, resolución y teléfono.", ruta: "/gas?seccion=cilindros" },
  ];
  return (
    <div className="container-page pb-12 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Fuentes" }]} />
      <h1 className="mt-4 font-display text-seccion font-bold leading-tight text-ink">Fuentes</h1>
      <p className="mt-1 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
        Cada dato de Gobserva Car sale de una fuente oficial, con su fecha. Gobserva no es una entidad del Estado: ordena datos públicos y enlaza
        siempre a la fuente.
      </p>

      <section aria-labelledby="cargamos-t" className="mt-8">
        <h2 id="cargamos-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <Database size={18} aria-hidden className="text-granate" /> Lo que cargamos
        </h2>
        <p className="mt-1 max-w-[70ch] text-meta text-inkSoft">
          Listas que el MTC publica en Excel, sin captcha. Las volvemos a bajar solas cada lunes
          {revisadasLima ? <> (la última vez, el {fechaCorta(revisadasLima)})</> : null}, tal cual, y les tapamos los celulares; no guardamos el RUC,
          los correos ni el nombre de una persona natural con negocio.
        </p>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {cargadas.map((c) => (
            <li key={c.url + c.nombre} className="flex min-w-0 flex-col rounded-2xl border border-line bg-paper p-4">
              <p className="text-cuerpo font-bold leading-snug text-ink">{c.nombre}</p>
              <p className="mt-1 text-meta text-inkSoft">
                <b className="font-semibold tabular-nums text-ink">{numero(c.n)}</b> locales. {c.trae} Archivo del {fechaCorta(c.generadoAl)}.
              </p>
              <div className="mt-auto flex flex-wrap gap-x-4 pt-2">
                <Link href={rutaEn(base, c.ruta)} className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-ink underline-offset-4 hover:text-granate hover:underline">
                  Verla aquí
                </Link>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline">
                  La lista en el MTC <ArrowUpRight size={13} aria-hidden />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="enlazamos-t" className="mt-8">
        <h2 id="enlazamos-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <Lock size={18} aria-hidden className="text-granate" /> Lo que sólo enlazamos
        </h2>
        <p className="mt-1 max-w-[70ch] text-meta text-inkSoft">
          Las consultas por placa piden captcha: no las leemos de forma automática ni guardamos las placas. Revisamos que cada dirección funcione (la
          última vez, el 22 nov. 2026).
        </p>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {CONSULTAS.map((c) => (
            <li key={c.clave} className="rounded-xl border border-line bg-paper px-4 py-3">
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-dato font-semibold text-ink underline-offset-4 hover:text-granate hover:underline">
                {c.fuente} <ArrowUpRight size={13} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
              <p className="mt-0.5 text-meta text-inkSoft">{c.devuelve}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
