import { ArrowUpRight, ExternalLink, Gavel, Landmark, ScrollText, TrendingUp } from "lucide-react";

/**
 * De dónde sale cada dato.
 *
 * Es la contracara obligatoria de la sección de agentes: diez agentes leyendo
 * no significa nada si lo que leen sale del modelo. La landing afirmaba "cruza
 * 14 portales del Estado" sin nombrar ni uno — que es pedirle al visitante
 * exactamente la confianza ciega que este producto le niega al Estado.
 *
 * Cada fuente que se nombra acá existe y tiene su enlace cuando el repo lo
 * declara (`backend/scrapers/*` y el pie del sitio). Las que no tienen URL
 * pública verificada se nombran sin enlace: inventar un link a un portal es
 * inventar un dato.
 *
 * Deliberadamente NO son tarjetas: son cuatro listas. Cuatro cajas con ícono,
 * título y párrafo es la plantilla que este producto ya sacó del resto de la
 * app, y acá además escondería lo único que importa — que son muchas fuentes
 * y que cada una se puede abrir.
 */

interface Fuente {
  nombre: string;
  aporta: string;
  url?: string;
}

interface Familia {
  clave: string;
  Icono: typeof Landmark;
  titulo: string;
  bajada: string;
  fuentes: Fuente[];
}

const FAMILIAS: Familia[] = [
  {
    clave: "contratos",
    Icono: Landmark,
    titulo: "Los contratos",
    bajada: "El origen de todo: convocatorias, montos, entidades, fechas y postores.",
    fuentes: [
      {
        nombre: "SEACE / OECE, API de datos abiertos",
        aporta: "Estándar OCDS. Es de donde sale cada contrato que ves en el mapa.",
        url: "https://contratacionesabiertas.oece.gob.pe/",
      },
    ],
  },
  {
    clave: "registros",
    Icono: ScrollText,
    titulo: "Los registros del Estado",
    bajada: "Ocho canales de ingesta que se actualizan solos, con su propio calendario.",
    fuentes: [
      { nombre: "Proveedores sancionados (OECE)", aporta: "Quién está inhabilitado para contratar, y hasta cuándo.", url: "https://www.datosabiertos.gob.pe" },
      { nombre: "Registro de visitas", aporta: "Quién entró a qué entidad pública y a ver a quién.", url: "https://visitas.servicios.gob.pe/consultas" },
      { nombre: "Declaraciones juradas de intereses", aporta: "Qué empresas y parentescos declaró un funcionario. Es la llave de la puerta giratoria.", url: "https://www.datosabiertos.gob.pe" },
      { nombre: "Datasets OECE", aporta: "Ofertantes, consorcios y obras.", url: "https://www.datosabiertos.gob.pe" },
      { nombre: "Presupuesto (MEF)", aporta: "Cuánto tiene asignado cada pliego y cuánto ejecutó.", url: "https://www.datosabiertos.gob.pe" },
      { nombre: "Aportes de campaña (ONPE Claridad)", aporta: "Quién financió a qué candidato.", url: "https://claridadportal.onpe.gob.pe/" },
      { nombre: "Autoridades (JNE Infogob)", aporta: "Quién fue electo y quién se candidateó, con su historial.", url: "https://plataformaelectoral.jne.gob.pe/" },
      { nombre: "Personal de entidades", aporta: "Los designados, que no aparecen en ningún registro electoral." },
    ],
  },
  {
    clave: "norma",
    Icono: Gavel,
    titulo: "La norma",
    bajada: "Cuatro bibliotecas legales con los artículos segmentados uno por uno.",
    fuentes: [
      { nombre: "Normas vigentes", aporta: "Ley 32069, su reglamento y las bases estándar." },
      { nombre: "Normas históricas", aporta: "Ley 30225 y su reglamento: un contrato de 2023 se juzga con la ley de 2023." },
      { nombre: "Criterios vinculantes", aporta: "Acuerdos de Sala Plena y opiniones de la Dirección Técnico Normativa del OECE." },
      { nombre: "Control", aporta: "Directivas de la Contraloría.", url: "https://apps.contraloria.gob.pe/ciudadano/" },
    ],
  },
  {
    clave: "mercado",
    Icono: TrendingUp,
    titulo: "El mercado",
    bajada: "Lo único que no es un registro público, y por eso se declara distinto.",
    fuentes: [
      {
        nombre: "Búsqueda de precios en vivo",
        aporta:
          "Precios reales peruanos para los ítems del contrato. Cuando no aparecen suficientes, el veredicto se marca como estimación — nunca se disfraza de medición.",
      },
    ],
  },
];

