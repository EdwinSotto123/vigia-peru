/**
 * El script que aplica el modo de color antes de pintar (va en el <head> de app/layout.tsx). Aparte de lib/modo.ts
 * porque ese es un módulo de cliente y el layout es de servidor.
 */
export const CLAVE_MODO = "vigia-modo";

export const SCRIPT_MODO = `(function(){var d=document.documentElement;try{var m=localStorage.getItem("${CLAVE_MODO}");if(m!=="dia"&&m!=="noche"){m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"dia":"noche"}d.dataset.modo=m}catch(e){d.dataset.modo="noche"}})();`;
