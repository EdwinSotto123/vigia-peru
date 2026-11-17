import { Fragment } from "react";
import Link from "next/link";
import {
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  Gavel,
  Hash,
  Landmark,
  MapPin,
  Quote,
  Store,
  Tag,
  UserRound,
  UserX,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Ayuda, BloqueDetalle, CuerpoDetalle, DatosClave, EstadoVacio, FuenteDato, PieDetalle } from "@/components/patrones";
import { ListaPaginada } from "@/components/listado";
import { BotonFila, ProveedorDetalle, type DetalleFila } from "@/components/listado/DetalleFilas";
import { recortar } from "@/components/contratos/recortar";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { TIPO_CRUCE, esPatronVisita } from "@/lib/cruces";
import { listaY, numero, plural, soles } from "@/lib/formato";
import {
  CLARIDAD_ONPE,
  CONOSCE_BUSCADOR,
  CONSULTA_RUC_SUNAT,
  CONTRATACIONES_ABIERTAS,
  DJI_CONSULTA,
  DATASET_PENALIDADES,
  DATASET_SANCIONADOS,
  DATASET_SOCIOS_RNP,
  INFOBRAS,
  PLATAFORMA_JNE,
  VISITAS_EN_LINEA,
  enlacesProceso,
  inversionSsi,
  obraInfobras,
  type EnlaceFuente,
} from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { CORTO_EMPRESA, rutaEmpresa, type AntecedenteEmpresa, type ClienteEmpresa, type ReferenciasAntecedente } from "@/lib/empresas";
import { P_CONTRATOS } from "@/lib/parametrosEmpresa";
import { RANGO_SEVERIDAD, peorSeveridad } from "@/lib/severidad";
import { cn, txtONumero } from "@/lib/utils";
import { NoCargo, paraClave } from "./comun";
import { P_ORDENES } from "./ordenes";
import { aSuGente, datosDe, type DatoCaso } from "./casoAntecedente";
import { EvidenciaDelAntecedente } from "./EvidenciaAntecedente";
import { IndiceAntecedentes, type TipoDelIndice } from "./IndiceAntecedentes";
import { CON_EVIDENCIA, ValorCaso, VisitasDelCaso } from "./PanelAntecedente";

/** La pestaña Antecedentes: sanciones, penalidades, aportes y demás cruces, como hechos. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Antecedentes ─────────────────────────────────────────────────────────────

const FUENTE: Record<string, string> = {
  onpe_aportantes: "Claridad de la ONPE",
  onpe_candidatos: "Claridad de la ONPE",
  jne_autoridades: "Autoridades electas del JNE",
  penalidades: "Penalidades del OECE",
  osce_sancionados: "Sancionados del Tribunal de Contrataciones",
  visitas_entidades: "Registro de visitas",
  rnp_conformacion_juridica: "Conformación jurídica del RNP",
  onpe_gastos_proveedores: "Gastos de campaña de la ONPE",
  conosce_adjudicaciones: "Adjudicaciones de CONOSCE",
  conosce_contratos: "Contratos de CONOSCE",
  conosce_ordenes: "Órdenes de compra y de servicio de CONOSCE",
  precio_item: "Ítems del OCDS (OECE) y CONOSCE",
  // La obra del contrato (INFOBRAS) y su inversión (Invierte.pe), migración 160.
  infobras: "INFOBRAS (Contraloría)",
  invierte_pe: "Invierte.pe (MEF)",
  // Los documentos del SEACE leídos con Claude (migración 246).
  acta_buena_pro: "Acta de buena pro del SEACE, leída con IA",
  consultas_bases: "Pliego de consultas del SEACE, leído con IA",
  bases_seace: "Bases del procedimiento en el SEACE, leídas con IA",
  // Las fuentes de los cruces más nuevos (antes salía su clave: «sunat», «dji_vinculos»).
  sunat: "Consulta RUC de la SUNAT",
  oece_ocds: "Contrataciones Abiertas del OECE",
  persona_entidad: "Órdenes de servicio de CONOSCE",
  conosce_postores: "Postores de CONOSCE",
  dji: "Declaraciones Juradas de Intereses (Contraloría)",
  dji_vinculos: "Declaraciones Juradas de Intereses (Contraloría)",
};

/**
 * La consulta de cada fuente: el enlace del pie de un tipo cuyos casos van a registros distintos (el de cada caso va en
 * su panel). Si todos van al mismo (la ficha de la empresa en el RNP), el pie lleva a ése.
 */
