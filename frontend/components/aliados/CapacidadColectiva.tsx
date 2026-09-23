import { Popover } from "@/components/ui/Flotante";
import { alcanceCorto, formatPEN, type AlcanceProcesamiento } from "@/lib/financiamiento";

/**
 * El déficit honesto, y es lo primero que se ve en /app/aliados.
 *
 * Antes esta superficie abría con un podio de tres puestos donde dos eran
 * losas "vacante". Con un único financiador eso no celebraba nada: probaba
 * soledad. Y en una herramienta anticorrupción, darle escenario a quien paga
 * contradice la promesa central del producto — el que paga no elige.
 *
 * Lo que sí es noticia es la proporción, y hoy no se veía en ninguna parte:
 * de los 18.394 contratos descargados se leyeron 33. Ninguna cifra de esta
 * página se muestra sin su denominador, porque el número solo (45, 33, 19)
 * no dice nada y el número comparado lo dice todo.
 *
 * Las barras están a escala real. Las dos últimas salen como un hilo porque
 * eso es lo que son: cualquier mínimo cosmético que las hiciera "legibles"
 * estaría mintiendo sobre el tamaño del trabajo hecho.
 */

export interface Escalon {
  etiqueta: string;
  nota?: string;
  valor: number;
  tono: "escala" | "financiado" | "leido";
}

const TONO: Record<Escalon["tono"], string> = {
  escala: "bg-mute/45",
  financiado: "bg-heroViolet",
  leido: "bg-heroGreen",
};

const num = (n: number) => n.toLocaleString("es-PE");

