import Link from "next/link";
import { ArrowUpRight, Heart } from "lucide-react";
import { AvatarAliado, datosIdentidad } from "@/components/aliados/TarjetaAliado";
import { IdentidadAliado } from "@/components/aliados/IdentidadAliado";
import { SelloMaqueta } from "@/components/aliados/AvisoMaqueta";
import { esSlugMaqueta, maquetaActiva, queryMaqueta, rankingMaqueta } from "@/lib/maqueta-aliados";
import { getEstadoGlobal, getRankingPaginado, type RankingRow } from "@/lib/financiamiento";

/**
 * El muro de honor de la portada.
 *
 * Quien financia es la razón de que exista cada auditoría de este producto, y
 * en la portada aparecía como un logo de 40 px perdido entre texto de 11 px,
 * dentro de un panel blanco que pesaba menos que el botón de al lado. La
 * sección se titula "Gracias a ellos" y no se veía a nadie.
 *
 * Acá cada aliado tiene su renglón con su nombre en serif grande, su avatar
 * clickeable hacia su ficha y —lo único que el producto acepta como medida de
 * reconocimiento— sus contratos, con la barra a escala real contra el total del
 * muro. Nunca soles: trescientos vecinos que financian trescientos contratos
 * pesan exactamente lo mismo que una empresa que financia trescientos, y por
 * eso en este muro no hay ningún monto al lado de ningún nombre.
 *
 * Fondo violeta profundo: es una placa, no una tarjeta más de la página. Y el
 * último renglón es un lugar vacío que invita, porque con un solo aliado el
 * muro dice tanto por quién está como por quién falta — mejor decirlo que
 * disimularlo con relleno.
 *
 * Sin podio, sin medallas, sin puestos. El orden del libro mayor ya se ve;
 * ponerle un "1" al lado lo convierte en competencia, y acá nadie compite:
 * nadie elige qué se audita.
 */

/** Cuántos aliados entran en la placa de la portada. El resto vive en /app/aliados. */
const TOPE = 4;

const num = (n: number) => n.toLocaleString("es-PE");

