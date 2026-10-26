import { TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { numero, soles } from "@/lib/formato";
import type { NepotismoEntidad as Dato } from "@/lib/api-client";

const ETIQUETA: Record<string, string> = {
  hermano: "hermano(a)",
  conyuge: "cónyuge o conviviente",
  hijo: "hijo(a)",
  padre: "padre o madre",
  otro: "otro pariente",
};

/**
 * Indicio de nepotismo en la entidad: parientes que un funcionario declaró en su Declaración Jurada de Intereses
 * (DJI) y que figuran como locadores (proveedores) de ESTA misma entidad. Agregado y sin identidades — el DNI y el
 * nombre del pariente nunca se muestran. Es un indicio para revisión humana, nunca una acusación.
 */
export function NepotismoEntidad({ nepotismo }: { nepotismo: Dato | null }) {
  if (!nepotismo || nepotismo.total === 0) return null;
  const { total, monto, porGrado } = nepotismo;
  return (
    <section className="rounded-2xl border border-amber/30 bg-amber-soft p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amberTexto" aria-hidden />
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-bloque font-semibold text-amberTexto">Parientes declarados que le venden</h2>
            <Ayuda titulo="¿Qué es esto?">
              <span className="block">
                Por ley, los funcionarios presentan una Declaración Jurada de Intereses (DJI) donde declaran a sus
                parientes. Aquí mostramos cuántos de esos parientes figuran como proveedores (locadores) de su propia
                entidad. Es un indicio para revisión humana, no una acusación: la DJI es pública y puede haber
                explicaciones legítimas. No mostramos el nombre ni el documento del pariente.
              </span>
            </Ayuda>
          </div>
          <p className="text-cuerpo text-ink">
            {numero(total)} {total === 1 ? "pariente declarado" : "parientes declarados"} de funcionarios de esta
            entidad figura{total === 1 ? "" : "n"} como su proveedor, por {soles(monto)} en órdenes.
          </p>
          <ul className="flex flex-wrap gap-2">
            {porGrado.map((g) => (
              <li
                key={g.grado}
                className="rounded-full border border-amber/30 bg-paper px-3 py-1 text-rotulo text-ink"
              >
                <span className="font-medium">{numero(g.n)}</span> {ETIQUETA[g.grado] ?? g.grado}
                <span className="text-mute"> ({soles(g.monto)})</span>
              </li>
            ))}
          </ul>
          <p className="text-meta text-mute">Indicio para revisión humana, no una acusación.</p>
        </div>
      </div>
    </section>
  );
}
