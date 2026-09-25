import { Fragment, type ReactNode } from "react";

/**
 * Datos seguidos en una línea (entidad y zona, código y monto, puesto y RUC): separados
 * por aire, no por un "·", que no va en la interfaz. El lector de pantalla los oye
 * separados por una coma. Es texto en línea: dentro de una línea que se recorta
 * (`truncate`) se recorta al final, como cualquier texto. Los vacíos se omiten.
 * Puro marcado, sin estado: sirve igual en server o client.
 */
export function Partes({ partes }: { partes: ReactNode[] }) {
  const xs = partes.filter(hayDato);
  return (
    <>
      {xs.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && <Separador />}
          {x}
        </Fragment>
      ))}
    </>
  );
}

/**
 * El aire entre dos datos de una línea; para el lector de pantalla, una coma. Suelto,
 * para las partes que sólo se ven en un ancho: va DENTRO del span que se oculta, así el
 * aire se va con el dato (`<span className="md:hidden"><Separador />{monto}</span>`).
 */
export function Separador() {
  // La coma vive DENTRO del aire, en flujo, empujada fuera de su caja de 12 px y
  // recortada (sin color transparente: un texto invisible "de 0:1" lo marcan como falta
  // de contraste). Un `sr-only` (position: absolute) dentro de una línea `truncate` sin
  // padre posicionado escapaba del recorte y le daba a la página scroll horizontal en el
  // celular. Así además, al copiar la línea, sale "Lima, Huaral".
  return <span className="inline-block w-3 overflow-hidden whitespace-pre pl-3 align-bottom">, </span>;
}

/** Si una parte tiene algo que mostrar (los `cond && "texto"` falsos, fuera). */
export const hayDato = (x: ReactNode): boolean => x != null && x !== false && x !== true && x !== "";
