/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "tile.openstreetmap.org" },
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
      { source: "/peru-departments.json", headers: immutable },
      { source: "/peru-provinces.json", headers: immutable },
      { source: "/mef-budget.json", headers: immutable },
      { source: "/mef-entities.json", headers: immutable },
    ];
  },
};

module.exports = nextConfig;
