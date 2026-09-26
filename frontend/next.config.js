/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Un build de producción local (medir tiempos) sin pisar el .next del `next dev` que está corriendo.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Sin `X-Powered-By: Next.js` en cada respuesta (auditoría M16).
  poweredByHeader: false,
  // Caché de datos de Next acotada: una LRU en memoria de ~64 MB por proceso, sin escribir a
  // disco (auditoría A7). Con el manejador por defecto, cada OCID o búsqueda nueva sumaba una
  // entrada en .next/cache (RAM del contenedor en Cloud Run) sin tope. `cacheMaxMemorySize: 0`
  // apaga la LRU propia de Next, que si no guardaría todo dos veces. Ver cache-handler.js.
  cacheHandler: require.resolve("./cache-handler.js"),
  cacheMaxMemorySize: 0,
  // tsc --noEmit está limpio: un error de tipos vuelve a frenar el build.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Réplica en Cloudflare Workers (CLOUDFLARE.md): OpenNext arma el worker con los archivos
    // que traza Next. En Windows la traza de `next/og` pierde su fuente y sus .wasm (el mismo
    // bug de rutas que se cuenta en app/icon.tsx), así que se agregan a mano. Cloud Run no
    // usa las trazas: ahí no cambia nada.
    outputFileTracingIncludes: {
      "/{icon,apple-icon}": ["./node_modules/next/dist/compiled/@vercel/og/*.{ttf,wasm}"],
      "/**/opengraph-image-*": ["./node_modules/next/dist/compiled/@vercel/og/*.{ttf,wasm}"],
    },
  },
  // Build de la réplica en Workers (open-next.config.ts pone VIGIA_DESTINO=cloudflare): ahí
  // lib/gcs.ts y lib/fetch-largo.ts van por la API REST y el fetch del runtime, y nunca cargan
  // estos paquetes de Node; se dejan fuera del worker (~1,3 MB). Sin la variable, no cambia nada.
  webpack(config, { isServer }) {
    if (isServer && process.env.VIGIA_DESTINO === "cloudflare") {
      config.resolve.alias = { ...config.resolve.alias, "@google-cloud/storage": false, undici: false };
      // Caché de webpack aparte: la variable no entra en su clave, y un `next build` para Cloud
      // Run reusaría los módulos vacíos (y al revés).
      if (config.cache) config.cache = { ...config.cache, name: `${config.name}-${config.mode}-cloudflare` };
    }
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "tile.openstreetmap.org" },
      // logos de aliados y QR de pago (buckets públicos de Vigía)
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "**.run.app" },
    ],
  },
  // Geojson de fronteras (departments 146KB, provinces 846KB) = data estática
  // que nunca cambia. Por defecto Next las sirve con max-age=0 → se re-bajan en
  // cada visita al mapa. Las cacheamos fuerte: tras la 1ra visita, 0 tráfico.
  async headers() {
    const immutable = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ];
    return [
      // Imágenes y datos estáticos de la interfaz (lupa de la portada, logos, geometría del
      // mapa de la portada). OJO: al cambiar el contenido de un archivo de /assets hay que
      // cambiarle el nombre (p. ej. `.v2.json`, `-720.webp`): el navegador lo guarda un año.
      { source: "/assets/:path*", headers: immutable },
      { source: "/peru-departments.json", headers: immutable },
      { source: "/peru-provinces.json", headers: immutable },
      { source: "/mef-budget.json", headers: immutable },
      { source: "/mef-entities.json", headers: immutable },
    ];
  },
};

module.exports = nextConfig;
