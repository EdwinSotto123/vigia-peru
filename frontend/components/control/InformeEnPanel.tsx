"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";
import { DetalleInformeControl, PieInforme, asuntoDe, type ResumenInforme } from "./DetalleInforme";

const ENLACE = "font-semibold underline decoration-line underline-offset-2 hover:decoration-ink";

/**
 * El número de un informe de control que abre el informe en el panel lateral, sin salir de la página: lo que encontró la
 * Contraloría, sus observaciones y los funcionarios comprendidos (el mismo panel del buscador y de la pestaña Control).
 * Lo usan las banderas que citan un informe (`observado_por_contraloria`, `socio_con_informe_control`). El enlace a la
 * ficha de la Contraloría va en el pie del panel.
 */
export function InformeEnPanel({ informe, children, className }: { informe: ResumenInforme; children?: React.ReactNode; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const n = informe.numero ?? informe.codigo;
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-label={`Ver lo que encontró la Contraloría en el informe N.° ${n}`}
        className={cn("inline cursor-pointer text-left", ENLACE, className)}
      >
        {children ?? n}
      </button>
      <Panel
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={`Informe N.° ${n}`}
        descripcion={<span className="line-clamp-2">{asuntoDe(informe.titulo)}</span>}
        ancho="lg"
        pie={<PieInforme codigo={informe.codigo} urlPdf={informe.urlPdf} urlResumen={informe.urlResumen} />}
      >
        <DetalleInformeControl resumen={informe} conEntidad />
      </Panel>
    </>
  );
}

/** El informe que cita el detalle de una bandera (cruces_proveedor.detalle), como lo pide el panel. null sin código. */
export function informeDeDetalle(d: Record<string, unknown>): ResumenInforme | null {
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const codigo = t(d.informe_codigo);
  if (!codigo || !/^[0-9A-Z]{6,24}$/.test(codigo)) return null;
  return {
    codigo,
    numero: t(d.informe_numero),
    titulo: t(d.informe_titulo),
    fecha: t(d.emision),
    entidad: t(d.informe_entidad),
    entidadRuc: t(d.informe_entidad_ruc),
    responsabilidades: Array.isArray(d.responsabilidades) ? d.responsabilidades.filter((r): r is string => typeof r === "string") : [],
    urlResumen: t(d.url_resumen),
  };
}
