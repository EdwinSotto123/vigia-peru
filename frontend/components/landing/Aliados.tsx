import Link from "next/link";
import { ArrowUpRight, Heart, ShieldCheck } from "lucide-react";
import { AvatarAliado, datosIdentidad, esFundador } from "@/components/aliados/TarjetaAliado";
import { IdentidadAliado, Insignias, insigniasDe, mesesDesde } from "@/components/aliados/IdentidadAliado";
import { SelloMaqueta } from "@/components/aliados/AvisoMaqueta";
import { esSlugMaqueta, maquetaActiva, queryMaqueta, rankingMaqueta } from "@/lib/maqueta-aliados";
import { getEstadoGlobal, getRankingPaginado, type RankingRow } from "@/lib/financiamiento";
import { EscenaAliados } from "./EscenaAliados";
import { CalculadoraAporte, type ParteTarifa } from "./CalculadoraAporte";

/**
 * Quienes lo hacen posible.
 *
 * La lectura de cada contrato la paga alguien, y la portada tiene que hacer que
 * eso se vea: un escenario oscuro, un foco que se enciende sobre quien más
 * contratos financió, y lo que su aporte hizo posible, contado en cadena
 * (financiados, leídos, señales, regiones). Después, el podio y el muro.
 *
 * Tres reglas que no se negocian, porque son las del producto:
 *  - Se cuenta en CONTRATOS, nunca en soles. Ningún monto va al lado de ningún
 *    nombre: trescientos vecinos que financian trescientos contratos pesan lo
 *    mismo que una empresa que financia trescientos.
 *  - Ningún aliado inventado en producción. En desarrollo, la maqueta completa
 *    el podio para poder mirarlo, con su sello a la vista.
 *  - Con un solo aliado no hay podio que dibujar: el segundo lugar es una
 *    invitación, no una losa vacía que finja que hay alguien.
 */

/** Cuántos aliados caben en la portada: el foco, dos en el podio y el muro. */
const TOPE = 12;

const num = (n: number) => n.toLocaleString("es-PE");

/** "S/1 procesamiento · S/1 infraestructura y datos · …" → partes con monto. */
function partesDeTarifa(nota: string | null | undefined): ParteTarifa[] {
  if (!nota) return [];
  return nota
    .split(/\s*·\s*/)
    .map((p) => p.match(/^S\/\s?(\d+(?:[.,]\d+)?)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ monto: Number(m[1].replace(",", ".")), concepto: m[2] }));
}

