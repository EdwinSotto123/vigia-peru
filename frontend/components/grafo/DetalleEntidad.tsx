"use client";

import Link from "next/link";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { limpiarObjeto, recortar } from "@/components/contratos/recortar";
import type { DetalleFila } from "@/components/listado/DetalleFilas";
import { AyudaTermino, BloqueDetalle, CuerpoDetalle, DatosClave, PieDetalle, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatMonto, type ContratosPagina } from "@/lib/contratos";
import { fechaCorta, numero, oracion, plural, solesCompacto } from "@/lib/formato";
import { nivelTxt, rutaContratosIndicio, TIPOS_CAPTURA, type ConteosCaptura } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import { clavePartido } from "@/lib/poder";
import { ListaIndicios } from "./indicios";
import { usePoder } from "./vista";

/**
 * El panel de una entidad gobernada (§14.4): quién la gobierna, sus indicios con cuántos contratos tiene cada uno (cada
 * conteo lleva a esos contratos en la lista) y, al abrirlo, sus contratos con indicio de más monto. Lo usan la ficha del
 * partido, la lista de entidades y el árbol territorial del mapa de poder.
 */

export interface EntidadPoderLigera extends ConteosCaptura {
  ruc: string;
  nombre: string;
  nivel: string;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  partido?: string | null;
  autoridad?: string | null;
  cargo_gob?: string | null;
  periodoInicio?: string | null;
  periodoFin?: string | null;
  n_captura: number;
  monto_captura: number;
  n_empresas?: number | null;
}

/** El lugar de una entidad, de lo chico a lo grande ("Pichari, La Convención, Cusco"), sin repetir su propio nombre. */
export function lugarDe(e: { nivel: string; departamento?: string | null; provincia?: string | null; distrito?: string | null }): string {
  const partes = e.nivel === "distrital" ? [e.distrito, e.provincia, e.departamento] : e.nivel === "provincial" ? [e.provincia, e.departamento] : [e.departamento];
  return partes.filter((x): x is string => !!x).map((x) => tituloNatural(x)).join(", ");
}

/** El `detalle` de una fila (Tabla, ArbolTabla) para una entidad. Todo ReactNode ya armado: sin funciones. */
export function detalleEntidad(e: EntidadPoderLigera): Omit<DetalleFila, "id"> {
  const nombre = tituloNatural(e.nombre);
  const lugar = lugarDe(e);
  return {
    titulo: nombre,
    etiqueta: `Ver el detalle de ${nombre}: ${e.n_captura > 0 ? plural(e.n_captura, "contrato con indicio", "contratos con indicio") : "sin contratos con indicio"}`,
    descripcion: (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <Dato tipo="tipo">{nivelTxt(e.nivel)}</Dato>
        {lugar && <Dato tipo="lugar">{lugar}</Dato>}
      </span>
    ),
    contenido: <CuerpoEntidad e={e} />,
    pie: (
      <PieDetalle
        principal={
          <EnlaceAccion href={`/entidad/${e.ruc}`} flecha prefetch={false}>
            Ver la ficha de la entidad
          </EnlaceAccion>
        }
        secundarias={
          e.n_captura > 0 ? (
            <EnlaceAccion href={rutaContratosIndicio(e.ruc, undefined, { desde: e.periodoInicio, hasta: e.periodoFin })} variante="secundario" prefetch={false}>
              Sus contratos con indicio
            </EnlaceAccion>
          ) : undefined
        }
      />
    ),
  };
}

function CuerpoEntidad({ e }: { e: EntidadPoderLigera }) {
  const periodo = e.periodoInicio ? `${e.periodoInicio.slice(0, 4)} a ${e.periodoFin?.slice(0, 4) ?? "hoy"}` : null;
  const datos: DatoClave[] = [];
  if (e.partido) {
    datos.push({
      etiqueta: "La gobierna",
      valor: (
        <Link href={`/app/poder/${clavePartido(e.partido)}`} prefetch={false} className="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-granate hover:decoration-granate">
          {tituloNatural(e.partido)}
        </Link>
      ),
    });
  }
  // Autoridad electa: se muestra completa (docs/PRIVACIDAD.md).
  datos.push({ etiqueta: "Autoridad", valor: e.autoridad ? `${tituloNatural(e.autoridad)}${e.cargo_gob ? `, ${oracion(e.cargo_gob).toLowerCase()}` : ""}` : null });
  if (periodo) datos.push({ etiqueta: "Periodo de gobierno", valor: periodo });
  datos.push({ etiqueta: "Contratos con indicio", valor: numero(e.n_captura), mono: true });
  if (e.n_captura > 0) datos.push({ etiqueta: "Monto de esos contratos", valor: solesCompacto(e.monto_captura), mono: true });
  if (e.n_empresas != null && e.n_captura > 0) datos.push({ etiqueta: "Empresas ligadas", valor: numero(e.n_empresas), mono: true });

  return (
    <CuerpoDetalle>
      <DatosClave items={datos} />
      {e.n_captura > 0 && (
        <BloqueDetalle titulo="Indicios" ayuda={<AyudaTermino clave="captura" />}>
          <ListaIndicios x={e} entidadRuc={e.ruc} periodo={{ desde: e.periodoInicio, hasta: e.periodoFin }} />
        </BloqueDetalle>
      )}
      {e.n_captura > 0 && <ContratosDeMasMonto ruc={e.ruc} />}
    </CuerpoDetalle>
  );
}

const CRUCES_CAPTURA = TIPOS_CAPTURA.map((t) => t.tipo).join(",");

/** Sus contratos con indicio de más monto: se piden al abrir el panel (sólo se dibuja el de la fila abierta). */
function ContratosDeMasMonto({ ruc }: { ruc: string }) {
  const ruta = `/contratos?${new URLSearchParams({ entidad: ruc, cruce: CRUCES_CAPTURA, orden: "monto", size: "5" }).toString()}`;
  const c = usePoder<ContratosPagina>(ruta);
  const lista = c.datos?.data ?? [];
  return (
    <BloqueDetalle titulo="Sus contratos con indicio de más monto">
      {c.cargando ? (
        <span className="block space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </span>
      ) : c.error ? (
        <p className="flex flex-wrap items-center gap-x-3 text-dato text-mute">
          No pudimos traer sus contratos.
          <button type="button" onClick={c.reintentar} className="font-semibold text-granate underline-offset-4 hover:underline">
            Reintentar
          </button>
        </p>
      ) : lista.length === 0 ? (
        <p className="text-dato text-mute">La lista de contratos no tiene estos contratos todavía.</p>
      ) : (
        <ul className="divide-y divide-line/70 rounded-xl border border-line">
          {lista.map((k) => (
            <li key={k.ocid}>
              <Link
                href={`/app/contratos/${encodeURIComponent(k.ocid)}`}
                prefetch={false}
                className="block px-3.5 py-2.5 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              >
                <span className="line-clamp-2 text-dato font-medium leading-snug text-ink" title={k.titulo ?? undefined}>
                  {k.titulo ? recortar(oracion(limpiarObjeto(k.titulo)), 160) : "Sin objeto registrado"}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-mute">
                  <span className="font-mono tabular-nums text-ink">{k.montoPen ? formatMonto(k.montoPen, k.moneda) : "Sin dato"}</span>
                  {k.fecha && <Dato tipo="fecha">{fechaCorta(k.fecha.slice(0, 10))}</Dato>}
                </span>
                {k.cruces && k.cruces.length > 0 && (
                  <span className="mt-1.5 block">
                    <CrucesCelda cruces={k.cruces} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BloqueDetalle>
  );
}
