/**
 * Lo que cuesta la corrupción y lo que cuesta vigilarla: las dos cifras que la portada y /app/apoyar dicen con palabras,
 * en un solo lugar para que no se contradigan.
 *
 * La de la Contraloría es su ESTIMACIÓN de 2023 (nota de prensa del 2024: «habrían ocasionado pérdidas por S/ 24 268
 * millones», 12,7 % del presupuesto ejecutado; la inversión, S/ 8 963 millones), no un conteo: así se dice en la
 * página, con su enlace. Cuando publique la del año siguiente, se cambia aquí.
 */
export const CONTRALORIA_CORRUPCION = {
  anio: 2023,
  millones: 24_268,
  porCien: 12.7,
  inversionMillones: 8_963,
  url: "https://www.gob.pe/institucion/contraloria/noticias/912182-corrupcion-e-inconducta-funcional-habrian-ocasionado-perdidas-por-s-24-268-millones-en-el-2023",
} as const;

/**
 * Lo que el equipo de Vigía puso desde que empezó (servidores, datos, IA y lo demás), dicho por el equipo el
 * 2026-10-29: «hemos gastado casi 9 000 soles». Las cifras de cada mes, con su factura, están en /app/cuanto-cuesta.
 */
export const PUESTO_POR_EL_EQUIPO_PEN = 9_000;
