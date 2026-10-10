import { OjoPixel } from "./OjoPixel";

/**
 * El isotipo de Vigía (identidad Píxel): el ojo de puntos. Mantiene el nombre y la
 * firma `Isotipo` porque la cabecera, el pie, el login y el 404 ya lo importaban;
 * el dibujo vive en `OjoPixel`, que también se anima en la portada.
 *
 * `tamano` es el ANCHO del ojo en px. Sin `titulo` es decorativo; como marca,
 * `titulo="Vigía Perú"`. En una placa clara pasa `tono="claro"`.
 */
export function Isotipo({
  tamano = 32,
  className,
  titulo,
  tono = "oscuro",
}: {
  tamano?: number;
  className?: string;
  titulo?: string;
  tono?: "oscuro" | "claro";
}) {
  return <OjoPixel tamano={Math.round(tamano * 1.35)} className={className} titulo={titulo} tono={tono} />;
}
