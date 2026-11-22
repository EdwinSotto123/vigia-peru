import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, MapPinOff } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import type { NombreSprite } from "@/components/pixel/sprites";
import { FuenteFecha } from "@/components/salud/comun";
import { Paginas } from "@/components/salud/lista/Paginas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CasillaLocal, REJILLA_LOCALES } from "./CasillaLocal";
import { dondeDe, paginar, type FiltrosLugar, type Local } from "./directorio";

export const POR_PAGINA = 12;

/**
 * Una lista de locales autorizados dentro de su pestaña: qué es (una línea), las casillas de 12 en 12, las páginas y la
 * fuente con su fecha. Sólo la pestaña abierta usa la página de la URL; las otras empiezan en la primera.
 */
export function ListaLocales<T extends Local>({
  clave,
  lista,
  f,
  activa,
  href,
  quitarFiltros,
  sprite,
  nombre,
  intro,
  fuente,
  detalle,
  sinNombre,
}: {
  clave: string;
  lista: T[];
  f: FiltrosLugar;
  activa: boolean;
  /** La dirección de la página `n` de esta pestaña. */
  href: (n: number) => string;
  /** La página sin filtros, para el estado vacío. */
  quitarFiltros: string;
  sprite: NombreSprite;
  /** [singular, plural]: «centro médico», «centros médicos». */
  nombre: [string, string];
  intro: ReactNode;
  fuente: { nombre: string; url: string; generadoAl: string | null };
  detalle?: (l: T) => ReactNode;
  sinNombre?: string;
}) {
  const { items, pagina, paginas } = paginar(lista, activa ? f.pagina : 1, POR_PAGINA);
  const n = lista.length;
  return (
    <div>
      <p className="max-w-[72ch] text-dato leading-relaxed text-inkSoft">{intro}</p>
      {items.length ? (
        <ul id={`lista-${clave}`} className={`mt-4 scroll-mt-28 ${REJILLA_LOCALES}`}>
          {items.map((l, i) => (
            <li key={`${l.nombre ?? ""}-${l.direccion ?? ""}-${i}`} className="min-w-0">
              <CasillaLocal l={l} sprite={sprite} sinNombre={sinNombre}>
                {detalle?.(l)}
              </CasillaLocal>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-paper">
          <EstadoVacio
            Icono={MapPinOff}
            titulo={`Ningún ${nombre[0]} ${dondeDe(f)}${f.q ? ` con «${f.q}»` : ""}`}
            texto="Prueba con otro distrito, con la provincia o con toda la región."
            acciones={
              <Link href={quitarFiltros} className={claseAccion("secundario", "min-h-11")}>
                Ver todo el Perú
              </Link>
            }
          />
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        {n > 0 && <Paginas pagina={pagina} paginas={paginas} total={n} tamano={POR_PAGINA} nombre={n === 1 ? nombre[0] : nombre[1]} href={href} ancla={`lista-${clave}`} />}
        <FuenteFecha nombre={fuente.nombre} url={fuente.url} al={fuente.generadoAl} />
      </div>
    </div>
  );
}

/** Un enlace a una consulta oficial (nuestra, sin captcha o con él) como botón secundario con su flecha. */
export function EnlaceOficial({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", `min-h-11 ${className ?? ""}`)}>
      {children} <ArrowUpRight size={15} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}
