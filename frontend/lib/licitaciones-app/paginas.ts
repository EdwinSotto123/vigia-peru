/** Las páginas a mostrar en una paginación: la primera, la última y dos a cada lado de la actual; null es «…». */
export function numeros(pagina: number, paginas: number): (number | null)[] {
  const set = new Set([1, paginas, pagina - 2, pagina - 1, pagina, pagina + 1, pagina + 2].filter((n) => n >= 1 && n <= paginas));
  const xs = [...set].sort((a, b) => a - b);
  const r: (number | null)[] = [];
  xs.forEach((n, i) => {
    if (i > 0 && n - xs[i - 1] > 1) r.push(null);
    r.push(n);
  });
  return r;
}
