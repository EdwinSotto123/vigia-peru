import type { Metadata } from "next";
import { ArrowUpRight, Database, Lock } from "lucide-react";
import { Migas } from "@/components/patrones/Migas";
import { CONSULTAS } from "@/components/car/consultas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { fechaCorta, numero } from "@/lib/gobserva-salud";
import datos from "@/data/car/citv.json";

export const metadata: Metadata = {
  title: "Fuentes",
  description: "De dónde sale cada dato de Gobserva Car: los datos abiertos que cargamos y las consultas oficiales que enlazamos.",
  alternates: { canonical: urlCanonica("car", "/fuentes") },
};

/** De dónde sale cada cosa (Gobserva Car): lo que cargamos, con su fecha, y lo que sólo enlazamos porque pide captcha. */
export default function FuentesCar() {
  const base = baseProducto("car");
  const d = datos as { fuente: string; url: string; generadoAl: string | null; centros: unknown[] };
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
        <div className="mt-3 rounded-2xl border border-line bg-paper p-4">
          <p className="text-cuerpo font-bold text-ink">{d.fuente}</p>
          <p className="mt-1 text-meta text-inkSoft">
            {numero(d.centros.length)} centros, con su dirección, horario, líneas, resolución, días sin transmitir y sanción. El MTC la publica en Excel, sin
            captcha. Archivo generado por el MTC el {fechaCorta(d.generadoAl)}. Los celulares van tapados.
          </p>
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline">
            La lista en el MTC <ArrowUpRight size={13} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </div>
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
