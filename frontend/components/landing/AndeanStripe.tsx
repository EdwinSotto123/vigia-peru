/**
 * Filete de dos tonos (marca + ámbar) inspirado en el aro textil del isotipo — la
 * primera versión usaba 5 colores saturados en bandas muy angostas y se veía más
 * "clip art barato" que "textil andino". Dos tonos, bandas más anchas, un solo
 * gradiente: lee como un detalle de marca, no como una alfombra.
 */
export function AndeanStripe({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-[3px] w-full ${className}`}
      style={{
        backgroundImage: "repeating-linear-gradient(90deg, #6E1F2F 0 24px, #BE7B26 24px 48px)",
      }}
    />
  );
}
