import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPagina, Migas, Pagina } from "@/components/patrones";

export const metadata: Metadata = {
  title: "De dónde salen los datos",
  description:
    "Qué fuentes públicas usa Vigía Perú y su cobertura: el SEACE (OECE) por sus dos puertas —Contrataciones Abiertas y CONOSCE— y los registros con los que se cruza.",
};

const REPO = "https://github.com/EdwinSotto123/vigia-peru";
const ENLACE = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

/** Una tarjeta de fuente: nombre, qué aporta y su escala (al corte, aproximada). */
type Fuente = { nombre: string; que: string; escala: string; url?: string };

/** El SEACE llega por dos puertas del MISMO regulador (OSCE se renombró a OECE). */
const PUERTAS: Fuente[] = [
  {
    nombre: "OECE · Contrataciones Abiertas (OCDS)",
    que: "El proceso completo y estructurado: convocatoria, los postores que compitieron, la adjudicación, el contrato y los enlaces a su expediente (bases). Es el formato abierto estándar OCDS.",
    escala: "~828 mil procesos (desde 2018, con histórico previo)",
    url: "https://contratacionesabiertas.oece.gob.pe/",
  },
  {
    nombre: "CONOSCE (reportes del SEACE)",
    que: "Las planillas del mismo sistema: quién ganó cada proceso (~547 mil adjudicaciones), los contratos firmados con sus adicionales (~720 mil), las órdenes de compra y de servicio —las compras menores de hasta 8 UIT (~28.9 millones)— y las sanciones del Tribunal (~19.6 mil).",
    escala: "Adjudicaciones, contratos, órdenes menores, sanciones",
    url: "https://conosce.oece.gob.pe/",
  },
];

/** Registros de OTRAS instituciones contra los que se cruza la contratación. */
const REGISTROS: Fuente[] = [
  { nombre: "SUNAT", que: "La ficha de cada empresa: fecha de alta, estado, domicilio fiscal y actividad.", escala: "~250 mil empresas" },
  { nombre: "RNP (OECE)", que: "Los socios y representantes de cada proveedor: quién está detrás de la empresa.", escala: "~1.4 millones de vínculos" },
  { nombre: "JNE · Infogob", que: "Las autoridades electas por jurisdicción: quién gobierna cada entidad.", escala: "~13 mil autoridades" },
  { nombre: "ONPE · Claridad", que: "Los aportes a organizaciones políticas, los candidatos y a quién le compró cada campaña.", escala: "~82 mil aportes" },
  { nombre: "MEF", que: "El presupuesto y la ejecución de gasto de cada entidad: en qué gasta.", escala: "Por entidad y año" },
  { nombre: "Contraloría y Procuraduría", que: "Informes con responsabilidad presunta (penal, civil o administrativa) y, aparte, las sentencias firmes.", escala: "~14 mil informes de control" },
  { nombre: "Transparencia y SERVIR", que: "El personal de cada entidad (CAS, planilla, altos funcionarios) y los locadores contratados.", escala: "~12 millones de registros de planilla" },
  { nombre: "Registro de visitas", que: "Quién visitó una entidad pública en los días previos a una buena pro.", escala: "Por entidad y fecha" },
  { nombre: "Precios de mercado", que: "Referencias de precio (VTEX, Osinergmin) para comparar lo que pagó el Estado.", escala: "Índice semanal" },
  { nombre: "Expedientes en PDF", que: "Bases, actas y contratos del expediente. Solo de los contratos de la cola de financiamiento, no de todos.", escala: "Cobertura parcial" },
];

/** Cómo se cruzan: casi toda bandera es «ganó en el SEACE × otro registro». */
const CRUCES: { bandera: string; formula: string }[] = [
  { bandera: "Financió al que gobierna", formula: "CONOSCE (ganó) × ONPE (aportó) × JNE (quién gobierna la entidad)" },
  { bandera: "Puerta giratoria", formula: "RNP (socios del proveedor) × SERVIR (contratados por la misma entidad)" },
  { bandera: "Recién fundada", formula: "SUNAT (fecha de alta) × CONOSCE (ganó un contrato a los pocos meses)" },
  { bandera: "Socio común / domicilio compartido", formula: "OCDS (postores del proceso) × RNP y SUNAT (mismo socio o mismo domicilio)" },
  { bandera: "Sobreprecio", formula: "CONOSCE (lo que se pagó) × precios de mercado y de otras entidades" },
];

