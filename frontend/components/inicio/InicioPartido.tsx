import { Suspense } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { Skeleton } from "@/components/ui/Skeleton";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  getConteosPartido,
  getGastoPartido,
  getSalientesPartido,
  periodoTexto,
  type AnioGobierno,
  type DetallePartido,
  type GastoPartido,
  type SalientesPartido,
} from "@/lib/partidosApi";
import { getCorrupcionPartido, rutaCorrupcion } from "@/lib/corrupcion";
import { PARAMS_EN_FICHA, getPersonas } from "@/lib/personas";
import { Banderas, BarrasMonto, BloqueInicio, LineasSinDato, RejillaInicio, SinRespuesta, SubseccionInicio } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { ContenidoPersonas } from "./ContenidoPersonas";
import { GastoInicio, motivoSinGasto } from "./GastoGobiernos";

/**
 * Inicio de un partido (/app/partidos/[clave], primera pestaña) en un período, con el orden de las demás fichas
 * (entidad, región): qué se encontró (las banderas de los contratos de sus gobiernos y de las personas que contrataron)
 * → dinero (en qué gastan según el MEF, en qué y dónde contrataron) → control (los informes de la Contraloría sobre las
 * entidades que gobernó) y, al final, lo que no tiene dato, en una línea cada uno.
 *
 * Antes abría con un bloque del MEF de ~2,650 px con dos tablas paginadas (ahora en la pestaña Gobiernos), tenía «En
 * números», que repetía la cabecera (gobiernos, entidades, proveedores, contratos), y «Personas» quedaba sola en su fila
 * (evaluación 2026-10-26). Las cifras de la cabecera no se repiten aquí.
 */
