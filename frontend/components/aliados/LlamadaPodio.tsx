import { Coins, ListOrdered, Share2 } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { soles } from "@/lib/formato";

/**
 * "¿Quieres salir en este podio?": la invitación a donar, en una banda con color de marca (no una caja blanca).
 * Tres pasos en una fila separados por divisores (antes, tres cajas con borde dentro de la banda) y UN botón lima.
 * Todo lo que dice sale de reglas reales del producto: S/ por contrato de la tarifa vigente, asignación por
 * antigüedad, dictamen público con su norma. Sin podio a la vista (menos de tres aliados), la pregunta no lo nombra.
 *
 * Server-safe.
 */
export function LlamadaPodio({
  precio,
  desglose,
  nombreRegion,
  hayPodio = true,
}: {
  /** Precio real por contrato; sin él no se dice un monto. */
  precio: number | null;
  /** "procesamiento (S/ 1), infraestructura y datos (S/ 1)…", o vacío. */
  desglose: string;
  nombreRegion?: string;
  /** Hay un podio arriba al que se refiere la pregunta; con menos de tres aliados, no. */
  hayPodio?: boolean;
}) {
  const donde = nombreRegion ? ` en ${nombreRegion}` : " donde más hace falta";
  const pasos = [
    {
      Icono: Coins,
      titulo: "Eliges región y cuántos contratos",
      texto: (
        <>
          {precio != null ? `${soles(precio)} cada uno. ` : ""}
          {desglose && <Ayuda titulo="¿En qué se va cada contrato?">{desglose}.</Ayuda>}
        </>
      ),
    },
    { Icono: ListOrdered, titulo: "La cola los asigna por antigüedad", texto: <>No los eliges tú ni Vigía Perú.</> },
    { Icono: Share2, titulo: "Tu nombre entra al ranking", texto: <>Cada dictamen se publica con su norma, y tienes un perfil para compartir.</> },
  ];
  return (
    <section
      aria-labelledby="llamada-podio"
      className="sobre-oscuro con-puntos relative overflow-hidden rounded-2xl bg-gradient-to-br from-granate-deep via-ink to-granate-deep text-paper"
    >
      <div className="relative space-y-4 px-5 py-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div>
            <h2 id="llamada-podio" className="font-display text-cifra font-bold leading-tight sm:text-titulo">
              {hayPodio ? (
                <>
                  ¿Quieres salir en este <span className="text-maiz">podio</span>?
                </>
              ) : (
                <>
                  ¿Quieres ser el próximo <span className="text-maiz">aliado</span>?
                </>
              )}
            </h2>
            <p className="mt-1 text-cuerpo text-paper/80">Ayúdanos a vigilar{donde}.</p>
          </div>
          <EnlaceAccion href="/app/financiar" variante="oscuro" tamano="lg" flecha>
            Quiero vigilar con mi aporte
          </EnlaceAccion>
        </div>
        {/* Los tres pasos en una fila con divisores, sin cajas: la banda ya es la superficie. */}
        <ol className="grid divide-y divide-paper/15 border-t border-paper/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {pasos.map(({ Icono, titulo, texto }, i) => (
            <li key={titulo} className="flex items-start gap-3 py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maiz/15 text-maiz" aria-hidden>
                <Icono size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold leading-snug text-paper">
                  <span className="sr-only">Paso {i + 1}: </span>
                  {titulo}
                </span>
                <span className="mt-0.5 block text-meta leading-snug text-paper/75">{texto}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
