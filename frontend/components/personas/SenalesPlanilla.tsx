import Link from "next/link";
import { AyudaTermino, DatosClave, type DatoClave } from "@/components/patrones";
import { CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { decimal, fechaCorta, numero, plural, soles } from "@/lib/formato";
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
import { OrdenesCitadas, eleccionTexto, gobiernoTexto, hitosCampana } from "./EvidenciaSenal";
import { FrenteMediana } from "@/components/charts/FrenteMediana";
import { LineaHitos } from "@/components/charts/LineaHitos";

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
    <FilaSenal severidad={s.severidad} tipo={s.tipo} titulo={SENAL_PLANILLA[s.tipo]?.titulo ?? s.tipo} dato={datoClavePlanilla(s.tipo, s.detalle)} fuente={fuente.corto}>
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
    <FilaSenal severidad="alta" tipo="pariente_locador" titulo={tituloNepotismo(parientes.length)} dato={datoNepotismo(parientes)} fuente={fuente.corto}>
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
    case "pariente_locador": {
      const par = lista(d.parientes);
      const grados = [...new Set(par.map((x) => GRADO_PARIENTE[t(x.grado) ?? "otro"] ?? "pariente"))];
      return `${plural(par.length, "pariente", "parientes")} (${grados.join(", ")}) con ${plural(n(d.ordenes) ?? 0, "orden", "órdenes")} por ${soles(n(d.monto) ?? 0)} de la entidad`;
    }
    case "pariente_planilla": {
      const f = lista(d.funcionarios);
      if (f.length > 1) return `Pariente de ${numero(f.length)} funcionarios de su entidad`;
      const cargo = cargoEnOracion(f[0]?.cargo, true);
      return `${oracionSimple(GRADO_PARIENTE[t(f[0]?.grado) ?? "otro"] ?? "pariente")} de un funcionario de su entidad${cargo ? ` (${cargo})` : ""}`;
    }
    case "familiar_en_planilla": {
      const par = lista(d.parientes);
      const grados = [...new Set(par.map((x) => GRADO_PARIENTE[t(x.grado) ?? "otro"] ?? "pariente"))];
      const cargo = par.length === 1 ? natural(par[0].cargo) : null;
      return `Declaró ${par.length === 1 ? "a un pariente" : `a ${numero(par.length)} parientes`} (${grados.join(", ")}) que ${par.length === 1 ? "trabaja" : "trabajan"} en su entidad${cargo ? `, como ${cargo}` : ""}`;
    }
    case "ascenso_expres": {
      const a = (d.antes ?? {}) as Record<string, unknown>;
      const b = (d.despues ?? {}) as Record<string, unknown>;
      const meses = n(d.meses);
      return `De ${natural(a.cargo) ?? "otro cargo"} (${soles(n(a.base) ?? 0)}) a ${natural(b.cargo) ?? "una jefatura"} (${soles(n(b.base) ?? 0)})${meses != null ? ` en ${plural(meses, "mes", "meses")}` : ""}${n(d.veces) != null ? `: ${decimal(n(d.veces))} veces` : ""}`;
    }
    case "doble_planilla": {
      const meses = listaMeses(lista(d.meses));
      const otra = natural(d.otra_entidad) ?? "otra entidad";
      return `También en la planilla de ${otra}${t(d.otro_cargo) ? ` (${natural(d.otro_cargo)})` : ""}${meses ? ` en ${meses}` : ""}`;
    }
    case "socio_proveedor": {
      const emp = lista(d.empresas);
      const e = emp[0];
      if (!e) return null;
      const rol = t(e.rol) ? oracionSimple(t(e.rol)!.replace(/_/g, " ")) : "Socio";
      return `${rol} de ${t(e.nombre) ?? `RUC ${t(e.ruc)}`}, que le vendió ${soles(n(e.monto) ?? 0)} a la entidad${emp.length > 1 ? ` (y ${plural(emp.length - 1, "empresa más", "empresas más")})` : ""}`;
    }
    case "financio_campana": {
      const total = lista(d.aportes).reduce((s, a) => s + (n(a.monto) ?? 0), 0) || n(d.monto) || 0;
      const eleccion = eleccionTexto(d.eleccion);
      const desde = mes(t(d.primer_mes));
      return [
        `${soles(total)} a la campaña de ${nombrePartido(d.partido) ?? "su partido"}${eleccion ? ` en ${eleccion}` : ""}`,
        d.alto_funcionario === true ? "es alto funcionario" : null,
        desde ? (d.entro_en_lo_visto === true ? `entró a la planilla en ${desde}` : `en la planilla desde ${desde} o antes`) : null,
      ].filter(Boolean).join("; ");
    }
    case "aporte_gobierna": {
      const ap = lista(d.aportes);
      const total = n(d.monto) ?? ap.reduce((s, a) => s + (n(a.monto) ?? 0), 0);
      const anios = [...new Set(ap.map((a) => t(a.anio) ?? t(a.fecha)?.slice(0, 4) ?? null).filter((x): x is string => !!x))].sort();
      return `${soles(total)} a ${nombrePartido(d.partido) ?? "el partido que gobierna"}${anios.length ? ` en ${anios.join(", ")}` : ""}`;
    }
    case "candidato_gobierna": {
      const c = [...lista(d.candidaturas)].sort((a, b) => (n(b.anio) ?? 0) - (n(a.anio) ?? 0))[0];
      if (!c) return nombrePartido(d.partido);
      return [nombrePartido(c.partido), cargoEnOracion(c.cargo), t(c.anio) ? `en ${t(c.anio)}` : null].filter(Boolean).join(", ").replace(/, en /, " en ");
    }
    case "brecha_cargo": {
      const m = mesDe(d);
      const v = n(d.veces);
      return `${soles(n(d.total) ?? 0)} frente a ${soles(n(d.mediana) ?? 0)} de mediana de su cargo${v != null ? `: ${decimal(v)} veces` : ""}${m ? `, en ${m}` : ""}`;
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
      { etiqueta: "Diferencia", valor: n(d.veces) != null ? `${decimal(n(d.veces))} veces` : null },
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
  } else if (tipo === "pariente_locador") {
    // Del pariente sólo el parentesco y lo que cobró: nunca quién es (ni su nombre ni su documento).
    return (
      <TablaChica
        etiqueta="Parientes locadores que declaró"
        columnas={[
          { clave: "parentesco", titulo: "Parentesco declarado", ancho: "minmax(0,1fr)" },
          { clave: "ordenes", titulo: "Órdenes", ancho: "5rem", alinear: "der" },
          { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der" },
          { clave: "anios", titulo: "Años", ancho: "6rem", desde: "md", apilar: "con-rotulo" },
        ]}
        filas={lista(d.parientes).map((x, i) => ({
          id: String(i),
          celdas: {
            parentesco: texto(oracionSimple(GRADO_PARIENTE[t(x.grado) ?? "otro"] ?? "pariente")),
            ordenes: texto(n(x.ordenes) != null ? numero(n(x.ordenes)!) : null),
            monto: texto(n(x.monto) != null ? soles(n(x.monto)) : null),
            anios: texto([t(x.desde), t(x.hasta)].filter((y, j, a) => y && a.indexOf(y) === j).join(" a ") || null),
          },
        }))}
      />
    );
  } else if (tipo === "pariente_planilla") {
    // Del funcionario: su cargo y, sólo si no destapa el apellido tapado de esta persona, su primer apellido y su ficha
    // (lo decide la migración 182 con la regla de la API). Nunca su nombre completo.
    return (
      <TablaChica
        etiqueta="Funcionarios de su entidad que lo declararon como pariente"
        columnas={[
          { clave: "quien", titulo: "Lo declaró", ancho: "minmax(0,1fr)" },
          { clave: "parentesco", titulo: "Parentesco declarado", corto: "Parentesco", ancho: "minmax(0,11rem)", desde: "md", apilar: "con-rotulo" },
        ]}
        filas={lista(d.funcionarios).map((f, i) => ({
          id: String(i),
          ...(t(f.ficha) ? { href: `/app/personas/planilla/${t(f.ficha)}` } : {}),
          celdas: {
            quien: <CeldaPrincipal titulo={natural(f.cargo) ?? "Funcionario de la entidad"} meta={t(f.apellido) ? [<Dato key="a" tipo="personas" nombre="Funcionario">{t(f.apellido)}</Dato>] : undefined} />,
            parentesco: texto(oracionSimple(GRADO_PARIENTE[t(f.grado) ?? "otro"] ?? "pariente")),
          },
        }))}
      />
    );
  } else if (tipo === "familiar_en_planilla") {
    // Del pariente sólo el parentesco y su cargo: nunca quién es.
    return (
      <TablaChica
        etiqueta="Parientes que declaró y que trabajan en su entidad"
        columnas={[
          { clave: "parentesco", titulo: "Parentesco declarado", ancho: "minmax(0,1fr)" },
          { clave: "cargo", titulo: "Su cargo en la entidad", corto: "Cargo", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
        ]}
        filas={lista(d.parientes).map((x, i) => ({
          id: String(i),
          celdas: {
            parentesco: texto(oracionSimple(GRADO_PARIENTE[t(x.grado) ?? "otro"] ?? "pariente")),
            cargo: texto(natural(x.cargo)),
          },
        }))}
      />
    );
  } else if (tipo === "ascenso_expres") {
    const a = (d.antes ?? {}) as Record<string, unknown>;
    const b = (d.despues ?? {}) as Record<string, unknown>;
    const antes = n(a.base);
    const despues = n(b.base);
    return (
      <div className="space-y-3">
        {antes != null && despues != null && (
          <FrenteMediana valor={despues} mediana={antes} etiquetaValor={`Sueldo en ${mes(t(b.mes)) ?? "la jefatura"}`} etiquetaMediana={`Sueldo en ${mes(t(a.mes)) ?? "su cargo anterior"}`} />
        )}
        <DatosClave
          items={[
            { etiqueta: "Antes", valor: [natural(a.cargo), mes(t(a.mes))].filter(Boolean).join(", ") || null },
            { etiqueta: "Sueldo antes", valor: antes != null ? soles(antes) : null, mono: true },
            { etiqueta: "Después", valor: [natural(b.cargo), mes(t(b.mes))].filter(Boolean).join(", ") || null },
            { etiqueta: "Sueldo después", valor: despues != null ? soles(despues) : null, mono: true },
            { etiqueta: "Subió", valor: n(d.veces) != null ? `${decimal(n(d.veces))} veces en ${plural(n(d.meses) ?? 0, "mes", "meses")}` : null },
          ]}
        />
      </div>
    );
  } else if (tipo === "doble_planilla") {
    const otra = t(d.otra_entidad_ruc);
    return (
      <DatosClave
        items={[
          {
            etiqueta: "La otra entidad",
            valor: otra ? (
              <Link href={`/entidad/${otra}?seccion=planilla`} className="text-granate underline-offset-2 hover:underline">
                {natural(d.otra_entidad) ?? `RUC ${otra}`}
              </Link>
            ) : natural(d.otra_entidad),
          },
          { etiqueta: "Su cargo allá", valor: natural(d.otro_cargo) },
          { etiqueta: "Su sueldo allá", valor: n(d.otra_base) != null ? soles(n(d.otra_base)) : null, mono: true },
          { etiqueta: "Su cargo aquí", valor: natural(d.cargo) },
          { etiqueta: "Su sueldo aquí", valor: n(d.base) != null ? soles(n(d.base)) : null, mono: true },
          { etiqueta: "Meses en las dos", valor: listaMeses(lista(d.meses)) },
        ]}
      />
    );
  } else if (tipo === "socio_proveedor") {
    return (
      <TablaChica
        etiqueta="Empresas de las que es parte y que le venden a su entidad"
        columnas={[
          { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1fr)" },
          { clave: "rol", titulo: "Su papel", ancho: "minmax(0,9rem)", desde: "md", apilar: "con-rotulo" },
          { clave: "monto", titulo: "Le vendió a la entidad", ancho: "8rem", alinear: "der" },
        ]}
        filas={lista(d.empresas).map((e, i) => ({
          id: String(i),
          ...(t(e.ruc) ? { href: `/empresa/${t(e.ruc)}` } : {}),
          celdas: {
            empresa: (
              <CeldaPrincipal
                titulo={t(e.nombre) ?? `RUC ${t(e.ruc)}`}
                meta={[t(e.ruc) ? <Dato key="r" tipo="codigo" nombre="RUC" mono>{t(e.ruc)}</Dato> : null, t(e.desde) ? <Dato key="a" tipo="fecha" nombre="Años">{[t(e.desde), t(e.hasta)].filter((y, j, a) => y && a.indexOf(y) === j).join(" a ")}</Dato> : null]}
              />
            ),
            rol: texto(t(e.rol) ? oracionSimple(t(e.rol)!.replace(/_/g, " ")) : null),
            monto: texto(n(e.monto) != null ? soles(n(e.monto)) : null),
          },
        }))}
      />
    );
  } else if (tipo === "financio_campana" || tipo === "aporte_gobierna") {
    const campana = tipo === "financio_campana";
    return (
      <div className="space-y-2">
        <DatosClave
          items={[
            { etiqueta: d.nivel === "nacional" ? "Gobierno nacional" : "Gobierno de la entidad", valor: gobiernoTexto(d) },
            ...(campana ? [{ etiqueta: "La campaña que financió", valor: eleccionTexto(d.eleccion) }] : []),
            ...(n(d.monto) != null ? [{ etiqueta: campana ? "Total aportado a su campaña" : "Total aportado", valor: soles(n(d.monto)), mono: true }] : []),
            ...(campana && d.alto_funcionario === true ? [{ etiqueta: "Su régimen", valor: "Alto funcionario: un cargo que designa el gobierno" }] : []),
            ...(campana && t(d.primer_mes)
              ? [{
                  etiqueta: "En la planilla",
                  valor: d.entro_en_lo_visto === true ? `Entró en ${mes(t(d.primer_mes))}, con ese gobierno` : `Desde ${mes(t(d.primer_mes))} o antes (el primer mes cargado)`,
                }]
              : []),
          ]}
        />
        {campana && (
          <LineaHitos
            hitos={hitosCampana(d, { fecha: d.primer_mes, texto: d.entro_en_lo_visto === true ? "Entró a la planilla" : "Ya figuraba en la planilla (primer mes cargado)" })}
            etiqueta="De la campaña a la planilla"
          />
        )}
        <TablaChica
          etiqueta="Sus aportes"
          columnas={[
            { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
            { clave: "aporte", titulo: "Aporte", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
            { clave: "fecha", titulo: "Fecha", ancho: "7rem", desde: "md", apilar: "con-rotulo" },
            { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der" },
          ]}
          filas={lista(d.aportes).map((a, i) => ({
            id: String(i),
            celdas: {
              partido: partidoCell(a.partido, a.fecha ?? a.anio),
              aporte: texto(a.campana === true ? `A su campaña (${eleccionTexto(a.proceso) ?? "sin proceso"})` : t(a.proceso) ? `Aporte (${eleccionTexto(a.proceso)})` : "Aporte"),
              fecha: texto(dia(a.fecha) ?? t(a.anio)),
              monto: texto(n(a.monto) != null ? soles(n(a.monto)) : null),
            },
          }))}
        />
      </div>
    );
  } else if (tipo === "candidato_gobierna") {
    return (
      <div className="space-y-2">
        <DatosClave
          items={[
            { etiqueta: d.nivel === "nacional" ? "Partido del Presidente" : "Partido que gobierna la entidad", valor: t(d.partido) ? partidoCell(d.partido, ultimoAnio(d.anios)) : null },
            ...(d.nivel === "nacional" ? [{ etiqueta: "Gobierno nacional", valor: gobiernoTexto(d) }] : []),
          ]}
        />
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
  if (!items.length) return null;
  // La brecha con su cargo, dibujada: su sueldo y la mediana de su cargo en la misma escala.
  const total = n(d.total);
  const mediana = n(d.mediana);
  if (tipo === "brecha_cargo" && total != null && mediana != null) {
    return (
      <div className="space-y-3">
        <FrenteMediana valor={total} mediana={mediana} etiquetaValor="Su sueldo" etiquetaMediana="Mediana de su cargo" />
        <DatosClave items={items} />
      </div>
    );
  }
  return <DatosClave items={items} />;
}
