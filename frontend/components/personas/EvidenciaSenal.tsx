import Link from "next/link";
import { AyudaTermino, DatosClave } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { fecha, fechaCorta, numero, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPartido } from "@/lib/partidos";
import { REGIMEN, cargoEnOracion, listaMeses, mes, nombrePartido, ordenesCitadas, type OrdenCitada } from "@/lib/planilla";
import { GRADO_PARIENTE, type SenalDetalle } from "@/lib/personas";
import { txtONumero } from "@/lib/utils";

/**
 * La evidencia de cada señal de una persona contratada, por tipo (migración 91 y 137): la candidatura, el aporte, la
 * autoridad, los meses, lo que cobra frente a la mediana, las órdenes citadas una por una… Va plegada bajo su fila
 * (`FilaSenal`). Las tablas se miden por su contenedor y apilan lo secundario con su rótulo: en el celular la tabla de
 * aportes recortaba el monto («AMAZONENSE S/ 10», cabecera «Mon»). Los nombres llegan tapados de la API; de un
 * funcionario sólo se muestra el primer apellido. Server-safe.
 */

type Obj = Record<string, unknown>;
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : []);
const txt = txtONumero;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? fechaCorta(v.slice(0, 10)) : null);
const anio = (v: unknown) => (typeof v === "string" && /^\d{4}/.test(v) ? v.slice(0, 4) : typeof v === "number" ? String(v) : null);
const natural = (v: unknown) => (txt(v) ? tituloNatural(txt(v)!) : null);
/** "3,7 veces" (coma decimal). */
const veces = (v: unknown) => (num(v) != null ? `${String(num(v)).replace(".", ",")} veces` : null);
const porQue = (por: unknown) =>
  por === "dni" ? "Coincide por el documento de identidad." : por === "nombre" ? "Coincide por el nombre completo y el departamento (la fuente no trae documento)." : null;
const unicos = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const enPalabras = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
/** «las elecciones regionales y municipales de 2022»: el proceso ONPE de una campaña (ERM2022, EG2021). */
export const eleccionTexto = (e: unknown): string | null => {
  const t = txt(e);
  if (!t) return null;
  const m = /^(ERM|EG|ECE|EMC)(\d{4})$/.exec(t);
  if (!m) return t;
  const nombre = { ERM: "las elecciones regionales y municipales", EG: "las elecciones generales", ECE: "las elecciones congresales", EMC: "las elecciones municipales complementarias" }[m[1]];
  return `${nombre} de ${m[2]}`;
};
/** El gobierno de la señal: «Pedro Castillo (Perú Libre), del 28 jul. 2021 al 30 jun. 2022» o «Contigo Región, 2023 a 2026». */
export const gobiernoTexto = (d: Obj): string | null => {
  const partido = nombrePartido(d.partido) ?? txt(d.partido);
  const nacional = d.nivel === "nacional";
  const desde = nacional ? dia(d.gobierno_desde) : anio(d.gobierno_desde);
  const hasta = nacional ? dia(d.gobierno_hasta) : anio(d.gobierno_hasta);
  const periodo = desde && hasta ? (nacional ? `del ${desde} al ${hasta}` : `${desde} a ${hasta}`) : null;
  const quien = nacional && txt(d.presidente) ? `${txt(d.presidente)}${partido ? ` (${partido})` : ""}` : partido;
  return [quien, periodo].filter(Boolean).join(", ") || null;
};

