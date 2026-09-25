import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPagina, Pagina } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { FUENTES_FLUJO } from "@/components/landing/fuentesFlujo";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { soles } from "@/lib/formato";
import { AbrirPorAncla } from "./AbrirPorAncla";
import { TemaPreguntas, type TemaFAQ } from "./TemaPreguntas";

export const metadata: Metadata = {
  title: "Preguntas frecuentes",
  description:
    "Qué hace Vigía Perú y qué no: de dónde salen los contratos, cuánto cuesta leer uno, quién lo paga y por qué nadie elige qué se analiza.",
};

const REPO = "https://github.com/EdwinSotto123/vigia-peru";
// TODO(contacto): reemplazar cuando exista un correo del equipo
const CONTACTO = `${REPO}/issues`;

const ENLACE = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

/** "S/1 procesamiento · S/1 infraestructura y datos · …" → [{monto, concepto}]. Mismo formato que lee la portada. */
function partesDeTarifa(nota: string | null | undefined): { monto: number; concepto: string }[] {
  if (!nota) return [];
  return nota
    .split(/\s*·\s*/)
    .map((p) => p.match(/^S\/\s?(\d+(?:[.,]\d+)?)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    // "reserva expedientes pesados" es una etiqueta de tabla; en una oración pide "para".
    .map((m) => ({ monto: Number(m[1].replace(",", ".")), concepto: m[2].replace(/^reserva (?!para |de )/, "reserva para ") }));
}

/** "a, b y c" */
function enumerar(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Cómo se nombra cada fuente dentro de una oración. QUÉ fuentes se nombran no se
 * escribe acá: sale de `FUENTES_FLUJO` (el mapa de fuentes de la portada,
 * verificado contra el código), sólo las que hoy se usan. Antes esta respuesta
 * nombraba SUNAT e INFOBRAS, que ningún análisis lee hoy.
 */
const FUENTE_EN_FRASE: Record<string, string> = {
  rnp: "los socios y representantes de cada proveedor (RNP)",
  sancionados: "los proveedores sancionados",
  visitas: "las visitas a entidades públicas",
  onpe: "los aportes de campaña (ONPE)",
  jne: "las candidaturas y autoridades electas (JNE)",
};

export default async function PreguntasPage() {
  // La tarifa sale del mismo endpoint público que usa la portada. Si el API no
  // responde, la respuesta no inventa cifras: remite al desglose en vivo.
  const estado = await getEstadoGlobal();
  const precio = estado?.tarifa?.precioPen ?? null;
  const partes = partesDeTarifa(estado?.tarifa?.nota);

  const costo =
    precio != null ? (
      <>
        Leer un contrato con todos sus documentos cuesta <strong className="text-ink">{soles(precio)}</strong>
        {partes.length > 0 && <>: {enumerar(partes.map((p) => `${soles(p.monto)} de ${p.concepto}`))}</>}.
      </>
    ) : (
      <>
        Leer un contrato con todos sus documentos tiene un precio fijo, publicado con su desglose en{" "}
        <Link href="/#aliados" className={ENLACE}>
          la portada
        </Link>
        .
      </>
    );

  const seace = FUENTES_FLUJO.find((f) => f.clave === "seace");
  const cruces = FUENTES_FLUJO.filter((f) => f.estado === "en_uso" && f.clave !== "seace").map(
    (f) => FUENTE_EN_FRASE[f.clave] ?? f.corto,
  );

  // Dos columnas en escritorio, cada una una pila propia: abrir una respuesta sólo
  // empuja lo que tiene debajo en SU columna, no deja un hueco en la de al lado.
  const COLUMNAS: TemaFAQ[][] = [
    [
      {
        id: "senales",
        titulo: "Las señales",
        preguntas: [
          {
            slug: "acusa",
            q: "¿Vigía Perú acusa a alguien de corrupción?",
            a: "No. Publica señales de riesgo, no acusaciones: acusar le corresponde al Ministerio Público o a la Contraloría. Cada señal cita la norma que parece incumplirse y enlaza al registro oficial de donde sale.",
          },
          {
            slug: "ia",
            q: "¿La IA decide quién es corrupto?",
            a: "No. La IA lee los documentos de cada contrato, los compara con los criterios del OECE y redacta el dictamen en palabras simples. Las señales salen de reglas fijas y escritas: cada una tiene su regla, la norma que cita y la fuente del dato, nunca una opinión de la IA.",
          },
          {
            slug: "contraloria",
            q: "¿Reemplaza a la Contraloría o al periodismo?",
            a: "No. Vigía detecta y ordena por riesgo: a la Contraloría, la fiscalía y el periodismo les deja el expediente armado y la norma citada. Investigar y sancionar sigue siendo trabajo de ellos.",
          },
        ],
      },
      {
        id: "contratos",
        titulo: "Los contratos",
        preguntas: [
          {
            slug: "fuentes",
            q: "¿De dónde salen los contratos?",
            a: (
              <>
                Del SEACE, a través de{" "}
                {seace?.url ? (
                  <a href={seace.url} target="_blank" rel="noreferrer" className={ENLACE}>
                    Contrataciones Abiertas del OECE
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                ) : (
                  "Contrataciones Abiertas del OECE"
                )}
                : cada contrato que el Estado publica, de todo el Perú, está en el mapa y en la{" "}
                <Link href="/app/contratos" className={ENLACE}>
                  lista de contratos
                </Link>{" "}
                aunque nadie lo haya leído todavía.
                {cruces.length > 0 && <> Al leerlo, Vigía lo cruza con {enumerar(cruces)}.</>} Qué se toma de cada
                fuente está en el{" "}
                <Link href="/#fuentes" className={ENLACE}>
                  mapa de fuentes
                </Link>
                .
              </>
            ),
          },
          {
            slug: "clasificacion",
            q: "¿Todos los contratos del SEACE se analizan igual?",
            a: "No. Cada contrato se clasifica por tipo (bienes, servicios, consultoría, obras…) y por etapa (convocado, adjudicado, en ejecución…), y sólo se hacen las revisiones que le aplican: los precios de mercado se comparan en compras de bienes con cantidades, y los proveedores se cruzan cuando ya hay un ganador. Lo que todavía no se puede revisar queda marcado como pendiente, con el motivo a la vista.",
          },
        ],
      },
    ],
    [
      {
        id: "financiar",
        titulo: "Financiar",
        preguntas: [
          {
            slug: "financiar",
            q: "¿Qué significa «financiar una auditoría»?",
            a: "Aportas capacidad de lectura para una zona: una región, provincia o distrito. Sus contratos se leen en orden de llegada; nadie, ni tú ni nosotros, elige cuál se lee ni qué se publica. Recibes un comprobante público con cada contrato leído y sus señales.",
          },
          {
            slug: "cuentas",
            q: "¿Cuánto cuesta leer un contrato y quién lo paga?",
            a: (
              <>
                {costo} Lo pagan las personas, colectivos y empresas que{" "}
                <Link href="/app/financiar" className={ENLACE}>
                  financian una auditoría
                </Link>
                , y cada aporte se cuenta en contratos leídos, no en soles. Sus nombres están en el{" "}
                <Link href="/app/aliados" className={ENLACE}>
                  ranking de aliados
                </Link>
                .
              </>
            ),
          },
          {
            slug: "sin-eleccion",
            q: "¿Por qué no puedo elegir qué contrato se audita?",
            a: (
              <>
                Porque si quien paga eligiera, Vigía podría usarse para presionar a una entidad o a un competidor: financias
                capacidad, no resultados. Si quien aporta tiene un conflicto de interés que el sistema detecta (una sanción
                vigente o señales activas en esa zona), su aporte se usa igual, pero no aparece en el ranking de aliados. Y
                si el análisis que financió lo encuentra a él, se publica igual. Todas las reglas están en{" "}
                <Link href="/app/financiar#independencia" className={ENLACE}>
                  Financiar
                </Link>
                .
              </>
            ),
          },
          {
            slug: "como-se-sostiene",
            q: "¿Cómo se sostiene el proyecto?",
            a: (
              <>
                Con los aportes de quienes financian auditorías, nunca con publicidad ni venta de datos. El{" "}
                <a href={REPO} target="_blank" rel="noreferrer" className={ENLACE}>
                  código es abierto
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
                : cualquiera puede revisar cómo trabaja.
              </>
            ),
          },
        ],
      },
      {
        id: "denuncias",
        titulo: "Denuncias",
        preguntas: [
          {
            slug: "anonimato",
            q: "Si denuncio algo, ¿se publica mi nombre?",
            a: "No. Para denunciar no necesitas cuenta ni nombre. Si dejas un correo, se guarda con la denuncia y nunca se publica.",
          },
          {
            slug: "verificacion",
            q: "¿Quién revisa las denuncias de los vecinos?",
            a: (
              <>
                Nadie las edita. Una denuncia de obra lleva foto y se publica tal como llegó, en el mapa y en la{" "}
                <Link href="/app/denuncias" className={ENLACE}>
                  lista de denuncias
                </Link>
                ; pasa a «confirmada» cuando dos o más reportes independientes señalan el mismo lugar. Es el testimonio de
                un vecino, no un hallazgo de Vigía. Las denuncias sobre una entidad no se publican: quedan en reserva.
              </>
            ),
          },
        ],
      },
    ],
  ];

  const temas = COLUMNAS.flat();

  return (
    <Pagina>
      <AbrirPorAncla />
      <EncabezadoPagina
        titulo="¿Cómo funciona Vigía Perú?"
        bajada={
          <>
            Si tu pregunta no está,{" "}
            <a className={ENLACE} href={CONTACTO} target="_blank" rel="noreferrer">
              déjala en GitHub
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            .
          </>
        }
      />

      {/* Índice de temas sólo en una columna (celular, tableta): en escritorio los
          cuatro temas se ven juntos y el índice repetiría lo que ya está a la vista. */}
      <nav aria-label="Temas" className="xl:hidden">
        <ul className="flex flex-wrap gap-2">
          {temas.map((t) => (
            <li key={t.id}>
              <a
                href={`#tema-${t.id}`}
                className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
              >
                {t.titulo}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid items-start gap-8 xl:grid-cols-2 xl:gap-10">
        {COLUMNAS.map((columna, i) => (
          <div key={i} className="min-w-0 space-y-8">
            {columna.map((t) => (
              <TemaPreguntas key={t.id} tema={t} />
            ))}
          </div>
        ))}
      </div>

      {/* Llamado de marca en una franja baja: granate profundo, con `sobre-oscuro`
          para que el foco pase a maíz. */}
      <section
        aria-labelledby="para-periodistas"
        className="sobre-oscuro flex flex-col gap-4 rounded-2xl bg-granate-deep p-5 text-paper sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8"
      >
        <div className="min-w-0">
          <h2 id="para-periodistas" className="font-display text-lg font-bold text-balance">
            ¿Eres periodista, fiscal o auditor?
          </h2>
          <p className="mt-1 text-sm leading-snug text-paper/75 text-pretty">
            Cada señal publicada trae la regla que la disparó, la norma que cita y la evidencia del expediente.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <EnlaceAccion href="/app/hallazgos" variante="oscuro" flecha>
            Ver las señales
          </EnlaceAccion>
          <EnlaceAccion href="/app/auditoria?seccion=leidos" variante="contornoOscuro">
            Ver los contratos ya leídos
          </EnlaceAccion>
        </div>
      </section>
    </Pagina>
  );
}
