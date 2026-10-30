import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fuentes autoalojadas: sin CSS bloqueante de fonts.googleapis (Lighthouse móvil). Los archivos están en app/fuentes
// (variables, subconjunto latino, de @fontsource-variable, licencia SIL OFL 1.1): antes `next/font/google` las bajaba
// en cada build y en Cloud Build fallaba a ratos ("An error occurred in `next/font`"), tumbando el despliegue.
// Chakra Petch (font-techno) no se usa en ningún componente: se retiró.
const inter = localFont({ src: "./fuentes/inter.woff2", weight: "100 900", display: "swap", variable: "--font-sans" });
// Títulos en Space Grotesk: la grotesca de la identidad Píxel (carbón y lima).
const display = localFont({ src: "./fuentes/space-grotesk.woff2", weight: "300 700", display: "swap", variable: "--font-display" });
// `font-mono` (códigos de contrato, RUC, cifras) nombraba JetBrains Mono pero nunca
// se cargaba: cada sistema caía en su propia monoespaciada. Sin preload: es
// secundaria y no debe competir con la fuente del texto.
const mono = localFont({ src: "./fuentes/jetbrains-mono.woff2", weight: "100 800", display: "swap", variable: "--font-mono", preload: false });
import type { Viewport } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { PagoPendienteFlotante } from "@/components/financiar/PagoPendienteFlotante";
import { OG_BASE, SITIO, TWITTER_BASE } from "@/lib/compartir";
import { SCRIPT_MODO } from "@/lib/modoScript";

export const metadata: Metadata = {
  // Sin esto, las URLs relativas de og:image y compañía se resolvían contra
  // http://localhost:8080 en producción. El dominio público de cada despliegue: lib/compartir.ts.
  metadataBase: new URL(SITIO),
  title: {
    default: "Vigía Perú: en qué se gasta el dinero de tu región",
    template: "%s | Vigía Perú",
  },
  description:
    "Plataforma cívica que lee los contratos públicos del Perú publicados en el SEACE, los cruza con fuentes oficiales y muestra señales de riesgo con la norma y la fuente de cada una.",
  // Vista previa al compartir: la imagen es app/opengraph-image.tsx (lib/compartir.ts); sin título
  // propio, cada red usa el <title> de la página.
  openGraph: { ...OG_BASE, type: "website" },
  twitter: TWITTER_BASE,
};

// Modo día / noche (lib/modo.ts): la barra del navegador sigue al sistema en la primera visita; BotonModo la ajusta.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFF3F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0F0F" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: SCRIPT_MODO pone `data-modo` en <html> antes de que React hidrate.
    <html lang="es-PE" className={`${inter.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_MODO }} />
      </head>
      <body>
        <AuthProvider>
          {children}
          <PagoPendienteFlotante />
        </AuthProvider>
        {/* Trampa para rastreadores (worker-prod.js): oculto para personas y lectores de pantalla, fuera del teclado y
            prohibido en robots.txt. Sólo lo pide un programa que ignora las reglas, y su IP queda vetada una hora. */}
        <a href="/app/indice-completo" hidden aria-hidden="true" tabIndex={-1} rel="nofollow">
          Índice completo de datos
        </a>
      </body>
    </html>
  );
}