export async function Aliados() {
  const maqueta = maquetaActiva(undefined);
  const [rankingRaw, estado] = await Promise.all([
    getRankingPaginado({ periodo: "todo", limit: TOPE }),
    getEstadoGlobal(),
  ]);

  const inventados = maqueta ? rankingMaqueta() : [];
  const filas = [...(rankingRaw?.data ?? []), ...inventados]
    .sort((a, b) => b.contratosFinanciados - a.contratosFinanciados)
    .slice(0, TOPE);
  const [foco, ...resto] = filas;
  const podio = resto.slice(0, 2);
  const muro = resto.slice(2);

  const precio = estado?.tarifa.precioPen ?? null;
  const partes = partesDeTarifa(estado?.tarifa.nota);

  return (
    <section id="aliados" aria-labelledby="aliados-titulo" className="relative scroll-mt-16 overflow-hidden bg-ink text-paper">
      <EscenaAliados>
        <div className="container-page relative max-w-[1400px] py-20 sm:py-24">
          <div className="max-w-3xl">
            <h2 id="aliados-titulo" className="text-balance font-serif text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              Cada contrato que Vigía lee, lo financia alguien.
            </h2>
            <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-paper/75">
              Personas, colectivos y empresas pagan la lectura. No eligen qué contratos se leen ni pueden cambiar
              lo que se encuentra. A cambio, su nombre queda acá, contado en contratos y nunca en soles.
            </p>
          </div>

          {/* ── El foco ── */}
          {foco ? (
            <Foco row={foco} regionesConCola={estado?.regionesConCola ?? 0} />
          ) : (
            <p className="mt-12 rounded-3xl border border-dashed border-paper/25 px-6 py-8 text-paper/75">
              No se pudo leer el registro de aportes ahora mismo. Es una falla de esta página, no un muro vacío:
              los aportes siguen registrados.
            </p>
          )}

          {/* ── El podio y el muro ── */}
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {podio.map((r, i) => (
              <Placa key={r.slug ?? r.id} row={r} puesto={i + 2} />
            ))}
            {podio.length < 2 && <LugarLibre anchoCompleto={podio.length === 0} />}
          </div>

          {muro.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2.5">
              {muro.map((r) => (
                <li key={r.slug ?? r.id} className="placa">
                  <EnlaceAliado row={r} className="flex items-center gap-2.5 rounded-full border border-paper/15 bg-paper/[0.05] py-1.5 pl-1.5 pr-4 text-[14px] transition-colors duration-rapido hover:bg-paper/10">
                    <AvatarAliado tipo={r.tipo} logoUrl={r.logoUrl} nombre={r.nombre} maqueta={esSlugMaqueta(r.slug)} />
                    <span className="font-medium">{r.nombre}</span>
                    <span className="font-mono text-paper/70">{num(r.contratosFinanciados)}</span>
                  </EnlaceAliado>
                </li>
              ))}
            </ul>
          )}

          {/* ── Cuánto cuesta y qué reglas protege ── */}
          <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-16">
            {precio != null && (
              <CalculadoraAporte
                precio={precio}
                partes={partes}
                enCola={estado?.colaGlobal ?? 0}
                regionesConCola={estado?.regionesConCola ?? 0}
              />
            )}

            <div>
              <h3 className="flex items-start gap-2.5 font-serif text-2xl font-bold">
                <ShieldCheck size={20} className="mt-1.5 shrink-0 text-heroGreen" aria-hidden />
                Financias la lectura, no el resultado.
              </h3>
              <ul className="mt-5 divide-y divide-paper/10 border-y border-paper/10">
                <Regla t="No eligen qué se lee.">
                  Los contratos se asignan por orden de llegada en la región que apoyan.
                </Regla>
                <Regla t="No cambian lo que se encuentra.">
                  El análisis no sabe quién lo financió: ese dato nunca le llega.
                </Regla>
                <Regla t="Si los encuentra a ellos, se publica igual.">
                  Y su comprobante lo muestra.
                </Regla>
              </ul>
              <Link
                href="/app/financiar#independencia"
                className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-heroGreen-soft underline-offset-4 hover:underline"
              >
                Todas las reglas de independencia <ArrowUpRight size={14} aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </EscenaAliados>
    </section>
  );
}

/** El primer lugar, bajo el foco. */
function Foco({ row, regionesConCola }: { row: RankingRow; regionesConCola: number }) {
  const maqueta = esSlugMaqueta(row.slug);
  const insignias = insigniasDe({
    esFundador: esFundador(row),
    financiados: row.contratosFinanciados,
    leidos: row.contratosProcesados,
    regiones: row.zonas,
    regionesConCola,
    mesesAportando: mesesDesde(row.desde),
  });
  const cadena = [
    { v: row.contratosFinanciados, t: row.contratosFinanciados === 1 ? "contrato financiado" : "contratos financiados" },
    { v: row.contratosProcesados, t: row.contratosProcesados === 1 ? "ya leído a fondo" : "ya leídos a fondo" },
    { v: row.senalesHalladas, t: row.senalesHalladas === 1 ? "señal encontrada" : "señales encontradas" },
    { v: row.zonas, t: row.zonas === 1 ? "región alcanzada" : "regiones alcanzadas" },
  ];

  return (
    <div className="foco relative mt-14">
      {/* La luz que se enciende detrás de la placa. Es sólo luz, no contenido:
          va por detrás y no toca el texto de arriba. */}
      <div
        aria-hidden
        className="foco-luz pointer-events-none absolute -inset-x-10 -inset-y-16 rounded-[4rem]"
        style={{
          background:
            "radial-gradient(ellipse 55% 60% at 30% 40%, rgba(79,61,150,0.55), transparent 70%), radial-gradient(ellipse 45% 55% at 80% 70%, rgba(47,168,76,0.22), transparent 70%)",
          filter: "blur(24px)",
        }}
      />

      <article className="relative rounded-[2rem] bg-paper p-6 text-ink shadow-dialog sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="foco-logo relative shrink-0 self-start">
            <span aria-hidden className="absolute -inset-3 rounded-[1.75rem] bg-heroGreen/15 blur-md" />
            <EnlaceAliado row={row} tabIndex={-1} ariaHidden className="relative block">
              <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="xl" maqueta={maqueta} />
            </EnlaceAliado>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-heroGreenTexto">Quien más contratos financió</p>
            <h3 className="foco-nombre mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-serif text-4xl font-bold leading-tight sm:text-5xl">
              <EnlaceAliado row={row} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50">
                {row.nombre}
              </EnlaceAliado>
              {maqueta && <SelloMaqueta className="shrink-0" />}
            </h3>
            <IdentidadAliado datos={datosIdentidad(row)} className="mt-2" />
            <Insignias insignias={insignias} limite={3} className="mt-3" />
          </div>
        </div>

        {/* Lo que el aporte hizo posible, en cadena: cada eslabón sale del
            anterior. Una línea con cuatro nodos que se dibuja con el scroll; las
            cifras cuentan hasta su valor cuando llega la línea. */}
        <div className="cadena relative mt-10 border-t border-line pt-9">
          <span aria-hidden className="absolute left-0 right-0 top-[2.55rem] hidden h-0.5 rounded-full bg-paperDeep sm:block" />
          <span aria-hidden className="cadena-linea absolute left-0 right-0 top-[2.55rem] hidden h-0.5 origin-left rounded-full bg-heroGreen sm:block" />
          <ol className="relative grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {cadena.map((c) => (
              <li key={c.t}>
                <span aria-hidden className="cadena-nodo block h-3.5 w-3.5 rounded-full border-[3px] border-paper bg-heroGreen shadow-[0_0_0_1px_rgba(47,168,76,0.4)]" />
                <span className="cadena-cifra mt-4 block font-mono text-4xl font-bold leading-none text-ink sm:text-5xl" data-valor={c.v}>
                  {num(c.v)}
                </span>
                <span className="mt-2 block text-[14px] leading-snug text-inkSoft">{c.t}</span>
              </li>
            ))}
          </ol>
        </div>
      </article>
    </div>
  );
}

