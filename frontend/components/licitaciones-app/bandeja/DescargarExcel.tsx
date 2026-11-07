"use client";

import { useState } from "react";
import { Download, Loader2, Lock } from "lucide-react";
import { useMe } from "@/components/gobserva/cuenta/comun";
import { ErrorCuenta, descargarCsv } from "@/lib/gobserva-cuenta";
import { aParams } from "@/lib/licitaciones-app/filtros";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { useAvisos } from "../ui/Avisos";

/**
 * Baja en Excel (CSV) la búsqueda que estás viendo, con su orden, hasta el tope de tu plan. Con el plan gratis el botón
 * lleva candado y, al tocarlo, dice que viene con un plan de pago y lleva a los planes.
 */
export function DescargarExcel() {
  const { filtros } = useLista();
  const { me } = useMe("licitaciones");
  const avisar = useAvisos();
  const [bajando, setBajando] = useState(false);
  const conCsv = !!me?.producto?.limites?.csv;

  async function bajar() {
    if (!conCsv) {
      avisar({ tono: "error", texto: "La descarga en Excel viene con un plan de pago.", accion: { etiqueta: "Ver los planes", href: "/planes" } });
      return;
    }
    setBajando(true);
    try {
      const n = await descargarCsv("licitaciones", { bandeja: "1", ...Object.fromEntries(aParams({ ...filtros, pag: 1 })) });
      avisar({ tono: "ok", texto: `Listo: ${n.toLocaleString("es-PE")} filas descargadas. Ábrelo con Excel o Google Sheets.` });
    } catch (e) {
      avisar({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos preparar el archivo." });
    } finally {
      setBajando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void bajar()}
      disabled={bajando}
      className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-caja px-3 text-dato font-medium text-inkSoft transition-colors duration-rapido hover:border-ink/20 hover:text-ink disabled:opacity-60"
    >
      {bajando ? <Loader2 size={15} aria-hidden className="animate-spin" /> : conCsv ? <Download size={15} aria-hidden /> : <Lock size={15} aria-hidden />}
      Excel
      <span className="sr-only">{conCsv ? ": descargar esta búsqueda" : ": viene con un plan de pago"}</span>
    </button>
  );
}
