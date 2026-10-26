import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { BloqueInicio } from "./BloquesInicio";
import { numero, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona, PARAMS_EN_FICHA } from "@/lib/personas";
import type { NepotismoEntidad } from "@/lib/api-client";

const GRADO: Record<string, string> = {
  hermano: "hermano(a)",
  conyuge: "cónyuge o conviviente",
  hijo: "hijo(a)",
  padre: "padre o madre",
  otro: "pariente",
};

/** El funcionario, no completo: cargo + su primer apellido. La DJI es pública, pero basta para ubicarlo. */
const apellido = (n: string) => tituloNatural(n).split(/\s+/)[0] ?? n;

/**
 * Bandera de nepotismo en el Inicio de la entidad, con el mismo mecanismo que las demás señales: un funcionario (cargo
 * público) declaró a un pariente que figura como locador (proveedor) de ESTA entidad. Se nombra el cargo y el apellido
 * del funcionario y qué pariente se beneficia; el proveedor (RUC-10) va tapado como cualquier locador, y su ficha
 * guarda la evidencia (cada orden). Indicio para revisión humana, no una acusación. Server-safe.
 */
export function NepotismoInicio({
  nepotismo,
  href,
}: {
  nepotismo: NepotismoEntidad | null;
  href: (filtro: Record<string, string>) => string;
}) {
  if (!nepotismo || nepotismo.total === 0) return null;
  const detalle = nepotismo.detalle ?? [];
  const muestra = detalle.slice(0, 6);
  return (
    <BloqueInicio
      titulo="Parientes de funcionarios que le venden"
      ayuda={
        <Ayuda titulo="¿Qué es esta bandera?">
          Por ley, los funcionarios presentan una Declaración Jurada de Intereses (Ley 31227) donde declaran a sus
          parientes. Aquí cruzamos esos parientes con los proveedores (locadores) de su propia entidad. Se nombra el
          cargo y el apellido del funcionario, no su nombre completo; del proveedor tapamos un apellido, como con
          cualquier locador, y su ficha guarda cada orden. Es un indicio para revisión humana, no una acusación: la
          declaración es pública y el impedimento depende del cargo (Ley 32069, art. 30).
        </Ayuda>
      }
      enlace={{ href: href({ [PARAMS_EN_FICHA.senal]: "nepotismo" }), texto: "Ver en personas" }}
      ancho
    >
      <div className="space-y-3">
        <p className="text-dato text-ink">
          {numero(nepotismo.total)}{" "}
          {nepotismo.total === 1
            ? "pariente declarado de un funcionario figura"
            : "parientes declarados de funcionarios figuran"}{" "}
          como proveedor de esta entidad, por {soles(nepotismo.monto)} en órdenes.
        </p>
        <ul className="space-y-2">
          {muestra.map((d, i) => (
            <li key={`${d.proveedorRuc}-${i}`} className="flex gap-2.5 rounded-xl border border-amber/30 bg-amber-soft p-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amberTexto" aria-hidden />
              <p className="min-w-0 text-dato leading-relaxed text-ink">
                <span className="font-semibold">
                  {d.cargo ? tituloNatural(d.cargo) : "Un funcionario"}, {apellido(d.declarante)}
                </span>
                <span className="text-mute"> declaró un(a) {GRADO[d.grado] ?? "pariente"} que le vende: </span>
                {d.proveedorCodigo ? (
                  <Link href={rutaPersona(d.proveedorCodigo)} className="font-medium text-amberTexto underline-offset-2 hover:underline">
                    {tituloNatural(d.proveedorNombre)}
                  </Link>
                ) : (
                  <span className="font-medium">{tituloNatural(d.proveedorNombre)}</span>
                )}
                <span className="text-mute">, por {soles(d.monto)} en {numero(d.ordenes)} {d.ordenes === 1 ? "orden" : "órdenes"}.</span>
              </p>
            </li>
          ))}
        </ul>
        {detalle.length > muestra.length && (
          <p className="text-meta text-mute">Y {numero(detalle.length - muestra.length)} más en la pestaña de personas.</p>
        )}
        <p className="text-meta text-mute">Indicio para revisión humana, no una acusación.</p>
      </div>
    </BloqueInicio>
  );
}
