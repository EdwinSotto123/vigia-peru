import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Fuentes autoalojadas por next/font: sin CSS bloqueante de fonts.googleapis (Lighthouse móvil).
// Chakra Petch (font-techno) no se usa en ningún componente: se retiró.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-sans" });
// Títulos en Space Grotesk: la grotesca de la identidad Píxel (carbón y lima).
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-display" });
// `font-mono` (códigos de contrato, RUC, cifras) nombraba JetBrains Mono pero nunca
// se cargaba: cada sistema caía en su propia monoespaciada. Sin preload: es
// secundaria y no debe competir con la fuente del texto.
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-mono", preload: false });
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
    { media: "(prefers-color-scheme: light)", color: "#F6F8F7" },
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
      </body>
    </html>
  );
}
