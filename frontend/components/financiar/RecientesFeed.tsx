import Link from "next/link";
import { EstadoVacio } from "@/components/patrones";
import { numero, plural, relativo } from "@/lib/formato";
import { mensajePublicoVisible, type ContribucionReciente } from "@/lib/financiamiento";
import { hrefPerfil } from "@/components/aliados/ranking";
import { Avatar } from "./RankingTable";
import { NombreEntidad } from "./NombreEntidad";
import type { AportesAgrupados } from "./aportesAgrupados";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Dato } from "@/components/ui/Dato";

/** «hace 3 h», «ayer», «el 12 oct.»: cuándo fue, como se dice en una frase. */
function cuando(iso: string): string {
  const r = relativo(iso);
  return /^(hace|ayer)/.test(r) ? r : `el ${r}`;
}

/** Dónde fue un aporte, en palabras: «de los gobiernos de …», «de <entidad>», «en <zona>». */
function dondeFue(c: ContribucionReciente) {
  if (c.partido) return <>de los gobiernos de {c.partido.nombre}</>;
  if (c.entidad) return <>de <NombreEntidad ruc={c.entidad.ruc} nombre={c.entidad.nombre} /></>;
  return <>en {c.zona}</>;
}

/** El destino sugerido de un apoyo (sólo informativo: el aporte va al fondo común). */
function motivo(c: ContribucionReciente) {
  if (c.paraRuc && c.paraEntidad) return <NombreEntidad ruc={c.paraRuc} nombre={c.paraEntidad} />;
  if (c.paraZona) return <>{c.paraZona}</>;
  return null;
}

/**
 * Qué fue un aporte, en una frase: un apoyo al fondo común (migración 206; único o de cada mes, con su destino
 * sugerido si lo tuvo) o, del modelo anterior, cuántos contratos financió y dónde. Nunca soles.
 */
function queFue(c: ContribucionReciente) {
  if (c.tipoAporte === "apoyo") {
    const m = motivo(c);
    return (
      <>
        {c.periodicidad === "mensual" ? "aporte de cada mes" : "aporte"} al fondo común{m && <>, con destino sugerido {m}</>}
      </>
    );
  }
  return (
    <>
      <span className="font-mono tabular-nums">{numero(c.contratos)}</span> {c.contratos === 1 ? "contrato" : "contratos"} {dondeFue(c)}
    </>
  );
}

/** Cuántos grupos se muestran; el resto, en el muro de aliados. */
const GRUPOS_VISIBLES = 4;

/**
 * Los últimos aportes agrupados por quien los hizo: una línea por aliado («16 aportes, 320 contratos financiados, el
 * último el 12 oct.»; los contratos, sólo si los hubo con el modelo anterior) y debajo los tres más recientes, cada uno
 * con su constancia. Todos, con buscador, en «Todos los aportes». Una superficie con divisores, sin cajas adentro.
 * Server-safe.
 */
