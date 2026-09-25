import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SaltarAlContenido } from "@/components/sitio/SaltarAlContenido";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Primer elemento enfocable: salta la navegación de la cabecera. */}
      <SaltarAlContenido />
      <Header />
      <main id="contenido" tabIndex={-1} className="min-h-[calc(100vh-200px)] focus:outline-none">
        {children}
      </main>
      <Footer />
    </>
  );
}