export async function MuroHonor() {
  // La portada no lee `?maqueta=`: no recibe searchParams y volverla dinámica
  // por esto le costaría el ISR. `undefined` deja decidir al entorno — encendida
  // en desarrollo para poder mirar la placa con varios nombres, apagada en
  // producción, que es donde un dato inventado sería un problema de verdad.
  const maqueta = maquetaActiva(undefined);
  const [rankingRaw, estado] = await Promise.all([
    getRankingPaginado({ periodo: "todo", limit: TOPE }),
    getEstadoGlobal(),
  ]);

  // El API cayó: se dice, no se dibuja una placa vacía que parezca "no hay nadie".
  if (!rankingRaw) {
    return (
      <p className="rounded-3xl border border-dashed border-line px-5 py-6 text-sm leading-relaxed text-mute">
        No se pudo leer el registro de aportes ahora mismo. Es una falla de esta página, no un muro vacío:
        los aportes siguen registrados.
      </p>
    );
  }

  const inventados = maqueta ? rankingMaqueta().slice(0, TOPE) : [];
  const filas = [...(rankingRaw.data ?? []), ...inventados].slice(0, TOPE);
  const total = (rankingRaw.total ?? 0) + inventados.length;
  // Denominador de las barras: los contratos financiados por TODO el muro, no
  // la suma de estas cuatro filas — con más aliados esa suma mentiría por lo bajo.
  //
  // Las dos cifras del encabezado se calculan sobre el MISMO conjunto. Sumar los
  // aliados de maqueta al financiado y no al leído daba "247 financiados / 33 ya
  // leídos": un 13 % inventado por la mezcla, justo el tipo de cifra imposible de
  // auditar que este producto no puede publicar ni siquiera en desarrollo.
  const financiadosMuro =
    (estado?.contratosFinanciados ?? 0) + inventados.reduce((n, r) => n + r.contratosFinanciados, 0);
  const leidos =
    (estado?.contratosProcesados ?? 0) + inventados.reduce((n, r) => n + r.contratosProcesados, 0);

  return (
    <div className="overflow-hidden rounded-3xl bg-heroViolet-deep text-paper shadow-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-paper/12 px-5 py-4 sm:px-6">
        <h3 className="font-serif text-lg font-bold">
          {total === 1 ? "Un aliado sostiene la lectura hoy" : `${num(total)} aliados sostienen la lectura hoy`}
        </h3>
        <p className="flex flex-wrap items-baseline gap-x-4 text-[12px] text-paper/70">
          <span>
            <span className="font-mono font-semibold text-paper">{num(financiadosMuro)}</span> contratos
            financiados
          </span>
          {/* heroGreen-soft, no heroGreen: sobre violeta profundo el verde de
              marca da 4.34:1 a 12 px, justo bajo el mínimo AA. Mismo cambio que
              ya llevaban "Total mensual" y los títulos del pie. */}
          <span>
            <span className="font-mono font-semibold text-heroGreen-soft">{num(leidos)}</span> ya leídos
          </span>
        </p>
      </div>

      <ul className="divide-y divide-paper/10">
        {filas.map((r) => (
          <FilaHonor key={r.slug ?? r.id} row={r} financiadosMuro={financiadosMuro} />
        ))}
      </ul>

      {/* El lugar que falta. Con un solo nombre en el muro, decir "el próximo es
          tuyo" es más honesto —y más útil— que rellenar con losas vacantes. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-dashed border-paper/25 px-5 py-4 sm:px-6">
        <p className="flex items-center gap-2.5 text-[13px] text-paper/70">
          <Heart size={15} className="shrink-0 text-heroGreen" aria-hidden />
          El próximo nombre de este muro puede ser el tuyo, tu colectivo o tu empresa.
        </p>
        <Link
          href="/app/financiar"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-heroGreen px-4 py-2.5 text-[13px] font-semibold text-ink transition-transform duration-rapido hover:-translate-y-0.5"
        >
          Financiar una lectura
          <ArrowUpRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function FilaHonor({ row, financiadosMuro }: { row: RankingRow; financiadosMuro: number }) {
  const esMaqueta = !!row.slug && esSlugMaqueta(row.slug);
  const href = row.slug ? `/aliado/${row.slug}${esMaqueta ? queryMaqueta(true) : ""}` : undefined;
  const pct = financiadosMuro > 0 ? (row.contratosFinanciados / financiadosMuro) * 100 : 0;
  const leidos = row.contratosProcesados;

  return (
    <li className="px-5 py-4 sm:px-6">
      <div className="flex items-start gap-4">
        {href ? (
          // Duplicado deliberado del link del nombre: el avatar es la afordancia
          // que el ojo busca, pero un segundo tab-stop al mismo destino sólo hace
          // ruido en teclado y lector de pantalla.
          <Link href={href} tabIndex={-1} aria-hidden className="shrink-0">
            <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" maqueta={esMaqueta} />
          </Link>
        ) : (
          <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" maqueta={esMaqueta} />
        )}

        <div className="min-w-0 flex-1">
          <h4 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-serif text-xl font-bold leading-tight sm:text-2xl">
            {href ? (
              <Link
                href={href}
                className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen/60 focus-visible:ring-offset-2 focus-visible:ring-offset-heroViolet-deep"
              >
                {row.nombre}
              </Link>
            ) : (
              row.nombre
            )}
            {esMaqueta && <SelloMaqueta className="shrink-0" />}
          </h4>
          <IdentidadAliado datos={datosIdentidad(row)} tam="sm" tono="oscuro" className="mt-1.5" />
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-2xl font-bold leading-none sm:text-3xl">
            {num(row.contratosFinanciados)}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-paper/60">contratos</div>
        </div>
      </div>

      {/* La barra, a escala real contra todo el muro. Mide CUÁNTO DEL MURO es de
          este aliado, no cuánto de lo suyo se leyó — son dos proporciones
          distintas y la línea de abajo es la otra, así que la barra lo aclara en
          su `title` para que no se lean como la misma. */}
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper/12"
        title={`${num(row.contratosFinanciados)} de los ${num(financiadosMuro)} contratos financiados en todo el muro`}
      >
        <div className="h-full min-w-[3px] rounded-full bg-heroGreen" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[12px] text-paper/70">
        <span>
          <span className="font-mono font-semibold text-paper">{num(leidos)}</span> de{" "}
          <span className="font-mono">{num(row.contratosFinanciados)}</span> ya leídos
        </span>
        <span>
          <span className="font-mono font-semibold text-paper">{num(row.senalesHalladas)}</span> señales
          halladas
        </span>
        <span>
          <span className="font-mono font-semibold text-paper">{num(row.zonas)}</span>{" "}
          {row.zonas === 1 ? "región" : "regiones"}
        </span>
      </p>
    </li>
  );
}
