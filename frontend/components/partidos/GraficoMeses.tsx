import { mesCorto } from "@/lib/partidosApi";
import { numero } from "@/lib/formato";

/**
 * Contratos convocados por mes durante el período de un partido: la barra clara es el total del mes y la
 * oscura, los que Vigía ya leyó. Barras SVG propias (sin librerías), con una tabla como alternativa para
 * quien no ve el gráfico. Cada barra dice su mes y sus cifras en `<title>`. Server-safe.
 */

interface Mes { mes: string; contratos: number; leidos: number; conSenales: number }

/** Todos los meses entre el primero y el último con datos, para que un mes sin contratos se vea vacío y no se salte. */
function completar(porMes: Mes[]): Mes[] {
  if (porMes.length === 0) return [];
  const por = new Map(porMes.map((m) => [m.mes, m]));
  const [a0, m0] = porMes[0].mes.split("-").map(Number);
  const [a1, m1] = porMes[porMes.length - 1].mes.split("-").map(Number);
  const out: Mes[] = [];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? ((m = 1), a++) : m++) {
    const clave = `${a}-${String(m).padStart(2, "0")}`;
    out.push(por.get(clave) ?? { mes: clave, contratos: 0, leidos: 0, conSenales: 0 });
  }
  return out;
}

export function GraficoMeses({
  porMes,
  etiqueta,
  unidad = { singular: "contrato", plural: "contratos" },
  conLectura = true,
}: {
  porMes: Mes[];
  etiqueta: string;
  /** Qué se cuenta: contratos de la base de Vigía, o procesos adjudicados de CONOSCE. */
  unidad?: { singular: string; plural: string };
  /** `false`: sin la barra de leídos ni sus columnas (los procesos de CONOSCE no se leen). */
  conLectura?: boolean;
}) {
  const todos = completar(porMes);
  if (todos.length === 0) return <p className="text-sm text-inkSoft">Este partido no tiene {unidad.plural} convocados en este período.</p>;
  // Los primeros meses de la base tienen unos pocos contratos sueltos: dibujarlos deja media figura vacía.
  // Se parte del primer mes con al menos el 4 % del mes más cargado (con un mes de margen) y lo anterior se
  // resume en una línea, con su número: no se esconde, se cuenta aparte.
  const maxTodos = Math.max(1, ...todos.map((m) => m.contratos));
  const corte = Math.max(0, todos.findIndex((m) => m.contratos >= Math.max(3, maxTodos * 0.04)) - 1);
  const meses = todos.length - corte >= 6 ? todos.slice(corte) : todos;
  const antes = todos.slice(0, todos.length - meses.length);
  const antesContratos = antes.reduce((s, m) => s + m.contratos, 0);
  const maximo = Math.max(1, ...meses.map((m) => m.contratos));
  const W = 720;
  const H = 150;
  const PAD_B = 26;
  const alto = H - PAD_B - 8;
  const paso = W / meses.length;
  const ancho = Math.max(2, paso * 0.72);
  const total = todos.reduce((s, m) => s + m.contratos, 0);
  const leidos = todos.reduce((s, m) => s + m.leidos, 0);
  // Una marca de año cada enero (y la primera barra): el eje no se llena de texto.
  const marcas = meses.map((m, i) => ({ m, i })).filter(({ m, i }) => i === 0 || m.mes.endsWith("-01"));

  return (
    <figure className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${etiqueta}: ${numero(total)} ${unidad.plural} en ${todos.length} meses${conLectura ? `, ${numero(leidos)} ya leídos` : ""}`} className="h-auto w-full">
        <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} className="stroke-line" strokeWidth="1" />
        {meses.map((m, i) => {
          const x = i * paso + (paso - ancho) / 2;
          const hTot = (m.contratos / maximo) * alto;
          const hLei = (m.leidos / maximo) * alto;
          return (
            <g key={m.mes}>
              <title>{`${mesCorto(m.mes)}: ${numero(m.contratos)} ${m.contratos === 1 ? unidad.singular : unidad.plural}${conLectura ? `, ${numero(m.leidos)} leídos` : ""}`}</title>
              <rect x={x} y={H - PAD_B - hTot} width={ancho} height={Math.max(hTot, m.contratos > 0 ? 1 : 0)} rx="1.5" className={conLectura ? "fill-granate/25" : "fill-granate"} />
              {m.leidos > 0 && <rect x={x} y={H - PAD_B - hLei} width={ancho} height={Math.max(hLei, 1)} rx="1.5" className="fill-granate" />}
            </g>
          );
        })}
        {marcas.map(({ m, i }) => (
          <text key={m.mes} x={i * paso} y={H - 8} className="fill-mute font-mono" fontSize="11">
            {m.mes.endsWith("-01") ? m.mes.slice(0, 4) : mesCorto(m.mes)}
          </text>
        ))}
        <text x="0" y="10" className="fill-mute font-mono" fontSize="11">{`máx. ${numero(maximo)} al mes`}</text>
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-inkSoft">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${conLectura ? "bg-granate/25" : "bg-granate"}`} /> {unidad.plural.charAt(0).toUpperCase() + unidad.plural.slice(1)} convocados en el mes</span>
        {conLectura && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-granate" /> Los que Vigía ya leyó</span>}
        {antes.length > 0 && (
          <span className="text-mute">
            Antes de {mesCorto(meses[0].mes)}: {numero(antesContratos)} {antesContratos === 1 ? unidad.singular : unidad.plural} en {antes.length} {antes.length === 1 ? "mes" : "meses"}, en la tabla.
          </span>
        )}
      </figcaption>
      <details className="text-[13px] text-inkSoft">
        <summary className="min-h-[24px] cursor-pointer font-medium text-granate">Ver la tabla de meses</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line [details:not([open])>&]:hidden">
          <table className="w-full text-left">
            <caption className="sr-only">{etiqueta}</caption>
            <thead className="sticky top-0 bg-paperSoft text-[12px] text-mute">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Mes</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{unidad.plural.charAt(0).toUpperCase() + unidad.plural.slice(1)}</th>
                {conLectura && <th scope="col" className="px-3 py-2 text-right font-medium">Leídos</th>}
                {conLectura && <th scope="col" className="px-3 py-2 text-right font-medium">Con señal</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono tabular-nums">
              {todos.map((m) => (
                <tr key={m.mes}>
                  <th scope="row" className="px-3 py-1.5 font-sans font-normal">{mesCorto(m.mes)}</th>
                  <td className="px-3 py-1.5 text-right">{numero(m.contratos)}</td>
                  {conLectura && <td className="px-3 py-1.5 text-right">{numero(m.leidos)}</td>}
                  {conLectura && <td className="px-3 py-1.5 text-right">{numero(m.conSenales)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