const PORTADA: Record<string, string> = {
  onpe_aportantes: CLARIDAD_ONPE,
  onpe_candidatos: CLARIDAD_ONPE,
  onpe_gastos_proveedores: CLARIDAD_ONPE,
  jne_autoridades: PLATAFORMA_JNE,
  penalidades: DATASET_PENALIDADES,
  osce_sancionados: DATASET_SANCIONADOS,
  visitas_entidades: VISITAS_EN_LINEA,
  rnp_conformacion_juridica: DATASET_SOCIOS_RNP,
  conosce_adjudicaciones: CONOSCE_BUSCADOR,
  conosce_contratos: CONOSCE_BUSCADOR,
  conosce_ordenes: CONOSCE_BUSCADOR,
  precio_item: CONTRATACIONES_ABIERTAS,
  infobras: INFOBRAS,
  sunat: CONSULTA_RUC_SUNAT,
  oece_ocds: CONTRATACIONES_ABIERTAS,
  persona_entidad: CONOSCE_BUSCADOR,
  conosce_postores: CONOSCE_BUSCADOR,
  dji: DJI_CONSULTA,
  dji_vinculos: DJI_CONSULTA,
};

const txt = txtONumero;

/** Un identificador que lleva a su ficha (el proceso, la entidad): en verde y subrayado, como en el resto de Vigía. */
const VERDE = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/** El nombre de una entidad como clave para cruzarlo con sus clientes: sin tildes, mayúsculas ni espacios dobles. */
const claveEntidad = (t: string) => paraClave(t).replace(/\s+/g, " ");

/**
 * El RUC de cada entidad cliente por su nombre. Un antecedente trae el nombre de la entidad de su proceso, no siempre su
 * RUC: con el RUC, la entidad lleva a su ficha y sus «Órdenes que pasan 8 UIT» a la lista de Órdenes filtrada por ella.
 * Un nombre que tienen dos entidades distintas queda fuera (`null`): no se adivina cuál es.
 */
function rucPorNombre(clientes: ClienteEmpresa[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const c of clientes) {
    if (!c.entidad) continue;
    const k = claveEntidad(c.entidad);
    m.set(k, m.has(k) && m.get(k) !== c.entidadRuc ? null : c.entidadRuc);
  }
  return m;
}

/** El RUC de la entidad del caso (el de la API o, sin él, el de sus clientes por el nombre). Nunca uno de persona (10…). */
function rucEntidadDe(a: AntecedenteEmpresa, rucDe: Map<string, string | null>): string | null {
  const r = a.entidadRuc ?? (a.entidad ? rucDe.get(claveEntidad(a.entidad)) ?? null : null);
  return r && /^\d{11}$/.test(r) && !r.startsWith("10") ? r : null;
}

export { P_ANTECEDENTES } from "@/lib/parametrosEmpresa";
import { P_ANTECEDENTES } from "@/lib/parametrosEmpresa";

/**
 * Una fila de la lista de un tipo: uno o más registros que dicen lo mismo. Pedido del usuario del 2026-11-05: en
 * MEDIFARMA tres filas de «Órdenes que pasan 8 UIT» repetían «241 días, del 2 feb. 2018 al 17 abr. 2026, 892 órdenes,
 * S/ 22,445,977» (procesos 1215080, 1209597 y 1209614): el mismo registro pesa sobre varios procesos. Ahora va una vez,
 * con sus procesos juntos.
 */
interface FilaCasos {
  casos: AntecedenteEmpresa[];
  datos: DatoCaso[];
}

/** El dato que cambia de un proceso a otro del mismo registro: no cuenta para juntar dos casos. */
const DEL_PROCESO = new Set(["Pesa sobre el proceso"]);

function juntarIguales(casos: AntecedenteEmpresa[], ruc: string): FilaCasos[] {
  const filas = new Map<string, FilaCasos>();
  for (const a of casos) {
    const datos = datosDe(a, ruc);
    const clave = [
      a.severidad,
      a.entidadRuc ?? a.entidad ?? "",
      ...datos.filter((x) => !DEL_PROCESO.has(x.etiqueta)).map((x) => `${x.etiqueta}=${x.valor}`),
    ].join("|");
    const f = filas.get(clave);
    if (f) f.casos.push(a);
    else filas.set(clave, { casos: [a], datos });
  }
  return [...filas.values()];
}

/** Los procesos de una fila, cada uno una vez y en el orden de la API (lo más reciente primero). */
function procesosDe(casos: AntecedenteEmpresa[]): AntecedenteEmpresa[] {
  const vistos = new Set<string>();
  const out: AntecedenteEmpresa[] = [];
  for (const c of casos) {
    if (!c.ocid || vistos.has(c.ocid)) continue;
    vistos.add(c.ocid);
    out.push(c);
  }
  return out;
}

/**
 * Los datos que van en la fila: lo que distingue el caso (hasta cuatro); lo demás, en su panel. Sin los que repite la
 * línea de debajo (el proceso y su entidad). Si todos son del panel, los dos primeros: nunca «Y 3 datos más en su
 * detalle» sin haber mostrado ninguno (pedido del usuario del 2026-11-05).
 */