export async function InicioPartido({
  clave,
  anio,
  ruta,
  d,
  gasto: gastoP,
}: {
  clave: string;
  anio: AnioGobierno;
  ruta: string;
  d: DetallePartido;
  /** El mismo pedido que la pestaña Gobiernos (Next lo hace una sola vez). */
  gasto?: Promise<GastoPartido | null>;
}) {
  // Los conteos de sus contratos (lectura, riesgo, antecedentes) ya no van aquí: los pide su bloque, que llega solo
  // (ContratosPartido, con su Suspense). Antes, si ese pedido fallaba o tardaba, esperaba todo el Inicio.
  const [corrupcion, gasto, personas, salientes] = await Promise.all([
    getCorrupcionPartido(clave, anio),
    gastoP ?? getGastoPartido(clave, anio),
    getPersonas({ partido: clave, periodo: anio, size: 0 }),
    getSalientesPartido(clave, anio),
  ]);
  const procesos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "procesos", ...f })}`;
  const enPersonas = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "personas", ...f })}`;
  const h = d.historia;
  const p = personas?.resumen ?? null;
  const conPersonas = !!p && p.filas > 0;
  const conPlazas = !!salientes && salientes.total.plazas > 0;
  const porObjeto = h?.porObjeto ?? [];
  const porRegion = regiones(d);
  const hayGasto = !!gasto?.disponible && !!gasto.totales;

  const sinDato: { titulo: string; motivo: string }[] = [];
  const sinGasto = motivoSinGasto(gasto);
  if (sinGasto) sinDato.push({ titulo: "En qué gastan sus gobiernos", motivo: sinGasto });
  if (!porObjeto.length) sinDato.push({ titulo: "En qué y dónde contrataron", motivo: "Sin contratos adjudicados registrados en este período." });
  if (!p) sinDato.push({ titulo: "Personas contratadas", motivo: "Sin dato: el servicio de personas no respondió." });
  else if (!p.filas) sinDato.push({ titulo: "Personas contratadas", motivo: "Sus gobiernos no registran órdenes de servicio a personas en este período." });

  return (
    <div className="space-y-10">
      <SubseccionInicio
        titulo="Qué se encontró"
        descripcion="Cruces de datos públicos en los contratos de sus gobiernos y en quienes contrataron: indicios para revisar, no acusaciones."
        ayuda={
          <Ayuda titulo="¿Qué es una bandera?">
            <span className="block">
              El riesgo que encontró Vigía al leer un contrato y lo que otros registros públicos dicen de quien lo ganó (o de
              quien recibió una orden). Sólo cuentan los contratos que también están en la base de Vigía (más o menos la mitad).
            </span>
            <span className="mt-2 block">Son motivos para revisar, no prueban una irregularidad ni acusan al partido. Cada fila abre esa lista ya filtrada.</span>
          </Ayuda>
        }
      >
        {/* Lado a lado desde lg, cada uno de su alto (antes, uno debajo del otro a 1,030 px, con la etiqueta a 900 px de su
            número). Las plazas, si son el tercero, a lo ancho y con sus entidades en dos columnas: solas en media fila
            dejaban la otra mitad vacía. */}
        <RejillaInicio className="items-start">
          <Suspense fallback={<EsperaContratos enlace={procesos({ cruces: "con" })} />}>
            <ContratosPartido clave={clave} anio={anio} procesos={procesos} reintentar={`${ruta}?anio=${anio}`} />
          </Suspense>
          {p && conPersonas && (
            <BloqueInicio
              nivel={3}
              titulo="En las personas que contrataron"
              ayuda={
                <Ayuda titulo="¿Quiénes son?">
                  Las personas a las que sus gobiernos pagaron por órdenes de servicio (locadores, asesores, choferes…), según el
                  OECE. Las señales dicen qué otro registro público coincide con cada una: candidaturas y aportes al partido que
                  gobierna, autoridades, apellidos de autoridades y funcionarios. No prueban nada.
                </Ayuda>
              }
              enlace={{ href: enPersonas(), texto: "Ver a las personas" }}
            >
              <ContenidoPersonas r={p} P={PARAMS_EN_FICHA} href={enPersonas} />
            </BloqueInicio>
          )}
          {salientes && conPlazas && <PlazasSalientes s={salientes} ancho={conPersonas} />}
        </RejillaInicio>
      </SubseccionInicio>

      {(hayGasto || porObjeto.length > 0) && (
        <SubseccionInicio titulo="Dinero" descripcion={`En qué gastan sus gobiernos según el MEF y qué contrataron en ${periodoTexto(anio)}.`}>
          {/* El gasto, a lo alto de las dos filas: al lado, en qué y dónde contrataron (ninguno queda solo en su fila). */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <GastoInicio gasto={gasto} ruta={ruta} anio={anio} className="lg:row-span-2" />
            {porObjeto.length > 0 && (
              <BloqueInicio
                nivel={3}
                titulo="En qué contrataron"
                ayuda={
                  <Ayuda titulo="¿De dónde sale?">
                    De lo adjudicado por las entidades que gobernó en {periodoTexto(anio)} (OECE), por objeto. Cada barra abre esos
                    contratos.
                  </Ayuda>
                }
                enlace={{ href: procesos(), texto: "Ver los contratos" }}
              >
                <BarrasMonto
                  items={porObjeto.map((o) => ({ nombre: o.objeto, monto: o.montoAdjudicadoPen, detalle: plural(o.procesos, "contrato", "contratos"), href: procesos({ objeto: o.objeto }) }))}
                />
              </BloqueInicio>
            )}
            {porRegion.length > 0 && (
              <BloqueInicio nivel={3} titulo="Dónde contrataron" enlace={{ href: `${ruta}?anio=${anio}&seccion=gobiernos`, texto: "Ver sus gobiernos" }}>
                <BarrasMonto
                  items={porRegion.map((r) => ({ nombre: r.nombre, monto: r.monto, detalle: plural(r.procesos, "contrato", "contratos"), href: procesos({ region: r.ubigeo }) }))}
                />
              </BloqueInicio>
            )}
          </div>
        </SubseccionInicio>
      )}

      {/* Control: los informes de la Contraloría sobre sus entidades (no hay cifras de la Procuraduría por partido). */}
      <CasosCorrupcion
        datos={corrupcion}
        ruta={rutaCorrupcion.partido(clave, anio)}
        ambito="partido"
        nota={`Informes sobre las entidades que gobernó, emitidos de ${periodoTexto(anio)}. No dicen que la responsabilidad sea de sus autoridades: cada informe nombra a los funcionarios comprendidos, de carrera o de confianza.`}
      />

      <LineasSinDato items={sinDato} />
    </div>
  );
}

