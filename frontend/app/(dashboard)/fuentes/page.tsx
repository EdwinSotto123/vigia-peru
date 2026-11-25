import { VistasComoTrabaja } from "@/components/sitio/VistasSeccion";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import {
  Banknote,
  Building2,
  DoorOpen,
  EyeOff,
  FileSearch,
  FileText,
  Landmark,
  Network,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { canonica } from "@/lib/seo";
import { EstadoDatos } from "@/components/fuentes/EstadoDatos";
import { EncabezadoPagina, EnlaceFuente, Migas, Pagina, Pestanas, Seccion } from "@/components/patrones";
import {
  BUSCADOR_CONTRALORIA,
  BUSCADOR_RNP,
  CLARIDAD_ONPE,
  CONOSCE_BUSCADOR,
  CONSULTA_AMIGABLE,
  CONSULTA_RUC_SUNAT,
  CONTRATACIONES_ABIERTAS,
  DATASET_AUTORIDADES_JNE,
  DATASET_MEF,
  DATASET_SOCIOS_RNP,
  INFOGOB_JNE,
  PORTAL_TRANSPARENCIA,
  TALENTO_PERU,
  VISITAS_EN_LINEA,
} from "@/lib/fuentes";

export const metadata: Metadata = {
  title: "De dónde salen los datos",
  description:
    "Qué fuentes públicas usa Vigía Perú y su cobertura: el SEACE (OECE) por sus dos puertas —Contrataciones Abiertas y CONOSCE— y los registros con los que se cruza.",
  alternates: canonica("/fuentes"),
};

const REPO = "https://github.com/Gobserva-Cloud/vigia-peru";

/**
 * Una fuente: nombre, qué aporta, su escala (al corte, aproximada) y dónde verla en el portal oficial (los enlaces de
 * lib/fuentes.ts). Sin enlace, la que no tiene una página pública que dar. La escala va partida en `cifra` (lo que se lee
 * en grande) y `unidad`; sin cifra, la escala es una frase y va en una pastilla.
 */
type Fuente = {
  nombre: string;
  que: string;
  icono: LucideIcon;
  cifra?: string;
  unidad: string;
  enlaces?: { texto: string; href: string }[];
};

/** El SEACE llega por dos puertas del MISMO regulador (OSCE se renombró a OECE). */
const PUERTAS: Fuente[] = [
  {
    nombre: "OECE: Contrataciones Abiertas (OCDS)",
    que: "El proceso completo y estructurado: convocatoria, los postores que compitieron, la adjudicación, el contrato y los enlaces a su expediente (bases). Es el formato abierto estándar OCDS.",
    icono: FileSearch,
    cifra: "~828 mil",
    unidad: "procesos, desde 2018 y con histórico previo",
    enlaces: [{ texto: "Contrataciones Abiertas (OECE)", href: CONTRATACIONES_ABIERTAS }],
  },
  {
    nombre: "CONOSCE (reportes del SEACE)",
    que: "Las planillas del mismo sistema: quién ganó cada proceso (~547 mil adjudicaciones), los contratos firmados con sus adicionales (~720 mil), las órdenes de compra y de servicio —las compras menores de hasta 8 UIT (~28.9 millones)— y las sanciones del Tribunal (~19.6 mil).",
    icono: Receipt,
    cifra: "~28.9 M",
    unidad: "órdenes menores, más adjudicaciones, contratos y sanciones",
    // La portada de conosce.oece.gob.pe no abre (muestra su código): el buscador sí.
    enlaces: [{ texto: "Buscador de CONOSCE (OECE)", href: CONOSCE_BUSCADOR }],
  },
];

/** Registros de OTRAS instituciones contra los que se cruza la contratación. */
const REGISTROS: Fuente[] = [
  {
    nombre: "SUNAT",
    que: "La ficha de cada empresa: fecha de alta, estado, domicilio fiscal y actividad.",
    icono: Building2,
    cifra: "~250 mil",
    unidad: "empresas",
    enlaces: [{ texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT }],
  },
  {
    nombre: "RNP (OECE)",
    que: "Los socios y representantes de cada proveedor: quién está detrás de la empresa.",
    icono: Network,
    cifra: "~1.4 M",
    unidad: "vínculos",
    enlaces: [
      { texto: "Buscador de proveedores del RNP", href: BUSCADOR_RNP },
      { texto: "Socios y representantes (datos abiertos)", href: DATASET_SOCIOS_RNP },
    ],
  },
  {
    nombre: "JNE: Infogob",
    que: "Las autoridades electas por jurisdicción: quién gobierna cada entidad.",
    icono: Landmark,
    cifra: "~13 mil",
    unidad: "autoridades",
    enlaces: [
      { texto: "Infogob (JNE)", href: INFOGOB_JNE },
      { texto: "Autoridades vigentes (datos abiertos)", href: DATASET_AUTORIDADES_JNE },
    ],
  },
  {
    nombre: "ONPE: Claridad",
    que: "Los aportes a organizaciones políticas, los candidatos y a quién le compró cada campaña.",
    icono: Vote,
    cifra: "~82 mil",
    unidad: "aportes",
    enlaces: [{ texto: "Claridad (ONPE)", href: CLARIDAD_ONPE }],
  },
  {
    nombre: "MEF",
    que: "El presupuesto y la ejecución de gasto de cada entidad: en qué gasta.",
    icono: Banknote,
    unidad: "Por entidad y año",
    enlaces: [
      { texto: "Consulta Amigable (MEF)", href: CONSULTA_AMIGABLE },
      { texto: "Presupuesto y ejecución (Datos Abiertos del MEF)", href: DATASET_MEF },
    ],
  },
  {
    nombre: "Contraloría y Procuraduría",
    que: "Informes con responsabilidad presunta (penal, civil o administrativa) y, aparte, las sentencias firmes.",
    icono: ShieldAlert,
    cifra: "~14 mil",
    unidad: "informes de control",
    // La Procuraduría no tiene buscador: cada ficha enlaza el boletín (PDF) del que salen sus cifras.
    enlaces: [{ texto: "Buscador de informes de la Contraloría", href: BUSCADOR_CONTRALORIA }],
  },
  {
    nombre: "Transparencia y SERVIR",
    que: "El personal de cada entidad (CAS, planilla, altos funcionarios) y los locadores contratados.",
    icono: Users,
    cifra: "~12 M",
    unidad: "registros de planilla",
    enlaces: [
      { texto: "Portal de Transparencia Estándar", href: PORTAL_TRANSPARENCIA },
      { texto: "Talento Perú (SERVIR)", href: TALENTO_PERU },
    ],
  },
  {
    nombre: "Registro de visitas",
    que: "Quién visitó una entidad pública en los días previos a una buena pro.",
    icono: DoorOpen,
    unidad: "Por entidad y fecha",
    enlaces: [{ texto: "Registro de Visitas en Línea", href: VISITAS_EN_LINEA }],
  },
  // Sin enlace: son precios de tiendas y de Osinergmin que Vigía junta en su propio índice.
  { nombre: "Precios de mercado", que: "Referencias de precio (VTEX, Osinergmin) para comparar lo que pagó el Estado.", icono: Tag, unidad: "Índice semanal" },
  {
    nombre: "Expedientes en PDF",
    que: "Bases, actas y contratos del expediente. Solo de los contratos de la cola de financiamiento, no de todos.",
    icono: FileText,
    unidad: "Cobertura parcial",
    enlaces: [{ texto: "Los documentos de cada proceso (Contrataciones Abiertas)", href: CONTRATACIONES_ABIERTAS }],
  },
];

/** Cómo se cruzan: casi toda bandera es «ganó en el SEACE × otro registro». Cada registro, con lo que pone en el cruce. */
const CRUCES: { bandera: string; registros: { fuente: string; pone: string }[] }[] = [
  {
    bandera: "Financió al que gobierna",
    registros: [
      { fuente: "CONOSCE", pone: "ganó" },
      { fuente: "ONPE", pone: "aportó" },
      { fuente: "JNE", pone: "quién gobierna la entidad" },
    ],
  },
  {
    bandera: "Puerta giratoria",
    registros: [
      { fuente: "RNP", pone: "socios del proveedor" },
      { fuente: "SERVIR", pone: "contratados por la misma entidad" },
    ],
  },
  {
    bandera: "Recién fundada",
    registros: [
      { fuente: "SUNAT", pone: "fecha de alta" },
      { fuente: "CONOSCE", pone: "ganó un contrato a los pocos meses" },
    ],
  },
  {
    bandera: "Socio común o domicilio compartido",
    registros: [
      { fuente: "OCDS", pone: "postores del proceso" },
      { fuente: "RNP y SUNAT", pone: "mismo socio o mismo domicilio" },
    ],
  },
  {
    bandera: "Sobreprecio",
    registros: [
      { fuente: "CONOSCE", pone: "lo que se pagó" },
      { fuente: "Precios", pone: "de mercado y de otras entidades" },
    ],
  },
];

/**
 * Una fuente como celda de un mosaico (2026-11-23, el usuario: «secciones que son solo texto»): su ícono en una placa, el
 * nombre, la escala en grande (la forma del dato: cuánto trae) y qué aporta; al pie, cada portal oficial con su flecha de
 * «se abre afuera». Las celdas van pegadas dentro de la tarjeta de su sección, separadas por una raya de 1 px: antes eran
 * tarjetas sueltas de puros párrafos bajo un título suelto.
 */
function CeldaFuente({ f }: { f: Fuente }) {
  const Icono = f.icono;
  return (
    <li className="flex flex-col gap-2 bg-paper p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
          <Icono size={19} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-cuerpo font-bold leading-snug text-ink">{f.nombre}</h3>
          {f.cifra ? (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-display text-seccion font-extrabold leading-none tabular-nums text-ink">{f.cifra}</span>
              <span className="text-meta text-inkSoft">{f.unidad}</span>
            </p>
          ) : (
            <p className="mt-1">
              <span className="inline-flex rounded-full border border-line bg-paperSoft px-2.5 py-0.5 text-rotulo font-semibold text-inkSoft">{f.unidad}</span>
            </p>
          )}
        </div>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">{f.que}</p>
      {/* Al pie de la celda (todas a la misma altura en la fila), cada portal oficial. */}
      {f.enlaces && (
        <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-meta" aria-label="Dónde verlo">
          {f.enlaces.map((e) => (
            <li key={e.href}>
              <EnlaceFuente href={e.href}>{e.texto}</EnlaceFuente>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Celdas pegadas dentro de la tarjeta de su sección, de borde a borde (sin caja dentro de caja). */
function Mosaico({ etiqueta, className, children }: { etiqueta: string; className?: string; children: ReactNode }) {
  return <ul aria-label={etiqueta} className={`-mx-4 -mb-4 grid gap-px border-t border-line bg-line sm:-mx-5 sm:-mb-5 ${className ?? ""}`}>{children}</ul>;
}

export default function FuentesPage({ searchParams }: { searchParams?: { seccion?: string | string[] } }) {
  const seccion = Array.isArray(searchParams?.seccion) ? searchParams?.seccion[0] : searchParams?.seccion;
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Cómo trabaja Vigía", href: "/metodologia" }, { etiqueta: "Fuentes", href: "/fuentes" }]} />
      <EncabezadoPagina
        titulo="De dónde salen los datos"
        bajada="Cada fuente, qué aporta y hasta dónde llega. Lo que no viene de un registro del Estado (precios de tiendas, prensa, lecturas con IA) se dice en su lugar."
      />
      <VistasComoTrabaja activa="fuentes" />

      {/* Una pestaña por pregunta (2026-11-12): antes eran cinco secciones apiladas, 3,6 pantallas de alto. */}
      <Pestanas
        variante="segunda"
        etiqueta="Partes de las fuentes"
        activa={seccion}
        pestanas={[
          {
            clave: "hoy",
            etiqueta: "Cómo están hoy",
            contenido: (
              // Hasta cuándo llega cada fuente y si está al día (GET /estado/datos); sin respuesta, se dice.
              <Suspense fallback={<p className="rounded-2xl border border-line bg-paper p-5 text-meta text-mute" role="status">Consultando el estado de cada fuente…</p>}>
                <EstadoDatos />
              </Suspense>
            ),
          },
          {
            clave: "seace",
            etiqueta: "El SEACE",
            conteo: PUERTAS.length,
            contenido: (
              <Seccion
                titulo="El SEACE, por dos puertas"
                descripcion={
                  <>
                    Una sola institución regula la contratación pública: el <b>OECE</b> (antes OSCE, el mismo organismo
                    renombrado). Sus datos salen por dos ventanas del SEACE, que unimos por el código del proceso.
                  </>
                }
              >
                <Mosaico etiqueta="Las dos puertas del SEACE" className="sm:grid-cols-2">
                  {PUERTAS.map((f) => (
                    <CeldaFuente key={f.nombre} f={f} />
                  ))}
                </Mosaico>
              </Seccion>
            ),
          },
          {
            clave: "registros",
            etiqueta: "Registros que se cruzan",
            conteo: REGISTROS.length,
            contenido: (
              <Seccion
                titulo="Los registros con los que se cruza"
                descripcion="El SEACE dice qué se compró y quién ganó. Estos otros registros dicen quién está detrás y con qué vínculos."
              >
                <Mosaico etiqueta="Registros que se cruzan" className="sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {REGISTROS.map((f) => (
                    <CeldaFuente key={f.nombre} f={f} />
                  ))}
                </Mosaico>
              </Seccion>
            ),
          },
          {
            clave: "cruces",
            etiqueta: "Cómo se cruzan",
            conteo: CRUCES.length,
            contenido: (
              <Seccion titulo="Cómo se cruzan" descripcion="Casi ninguna bandera vive en una sola fuente: nace de juntar «ganó en el SEACE» con otro registro.">
                {/* Cada bandera con los registros que la arman, unidos por «×»: la fórmula se ve, no se lee en un párrafo. */}
                <ul aria-label="Banderas y los registros que se juntan" className="-mx-4 -mb-4 divide-y divide-line border-t border-line sm:-mx-5 sm:-mb-5">
                  {CRUCES.map((c) => (
                    <li key={c.bandera} className="grid gap-2.5 px-4 py-3.5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-center sm:gap-5 sm:px-5">
                      <p className="flex items-center gap-2.5 text-dato font-semibold text-ink">
                        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-soft text-amberTexto">
                          <ShieldAlert size={15} />
                        </span>
                        {c.bandera}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5">
                        {c.registros.map((r, k) => (
                          <span key={`${r.fuente}-${k}`} className="contents">
                            {k > 0 && (
                              <span className="font-display text-bloque font-bold leading-none text-mute">
                                <span aria-hidden>×</span>
                                <span className="sr-only">cruzado con</span>
                              </span>
                            )}
                            <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-line bg-paperSoft px-2.5 py-1">
                              <b className="text-meta font-bold text-ink">{r.fuente}</b>
                              <span className="text-rotulo text-inkSoft">{r.pone}</span>
                            </span>
                          </span>
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>
              </Seccion>
            ),
          },
          {
            clave: "falta",
            etiqueta: "Lo que no tenemos",
            contenido: (
              <Seccion titulo="Lo que no tenemos" descripcion="Lo que los datos abiertos no traen, y qué quiere decir para cada señal.">
                <ul className="-mx-4 -mb-4 grid gap-px border-t border-line bg-line sm:-mx-5 sm:-mb-5 lg:grid-cols-2">
                  <li className="flex gap-3 bg-paper p-4 sm:p-5">
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paperDeep text-inkSoft">
                      <EyeOff size={19} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-cuerpo font-bold leading-snug text-ink">Quién pidió la compra</h3>
                      <p className="mt-1 text-meta leading-relaxed text-inkSoft">
                        El área usuaria o el funcionario que hizo el requerimiento <b>no está en los datos abiertos</b>: vive en
                        el expediente interno de la entidad, que el SEACE no publica para las órdenes de compra y solo a medias
                        en las bases de los contratos.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3 bg-paper p-4 sm:p-5">
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                      <ShieldCheck size={19} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-cuerpo font-bold leading-snug text-ink">Por eso una bandera es una señal para revisar</h3>
                      <p className="mt-1 text-meta leading-relaxed text-inkSoft">
                        Nunca una acusación: mostramos el hecho público y su fuente, y la conclusión la saca una persona. El
                        código que limpia cada fuente es público en <EnlaceFuente href={REPO}>GitHub</EnlaceFuente>.
                      </p>
                    </div>
                  </li>
                </ul>
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
