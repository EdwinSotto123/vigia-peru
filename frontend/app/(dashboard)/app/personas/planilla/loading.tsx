/**
 * La misma espera del dashboard (../loading.tsx), aquí para que se vea también al entrar a una ficha desde su lista o
 * de una ficha a otra: Next sólo muestra el loading del tramo de la ruta que cambia, y sin uno en este tramo el clic
 * dejaba la pantalla quieta hasta que llegaba la página entera (la ficha de una persona, 2.4 s).
 */
export { default } from "../../../loading";
