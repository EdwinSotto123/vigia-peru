import Link from "next/link";
import { ArrowRight, ArrowUpRight, Github, Heart } from "lucide-react";
import { FranjaBandera, FranjaTextil, Marca } from "@/components/marca";

/**
 * El pie del sitio (DESIGN_SYSTEM.md §3.2, §3.8 y §6): granate profundo, la franja
 * textil de 8 px como costura con la página y la bandera en la línea "Hecho en
 * Perú". Es una superficie oscura, así que lleva `sobre-oscuro` (el anillo de foco
 * pasa a maíz) y el texto secundario no baja de `paper/75`.
 *
 * Un solo llamado a financiar: antes el mismo destino aparecía tres veces (el
 * botón, la lista "Plataforma" y la lista "Proyecto", esta última con un corazón
 * granate invisible sobre el fondo oscuro).
 */

type Enlace = { href: string; label: string; externo?: boolean };

const PLATAFORMA: Enlace[] = [
  { href: "/app/mapa", label: "Mapa de auditoría" },
  { href: "/app/auditoria", label: "Auditoría en vivo" },
  { href: "/app/aliados", label: "Aliados de transparencia" },
  { href: "/reporte/nuevo", label: "Denunciar una obra" },
  { href: "/preguntas", label: "Preguntas frecuentes" },
];

const FUENTES: Enlace[] = [
  { href: "https://contratacionesabiertas.oece.gob.pe/", label: "Contrataciones Abiertas", externo: true },
  { href: "https://apps.contraloria.gob.pe/ciudadano/", label: "INFOBRAS de la Contraloría", externo: true },
  { href: "https://www.onpe.gob.pe/claridad/", label: "ONPE Claridad", externo: true },
  { href: "https://plataformaelectoral.jne.gob.pe/", label: "JNE Plataforma Electoral", externo: true },
  { href: "https://www.elperuano.pe/", label: "El Peruano", externo: true },
];

const PROYECTO: Enlace[] = [
  // TODO(contacto): reemplazar cuando exista un correo del equipo.
  // Antes: hola@ y prensa@vigiaperu.org, un dominio que no resuelve.
  { href: "https://github.com/EdwinSotto123/vigia-peru/issues", label: "Escríbenos (GitHub)", externo: true },
  { href: "/preguntas#cuentas", label: "Cuánto cuesta y quién paga" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer data-tema="oscuro" className="sobre-oscuro mt-20 bg-granate-900 text-paper">
      <FranjaTextil alto={8} />
      <div className="container-page py-14">
        {/* Firma + llamado a financiar, lado a lado en escritorio. */}
        <div className="grid items-center gap-8 lg:grid-cols-[1.6fr,1fr]">
          <div>
            <Link
              href="/"
              aria-label="Vigía Perú, ir al inicio"
              className="inline-flex rounded-lg transition-opacity duration-rapido hover:opacity-80"
            >
              <Marca tono="oscuro" tamano="lg" />
            </Link>
            <p className="mt-5 max-w-md text-pretty text-sm leading-relaxed text-paper/80">
              Vigilancia cívica de las compras públicas del Perú. Sin fines de lucro y de código abierto, para que
              la verdad no dependa de quién paga el servidor.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row lg:flex-col">
            <Link
              href="/app/financiar"
              className="group flex min-h-12 items-center sm:flex-1 lg:flex-none justify-between gap-3 rounded-full bg-paper px-5 py-3 text-granate transition-colors duration-rapido hover:bg-maiz-soft"
            >
              <span className="flex items-center gap-2.5">
                <Heart size={16} aria-hidden className="fill-granate text-granate motion-safe:group-hover:animate-latir" />
                <span className="font-display text-base font-bold leading-tight">Financiar una auditoría</span>
              </span>
              <ArrowRight size={18} aria-hidden className="shrink-0 transition-transform duration-rapido group-hover:translate-x-0.5" />
            </Link>
            <a
              href="https://github.com/EdwinSotto123/vigia-peru"
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center justify-between gap-3 rounded-full border sm:flex-1 lg:flex-none border-paper/25 px-5 py-2.5 text-paper transition-colors duration-rapido hover:bg-paper/10"
            >
              <span className="flex items-center gap-2.5">
                <Github size={15} aria-hidden />
                <span className="text-sm font-medium">Contribuir al código</span>
                <span className="sr-only">(se abre en otra pestaña)</span>
              </span>
              <ArrowUpRight size={14} aria-hidden className="text-paper/75" />
            </a>
          </div>
        </div>

        {/* Postura editorial + columnas de enlaces */}
        <div className="mt-12 grid gap-10 border-t border-paper/15 pt-10 sm:grid-cols-2 lg:grid-cols-[1.4fr,1fr,1fr,1fr]">
          <div>
            <TituloColumna>Postura editorial</TituloColumna>
            <p className="mt-3 text-pretty text-[13px] leading-relaxed text-paper/80">
              <strong className="font-semibold text-paper">No acusamos a nadie.</strong> Detectamos señales y
              publicamos sus fuentes. La denuncia formal corresponde al Ministerio Público, la Contraloría o el
              periodismo. Los reportes ciudadanos son anónimos por defecto.
            </p>
          </div>
          <ColumnaEnlaces titulo="Plataforma" enlaces={PLATAFORMA} />
          <ColumnaEnlaces titulo="Fuentes oficiales" enlaces={FUENTES} />
          <ColumnaEnlaces titulo="Proyecto" enlaces={PROYECTO} />
        </div>

        {/* Línea final. Son listas: se dibujan como listas, con espacio entre
            ítems, no con una raya de puntos medios entre medio. */}
        <div className="mt-10 flex flex-col gap-3 border-t border-paper/15 pt-5 text-xs text-paper/75 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <li className="inline-flex items-center gap-2 font-medium text-paper">
              <FranjaBandera className="ring-paper/30" /> Hecho en Perú
            </li>
            <li>© {year} Vigía Perú</li>
            <li>Licencia MIT</li>
          </ul>
          {/* Sin versión de modelo: el desplegado cambia y el pie quedaba desactualizado. */}
          <ul aria-label="Construido con" className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
            {["Gemini", "Google ADK", "Cloud Run", "Cloud SQL"].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

/** Título de columna: pocas palabras, en maíz sobre el granate (9.6:1). */
function TituloColumna({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-maiz">{children}</h2>;
}

function ColumnaEnlaces({ titulo, enlaces }: { titulo: string; enlaces: Enlace[] }) {
  // El subrayado en maíz al pasar es el acento del pie (DESIGN_SYSTEM.md §3.3).
  const clase =
    "inline-flex min-h-6 items-center text-[13px] text-paper/80 decoration-maiz decoration-2 underline-offset-4 transition-colors duration-rapido hover:text-paper hover:underline";
  return (
    <div>
      <TituloColumna>{titulo}</TituloColumna>
      <ul className="mt-3 flex flex-col gap-1.5">
        {enlaces.map((e) => (
          <li key={e.href}>
            {e.externo ? (
              <a href={e.href} target="_blank" rel="noreferrer" className={clase}>
                {e.label}
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            ) : (
              <Link href={e.href} className={clase}>
                {e.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
