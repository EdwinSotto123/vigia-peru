"use client";

import { useState } from "react";
import { Check, Download, Link2 } from "lucide-react";
import { descargarCsv } from "@/lib/csv";
import { numero } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";
import { etapaLabel, tipoLabel, type ContratoResumen } from "@/lib/contratos";

const BOTON =
  "inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate";

const COLUMNAS = ["ocid", "codigo", "objeto", "entidad", "ruc_entidad", "tipo", "etapa", "fecha_convocatoria", "valor_referencial_soles", "puntaje", "senales", "proveedor", "ruc_proveedor", "enlace"];

/** Sólo una empresa (RUC 20) lleva su nombre y su RUC al archivo: una persona natural no sale, ni tapada. */
const esEmpresa = (ruc: string | null) => !!ruc && /^20\d{9}$/.test(ruc);

function filaCsv(c: ContratoResumen, origen: string): Record<string, unknown> {
  const empresa = esEmpresa(c.proveedorRuc);
  return {
    ocid: c.ocid,
    codigo: c.codigo,
    objeto: c.titulo ?? "",
    entidad: c.entidad ?? "",
    ruc_entidad: c.entidadRuc ?? "",
    tipo: tipoLabel(c.tipo) ?? "",
    etapa: etapaLabel(c.etapa) ?? "",
    fecha_convocatoria: c.fecha ?? "",
    valor_referencial_soles: c.montoPen ?? "",
    // En revisión no hay puntaje ni señales públicas: la celda queda vacía, no en cero.
    puntaje: c.enRevision ? "" : c.score ?? "",
    senales: c.enRevision || c.score == null ? "" : c.banderas ?? "",
    proveedor: empresa ? c.proveedor ?? "" : "",
    ruc_proveedor: empresa ? c.proveedorRuc : "",
    enlace: `${origen}${rutaContrato(c.ocid)}`,
  };
}

/**
 * Lo que se puede hacer con la lista que se ve: bajarla en CSV y copiar el enlace de la búsqueda (todos los filtros
 * viven en la URL, así que el enlace ES la búsqueda guardada). El CSV trae la página visible, y lo dice: la lista
 * entera con sus filtros pide una exportación del servidor que todavía no existe.
 */
export function AccionesLista({ contratos }: { contratos: ContratoResumen[] }) {
  const [copiado, setCopiado] = useState(false);
  if (!contratos.length) return null;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles el enlace sigue en la barra del navegador.
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={BOTON}
        title="Descarga los contratos de esta página, con su enlace a Vigía"
        onClick={() => descargarCsv(COLUMNAS, contratos.map((c) => filaCsv(c, window.location.origin)), "contratos-vigia")}
      >
        <Download size={14} aria-hidden />
        <span>
          Descargar<span className="sr-only sm:not-sr-only"> esta página</span> ({numero(contratos.length)})
        </span>
      </button>
      <button type="button" className={BOTON} onClick={copiar}>
        {copiado ? <Check size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
        <span aria-live="polite">
          {copiado ? "Copiado" : <>Copiar enlace<span className="sr-only sm:not-sr-only"> de esta búsqueda</span></>}
        </span>
      </button>
    </div>
  );
}