function datosDeFila(datos: DatoCaso[], conEntidad: boolean): DatoCaso[] {
  const fuera = (x: DatoCaso) => DEL_PROCESO.has(x.etiqueta) || (conEntidad && x.etiqueta === "Entidad");
  const propios = datos.filter((x) => !x.soloPanel && !fuera(x));
  return propios.length ? propios.slice(0, 4) : datos.filter((x) => !fuera(x)).slice(0, 2);
}

/**
 * El ícono de cada dato de la fila (qué es cada cosa se ve sin leer su rótulo): por su rótulo y, un monto, por su valor.
 * «A quién» es el partido en un aporte y el funcionario en una visita.
 */
const ICONO_ROTULO: Record<string, LucideIcon> = {
  Quién: UserRound,
  "Quién fue": UserRound,
  "Quién lo declaró": UserRound,
  "Su papel en la empresa": UserRound,
  "Su papel allá": UserRound,
  Cargo: BriefcaseBusiness,
  "Postuló a": BriefcaseBusiness,
  "Lo recibió": BriefcaseBusiness,
  "Cargo del funcionario": BriefcaseBusiness,
  "Quién gobernaba la entidad": BriefcaseBusiness,
  Entidad: Building2,
  Visitó: Building2,
  "Entidad de la que depende": Building2,
  "También le hizo órdenes": Building2,
  "¿La misma entidad que contrató?": Building2,
  Partido: Landmark,
  Por: Landmark,
  "Le vendió a la campaña de": Landmark,
  Dónde: MapPin,
  "Domicilio fiscal": MapPin,
  Sanción: Gavel,
  Infracción: Gavel,
  "Sanción de esa empresa": Gavel,
  Resolución: FileText,
  Contrato: FileText,
  "Qué declaró": FileText,
  Detalle: FileText,
  Hoy: Clock,
  "Al llegar la buena pro": Clock,
  "Fuera de horario": Clock,
  Con: Store,
  "También está en": Store,
  "Primero ganó": Store,
  "Lo comparte con": Store,
  "Quién ganó": Store,
  Comparten: Store,
  "Compitieron juntas": Store,
  Postores: Users,
  "Quedó fuera": UserX,
  "Quedaron fuera": UserX,
  "Marca exigida": Tag,
  "Por qué, según el acta": Quote,
  "Lo que dicen las bases": Quote,
  "Lo que escribió un participante": Quote,
  "Motivo declarado": Quote,
};
const ROTULO_FECHA = new Set([
  "Días", "Cuándo", "Vigencia", "Entre", "Periodo", "Fecha del registro", "Alta en la SUNAT", "Ganó la buena pro", "Antes de la convocatoria",
  "Después", "Elección", "Elegido en", "Declaración del año", "Esta empresa se fundó", "Tenía de fundada",
]);
function iconoDe(x: DatoCaso, tipo: string): LucideIcon {
  if (x.etiqueta === "A quién") return tipo.startsWith("visita") ? BriefcaseBusiness : Landmark;
  if (/^[−-]?S\/\s?[−-]?\d/.test(x.valor ?? "")) return Banknote;
  return ICONO_ROTULO[x.etiqueta] ?? (ROTULO_FECHA.has(x.etiqueta) ? CalendarDays : /^[\d,.]+$/.test(x.valor ?? "") ? Hash : Tag);
}

/**
 * Los rótulos que el valor ya dice («241 días, del…», «Inhabilitación temporal», el nombre de quién, una cita): en la fila
 * va sólo el valor con su ícono (el rótulo, para el lector de pantalla). Los demás van delante, en gris y sin dos puntos
 * («Juntas suman S/ 22,445,977»), como el rótulo apilado de una tabla.
 */
const SIN_ROTULO = new Set([
  "Días", "Cuándo", "Quién", "Quién fue", "Entidad", "Sanción", "Postores", "Lo que registra la fuente", "Qué hizo", "Qué declaró",
  "Qué pasó", "Ítem", "Entre", "Periodo", "Dónde", "Domicilio fiscal", "Por qué, según el acta", "Lo que dicen las bases",
  "Lo que escribió un participante", "Motivo declarado",
]);

/** Un dato de la fila: su ícono y su valor (recortado: entero en el `title` y en el panel), en la misma línea que los otros. */
function DatoFila({ x, tipo }: { x: DatoCaso; tipo: string }) {
  const valor = x.valor ?? "";
  // Sólo los largos (una infracción, una cita): `recortar` también cambia el espacio duro de «S/ 1,234» por uno común.
  const corto = valor.length > 160 ? recortar(valor, 160) : valor;
  const rotulo = !SIN_ROTULO.has(x.etiqueta);
  return (
    <Dato icono={iconoDe(x, tipo)} nombre={rotulo ? undefined : x.etiqueta} className="min-w-0 max-w-full break-words">
      {rotulo && <span className="text-mute">{x.etiqueta} </span>}
      <span className={cn("text-ink", x.mono && "font-mono tabular-nums")} title={corto !== valor ? valor : undefined}>
        {corto}
      </span>
    </Dato>
  );
}

