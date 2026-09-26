"use client";

/**
 * Pestaña Dictamen del informe. Módulo aparte y cargado con `next/dynamic` (PanelesDossier):
 * es el ÚNICO lugar del informe que usa react-markdown + remark-gfm (vía DictamenSection), y
 * así esas librerías no viajan en el JS inicial del informe, sólo al abrir esta pestaña.
 */

import { Pen } from "lucide-react";
import { setRedactNames } from "../../Redact";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { DictamenSection } from "./DictamenSection";

export function PanelDictamen({ result, dict, corrida, nombresPrivados }: PanelDossierProps) {
  // Cada pestaña registra de nuevo las personas privadas antes de redactar (ver ResultadoView).
  setRedactNames(nombresPrivados);
  if (!dict.trim()) {
    return (
      <AvisoSeccion titulo="Este análisis no tiene dictamen escrito" icono={<Pen size={16} aria-hidden />}>
        {corrida.corrioDictamen ? "La redacción del dictamen corrió, pero no guardó un texto." : "La redacción del dictamen no llegó a correr en este análisis."}{" "}
        Las señales, los ítems y los documentos que sí se leyeron están en las otras pestañas.
      </AvisoSeccion>
    );
  }
  return <DictamenSection dictamen={dict} nombresPrivados={nombresPrivados} modelo={result.dictamen?.gen_meta?.model ?? null} />;
}
