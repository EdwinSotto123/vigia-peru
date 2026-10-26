import { EstadoError } from "@/components/patrones";
import { type FiltroSecundario, type Parametros } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { fechaCorta } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { Faceta } from "@/lib/empresas";

/**
 * Lo que comparten las pestañas de la ficha de una empresa: paginación, estados y formatos. (Partido de
 * SeccionesEmpresa.tsx, 2026-10-22.) La severidad se pinta con `Severidad` (color, ícono y palabra): el «Grave / Para
 * revisar / Leve» de antes era un segundo vocabulario y cargaba la severidad en el adjetivo.
 */

export const entidadTexto = (e: string | null | undefined, ruc?: string | null) => (e ? tituloNatural(e) : ruc ?? "Entidad sin nombre");

/** "13 may. 2026" siempre con el año: al lado de una sanción o de un proceso de otro año, «el 13 may.» no dice de cuál. */
export const conAnio = (d: string) => {
  const f = fechaCorta(d);
  return /\d{4}/.test(f) ? f : `${f} ${d.slice(0, 4)}`;
};

export function Paginas({ total, size, actual, ruta, parametros, param, nombre }: { total: number; size: number; actual: number; ruta: string; parametros: Parametros; param: string; nombre: string }) {
  if (total <= size) return null;
  return (
    <div className="flex justify-end">
      <Paginacion
        actual={actual}
        paginas={Math.max(1, Math.ceil(total / size))}
        total={total}
        tam={size}
        navegacion="url"
        hrefBase={ruta}
        query={parametros}
        paramPagina={param}
        cargando={false}
        nombre={nombre}
      />
    </div>
  );
}

export const NoCargo = ({ que }: { que: string }) => (
  <EstadoError titulo={`No pudimos cargar ${que}`}>Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>
);

const anios = (desde: string | null, hasta: string | null): FiltroSecundario["opciones"] => {
  const a = Number(desde?.slice(0, 4)) || 2018;
  const b = Number(hasta?.slice(0, 4)) || new Date().getFullYear();
  const out: FiltroSecundario["opciones"] = [];
  for (let x = b; x >= Math.max(2015, a); x--) out.push({ valor: String(x), etiqueta: String(x) });
  return out;
};

/** Las opciones de un filtro con su conteo; `etiqueta` arma el texto (si no, el valor). */
export const opcionesDe = (f: Faceta[] | undefined, etiqueta?: (x: Faceta) => string) =>
  (f ?? []).map((x) => ({ valor: String(x.valor), etiqueta: etiqueta ? etiqueta(x) : String(x.etiqueta ?? x.valor), conteo: x.n }));
export const entidadEtq = (x: Faceta) => (x.etiqueta ? tituloNatural(String(x.etiqueta)) : String(x.valor));

export const ORDEN_LISTA = [
  { valor: "reciente", etiqueta: "Más recientes" },
  { valor: "antiguo", etiqueta: "Más antiguos" },
  { valor: "monto", etiqueta: "Mayor monto" },
  { valor: "monto_asc", etiqueta: "Menor monto" },
];

/** "MUNICIPALIDAD …" o "Lima" → la clave de un filtro (sin tildes ni mayúsculas). */
export const paraClave = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().trim();
/** Las opciones de un filtro local a partir de los valores de las filas: cada valor distinto con su etiqueta. */
export const opcionesLocales = (valores: (string | null | undefined)[], etiqueta: (v: string) => string) =>
  [...new Set(valores.filter((v): v is string => !!v))].sort((a, b) => etiqueta(a).localeCompare(etiqueta(b), "es")).map((v) => ({ valor: v, etiqueta: etiqueta(v) }));
