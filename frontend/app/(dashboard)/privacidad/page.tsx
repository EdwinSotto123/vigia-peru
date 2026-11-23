import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BadgeDollarSign,
  Code2,
  Database,
  Eye,
  Hand,
  Hash,
  IdCard,
  Landmark,
  Megaphone,
  PencilLine,
  Phone,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EncabezadoPagina, Migas, Pagina, Pestanas } from "@/components/patrones";
import { VistasComoTrabaja } from "@/components/sitio/VistasSeccion";
import { FormularioPrivacidad } from "./FormularioPrivacidad";

export const metadata: Metadata = {
  title: "Privacidad y tus datos",
  description:
    "Qué datos personales publica Vigía Perú y cuáles no: sin DNI, con un apellido tapado de las personas privadas. Si apareces en un análisis, pide corregir o retirar un dato.",
  alternates: canonica("/privacidad"),
};

const ENLACE = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

/** Una marca como la que ve el lector en un análisis (components/Redact.tsx `Tapado`), para explicarla. */
function Marca({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded bg-ink/10 px-1 font-mono text-rotulo tracking-wider text-mute">{children}</span>;
}

/** Lo que se publica y lo que no, regla por regla, con su ícono y cómo se ve. `abierto`: lo que va con su nombre completo. */
const REGLAS: { icono: LucideIcon; titulo: string; texto: ReactNode; muestra?: ReactNode; abierto?: boolean }[] = [
  {
    icono: IdCard,
    titulo: "Nunca un número de DNI, ni en parte",
    texto: "Al pasar el puntero se ve una referencia que identifica a la misma persona en todo Vigía (para ver, por ejemplo, que el firmante de un acta es también socio del ganador) sin revelar su número.",
    muestra: (
      <>
        <Marca>••••••••</Marca> y, al pasar el puntero, <Marca>7K2Q9A</Marca>
      </>
    ),
  },
  {
    icono: Hash,
    titulo: "El RUC de una persona natural, tapado",
    texto: "Empieza con 10 y lleva su DNI adentro.",
    muestra: <Marca>10•••••••••</Marca>,
  },
  {
    icono: UserRound,
    titulo: "Las personas privadas, con un apellido tapado",
    texto: "Proveedores que son personas naturales, socios, representantes, funcionarios no electos y visitantes de una entidad.",
    muestra: <Marca>JUAN CARLOS PÉREZ •••</Marca>,
  },
  {
    icono: UsersRound,
    titulo: "Los familiares que deduce la IA no se nombran",
    texto: "Sólo se dice el vínculo, porque puede ser un homónimo. Si además tienen un papel en el contrato (por ejemplo, son socios del proveedor), van como cualquier persona privada.",
  },
  {
    icono: Phone,
    titulo: "Los celulares y correos, tapados",
    texto: "Los que aparezcan en un documento del expediente.",
  },
  {
    icono: Landmark,
    titulo: "Las autoridades electas y las empresas, con su nombre completo",
    texto: "Alcaldes, gobernadores y regidores: su función es pública.",
    abierto: true,
  },
];

const DERECHOS: { icono: LucideIcon; titulo: string; texto: string }[] = [
  { icono: Eye, titulo: "Saber", texto: "Qué datos tuyos tenemos." },
  { icono: PencilLine, titulo: "Corregir", texto: "Un dato tuyo que está mal." },
  { icono: Trash2, titulo: "Retirar", texto: "Un dato tuyo que no debería estar." },
  { icono: Hand, titulo: "Oponerte", texto: "A que se use un dato tuyo." },
];

const NO_HACEMOS: { icono: LucideIcon; texto: string }[] = [
  { icono: BadgeDollarSign, texto: "No vendemos datos" },
  { icono: Megaphone, texto: "No mostramos publicidad" },
  { icono: ScanFace, texto: "No armamos perfiles de personas" },
];

/**
 * Política de datos personales (docs/PRIVACIDAD.md) y el canal para ejercer los derechos de la Ley
 * 29733: "¿Apareces en Vigía? Pide una corrección". El enlace "¿Apareces aquí?" de cada análisis llega
 * con `?enlace=` para que la persona no tenga que copiar la dirección.
 */
export default function PrivacidadPage({ searchParams }: { searchParams?: { enlace?: string | string[]; seccion?: string | string[] } }) {
  const crudo = Array.isArray(searchParams?.enlace) ? searchParams?.enlace[0] : searchParams?.enlace;
  const enlace = crudo && /^(https?:\/\/|\/)/.test(crudo) ? crudo.slice(0, 500) : "";
  const seccion = Array.isArray(searchParams?.seccion) ? searchParams?.seccion[0] : searchParams?.seccion;

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Cómo trabaja Vigía", href: "/metodologia" }, { etiqueta: "Privacidad", href: "/privacidad" }]} />
      <EncabezadoPagina
        titulo="Privacidad y tus datos"
        bajada="Vigía vigila contratos del Estado, no personas. Así tratamos los datos personales que aparecen en los análisis."
      />
      <VistasComoTrabaja activa="privacidad" />

      {/* La política a la izquierda, en pestañas; el pedido de corrección, siempre a la vista a la derecha (2026-11-12:
          antes era una columna de cinco bloques y el formulario quedaba dos pantallas abajo). */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <Pestanas
          variante="segunda"
          className="min-w-0"
          etiqueta="Partes de la política de privacidad"
          activa={seccion}
          pestanas={[
          {
            clave: "que-publicamos",
            etiqueta: "Qué publicamos",
            titulo: "Lo que publicamos y lo que no",
            contenido: (
              // Cada regla en su fila con su ícono y, a la derecha, cómo se ve (2026-11-23, el usuario: «secciones que son
              // solo texto»): era una lista de viñetas de párrafos en una caja.
              <div className="overflow-hidden rounded-2xl border border-line bg-paper">
                <ul className="divide-y divide-line">
                  {REGLAS.map(({ icono: Icono, titulo, texto, muestra, abierto }) => (
                    <li key={titulo} className="flex gap-3 px-4 py-3.5 sm:px-5">
                      <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${abierto ? "bg-paperDeep text-inkSoft" : "bg-granate-50 text-granate"}`}>
                        <Icono size={17} strokeWidth={1.9} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-dato font-semibold leading-snug text-ink">{titulo}</p>
                        <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">{texto}</p>
                        {muestra && <p className="mt-1.5 text-meta text-mute">Se ve así: {muestra}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="flex gap-3 border-t border-line bg-granate-50/60 px-4 py-3.5 text-meta leading-relaxed text-inkSoft sm:px-5">
                  <ShieldCheck size={17} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                  <span>
                    <b className="font-semibold text-ink">Lo tapado no llega a tu navegador:</b> se tapa en nuestro servidor antes de
                    enviar la página. No hay forma de destaparlo desde el sitio, ni con el código de la página.
                  </span>
                </p>
              </div>
            ),
          },
          {
            clave: "fuentes",
            etiqueta: "De dónde salen",
            titulo: "De dónde salen",
            contenido: (
              <div className="space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <div className="flex gap-3">
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                    <Database size={17} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-dato font-semibold text-ink">De registros públicos del Estado</p>
                    <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">
                      Cada análisis enlaza a su fuente oficial: ahí está el dato completo, si necesitas verificarlo.
                    </p>
                    <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Registros">
                      {["Contratos del SEACE (OECE)", "Registro Nacional de Proveedores", "Aportes de campaña (ONPE)", "Candidaturas (JNE)", "Registros de visitas"].map((r) => (
                        <li key={r} className="rounded-full border border-line bg-paperSoft px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex gap-3 rounded-xl bg-amber-soft/50 p-3.5">
                  <ShieldAlert size={17} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
                  <p className="text-meta leading-relaxed text-inkSoft">
                    <b className="font-semibold text-ink">Una señal no es una acusación.</b> Vigía detecta patrones de riesgo en
                    contratos; investigar y sancionar le corresponde al Ministerio Público, la Contraloría y la prensa (
                    <Link href="/preguntas#tema-senales" className={ENLACE}>
                      cómo funciona
                    </Link>
                    ).
                  </p>
                </div>
              </div>
            ),
          },
          {
            clave: "derechos",
            etiqueta: "Tus derechos",
            titulo: "Tus derechos",
            contenido: (
              <div className="space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <p className="text-dato leading-relaxed text-inkSoft">
                  La <b className="font-semibold text-ink">Ley 29733</b>, de Protección de Datos Personales, te da cuatro derechos. Si
                  apareces en un análisis y un dato está mal o no debería estar, pídelo en el formulario.
                </p>
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {DERECHOS.map(({ icono: Icono, titulo, texto }) => (
                    <li key={titulo} className="flex gap-3 rounded-xl bg-paperSoft p-3">
                      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper text-granate">
                        <Icono size={16} strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-dato font-semibold text-ink">{titulo}</span>
                        <span className="block text-meta leading-snug text-inkSoft">{texto}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-line pt-3">
                  <span className="font-display text-cifra font-extrabold leading-none tabular-nums text-ink">10</span>
                  <span className="text-dato font-semibold text-ink">días hábiles, como máximo, para responderte por correo.</span>
                  <span className="text-meta text-inkSoft">Nunca te pediremos tu DNI.</span>
                </p>
              </div>
            ),
          },
          {
            clave: "no-hacemos",
            etiqueta: "Lo que no hacemos",
            titulo: "Lo que no hacemos",
            contenido: (
              <div className="space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <ul className="grid gap-2.5 sm:grid-cols-3">
                  {NO_HACEMOS.map(({ icono: Icono, texto }) => (
                    <li key={texto} className="flex flex-col gap-2 rounded-xl bg-paperSoft p-3.5">
                      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-crimson-soft text-crimsonTexto">
                        <Icono size={17} strokeWidth={1.9} />
                      </span>
                      <span className="text-dato font-semibold leading-snug text-ink">{texto}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex gap-2.5 text-meta leading-relaxed text-inkSoft">
                  <Code2 size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                  El código es abierto: cualquiera puede revisar cómo se tapa cada dato.
                </p>
              </div>
            ),
          },
          ]}
        />
        <section id="pedido" aria-labelledby="pedido-titulo" className="min-w-0 scroll-mt-20 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5 lg:sticky lg:top-4">
        <h2 id="pedido-titulo" className="font-display text-bloque font-bold tracking-tight text-ink">
          ¿Apareces en Vigía? Pide una corrección
        </h2>
        <p className="mt-1 text-dato leading-5 text-inkSoft">Con tu nombre y el enlace de la página ubicamos el dato.</p>
        <div className="mt-5">
          <FormularioPrivacidad enlaceInicial={enlace} />
        </div>
      </section>
      </div>
    </Pagina>
  );
}
