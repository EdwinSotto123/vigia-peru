import { Header } from "@/components/Header";
import { FranjaAliados } from "@/components/aliados/FranjaAliados";
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
      {/* Los aliados, como el cintillo de los auspiciadores: arriba de todo, y se va al bajar (la cabecera queda pegada). */}
      <FranjaAliados />
      <Header />
      <main id="contenido" tabIndex={-1} className="min-h-[calc(100vh-200px)] focus:outline-none">
        {children}
      </main>
      <Footer />
    </>
  );
}
