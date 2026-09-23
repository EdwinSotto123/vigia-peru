import { ArrowUpRight, ExternalLink, Gavel, Landmark, RefreshCw, ScrollText, TrendingUp } from "lucide-react";

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
  /**
   * Cada cuánto se vuelve a bajar. Sale del calendario real de
   * `backend/scrapers` (el mismo que lista el panel de cobertura del admin), no
   * de una promesa: una fuente sin cadencia declarada no lleva insignia.
   */
  cada?: string;
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
        cada: "cada noche",
      },
    ],
  },
  {
    clave: "registros",
    Icono: ScrollText,
    titulo: "Los registros del Estado",
    bajada: "Ocho canales de ingesta que se actualizan solos, con su propio calendario.",
    fuentes: [
      { nombre: "Proveedores sancionados (OECE)", aporta: "Quién está inhabilitado para contratar, y hasta cuándo.", url: "https://www.datosabiertos.gob.pe", cada: "cada mes" },
      { nombre: "Registro de visitas", aporta: "Quién entró a qué entidad pública y a ver a quién.", url: "https://visitas.servicios.gob.pe/consultas", cada: "días 1 y 15" },
      { nombre: "Declaraciones juradas de intereses", aporta: "Qué empresas y parentescos declaró un funcionario. Es la llave de la puerta giratoria.", url: "https://www.datosabiertos.gob.pe", cada: "día 5" },
      { nombre: "Datasets OECE", aporta: "Ofertantes, consorcios y obras.", url: "https://www.datosabiertos.gob.pe", cada: "cada mes" },
      { nombre: "Presupuesto (MEF)", aporta: "Cuánto tiene asignado cada pliego y cuánto ejecutó.", url: "https://www.datosabiertos.gob.pe", cada: "cada mes" },
      { nombre: "Aportes de campaña (ONPE Claridad)", aporta: "Quién financió a qué candidato.", url: "https://claridadportal.onpe.gob.pe/", cada: "cada mes" },
      { nombre: "Autoridades (JNE Infogob)", aporta: "Quién fue electo y quién se candidateó, con su historial.", url: "https://plataformaelectoral.jne.gob.pe/", cada: "día 5" },
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
              exacta del documento donde está. <strong className="font-semibold text-ink">Todas se bajan
              solas</strong>: el lote de contratos corre cada noche y cada registro del Estado tiene su propio
              calendario, marcado abajo.
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
              {/* Cada fuente es una tarjeta que se abre, no un renglón de texto:
                  lo que esta sección promete es justamente que se pueden abrir,
                  y un enlace subrayado dentro de un párrafo no lo parecía. La
                  que no tiene URL pública verificada se dibuja igual pero sin
                  afordancia de clic — inventarle un link sería inventar el dato. */}
              <ul className={`mt-3 grid gap-2 ${fuentes.length > 4 ? "sm:grid-cols-2" : ""}`}>
                {fuentes.map((f) => (
                  <li key={f.nombre}>
                    <FichaFuente f={f} />
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

/** Una fuente: tarjeta si se puede abrir, caja igual pero quieta si no. */
function FichaFuente({ f }: { f: Fuente }) {
  const cuerpo = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-snug text-ink">{f.nombre}</span>
        {f.url && (
          <ExternalLink
            size={12}
            className="mt-0.5 shrink-0 text-mute transition-colors duration-rapido group-hover:text-heroViolet"
            aria-hidden
          />
        )}
      </span>
      <span className="mt-1 block text-[12px] leading-relaxed text-mute">{f.aporta}</span>
      {f.cada && (
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-paperDeep px-2 py-0.5 text-[11px] text-inkSoft">
          <RefreshCw size={10} className="shrink-0 text-heroGreenTexto" aria-hidden />
          se descarga {f.cada}
        </span>
      )}
    </>
  );

  const base = "block h-full rounded-2xl border px-3.5 py-3 transition-all duration-rapido";

  if (!f.url) {
    return <span className={`${base} border-dashed border-line bg-paper/60`}>{cuerpo}</span>;
  }
  return (
    <a
      href={f.url}
      target="_blank"
      rel="noreferrer"
      className={`group ${base} border-line bg-paper hover:-translate-y-0.5 hover:border-heroViolet/40 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paperSoft`}
    >
      {cuerpo}
      <span className="sr-only">(se abre en una pestaña nueva)</span>
    </a>
  );
}
