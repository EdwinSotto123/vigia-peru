import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Montserrat } from "next/font/google";
import "./globals.css";

// Fuentes autoalojadas por next/font: sin CSS bloqueante de fonts.googleapis (Lighthouse móvil).
// Chakra Petch (font-techno) no se usa en ningún componente: se retiró.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-sans" });
// Títulos en Montserrat: la geométrica del logotipo (DESIGN_SYSTEM.md §4). Reemplaza al serif.
const display = Montserrat({ subsets: ["latin"], weight: ["600", "700", "800"], display: "swap", variable: "--font-display" });
// `font-mono` (códigos de contrato, RUC, cifras) nombraba JetBrains Mono pero nunca
// se cargaba: cada sistema caía en su propia monoespaciada. Sin preload: es
// secundaria y no debe competir con la fuente del texto.
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-mono", preload: false });
import { AuthProvider } from "@/components/auth/AuthProvider";

export const metadata: Metadata = {
  // Sin esto, las URLs relativas de og:image y compañía se resolvían contra
  // http://localhost:8080 en producción.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://vigia-peru-frontend-36169102688.us-central1.run.app"),
  title: {
    default: "Vigía Perú: en qué se gasta el dinero de tu región",
    template: "%s | Vigía Perú",
  },
  description:
    "Plataforma cívica que lee los contratos públicos del Perú publicados en el SEACE, los cruza con fuentes oficiales y muestra señales de riesgo con la norma y la fuente de cada una.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-PE" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
