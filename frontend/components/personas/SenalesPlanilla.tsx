import Link from "next/link";
import { AyudaTermino, DatosClave, type DatoClave } from "@/components/patrones";
import { CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { fechaCorta, numero, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPartido } from "@/lib/partidos";
import { RANGO_SEVERIDAD } from "@/lib/severidad";
import { GRADO_PARIENTE, type Severidad } from "@/lib/personas";
import {
  SENAL_PLANILLA,
  cargoEnOracion,
  fuentePlanilla,
  listaMeses,
  mes,
  nombrePartido,
  type ParienteProveedor,
  type SenalConDetalle,
  type TipoPlanilla,
} from "@/lib/planilla";
import { FilaSenal, FuenteSenal, ListaSenales, SenalBreve } from "./FilaSenal";
import { OrdenesCitadas } from "./EvidenciaSenal";

/**
 * Las señales de una persona de la planilla, cada una en su fila (`FilaSenal`: severidad, qué registro coincide, el
 * dato que la sostiene y la fuente) con la evidencia plegada: tablas y pares rótulo/valor, nunca datos pegados con
 * comas. Lo grave primero. El nepotismo del lado del funcionario (los parientes que declaró en su DJI y que le venden a
 * su entidad) es una señal más de la lista, con las órdenes de cada pariente como evidencia: antes era un cartel ámbar
 * aparte, encima de las pestañas. La usan la ficha de planilla (/app/personas/planilla/<codigo>) y el panel de la
 * lista (sin nepotismo: la lista no lo trae). Server-safe.
 */
export function SenalesPlanillaLista({
  senales,
  nepotismo,
  entidad,
}: {
  senales: SenalConDetalle<TipoPlanilla>[];
  /** Los parientes que declaró y que le venden a su entidad (la ficha los trae aparte de `senales`). */
  nepotismo?: ParienteProveedor[];
  /** El nombre de su entidad, para la explicación del nepotismo. */
  entidad?: string;
}) {
  const filas = [
    ...(nepotismo?.length ? [{ severidad: "alta" as Severidad, clave: "nepotismo", nodo: <FilaNepotismo key="nepotismo" parientes={nepotismo} entidad={entidad} /> }] : []),
    ...senales.map((s) => ({ severidad: s.severidad, clave: s.tipo, nodo: <FilaPlanilla key={s.tipo} s={s} /> })),
  ].sort((a, b) => RANGO_SEVERIDAD[a.severidad] - RANGO_SEVERIDAD[b.severidad]);
  return <ListaSenales etiqueta="Señales de esta persona">{filas.map((f) => f.nodo)}</ListaSenales>;
}

/** Las mismas señales en una línea cada una, sin evidencia (el Resumen de la ficha de planilla). */
export function SenalesPlanillaBreves({ senales, nepotismo }: { senales: SenalConDetalle<TipoPlanilla>[]; nepotismo?: ParienteProveedor[] }) {
  const filas = [
    ...(nepotismo?.length ? [{ severidad: "alta" as Severidad, clave: "nepotismo", titulo: tituloNepotismo(nepotismo.length), dato: datoNepotismo(nepotismo) }] : []),
    ...senales.map((s) => ({ severidad: s.severidad, clave: s.tipo, titulo: SENAL_PLANILLA[s.tipo]?.titulo ?? s.tipo, dato: datoClavePlanilla(s.tipo, s.detalle) })),
  ].sort((a, b) => RANGO_SEVERIDAD[a.severidad] - RANGO_SEVERIDAD[b.severidad]);
  return (
    <ListaSenales etiqueta="Señales de esta persona, en corto">
      {filas.map((f) => (
        <SenalBreve key={f.clave} severidad={f.severidad} titulo={f.titulo} dato={f.dato} />
      ))}
    </ListaSenales>
  );
}

function FilaPlanilla({ s }: { s: SenalConDetalle<TipoPlanilla> }) {
  const fuente = fuentePlanilla(s.tipo);
  return (
    <FilaSenal severidad={s.severidad} titulo={SENAL_PLANILLA[s.tipo]?.titulo ?? s.tipo} dato={datoClavePlanilla(s.tipo, s.detalle)} fuente={fuente.corto}>
      <p className="max-w-prose text-dato leading-relaxed text-inkSoft">{SENAL_PLANILLA[s.tipo]?.explica}</p>
      <DetalleSenalPlanilla tipo={s.tipo} d={s.detalle} />
      <FuenteSenal texto={fuente.texto} url={fuente.url} />
    </FilaSenal>
  );
}

// ─── Nepotismo, del lado del funcionario ────────────────────────────────────────────────────────

const grado = (g: string) => GRADO_PARIENTE[g] ?? "pariente";
const conMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const anios = (xs: number[]) => (xs.length ? (xs[0] === xs[xs.length - 1] ? String(xs[0]) : `${xs[0]} a ${xs[xs.length - 1]}`) : null);

const tituloNepotismo = (n: number) => (n === 1 ? "Declaró a un pariente que le vende a su entidad" : `Declaró a ${numero(n)} parientes que le venden a su entidad`);

/** "Hijo(a): 35 órdenes por S/ 181,917, de 2019 a 2024" o "2 parientes: 36 órdenes por S/ 187,317". */
function datoNepotismo(parientes: ParienteProveedor[]): string {
  if (parientes.length === 1) {
    const p = parientes[0];
    const a = anios(p.anios);
    return `${conMayuscula(grado(p.grado))}: ${plural(p.n, "orden", "órdenes")} por ${soles(p.monto)}${a ? `, ${a.includes(" a ") ? `de ${a}` : `en ${a}`}` : ""}`;
  }
  const n = parientes.reduce((t, p) => t + p.n, 0);
  const monto = parientes.reduce((t, p) => t + p.monto, 0);
  return `${numero(parientes.length)} parientes: ${plural(n, "orden", "órdenes")} por ${soles(monto)}`;
}

function FilaNepotismo({ parientes, entidad }: { parientes: ParienteProveedor[]; entidad?: string }) {
  const fuente = fuentePlanilla("nepotismo");
  return (
    <FilaSenal severidad="alta" titulo={tituloNepotismo(parientes.length)} dato={datoNepotismo(parientes)} fuente={fuente.corto}>
      <p className="max-w-prose text-dato leading-relaxed text-inkSoft">
        En su Declaración Jurada de Intereses (Ley 31227) declaró como{" "}
        {parientes.length === 1 ? "pariente a quien figura como locador (proveedor)" : "parientes a quienes figuran como locadores (proveedores)"} de{" "}
        {entidad ?? "su misma entidad"}. Es un indicio de posible nepotismo para revisión humana, no una acusación: la declaración es pública y el
        impedimento depende del cargo (Ley 32069, art. 30).
      </p>
      {parientes.map((p, i) => {
        const a = anios(p.anios);
        return (
          <section key={`${p.codigo ?? p.nombre}-${i}`} className="space-y-2">
            <h3 className="text-cuerpo font-semibold leading-snug text-ink">
              {conMayuscula(grado(p.grado))}:{" "}
              {p.codigo ? (
                <Link href={`/app/personas/${p.codigo}`} className="text-granate underline-offset-2 hover:underline">
                  {tituloNatural(p.nombre)}
                </Link>
              ) : (
                tituloNatural(p.nombre)
              )}
            </h3>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
              <Dato tipo="documento" nombre="Órdenes">{`${plural(p.n, "orden", "órdenes")} de la entidad por ${soles(p.monto)}`}</Dato>
              {a && (
                <Dato tipo="fecha" nombre="Años">
                  {a}
                </Dato>
              )}
            </p>
            {p.ordenes ? (
              <OrdenesCitadas
                ordenes={p.ordenes}
                etiqueta={`Cada orden que la entidad le dio a su ${grado(p.grado)}`}
                nota="Es la orden tal como la publicó CONOSCE. La contratación de un pariente de un funcionario puede estar impedida según el cargo (Ley 32069, art. 30): esto es un dato para revisar, no una prueba de falta."
              />
            ) : (
              <p className="text-meta text-mute">No pudimos leer ahora cada una de sus órdenes: están en su ficha.</p>
            )}
            {p.codigo && (
              <Link href={`/app/personas/${p.codigo}`} className="inline-flex items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline">
                Ver su ficha, con todas sus órdenes y señales <span aria-hidden>→</span>
              </Link>
            )}
          </section>
        );
      })}
      <FuenteSenal texto={fuente.texto} url={fuente.url} />
    </FilaSenal>
  );
}

// ─── El dato de la fila ─────────────────────────────────────────────────────────────────────────

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
/** "no electo" → "No electo". */
const oracionSimple = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
const natural = (v: unknown) => (t(v) ? tituloNatural(t(v)!) : null);
/** El mes de una señal que trae `anio` y `mes` sueltos (brecha, pago extraordinario): "set. 2026". */
const mesDe = (d: Record<string, unknown>) => (n(d.anio) && n(d.mes) ? mes(`${n(d.anio)}-${String(n(d.mes)).padStart(2, "0")}`) : null);
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? fechaCorta(v.slice(0, 10)) : null);

