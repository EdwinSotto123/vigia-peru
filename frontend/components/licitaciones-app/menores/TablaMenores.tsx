import Link from "next/link";
import { Clock } from "lucide-react";
import { cierreMenor, limpiar, nombreRegion, type Menor } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { EstrellaSeguir } from "../seguimiento/BotonSeguir";
import { Insignia, InsigniaTipo } from "../ui/Insignia";
import { TablaDatos } from "../ui/TablaDatos";

/** Cuándo cierra la cotización: rojo con menos de 6 horas, ámbar si cierra hoy o mañana. */
function Cierre({ iso, ahora }: { iso: string; ahora: number }) {
  const c = cierreMenor(iso, ahora);
  const horas = (Date.parse(iso) - ahora) / 3_600_000;
  return (
    <Insignia tono={c.cerrada ? "neutro" : c.urgente ? "urgente" : horas <= 36 ? "aviso" : "neutro"} Icono={c.cerrada ? undefined : Clock}>
      {c.texto}
    </Insignia>
  );
}

/** Los contratos menores abiertos como tabla (desde md) o tarjetas (celular). Cada uno abre su ficha y se puede seguir. */
export function TablaMenores({ filas, base, ahora }: { filas: Menor[]; base: string; ahora: number }) {
  const ficha = (m: Menor) => rutaEn(base, `/menor/${m.id}`);
  const lugar = (m: Menor) => (m.regiones?.length ? m.regiones.map(nombreRegion).join(", ") : "Sin región");
  return (
    <TablaDatos<Menor>
      titulo="Contratos menores abiertos"
      filas={filas}
      claveFila={(m) => String(m.id)}
      columnas={[
        { clave: "seguir", titulo: <span className="sr-only">Seguir</span>, className: "w-12 pr-0", celda: (m) => <EstrellaSeguir id={String(m.id)} codigo={m.codigo} titulo={limpiar(m.descripcion)} tipo="menor" /> },
        {
          clave: "que",
          titulo: "Qué piden",
          className: "min-w-[14rem] xl:min-w-[16rem]",
          celda: (m) => (
            <div className="min-w-0 max-w-[44rem]">
              <Link href={ficha(m)} className="line-clamp-2 text-dato font-semibold leading-snug text-ink underline-offset-4 hover:text-granate hover:underline">
                {limpiar(m.descripcion) || "Sin descripción registrada"}
              </Link>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-mute">
                <span className="font-mono">{m.codigo}</span>
                {m.rubros?.[0] && <span className="line-clamp-1">{limpiar(m.rubros[0])}</span>}
              </p>
              <p className="mt-0.5 line-clamp-1 text-meta text-inkSoft xl:hidden">
                {m.entidad ? tituloNatural(m.entidad) : "Entidad sin nombre"}, {lugar(m)}
              </p>
            </div>
          ),
        },
        {
          clave: "entidad",
          titulo: "Entidad",
          desde: "xl",
          className: "w-[13rem] 2xl:w-[15rem]",
          celda: (m) => (
            <div className="min-w-0">
              <p className="line-clamp-2 text-dato text-ink">{m.entidad ? tituloNatural(m.entidad) : "Sin nombre"}</p>
              <p className="mt-0.5 text-meta text-mute">{lugar(m)}</p>
            </div>
          ),
        },
        { clave: "tipo", titulo: "Tipo", desde: "2xl", className: "w-28", celda: (m) => <InsigniaTipo tipo={m.tipo} /> },
        { clave: "items", titulo: "Ítems", desde: "lg", alinear: "derecha", className: "w-20", celda: (m) => <span className="tabular-nums text-inkSoft">{numero(m.items)}</span> },
        { clave: "cierra", titulo: "Cierra la cotización", className: "w-44", celda: (m) => <Cierre iso={m.cierra} ahora={ahora} /> },
      ]}
      tarjeta={(m) => (
        <div className="flex gap-2 px-3 py-3.5">
          <EstrellaSeguir id={String(m.id)} codigo={m.codigo} titulo={limpiar(m.descripcion)} tipo="menor" />
          <div className="min-w-0 flex-1">
            <Link href={ficha(m)} className="line-clamp-3 text-dato font-semibold leading-snug text-ink">
              {limpiar(m.descripcion) || "Sin descripción registrada"}
            </Link>
            <p className="mt-1 line-clamp-1 text-meta text-inkSoft">
              {m.entidad ? tituloNatural(m.entidad) : "Entidad sin nombre"}, {lugar(m)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Cierre iso={m.cierra} ahora={ahora} />
              <span className="text-meta text-mute">{numero(m.items)} {m.items === 1 ? "ítem" : "ítems"}</span>
            </div>
          </div>
        </div>
      )}
    />
  );
}
