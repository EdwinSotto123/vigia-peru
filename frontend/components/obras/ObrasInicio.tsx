import { Info } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueInicio, ListaConteos, type FilaConteo } from "@/components/inicio/BloquesInicio";
import { fecha, listaY, numero } from "@/lib/formato";
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
  const nObras = o?.total ?? 0;
  const nInversiones = i?.total ?? 0;
  // De cuántas es cada cifra, UNA vez sobre sus filas (antes «de 1,322 inversiones en Invierte.pe» bajo cada una); y el
  // largo de su barra: qué parte de sus obras (o de sus inversiones) tiene la bandera.
  const deObras = nObras === 1 ? "De su obra en INFOBRAS" : `De sus ${numero(nObras)} obras en INFOBRAS`;
  const deInversiones = nInversiones === 1 ? "De su inversión en Invierte.pe" : `De sus ${numero(nInversiones)} inversiones en Invierte.pe`;
  const b = o?.porBandera ?? {};
  const v = i?.porBandera ?? {};
  // `tipo`: el de la bandera en el contrato (lib/cruces), para el ícono de su familia. `corto`: cómo se nombra en la
  // línea de las que no tienen ningún caso.
  type FilaObra = FilaConteo & { corto: string };
  const obra = (etiqueta: string, corto: string, bandera: string, tipo: string, grave = false): FilaObra => ({
    etiqueta,
    corto,
    n: b[bandera] ?? 0,
    href: obras({ [P_OBRA.bandera]: bandera }),
    grupo: deObras,
    de: nObras,
    tipo,
    grave,
  });
  const inversion = (etiqueta: string, corto: string, bandera: string, tipo: string, grave = false): FilaObra => ({
    etiqueta,
    corto,
    n: v[bandera] ?? 0,
    href: inversiones({ [P_INV.bandera]: bandera }),
    grupo: deInversiones,
    de: nInversiones,
    tipo,
    grave,
  });
  const todas: FilaObra[] = [
    ...(nObras
      ? [
          obra("Obras paralizadas hoy", "obras paralizadas", "paralizada", "obra_paralizada", true),
          obra("Obras atrasadas 20 puntos o más frente a lo programado", "obras atrasadas", "atraso", "obra_atraso", true),
          obra("Obras pagadas por encima de lo construido", "obras pagadas por encima de lo construido", "pago", "obra_pagado_sin_avance", true),
          obra("Obras por contrata con adicionales por más del 15 % del contrato", "adicionales por más del 15 %", "adicionales_tope", "obra_adicionales_sobre_tope", true),
          obra("Obras con el plazo ampliado a la mitad o más", "plazos ampliados a la mitad o más", "plazo", "obra_plazo_ampliado"),
          obra("Obras con controversias o arbitraje", "controversias o arbitraje", "controversia", "obra_controversia"),
          obra("Obras con informes de la Contraloría", "informes de la Contraloría", "control", "obra_informe_control"),
        ]
      : []),
    ...(nInversiones
      ? [
          inversion("Inversiones que cuestan 1.5 veces o más lo aprobado", "inversiones con sobrecosto", "sobrecosto", "inversion_sobrecosto", true),
          inversion("Inversiones con laudos arbitrales", "laudos arbitrales", "laudo", "inversion_laudo"),
        ]
      : []),
  ];
  // Las que no tienen ningún caso, en UNA línea al final («Sin casos de …»), no una fila gris «… 0» cada una: eran tres o
  // cuatro renglones que no decían nada (auditoría del 2026-11-05).
  const filas: FilaConteo[] = todas.filter((f) => f.n > 0);
  const sinCasos = todas.filter((f) => f.n === 0).map((f) => f.corto);
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
      {filas.length > 0 && <ListaConteos filas={filas} />}
      {sinCasos.length > 0 && (
        <p className={`flex items-start gap-2 px-3.5 text-meta leading-snug text-mute${filas.length ? " mt-3 border-t border-line/70 pt-3" : ""}`}>
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0">Sin casos de {listaY(sinCasos)}.</span>
        </p>
      )}
    </BloqueInicio>
  );
}