const TOTAL_FUENTES = FAMILIAS.reduce((n, f) => n + f.fuentes.length, 0);

export function FuentesSection() {
  return (
    <section
      id="fuentes"
      aria-labelledby="fuentes-titulo"
      className="scroll-mt-20 border-b border-line bg-paperSoft py-14 sm:py-16"
    >
      <div className="container-page max-w-[1600px]">
        {/* La advertencia de "cuando una fuente no responde" va acá arriba, al
            lado del titular, y no al pie: al pie llenaba un renglón suelto y
            dejaba medio ancho de la sección en blanco, y además es parte de la
            promesa, no una nota. */}
        <div className="grid gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <h2 id="fuentes-titulo" className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
              Nada de lo que Vigía afirma sale del modelo.{" "}
              <em className="text-heroGreenTexto not-italic">Sale de {TOTAL_FUENTES} fuentes que puedes abrir.</em>
            </h2>
            <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-inkSoft">
              Si una señal dice que el gerente del proveedor aportó a la campaña del alcalde, hay un registro
              de ONPE detrás. Si dice que el requisito direcciona, hay un artículo de ley citado y la página
              exacta del documento donde está.
            </p>
          </div>
          <p className="flex items-start gap-2.5 rounded-2xl border border-heroGreen/25 bg-heroGreen-soft/50 px-4 py-3.5 text-[13px] leading-relaxed text-inkSoft">
            <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-heroGreenTexto" aria-hidden />
            <span>
              <strong className="font-semibold text-ink">Cuando una fuente no responde, la interfaz lo dice.</strong>{" "}
              No se rellena el hueco con un valor plausible: un dato inventado en una herramienta
              anticorrupción vale lo mismo que una acusación inventada.
            </span>
          </p>
        </div>

        {/* Los registros del Estado son ocho y los demás grupos uno o cuatro. En
            cuatro columnas iguales esa columna medía el doble de alto que la
            sección entera; con doble ancho su lista cae en dos columnas y las
            cuatro familias vuelven a pesar parecido. */}
        <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr_1fr]">
          {FAMILIAS.map(({ clave, Icono, titulo, bajada, fuentes }) => (
            <section key={clave} aria-labelledby={`fuentes-${clave}`} className="min-w-0">
              <h3 id={`fuentes-${clave}`} className="flex items-baseline gap-2.5 border-b border-line pb-2">
                <Icono size={15} className="shrink-0 translate-y-0.5 text-heroViolet" aria-hidden />
                <span className="text-[15px] font-semibold text-ink">{titulo}</span>
                <span className="ml-auto shrink-0 font-mono text-[12px] text-mute">{fuentes.length}</span>
              </h3>
              <p className="mt-2 text-[12px] leading-relaxed text-mute">{bajada}</p>
              <ul className={`mt-3 space-y-2.5 ${fuentes.length > 4 ? "sm:columns-2 sm:gap-x-8 sm:space-y-0" : ""}`}>
                {fuentes.map((f) => (
                  <li key={f.nombre} className="break-inside-avoid text-[13px] leading-snug sm:mb-2.5">
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-flex items-baseline gap-1 font-medium text-ink underline-offset-2 hover:text-heroViolet hover:underline"
                      >
                        {f.nombre}
                        <ExternalLink
                          size={11}
                          className="shrink-0 translate-y-px text-mute transition-colors duration-rapido group-hover:text-heroViolet"
                          aria-hidden
                        />
                        <span className="sr-only">(se abre en una pestaña nueva)</span>
                      </a>
                    ) : (
                      <span className="font-medium text-ink">{f.nombre}</span>
                    )}
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-mute">{f.aporta}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

      </div>
    </section>
  );
}
