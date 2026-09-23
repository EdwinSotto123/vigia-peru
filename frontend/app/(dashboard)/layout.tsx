import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";

/**
 * En móvil la barra lateral se vuelve una barra superior pegajosa de 3 rem
 * (`#barra-movil`, en DashboardSidebar). Varias páginas tienen sus propias
 * franjas `sticky top-0` (filtros de contratos y señales, aliados, denuncias) o
 * `sticky top-2` (pestañas del dossier): sin corrección se pegarían DEBAJO de la
 * barra y quedarían tapadas. La regla de abajo las baja 3 rem sólo bajo `md`,
 * desde un solo lugar y sin tocar cada página. En escritorio no hay barra
 * superior y no se toca nada.
 */
const BAJO_BARRA_MOVIL =
  "max-md:[&_.sticky.top-0]:top-12 max-md:[&_.sticky.top-2]:top-14";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper focus:shadow-card"
      >
        Saltar al contenido
      </a>
      <DashboardSidebar />
      <main id="contenido" tabIndex={-1} className={`min-w-0 flex-1 focus:outline-none ${BAJO_BARRA_MOVIL}`}>
        {children}
      </main>
    </div>
  );
}