/** Cuántos procesos de una fila se nombran en ella; el resto, en su panel. */
const MAX_PROCESOS = 4;

/**
 * Dónde pesa el caso, debajo de lo que dice el registro: el proceso (o los procesos) y su entidad, en verde y con enlace
 * a su ficha (pedido del usuario del 2026-11-05: «debería pintarse de verde el número para que podamos clickear»; antes
 * eran texto negro y gris dentro del botón de la fila). Fuera del botón: un enlace dentro de otro control no se puede.
 */
function DondePesa({ casos, rucEntidad, sangria }: { casos: AntecedenteEmpresa[]; rucEntidad: string | null; sangria: boolean }) {
  const procesos = procesosDe(casos);
  const a = casos[0];
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  if (!procesos.length && !entidad) return null;
  const nombrados = procesos.slice(0, MAX_PROCESOS);
  const resto = procesos.length - nombrados.length;
  const enlace = (c: AntecedenteEmpresa) => (
    <Link href={rutaContrato(c.ocid!, "ficha", { seccion: "antecedentes" })} prefetch={false} className={cn(VERDE, "font-mono tabular-nums")}>
      {c.codigo ?? c.ocid}
    </Link>
  );
  return (
    <p className={cn("mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-meta leading-snug", sangria && "pl-[1.3125rem]")}>
      {/* El ícono sin nombre para el lector de pantalla: el texto ya dice «Proceso…» o «En 3 procesos…». */}
      {procesos.length === 1 && (
        <Dato icono={Hash}>
          <Link href={rutaContrato(procesos[0].ocid!, "ficha", { seccion: "antecedentes" })} prefetch={false} className={VERDE}>
            Proceso <span className="font-mono tabular-nums">{procesos[0].codigo ?? procesos[0].ocid}</span>
          </Link>
        </Dato>
      )}
      {procesos.length > 1 && (
        <Dato icono={Hash}>
          <span className="text-mute">{`En ${numero(procesos.length)} procesos: `}</span>
          {nombrados.map((c, i) => (
            <Fragment key={c.ocid}>
              {i > 0 && (i === nombrados.length - 1 && resto === 0 ? " y " : ", ")}
              {enlace(c)}
            </Fragment>
          ))}
          {resto > 0 && <span className="text-mute">{` y ${numero(resto)} más en su detalle`}</span>}
        </Dato>
      )}
      {entidad && (
        <Dato tipo="entidad">
          {rucEntidad ? (
            <Link href={`/entidad/${rucEntidad}`} prefetch={false} className={VERDE}>
              {entidad}
            </Link>
          ) : (
            <span className="text-inkSoft">{entidad}</span>
          )}
        </Dato>
      )}
    </p>
  );
}

/**
 * Una fila: lo que dice el registro en UNA línea de datos con ícono (antes, un renglón por dato: «Días: …», «Órdenes: …»,
 * «Juntas suman: …», 4-5 renglones por caso), que abre su panel; y debajo, dónde pesa, con enlaces. La severidad va en la
 * fila sólo si el tipo las mezcla (si no, la dice una vez su cabecera).
 */
function FilaCaso({ id, fila, tipo, mixto, rucEntidad }: { id: string; fila: FilaCasos; tipo: string; mixto: boolean; rucEntidad: string | null }) {
  const a = fila.casos[0];
  const visibles = datosDeFila(fila.datos, !!a.entidad);
  return (
    <div className="px-4 py-2 sm:px-5">
      <BotonFila
        id={id}
        className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-lg px-2 py-1 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        {mixto && <Severidad bandera={a.severidad} formato="punto" className="mt-0.5 shrink-0" />}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-meta leading-snug">
          <span className="sr-only">Ver el caso: </span>
          {visibles.length ? (
            visibles.map((x) => <DatoFila key={x.etiqueta} x={x} tipo={tipo} />)
          ) : (
            <span className="text-mute">El registro no trae más datos: su fuente, en el detalle</span>
          )}
        </span>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
      </BotonFila>
      <DondePesa casos={fila.casos} rucEntidad={rucEntidad} sangria={mixto} />
    </div>
  );
}

/** Las etiquetas de los datos que nombran a una persona: no entran a la búsqueda de la lista (docs/PRIVACIDAD.md). */
const ES_PERSONA = new Set(["Quién", "Quién fue", "Quién lo declaró"]);