/** El dato que sostiene la señal, en una línea, para su fila. Nunca el nombre de una persona. */
export function datoClavePlanilla(tipo: TipoPlanilla, d: Record<string, unknown>): string | null {
  switch (tipo) {
    case "tambien_ordenes": {
      const meses = listaMeses(lista(d.meses));
      const cuantas = n(d.ordenes);
      return [cuantas != null ? `${plural(cuantas, "orden", "órdenes")} por ${soles(n(d.monto) ?? 0)}` : null, meses ? `en ${meses}` : null].filter(Boolean).join(" ") || null;
    }
    case "candidato_gobierna": {
      const c = [...lista(d.candidaturas)].sort((a, b) => (n(b.anio) ?? 0) - (n(a.anio) ?? 0))[0];
      if (!c) return nombrePartido(d.partido);
      return [nombrePartido(c.partido), cargoEnOracion(c.cargo), t(c.anio) ? `en ${t(c.anio)}` : null].filter(Boolean).join(", ").replace(/, en /, " en ");
    }
    case "brecha_cargo": {
      const m = mesDe(d);
      const v = n(d.veces);
      return `${soles(n(d.total) ?? 0)} frente a ${soles(n(d.mediana) ?? 0)} de mediana de su cargo${v != null ? `: ${String(v).replace(".", ",")} veces` : ""}${m ? `, en ${m}` : ""}`;
    }
    case "apellidos_autoridad":
    case "apellidos_directivo": {
      const quienes = lista(tipo === "apellidos_autoridad" ? d.autoridades : d.funcionarios_designados);
      const cargo = cargoEnOracion(quienes[0]?.cargo);
      const frec = n(d.frecuencia);
      return `${cargo ? `Sus dos apellidos son los de quien es ${cargo}` : "Sus dos apellidos son los de alguien de la entidad"}${quienes.length > 1 ? ` y ${plural(quienes.length - 1, "persona más", "personas más")}` : ""}${
        frec != null ? `; ${frec === 1 ? "nadie más los lleva" : `${numero(frec)} personas los llevan`} en las planillas cargadas` : ""
      }`;
    }
    case "antes_locador": {
      const desde = mes(t(d.primera_orden));
      const entro = mes(t(d.primer_mes_planilla));
      const monto = n(d.monto);
      return [desde ? `Locador desde ${desde}` : null, entro ? `en planilla desde ${entro}` : null, monto != null ? `${soles(monto)} por órdenes` : null].filter(Boolean).join("; ") || null;
    }
    case "pago_extraordinario": {
      const m = mesDe(d);
      return `${soles(n(d.extra) ?? 0)} fuera del sueldo${m ? ` en ${m}` : ""}, con un sueldo de ${soles(n(d.base) ?? 0)}`;
    }
    case "es_autoridad": {
      const a = lista(d.autoridades)[0];
      if (!a) return null;
      const periodo = [t(a.desde)?.slice(0, 4), t(a.hasta)?.slice(0, 4)].filter(Boolean).join(" a ");
      return [cargoEnOracion(a.cargo, true), t(a.partido) ? `por ${nombrePartido(a.partido)}` : null, periodo ? `(${periodo})` : null].filter(Boolean).join(" ") || null;
    }
    default:
      return null;
  }
}

