import type { Metadata } from "next";

/**
 * Lo que necesitan las vistas previas al compartir un enlace (Open Graph y X).
 *
 *  · `SITIO`: el dominio público de cada despliegue. Cloudflare lo recibe en el build
 *    (NEXT_PUBLIC_SITE_URL, frontend/cloudbuild-cf.yaml); el de Cloud Run sale por Firebase Hosting.
 *    De acá salen las URLs absolutas de og:image (antes caían en la URL interna de Cloud Run).
 *  · `OG_BASE` / `TWITTER_BASE`: lo común a toda tarjeta, con la imagen de todo el sitio
 *    (app/opengraph-image.tsx) nombrada por su ruta. Next reemplaza el objeto `openGraph` entero
 *    cuando una página define el suyo, y con él la imagen del layout: cada página los esparce.
 *
 * Una sección con imagen propia (el comprobante de impacto) la define en su carpeta y gana sobre esta.
 */

export const SITIO = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vigia-peru.web.app";

export const IMAGEN_COMPARTIR = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Vigía Perú: en qué se gasta el dinero de tu región",
};

export const OG_BASE = {
  siteName: "Vigía by Gobserva",
  locale: "es_PE",
  images: [IMAGEN_COMPARTIR],
} satisfies NonNullable<Metadata["openGraph"]>;

export const TWITTER_BASE = {
  card: "summary_large_image",
  images: [IMAGEN_COMPARTIR.url],
} satisfies NonNullable<Metadata["twitter"]>;