export function AportesPorAliado({ datos }: { datos: AportesAgrupados }) {
  if (datos.grupos.length === 0) return <RecientesFeed items={[]} />;
  // recorte: los aliados que aportaron más recientemente; todos, con su puesto, en el muro de aliados (enlace de abajo)
  const visibles = datos.grupos.slice(0, GRUPOS_VISIBLES);
  const varios = datos.grupos.length > 1;
  return (
    <div className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <ul className="divide-y divide-line" aria-label="Aportes por aliado">
        {visibles.map((g) => {
          const perfil = hrefPerfil(g.slug);
          return (
            <li key={g.clave} className="flex items-center gap-3 px-4 py-3">
              <Avatar tipo={g.tipo} logoUrl={g.logoUrl} nombre={g.financiador} />
              <div className="min-w-0 flex-1 text-dato leading-5">
                <p className="truncate font-semibold text-ink">
                  {perfil ? (
                    <Link href={perfil} className="underline-offset-2 hover:text-granate hover:underline">
                      {g.financiador}
                    </Link>
                  ) : (
                    g.financiador
                  )}
                </p>
                <p className="text-meta text-inkSoft">
                  {plural(g.aportes, "aporte", "aportes")}
                  {g.contratos > 0 && <>, {plural(g.contratos, "contrato financiado", "contratos financiados")}</>}, el último {cuando(g.ultimo)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {(datos.grupos.length > visibles.length || !datos.completo) && (
        <p className="border-t border-line px-4 py-2.5 text-meta text-mute">
          {datos.grupos.length > visibles.length && (
            <>
              Y {plural(datos.grupos.length - visibles.length, "aliado más", "aliados más")} en el{" "}
              <Link href="/app/aliados" className="font-semibold text-granate underline-offset-2 hover:underline">muro de aliados</Link>.{" "}
            </>
          )}
          {!datos.completo && <>Se cuentan los últimos {numero(datos.contados)} de {numero(datos.total)} aportes.</>}
        </p>
      )}
      <div className="border-t border-line px-4 pb-1 pt-3">
        <h3 className="text-cuerpo font-semibold text-ink">Los {numero(datos.ultimos.length)} más recientes</h3>
        <ul className="divide-y divide-line">
          {datos.ultimos.map((c) => (
            <li key={c.codigo} className="py-2.5 text-dato leading-5">
              <p className="text-ink">
                {varios && <span className="font-semibold">{c.financiador}: </span>}
                {queFue(c)}
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-rotulo text-mute">
                <Dato tipo="fecha" nombre="Confirmado">{relativo(c.pagadaAt)}</Dato>
                <Link href={`/impacto/${c.codigo}`} className="underline-offset-2 hover:text-ink hover:underline">
                  <Dato tipo="codigo" nombre="Constancia" mono>{c.codigo}</Dato>
                </Link>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Los últimos aportes confirmados, nunca en soles, cada uno con su constancia pública. Un apoyo al fondo común dice si
 * es de cada mes y su destino sugerido; uno del modelo anterior (S/ 3 por contrato), cuántos contratos financió y
 * dónde, con enlace a esa cola.
 */
export function RecientesFeed({ items, enColumnas = false }: {
  items: ContribucionReciente[];
  /** A todo el ancho de la página: dos columnas en pantallas anchas, para que cada aporte no se estire en una fila rala. */
  enColumnas?: boolean;
}) {
  if (!items.length) {
    return (
      <EstadoVacio
        compacto
        titulo="Todavía no hay aportes confirmados"
        accion={
          <EnlaceAccion variante="secundario" href="/app/apoyar">
            Aportar
          </EnlaceAccion>
        }
      >
        Cuando se confirme el primero, aparece acá con su constancia pública.
      </EstadoVacio>
    );
  }
  return (
    <ul className={enColumnas ? "grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-2" : "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper"}>
      {items.map((c) => {
        const mensaje = mensajePublicoVisible(c.mensajePublico, c.pasarela);
        return (
          <li key={c.codigo} className={enColumnas ? "flex items-start gap-3 bg-paper px-4 py-3" : "flex items-start gap-3 px-4 py-3"}>
            <Avatar tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} />
            <div className="min-w-0 flex-1 text-dato leading-5">
              <p className="text-ink">
                <span className="font-semibold">{c.financiador}</span>{" "}
                {c.tipoAporte === "apoyo" ? (
                  queFue(c)
                ) : (
                  <>
                    financió la lectura de <span className="font-mono tabular-nums">{numero(c.contratos)}</span>{" "}
                    {c.contratos === 1 ? "contrato" : "contratos"}{" "}
                  </>
                )}
                {c.tipoAporte === "apoyo" ? null : c.partido ? (
                  <>
                    de los gobiernos de{" "}
                    <Link href={`/app/financiar/partido/${c.partido.clave}?anio=${c.partido.anio}`} className="font-semibold text-granate underline-offset-2 hover:underline">
                      {c.partido.nombre}
                    </Link>
                  </>
                ) : c.entidad ? (
                  <>
                    de{" "}
                    <Link href={`/app/financiar/entidad/${c.entidad.ruc}`} className="font-semibold text-granate underline-offset-2 hover:underline">
                      <NombreEntidad ruc={c.entidad.ruc} nombre={c.entidad.nombre} />
                    </Link>
                  </>
                ) : (
                  <>
                    en{" "}
                    <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold text-granate underline-offset-2 hover:underline">{c.zona}</Link>
                  </>
                )}
              </p>
              {mensaje && <p className="mt-0.5 line-clamp-2 text-meta italic text-inkSoft" title={mensaje}>“{mensaje}”</p>}
              <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-rotulo text-mute">
                <Dato tipo="fecha" nombre="Confirmado">{relativo(c.pagadaAt)}</Dato>
                <Link href={`/impacto/${c.codigo}`} className="underline-offset-2 hover:text-ink hover:underline">
                  <Dato tipo="codigo" nombre="Constancia" mono>{c.codigo}</Dato>
                </Link>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
