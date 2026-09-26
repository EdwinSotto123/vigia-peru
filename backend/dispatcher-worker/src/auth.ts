/**
 * Autenticación de los endpoints manuales (`POST /ejecutar`, `GET /simular`, `GET /instancias/:id`):
 * `Authorization: Bearer <DISPATCHER_TOKEN>`. Sin el secreto configurado no se atiende nada.
 * Se comparan los SHA-256 de ambos textos en tiempo constante: ni el contenido ni el largo del token
 * se filtran por el tiempo de respuesta.
 */

async function resumen(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

export async function iguales(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([resumen(a), resumen(b)]);
  const sutil = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (typeof sutil.timingSafeEqual === "function") return sutil.timingSafeEqual(x, y);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function autorizado(req: Request, token: string | undefined): Promise<boolean> {
  const esperado = (token ?? "").trim();
  if (!esperado) return false;
  const auth = req.headers.get("Authorization") ?? "";
  const dado = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return iguales(dado, esperado);
}
