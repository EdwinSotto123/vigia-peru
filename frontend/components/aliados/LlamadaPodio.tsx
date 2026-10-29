import { CalendarHeart, ListOrdered, ReceiptText } from "lucide-react";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";

/**
 * «¿Quieres estar en el podio?»: la invitación a sumarse, en una banda con color de marca (no una caja blanca). Tres
 * pasos en una fila separados por divisores y UN botón lima. Desde el 2026-10-29 es el modelo de apoyo (migración 206):
 * el aporte va al fondo común y el podio cuenta los meses, no los soles. Antes decía «Eliges región y cuántos
 * contratos, S/ 3 cada uno», que ya no es cierto. Todo lo que dice sale de reglas reales del producto: el mínimo del
 * formulario (S/ 5), la cola por riesgo (migración 206) y el recibo público de cada aporte.
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
    <section
      aria-labelledby="llamada-podio"
      className="sobre-oscuro con-puntos relative overflow-hidden rounded-2xl bg-gradient-to-br from-granate-deep via-ink to-granate-deep text-paper"
    >
      <div className="relative space-y-4 px-5 py-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div>
            <h2 id="llamada-podio" className="font-display text-cifra font-bold leading-tight sm:text-titulo">
              ¿Quieres estar en el <span className="text-maiz">podio</span>?
            </h2>
            <p className="mt-1 text-cuerpo text-paper/80">Sostén la vigilancia del dinero público, mes a mes.</p>
          </div>
          <EnlaceAccion href="/app/apoyar" variante="oscuro" tamano="lg" flecha>
            Quiero sumarme
          </EnlaceAccion>
        </div>
        {/* Los tres pasos en una fila con divisores, sin cajas: la banda ya es la superficie. */}
        <ol className="grid divide-y divide-paper/15 border-t border-paper/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {PASOS.map(({ Icono, titulo, texto }, i) => (
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
