import type { ReactNode } from "react";
import { CircleDashed } from "lucide-react";
import { CabeceraPestana } from "@/components/patrones";
import { IndicadoresSkeleton, TablaSkeleton } from "@/components/listado";

/**
 * Las piezas de las pestañas de la ficha de una entidad (/entidad/[ruc]): la que se deja para después de la abierta, la
 * vacía y su esqueleto.
 */

/**
 * Lo de una pestaña que no se abre al cargar, para después: el servidor la arma (y pide sus datos) recién cuando ya
 * salieron los pedidos de la abierta, en la misma respuesta. Antes todas pedían lo suyo a la vez (~13 pedidos a la API) y
 * la abierta esperaba su turno: un Worker de Cloudflare tiene 6 conexiones abiertas a la vez y las demás hacen cola en
 * el orden en que se piden. Va dentro de un `Suspense` con el esqueleto de su pestaña: quien la abre antes de que llegue ve
 * el esqueleto; cuando la página terminó de llegar, cambiar de pestaña sigue siendo instantáneo (todo ya está ahí).
 */
export async function Diferida({ children }: { children: ReactNode }) {
  // Una vuelta del bucle de eventos: lo que la pestaña abierta pide en la primera pasada ya salió.
  await new Promise<void>((listo) => setTimeout(listo, 0));
  return <>{children}</>;
}

/**
 * Una pestaña sin nada que mostrar: su título (y su ⓘ) y UN estado vacío que dice por qué no hay y dónde más mirar. Antes
 * mostraba sus cifras en 0 o «Sin dato» y sus filtros con 0 antes del mensaje (Petroperú › Plazas CAS: cuatro tarjetas y
 * cinco filtros vacíos). Sin la llamita: la ficha es de una entidad y la llamita no acompaña a nadie (§2.3).
 *
 * 2026-11-23 (el usuario: «secciones que son solo texto sin fondo o forma o con solo fondo»): era una caja punteada con
 * dos párrafos centrados. Ahora es una tarjeta con el ícono de la pestaña, el título grande, el porqué y la salida al lado.
 */
export function PestanaVacia({ titulo, ayuda, accion, icono, children }: { titulo: string; ayuda?: ReactNode; accion?: ReactNode; icono?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <CabeceraPestana ayuda={ayuda} />
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-paper p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-paperDeep text-inkSoft">
          {icono ?? <CircleDashed size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-bloque font-bold leading-tight text-ink text-balance">{titulo}</p>
          <div className="mt-1.5 max-w-2xl text-dato leading-relaxed text-inkSoft text-pretty">{children}</div>
        </div>
        {accion && <div className="shrink-0">{accion}</div>}
      </div>
    </div>
  );
}

/** Varias acciones de un estado vacío, en una fila que se parte en el celular. */
export function Acciones({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 sm:justify-end">{children}</div>;
}

/** Mientras llega una pestaña que no se abrió al cargar: su título y la forma de lo que viene (cifras, una tabla). */
export function EsqueletoPestana({ cifras = 0, columna = "Detalle", filas = 6 }: { cifras?: number; columna?: string; filas?: number }) {
  return (
    <div aria-busy="true">
      <CabeceraPestana />
      <div className="space-y-4">
        {cifras > 0 && <IndicadoresSkeleton n={cifras} />}
        <TablaSkeleton columnas={[{ clave: "a", titulo: columna, ancho: "1fr" }]} filas={filas} />
      </div>
    </div>
  );
}
