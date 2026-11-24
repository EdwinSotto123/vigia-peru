import Link from "next/link";
import { cookies } from "next/headers";
import { Hammer } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { COOKIE_SESION, rutaEn } from "@/lib/gobserva";

/**
 * La app de Empleo y de Licitaciones, en construcción (2026-11-24, el usuario: «solo habilitemos el MCP… ocultemos el
 * botón de la APP… dejémoslo como En construcción, ve usando nuestro MCP por mientras»). Toda ruta /app/* llega aquí
 * (el middleware la reescribe a /en-construccion mientras APP_EN_CONSTRUCCION): qué pasa, qué se puede hacer hoy (la
 * cuenta y las listas públicas) y, sobre todo, cómo usar el MCP, gratis con el correo confirmado.
 */
const TEXTO = {
  empleo: {
    cuenta: "Gobserva Empleo" as const,
    hoy: "Estamos terminando tu bandeja de plazas, tu perfil y el asistente. Mientras tanto, usa nuestro MCP: conecta tu asistente de IA y pregúntale por plazas CAS en tus palabras. Es gratis con tu cuenta y tu correo confirmado.",
    lista: { ruta: "/plazas", etiqueta: "Ver las plazas abiertas" },
    bajada: "Conecta ChatGPT, Cursor u otra IA con las plazas CAS de todo el país: busca por puesto, región, sueldo y requisitos, y te responde con el enlace oficial de cada plaza.",
    ejemplos: [
      "¿Qué plazas CAS de abogado hay abiertas en Cusco que paguen más de S/ 4,000?",
      "Soy técnica en enfermería con un año de experiencia: ¿a qué puedo postular esta semana en Lima?",
      "¿Cuáles cierran mañana y no piden estudios universitarios?",
    ],
    herramientas: [
      { nombre: "buscar_plazas_cas", descripcion: "Las plazas abiertas con filtros: puesto, región, sueldo, estudios, experiencia y cierre." },
      { nombre: "ficha_plaza_cas", descripcion: "Una plaza completa: requisitos, sueldo frente a otras entidades, señales y enlace oficial." },
    ],
  },
  licitaciones: {
    cuenta: "Gobserva Licitaciones" as const,
    hoy: "Estamos terminando la bandeja, el seguimiento de tus procesos y el asistente. Mientras tanto, usa nuestro MCP: conecta tu asistente de IA y pregúntale por las licitaciones del día, las obras, tu mercado o una entidad. Es gratis con tu cuenta y tu correo confirmado.",
    lista: { ruta: "/oportunidades", etiqueta: "Ver las oportunidades" },
    bajada: "Conecta ChatGPT, Cursor u otra IA con las licitaciones del SEACE, las obras que se vienen y el mercado de cada rubro: te responde con el enlace oficial de cada proceso.",
    ejemplos: [
      "Resume las convocatorias de señalización vial de esta semana con su valor referencial.",
      "¿Qué entidades de Arequipa compran más medicamentos y a quién le compran?",
      "Compárame cuántos postores hubo en las obras de agua potable de Cajamarca y de Puno.",
    ],
    herramientas: [
      { nombre: "buscar_licitaciones", descripcion: "Las convocatorias recientes del SEACE, con filtros por palabras, región, tipo y valor referencial." },
      { nombre: "mercado_rubro", descripcion: "El mercado de un rubro en 12 meses: procesos, monto adjudicado, quién compra, quién gana y cuántos compiten." },
      { nombre: "mercado_obras", descripcion: "El mercado de obras de una región y un sector: pipeline, ejecución, paralizadas, tamaño típico y quién gana." },
    ],
  },
};

export function EnConstruccion({ producto, base }: { producto: "empleo" | "licitaciones"; base: string }) {
  const t = TEXTO[producto];
  const conSesion = cookies().get(COOKIE_SESION)?.value === "1";
  const crear = rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/cuenta")}`);
  return (
    <div className="container-page space-y-10 py-10 sm:space-y-12 sm:py-14">
      <header className="flex max-w-3xl flex-col gap-5 sm:flex-row sm:items-start">
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-granate-50 text-granate">
          <Hammer size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">La app está en construcción</h1>
          <p className="mt-3 text-pretty text-bloque leading-relaxed text-inkSoft">{t.hoy}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href={conSesion ? rutaEn(base, "/cuenta") : crear} className={claseAccion("primario", "text-center", "md")}>
              {conSesion ? "Ir a mi cuenta" : "Crear mi cuenta gratis"}
            </Link>
            <Link href={rutaEn(base, t.lista.ruta)} className={claseAccion("secundario", "text-center", "md")}>
              {t.lista.etiqueta}
            </Link>
          </div>
        </div>
      </header>

      <BloqueMCP
        titulo="Mientras tanto, pregúntale a tu IA"
        bajada={t.bajada}
        cuenta={t.cuenta}
        planes={rutaEn(base, "/planes")}
        crear={crear}
        ejemplos={t.ejemplos}
        herramientas={t.herramientas}
      />
    </div>
  );
}
