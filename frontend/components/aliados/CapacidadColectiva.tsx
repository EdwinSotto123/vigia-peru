import { Popover } from "@/components/ui/Flotante";
import { Ayuda } from "@/components/patrones/Ayuda";
import { alcanceCorto, type AlcanceProcesamiento } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";

/**
 * El déficit honesto de /app/aliados: cuánto de lo que hay por leer pagaron los aliados,
 * y cuánto de eso ya se leyó.
 *
 * Antes esta superficie abría con un podio de tres puestos donde dos eran
 * losas "vacante". Con un único financiador eso no celebraba nada: probaba
 * soledad. Y en una herramienta anticorrupción, darle escenario a quien paga
 * contradice la promesa central del producto — el que paga no elige.
 *
 * Una palabra, una definición (DESIGN_SYSTEM.md §10.1): acá se habla de lo
 * FINANCIADO. El último escalón son los "financiados leídos", no los "leídos"
 * (que en la portada incluyen también las lecturas que nadie financió). Antes
 * esta página decía "se leyeron 53 de 18,393" mientras la portada decía 118:
 * los dos eran ciertos, pero con la misma palabra para dos cosas distintas.
 *
 * Las barras están a escala real. Las dos últimas salen como un hilo porque
 * eso es lo que son: cualquier mínimo cosmético que las hiciera "legibles"
 * estaría mintiendo sobre el tamaño del trabajo hecho.
 *
 * Densidad (§10.7): título corto, la cascada como fila de cifras y lo que queda
 * por financiar en una línea de datos. La frase larga que abría la sección
 * repetía las cifras del encabezado de la página.
 */

export interface Escalon {
  etiqueta: string;
  nota?: string;
  valor: number;
  tono: "escala" | "financiado" | "leido";
}

/** financiado = granate (la marca: alguien pagó); leído = moss (positivo). */
const TONO: Record<Escalon["tono"], string> = {
  escala: "bg-mute/45",
  financiado: "bg-granate",
  leido: "bg-moss",
};

/**
 * Los tres destinos de un contrato leído. "En revisión" es un estado, no una severidad:
 * va en neutro, no en ámbar (que es "Señal media").
 */
export const PARTES_LECTURA = {
  senal: "bg-rust",
  revision: "bg-mute/50",
  limpio: "bg-moss",
} as const;

/**
 * Proporción legible, compartida por la cascada y las tarjetas del muro. Sin redondear a
 * "0 %" lo que no es cero: bajo 1 % se muestran dos decimales. Sin denominador no hay
 * proporción: devuelve null y no se dibuja nada (nunca un guion mudo).
 */
