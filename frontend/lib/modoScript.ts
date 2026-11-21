/**
 * El script que aplica el modo de color antes de pintar (va en el <head> de app/layout.tsx). Aparte de lib/modo.ts
 * porque ese es un módulo de cliente y el layout es de servidor.
 *
 * También marca el producto de Gobserva en <html> (`data-producto`, 2026-11-21): cada producto tiene su color
 * (scripts/colores/colores_producto.py → globals.css), y así lo lleva toda la página, también lo que se abre fuera del
 * marco. Por el subdominio (salud.gobserva.cloud, salud-dev.gobserva.cloud) o, en DEV, por la ruta (/salud); lo demás
 * es Vigía (`vigia`, añil). app/layout.tsx ya lo trae en `vigia` para quien no corre JavaScript.
 */
export const CLAVE_MODO = "vigia-modo";

export const SCRIPT_MODO = `(function(){var d=document.documentElement;try{var m=localStorage.getItem("${CLAVE_MODO}");if(m!=="dia"&&m!=="noche"){m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"dia":"noche"}d.dataset.modo=m}catch(e){d.dataset.modo="noche"}try{var P=["salud","empleo","licitaciones","obras"],h=location.hostname,s=h.split(".")[0].replace(/-dev$/,""),r=location.pathname.split("/")[1],x=/gobserva\.cloud$/.test(h)&&P.indexOf(s)>=0?s:P.indexOf(r)>=0?r:"vigia";d.dataset.producto=x}catch(e){}})();`;
