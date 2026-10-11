import { Coins, ListOrdered, Share2 } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { soles } from "@/lib/formato";

/**
 * "¿Quieres salir en este podio?": la invitación a donar, en una banda con color de marca (no una caja blanca).
 * Tres pasos en una fila de tarjetas pequeñas y UN botón lima. Todo lo que dice sale de reglas reales del
 * producto: S/ por contrato de la tarifa vigente, asignación por antigüedad, dictamen público con su norma.
 *
 * Server-safe.
 */
export function LlamadaPodio({
  precio,
  desglose,
  nombreRegion,
}: {
  /** Precio real por contrato; sin él no se dice un monto. */
  precio: number | null;
  /** "procesamiento (S/ 1), infraestructura y datos (S/ 1)…", o vacío. */
  desglose: string;
  nombreRegion?: string;
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
            <h2 id="llamada-podio" className="font-display text-[26px] font-bold leading-tight sm:text-[32px]">
              ¿Quieres salir en este <span className="text-maiz">podio</span>?
            </h2>
            <p className="mt-1 text-[15px] text-paper/80">Ayúdanos a vigilar{donde}.</p>
          </div>
          <EnlaceAccion href="/app/financiar" variante="oscuro" tamano="lg" flecha>
            Quiero vigilar con mi aporte
          </EnlaceAccion>
        </div>
        <div>
          <ol className="grid gap-2.5 sm:grid-cols-3">
            {pasos.map(({ Icono, titulo, texto }, i) => (
              <li key={titulo} className="flex items-start gap-3 rounded-xl border border-paper/15 bg-paper/[0.06] p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maiz/15 text-maiz" aria-hidden>
                  <Icono size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-snug text-paper">
                    <span className="sr-only">Paso {i + 1}: </span>
                    {titulo}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-paper/75">{texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
