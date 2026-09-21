import Image from "next/image";

// Aspect ratio real del PNG fuente (public/assets/logo/vigia_peru.png es 2816×1536,
// exactamente 11∶6). Antes se aproximaba con ×1.9, dejando el `width` prop 2-3px
// desalineado del ancho real — ya corregido acá, pero por sí solo no alcanza (ver
// nota junto a `style` más abajo: la causa real de fondo era otra).
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
      src="/assets/logo/vigia_peru.png"
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
