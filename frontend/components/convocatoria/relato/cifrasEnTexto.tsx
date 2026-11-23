import { Children, Fragment, type ReactNode } from "react";
import { redactDnis } from "../../Redact";

/**
 * Las cifras y los veredictos dentro de la prosa del agente (el dictamen, su resumen), realzados para que se lean de un
 * vistazo: los montos («S/ 479,400.00», «US$ 0.19»), los porcentajes («42 %») y los «cumple» / «no cumple» de los
 * principios evaluados (2026-11-23, el usuario: «muros de texto», «sin jerarquía»). El resto del texto pasa por
 * `redactDnis`, como antes: el realce no se salta la censura.
 */

// Un monto o un porcentaje, sin la coma o el punto que cierran la frase («S/ 1,147,500.00,» → «S/ 1,147,500.00»).
const CIFRA = /((?:S\/|US\$)\s?\d[\d.,]*\d(?:\s(?:millones|mil))?|(?:S\/|US\$)\s?\d|\b\d+(?:[.,]\d+)?\s?%)/;
// «no cumple» antes que «cumple»: si no, el segundo se comería la mitad del primero.
const VEREDICTO = /(\bno cumple\b|\bcumple\b)/i;
const TODO = new RegExp(`${CIFRA.source}|${VEREDICTO.source}`, "gi");

const CLASE_CIFRA = "whitespace-nowrap rounded bg-paperDeep px-1 font-semibold tabular-nums text-ink";

function realzarTexto(texto: string): ReactNode {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(TODO)) {
    const i = m.index ?? 0;
    if (i > ultimo) partes.push(<Fragment key={`t${ultimo}`}>{redactDnis(texto.slice(ultimo, i))}</Fragment>);
    const v = m[0];
    const clase = /^no cumple$/i.test(v)
      ? "font-semibold text-crimsonTexto"
      : /^cumple$/i.test(v)
        ? "font-semibold text-mossTexto"
        : CLASE_CIFRA;
    partes.push(
      <span key={`c${i}`} className={clase}>
        {v}
      </span>,
    );
    ultimo = i + v.length;
  }
  if (ultimo === 0) return redactDnis(texto);
  if (ultimo < texto.length) partes.push(<Fragment key={`t${ultimo}`}>{redactDnis(texto.slice(ultimo))}</Fragment>);
  return partes;
}

/** Un texto plano con sus cifras y veredictos realzados (y censurado). */
export function conCifras(texto: string): ReactNode {
  return realzarTexto(texto);
}

/** Los hijos de un elemento del markdown: sólo los textos sueltos se realzan; lo demás (negritas, enlaces) queda igual. */
export function hijosConCifras(children: ReactNode): ReactNode {
  return Children.map(children, (c) => (typeof c === "string" ? realzarTexto(c) : c));
}