// ─── La evidencia ───────────────────────────────────────────────────────────────────────────────

function TablaChica({ columnas, filas, etiqueta }: { columnas: Columna[]; filas: Fila[]; etiqueta: string }) {
  if (!filas.length) return null;
  return <Tabla columnas={columnas} filas={filas} etiqueta={etiqueta} medida="contenedor" densidad="compacta" />;
}

const texto = (v: string | null) => <span className="text-meta text-ink">{v ?? "Sin dato"}</span>;
/**
 * El partido como enlace a su ficha (captura, contratos de sus gobiernos): el vínculo se investiga, no es texto muerto.
 * Por su clave (`rutaPartido`) y, con el año del dato, en ese período: con el nombre crudo la ficha no lo encontraba.
 */
const partidoCell = (v: unknown, anio?: unknown) => {
  const name = t(v);
  if (!name) return texto(null);
  return (
    <Link href={rutaPartido(name, anio)} className="text-meta text-granate underline-offset-2 hover:underline">
      {nombrePartido(name) ?? name}
    </Link>
  );
};

/** El último año de una lista de años (las órdenes del período del partido que gobernaba). */
const ultimoAnio = (xs: unknown): number | null => {
  const anios = (Array.isArray(xs) ? xs : []).map((x) => Number(String(x ?? "").slice(0, 4))).filter((y) => Number.isInteger(y) && y > 1900);
  return anios.length ? Math.max(...anios) : null;
};

