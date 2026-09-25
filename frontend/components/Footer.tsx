import Link from "next/link";
import { ArrowRight, ArrowUpRight, Github, Heart } from "lucide-react";
import { FranjaBandera, FranjaTextil, Marca } from "@/components/marca";
import { FUENTES_FLUJO } from "@/components/landing/fuentesFlujo";

/**
 * El pie del sitio (DESIGN_SYSTEM.md §3.2, §3.8 y §6): granate profundo, la franja
 * textil de 8 px como costura con la página y la bandera en la línea "Hecho en
 * Perú". Es una superficie oscura, así que lleva `sobre-oscuro` (el anillo de foco
 * pasa a maíz) y el texto secundario no baja de `paper/75`.
 *
 * Un solo llamado a financiar: antes el mismo destino aparecía tres veces (el
 * botón, la lista "Plataforma" y la lista "Proyecto", esta última con un corazón
 * granate invisible sobre el fondo oscuro).
 *
 * Cada enlace dice a dónde lleva con el mismo nombre que tiene su destino (el de
 * la barra lateral o el título de la página). Revisado el 25 de setiembre de 2026:
 * todas las rutas existen y todos los enlaces externos abren.
 */

type Enlace = { href: string; label: string; externo?: boolean };

/** Los objetos del producto, con los nombres de la barra lateral. */
const EXPLORAR: Enlace[] = [
  { href: "/app/mapa", label: "Mapa" },
  { href: "/app/hallazgos", label: "Señales" },
  { href: "/app/contratos", label: "Contratos" },
  { href: "/app/entidades", label: "Entidades" },
  { href: "/app/auditoria", label: "Auditoría en vivo" },
];

/** Financiar no va acá: es el botón de arriba. */
const PARTICIPAR: Enlace[] = [
  { href: "/reporte/nuevo", label: "Denunciar una obra o entidad" },
  { href: "/app/denuncias", label: "Denuncias ciudadanas" },
  { href: "/app/aliados", label: "Ranking de aliados" },
];

const SOBRE_VIGIA: Enlace[] = [
  { href: "/preguntas", label: "Preguntas frecuentes" },
  { href: "/preguntas#cuentas", label: "Cuánto cuesta y quién paga" },
  // TODO(contacto): reemplazar cuando exista un correo del equipo.
  // Antes decía "Escríbenos": los issues de GitHub son públicos, no un buzón privado.
  { href: "https://github.com/EdwinSotto123/vigia-peru/issues", label: "Sugerencias y errores", externo: true },
];

/**
 * El nombre de cada portal tal como se presenta. QUÉ fuentes se enlazan no se
 * decide acá: son las de `FUENTES_FLUJO` (el mapa de fuentes de la portada,
 * verificado contra el código) que hoy se usan y tienen página pública. Antes el
 * pie enlazaba INFOBRAS y El Peruano, que ningún análisis lee, la página de
 * Claridad en onpe.gob.pe (hoy un 404) y la Plataforma Electoral del JNE en vez
 * de Infogob, que es de donde salen las candidaturas.
 */
const NOMBRE_PORTAL: Record<string, string> = {
  seace: "Contrataciones Abiertas (OECE)",
  sancionados: "Proveedores del Estado (OECE)",
  visitas: "Registro de visitas",
  onpe: "Claridad (ONPE)",
  jne: "Infogob (JNE)",
};

const FUENTES: Enlace[] = FUENTES_FLUJO.filter((f) => f.estado === "en_uso" && f.url).map((f) => ({
  href: f.url as string,
  label: NOMBRE_PORTAL[f.clave] ?? f.corto,
  externo: true,
}));

const REPO = "https://github.com/EdwinSotto123/vigia-peru";

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
              href={REPO}
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

        {/* Postura editorial + columnas de enlaces. En el celular los enlaces van de a
            dos columnas: una sola hacía del pie una lista de 16 renglones. */}
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 border-t border-paper/15 pt-10 lg:grid-cols-[1.4fr,1fr,1fr,1fr,1.1fr] lg:gap-x-8">
          <div className="col-span-2 lg:col-span-1">
            <TituloColumna>Postura editorial</TituloColumna>
            <p className="mt-3 max-w-md text-pretty text-[13px] leading-relaxed text-paper/80">
              <strong className="font-semibold text-paper">No acusamos a nadie.</strong> Detectamos señales y
              publicamos sus fuentes. La denuncia formal corresponde al Ministerio Público, la Contraloría o el
              periodismo. Los reportes ciudadanos son anónimos por defecto.
            </p>
          </div>
          <ColumnaEnlaces titulo="Explorar" enlaces={EXPLORAR} />
          <ColumnaEnlaces titulo="Participar" enlaces={PARTICIPAR} />
          <ColumnaEnlaces titulo="Sobre Vigía" enlaces={SOBRE_VIGIA} />
          <ColumnaEnlaces titulo="Fuentes oficiales" enlaces={FUENTES} />
        </div>

        {/* Línea final. Son listas: se dibujan como listas, con espacio entre
            ítems, no con una raya de puntos medios entre medio. */}
        <div className="mt-10 flex flex-col gap-3 border-t border-paper/15 pt-5 text-xs text-paper/75 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <li className="inline-flex items-center gap-2 font-medium text-paper">
              <FranjaBandera className="ring-paper/30" /> Hecho en Perú
            </li>
            <li>© {year} Vigía Perú</li>
            <li>
              <a
                href={`${REPO}/blob/main/LICENSE`}
                target="_blank"
                rel="noreferrer"
                className="decoration-maiz decoration-2 underline-offset-4 transition-colors duration-rapido hover:text-paper hover:underline"
              >
                Licencia MIT
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </li>
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
    "inline-flex min-h-6 items-center text-[13px] leading-snug text-paper/80 decoration-maiz decoration-2 underline-offset-4 transition-colors duration-rapido hover:text-paper hover:underline";
  return (
    <div className="min-w-0">
      <TituloColumna>{titulo}</TituloColumna>
      <ul className="mt-3 flex flex-col gap-1.5">
        {enlaces.map((e) => (
          <li key={e.href}>
            {e.externo ? (
              // La flecha dice "sales del sitio": sin ella, un portal del Estado se confunde con una
              // página de Vigía. Va dentro del span del nombre para seguir a la última palabra.
              <a href={e.href} target="_blank" rel="noreferrer" className={clase}>
                <span>
                  {e.label}
                  <ArrowUpRight size={12} aria-hidden className="ml-1 inline-block align-[-1px] text-paper/75" />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </span>
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
