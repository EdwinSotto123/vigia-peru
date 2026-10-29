"use client";

import { CLASE_ICONO_DATO, ICONO_DATO, type TipoDato } from "./iconosDato";

/**
 * El ícono de un `Dato` por su tipo, dibujado en el navegador: así viaja en la página como `{"tipo":"cargo"}` y no como el
 * SVG entero (~700 bytes cada uno). Medido el 2026-10-29: en la ficha del Minsa eran 9,400 íconos de datos, 7 MB de 25. El
 * HTML que arma el servidor lo trae igual.
 */
export function IconoDato({ tipo, nombre }: { tipo: TipoDato; nombre?: string }) {
  const { icono: Icono, nombre: base } = ICONO_DATO[tipo];
  return <Icono size={12} strokeWidth={2} className={CLASE_ICONO_DATO} role="img" aria-label={`${nombre ?? base}:`} />;
}
