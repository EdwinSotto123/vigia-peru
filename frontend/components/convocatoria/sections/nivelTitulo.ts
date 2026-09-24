"use client";

import { createContext } from "react";

/**
 * Nivel del título del dossier (lo pinta ShareableHeader). En la página pública es el <h1>; dentro
 * de la vista previa del panel (components/admin/revision/VistaPublicada) la página ya tiene el suyo
 * y este baja a <h2>. Lo pasa la vista previa con un Provider porque la cabecera la arma
 * ResultadoView, que no lo recibe como prop.
 *
 * Va en su propio archivo y no en ShareableHeader: así el panel lo importa sin arrastrar la cabecera
 * (y sus utilidades) al JS inicial de la página, que ResultadoView carga aparte.
 */
export const NivelTituloDossier = createContext<"h1" | "h2">("h1");