/** Segundo y tercer lugar. */
function Placa({ row, puesto }: { row: RankingRow; puesto: number }) {
  const maqueta = esSlugMaqueta(row.slug);
  return (
    <article className="placa flex items-center gap-4 rounded-3xl border border-paper/15 bg-paper/[0.06] p-5">
      <EnlaceAliado row={row} tabIndex={-1} ariaHidden className="shrink-0">
        <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="lg" maqueta={maqueta} />
      </EnlaceAliado>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-paper/70">{puesto === 2 ? "Segundo lugar" : "Tercer lugar"}</p>
        <h3 className="flex flex-wrap items-center gap-2 font-serif text-xl font-bold leading-tight sm:text-2xl">
          <EnlaceAliado row={row} className="rounded hover:underline">
            {row.nombre}
          </EnlaceAliado>
          {maqueta && <SelloMaqueta className="shrink-0" />}
        </h3>
        <IdentidadAliado datos={datosIdentidad(row)} tam="sm" tono="oscuro" className="mt-1" />
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-3xl font-bold leading-none">{num(row.contratosFinanciados)}</div>
        <div className="mt-1 text-[12px] text-paper/70">contratos</div>
      </div>
    </article>
  );
}

/**
 * El lugar que falta. Con uno o dos nombres, decirlo es más honesto que
 * rellenar. Sin botón propio: el de financiar está en la calculadora, justo
 * abajo, y dos botones iguales en la misma sección es uno de más.
 */
function LugarLibre({ anchoCompleto }: { anchoCompleto: boolean }) {
  return (
    <div className={`placa flex items-center gap-4 rounded-3xl border border-dashed border-paper/30 p-5 ${anchoCompleto ? "md:col-span-2" : ""}`}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-paper/30">
        <Heart size={20} className="text-heroGreen" aria-hidden />
      </span>
      <p className="text-[15px] leading-relaxed text-paper/80">
        El próximo nombre en este muro puede ser el tuyo, el de tu colectivo o el de tu empresa.
      </p>
    </div>
  );
}

function Regla({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <li className="py-3.5">
      <span className="font-semibold text-paper">{t}</span>{" "}
      <span className="text-paper/70">{children}</span>
    </li>
  );
}

/** Enlace a la ficha del aliado, si tiene; si no, el contenido tal cual. */
function EnlaceAliado({
  row,
  className,
  tabIndex,
  ariaHidden,
  children,
}: {
  row: RankingRow;
  className?: string;
  tabIndex?: number;
  ariaHidden?: boolean;
  children: React.ReactNode;
}) {
  if (!row.slug) return <span className={className}>{children}</span>;
  const href = `/aliado/${row.slug}${esSlugMaqueta(row.slug) ? queryMaqueta(true) : ""}`;
  return (
    <Link href={href} className={className} tabIndex={tabIndex} aria-hidden={ariaHidden || undefined}>
      {children}
    </Link>
  );
}