/** El parentesco con mayúscula inicial: "Hijo(a)". */
const gradoTitulo = (g: unknown) => {
  const t = GRADO_PARIENTE[txt(g) ?? "otro"] ?? "pariente";
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** El funcionario, no completo (sólo su primer apellido): la DJI es pública, pero basta para ubicarlo. */
function primerApellido(nombre: unknown): string | null {
  const t = txt(nombre);
  if (!t) return null;
  return tituloNatural(t).split(/\s+/)[0] ?? null;
}

/**
 * El partido como enlace a su ficha (captura, contratos de sus gobiernos): el vínculo se investiga, no es texto muerto.
 * Por su clave (`rutaPartido`) y, con el año del dato, en ese período: con el nombre crudo la ficha no lo encontraba.
 */
const partidoLink = (v: unknown, anio?: unknown) => {
  const nombre = txt(v);
  if (!nombre) return <span className="text-meta text-mute">Sin dato</span>;
  return (
    <Link href={rutaPartido(nombre, anio)} className="text-meta text-granate underline-offset-2 hover:underline">
      {nombrePartido(nombre) ?? nombre}
    </Link>
  );
};
/** El último año de una lista de años u objetos con `anio`/`fecha` (el período del partido que gobernaba). */
const ultimoAnio = (xs: unknown): number | null => {
  const anios = (Array.isArray(xs) ? xs : [])
    .map((x) => (x && typeof x === "object" ? (x as Obj).anio ?? (x as Obj).fecha : x))
    .map((x) => Number(String(x ?? "").slice(0, 4)))
    .filter((y) => Number.isInteger(y) && y > 1900);
  return anios.length ? Math.max(...anios) : null;
};

// ─── El dato de la fila ───────────────────────────────────────────────────────────────────────────

/**
 * El dato que sostiene la señal, en una línea, para su fila (sin abrir la evidencia): "S/ 107 a Sentimiento
 * Amazonense Regional en 2022", "11 de 12 meses en 2024 y 11 de 12 en 2025". Nunca el nombre de una persona.
 */
export function datoClaveSenal(s: SenalDetalle): string | null {
  const d = s.detalle ?? {};
  switch (s.tipo) {
    case "nepotismo": {
      const par = lista(d.parientes);
      const ords = lista(d.ordenes_detalle);
      const n = ords.length || num(d.ordenes) || 0;
      const monto = ords.length ? ords.reduce((t, o) => t + (num(o.monto) ?? 0), 0) : num(d.monto) ?? 0;
      const cargo = par.length === 1 ? cargoEnOracion(par[0].cargo, true) : null;
      const quien =
        par.length > 1
          ? `Pariente de ${numero(par.length)} funcionarios de la entidad`
          : `${gradoTitulo(par[0]?.grado)} de un funcionario de la entidad${cargo ? ` (${cargo})` : ""}`;
      return `${quien}: ${plural(n, "orden", "órdenes")} por ${soles(monto)}`;
    }
    case "financio_campana": {
      const deCampana = lista(d.aportes).filter((a) => a.campana === true);
      const total = deCampana.reduce((t, a) => t + (num(a.monto) ?? 0), 0) || num(d.monto) || 0;
      const eleccion = eleccionTexto(d.eleccion);
      const ordenes = num(d.ordenes);
      const primera = dia(d.primera_orden);
      return [
        `${soles(total)} a la campaña de ${nombrePartido(d.partido) ?? "su partido"}${eleccion ? ` en ${eleccion}` : ""}`,
        ordenes ? `después, ${plural(ordenes, "orden", "órdenes")} de ese gobierno${primera ? ` desde el ${primera}` : ""}` : null,
      ].filter(Boolean).join("; ");
    }
    case "candidato_gobierna":
    case "candidato": {
      const c = lista(d.candidaturas).sort((a, b) => (num(b.anio) ?? 0) - (num(a.anio) ?? 0));
      if (!c.length) return nombrePartido(d.partido);
      const u = c[0];
      const partes = [nombrePartido(u.partido), cargoEnOracion(u.cargo), txt(u.anio) ? `en ${txt(u.anio)}` : null, u.resultado === "electo" ? "electo" : null];
      const base = partes.filter(Boolean).join(", ").replace(/, en /, " en ");
      return c.length > 1 ? `${base}; ${plural(c.length - 1, "candidatura más", "candidaturas más")}` : base;
    }
    case "aporte_gobierna":
    case "aporte": {
      const ap = lista(d.aportes);
      const total = num(d.monto) ?? ap.reduce((t, a) => t + (num(a.monto) ?? 0), 0);
      const partidos = unicos(ap.map((a) => nombrePartido(a.partido)));
      const anios = unicos(ap.map((a) => anio(a.fecha) ?? txt(a.anio))).sort();
      const a = partidos.length ? ` a ${enPalabras(partidos)}` : txt(d.partido) ? ` a ${nombrePartido(d.partido)}` : "";
      return `${soles(total)}${a}${anios.length ? ` en ${enPalabras(anios)}` : ""}`;
    }
    case "autoridad_contratada": {
      const a = lista(d.autoridades)[0];
      if (!a) return null;
      const periodo = [anio(a.desde), anio(a.hasta)].filter(Boolean).join(" a ");
      const base = [cargoEnOracion(a.cargo, true), txt(a.partido) ? `por ${nombrePartido(a.partido)}` : null, periodo ? `(${periodo})` : null].filter(Boolean).join(" ");
      return `${base}${d.mismo_gobierno ? ", del mismo gobierno que le dio las órdenes" : ", de otro gobierno"}`;
    }
    case "apellidos_autoridad":
    case "apellidos_funcionario": {
      const quienes = lista(s.tipo === "apellidos_autoridad" ? d.autoridades : d.funcionarios_designados);
      const cargo = cargoEnOracion(quienes[0]?.cargo);
      const frec = num(d.frecuencia);
      const base = cargo ? `Sus dos apellidos son los de quien es ${cargo}` : "Sus dos apellidos son los de alguien de la entidad";
      const mas = quienes.length > 1 ? ` y ${plural(quienes.length - 1, "persona más", "personas más")}` : "";
      return `${base}${mas}${frec != null ? `; ${plural(frec, "persona contratada los lleva", "personas contratadas los llevan")} en el país` : ""}`;
    }
    case "funcionario_contratado": {
      const c = lista(d.cargos).sort((a, b) => (num(b.anio) ?? 0) - (num(a.anio) ?? 0))[0];
      if (!c) return null;
      return `Declaró ser ${cargoEnOracion(c.cargo) ?? "parte de la entidad"}${txt(c.anio) ? ` en ${txt(c.anio)}` : ""}`;
    }
    case "inhabilitado": {
      const ords = lista(d.ordenes_detalle);
      const n = ords.length || num(d.ordenes) || 0;
      const monto = ords.length ? ords.reduce((t, o) => t + (num(o.monto) ?? 0), 0) : num(d.monto) ?? 0;
      return `${plural(n, "orden", "órdenes")} por ${soles(monto)} durante la inhabilitación`;
    }
    case "meses_seguidos": {
      const a = lista(d.anios).sort((x, y) => (num(x.anio) ?? 0) - (num(y.anio) ?? 0));
      return a.length ? enPalabras(a.map((x) => `${txt(x.meses)} de 12 meses en ${txt(x.anio)}`)) : null;
    }
    case "pago_alto": {
      const a = [...lista(d.anios)].sort((x, y) => (num(y.veces) ?? 0) - (num(x.veces) ?? 0))[0];
      if (!a) return null;
      const v = veces(a.veces);
      return `${soles(num(a.por_mes) ?? 0)} por mes en ${txt(a.anio)}, frente a ${soles(num(a.mediana_mes) ?? 0)} de mediana en la entidad${v ? `: ${v}` : ""}`;
    }
    case "visita_previa": {
      const v = lista(d.visitas).sort((x, y) => String(x.fecha ?? "").localeCompare(String(y.fecha ?? "")));
      if (!v.length) return null;
      const primera = dia(v[0].fecha);
      if (v.length === 1) return `Una visita${primera ? `, el ${primera},` : ""} antes de su primera orden`;
      return `${plural(v.length, "visita", "visitas")} antes de su primera orden${primera ? `; la primera, el ${primera}` : ""}`;
    }
    case "tambien_planilla": {
      const meses = listaMeses(Array.isArray(d.meses) ? (d.meses as unknown[]) : []);
      const cargo = cargoEnOracion(d.cargo);
      return meses ? `Órdenes y planilla en ${meses}${cargo ? `, como ${cargo}` : ""}` : null;
    }
    case "paso_a_planilla": {
      const primera = dia(d.primera_orden);
      const entro = mes(txt(d.primer_mes_planilla));
      return [primera ? `Primera orden el ${primera}` : null, entro ? `en planilla desde ${entro}` : null].filter(Boolean).join("; ") || null;
    }
    default:
      return null;
  }
}

// ─── La evidencia ─────────────────────────────────────────────────────────────────────────────────

/** Una tabla chica de la evidencia (candidaturas, aportes, autoridades…): medida por su contenedor, filas compactas. */
function Lista({ columnas, filas, etiqueta }: { columnas: Columna[]; filas: Fila[]; etiqueta: string }) {
  if (!filas.length) return null;
  return <Tabla columnas={columnas} filas={filas} etiqueta={etiqueta} medida="contenedor" densidad="compacta" />;
}

const texto = (v: string | null, clase = "text-ink") => <span className={`text-meta ${clase}`}>{v ?? "Sin dato"}</span>;

export function EvidenciaSenal({ s, codigo, entidadRuc }: { s: SenalDetalle; codigo: string; entidadRuc?: string }) {
  const d = s.detalle ?? {};
  switch (s.tipo) {
    case "nepotismo": {
      // El/los funcionario(s) que lo declararon como pariente: cargo + primer apellido + parentesco. No se nombra entero a
      // nadie; es un indicio para revisión humana. La fila lleva a la ficha de planilla del funcionario, si la tiene.
      const parientes: Fila[] = lista(d.parientes).map((p, i) => ({
        id: String(i),
        ...(txt(p.ficha) ? { href: `/app/personas/planilla/${txt(p.ficha)}` } : {}),
        celdas: {
          quien: (
            <CeldaPrincipal
              titulo={natural(p.cargo) ?? "Funcionario de la entidad"}
              // Sólo su primer apellido, y sólo si el parentesco no puede destapar el apellido tapado (lo decide el API).
              meta={txt(p.funcionarioApellido) ? [<Dato key="ap" tipo="personas" nombre="Funcionario">{primerApellido(p.funcionarioApellido)}</Dato>] : undefined}
            />
          ),
          parentesco: texto(GRADO_PARIENTE[txt(p.grado) ?? "otro"] ?? "pariente", "text-inkSoft"),
        },
      }));
      const ordenes = ordenesCitadas(d.ordenes_detalle);
      const n = ordenes.length || num(d.ordenes) || 0;
      const monto = ordenes.length ? ordenes.reduce((t, o) => t + (o.monto ?? 0), 0) : num(d.monto) ?? 0;
      return (
        <div className="space-y-3">
          <DatosClave
            items={[
              { etiqueta: "Órdenes de la entidad", valor: plural(n, "orden", "órdenes"), mono: true },
              { etiqueta: "Monto de esas órdenes", valor: soles(monto), mono: true },
              { etiqueta: "Años", valor: [num(d.desde), num(d.hasta)].filter((x) => x != null).filter((x, i, a) => a.indexOf(x) === i).join(" a ") || null, mono: true },
            ]}
          />
          <Lista
            etiqueta="Funcionarios que lo declararon como pariente"
            columnas={[
              { clave: "quien", titulo: "Lo declaró", ancho: "minmax(0,1fr)" },
              { clave: "parentesco", titulo: "Parentesco declarado", corto: "Parentesco", ancho: "minmax(0,11rem)", desde: "md", apilar: "con-rotulo" },
            ]}
            filas={parientes}
          />
          <OrdenesCitadas
            ordenes={ordenes}
            etiqueta="Cada orden que le dio la entidad"
            nota="Es la orden tal como la publicó CONOSCE. La contratación de un pariente de un funcionario puede estar impedida según el cargo (Ley 32069, art. 30): esto es un dato para revisar, no una prueba de falta."
          />
        </div>
      );
    }
    case "financio_campana": {
      const ordenes = num(d.ordenes);
      const filas: Fila[] = lista(d.aportes).map((a, i) => ({
        id: String(i),
        celdas: {
          partido: partidoLink(a.partido, a.fecha ?? a.anio),
          aporte: texto(
            a.campana === true ? `A su campaña (${eleccionTexto(a.proceso) ?? "sin proceso"})` : txt(a.proceso) ? `Otro aporte (${eleccionTexto(a.proceso)})` : "Otro aporte",
            a.campana === true ? "font-semibold text-ink" : "text-inkSoft",
          ),
          fecha: <span className="text-meta tabular-nums text-mute">{dia(a.fecha) ?? txt(a.anio) ?? "Sin fecha"}</span>,
          monto: <CeldaNumero>{num(a.monto) != null ? soles(num(a.monto)) : "Sin dato"}</CeldaNumero>,
        },
      }));
      return (
        <div className="space-y-3">
          <DatosClave
            items={[
              { etiqueta: d.nivel === "nacional" ? "Gobierno nacional" : "Gobierno de la entidad", valor: gobiernoTexto(d) },
              { etiqueta: "La campaña que financió", valor: eleccionTexto(d.eleccion) },
              ...(num(d.monto) != null ? [{ etiqueta: "Total aportado a ese partido", valor: soles(num(d.monto)), mono: true }] : []),
              ...(ordenes
                ? [{
                    etiqueta: "Después, de ese gobierno",
                    valor: `${plural(ordenes, "orden", "órdenes")} por ${soles(num(d.monto_ordenes) ?? 0)}${dia(d.primera_orden) ? `, la primera el ${dia(d.primera_orden)}` : ""}`,
                  }]
                : []),
            ]}
          />
          <Lista
            etiqueta="Aportes"
            columnas={[
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
              { clave: "aporte", titulo: "Aporte", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
              { clave: "fecha", titulo: "Fecha", ancho: "7rem", desde: "md", apilar: "con-rotulo" },
              { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der" },
            ]}
            filas={filas}
          />
          <Nota>
            La ONPE publica cada aporte con el documento de quien aporta; va a la organización política, no a un candidato con nombre.
            Aportar es legal: lo que se señala es que quien financió la campaña después cobró de ese gobierno.
          </Nota>
          <VerOrdenes codigo={codigo} entidadRuc={entidadRuc}>
            {entidadRuc ? "Ver sus órdenes de esta entidad" : "Ver sus órdenes del Estado"}
          </VerOrdenes>
        </div>
      );
    }
    case "candidato_gobierna":
    case "candidato": {
      const filas: Fila[] = lista(d.candidaturas)
        .sort((a, b) => (num(b.anio) ?? 0) - (num(a.anio) ?? 0))
        .map((c, i) => ({
          id: String(i),
          celdas: {
            cargo: <CeldaPrincipal titulo={natural(c.cargo) ?? "Sin cargo en la fuente"} meta={[<Dato key="a" tipo="fecha" nombre="Elección">{txt(c.anio) ?? "Sin año"}</Dato>]} />,
            partido: partidoLink(c.partido, c.anio),
            resultado: texto(c.resultado === "electo" ? "Electo" : c.resultado === "no_electo" ? "No electo" : "Sin dato", "text-inkSoft"),
          },
        }));
      return (
        <div className="space-y-3">
          {s.tipo === "candidato_gobierna" && txt(d.partido) && (
            <DatosClave
              items={[
                { etiqueta: d.nivel === "nacional" ? "Partido del Presidente" : "Partido que gobernaba", valor: partidoLink(d.partido, ultimoAnio(d.anios)) },
                ...(d.nivel === "nacional" ? [{ etiqueta: "Gobierno nacional", valor: gobiernoTexto(d) }] : []),
              ]}
            />
          )}
          <Lista
            etiqueta="Candidaturas"
            columnas={[
              { clave: "cargo", titulo: "Candidatura", ancho: "minmax(0,1fr)" },
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
              { clave: "resultado", titulo: "Resultado", ancho: "5.5rem" },
            ]}
            filas={filas}
          />
          <Nota>{porQue(d.por)}</Nota>
          <VerOrdenes codigo={codigo} entidadRuc={entidadRuc}>
            {entidadRuc ? "Ver sus órdenes de esta entidad" : "Ver sus órdenes del Estado"}
          </VerOrdenes>
        </div>
      );
    }
    case "aporte_gobierna":
    case "aporte": {
      // El partido primero y el monto siempre a la vista; la fecha, apilada con su rótulo en lo angosto.
      const filas: Fila[] = lista(d.aportes).map((a, i) => ({
        id: String(i),
        celdas: {
          partido: partidoLink(a.partido, a.fecha ?? a.anio),
          fecha: <span className="text-meta tabular-nums text-mute">{dia(a.fecha) ?? txt(a.anio) ?? "Sin fecha"}</span>,
          monto: <CeldaNumero>{num(a.monto) != null ? soles(num(a.monto)) : "Sin dato"}</CeldaNumero>,
        },
      }));
      return (
        <div className="space-y-3">
          <DatosClave
            items={[
              ...(s.tipo === "aporte_gobierna" && txt(d.partido)
                ? [{ etiqueta: d.nivel === "nacional" ? "Partido del Presidente" : "Partido que gobernaba", valor: partidoLink(d.partido, ultimoAnio(d.aportes)) }]
                : []),
              ...(s.tipo === "aporte_gobierna" && d.nivel === "nacional" ? [{ etiqueta: "Gobierno nacional", valor: gobiernoTexto(d) }] : []),
              ...(num(d.monto) != null ? [{ etiqueta: "Total aportado", valor: soles(num(d.monto)), mono: true }] : []),
            ]}
          />
          <Lista
            etiqueta="Aportes"
            columnas={[
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
              { clave: "fecha", titulo: "Fecha", ancho: "7rem", desde: "md", apilar: "con-rotulo" },
              { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der" },
            ]}
            filas={filas}
          />
        </div>
      );
    }
    case "autoridad_contratada":
    case "apellidos_autoridad": {
      const otro = s.tipo === "apellidos_autoridad";
      const filas: Fila[] = lista(d.autoridades).map((a, i) => ({
        id: String(i),
        celdas: {
          // La autoridad con sus dos apellidos va tapada como la persona (privacidad, P0 del 2026-10-26).
          cargo: <CeldaPrincipal titulo={natural(a.cargo) ?? "Sin cargo"} meta={otro && txt(a.nombre) ? [<Dato key="n" tipo="personas" nombre="Autoridad">{txt(a.nombre)}</Dato>] : undefined} />,
          partido: partidoLink(a.partido, a.desde),
          periodo: <span className="text-meta tabular-nums text-mute">{[anio(a.desde), anio(a.hasta)].filter(Boolean).join(" a ") || "Sin dato"}</span>,
        },
      }));
      const frec = num(d.frecuencia);
      return (
        <div className="space-y-3">
          <Lista
            etiqueta="Autoridades"
            columnas={[
              { clave: "cargo", titulo: otro ? "Autoridad" : "Su cargo", ancho: "minmax(0,1fr)" },
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
              { clave: "periodo", titulo: "Mandato", ancho: "6rem", desde: "md", apilar: "con-rotulo" },
            ]}
            filas={filas}
          />
          {!otro && <Nota>{d.mismo_gobierno ? "Es autoridad del mismo gobierno que le dio las órdenes." : "Es autoridad de otro gobierno, no del que le dio las órdenes."}</Nota>}
          {!otro && <Nota>{porQue(d.por)}</Nota>}
          {otro && frec != null && <Nota>{`${plural(frec, "persona contratada lleva", "personas contratadas llevan")} estos dos apellidos en todo el país.`}</Nota>}
        </div>
      );
    }
    case "apellidos_funcionario": {
      const filas: Fila[] = lista(d.funcionarios_designados).map((f, i) => ({
        id: String(i),
        celdas: {
          cargo: <CeldaPrincipal titulo={natural(f.cargo) ?? "Sin cargo"} meta={txt(f.nombre) ? [<Dato key="n" tipo="personas" nombre="Funcionario">{txt(f.nombre)}</Dato>] : undefined} />,
          anio: <span className="font-mono text-meta tabular-nums text-mute">{txt(f.anio) ?? "Sin año"}</span>,
        },
      }));
      const frec = num(d.frecuencia);
      return (
        <div className="space-y-3">
          <Lista
            etiqueta="Funcionarios con los mismos apellidos"
            columnas={[
              { clave: "cargo", titulo: "Cargo declarado", ancho: "minmax(0,1fr)" },
              { clave: "anio", titulo: "Declaración", ancho: "6rem", desde: "md", apilar: "con-rotulo" },
            ]}
            filas={filas}
          />
          {frec != null && <Nota>{`${plural(frec, "persona contratada lleva", "personas contratadas llevan")} estos dos apellidos en todo el país.`}</Nota>}
        </div>
      );
    }
    case "funcionario_contratado": {
      const filas: Fila[] = lista(d.cargos).map((c, i) => ({
        id: String(i),
        celdas: {
          cargo: <CeldaPrincipal titulo={natural(c.cargo) ?? "Sin cargo"} meta={[<Dato key="a" tipo="fecha" nombre="Declaración">{txt(c.anio) ?? "Sin año"}</Dato>]} />,
          desde: <span className="text-meta tabular-nums text-mute">{dia(c.inicio) ?? "Sin dato"}</span>,
        },
      }));
      return (
        <Lista
          etiqueta="Cargos declarados"
          columnas={[
            { clave: "cargo", titulo: "Cargo declarado", ancho: "minmax(0,1fr)" },
            { clave: "desde", titulo: "Desde", ancho: "7rem", desde: "md", apilar: "con-rotulo" },
          ]}
          filas={filas}
        />
      );
    }
    case "inhabilitado": {
      const filas: Fila[] = lista(d.sanciones).map((x, i) => ({
        id: String(i),
        celdas: {
          tipo: (
            <CeldaPrincipal
              titulo={x.tipo === "definitivo" ? "Inhabilitación definitiva" : "Inhabilitación temporal"}
              meta={[<Dato key="v" tipo="fecha" nombre="Vigencia">{[dia(x.desde), dia(x.hasta)].filter(Boolean).join(" a ") || "Sin fecha"}</Dato>]}
            />
          ),
          resolucion: <span className="font-mono text-meta text-inkSoft">{txt(x.resolucion) ?? "Sin dato"}</span>,
          infraccion: <span className="text-meta text-inkSoft">{txt(x.infraccion)?.replace(/^[-\s]+/, "") ?? "Sin dato"}</span>,
        },
      }));
      return (
        <div className="space-y-3">
          <Lista
            etiqueta="Inhabilitaciones"
            columnas={[
              { clave: "tipo", titulo: "Inhabilitación", ancho: "minmax(0,1fr)" },
              { clave: "resolucion", titulo: "Resolución", ancho: "minmax(0,11rem)", desde: "md", apilar: "con-rotulo" },
              { clave: "infraccion", titulo: "Infracción", ancho: "minmax(0,1fr)", desde: "xl", apilar: "con-rotulo" },
            ]}
            filas={filas}
          />
          <OrdenesCitadas
            ordenes={ordenesCitadas(d.ordenes_detalle)}
            etiqueta="Cada orden recibida durante la inhabilitación"
            nota="Es la orden tal como la publicó CONOSCE: no incluye quién más compitió por ella. Lo que se puede revisar es el servicio, la fecha y el monto, y que la emitieron mientras el Tribunal lo tenía inhabilitado para contratar con el Estado."
          />
        </div>
      );
    }
    case "meses_seguidos": {
      const filas: Fila[] = lista(d.anios).map((a, i) => ({
        id: String(i),
        href: entidadRuc ? `/app/personas/${codigo}?seccion=ordenes&oent=${entidadRuc}&oanio=${txt(a.anio) ?? ""}` : undefined,
        celdas: {
          anio: <span className="font-mono text-meta tabular-nums text-ink">{txt(a.anio)}</span>,
          meses: <CeldaNumero>{`${txt(a.meses)} de 12`}</CeldaNumero>,
          monto: <CeldaNumero sub={plural(num(a.ordenes) ?? 0, "orden", "órdenes")}>{soles(num(a.monto) ?? 0)}</CeldaNumero>,
        },
      }));
      return (
        <Lista
          etiqueta="Años con órdenes casi todos los meses (toca uno para ver sus órdenes)"
          columnas={[
            { clave: "anio", titulo: "Año", ancho: "3.5rem" },
            { clave: "meses", titulo: "Meses con orden", ancho: "minmax(0,1fr)", alinear: "der" },
            { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der" },
          ]}
          filas={filas}
        />
      );
    }
    case "pago_alto": {
      const filas: Fila[] = lista(d.anios).map((a, i) => ({
        id: String(i),
        href: entidadRuc ? `/app/personas/${codigo}?seccion=ordenes&oent=${entidadRuc}&oanio=${txt(a.anio) ?? ""}` : undefined,
        celdas: {
          servicio: <CeldaPrincipal titulo={txt(a.servicio) ?? "Su servicio"} meta={[<Dato key="a" tipo="fecha" nombre="Año">{txt(a.anio) ?? "Sin año"}</Dato>]} />,
          mediana: <CeldaNumero sub={`de ${plural(num(a.personas) ?? 0, "persona", "personas")}`}>{soles(num(a.mediana_mes) ?? 0)}</CeldaNumero>,
          veces: <CeldaNumero>{veces(a.veces) ?? "Sin dato"}</CeldaNumero>,
          suyo: <CeldaNumero>{soles(num(a.por_mes) ?? 0)}</CeldaNumero>,
        },
      }));
      return (
        <Lista
          etiqueta="Lo que cobra por mes frente a la mediana de la entidad (toca un año para ver sus órdenes)"
          columnas={[
            { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1fr)" },
            { clave: "mediana", titulo: "Mediana de la entidad", corto: "Mediana", ancho: "8.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="mediana" /> },
            { clave: "veces", titulo: "Diferencia", ancho: "6rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
            { clave: "suyo", titulo: "Cobró por mes", corto: "Por mes", ancho: "6.5rem", alinear: "der" },
          ]}
          filas={filas}
        />
      );
    }
    case "tambien_planilla": {
      const regimen = num(d.regimen);
      return (
        <div className="space-y-3">
          <DatosClave
            items={[
              { etiqueta: "Meses con órdenes y planilla", valor: listaMeses(Array.isArray(d.meses) ? (d.meses as unknown[]) : []) },
              { etiqueta: "Cargo en la planilla", valor: natural(d.cargo) },
              { etiqueta: "Régimen", valor: regimen != null ? REGIMEN[regimen] ?? `Régimen ${regimen}` : null, ayuda: <AyudaTermino clave="regimen" /> },
              { etiqueta: "Lo que cobró en planilla", valor: num(d.sueldo) != null ? soles(num(d.sueldo)!) : null, mono: true },
            ]}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {entidadRuc && <VerOrdenes codigo={codigo} entidadRuc={entidadRuc}>Ver sus órdenes de esta entidad</VerOrdenes>}
            <VerPlanilla ficha={txt(d.plan_ficha)} />
          </div>
        </div>
      );
    }
    case "paso_a_planilla": {
      const regimen = num(d.regimen);
      return (
        <div className="space-y-3">
          <DatosClave
            items={[
              { etiqueta: "Primera orden", valor: dia(d.primera_orden) },
              { etiqueta: "Entró a la planilla", valor: mes(txt(d.primer_mes_planilla)) },
              { etiqueta: "Cargo en la planilla", valor: natural(d.cargo) },
              { etiqueta: "Régimen", valor: regimen != null ? REGIMEN[regimen] ?? `Régimen ${regimen}` : null, ayuda: <AyudaTermino clave="regimen" /> },
            ]}
          />
          <VerPlanilla ficha={txt(d.plan_ficha)} />
        </div>
      );
    }
    case "visita_previa": {
      const filas: Fila[] = lista(d.visitas).map((v, i) => ({
        id: String(i),
        celdas: {
          visitado: (
            <CeldaPrincipal
              titulo={natural(v.cargo_visitado) ?? "Sin dato del visitado"}
              meta={[<Dato key="f" tipo="fecha">{dia(v.fecha) ?? "Sin fecha"}</Dato>, txt(v.area) && <Dato key="a" tipo="dependencia" nombre="Oficina">{natural(v.area)}</Dato>]}
            />
          ),
          motivo: <span className="text-meta text-inkSoft">{txt(v.motivo) ?? "Sin dato"}</span>,
        },
      }));
      return (
        <Lista
          etiqueta="Visitas"
          columnas={[
            { clave: "visitado", titulo: "A quién visitó (cargo)", ancho: "minmax(0,1fr)" },
            { clave: "motivo", titulo: "Motivo", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
          ]}
          filas={filas}
        />
      );
    }
    default:
      return null;
  }
}

// ─── Órdenes citadas ──────────────────────────────────────────────────────────────────────────────

const COLUMNAS_CITADAS: Columna[] = [
  { clave: "fecha", titulo: "Emitida", ancho: "6.5rem", desde: "md", apilar: true },
  { clave: "orden", titulo: "Orden de servicio", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der" },
];

/**
 * Las órdenes concretas detrás de una señal (nepotismo, inhabilitado), una por una: la cita a la evidencia. Cada fila
 * abre el panel lateral con lo que hay de esa orden; paginadas de a 10 y con buscador desde 10 (listas completas).
 * La usan la ficha de persona contratada y la de planilla (el lado del funcionario del nepotismo).
 */
export function OrdenesCitadas({ ordenes, etiqueta, nota }: { ordenes: OrdenCitada[]; etiqueta: string; nota: string }) {
  if (!ordenes.length) return null;
  const filas: Fila[] = ordenes.map((o, i) => {
    const titulo = o.servicio ?? o.descripcion ?? "Orden de servicio";
    return {
      id: `ord-${i}-${o.numero ?? ""}`,
      buscable: [o.descripcion, o.servicio, o.numero, o.orden, o.fecha].filter(Boolean).join(" "),
      celdas: {
        fecha: <span className="text-meta tabular-nums text-mute">{dia(o.fecha) ?? "Sin fecha"}</span>,
        orden: (
          <CeldaPrincipal
            titulo={titulo}
            meta={[o.numero && <Dato key="n" tipo="codigo" nombre="Número de orden" mono>{`N.° ${o.numero}`}</Dato>, o.estado && <Dato key="e" tipo="tipo" nombre="Estado">{o.estado}</Dato>]}
          />
        ),
        monto: <CeldaNumero>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>,
      },
      detalle: {
        titulo: o.numero ? `Orden de servicio N.° ${o.numero}` : "Orden de servicio",
        etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
        descripcion: o.entidad ? tituloNatural(o.entidad) : undefined,
        contenido: (
          <div className="space-y-3">
            <DatosClave
              items={[
                { etiqueta: "Qué se pagó", valor: o.descripcion },
                { etiqueta: "Entidad", valor: o.entidad ? tituloNatural(o.entidad) : null },
                { etiqueta: "Emitida", valor: o.fecha ? fecha(o.fecha.slice(0, 10)) : null },
                { etiqueta: "Estado", valor: o.estado },
                { etiqueta: "Monto", valor: o.monto != null ? soles(o.monto) : null, mono: true },
                { etiqueta: "Tipo de servicio", valor: o.servicio },
                { etiqueta: "Cómo se contrató", valor: o.tipoContratacion },
              ]}
            />
            <p className="text-rotulo leading-relaxed text-mute">{nota}</p>
          </div>
        ),
        pie: <span className="text-rotulo text-mute">Fuente: OECE, CONOSCE, órdenes de compra y de servicio{o.orden ? ` (${o.orden})` : ""}</span>,
      },
    };
  });
  return (
    <TablaPaginada
      columnas={COLUMNAS_CITADAS}
      filas={filas}
      etiqueta={`${etiqueta} (toca una para su detalle)`}
      nombre="órdenes"
      tam={10}
      medida="contenedor"
      buscar={{ placeholder: "Buscar en estas órdenes por servicio o número…", etiqueta: "Buscar en estas órdenes" }}
    />
  );
}

// ─── Enlaces y notas ──────────────────────────────────────────────────────────────────────────────

/** Enlace de citación a la pestaña Órdenes de la MISMA persona, ya filtrada (allí cada orden abre su panel). */
export function VerOrdenes({ codigo, entidadRuc, anio: a, children }: { codigo: string; entidadRuc?: string; anio?: string | number | null; children: string }) {
  const qs = new URLSearchParams({ seccion: "ordenes" });
  if (entidadRuc) qs.set("oent", entidadRuc);
  if (a != null && String(a) !== "") qs.set("oanio", String(a));
  return (
    <Link href={`/app/personas/${codigo}?${qs.toString()}`} className="inline-flex items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline">
      {children} <span aria-hidden>→</span>
    </Link>
  );
}

/** Enlace a la ficha de planilla de la MISMA persona (enlace inverso locador→planilla). Nulo si no está en planilla. */
function VerPlanilla({ ficha }: { ficha: string | null }) {
  if (!ficha) return null;
  return (
    <Link href={`/app/personas/planilla/${ficha}`} className="inline-flex items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline">
      Ver su ficha de planilla <span aria-hidden>→</span>
    </Link>
  );
}

function Nota({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return <p className="text-meta text-mute">{children}</p>;
}