export function DetalleSenalPlanilla({ tipo, d }: { tipo: TipoPlanilla; d: Record<string, unknown> }) {
  let items: DatoClave[] = [];
  if (tipo === "pago_extraordinario") {
    items = [
      { etiqueta: "Mes", valor: mesDe(d) },
      { etiqueta: "Su sueldo", valor: n(d.base) != null ? soles(n(d.base)) : null, mono: true },
      { etiqueta: "Fuera del sueldo", valor: n(d.extra) != null ? soles(n(d.extra)) : null, mono: true },
      { etiqueta: "Total del mes", valor: n(d.total) != null ? soles(n(d.total)) : null, mono: true },
    ];
  } else if (tipo === "brecha_cargo") {
    items = [
      { etiqueta: "Mes", valor: mesDe(d) },
      { etiqueta: "Su sueldo", valor: n(d.total) != null ? soles(n(d.total)) : null, mono: true },
      { etiqueta: "Mediana de su cargo", valor: n(d.mediana) != null ? `${soles(n(d.mediana))} (${plural(n(d.personas) ?? 0, "persona", "personas")})` : null, ayuda: <AyudaTermino clave="mediana" /> },
      { etiqueta: "Diferencia", valor: n(d.veces) != null ? `${String(n(d.veces)).replace(".", ",")} veces` : null },
      ...(n(d.ganan_tanto) != null
        ? [{ etiqueta: "Con su cargo ganan tanto", valor: n(d.ganan_tanto) === 1 ? "Sólo esta persona" : `${numero(n(d.ganan_tanto) ?? 0)} personas` }]
        : []),
      // Tanta diferencia suele ser un pago acumulado (devengados de varios meses) cargado como sueldo.
      ...((n(d.veces) ?? 0) >= 5
        ? [{ etiqueta: "Ojo", valor: "Una diferencia así suele ser un pago acumulado de varios meses registrado como sueldo: mira su sueldo mes a mes." }]
        : []),
    ];
  } else if (tipo === "tambien_ordenes") {
    items = [
      { etiqueta: "Meses con las dos cosas", valor: listaMeses(lista(d.meses)) },
      { etiqueta: "Órdenes esos meses", valor: n(d.ordenes) != null ? numero(n(d.ordenes) ?? 0) : null, mono: true },
      { etiqueta: "Pagado por esas órdenes", valor: n(d.monto) != null ? soles(n(d.monto) ?? 0) : null, mono: true },
    ];
  } else if (tipo === "antes_locador") {
    items = [
      { etiqueta: "Primera orden", valor: dia(d.primera_orden) },
      ...(dia(d.ultima_orden_antes) ? [{ etiqueta: "Última orden antes de la planilla", valor: dia(d.ultima_orden_antes) }] : []),
      { etiqueta: "Entró a la planilla", valor: mes(t(d.primer_mes_planilla)) },
      ...(n(d.monto) != null ? [{ etiqueta: "Cobrado por órdenes", valor: soles(n(d.monto) ?? 0), mono: true }] : []),
    ];
  } else if (tipo === "apellidos_autoridad") {
    return (
      <div className="space-y-1.5">
        <TablaChica
          etiqueta="Autoridades con sus dos apellidos"
          columnas={[
            { clave: "cargo", titulo: "Autoridad", ancho: "minmax(0,1fr)" },
            { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
          ]}
          filas={lista(d.autoridades).map((a, i) => ({
            id: String(i),
            celdas: {
              // La autoridad va tapada como la persona (privacidad, P0 del 2026-10-26): se muestra como llega.
              cargo: <CeldaPrincipal titulo={natural(a.cargo) ?? "Sin cargo"} meta={t(a.nombre) ? [<Dato key="n" tipo="personas" nombre="Autoridad">{t(a.nombre)}</Dato>] : undefined} />,
              partido: partidoCell(a.partido, a.desde),
            },
          }))}
        />
        {n(d.frecuencia) != null && (
          <p className="text-meta text-mute">
            {n(d.frecuencia) === 1
              ? "Es la única persona de las planillas cargadas con estos dos apellidos."
              : `${numero(n(d.frecuencia) ?? 0)} personas de las planillas cargadas llevan estos dos apellidos.`}
          </p>
        )}
      </div>
    );
  } else if (tipo === "es_autoridad") {
    return (
      <TablaChica
        etiqueta="Su cargo de autoridad"
        columnas={[
          { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
          { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
          { clave: "mandato", titulo: "Mandato", ancho: "6.5rem" },
        ]}
        filas={lista(d.autoridades).map((a, i) => ({
          id: String(i),
          celdas: {
            cargo: texto(natural(a.cargo)),
            partido: partidoCell(a.partido, a.desde),
            mandato: texto([t(a.desde)?.slice(0, 4), t(a.hasta)?.slice(0, 4)].filter(Boolean).join(" a ") || null),
          },
        }))}
      />
    );
  } else if (tipo === "apellidos_directivo") {
    return (
      <TablaChica
        etiqueta="Directivos con sus dos apellidos"
        columnas={[{ clave: "cargo", titulo: "Directivo", ancho: "minmax(0,1fr)" }]}
        filas={lista(d.funcionarios_designados).map((f, i) => ({
          id: String(i),
          celdas: { cargo: <CeldaPrincipal titulo={natural(f.cargo) ?? "Sin cargo"} meta={t(f.nombre) ? [<Dato key="n" tipo="personas" nombre="Directivo">{t(f.nombre)}</Dato>] : undefined} /> },
        }))}
      />
    );
  } else if (tipo === "candidato_gobierna") {
    return (
      <div className="space-y-2">
        <DatosClave items={[{ etiqueta: "Partido que gobierna la entidad", valor: t(d.partido) ? partidoCell(d.partido, ultimoAnio(d.anios)) : null }]} />
        <TablaChica
          etiqueta="Sus candidaturas"
          columnas={[
            { clave: "cargo", titulo: "Candidatura", ancho: "minmax(0,1fr)" },
            { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
            { clave: "resultado", titulo: "Resultado", ancho: "5.5rem" },
          ]}
          filas={lista(d.candidaturas).map((c, i) => ({
            id: String(i),
            celdas: {
              cargo: <CeldaPrincipal titulo={natural(c.cargo) ?? "Sin cargo en la fuente"} meta={[<Dato key="a" tipo="fecha" nombre="Elección">{t(c.anio) ?? "Sin año"}</Dato>]} />,
              partido: partidoCell(c.partido, c.anio),
              resultado: texto(t(c.resultado) ? oracionSimple(t(c.resultado)!.replace(/_/g, " ")) : null),
            },
          }))}
        />
      </div>
    );
  }
  return items.length ? <DatosClave items={items} /> : null;
}
