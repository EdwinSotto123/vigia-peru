import type { Metadata } from "next";
import { ScanSearch, ShieldAlert } from "lucide-react";
import { BuscadorControl } from "@/components/control/BuscadorControl";
import { MapaObservado } from "@/components/control/MapaObservado";
import { Ayuda, EnlaceFuente, EncabezadoPagina, Migas, Nota, Pagina } from "@/components/patrones";
import { AVISO_PRESUNTA, getResumenControl } from "@/lib/corrupcion";
import { BUSCADOR_CONTRALORIA } from "@/lib/fuentes";
import { canonica } from "@/lib/seo";
import { uno } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Lo que encontró la Contraloría",
  description:
    "Busca en lo que encontraron los informes de control de la Contraloría en todo el Perú, por palabras o por sentido: cada observación con su tema, la entidad, a cuántos funcionarios comprende y con qué responsabilidad presunta, y la Ficha Resumen de cada informe.",
  alternates: canonica("/app/contraloria"),
};

/**
 * /app/contraloria: «Buscar en lo que encontró la Contraloría» en todo el país (pedido del dueño del 2026-11-16: «además
 * de hacer un RAG de ellos»). La página sólo lee `?q=`; la búsqueda la hace el navegador (components/control/
 * BuscadorControl.tsx contra GET /informes-control/buscar), con espera al escribir, un mínimo de 3 letras y el tope de la
 * API. Cada resultado abre el panel del informe, el mismo de la pestaña Control de una entidad, una región o un partido.
 *
 * Debajo, el mapa de lo observado (migración 314): cuánto perjuicio cuantifican las observaciones leídas, por tema, y las
 * entidades con más; `?tema=` deja el ranking en un tema. Si la API no lo tiene, la página queda como antes.
 */
export default async function ContraloriaPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const q = uno(searchParams?.q) ?? "";
  const resumen = await getResumenControl(uno(searchParams?.tema));
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contraloría", href: "/app/contraloria" }]} />
      <EncabezadoPagina
        titulo="Lo que encontró la Contraloría"
        bajada="Busca en las observaciones de sus informes de control de todo el país, por palabras o por sentido."
        ayuda={
          <Ayuda titulo="¿Dónde busca?">
            <span className="block">
              En lo que encontró cada informe de control (sus observaciones) y en su objetivo, según su Ficha Resumen. Vigía las
              lee de a pocos: sólo se busca en los informes ya leídos.
            </span>
            <span className="mt-1.5 block">
              Busca por palabras y por sentido: «pago sin conformidad» también encuentra «se pagó sin que el área usuaria la
              diera». El tema de cada observación lo puso una lectura automática (IA) y puede equivocarse.
            </span>
          </Ayuda>
        }
      />

      {/* El buscador en su tarjeta, con su título adentro (2026-11-23, el usuario: «secciones que son solo texto sin fondo o
          forma»): antes el campo, las pistas y «Qué trae cada resultado» iban sueltos sobre el fondo de la página. */}
      <section aria-labelledby="buscar-control-t" className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
            <ScanSearch size={19} strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h2 id="buscar-control-t" className="font-display text-seccion font-bold leading-tight text-ink">
              Busca en sus observaciones
            </h2>
            <p className="mt-0.5 text-dato leading-snug text-inkSoft">
              De los informes de control ya leídos, en todo el país. Cada resultado abre su informe.
            </p>
          </div>
        </div>
        <BuscadorControl inicial={q} enUrl ejemplos />
      </section>

      <MapaObservado datos={resumen} />

      <Nota icono={<ShieldAlert size={15} aria-hidden />}>
        {AVISO_PRESUNTA} Los funcionarios comprendidos van con un apellido tapado y sin documento. Para ver todos los informes
        de una entidad, abre su ficha y su pestaña Control. Fuente: <EnlaceFuente href={BUSCADOR_CONTRALORIA}>buscador de informes de la Contraloría</EnlaceFuente>.
      </Nota>
    </Pagina>
  );
}