/**
 * «En sus contratos»: las banderas de los procesos de sus gobiernos que están en la base de Vigía, en su propio
 * `Suspense`: el resto del Inicio no lo espera. Con tiempo límite y un reintento (getConteosPartido); si aun así no
 * responde, «no respondió ahora» con «Reintentar» (la misma página), no un «Sin dato» que parece definitivo: en una
 * captura salía y en otra no (auditoría del 2026-11-05).
 */
async function ContratosPartido({
  clave,
  anio,
  procesos,
  reintentar,
}: {
  clave: string;
  anio: AnioGobierno;
  procesos: (f?: Record<string, string>) => string;
  /** La URL del Inicio de este período, para «Reintentar». */
  reintentar: string;
}) {
  const r = await getConteosPartido(clave, anio);
  const f = r?.facetas ?? null;
  const l: Record<string, number> = f?.porLectura ?? {};
  const leidos = (l.publicado ?? 0) + (l.revision ?? 0);
  // Cuántos de sus procesos están en la base de Vigía (los únicos que se leen y se cruzan): la suma de «¿Lo leyó Vigía?».
  // Es el total de los antecedentes y de sus barras, no los procesos de CONOSCE (más o menos el doble).
  const enBase = Object.values(l).reduce((s, n) => s + (n ?? 0), 0);
  return (
    <BloqueInicio nivel={3} titulo="En sus contratos" enlace={{ href: procesos({ cruces: "con" }), texto: "Ver los que tienen antecedentes" }}>
      {f ? (
        <Banderas
          porRiesgo={f.porRiesgo}
          porCruces={f.porCruces}
          porLectura={l}
          total={enBase}
          unidad={["contrato en la base de Vigía", "contratos en la base de Vigía"]}
          href={procesos}
          conRiesgo={leidos > 0}
        />
      ) : (
        <SinRespuesta href={reintentar}>El servicio de contratos no respondió ahora.</SinRespuesta>
      )}
    </BloqueInicio>
  );
}

/** Mientras llegan los conteos: el bloque con su título y la forma de lo que viene (nunca un «Sin dato» provisional). */
function EsperaContratos({ enlace }: { enlace: string }) {
  return (
    <BloqueInicio nivel={3} titulo="En sus contratos" enlace={{ href: enlace, texto: "Ver los que tienen antecedentes" }}>
      <span className="sr-only">Contando las banderas de sus contratos…</span>
      <div className="space-y-3 px-3.5" aria-hidden>
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="mt-5 h-36 rounded-xl" />
      </div>
    </BloqueInicio>
  );
}

/** Procesos y monto por región, de sus gobiernos (la ficha trae cada gobierno con su ubigeo). */
function regiones(d: DetallePartido): { ubigeo: string; nombre: string; procesos: number; monto: number }[] {
  const m = new Map<string, { ubigeo: string; nombre: string; procesos: number; monto: number }>();
  for (const x of d.gobiernos ?? []) {
    const u = x.ubigeo.slice(0, 2);
    const r = m.get(u) ?? { ubigeo: u, nombre: x.region ?? u, procesos: 0, monto: 0 };
    r.procesos += x.procesos;
    r.monto += x.montoAdjudicadoPen;
    m.set(u, r);
  }
  return [...m.values()].filter((r) => r.monto > 0);
}

/**
 * Las plazas CAS que sus gobiernos convocaron después de las elecciones regionales y municipales y antes de entregar el
 * cargo (migración 183): quien entre seguirá con la gestión nueva. Las cifras en una franja (antes, una frase con
 * cuatro números adentro) y TODAS sus entidades, las que más convocaron primero: cinco a la vista y las demás en «Ver
 * las otras N» (antes, «y 7 entidades más» en texto, sin manera de verlas). Cada entidad, en verde (se toca: pedido del
 * usuario del 2026-11-05), abre sus plazas con esa señal. `ancho`: a lo ancho de la rejilla, con las entidades en dos
 * columnas.
 */