export function pctProporcion(v: number, total: number): string | null {
  if (!total) return null;
  const p = (v / total) * 100;
  const dec = p >= 10 ? 0 : p >= 1 ? 1 : 2;
  // El locale decide: es-PE usa coma de miles y punto decimal ("18,394" y "0.18 %").
  return `${p.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
}

export function CapacidadColectiva({
  ambito,
  publicados,
  cola,
  documentosListos,
  financiados,
  leidos,
  conSenal,
  enRevision,
  precioPen,
  alcance,
}: {
  /** "todo el Perú" o el nombre de la región filtrada. Va dentro de la frase, no como etiqueta. */
  ambito: string;
  publicados: number;
  cola: number;
  documentosListos: number;
  financiados: number;
  /** Financiados cuya lectura terminó (asignaciones procesadas). */
  leidos: number;
  conSenal: number;
  enRevision: number;
  precioPen: number;
  alcance: AlcanceProcesamiento | null;
}) {
  const sinSenal = Math.max(0, leidos - conSenal - enRevision);
  const porFinanciar = Math.max(0, cola - financiados);
  const escalones: Escalon[] = [
    {
      etiqueta: "Contratos publicados",
      nota: `Descargados de la API OCDS del OECE para ${ambito}. La zona es la sede de la entidad que contrata.`,
      valor: publicados,
      tono: "escala",
    },
    {
      etiqueta: "Entran hoy a la cola",
      nota: `Solo ${alcanceCorto(alcance)}.${documentosListos > 0 ? ` Otros ${numero(documentosListos)} ya tienen sus documentos descargados, pero su tipo de contrato todavía no entra a la cola.` : ""}`,
      valor: cola,
      tono: "escala",
    },
    {
      etiqueta: "Financiados",
      nota: `${soles(precioPen)} por contrato. Se asignan por antigüedad en la cola: nadie elige cuáles.`,
      valor: financiados,
      tono: "financiado",
    },
    {
      etiqueta: "Financiados leídos",
      nota: "Expediente completo, norma citada y dictamen público.",
      valor: leidos,
      tono: "leido",
    },
  ];

  return (
    <section aria-labelledby="capacidad-titulo" className="rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
      {/* El titular es chico a propósito: esta sección es el CONTEXTO del muro, no su
          competencia. El protagonista de la página es quien financia. */}
      <div className="flex items-center gap-1.5">
        <h2 id="capacidad-titulo" className="text-[15px] font-semibold leading-snug text-ink text-pretty">
          {financiados === 0
            ? `Todavía no se financió ningún contrato de ${ambito}`
            : `Cuánto de lo publicado en ${ambito} se financió y se leyó`}
        </h2>
        <Ayuda titulo="¿Financiados leídos o leídos?">
          Aquí se cuentan sólo las lecturas que pagó un aliado. La portada cuenta todos los leídos, también los que
          nadie financió: por eso allá el número es mayor.
        </Ayuda>
      </div>
      {/* La cascada, en UNA fila. La nota de cada escalón se abre al tocar su etiqueta
          (Popover): un `title=""` no existe en pantallas táctiles ni con teclado. */}
      <ol className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
        {escalones.map((e) => {
          const p = pctProporcion(e.valor, publicados);
          return (
            <li key={e.etiqueta} className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold tabular-nums text-ink">{numero(e.valor)}</span>
                {p && <span className="font-mono text-[12px] tabular-nums text-mute">{p}</span>}
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                <div
                  className={`h-1.5 min-w-[2px] rounded-full ${TONO[e.tono]}`}
                  style={{ width: `${publicados > 0 ? (e.valor / publicados) * 100 : 0}%` }}
                />
              </div>
              {e.nota ? (
                <Popover
                  titulo={e.etiqueta}
                  anchoClase="w-72"
                  className="mt-1 min-h-[24px] text-left text-[12px] leading-snug text-inkSoft underline decoration-dotted underline-offset-2 hover:text-ink"
                  trigger={<>{e.etiqueta}</>}
                >
                  {e.nota}
                </Popover>
              ) : (
                <p className="mt-1 text-[12px] leading-snug text-inkSoft">{e.etiqueta}</p>
              )}
            </li>
          );
        })}
      </ol>

      {/* En qué terminaron las lecturas financiadas: las tres partes de un mismo total,
          en una barra apilada a escala, con la palabra de cada parte (nunca el color solo). */}
      {leidos > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="inline-flex items-center gap-1 text-[12px] text-inkSoft">
            <span>
              En qué terminaron los <span className="font-mono font-semibold tabular-nums text-ink">{numero(leidos)}</span> financiados leídos
            </span>
            <Ayuda titulo="¿Se publica todo?">Sí: se publican igual, señalen a quien señalen, también a quien financió.</Ayuda>
          </p>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep" role="img"
            aria-label={`${numero(conSenal)} con señales, ${numero(enRevision)} en revisión, ${numero(sinSenal)} sin señales`}>
            {conSenal > 0 && <div className={`h-full ${PARTES_LECTURA.senal}`} style={{ width: `${(conSenal / leidos) * 100}%` }} />}
            {enRevision > 0 && <div className={`h-full ${PARTES_LECTURA.revision}`} style={{ width: `${(enRevision / leidos) * 100}%` }} />}
            {sinSenal > 0 && <div className={`h-full ${PARTES_LECTURA.limpio}`} style={{ width: `${(sinSenal / leidos) * 100}%` }} />}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
            <Parte color={PARTES_LECTURA.senal} n={conSenal} total={leidos} texto="con señales publicadas y norma citada" />
            <Parte color={PARTES_LECTURA.revision} n={enRevision} total={leidos} texto="en revisión" />
            <Parte color={PARTES_LECTURA.limpio} n={sinSenal} total={leidos} texto="sin señales" />
          </ul>
        </div>
      )}

      {/* Sin botón propio: /app/aliados tiene UNA invitación a financiar, al pie. */}
      {porFinanciar > 0 && (
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[13px] tabular-nums text-inkSoft">
          <span>
            <span className="font-mono font-semibold text-ink">{numero(porFinanciar)}</span> en la cola sin financiar
          </span>
          <span>
            <span className="font-mono font-semibold text-ink">{soles(porFinanciar * precioPen)}</span> leerlos todos, a{" "}
            {soles(precioPen)} cada uno
          </span>
        </p>
      )}
    </section>
  );
}

/** Una parte de la barra apilada: punto, cifra con su denominador, y qué es. */
function Parte({ color, n, total, texto }: { color: string; n: number; total: number; texto: string }) {
  if (n <= 0) return null;
  return (
    <li className="inline-flex items-baseline gap-1.5 text-mute">
      <span className={`mt-0.5 h-2 w-2 shrink-0 self-center rounded-full ${color}`} aria-hidden />
      <span className="font-mono font-semibold tabular-nums text-ink">{numero(n)}</span>
      <span className="text-mute">de {numero(total)} {texto}</span>
    </li>
  );
}
