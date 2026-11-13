import { CalendarHeart, ListOrdered, ReceiptText } from "lucide-react";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { HREF_APOYO } from "@/components/sitio/VistasSeccion";

/**
 * «¿Quieres estar en el podio?»: la invitación a sumarse. Tres pasos en una fila separados por divisores y UN botón.
 * Desde el 2026-10-29 es el modelo de apoyo (migración 206): el aporte va al fondo común y el podio cuenta los meses, no
 * los soles. Antes decía «Eliges región y cuántos contratos, S/ 3 cada uno», que ya no es cierto. Todo lo que dice sale
 * de reglas reales del producto: el mínimo del formulario (S/ 5), la cola por riesgo (migración 206) y el recibo público
 * de cada aporte.
 *
 * Desde el 2026-11-13 es una caja con borde, como el resto de la página (antes, una banda con degradado granate: el
 * dueño del producto pidió sin degradados ni color como jerarquía). El botón lleva a la pestaña Aportar de /app/apoyar.
 *
 * Server-safe.
 */
const PASOS = [
  { Icono: CalendarHeart, titulo: "Aportas desde S/ 5", texto: "Cada mes o una sola vez. Cada mes que aportas cuenta en el podio." },
  { Icono: ListOrdered, titulo: "Va al fondo común", texto: "Lo más grave se lee primero: no lo eliges tú, ni nadie que aporte." },
  { Icono: ReceiptText, titulo: "Tu recibo es público", texto: "Con tu nombre, si quieres, y un perfil para compartir." },
];

export function LlamadaPodio() {
  return (
    <section aria-labelledby="llamada-podio" className="rounded-2xl border border-line bg-paper">
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 id="llamada-podio" className="font-display text-bloque font-bold leading-tight text-ink">
              ¿Quieres estar en el podio?
            </h2>
            <p className="mt-0.5 text-meta text-inkSoft">Sostén la vigilancia del dinero público, mes a mes.</p>
          </div>
          <EnlaceAccion href={`${HREF_APOYO.aportar}#aporte`} flecha>
            Quiero sumarme
          </EnlaceAccion>
        </div>
        {/* Los tres pasos numerados en una fila con divisores, dentro de la caja. */}
        <ol className="grid divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {PASOS.map(({ Icono, titulo, texto }, i) => (
            <li key={titulo} className="flex items-start gap-3 py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-granate" aria-hidden>
                <Icono size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold leading-snug text-ink">
                  <span className="sr-only">Paso {i + 1}: </span>
                  {titulo}
                </span>
                <span className="mt-0.5 block text-meta leading-snug text-mute">{texto}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
