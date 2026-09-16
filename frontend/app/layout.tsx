import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Fuentes autoalojadas por next/font: sin CSS bloqueante de fonts.googleapis (Lighthouse móvil).
// Chakra Petch (font-techno) no se usa en ningún componente: se retiró.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], weight: ["600", "700"], display: "swap", variable: "--font-serif", preload: false });
import { AuthProvider } from "@/components/auth/AuthProvider";

export const metadata: Metadata = {
  title: "Vigía Perú — La corrupción en el mapa, antes de que sea tarde",
  description:
    "Plataforma cívica que cruza datos públicos y reportes ciudadanos para detectar señales de corrupción en contrataciones del Estado peruano.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