/**
 * Los casos de UN tipo, a la derecha del índice: su nombre con su ⓘ y cuántas veces por severidad; los casos en filas de
 * una o dos líneas, 10 por página (con buscador desde 11); cada fila abre su panel (todo lo que dice el registro con la
 * referencia de cada dato, los registros de la fuente y el proceso en que pesa); al pie, la fuente.
 */
function CasosDelTipo({ tipo, casos, ruc, rucDe }: { tipo: string; casos: AntecedenteEmpresa[]; ruc: string; rucDe: Map<string, string | null> }) {
  const titulo = casos[0].etiqueta;
  const explica = TIPO_CRUCE[tipo]?.explica;
  const porSev = (["alta", "media", "baja"] as const).map((sv) => ({ sv, n: casos.filter((c) => c.severidad === sv).length })).filter((x) => x.n);
  const mixto = porSev.length > 1;
  const fuente = casos[0]?.fuente;
  // El pie del tipo lleva al registro de sus casos si es uno solo para todos (la ficha de la empresa en el RNP); si no, a
  // la consulta de la fuente. Antes llevaba al del primer caso, que no era el de los demás.
  const urls = new Set(casos.map((c) => c.fuenteUrl));
  const enlaceTipo = urls.size === 1 && casos[0].fuenteUrl ? casos[0].fuenteUrl : fuente ? PORTADA[fuente] ?? null : null;
  const filas = juntarIguales(casos, ruc);
  const detalles: DetalleFila[] = [];
  const items = filas.map((f, k) => {
    const id = `${tipo}-${k}`;
    const a = f.casos[0];
    const rucEntidad = rucEntidadDe(a, rucDe);
    // «Órdenes que pasan 8 UIT»: el caso son órdenes; su panel lleva a esas órdenes.
    detalles.push({ id, ...(tipo === "fraccionamiento" ? detalleFraccionamiento(f, ruc, rucEntidad) : detalleCaso(f, ruc, explica)) });
    return {
      id,
      // Sin nombres de personas (socio, visitante, funcionario): no se buscan (docs/PRIVACIDAD.md).
      buscable: `${f.datos.filter((x) => !ES_PERSONA.has(x.etiqueta)).map((x) => x.valor).join(" ")} ${a.entidad ?? ""} ${procesosDe(f.casos).map((c) => c.codigo ?? "").join(" ")}`,
      contenido: <FilaCaso id={id} fila={f} tipo={tipo} mixto={mixto} rucEntidad={rucEntidad} />,
    };
  });
  const idTitulo = `antecedente-${tipo}`;
  return (
    <section aria-labelledby={idTitulo} className="tarjeta rounded-2xl border border-line bg-paper">
      <header className="space-y-1 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-start gap-1">
          <h3 id={idTitulo} className="font-display text-bloque font-bold leading-snug text-ink text-pretty">
            {titulo}
          </h3>
          {explica && (
            <Ayuda titulo="¿Qué quiere decir?" etiqueta={`Qué quiere decir «${titulo}»`} className="mt-0.5">
              {explica}
            </Ayuda>
          )}
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Cuántas veces, por severidad">
          {porSev.map((x) => (
            <li key={x.sv} className="inline-flex items-center gap-1.5">
              <Severidad bandera={x.sv} formato="linea" />
              <span className="text-meta tabular-nums text-inkSoft">{plural(x.n, "vez", "veces")}</span>
            </li>
          ))}
          {!casos.some((c) => c.ocid) && <li className="text-meta text-mute">De la empresa, no de un proceso</li>}
          {filas.length < casos.length && <li className="text-meta text-mute">Un mismo registro que pesa en varios procesos va en una fila</li>}
        </ul>
      </header>
      <div className="px-4 sm:px-5">
        <ProveedorDetalle detalles={detalles} nombre={titulo}>
          <ListaPaginada
            items={items}
            tam={10}
            nombre="casos"
            className="-mx-4 divide-y divide-line/70 border-t border-line/70 sm:-mx-5"
            buscar={{ placeholder: "Buscar por entidad, código o dato…", etiqueta: `Buscar en ${titulo.toLowerCase()}` }}
          />
        </ProveedorDetalle>
      </div>
      <footer className="border-t border-line/70 px-4 py-3 sm:px-5">
        <FuenteDato fuente={fuente ? FUENTE[fuente] ?? fuente : "Cruces de Vigía"} href={enlaceTipo} />
      </footer>
    </section>
  );
}

/**
 * La pestaña Antecedentes como lista y detalle (pedido del usuario del 2026-11-05: 11 pantallas en el escritorio y 30.5
 * en el celular para MEDIFARMA, con los 16 tipos apilados): a la izquierda el índice de tipos, de la señal más alta a la
 * más baja y, a igual severidad, el que más veces aparece; a la derecha los casos del elegido (`?atipo=`, el mismo
 * parámetro que usan las banderas de la cabecera y los enlaces de Su gente). El índice reemplaza al filtro de tipo y al
 * de severidad: la severidad de cada tipo se ve en su entrada.
 */
