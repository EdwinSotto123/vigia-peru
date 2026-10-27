import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueInicio, ListaConteos, type FilaConteo } from "@/components/inicio/BloquesInicio";
import { fecha, numero, plural } from "@/lib/formato";
import { P_INV, P_OBRA, getResumenObras } from "@/lib/obras";

/**
 * Las banderas de las obras y las inversiones de una entidad en su Inicio («Qué se encontró»): una fila por bandera, con
 * cuántas obras (o inversiones) la tienen y el enlace a su lista ya filtrada en la pestaña «Obras», donde cada una abre
 * su evidencia (INFOBRAS o Invierte.pe) y su contrato. Las mismas banderas, en cada contrato que ejecuta o supervisa la
 * obra, van en la pestaña «Antecedentes» de su ficha (grupo «En la obra»). No es un cartel aparte: es una lista de
 * banderas como las de sus contratos y sus personas. Sin obras ni inversiones, no va.
 */
export async function ObrasInicio({ ruc, ruta }: { ruc: string; ruta: string }) {
  const r = await getResumenObras(ruc);
  const o = r?.obras;
  const i = r?.inversiones;
  if (!o?.total && !i?.total) return null;
  const obras = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: "obras", ...f })}`;
  const inversiones = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: "obras", vista: "inversiones", ...f })}`;
  const deObras = o?.total ? `de ${plural(o.total, "obra", "obras")} en INFOBRAS` : undefined;
  const deInversiones = i?.total ? `de ${plural(i.total, "inversión", "inversiones")} en Invierte.pe` : undefined;
  const b = o?.porBandera ?? {};
  const v = i?.porBandera ?? {};
  const filas: FilaConteo[] = [
    ...(o?.total
      ? [
          { etiqueta: "Obras paralizadas hoy", n: b.paralizada ?? 0, href: obras({ [P_OBRA.bandera]: "paralizada" }), detalle: deObras, grave: true },
          { etiqueta: "Obras atrasadas 20 puntos o más frente a lo programado", n: b.atraso ?? 0, href: obras({ [P_OBRA.bandera]: "atraso" }), detalle: deObras, grave: true },
          { etiqueta: "Obras pagadas por encima de lo construido", n: b.pago ?? 0, href: obras({ [P_OBRA.bandera]: "pago" }), detalle: deObras, grave: true },
          { etiqueta: "Obras por contrata con adicionales por más del 15 % del contrato", n: b.adicionales_tope ?? 0, href: obras({ [P_OBRA.bandera]: "adicionales_tope" }), detalle: deObras, grave: true },
          { etiqueta: "Obras con el plazo ampliado a la mitad o más", n: b.plazo ?? 0, href: obras({ [P_OBRA.bandera]: "plazo" }), detalle: deObras },
          { etiqueta: "Obras con controversias o arbitraje", n: b.controversia ?? 0, href: obras({ [P_OBRA.bandera]: "controversia" }), detalle: deObras },
          { etiqueta: "Obras con informes de la Contraloría", n: b.control ?? 0, href: obras({ [P_OBRA.bandera]: "control" }), detalle: deObras },
        ]
      : []),
    ...(i?.total
      ? [
          { etiqueta: "Inversiones que cuestan 1.5 veces o más lo aprobado", n: v.sobrecosto ?? 0, href: inversiones({ [P_INV.bandera]: "sobrecosto" }), detalle: deInversiones, grave: true },
          { etiqueta: "Inversiones con laudos arbitrales", n: v.laudo ?? 0, href: inversiones({ [P_INV.bandera]: "laudo" }), detalle: deInversiones },
        ]
      : []),
  ];
  return (
    <BloqueInicio
      nivel={3}
      titulo="En sus obras e inversiones"
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          <span className="block">
            De INFOBRAS, donde la entidad registra cada obra (avance, paralización, adicionales, plazo), y de Invierte.pe, el
            banco de proyectos del MEF (cuánto se aprobó y cuánto cuesta hoy).
          </span>
          <span className="mt-2 block">
            Cada fila abre esas obras, con su evidencia y su contrato en Vigía si lo tiene. La causa de una paralización o de un
            atraso puede ser de la entidad (falta de pago o de presupuesto): son indicios para revisar, no acusaciones.
          </span>
          {r?.alDia && <span className="mt-2 block">INFOBRAS al {fecha(r.alDia)}.</span>}
        </Ayuda>
      }
      enlace={{
        href: obras(o?.total ? {} : { vista: "inversiones" }),
        texto: o?.total ? (o.total === 1 ? "Ver su obra" : `Ver sus ${numero(o.total)} obras`) : "Ver sus inversiones",
      }}
    >
      <ListaConteos filas={filas} />
    </BloqueInicio>
  );
}
