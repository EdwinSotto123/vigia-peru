import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import Link from "next/link";
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
function Marca({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap rounded bg-ink/10 px-1 font-mono text-[0.85em] tracking-wider text-mute">{children}</span>;
}

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
          className="min-w-0"
          etiqueta="Partes de la política de privacidad"
          activa={seccion}
          pestanas={[
          {
            clave: "que-publicamos",
            etiqueta: "Qué publicamos",
            titulo: "Lo que publicamos y lo que no",
            contenido: (
              <div className="space-y-3 rounded-2xl border border-line bg-paper p-4 text-dato leading-relaxed text-inkSoft sm:p-5">
        <ul className="list-disc space-y-2 pl-5 marker:text-mute">
          <li>
            <strong className="font-semibold text-ink">Nunca un número de DNI, ni en parte.</strong> Donde un registro lo trae,
            se ve <Marca>••••••••</Marca> y, al pasar el puntero, una referencia como <Marca>7K2Q9A</Marca>: identifica a la
            misma persona en todo Vigía (para ver, por ejemplo, que el firmante de un acta es también socio del ganador) sin
            revelar su número.
          </li>
          <li>
            El RUC de una persona natural empieza con 10 y lleva su DNI adentro: también va tapado, como{" "}
            <Marca>10•••••••••</Marca>.
          </li>
          <li>
            De las personas privadas (proveedores que son personas naturales, socios, representantes, funcionarios no
            electos, visitantes de una entidad) tapamos un apellido: <Marca>JUAN CARLOS PÉREZ •••</Marca>.
          </li>
          <li>
            Los familiares que la IA deduce de un registro no se nombran: sólo se dice el vínculo, porque puede ser un
            homónimo. Si además tienen un papel en el contrato (por ejemplo, son socios del proveedor), van como cualquier
            persona privada: con un apellido tapado.
          </li>
          <li>
            Las autoridades electas (alcaldes, gobernadores, regidores) y las empresas aparecen con su nombre completo:
            su función es pública.
          </li>
          <li>Los celulares y correos que aparezcan en un documento, tapados.</li>
        </ul>
        <p>
          Lo tapado no llega a tu navegador: se tapa en nuestro servidor antes de enviar la página. No hay forma de
          destaparlo desde el sitio, ni con el código de la página.
        </p>
              </div>
            ),
          },
          {
            clave: "fuentes",
            etiqueta: "De dónde salen",
            titulo: "De dónde salen",
            contenido: (
              <div className="space-y-3 rounded-2xl border border-line bg-paper p-4 text-dato leading-relaxed text-inkSoft sm:p-5">
        <p>
          De registros públicos del Estado: los contratos del SEACE (OECE), el Registro Nacional de Proveedores, los
          aportes de campaña (ONPE), las candidaturas (JNE) y los registros de visitas de las entidades. Cada análisis
          enlaza a su fuente oficial: ahí está el dato completo, si necesitas verificarlo.
        </p>
        <p>
          <strong className="font-semibold text-ink">Una señal no es una acusación.</strong> Vigía detecta patrones de riesgo
          en contratos; investigar y sancionar le corresponde al Ministerio Público, la Contraloría y la prensa (
          <Link href="/preguntas#tema-senales" className={ENLACE}>
            cómo funciona
          </Link>
          ).
        </p>
              </div>
            ),
          },
          {
            clave: "derechos",
            etiqueta: "Tus derechos",
            titulo: "Tus derechos",
            contenido: (
              <div className="space-y-3 rounded-2xl border border-line bg-paper p-4 text-dato leading-relaxed text-inkSoft sm:p-5">
        <p>
          La Ley 29733, de Protección de Datos Personales, te da derecho a saber qué datos tuyos tenemos, a corregirlos, a
          pedir que se retiren y a oponerte a que se usen. Si apareces en un análisis y un dato está mal o no debería
          estar, escríbenos aquí. Te respondemos por correo en un plazo máximo de 10 días hábiles. Nunca te pediremos tu DNI.
        </p>
              </div>
            ),
          },
          {
            clave: "no-hacemos",
            etiqueta: "Lo que no hacemos",
            titulo: "Lo que no hacemos",
            contenido: (
              <div className="space-y-3 rounded-2xl border border-line bg-paper p-4 text-dato leading-relaxed text-inkSoft sm:p-5">
        <p>
          No vendemos datos, no mostramos publicidad y no armamos perfiles de personas. El código es abierto: cualquiera
          puede revisar cómo se tapa cada dato.
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
