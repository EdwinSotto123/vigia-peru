import Link from "next/link";
import { limpiar, nombreRegion } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { aParams, cambiar, type FiltrosBandeja } from "@/lib/licitaciones-app/filtros";
import { fechaCortaLima, haceDias } from "@/lib/licitaciones-app/formato";
import type { Oportunidad } from "@/lib/licitaciones-app/tipos";
import { solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { EstrellaSeguir } from "../seguimiento/BotonSeguir";
import { IconoSenal, InsigniaTipo, InsigniaVence } from "@/components/gobserva/ui/Insignia";
import { TablaDatos, type Columna } from "@/components/gobserva/ui/TablaDatos";

/**
 * La bandeja como tabla (desde md) o tarjetas (celular). Cada proceso enlaza a su detalle y le pasa la búsqueda de
 * ahora («volver»), para que «Bandeja» en el detalle regrese a la misma página con los mismos filtros.
 */
export function TablaBandeja({ filas, filtros, base, ahora }: { filas: Oportunidad[]; filtros: FiltrosBandeja; base: string; ahora: number }) {
  const volver = aParams(filtros).toString();
  const detalle = (o: Oportunidad) => rutaEn(base, `/app/oportunidad/${encodeURIComponent(o.id)}${volver ? `?volver=${encodeURIComponent(volver)}` : ""}`);
  const lista = (orden: FiltrosBandeja["orden"]) => {
    const qs = aParams(cambiar(filtros, { orden })).toString();
    return rutaEn(base, `/app/bandeja${qs ? `?${qs}` : ""}`);
  };
  const ordenValor = filtros.orden === "valor_desc" ? "valor_asc" : "valor_desc";

  const columnas: Columna<Oportunidad>[] = [
    {
      clave: "seguir",
      titulo: <span className="sr-only">Seguir</span>,
      className: "w-12 pr-0",
      celda: (o) => <EstrellaSeguir id={o.id} codigo={o.codigo} titulo={limpiar(o.objeto)} />,
    },
    {
      clave: "proceso",
      titulo: "Proceso",
      className: "min-w-[14rem] xl:min-w-[16rem] 2xl:min-w-[18rem]",
      celda: (o) => (
        <div className="min-w-0 max-w-[44rem]">
          <Link href={detalle(o)} className="line-clamp-2 text-dato font-semibold leading-snug text-ink underline-offset-4 hover:text-granate hover:underline">
            {limpiar(o.objeto) || "Sin descripción registrada"}
          </Link>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-mute">
            <span className="font-mono">{o.codigo ?? o.id}</span>
            <span>{o.procedimiento ?? "Procedimiento sin dato"}</span>
          </p>
          {/* La entidad va aquí hasta xl y las señales hasta lg (sus columnas aparecen después). line-clamp y no truncate:
              en una tabla, un texto sin cortes fija el ancho mínimo de la columna. */}
          <p className="mt-0.5 line-clamp-1 text-meta text-inkSoft xl:hidden">
            {o.entidad.nombre ? tituloNatural(o.entidad.nombre) : "Entidad sin nombre"}, {nombreRegion(o.region)}
          </p>
          {o.senales.length > 0 && (
            <div className="mt-1.5 lg:hidden">
              <Senales o={o} />
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "entidad",
      titulo: "Entidad",
      desde: "xl",
      className: "w-[11rem] xl:w-[13rem] 2xl:w-[15rem]",
      orden: { href: lista("entidad"), activa: filtros.orden === "entidad", dir: "asc", etiqueta: "entidad" },
      celda: (o) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-dato text-ink">{o.entidad.nombre ? tituloNatural(o.entidad.nombre) : "Sin nombre"}</p>
          <p className="mt-0.5 text-meta text-mute">{nombreRegion(o.region)}</p>
        </div>
      ),
    },
    { clave: "tipo", titulo: "Tipo", desde: "2xl", className: "w-28", celda: (o) => <InsigniaTipo tipo={o.tipo} /> },
    {
      clave: "valor",
      titulo: "Valor ref.",
      alinear: "derecha",
      className: "w-32",
      orden: {
        href: lista(ordenValor),
        activa: filtros.orden === "valor_desc" || filtros.orden === "valor_asc",
        dir: filtros.orden === "valor_asc" ? "asc" : "desc",
        etiqueta: "valor",
      },
      celda: (o) =>
        o.valor != null ? (
          <span className="whitespace-nowrap font-semibold tabular-nums text-ink">{solesCompacto(o.valor)}</span>
        ) : (
          <span className="text-meta text-mute">Sin publicar</span>
        ),
    },
    {
      clave: "publicado",
      titulo: "Publicado",
      desde: "2xl",
      className: "w-28",
      orden: { href: lista("recientes"), activa: filtros.orden === "recientes", dir: "desc", etiqueta: "fecha de publicación" },
      celda: (o) => (
        <span className="whitespace-nowrap text-meta text-inkSoft" title={fechaCortaLima(o.publicada)}>
          {haceDias(o.publicada, ahora)}
        </span>
      ),
    },
    {
      clave: "consultas",
      titulo: "Consultas",
      className: "w-36",
      orden: { href: lista("vence"), activa: filtros.orden === "vence", dir: "asc", etiqueta: "vencimiento de consultas" },
      celda: (o) => <InsigniaVence iso={o.consultasHasta} ahora={ahora} />,
    },
    {
      clave: "senales",
      titulo: "Señales",
      desde: "lg",
      className: "w-28 whitespace-nowrap",
      celda: (o) => <Senales o={o} />,
    },
  ];

  return (
    <TablaDatos
      titulo="Oportunidades de la bandeja"
      filas={filas}
      columnas={columnas}
      claveFila={(o) => o.id}
      tarjeta={(o) => (
        <div className="flex gap-2 px-3 py-3.5">
          <EstrellaSeguir id={o.id} codigo={o.codigo} titulo={limpiar(o.objeto)} />
          <div className="min-w-0 flex-1">
            <Link href={detalle(o)} className="line-clamp-3 text-dato font-semibold leading-snug text-ink">
              {limpiar(o.objeto) || "Sin descripción registrada"}
            </Link>
            <p className="mt-1 truncate text-meta text-inkSoft">
              {o.entidad.nombre ? tituloNatural(o.entidad.nombre) : "Entidad sin nombre"}, {nombreRegion(o.region)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-dato font-semibold tabular-nums text-ink">{o.valor != null ? solesCompacto(o.valor) : <span className="text-meta font-normal text-mute">Sin valor publicado</span>}</span>
              <InsigniaVence iso={o.consultasHasta} ahora={ahora} />
              <Senales o={o} />
            </div>
          </div>
        </div>
      )}
    />
  );
}

function Senales({ o }: { o: Oportunidad }) {
  if (!o.senales.length) return <span className="text-meta text-mute">Ninguna</span>;
  return (
    <span className="flex gap-1">
      {/* recorte: tres íconos por fila; todas, con su evidencia, en la pestaña Análisis del detalle. */}
      {o.senales.slice(0, 3).map((s) => <IconoSenal key={s.clave} senal={s} />)}
      {o.senales.length > 3 && <span className="text-meta font-semibold text-inkSoft">+{o.senales.length - 3}</span>}
    </span>
  );
}
