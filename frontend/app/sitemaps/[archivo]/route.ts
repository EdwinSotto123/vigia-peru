import { CABECERAS_XML, TIPOS_FICHA, type TipoFicha, urlsDeFichas, urlsDePaginas, xmlUrlset } from "@/lib/sitemap";

/** /sitemaps/paginas.xml y /sitemaps/<tipo>-<n>.xml (lib/sitemap.ts). En cada pedido, no en el build. */
export const dynamic = "force-dynamic";

const ARCHIVO = new RegExp(`^(?:(paginas)|(${TIPOS_FICHA.join("|")})-([1-9]\\d{0,3}))\\.xml$`);

export async function GET(_req: Request, { params }: { params: { archivo: string } }) {
  const m = ARCHIVO.exec(params.archivo);
  if (!m) return new Response("No existe ese archivo del sitemap.", { status: 404 });
  const urls = m[1] ? await urlsDePaginas() : await urlsDeFichas(m[2] as TipoFicha, Number(m[3]));
  if (!urls) return new Response("Este archivo no está disponible ahora.", { status: 503, headers: { "Retry-After": "3600" } });
  if (!urls.length) return new Response("No existe ese archivo del sitemap.", { status: 404 });
  return new Response(xmlUrlset(urls), { headers: CABECERAS_XML });
}
