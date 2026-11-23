import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Una cifra que rueda hasta su valor, como un contador mecánico (2026-11-22): cada dígito es una tira del 0 al 9, dos
 * veces, que baja hasta el suyo; la columna de la izquierda frena primero y la de las unidades al final. Los separadores
 * («,», «S/», «%») quedan quietos.
 *
 * Sólo CSS (globals.css, `.gs-odo`): el servidor ya manda la cifra final y la animación arranca con la primera pintura,
 * sin esperar a React. El dígito real va en el flujo (invisible) para que la cifra se alinee con el texto de al lado y
 * tenga su ancho; la tira va encima, recortada con clip-path (overflow movería la línea base). Para lectores de pantalla,
 * la cifra entera. Con movimiento reducido, quieta en su valor. Para que vuelva a rodar cuando cambia, dale otra `key`.
 * Server-safe.
 */
export function Odometro({ texto, retardo = 0, className }: { texto: string; retardo?: number; className?: string }) {
  const chars = [...texto];
  const digitos = chars.filter((c) => c >= "0" && c <= "9").length;
  let orden = 0;
  return (
    <span className={cn("gs-odo", className)}>
      <span className="sr-only">{texto}</span>
      <span aria-hidden className="gs-odo-cifras">
        {chars.map((c, i) => {
          if (c < "0" || c > "9") return <span key={i}>{c}</span>;
          // Las de la izquierda frenan antes: más vueltas y más tiempo para las unidades.
          const estilo = { "--d": Number(c), "--i": orden, "--n": digitos, "--r": `${retardo}ms` } as CSSProperties;
          orden += 1;
          return (
            <span key={i} className="gs-odo-col" style={estilo}>
              <span className="gs-odo-fantasma">{c}</span>
              {/* Los veinte dígitos los pone el CSS (::before): no se copian ni salen al buscar en la página. */}
              <span className="gs-odo-tira" />
            </span>
          );
        })}
      </span>
    </span>
  );
}
