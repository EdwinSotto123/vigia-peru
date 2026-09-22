/**
 * La llama de Vigía, recortada del arte que entregó el usuario
 * (`public/assets/fondo/fondo_llama.jpg`, 2998×1408).
 *
 * El archivo es una lámina ancha con la llama contra el borde derecho y el
 * resto en blanco, así que acá se recorta por `background-position` en vez de
 * servir la lámina entera: el hero necesita la llama, no el metro y medio de
 * blanco que la acompaña.
 *
 * El degradado de máscara al pie es para que apoye sobre el fondo en vez de
 * terminar en un corte recto.
 */
const NATURAL_W = 2998;
const NATURAL_H = 1408;
/** Caja de la llama dentro de la lámina (medida sobre el arte original). */
const CROP_X = 2480;
const CROP_Y = 300;
const CROP_W = 518;
const CROP_H = 1108;

export function LlamaHero({ width = 260, className = "" }: { width?: number; className?: string }) {
  const scale = width / CROP_W;
  const height = CROP_H * scale;
  return (
    <div
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={{
        width,
        height,
        backgroundImage: "url(/assets/fondo/fondo_llama.jpg)",
        backgroundSize: `${NATURAL_W * scale}px ${NATURAL_H * scale}px`,
        backgroundPosition: `${-CROP_X * scale}px ${-CROP_Y * scale}px`,
        backgroundRepeat: "no-repeat",
        // El arte es un JPEG: el blanco de alrededor está horneado y no hay
        // canal alfa, así que recortado a secas la llama aparecía dentro de una
        // caja blanca. `multiply` deja pasar el fondo donde el arte es blanco y
        // conserva el trazo donde es oscuro — el recorte correcto sería un PNG
        // con transparencia, pero esto lo resuelve sin volver a generar el arte.
        mixBlendMode: "multiply",
        maskImage: "linear-gradient(to bottom, black 86%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 86%, transparent 100%)",
      }}
    />
  );
}
