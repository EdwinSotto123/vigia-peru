"use client";

/**
 * Error de una página del dashboard. Sin este archivo, el error subía hasta
 * app/error.tsx, que reemplaza también al layout del dashboard: la barra lateral
 * desaparecía y no quedaba navegación. Acá el límite queda DEBAJO del layout, así
 * que la barra sigue en su lugar y sólo se reemplaza el contenido. Mismo contenido
 * y misma recarga automática ante un chunk viejo que el de la raíz.
 */
export { default } from "../error";
