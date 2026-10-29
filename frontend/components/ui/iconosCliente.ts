"use client";

/**
 * Los íconos que más se repiten en una página, como componentes del navegador: un server component que los dibuja manda
 * `{"size":12,"className":"shrink-0"}` en vez del SVG entero (~600 bytes cada uno). Medido el 2026-10-29 en la Historia del
 * Minsa: 904 íconos eran 1,1 MB de 2,6 (el de la fuente, la flecha de una acción y los de severidad). El HTML que arma el
 * servidor los trae igual. No van en las imágenes OG: satori no dibuja componentes del navegador.
 */
export { AlertTriangle, ArrowRight, CircleAlert, CircleCheck, CircleDashed, ExternalLink, Info } from "lucide-react";