function TarjetaFuente({ f }: { f: Fuente }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-paper p-5">
      <h3 className="font-display text-cuerpo font-semibold text-ink">
        {f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-granate">
            {f.nombre}
          </a>
        ) : (
          f.nombre
        )}
      </h3>
      <p className="text-meta leading-relaxed text-inkSoft">{f.que}</p>
      <p className="mt-0.5 text-rotulo text-mute">{f.escala}</p>
    </div>
  );
}

function Seccion({ titulo, intro, children }: { titulo: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="max-w-2xl space-y-1.5">
        <h2 className="font-display text-seccion font-bold text-ink text-balance">{titulo}</h2>
        {intro && <p className="text-cuerpo leading-relaxed text-inkSoft text-pretty">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export default function FuentesPage() {
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "De dónde salen los datos", href: "/fuentes" }]} />
      <EncabezadoPagina
        titulo="De dónde salen los datos"
        bajada="Todo lo que ves en Vigía viene de registros públicos del Estado. Acá está cada fuente, qué aporta y hasta dónde llega —sin esconder los límites."
      />

      <Seccion
        titulo="El SEACE, por dos puertas"
        intro={
          <>
            La contratación pública la regula una sola institución: el <b>OECE</b> (antes se llamaba OSCE; es el mismo
            organismo, renombrado). Sus datos salen por dos ventanas distintas del mismo sistema, el SEACE. Las unimos por
            el código del proceso.
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {PUERTAS.map((f) => (
            <TarjetaFuente key={f.nombre} f={f} />
          ))}
        </div>
      </Seccion>

      <Seccion
        titulo="Los registros con los que se cruza"
        intro="El SEACE dice qué se compró y quién ganó. Estos otros registros dicen quién está detrás y con qué vínculos. El cruce de ambos es lo que levanta una bandera."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REGISTROS.map((f) => (
            <TarjetaFuente key={f.nombre} f={f} />
          ))}
        </div>
      </Seccion>

      <Seccion
        titulo="Cómo se cruzan"
        intro="Casi ninguna bandera vive en una sola fuente: nace de juntar «ganó en el SEACE» con otro registro."
      >
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {CRUCES.map((c) => (
            <li key={c.bandera} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="font-display text-cuerpo font-semibold text-ink sm:w-64 sm:shrink-0">{c.bandera}</span>
              <span className="text-meta leading-relaxed text-inkSoft">{c.formula}</span>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Qué todavía NO tenemos">
        <div className="space-y-3 rounded-2xl border border-line bg-paperSoft p-5">
          <p className="text-meta leading-relaxed text-inkSoft">
            Somos honestos con los huecos. Por ejemplo, <b>«quién pidió» una compra</b> (el área usuaria o el funcionario
            que hizo el requerimiento) <b>no está en los datos abiertos</b>: vive en el expediente interno de la entidad, que
            el SEACE no publica para las órdenes de compra y solo a medias en las bases de los contratos.
          </p>
          <p className="text-meta leading-relaxed text-inkSoft">
            Por eso una bandera siempre es <b>una señal para revisar</b>, nunca una acusación: mostramos el hecho público y
            su fuente, y la conclusión la saca una persona.
          </p>
        </div>
      </Seccion>

      <p className="text-meta text-mute">
        ¿Quieres verlo como un mapa interactivo? Está en la{" "}
        <Link href="/" className={ENLACE}>
          portada
        </Link>
        . Y todo el código que limpia cada fuente es público en{" "}
        <a href={REPO} target="_blank" rel="noreferrer" className={ENLACE}>
          GitHub
        </a>
        .
      </p>
    </Pagina>
  );
}
