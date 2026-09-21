import Image from "next/image";

// Ancho de referencia: la caja del logo se sigue dimensionando 11∶6 (el ratio real del
// isotipo recortado) — object-contain (ver className) centra el PNG fuente adentro sin
// distorsión aunque ese archivo tenga más aire propio que el recorte 11∶6 exacto.
const LOGO_ASPECT_RATIO = 2816 / 1536;

type LogoProps = {
  /** Altura en px. Default 36. */
  height?: number;
  /** Variante de fondo: `light` para headers claros, `dark` para footer/secciones oscuras. */
  variant?: "light" | "dark";
  className?: string;
  priority?: boolean;
};

export function Logo({
  height = 36,
  variant = "light",
  className = "",
  priority = false,
}: LogoProps) {
  return (
    <Image
      // vigia_peru.png (el original) pesa 4.9MB (2816×1536) — el optimizador de Next lo
      // tiene que decodificar y reducir en cada variante de tamaño nueva; medido en vivo,
      // 2.5s para el thumbnail de 64px del header en cache fría (justo lo que pasa después
      // de cada deploy — la cache del optimizador no sobrevive a una revisión nueva). El
      // isotipo ya tenía una versión pre-recortada de 512px (142KB) para los logos de
      // aliados — la reusamos acá también: mismo dibujo, ~35× menos que decodificar.
      src="/assets/logo/vigia_peru_512.png"
      alt="Vigía Perú"
      width={Math.round(height * LOGO_ASPECT_RATIO)}
      height={height}
      priority={priority}
      className={
        "h-auto select-none object-contain " +
        (variant === "dark" ? "brightness-110" : "") +
        " " +
        className
      }
      // Solo `height`: dejar que el `width` numérico (arriba) defina el ancho sin que
      // ningún CSS lo pise. `width: "auto"` (como estaba antes) hacía que el navegador
      // derivara el ancho del tamaño NATURAL del recurso ya optimizado que Next.js sirve
      // (/_next/image redimensiona el PNG a un bucket propio, p.ej. 64×35 para height=30 —
      // ese resize redondea a su vez, así que ni siquiera el ratio 11∶6 exacto de arriba
      // garantiza que el natural post-resize matchee el width declarado). Sin pisar el
      // width con CSS, el navegador usa directamente el atributo width/height — sin
      // depender del tamaño natural del recurso — y el warning de Next.js
      // ("has either width or height modified, but not the other") no tiene forma de
      // dispararse, para cualquier height que use este componente.
      style={{ height }}
    />
  );
}
