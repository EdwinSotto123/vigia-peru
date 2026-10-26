import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { numero, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona } from "@/lib/personas";
import type { NepotismoEntidad as Dato } from "@/lib/api-client";

const ETIQUETA: Record<string, string> = {
  hermano: "hermano(a)",
  conyuge: "cónyuge o conviviente",
  hijo: "hijo(a)",
  padre: "padre o madre",
  otro: "otro pariente",
};

/**
 * Indicio de nepotismo en la entidad: un funcionario declaró en su Declaración Jurada de Intereses (DJI) a un
 * pariente que figura como locador (proveedor) de ESTA misma entidad. El funcionario es un cargo público (su DJI es
 * pública) y se nombra; el proveedor (persona natural, RUC-10) va con un apellido tapado, como cualquier locador.
 * Es un indicio para revisión humana, nunca una acusación.
 */
export function NepotismoEntidad({ nepotismo }: { nepotismo: Dato | null }) {
  if (!nepotismo || nepotismo.total === 0) return null;
  const { total, monto, porGrado, detalle } = nepotismo;
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
                parientes. Aquí cruzamos esos parientes con los proveedores (locadores) de su propia entidad. El
                funcionario es un cargo público y se nombra; del proveedor tapamos un apellido, como con cualquier
                locador. Es un indicio para revisión humana, no una acusación: la DJI es pública y puede haber
                explicaciones legítimas.
              </span>
            </Ayuda>
          </div>
          <p className="text-cuerpo text-ink">
            {numero(total)} {total === 1 ? "pariente declarado" : "parientes declarados"} de funcionarios de esta
            entidad figura{total === 1 ? "" : "n"} como su proveedor, por {soles(monto)} en órdenes.
          </p>
          <ul className="flex flex-wrap gap-2">
            {porGrado.map((g) => (
              <li key={g.grado} className="rounded-full border border-amber/30 bg-paper px-3 py-1 text-rotulo text-ink">
                <span className="font-medium">{numero(g.n)}</span> {ETIQUETA[g.grado] ?? g.grado}
                <span className="text-mute"> ({soles(g.monto)})</span>
              </li>
            ))}
          </ul>
          {detalle && detalle.length > 0 && (
            <ul className="space-y-2 border-t border-amber/20 pt-3">
              {detalle.map((d, i) => (
                <li key={`${d.proveedorRuc}-${i}`} className="text-dato text-ink">
                  <span className="font-medium">{tituloNatural(d.declarante)}</span>
                  <span className="text-mute"> declaró un(a) {ETIQUETA[d.grado] ?? d.parentesco.toLowerCase()} que le vendió </span>
                  <span className="font-medium">{soles(d.monto)}</span>
                  <span className="text-mute"> en {numero(d.ordenes)} {d.ordenes === 1 ? "orden" : "órdenes"}: </span>
                  <Link href={rutaPersona(d.proveedorRuc)} className="font-medium text-amberTexto underline-offset-2 hover:underline">
                    {tituloNatural(d.proveedorNombre)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-meta text-mute">Indicio para revisión humana, no una acusación.</p>
        </div>
      </div>
    </section>
  );
}
