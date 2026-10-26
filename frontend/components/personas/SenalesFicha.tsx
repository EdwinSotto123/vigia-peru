import { Fragment } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { numero, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { peorSeveridad } from "@/lib/severidad";
import {
  FUENTE_CORTA,
  FUENTE_TEXTO,
  SENAL,
  aniosTexto,
  claveSenal,
  compararSenales,
  senalesDistintas,
  type EntidadDePersona,
  type SenalDistinta,
} from "@/lib/personas";
import { BotonEntidad, IndiceEntidades } from "./IndiceEntidades";
import { FilaSenal, FuenteSenal, ListaSenales, SenalBreve } from "./FilaSenal";
import { EvidenciaSenal, VerOrdenes, datoClaveSenal } from "./EvidenciaSenal";

/**
 * Las señales de una persona contratada, por entidad (pestaña Señales de /app/personas/<codigo>).
 *
 * - Lo grave primero: las entidades se ordenan por sus señales más graves y, dentro de cada una, cada señal va de la
 *   alta a la baja. Antes «Sobre la persona» (todo leve) iba primero y la primera grave quedaba a dos pantallas.
 * - Con varias entidades, maestro-detalle (`IndiceEntidades`): el índice elige UNA entidad y a la derecha va sólo esa;
 *   por defecto, la más grave. La elegida va a la URL (`?sent=<RUC>`).
 * - Cada señal es una fila (`FilaSenal`): severidad, qué registro coincide, el dato que la sostiene y la fuente; la
 *   evidencia, plegada. Lo que vale en varias entidades (un aporte, una candidatura) va en cada una con «También en…».
 * - Las cuentas son de señales distintas (`senalesDistintas`): el índice dice cuántas filas tiene cada entidad.
 *
 * Los nombres llegan tapados de la API salvo los de autoridades electas. Server-safe (el índice es un componente cliente
 * que recibe cada detalle ya armado).
 */
export function SenalesPorEntidad({ entidades, codigo, elegida }: { entidades: EntidadDePersona[]; codigo: string; elegida?: string }) {
  const { porClave } = senalesDistintas(entidades);
  const nombres = new Map(entidades.map((e) => [e.entidadRuc, nombreEntidad(e)]));
  const con = porGravedad(entidades.filter((e) => e.senalesDetalle.length > 0).map((e) => ({ e, senales: senalesDeEntidad(e, porClave) })));
  if (!con.length) return null;
  const sin = entidades.length - con.length;
  const pie = sin > 0 ? `Sin señales en ${plural(sin, "entidad más", "entidades más")}: están en la pestaña Entidades.` : undefined;
  if (con.length === 1) {
    return (
      <div className="space-y-2">
        <TarjetaEntidad e={con[0].e} senales={con[0].senales} nombres={nombres} codigo={codigo} />
        {pie && <p className="px-1 text-meta text-mute">{pie}</p>}
      </div>
    );
  }
  return (
    <IndiceEntidades
      titulo="Entidades con señales"
      inicial={elegida}
      pie={pie}
      entidades={con.map(({ e, senales }) => ({
        clave: e.entidadRuc,
        nombre: nombres.get(e.entidadRuc) ?? e.entidadRuc,
        severidad: peorSeveridad(senales.map((x) => x.senal)) ?? "baja",
        resumen: resumenEntidad(senales),
        contenido: <TarjetaEntidad e={e} senales={senales} nombres={nombres} codigo={codigo} />,
      }))}
    />
  );
}

/** Las señales de una entidad en una línea cada una, sin evidencia: el panel de la pestaña Entidades. */
export function SenalesBrevesEntidad({ entidad, entidades }: { entidad: EntidadDePersona; entidades: EntidadDePersona[] }) {
  const { porClave } = senalesDistintas(entidades);
  const senales = senalesDeEntidad(entidad, porClave);
  if (!senales.length) return <p className="text-dato text-inkSoft">Ningún otro registro coincide con esta persona en esta entidad.</p>;
  return (
    <ListaSenales etiqueta="Sus señales en esta entidad">
      {senales.map((x) => (
        <SenalBreve key={x.clave} severidad={x.senal.severidad} titulo={SENAL[x.senal.tipo]?.titulo ?? x.senal.tipo} dato={datoClaveSenal(x.senal)} />
      ))}
    </ListaSenales>
  );
}

const nombreEntidad = (e: { entidad: string | null; entidadRuc: string }) => (e.entidad ? tituloNatural(e.entidad) : `Entidad ${e.entidadRuc}`);

/** Las señales de UNA entidad, una vez cada una y con las demás entidades en que vale; lo grave primero. */
export function senalesDeEntidad(e: EntidadDePersona, porClave: Map<string, SenalDistinta>): SenalDistinta[] {
  const vistas = new Set<string>();
  const out: SenalDistinta[] = [];
  for (const s of e.senalesDetalle) {
    const k = claveSenal(s);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(porClave.get(k) ?? { clave: k, senal: s, en: [e.entidadRuc] });
  }
  return out.sort(compararSenales);
}

/** "3 señales, 1 alta": el mismo número de filas que muestra su detalle, con la palabra de la más grave. */
export function resumenEntidad(senales: SenalDistinta[]): string {
  const n = senales.length;
  const altas = senales.filter((x) => x.senal.severidad === "alta").length;
  const medias = senales.filter((x) => x.senal.severidad === "media").length;
  if (altas) return `${plural(n, "señal", "señales")}, ${plural(altas, "alta", "altas")}`;
  if (medias) return `${plural(n, "señal", "señales")}, ${plural(medias, "media", "medias")}`;
  return plural(n, "señal baja", "señales bajas");
}

/** De la entidad más grave a la más leve: más altas, más medias, más señales; si empatan, el orden de la API (monto). */
function porGravedad<T extends { senales: SenalDistinta[] }>(lista: T[]): T[] {
  const cuantas = (x: SenalDistinta[], sev: "alta" | "media") => x.filter((s) => s.senal.severidad === sev).length;
  return lista
    .map((x, i) => ({ x, i }))
    .sort(
      (a, b) =>
        cuantas(b.x.senales, "alta") - cuantas(a.x.senales, "alta") ||
        cuantas(b.x.senales, "media") - cuantas(a.x.senales, "media") ||
        b.x.senales.length - a.x.senales.length ||
        a.i - b.i,
    )
    .map(({ x }) => x);
}

/** Una entidad: su nombre, lo que le dio y quién la gobernaba, y sus señales en filas (sin cajas adentro). */
function TarjetaEntidad({ e, senales, nombres, codigo }: { e: EntidadDePersona; senales: SenalDistinta[]; nombres: Map<string, string>; codigo: string }) {
  const nombre = nombres.get(e.entidadRuc) ?? nombreEntidad(e);
  const anios = aniosTexto(e.anios);
  return (
    <section aria-label={`Señales en ${nombre}`} className="tarjeta rounded-2xl border border-line bg-paper px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3">
        <div className="min-w-0">
          <h3 className="font-display text-bloque font-bold leading-snug text-ink text-balance">
            <Link href={`/entidad/${e.entidadRuc}`} className="underline-offset-2 hover:text-granate hover:underline">
              {nombre}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
            <Dato tipo="documento" nombre="Órdenes">{`${plural(e.ordenes, "orden", "órdenes")} por ${soles(e.monto)}`}</Dato>
            {anios && (
              <Dato tipo="fecha" nombre="Años">
                {anios}
              </Dato>
            )}
            <Gobiernos e={e} />
          </p>
        </div>
        <VerOrdenes codigo={codigo} entidadRuc={e.entidadRuc}>
          {e.ordenes === 1 ? "Ver su orden" : `Ver sus ${numero(e.ordenes)} órdenes`}
        </VerOrdenes>
      </header>
      <ListaSenales etiqueta={`Señales en ${nombre}`} className="border-t border-line/70">
        {senales.map((x) => (
          <FilaDeSenal key={x.clave} x={x} entidadRuc={e.entidadRuc} nombres={nombres} codigo={codigo} />
        ))}
      </ListaSenales>
    </section>
  );
}

function FilaDeSenal({ x, entidadRuc, nombres, codigo }: { x: SenalDistinta; entidadRuc: string; nombres: Map<string, string>; codigo: string }) {
  const s = x.senal;
  const otras = x.en.filter((r) => r !== entidadRuc);
  return (
    <FilaSenal
      severidad={s.severidad}
      titulo={SENAL[s.tipo]?.titulo ?? s.tipo}
      dato={datoClaveSenal(s)}
      fuente={s.fuente ? FUENTE_CORTA[s.fuente] ?? FUENTE_TEXTO[s.fuente] ?? s.fuente : null}
      extra={
        otras.length > 0 ? (
          <Dato icono={Building2} nombre="Entidades">
            {`También en ${plural(otras.length, "entidad más", "entidades más")}`}
          </Dato>
        ) : null
      }
    >
      <p className="max-w-prose text-dato leading-relaxed text-inkSoft">{SENAL[s.tipo]?.explica}</p>
      {otras.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-meta text-mute">También vale en:</span>
          {otras.map((r) => (
            <BotonEntidad key={r} clave={r}>
              {nombres.get(r) ?? r}
            </BotonEntidad>
          ))}
        </div>
      )}
      <EvidenciaSenal s={s} codigo={codigo} entidadRuc={entidadRuc} />
      <FuenteSenal texto={(s.fuente && FUENTE_TEXTO[s.fuente]) || s.fuente || "Fuente oficial"} url={s.fuenteUrl} />
    </FilaSenal>
  );
}

/** Quién gobernaba la entidad cuando le dio las órdenes: enlaza a la ficha del partido en ese período. */
function Gobiernos({ e }: { e: EntidadDePersona }) {
  const g = [...(e.gobiernos ?? [])].sort((a, b) => b.anio - a.anio);
  if (!g.length) return null;
  return (
    <Dato tipo="partido" nombre="Partido que gobernaba">
      <span className="text-mute">Gobernaba </span>
      {g.map((x, i) => (
        <Fragment key={`${x.clave}-${x.anio}`}>
          {i > 0 && (i === g.length - 1 ? " y " : ", ")}
          <Link href={`/app/partidos/${x.clave}?anio=${x.anio}`} className="font-semibold text-ink underline-offset-2 hover:text-granate hover:underline">
            {x.nombre}
          </Link>
        </Fragment>
      ))}
    </Dato>
  );
}
