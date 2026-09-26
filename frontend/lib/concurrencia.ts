/** Concurrencia acotada para pedidos en lote al API (lo comparten lib/revision y lib/revision-humana). */

/** Pool con concurrencia acotada: 94 fetches de golpe contra Cloud Run son un pico innecesario. */
export async function enParalelo<T, R>(xs: T[], limite: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let i = 0;
  const obrero = async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await f(xs[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, xs.length) }, obrero));
  return out;
}
