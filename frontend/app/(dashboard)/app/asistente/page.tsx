import type { Metadata } from "next";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { AsistenteVigia } from "@/components/asistente/AsistenteVigia";
import { canonica } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Asistente de investigación",
  description:
    "Pregunta en tus palabras por un contrato, una entidad, una empresa o un partido: el asistente responde sólo con los datos de Vigía, con sus fuentes y sus límites.",
  alternates: canonica("/app/asistente"),
};

/**
 * El asistente de investigación (auditoría de producto del 2026-11-12, decisión D5). No reemplaza a las listas ni a las
 * fichas: es otra puerta a los mismos datos, para quien llega con una pregunta y no con un código.
 */
export default function AsistentePage() {
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Asistente", href: "/app/asistente" }]} />
      <EncabezadoPagina
        titulo="Asistente de investigación"
        bajada="Pregunta en tus palabras: responde con los datos de Vigía, con sus fuentes y lo que no pudo verificar."
        ayuda={
          <Ayuda titulo="¿Cómo responde?">
            <span className="block">
              Busca en las mismas fichas, listas y documentos que ves en Vigía y arma la respuesta con eso. Lo escribe un
              modelo de lenguaje, así que puede equivocarse: cada dato lleva su enlace para comprobarlo.
            </span>
            <span className="mt-1.5 block">
              No muestra DNI, tapa un apellido de las personas naturales y no saca conclusiones sobre delitos.
            </span>
          </Ayuda>
        }
      />
      <AsistenteVigia />
    </Pagina>
  );
}
