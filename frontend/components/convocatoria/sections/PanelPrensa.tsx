"use client";

/** Pestaña "Prensa" del informe, cargada con `next/dynamic` al abrirla (PanelesDossier). */

import { Newspaper } from "lucide-react";
import { setRedactNames } from "../../Redact";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { NoticiasSection } from "./NoticiasSection";
import { SeccionSegura } from "./SeccionSegura";

export function PanelPrensa({ result, nombresPrivados }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  if (!result.news_research) {
    return (
      <AvisoSeccion titulo="La búsqueda de prensa no corrió en este análisis" icono={<Newspaper size={16} aria-hidden />}>
        {result.news_research_raw
          ? "La búsqueda de prensa respondió, pero su resultado no se pudo leer."
          : "No hay notas de prensa asociadas a este contrato en el análisis guardado."}
      </AvisoSeccion>
    );
  }
  return (
    <SeccionSegura nombre="la prensa">
      <NoticiasSection news={result.news_research} />
    </SeccionSegura>
  );
}
