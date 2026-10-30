/**
 * El logo de un aliado que se puede mostrar: el del bucket propio (lo que sube /api/upload como logo) o uno del propio
 * sitio (el de la semilla, que llega como ruta relativa o con el dominio viejo de Cloud Run). Cualquier otra URL se
 * descarta y se muestra el ícono (auditoría 2026-10-30: una imagen de otro sitio en el podio sabía la IP de cada visitante
 * y podía ser cualquier cosa). La API ya no acepta otras (routes/contribuciones.ts → LOGO_PROPIO): esto cubre lo viejo.
 */
const DEL_BUCKET = /^https:\/\/storage\.googleapis\.com\/vigia-peru-reportes\/logos\/[\w.-]{1,160}$/;
const DEL_SITIO = /^\/(?!\/)[\w./-]{1,200}$/;

export function logoPropio(url: string | null | undefined): string | null {
  if (!url) return null;
  const local = url.replace(/^https?:\/\/[^/]+\.run\.app(?=\/)/, "");
  return DEL_BUCKET.test(local) || DEL_SITIO.test(local) ? local : null;
}
