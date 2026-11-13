import { paginasVisibles } from "../paginas.ts";

/** Las páginas a mostrar en la paginación de las apps: dos a cada lado de la actual (lib/paginas.ts). */
export const numeros = (pagina: number, paginas: number): (number | null)[] => paginasVisibles(pagina, paginas, 2);