function PlazasSalientes({ s, ancho = false }: { s: SalientesPartido; ancho?: boolean }) {
  const t = s.total;
  // recorte: cinco a la vista; las demás (todas las que trae la API) en «Ver las otras N», debajo
  const primeras = s.entidades.slice(0, 5);
  const resto = s.entidades.slice(5);
  const fila = (e: SalientesPartido["entidades"][number]) => (
    // Un borde arriba de cada una (no `divide-y`): en dos columnas, las dos filas de arriba llevan el mismo.
    <li key={e.entidadRuc} className="border-t border-line/70">
      <Link
        href={`/entidad/${e.entidadRuc}?seccion=plazas&zsenal=gestion_saliente`}
        prefetch={false}
        className="group/entidad flex min-h-11 items-center justify-between gap-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        <span className="min-w-0 truncate text-dato font-medium text-granate underline-offset-2 group-hover/entidad:underline" title={tituloNatural(e.entidad)}>
          {tituloNatural(e.entidad)}
        </span>
        <span className="shrink-0 text-meta text-mute">
          <span className="font-mono font-semibold tabular-nums text-ink">{numero(e.plazas)}</span> {e.plazas === 1 ? "plaza" : "plazas"}
        </span>
      </Link>
    </li>
  );
  return (
    <BloqueInicio
      nivel={3}
      titulo="Plazas de sus gestiones salientes"
      ancho={ancho}
      ayuda={
        <Ayuda titulo="¿Qué son?">
          Plazas CAS que publicaron en SERVIR las entidades que gobierna, después de las elecciones regionales y municipales y
          antes de entregar el cargo. No es una falta: quien entre seguirá con la gestión nueva, y vale revisar las que piden
          experiencia en la propia entidad o ya tienen locadores haciendo ese trabajo.
        </Ayuda>
      }
    >
      <CifrasEnFila
        items={[
          { valor: numero(t.plazas), etiqueta: t.plazas === 1 ? "plaza" : "plazas", contexto: `con ${plural(t.vacantes, "vacante", "vacantes")}` },
          { valor: solesCompacto(t.alMes), etiqueta: "al mes en sueldos" },
          ...(t.aLaMedida
            ? [{ valor: numero(t.aLaMedida), etiqueta: t.aLaMedida === 1 ? "pide experiencia en la propia entidad o ya tiene locadores" : "piden experiencia en la propia entidad o ya tienen locadores" }]
            : []),
        ]}
      />
      <div className="mt-4 [container-type:inline-size]">
        <p className="pb-1 text-rotulo font-semibold text-mute">
          {s.entidades.length === 1 ? "En una entidad" : `En ${numero(s.entidades.length)} entidades, de más a menos plazas`}
        </p>
        <ul className="grid gap-x-8 [@container(min-width:40rem)]:grid-cols-2">{primeras.map(fila)}</ul>
        {resto.length > 0 && (
          <details className="group/resto mt-1">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-granate hover:underline [&::-webkit-details-marker]:hidden">
              <span className="group-open/resto:hidden">{resto.length === 1 ? "Ver la otra entidad" : `Ver las otras ${numero(resto.length)} entidades`}</span>
              <span className="hidden group-open/resto:inline">Ver menos</span>
              <ChevronDown size={14} className="shrink-0 transition-transform group-open/resto:rotate-180" aria-hidden />
            </summary>
            {/* Hasta 200 entidades: con su propio scroll pasadas las ~7 filas, para no estirar el Inicio. */}
            <ul className="grid max-h-80 gap-x-8 overflow-y-auto overscroll-contain [@container(min-width:40rem)]:grid-cols-2" aria-label="Las otras entidades">
              {resto.map(fila)}
            </ul>
          </details>
        )}
      </div>
    </BloqueInicio>
  );
}
