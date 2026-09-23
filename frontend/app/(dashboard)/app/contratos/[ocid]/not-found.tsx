import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

/**
 * (El título de la pestaña lo pone `generateMetadata` de la página: "Contrato no encontrado".)
 *
 * /app/contratos/[ocid] sin contrato: ni el OCID ni el código SEACE pegado
 * aparecen en lo que Vigía ingirió. Dice qué pasó, por qué puede pasar y a
 * dónde ir, en vez de la página 404 genérica en inglés.
 */
export default function ContratoNoEncontrado() {
  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/app/contratos" className="inline-flex items-center gap-1.5 text-xs text-mute hover:text-ink">
        <ArrowLeft size={13} aria-hidden /> Contratos
      </Link>
      <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-dashed border-line bg-paper px-6 py-10 text-center">
        <SearchX size={22} className="mx-auto text-mute" aria-hidden />
        <h1 className="mt-3 font-serif text-2xl font-bold text-ink">No encontramos ese contrato</h1>
        <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-relaxed text-mute">
          El código o el OCID del enlace no está entre los contratos que Vigía tomó de la API OCDS del OECE. Puede
          que esté mal escrito, o que la convocatoria sea anterior a lo que se ingirió o ya no figure en el registro
          público.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/app/contratos"
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-inkSoft"
          >
            Buscar en la lista de contratos
          </Link>
        </div>
      </div>
    </div>
  );
}
