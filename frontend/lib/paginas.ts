/**
 * Qué páginas dibuja un paginador numerado: la primera, la última y la actual con `vecinas` a cada lado; `null` es un
 * salto («…»). Una sola función para todos los paginadores (antes había dos copias con distinto número de vecinas).
 */
export function paginasVisibles(actual: number, ultima: number, vecinas = 1): (number | null)[] {
  const cerca = Array.from({ length: vecinas * 2 + 1 }, (_, i) => actual - vecinas + i);
  const unicas = new Set<number>([1, ultima, ...cerca].filter((n) => n >= 1 && n <= ultima));
  const orden = [...unicas].sort((a, b) => a - b);
  const salida: (number | null)[] = [];
  orden.forEach((n, i) => {
    if (i > 0 && n - orden[i - 1] > 1) salida.push(null);
    salida.push(n);
  });
  return salida;
}
