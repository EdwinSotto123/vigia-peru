import Image from "next/image";

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
      width={Math.round(height * 1.9)}
      height={height}
      priority={priority}
      className={
        "h-auto select-none object-contain " +
        (variant === "dark" ? "brightness-110" : "") +
        " " +
        className
      }
      style={{ height, width: "auto" }}
    />
  );
}
