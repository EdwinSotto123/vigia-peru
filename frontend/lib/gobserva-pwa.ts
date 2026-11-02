import { PRODUCTOS, type Producto } from "@/lib/gobserva";

/**
 * El manifiesto de cada producto de Gobserva (2026-11-01): con él se instala como app en el celular o la computadora
 * («Agregar a la pantalla de inicio») y, en el iPhone, recién así puede recibir notificaciones. Lo sirve
 * `/{producto}/manifest.webmanifest` (en su subdominio, `/manifest.webmanifest`). Los colores son los de la marca en la
 * pantalla de carga del sistema (fuera de la web, sin variables de CSS).
 */
export function manifiestoProducto(producto: Producto): Response {
  const p = PRODUCTOS[producto];
  const cuerpo = {
    name: p.titulo,
    short_name: p.titulo.replace("Gobserva ", ""),
    description: p.lema,
    lang: "es-PE",
    start_url: "/?app=1",
    scope: "/",
    display: "standalone",
    background_color: "#0b0f0f",
    theme_color: "#0b0f0f",
    icons: [
      { src: "/gobserva/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/gobserva/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/gobserva/icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(cuerpo), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

/** Lo que va en el `metadata` del layout de cada producto para instalarlo como app. */
export const metadatosApp = (producto: Producto) => ({
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: PRODUCTOS[producto].titulo, statusBarStyle: "black-translucent" as const },
  // El ícono de la pestaña también es el de Gobserva (sin esto, el del celular pisaba el heredado y quedaba sin ícono).
  icons: { icon: [{ url: "/gobserva/icono-192.png", type: "image/png", sizes: "192x192" }], apple: "/gobserva/apple-touch-icon.png" },
});