export async function AntecedentesEmpresa({
  datos,
  clientes,
  ruc,
}: {
  datos: Promise<{ total: number; data: AntecedenteEmpresa[] } | null>;
  /** Sus clientes (la misma promesa de la pestaña Clientes): el RUC de la entidad de cada caso, por su nombre. */
  clientes: Promise<{ total: number; data: ClienteEmpresa[] } | null>;
  ruc: string;
}) {
  const [d, cl] = await Promise.all([datos, clientes]);
  if (!d) return <NoCargo que="sus antecedentes" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Ningún otro registro la nombra">
        No figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de campaña, las autoridades y candidatos,
        ni en los demás cruces de Vigía.
      </EstadoVacio>
    );
  }
  const rucDe = rucPorNombre(cl?.data ?? []);
  const grupos = new Map<string, AntecedenteEmpresa[]>();
  for (const a of d.data) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const tipos = [...grupos.entries()].sort(
    ([, a], [, b]) => RANGO_SEVERIDAD[peorSeveridad(a) ?? "baja"] - RANGO_SEVERIDAD[peorSeveridad(b) ?? "baja"] || b.length - a.length,
  );
  const indice: TipoDelIndice[] = tipos.map(([tipo, casos]) => {
    const porSev = (["alta", "media", "baja"] as const).map((sv) => ({ sv, n: casos.filter((c) => c.severidad === sv).length })).filter((x) => x.n);
    const nombre = casos[0].etiqueta;
    // El chip del celular: el nombre corto del cruce si entra en un chip; si no, el de su bandera («Fuera por formalidad»).
    const corto = TIPO_CRUCE[tipo]?.corto;
    return {
      clave: tipo,
      nombre,
      corto: CORTO_EMPRESA[tipo] ?? (corto && corto.length <= 32 ? corto : TIPO_CRUCE[tipo]?.chip ?? corto) ?? nombre,
      severidad: peorSeveridad(casos) ?? "baja",
      n: casos.length,
      resumen:
        porSev.length > 1
          ? `${plural(casos.length, "vez", "veces")}: ${listaY(porSev.map((x, i) => `${numero(x.n)} de ${i === 0 ? "señal " : ""}${x.sv}`))}`
          : plural(casos.length, "vez", "veces"),
      contenido: <CasosDelTipo tipo={tipo} casos={casos} ruc={ruc} rucDe={rucDe} />,
    };
  });
  return (
    <IndiceAntecedentes
      tipos={indice}
      param={P_ANTECEDENTES.tipo}
      titulo={`${plural(indice.length, "tipo de registro", "tipos de registro")}, lo más grave primero`}
    />
  );
}

/**
 * La fuente de un caso, con el enlace a SU registro (la API ya da el más preciso: el proceso en el OECE, la ficha de la
 * empresa en el RNP, el reporte de visitas de su mes) y, debajo, el proceso en que pesa en Contrataciones Abiertas, la
 * obra en INFOBRAS y la inversión en el seguimiento del MEF, si los tiene. Sin repetir el de la fuente.
 */
function FuenteCaso({ a }: { a: AntecedenteEmpresa }) {
  const obra = txt(a.detalle.obra);
  const cui = txt(a.detalle.cui);
  const todos: EnlaceFuente[] = [
    ...(a.ocid ? enlacesProceso(a.ocid, { codigo: a.codigo }) : []),
    ...(obra ? [{ texto: `La obra ${obra} en INFOBRAS`, href: obraInfobras(obra) }] : []),
    ...(cui ? [{ texto: `La inversión ${cui} en el seguimiento del MEF`, href: inversionSsi(cui) }] : []),
  ];
  const enlaces = todos.filter((x, i) => x.href !== a.fuenteUrl && todos.findIndex((y) => y.href === x.href) === i);
  return <FuenteDato fuente={FUENTE[a.fuente] ?? a.fuente} href={a.fuenteUrl ?? PORTADA[a.fuente] ?? null} enlaces={enlaces} />;
}

/** Los procesos sobre los que pesa un mismo registro (una fila que junta varios), cada uno con el enlace a su ficha. */
function ProcesosDelCaso({ procesos }: { procesos: AntecedenteEmpresa[] }) {
  return (
    <BloqueDetalle titulo={`Pesa sobre ${numero(procesos.length)} procesos`}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-dato">
        {procesos.map((c) => (
          <li key={c.ocid}>
            <Link href={rutaContrato(c.ocid!, "ficha", { seccion: "antecedentes" })} prefetch={false} className={VERDE}>
              Proceso <span className="font-mono tabular-nums">{c.codigo ?? c.ocid}</span>
            </Link>
          </li>
        ))}
      </ul>
    </BloqueDetalle>
  );
}