/** Sin redondear a "0 %" lo que no es cero: bajo 1 % se muestran dos decimales. */
function pctTxt(v: number, total: number): string {
  if (!total) return "—";
  const p = (v / total) * 100;
  const dec = p >= 10 ? 0 : p >= 1 ? 1 : 2;
  // Sin .replace(".", ","): es-PE usa COMA para miles y PUNTO para decimales.
  // Forzar la coma hacía que en la misma línea conviviera "18,394" (coma =
  // miles) con "0,18 %" (coma = decimal), o sea el mismo carácter con dos
  // significados en un producto que habla de plata. El locale decide, no nosotros.
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
      etiqueta: "Contratos públicos descargados",
      nota: `Descargados de la API OCDS del OECE para ${ambito}.`,
      valor: publicados,
      tono: "escala",
    },
    {
      etiqueta: "Entran hoy a la cola financiable",
      nota: `Solo ${alcanceCorto(alcance)}.${documentosListos > 0 ? ` Otros ${num(documentosListos)} ya tienen sus documentos descargados, pero su tipo de contrato todavía no está activo para análisis.` : ""}`,
      valor: cola,
      tono: "escala",
    },
    {
      etiqueta: "Financiados por aliados",
      nota: `${formatPEN(precioPen)} por contrato. Se asignan por antigüedad en la cola: nadie elige cuáles.`,
      valor: financiados,
      tono: "financiado",
    },
    {
      etiqueta: "Leídos de verdad por los agentes",
      nota: "Expediente completo, norma citada y dictamen público",
      valor: leidos,
      tono: "leido",
    },
  ];

  return (
    <section aria-labelledby="capacidad-titulo" className="rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
      {/* El titular baja de serif 24px a 15px: esta sección es el CONTEXTO del
          muro, no su competencia. El protagonista de la página es quien financia. */}
      <h2 id="capacidad-titulo" className="max-w-[70ch] text-[15px] font-semibold leading-snug text-ink">
        {leidos === 0 ? (
          <>
            Todavía no se leyó ninguno de los{" "}
            <span className="font-mono">{num(publicados)}</span> contratos públicos descargados de {ambito}.
          </>
        ) : (
          <>
            Entre todos se leyeron <span className="font-mono">{num(leidos)}</span> de los{" "}
            <span className="font-mono">{num(publicados)}</span> contratos públicos descargados de {ambito}.
            {publicados > 0 && (
              <>
                {" "}Es el <span className="font-mono">{pctTxt(leidos, publicados)}</span>.
              </>
            )}
          </>
        )}
      </h2>
      {/* La cascada, en UNA fila.
          Antes eran cuatro renglones apilados, cada uno con su barra y su nota
          de dos líneas: 785 px, el 31 % de la página, y encima ARRIBA del muro.
          Esta página existe para enaltecer a quien financia, y el contexto le
          estaba ganando la pantalla al protagonista. La nota de cada escalón se
          abre al tocar su etiqueta (Popover): antes vivía en un `title=""`, que no
          existe en pantallas táctiles ni con teclado. */}
      <ol className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        {escalones.map((e) => (
          <li key={e.etiqueta}>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-lg font-bold tabular-nums text-ink">{num(e.valor)}</span>
              <span className="font-mono text-[11px] text-mute">{pctTxt(e.valor, publicados)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
              <div
                className={`h-1.5 min-w-[2px] rounded-full ${TONO[e.tono]}`}
                style={{ width: `${publicados > 0 ? (e.valor / publicados) * 100 : 0}%` }}
              />
            </div>
            {e.nota ? (
              <Popover
                titulo={e.etiqueta}
                anchoClase="w-72"
                className="mt-1 text-left text-[12px] leading-snug text-inkSoft underline decoration-dotted underline-offset-2 hover:text-ink"
                trigger={<>{e.etiqueta}</>}
              >
                {e.nota}
              </Popover>
            ) : (
              <p className="mt-1 text-[12px] leading-snug text-inkSoft">{e.etiqueta}</p>
            )}
          </li>
        ))}
      </ol>

      {/* En qué terminaron las lecturas. Antes eran tres renglones de prosa
          ("De los 190 leídos, 84 tienen al menos una señal, 26 esperan
          revisión…"): las tres partes de un mismo total, escritas en fila en
          vez de dibujadas. Una barra apilada dice lo mismo de un vistazo y
          además deja ver la proporción, que es lo que la frase escondía. */}
      {leidos > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-[12px] text-mute">
            En qué terminaron los <span className="font-mono font-semibold text-ink">{num(leidos)}</span> leídos
          </p>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep" role="img"
            aria-label={`${num(conSenal)} con señal, ${num(enRevision)} en revisión humana, ${num(sinSenal)} sin señal`}>
            {conSenal > 0 && <div className="h-full bg-rust" style={{ width: `${(conSenal / leidos) * 100}%` }} />}
            {enRevision > 0 && <div className="h-full bg-clay" style={{ width: `${(enRevision / leidos) * 100}%` }} />}
            {sinSenal > 0 && <div className="h-full bg-moss" style={{ width: `${(sinSenal / leidos) * 100}%` }} />}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
            <Parte color="bg-rust" n={conSenal} total={leidos} texto="con señal publicada y norma citada" />
            <Parte color="bg-clay" n={enRevision} total={leidos} texto="esperan revisión humana" />
            <Parte color="bg-moss" n={sinSenal} total={leidos} texto="salieron sin señal" />
          </ul>
          <p className="mt-1.5 text-[12px] text-mute">Se publican igual, señalen a quien señalen.</p>
        </div>
      )}

      {/* Sin botón propio: /app/aliados tiene UNA invitación a financiar, al pie. */}
      {porFinanciar > 0 && (
        <p className="mt-4 max-w-[60ch] border-t border-line pt-3 text-[13px] leading-relaxed text-inkSoft">
          Quedan <span className="font-mono font-semibold text-ink">{num(porFinanciar)}</span> contratos
          en la cola sin financiar. Leerlos todos cuesta{" "}
          <span className="font-mono font-semibold text-ink">{formatPEN(porFinanciar * precioPen)}</span> a{" "}
          {formatPEN(precioPen)} por contrato.
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
      <span className="font-mono font-semibold tabular-nums text-ink">{n.toLocaleString("es-PE")}</span>
      <span className="text-mute">de {total.toLocaleString("es-PE")} {texto}</span>
    </li>
  );
}
