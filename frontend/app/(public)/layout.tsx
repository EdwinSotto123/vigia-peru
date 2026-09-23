import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Primer elemento enfocable: salta la navegación del header. Invisible hasta que recibe foco. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper focus:shadow-card"
      >
        Saltar al contenido
      </a>
      <Header />
      <main id="contenido" tabIndex={-1} className="min-h-[calc(100vh-200px)] focus:outline-none">
        {children}
      </main>
      <Footer />
    </>
  );
}