/**
 * ¿Le vende al gobierno que encabeza? La autoridad electa de su gente y lo que cada entidad de ese gobierno (la
 * municipalidad; un gobierno regional y sus unidades) le compró a la empresa mientras ejercía, según CONOSCE. Es lo que
 * decide si el antecedente pesa: la ley impide contratar con la entidad donde la autoridad ejerce.
 */
function GobiernoQueEncabeza({ r, cargo, ruc }: { r: ReferenciasAntecedente; cargo: string | null; ruc: string }) {
  const g = r.gobierno;
  if (!g) return null;
  const c = (cargo ?? "").toUpperCase();
  const integra = /REGIDOR|CONSEJER/.test(c);
  const sujeto = g.nivel === "regional" ? "el gobierno regional" : "la municipalidad";
  const verbo = integra ? (r.vigente === false ? "que integró" : "que integra") : r.vigente === false ? "que encabezó" : "que encabeza";
  const desde = g.desde?.slice(0, 4);
  const hasta = r.vigente ? "hoy" : g.hasta?.slice(0, 4);
  const periodo = desde ? `entre ${desde} y ${hasta ?? "hoy"}` : "en su periodo";
  const compraron = g.entidades.filter((e) => e.ordenes + e.procesos > 0);
  const principal = g.entidades[0];
  return (
    <BloqueDetalle titulo={`¿Le vende a ${sujeto} ${verbo}?`}>
      {compraron.length === 0 ? (
        <p className="text-dato text-inkSoft">
          <b className="font-semibold text-ink">No.</b>{" "}
          {g.entidades.length === 1 && principal ? (
            <>
              <Link href={`/entidad/${principal.ruc}`} className={VERDE}>{principal.nombre ? tituloNatural(principal.nombre) : `RUC ${principal.ruc}`}</Link>{" "}
              no le dio órdenes ni le adjudicó procesos {periodo}, según CONOSCE.
            </>
          ) : (
            <>Ninguna de las {numero(g.entidades.length)} entidades de {sujeto} le dio órdenes ni le adjudicó procesos {periodo}, según CONOSCE.</>
          )}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-dato text-inkSoft">
            <b className="font-semibold text-ink">Sí.</b> {compraron.length === 1 ? "Esta entidad le compró" : `Estas ${numero(compraron.length)} entidades le compraron`} {periodo}, según CONOSCE:
          </p>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {compraron.map((e) => (
              <li key={e.ruc} className="space-y-1 px-3.5 py-2.5">
                <Link href={`/entidad/${e.ruc}`} className={`${VERDE} text-dato font-medium`}>{e.nombre ? tituloNatural(e.nombre) : `RUC ${e.ruc}`}</Link>
                <ul className="space-y-0.5 text-meta text-inkSoft">
                  {e.procesos > 0 && (
                    <li>
                      <Link href={rutaEmpresa(ruc, "contratos", { [P_CONTRATOS.entidad]: e.ruc })} className={VERDE}>
                        {plural(e.procesos, "proceso", "procesos")}
                      </Link>{" "}
                      por <span className="font-mono tabular-nums text-ink">{soles(e.montoProcesos)}</span>
                    </li>
                  )}
                  {e.ordenes > 0 && (
                    <li>
                      <Link href={rutaEmpresa(ruc, "ordenes", { [P_ORDENES.entidad]: e.ruc })} className={VERDE}>
                        {plural(e.ordenes, "orden", "órdenes")}
                      </Link>{" "}
                      por <span className="font-mono tabular-nums text-ink">{soles(e.montoOrdenes)}</span>
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </BloqueDetalle>
  );
}

/**
 * El panel de un caso: todo lo que dice el registro con la referencia de cada dato (la persona en «Su gente», el partido,
 * la entidad, la otra empresa, el proceso), lo que pesa (en una autoridad, si le vende al gobierno que encabeza; en un
 * patrón de visitas, cada visita), los registros de la fuente (a pedido) y por qué se marca. Antes: datos sin enlaces y,
 * en 20 tipos, sólo la fecha. Una fila que junta varios procesos los lista todos, con su enlace.
 */
function detalleCaso(f: FilaCasos, ruc: string, explica?: string): Omit<DetalleFila, "id"> {
  const a = f.casos[0];
  const procesos = procesosDe(f.casos);
  const varios = procesos.length > 1;
  const datos = varios ? f.datos.filter((x) => !DEL_PROCESO.has(x.etiqueta)) : f.datos;
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  const gente = aSuGente(a, ruc);
  const patronVisitas = esPatronVisita(a.tipo) && a.visitas.length > 0;
  return {
    titulo: a.etiqueta,
    descripcion: entidad ?? (a.ocid ? undefined : "De la empresa, no de un proceso"),
    contenido: (
      <CuerpoDetalle>
        <DatosClave items={datos.map((x) => ({ etiqueta: x.etiqueta, valor: <ValorCaso x={x} />, mono: x.mono }))} />
        {varios && <ProcesosDelCaso procesos={procesos} />}
        {a.tipo === "autoridad" && a.referencias?.gobierno && (
          <GobiernoQueEncabeza r={a.referencias} cargo={(a.detalle.cargo as string | undefined) ?? a.referencias.cargo ?? null} ruc={ruc} />
        )}
        {patronVisitas && <VisitasDelCaso visitas={a.visitas} />}
        {a.referencias?.clave && CON_EVIDENCIA.test(a.tipo) && (
          <BloqueDetalle titulo="Los registros de la fuente">
            <EvidenciaDelAntecedente ruc={ruc} tipo={a.tipo} clave={a.referencias.clave} />
          </BloqueDetalle>
        )}
        {explica && (
          <BloqueDetalle titulo="Por qué se marca">
            <p className="text-dato text-inkSoft">{explica}</p>
          </BloqueDetalle>
        )}
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={
          a.ocid && !varios ? (
            <EnlaceAccion href={rutaContrato(a.ocid, "ficha", { seccion: "antecedentes" })} flecha>Abrir el proceso</EnlaceAccion>
          ) : gente ? (
            <EnlaceAccion href={gente.href} flecha>{gente.texto}</EnlaceAccion>
          ) : undefined
        }
        secundarias={
          <>
            {a.ocid && !varios && gente && <EnlaceAccion href={gente.href} variante="secundario">{gente.texto}</EnlaceAccion>}
            <FuenteCaso a={a} />
          </>
        }
      />
    ),
  };
}

/**
 * El panel de un caso de «Órdenes que pasan 8 UIT»: qué días, cuántas órdenes y cuánto suman, cada día con sus órdenes
 * (a pedido) y adónde ir a verlas: la lista de Órdenes de la empresa filtrada por esa entidad (y por el año, si los días
 * caen en uno solo). El mismo registro suele pesar sobre varios procesos: van todos, con su enlace.
 */
function detalleFraccionamiento(f: FilaCasos, ruc: string, rucEntidad: string | null): Omit<DetalleFila, "id"> {
  const a = f.casos[0];
  const procesos = procesosDe(f.casos);
  const varios = procesos.length > 1;
  const datos = varios ? f.datos.filter((x) => !DEL_PROCESO.has(x.etiqueta)) : f.datos;
  const entidad = a.entidad ? tituloNatural(a.entidad) : null;
  const desde = txt(a.detalle.desde)?.slice(0, 4);
  const hasta = txt(a.detalle.hasta)?.slice(0, 4);
  const anio = desde && desde === hasta && Number(desde) >= 2018 ? desde : undefined;
  const ordenes = rucEntidad ? rutaEmpresa(ruc, "ordenes", { [P_ORDENES.entidad]: rucEntidad, [P_ORDENES.anio]: anio }) : null;
  return {
    titulo: entidad ? `Órdenes de ${entidad}` : "Órdenes que pasan 8 UIT",
    descripcion: "Órdenes menores del mismo día que juntas pasan el tope de 8 UIT",
    contenido: (
      <CuerpoDetalle>
        <DatosClave items={datos.map((x) => ({ etiqueta: x.etiqueta, valor: <ValorCaso x={x} />, mono: x.mono }))} />
        {varios && <ProcesosDelCaso procesos={procesos} />}
        {a.referencias?.clave && (
          <BloqueDetalle titulo="Cada día, con sus órdenes">
            <EvidenciaDelAntecedente ruc={ruc} tipo={a.tipo} clave={a.referencias.clave} />
          </BloqueDetalle>
        )}
        {!ordenes && (
          <p className="text-meta text-mute">
            No ubicamos esta entidad entre sus clientes por su nombre: búscala en la lista de Órdenes con el filtro de entidad.
          </p>
        )}
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={
          ordenes ? (
            <EnlaceAccion href={ordenes} flecha>
              {anio ? `Ver sus órdenes de ${anio} en esa entidad` : "Ver sus órdenes en esa entidad"}
            </EnlaceAccion>
          ) : (
            <EnlaceAccion href={rutaEmpresa(ruc, "ordenes")} flecha>Ver todas sus órdenes</EnlaceAccion>
          )
        }
        secundarias={
          <>
            {a.ocid && !varios && <EnlaceAccion href={rutaContrato(a.ocid, "ficha", { seccion: "antecedentes" })} variante="secundario">Abrir el proceso</EnlaceAccion>}
            <FuenteCaso a={a} />
          </>
        }
      />
    ),
  };
}
