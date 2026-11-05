import Link from "next/link";

/** El número que identifica lo que pasó en un paso: «N.° 4504852833» (una orden) o «proceso 1148529». */
const IDENTIFICADOR = /N\.° ?[\w./-]+|proceso [\w./-]+/;
const CLASE = "font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/**
 * El texto de un paso de una secuencia («Le dieron una orden (N.° 4504852833) por S/ 7,445») con su enlace en Vigía: si
 * nombra un número de orden o de proceso, ese número es el enlace (pedido del usuario del 2026-11-05: «debería pintarse
 * de verde el número para que podamos clickear y ver el proceso»); si no, todo el texto. Sin enlace, texto. Server-safe.
 */
export function TextoPaso({ texto, href }: { texto: string; href?: string | null }) {
  if (!href) return <>{texto}</>;
  const m = IDENTIFICADOR.exec(texto);
  if (!m) {
    return (
      <Link href={href} prefetch={false} className={CLASE}>
        {texto}
      </Link>
    );
  }
  return (
    <>
      {texto.slice(0, m.index)}
      <Link href={href} prefetch={false} className={CLASE}>
        {m[0]}
      </Link>
      {texto.slice(m.index + m[0].length)}
    </>
  );
}
