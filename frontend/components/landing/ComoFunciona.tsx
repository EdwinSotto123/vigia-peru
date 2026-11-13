import { Database, ListChecks, ShieldCheck } from "lucide-react";
import { Pestanas } from "@/components/patrones";
import { EnlaceAccion } from "./EnlaceAccion";
import { PipelineAgentes } from "./PipelineAgentes";
import { FuentesSection } from "./FuentesSection";
import { ConfianzaSection } from "./ConfianzaSection";
import type { CifrasFlujo } from "./ExploradorFuentes";

/**
 * «Cómo trabaja Vigía», en UNA sección con pestañas (2026-11-13). Antes eran tres bandas seguidas que medían 4,1
 * pantallas en escritorio y 8,7 en el celular, y se repetían entre sí: «Lo que Vigía revisa en cada contrato» (con su
 * «si no está seguro, lo revisa una persona»), «Vigía no inventa nada. Cada señal sale de un registro público» y «Hecho
 * para que no tengas que creerle a nadie» (con «si duda, lo revisa una persona» otra vez y «cada señal viene con la ley»).
 *
 * Ahora el titular lo dice una vez y cada pestaña muestra una parte, en el orden del relato:
 *  1. Qué revisa: las cuatro preguntas y el circuito (PipelineAgentes, con el diagrama de Orquestacion).
 *  2. De dónde sale: el mapa de fuentes, la norma y lo que se consulta al momento (FuentesSection).
 *  3. Por qué creerle: los compromisos, con la cifra de lo que está en revisión (ConfianzaSection).
 *
 * La pestaña va a la URL (`?como=fuentes`), así se comparte. El ancla `/#fuentes` (la usa /preguntas) cae en esta
 * sección.
 */
export function ComoFunciona({ cifras, enRevision }: { cifras: CifrasFlujo | null; enRevision: number | null }) {
  return (
    <section id="como" aria-labelledby="como-titulo" className="relative scroll-mt-16 border-t border-line bg-paperSoft py-10 sm:py-12">
      {/* Las anclas de las bandas que vivían aquí: un enlace viejo cae en la sección, no en la cabecera de la página. */}
      <span id="fuentes" aria-hidden className="absolute top-0 scroll-mt-16" />
      <span id="agentes" aria-hidden className="absolute top-0 scroll-mt-16" />
      <span id="organizacion" aria-hidden className="absolute top-0 scroll-mt-16" />
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0 max-w-[62ch]">
            <h2 id="como-titulo" className="text-balance font-display text-cifra font-bold leading-[1.08] text-ink sm:text-titulo">
              Vigía no inventa nada. <span className="text-granate">Así trabaja.</span>
            </h2>
            <p className="mt-2 text-pretty text-cuerpo leading-relaxed text-inkSoft">
              Cada contrato pasa por las mismas revisiones, y cada señal cita la ley y el registro público de donde sale.
              Cuando algo es una estimación, lo dice.
            </p>
          </div>
          <EnlaceAccion href="/app/auditoria" variante="secundario" className="shrink-0">
            Verlo trabajar ahora
          </EnlaceAccion>
        </div>

        <Pestanas
          className="mt-5"
          etiqueta="Cómo trabaja Vigía"
          param="como"
          pestanas={[
            {
              clave: "revisa",
              etiqueta: "Qué revisa",
              icono: <ListChecks size={15} className="hidden sm:block" aria-hidden />,
              contenido: <PipelineAgentes />,
            },
            {
              clave: "fuentes",
              etiqueta: "De dónde sale",
              icono: <Database size={15} className="hidden sm:block" aria-hidden />,
              contenido: <FuentesSection cifras={cifras} />,
            },
            {
              clave: "confianza",
              etiqueta: "Por qué creerle",
              icono: <ShieldCheck size={15} className="hidden sm:block" aria-hidden />,
              contenido: <ConfianzaSection enRevision={enRevision} />,
            },
          ]}
        />
      </div>
    </section>
  );
}
