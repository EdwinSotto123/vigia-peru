import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPagina } from "@/components/patrones";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { soles } from "@/lib/formato";
import { Acordeon, type PreguntaFAQ } from "./Acordeon";

export const metadata: Metadata = {
  title: "Preguntas frecuentes",
  description:
    "Qué hace Vigía Perú y qué no: de dónde salen los contratos, cuánto cuesta leer uno, quién lo paga y por qué nadie elige qué se analiza.",
};

const REPO = "https://github.com/EdwinSotto123/vigia-peru";
// TODO(contacto): reemplazar cuando exista un correo del equipo
const CONTACTO = `${REPO}/issues`;

const EXTERNO = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

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
      <>Leer un contrato con todos sus documentos tiene un precio fijo por contrato, publicado con su desglose en la portada.</>
    );

  const FAQ: PreguntaFAQ[] = [
    {
      slug: "acusa",
      q: "¿Vigía Perú acusa a alguien de corrupción?",
      a: "No. Decimos 'señal de riesgo' o 'patrón detectado'. La diferencia es jurídica y ética: las acusaciones las hacen el Ministerio Público o la Contraloría, no nosotros. Cada señal cita la norma específica que aparenta incumplirse y enlaza a la fuente oficial (SEACE, OECE, MEF).",
    },
    {
      slug: "fuentes",
      q: "¿De dónde salen los contratos?",
      a: "De la API de Contrataciones Abiertas del OECE (estándar OCDS): todos los procesos publicados en el SEACE, de todo el Perú, se descargan y quedan representados en el mapa y en la lista de contratos aunque todavía nadie los haya analizado. Para el análisis se cruzan además SUNAT (edad del RUC), INFOBRAS (avance de obras), Claridad ONPE (aportes de campaña), JNE (hojas de vida) y el registro de sancionados del OSCE.",
    },
    {
      slug: "financiar",
      q: "¿Qué significa 'financiar una auditoría'?",
      a: (
        <>
          {costo} Al financiar, aportas capacidad de lectura para una zona (región, provincia o distrito). Los contratos se
          toman en orden de llegada: nadie, ni tú ni nosotros, elige cuál se analiza ni qué se publica. Recibes un
          comprobante público con cada contrato procesado y las señales halladas.
        </>
      ),
    },
    {
      slug: "sin-eleccion",
      q: "¿Por qué no puedo elegir qué contrato se audita?",
      a: (
        <>
          Porque si el financiador eligiera el contrato, el sistema podría usarse para presionar a una entidad o a un
          competidor. Financias capacidad, no resultados. Y si quien aporta tiene un conflicto de interés que el sistema
          detecta (una empresa con sanción vigente o con alertas activas en esa zona), su aporte procesa contratos igual,
          pero no aparece en el ranking ni en el muro de aliados: puede financiar, pero no recibe reconocimiento. Si el
          análisis que financió lo encuentra a él, se publica igual. Todas las reglas están en{" "}
          <Link href="/app/financiar#independencia" className={EXTERNO}>
            Financiar
          </Link>
          .
        </>
      ),
    },
    {
      slug: "clasificacion",
      q: "¿Todos los contratos del SEACE se analizan igual?",
      a: "No. Cada contrato se clasifica por tipo (bienes, servicios, consultoría, obras, convenio, contratación directa) y por etapa (convocado, adjudicado, contratado, en ejecución, desierto…). Solo corren los análisis que aplican: por ejemplo, la comparación de precios de mercado solo tiene sentido en bienes con ítems y cantidades; el cruce de proveedores solo cuando ya hay adjudicación. Lo que aún no se puede analizar queda marcado como 'pendiente de procesamiento' con el motivo visible.",
    },
    {
      slug: "anonimato",
      q: "Si denuncio algo, ¿se publica mi nombre?",
      a: "No. Las denuncias se envían sin tu nombre por defecto, y no mostramos DNI ni nombres de personas naturales. Si dejas un correo, queda guardado junto a la denuncia y nunca se publica.",
    },
    {
      slug: "verificacion",
      q: "¿Quién revisa las denuncias de los vecinos?",
      a: "Nadie las edita antes de publicarlas. Una denuncia de obra necesita una foto y se publica tal como llegó, en la lista y en el mapa; figura como «confirmada» sólo cuando la respaldan dos o más reportes independientes del mismo lugar. Es el testimonio de un vecino, no un hallazgo de Vigía. Las denuncias sobre una entidad no se publican: quedan en reserva.",
    },
    {
      slug: "ia",
      q: "¿La IA decide quién es corrupto?",
      a: "No, y no queremos que lo haga. Los modelos de lenguaje se usan para leer los expedientes, cruzarlos con las opiniones normativas del OECE y redactar el dictamen en lenguaje claro. Las señales las produce código determinista con reglas y normas explícitas; una señal siempre tiene regla, norma y fuente, nunca es una opinión del modelo.",
    },
    {
      slug: "como-se-sostiene",
      q: "¿Cómo se sostiene el proyecto?",
      a: (
        <>
          Con los aportes de{" "}
          <Link href="/app/financiar" className={EXTERNO}>
            Financia una auditoría
          </Link>
          , nunca con publicidad ni venta de datos. El{" "}
          <a href={REPO} target="_blank" rel="noreferrer" className={EXTERNO}>
            código es abierto
          </a>
          : una herramienta anticorrupción cerrada sería una contradicción.
        </>
      ),
    },
    {
      slug: "cuentas",
      q: "¿Cuánto cuesta leer un contrato y quién lo paga?",
      a: (
        <>
          {costo} Lo pagan las personas, colectivos y empresas que{" "}
          <Link href="/app/financiar" className={EXTERNO}>
            financian una auditoría
          </Link>
          , y su aporte se cuenta en contratos, no en soles. El desglose vigente está en la portada, en la sección{" "}
          <Link href="/#aliados" className={EXTERNO}>
            Aliados
          </Link>
          , y el código que asigna y procesa cada contrato es público en{" "}
          <a href={REPO} target="_blank" rel="noreferrer" className={EXTERNO}>
            GitHub
          </a>
          .
        </>
      ),
    },
    {
      slug: "contraloria",
      q: "¿Reemplaza a la Contraloría o al periodismo?",
      a: "No. Vigía detecta y prioriza: entrega a Contraloría, fiscalía y periodistas una cola ordenada por riesgo con el expediente pre-armado y la cita normativa lista. La investigación y la sanción siguen siendo de ellos.",
    },
  ];

  return (
    <div className="container-page max-w-3xl space-y-8 py-8 sm:py-10">
      <EncabezadoPagina
        titulo="¿Cómo funciona Vigía Perú?"
        bajada={
          <>
            Si tu pregunta no está,{" "}
            <a className={EXTERNO} href={CONTACTO} target="_blank" rel="noreferrer">
              escríbenos (GitHub)
            </a>
            .
          </>
        }
      />

      <Acordeon items={FAQ} />

      {/* Llamado de marca: granate profundo, con `sobre-oscuro` para que el foco pase a maíz. */}
      <div className="sobre-oscuro rounded-2xl bg-granate-deep p-6 text-paper">
        <h2 className="font-display text-xl font-bold text-balance">¿Eres periodista, fiscal o auditor?</h2>
        <p className="mt-2 text-sm leading-relaxed text-paper/75">
          Cada dictamen publicado cita la norma, enlaza la fuente oficial y muestra la traza del análisis, listo para verificar.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/app/auditoria" className="inline-flex min-h-[44px] items-center rounded-full bg-paper px-5 py-2 text-sm font-semibold text-granate transition-colors duration-rapido hover:bg-maiz-soft">
            Ver la auditoría en vivo
          </Link>
          {/* TODO(contacto): reemplazar cuando exista un correo del equipo */}
          <a
            href={CONTACTO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-full border border-paper/40 px-5 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-paper/10"
          >
            Escríbenos (GitHub)
          </a>
        </div>
      </div>
    </div>
  );
}
