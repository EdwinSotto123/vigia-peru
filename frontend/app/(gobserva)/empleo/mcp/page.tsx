import type { Metadata } from "next";
import Link from "next/link";
import { Building, Search } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Franja } from "@/components/patrones/Franja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CORREO_GOBSERVA, rutaEn, urlCanonica } from "@/lib/gobserva";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Busca trabajo con tu IA (MCP)",
  description: COBROS_EN_PAUSA
    ? "Conecta ChatGPT, Cursor u otra IA a Gobserva Empleo por MCP y pregúntale por plazas CAS abiertas en tus palabras. Gratis con tu cuenta."
    : "Conecta Claude, ChatGPT o Cursor a Gobserva Empleo por MCP y pregúntale por plazas CAS abiertas en tus palabras. Viene con los planes de pago.",
  alternates: { canonical: urlCanonica("empleo", "/mcp") },
};

/**
 * Gobserva Empleo con tu asistente de IA: el servidor MCP explicado, con sus pasos, ejemplos y herramientas. Al final, las
 * dos salidas: buscar en la web sin asistente y el plan para instituciones (con los cobros en pausa, «llega pronto» y el
 * correo para escribirnos).
 */
export default function McpEmpleo() {
  const base = baseProducto("empleo");
  return (
    <div className="container-page space-y-10 py-10 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Tu asistente de IA ahora sabe de plazas del Estado.</h1>
        <p className="mt-4 text-pretty text-cuerpo leading-relaxed text-inkSoft sm:text-bloque">
          Con el MCP de Gobserva, Claude, ChatGPT o Cursor consultan las plazas CAS abiertas en vivo: le preguntas como a una persona y te responde con plazas
          reales, su sueldo, sus requisitos y el enlace oficial para postular.
        </p>
      </header>
      <BloqueMCP
        id="mcp"
        titulo="Conéctalo en un minuto"
        bajada={
          COBROS_EN_PAUSA
            ? "MCP (Model Context Protocol) es el estándar abierto con el que los asistentes de IA consultan fuentes de datos. El de Gobserva es gratis con tu cuenta: la creas, confirmas tu correo y conectas tu asistente."
            : "MCP (Model Context Protocol) es el estándar abierto con el que los asistentes de IA consultan fuentes de datos. El de Gobserva viene con los planes de pago: adquieres uno y conectas tu asistente con tu cuenta."
        }
        cuenta="Gobserva Empleo"
        planes={rutaEn(base, "/planes")}
        crear={rutaEn(base, "/entrar?crear=1")}
        ejemplos={[
          "¿Qué plazas CAS de abogado hay abiertas en Cusco que paguen más de S/ 4,000?",
          "Soy técnica en enfermería con un año de experiencia: ¿a qué puedo postular esta semana en Lima?",
          "¿Cuáles cierran mañana y no piden estudios universitarios?",
          "Arma una tabla con las 10 plazas mejor pagadas de Arequipa y lo que pide cada una.",
        ]}
        herramientas={[
          { nombre: "buscar_plazas_cas", descripcion: "Las plazas abiertas con filtros: puesto, región, sueldo, estudios, experiencia y cierre." },
          { nombre: "ficha_plaza_cas", descripcion: "Una plaza completa: requisitos, sueldo frente a otras entidades, señales y enlace oficial." },
        ]}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Franja
          apilada
          icono={<Search size={18} aria-hidden />}
          titulo="¿Prefieres buscar tú?"
          className="sm:w-full"
          accion={
            <Link href={rutaEn(base, "/plazas")} className={claseAccion("secundario", "min-h-11")}>
              Ver las plazas abiertas
            </Link>
          }
        >
          Lo mismo que responde el asistente está en la web, con filtros por región, sueldo, estudios y experiencia.
        </Franja>
        <Franja
          apilada
          icono={<Building size={18} aria-hidden />}
          titulo="¿Es para tu bolsa de trabajo o instituto?"
          className="sm:w-full"
          accion={
            COBROS_EN_PAUSA ? (
              <a href={`mailto:${CORREO_GOBSERVA}`} className={claseAccion("primario", "min-h-11")}>
                Escríbenos
              </a>
            ) : (
              <Link href={rutaEn(base, "/planes#plan-institucional")} className={claseAccion("primario", "min-h-11")}>
                Ver el plan para instituciones
              </Link>
            )
          }
        >
          {COBROS_EN_PAUSA
            ? "El plan para instituciones, con más alertas y descargas, la API, más consultas por MCP y un widget con tu marca, llega pronto. Escríbenos y te avisamos."
            : "Más alertas y descargas en el plan para instituciones; la API, más consultas por MCP y un widget con tu marca llegan pronto."}
        </Franja>
      </div>
    </div>
  );
}
