import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
  const s = p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2);
  return `${s.replace(".", ",")} %`;
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
      nota: `API OCDS del OECE · ${ambito}`,
      valor: publicados,
      tono: "escala",
    },
    {
      etiqueta: "Entran hoy a la cola financiable",
      nota: `Solo ${alcanceCorto(alcance)}${documentosListos > 0 ? ` · otros ${num(documentosListos)} ya tienen sus documentos descargados, pero su tipo de contrato todavía no está activo para análisis` : ""}`,
      valor: cola,
      tono: "escala",
    },
    {
      etiqueta: "Financiados por aliados",
      nota: `${formatPEN(precioPen)} por contrato · se asignan por antigüedad en la cola, nadie elige cuáles`,
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
    <section aria-labelledby="capacidad-titulo" className="rounded-2xl border border-line bg-paper p-5 sm:p-7">
      <h2 id="capacidad-titulo" className="max-w-[46ch] font-serif text-xl font-bold leading-snug text-ink sm:text-2xl">
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
      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-mute">
        Ese hueco es lo que esta página mide. El ranking de quién aportó viene después, y es un
        libro mayor: aquí nadie compra un resultado ni una región.
      </p>

      <ol className="mt-6">
        {escalones.map((e) => (
          <li key={e.etiqueta} className="border-t border-line py-3 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-ink">{e.etiqueta}</span>
              <span className="shrink-0 font-mono text-sm text-ink">
                {num(e.valor)}
                <span className="ml-2 text-[11px] font-normal text-mute">{pctTxt(e.valor, publicados)}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
              <div
                className={`h-1.5 min-w-[2px] rounded-full ${TONO[e.tono]}`}
                style={{ width: `${publicados > 0 ? (e.valor / publicados) * 100 : 0}%` }}
              />
            </div>
            {e.nota && <p className="mt-1.5 max-w-[70ch] text-[11px] leading-relaxed text-mute">{e.nota}</p>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] leading-relaxed text-mute">
        Las cuatro barras están a la misma escala real sobre {num(publicados)}. Las dos últimas
        son un hilo porque ese es el tamaño del trabajo hecho hasta hoy.
      </p>

      {leidos > 0 && (
        <p className="mt-5 max-w-[70ch] border-t border-line pt-4 text-sm leading-relaxed text-inkSoft">
          De los <span className="font-mono">{num(leidos)}</span> leídos,{" "}
          <span className="font-mono">{num(conSenal)}</span> tienen al menos una señal publicada con su
          norma citada, <span className="font-mono">{num(enRevision)}</span> esperan revisión humana porque
          la autoevaluación no alcanzó el umbral para publicar, y{" "}
          <span className="font-mono">{num(sinSenal)}</span> salieron sin señal. Los resultados se publican
          igual, señalen a quien señalen.
        </p>
      )}

      {porFinanciar > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-4">
          <p className="max-w-[54ch] text-sm leading-relaxed text-inkSoft">
            Quedan <span className="font-mono font-semibold text-ink">{num(porFinanciar)}</span> contratos
            en la cola sin financiar. Leerlos todos cuesta{" "}
            <span className="font-mono font-semibold text-ink">{formatPEN(porFinanciar * precioPen)}</span> a{" "}
            {formatPEN(precioPen)} por contrato.
          </p>
          <Link
            href="/app/financiar"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-heroViolet-deep"
          >
            Financiar una auditoría <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}
