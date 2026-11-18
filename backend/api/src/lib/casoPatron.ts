/**
 * La ficha de UN caso de un patrón (pedido del usuario del 2026-11-18: «cada patrón detectado debería tener una ficha
 * propia, que cuente una historia, con nodos, secciones, involucrados, timelines y demás, fuentes»). Antes un caso era
 * un panel lateral de /app/patrones que terminaba en «Ficha de la entidad»: un callejón.
 *
 * Un solo molde para todos los patrones (`CasoPatron`): la web lo cuenta igual en capítulos (qué pasó, quiénes, por qué
 * llama la atención, la evidencia, qué revisar) y cada patrón sólo arma sus datos. Las reglas no se repiten: el caso se
 * pide a la lista de su patrón (por dentro, con su filtro) y aquí sólo se agrega lo que una historia necesita: las
 * órdenes una por una, con fecha, y cuándo entró cada socio a cada empresa.
 *
 * Claves opacas (16 hex de un md5): el identificador de un grupo es un RUC y en 42 070 casos es un RUC 10, que nunca va
 * en una URL. Privacidad: todo sale por publicar() (personas con un apellido tapado, sin DNI ni RUC 10); los títulos no
 * llevan nombres de personas.
 */
import { pool } from "./db.js";
import { CONOSCE_BUSCADOR, CONSULTA_RUC_SUNAT, DATASET_DJI, DATASET_SOCIOS_RNP } from "./fuentes.js";
import { taparNombrePropio } from "../routes/personas.js";
import { nombrePublicable } from "./cruces.js";
import { salDeClaves } from "./privacidad.js";

export type Severidad = "alta" | "media" | "baja";

/** Un involucrado: la entidad, una empresa, una persona (con un apellido tapado) o un funcionario (sólo su cargo). */
export interface NodoCaso {
  id: string;
  tipo: "entidad" | "empresa" | "persona" | "funcionario";
  nombre: string;
  /** Su papel en el caso: «compró», «integrante del grupo», «socia de las tres empresas». */
  rol: string;
  href?: string | null;
  monto?: number | null;
  ordenes?: number | null;
  /** Lo que más pesa sobre él en el caso (pinta el nodo). */
  severidad?: Severidad | null;
  /** Datos en filas para su panel: «Fundada», «Le vende a la entidad desde»… */
  datos?: { etiqueta: string; valor: string }[];
}
export interface AristaCaso {
  de: string;
  a: string;
  texto: string;
  tipo: "vende" | "socio" | "pariente" | "apellidos" | "otro";
}
/** Un hecho de la historia del caso, con su fecha, quiénes y su fuente. */
export interface HitoCaso {
  fecha: string;
  hasta?: string | null;
  tipo: "fundacion" | "socio" | "salida" | "primera" | "ultima" | "anio" | "dia" | "repartido" | "sobre_tope" | "otro";
  titulo: string;
  detalle?: string | null;
  monto?: number | null;
  severidad?: Severidad | null;
  nodos?: string[];
  href?: string | null;
  fuente: string;
}
/** Una razón de por qué llama la atención: la cifra, qué dice y su gravedad (o null si no pesa). */
export interface RazonCaso {
  titulo: string;
  cifra: string;
  texto: string;
  severidad: Severidad | null;
}
/** Una fila de la evidencia: una orden, un contrato o un proceso, con su enlace. */
export interface FilaEvidencia {
  id: string;
  fecha: string | null;
  documento: string;
  quien: string | null;
  nodo?: string | null;
  que: string | null;
  monto: number | null;
  moneda?: string | null;
  estado?: string | null;
  /** Por qué está marcada: «mismo día que otra del grupo», «sobre el tope»… */
  marcas?: string[];
  href?: string | null;
}
export interface CasoPatron {
  tipo: string;
  clave: string;
  /** El nombre del patrón («Grupo de proveedores en una entidad») y el título del caso, sin nombres de personas. */
  patron: string;
  titulo: string;
  severidad: Severidad;
  observacion?: boolean;
  frase: string;
  entidad: { ruc: string; nombre: string | null } | null;
  desde: string | null;
  hasta: string | null;
  cifras: { etiqueta: string; valor: string; contexto?: string | null }[];
  /** Lo del caso año por año, en dos partes apiladas (en un grupo: el mayor integrante y los demás). */
  serie?: { titulo: string; etiquetaA: string; etiquetaB: string; anios: { anio: number; a: number; b: number; detalleA: string; detalleB: string }[] } | null;
  nodos: NodoCaso[];
  aristas: AristaCaso[];
  hitos: HitoCaso[];
  razones: RazonCaso[];
  /** `unidad`: qué son las filas, en plural («órdenes», «ventas», «contratos», «procesos»). */
  evidencia: { titulo: string; unidad?: string; total: number; filas: FilaEvidencia[]; nota?: string | null; masHref?: string | null };
  revisar: string[];
  fuentes: { texto: string; href: string }[];
  /** A dónde seguir en Vigía: la entidad, las empresas, el patrón en todo el país. */
  relacionados: { texto: string; href: string }[];
  como_leerlo: string;
}

/** Pide una ruta de las listas de patrones por dentro (sin salir a la red): la pasa el router. */
export type Pedir = (ruta: string) => Promise<Record<string, any> | null>;

const miles = (n: number) => Math.round(n).toLocaleString("es-PE");
const soles = (n: number | null | undefined) => {
  const x = Number(n ?? 0);
  if (x >= 1e6) return `S/ ${(x / 1e6).toLocaleString("es-PE", { maximumFractionDigits: 1 })} millones`;
  if (x >= 1e3) return `S/ ${Math.round(x / 1e3).toLocaleString("es-PE")} mil`;
  return `S/ ${miles(x)}`;
};
const plural = (n: number, uno: string, varios: string) => `${miles(n)} ${n === 1 ? uno : varios}`;
const titulo = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(«"/-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    // Las palabras chicas en minúscula ANTES de las siglas: al revés, la «E» de «E.I.R.L.» volvía a «e».
    .replace(/(?<=\s)(De|Del|La|Las|Los|Y|E|En|Para|Por|Con)(?=\s)/g, (m) => m.toLowerCase())
    .replace(/\b(S\.?a\.?c|E\.?i\.?r\.?l|S\.?a\.?a|S\.?r\.?l|S\.?a)\b\.?/gi, (m) => m.toUpperCase());
const fechaLarga = (f: string) => {
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  return `${d} de ${MES[m - 1]} de ${a}`;
};
const tapar = (raw: string | null | undefined) => (raw ? taparNombrePropio(nombrePublicable(raw), raw) ?? "Una persona" : null);
/**
 * El número de una orden («O/C-66-2021-Departamento…» → 66, «O/S-4505543033-2026-…» → 4505543033) para buscarla en la lista
 * de compras (3 cifras o más). Entero: cortado a 8 cifras parecía un DNI y publicar() lo tapaba en el enlace.
 */
const numeroDeOrden = (o: string) => /(\d+)/.exec(o)?.[1] ?? "";

/**
 * La clave opaca de un caso: 16 hex del md5 de una sal secreta y sus partes, calculada en SQL. `sal` es el número del
 * parámetro que lleva `salDeClaves()` («$8»). Sin sal, la de un grupo con un RUC 10 de identificador se revertía.
 */
export const sqlClaveGrupo = (sal: string) => `left(md5(${sal} || r.entidad_ruc || '|' || r.grupo), 16)`;
export { salDeClaves };

// ─── Grupo de proveedores en una entidad (migraciones 343-347, 350) ───────────────────────────────

/** Los papeles del RNP en palabras que no dicen el género de la persona (no se sabe). */
const ROL_RNP: Record<string, string> = {
  SOCIO_ACCIONISTA_TITULAR: "accionista",
  REPRESENTANTE_LEGAL: "representante legal",
  ORGANO_ADMINISTRACION: "parte de su administración",
};
/** «accionista, representante legal y parte de su administración». */
const roles = (xs: string[]) => {
  const u = [...new Set(xs.map((x) => ROL_RNP[x] ?? "parte de su conformación"))];
  return u.length > 1 ? `${u.slice(0, -1).join(", ")} y ${u[u.length - 1]}` : u[0] ?? "parte de su conformación";
};

export async function casoGrupo(clave: string, pedir: Pedir): Promise<CasoPatron | null> {
  const k = await pool.query<{ entidad_ruc: string; grupo: string }>(
    `SELECT r.entidad_ruc, r.grupo FROM grupo_proveedor_resumen r WHERE ${sqlClaveGrupo("$2")} = $1 LIMIT 1`, [clave, salDeClaves()]);
  const id = k.rows[0];
  if (!id) return null;
  const lista = await pedir(`/grupos?entidad=${id.entidad_ruc}&clave=${clave}&size=1`);
  const g = (lista?.data ?? [])[0] as Record<string, any> | undefined;
  if (!g) return null;
  const ent = { ruc: id.entidad_ruc, nombre: (g.entidad as string | null) ?? null };
  const entNombre = ent.nombre ? titulo(ent.nombre) : "la entidad";

  // Los integrantes con su RUC (sólo por dentro: el de una persona nunca sale) y un id de nodo.
  const miembrosRaw = await pool.query<{ ruc: string }>(`SELECT ruc FROM grupo_proveedor WHERE entidad_ruc = $1 AND grupo = $2`, [id.entidad_ruc, id.grupo]);
  const rucs = miembrosRaw.rows.map((x) => x.ruc);
  // Los de la lista: los de empresa por su RUC (el de una persona llega como referencia opaca y no se empareja).
  const miembros = (g.miembros ?? []) as { ruc: string; nombre: string | null; ordenes: number; monto: number; persona: boolean; codigo: string | null; parteDeSusVentas: number | null }[];
  const enLista = new Map(miembros.map((m) => [m.ruc, m]));
  // Cuántas órdenes y cuánto, y el nombre con que figura en ellas (el de una persona, con un apellido tapado).
  const [porMonto, codigos] = await Promise.all([
    pool.query<{ ruc: string; ordenes: number; monto: number; nombre: string | null }>(
      `SELECT ruc_contratista AS ruc, count(*)::int AS ordenes, COALESCE(sum(monto), 0)::float AS monto, max(contratista) AS nombre
         FROM conosce_ordenes WHERE entidad_ruc = $1 AND ruc_contratista = ANY($2) GROUP BY 1`, [id.entidad_ruc, rucs]),
    pool.query<{ ruc: string; codigo: string }>(`SELECT ruc, codigo FROM persona_codigo WHERE ruc = ANY($1)`, [rucs.filter((r) => !r.startsWith("20"))]),
  ]);
  const codigoDe = new Map(codigos.rows.map((x) => [x.ruc, x.codigo]));
  const nodoDe = new Map<string, string>();
  const nombreDe = new Map<string, string>();
  rucs.forEach((r, i) => {
    nodoDe.set(r, `m${i + 1}`);
    const tot = porMonto.rows.find((x) => x.ruc === r);
    const m = enLista.get(r);
    nombreDe.set(r, r.startsWith("20") ? titulo(m?.nombre ?? tot?.nombre ?? "Empresa del grupo") : tapar(tot?.nombre) ?? "Una persona que vende con su RUC");
  });
  const miembroDe = (r: string) => enLista.get(r);
  /** El nodo de una fila del detalle de la lista: por su RUC o, si era el de una persona (llega como referencia), por su nombre. */
  const nodoDeFila = (ruc: string, nombre: string | null) => {
    if (nodoDe.has(ruc)) return nodoDe.get(ruc);
    const r = [...nombreDe.entries()].find(([, n]) => n === nombre)?.[0];
    return r ? nodoDe.get(r) : undefined;
  };

  // Los vínculos con el nombre entero de la persona (sólo para buscarla en el RNP; sale tapada).
  const vinc = await pool.query<{ a: string; b: string; via: string; persona: string | null; persona_b: string | null }>(
    `SELECT v.a, v.b, v.via, v.persona, v.persona_b FROM grupo_proveedor_vinculo v
       JOIN grupo_proveedor g ON g.entidad_ruc = v.entidad_ruc AND g.ruc = v.a
      WHERE v.entidad_ruc = $1 AND g.grupo = $2`, [id.entidad_ruc, id.grupo]);
  const empresas20 = rucs.filter((r) => r.startsWith("20"));
  const personasRaw = [...new Set(vinc.rows.flatMap((v) => [v.persona, v.persona_b]).filter((x): x is string => !!x))];
  const [rnp, alta, ordenes, total] = await Promise.all([
    personasRaw.length && empresas20.length
      ? pool.query<{ ruc: string; nombre: string; rol: string; desde: string | null; baja: string | null }>(
          `SELECT ruc_empresa::text AS ruc, nombre, tipo_rol AS rol, to_char(min(fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde,
                  to_char(max(baja_corte), 'YYYY-MM-DD') AS baja
             FROM rnp_conformacion_juridica WHERE ruc_empresa = ANY($1::bpchar[]) AND nombre = ANY($2) GROUP BY 1, 2, 3`, [empresas20, personasRaw])
          .catch(() => ({ rows: [] }))
      : { rows: [] },
    empresas20.length
      ? pool.query<{ ruc: string; alta: string | null; estado: string | null }>(
          `SELECT ruc, to_char(fecha_alta, 'YYYY-MM-DD') AS alta, estado_sunat AS estado FROM empresa_resumen WHERE ruc = ANY($1)`, [empresas20])
      : { rows: [] },
    pool.query<{ ruc: string; fecha: string | null; orden: string | null; nro: string | null; tipo: string | null; que: string | null; estado: string | null; monto: number | null; moneda: string | null; contratacion: string | null }>(
      `SELECT ruc_contratista AS ruc, to_char(fecha_emision, 'YYYY-MM-DD') AS fecha, orden, nro_orden AS nro, tipo_orden AS tipo,
              left(COALESCE(descripcion, objeto), 220) AS que, estado, monto::float AS monto, moneda, tipo_contratacion AS contratacion
         FROM conosce_ordenes WHERE entidad_ruc = $1 AND ruc_contratista = ANY($2)
        ORDER BY fecha_emision DESC NULLS LAST LIMIT 1500`, [id.entidad_ruc, rucs]),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM conosce_ordenes WHERE entidad_ruc = $1 AND ruc_contratista = ANY($2)`, [id.entidad_ruc, rucs]),
  ]);

  // Las órdenes marcadas por la regla del grupo: los días con órdenes a varios integrantes, el objeto repartido y las de
  // sobre el tope (las trae la lista en su detalle).
  const marcas = new Map<string, Set<string>>();
  const marcar = (orden: string, m: string) => marcas.set(orden, (marcas.get(orden) ?? new Set()).add(m));
  for (const d of g.dias ?? []) for (const o of d.detalle ?? []) marcar(o.orden, d.correlativas ? "el mismo día que otra del grupo, número correlativo" : "el mismo día que otra del grupo");
  for (const x of g.objetosRepartidos ?? []) for (const o of x.detalle ?? []) marcar(o.orden, "el mismo objeto, repartido entre integrantes");
  for (const o of g.sobreTopeOrdenes ?? []) marcar(o.orden, "sobre el tope de 8 UIT");

  // ── Nodos y aristas ──
  const nodos: NodoCaso[] = [{ id: "e", tipo: "entidad", nombre: entNombre, rol: "La entidad que compró", href: `/entidad/${ent.ruc}?seccion=patrones&patron=grupos`, monto: g.monto, ordenes: g.ordenes }];
  const aristas: AristaCaso[] = [];
  const altaDe = new Map(alta.rows.map((x) => [x.ruc, x]));
  for (const r of rucs) {
    const m = miembroDe(r);
    const tot = porMonto.rows.find((x) => x.ruc === r);
    const n = nodoDe.get(r)!;
    const persona = !r.startsWith("20");
    const sobre = ordenes.rows.some((o) => o.ruc === r && marcas.get(o.orden ?? "")?.has("sobre el tope de 8 UIT"));
    const a = altaDe.get(r);
    nodos.push({
      id: n, tipo: persona ? "persona" : "empresa", nombre: nombreDe.get(r) ?? "Integrante",
      rol: persona ? "Vende con su RUC de persona natural" : "Integrante del grupo",
      href: persona ? (codigoDe.has(r) ? `/app/personas/${codigoDe.get(r)}` : null) : `/empresa/${r}?seccion=antecedentes&atipo=patron-grupos`,
      monto: tot?.monto ?? m?.monto ?? null, ordenes: tot?.ordenes ?? m?.ordenes ?? null,
      severidad: sobre ? "alta" : (m?.parteDeSusVentas ?? 0) >= 0.8 ? "media" : null,
      // (m es el de la lista: sólo existe para las empresas)
      datos: [
        a?.alta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(a.alta) } : null,
        a?.estado && !/ACTIVO/i.test(a.estado) ? { etiqueta: "Estado en la SUNAT", valor: titulo(a.estado) } : null,
        m?.parteDeSusVentas != null ? { etiqueta: "De sus ventas por órdenes, de esta entidad", valor: `${Math.round(m.parteDeSusVentas * 100)} %` } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    });
    aristas.push({ de: n, a: "e", tipo: "vende", texto: `${plural(tot?.ordenes ?? m?.ordenes ?? 0, "orden", "órdenes")} por ${soles(tot?.monto ?? m?.monto)}` });
  }
  // Los papeles de cada persona en cada empresa, juntos (el RNP trae una fila por papel: socio, representante, directivo).
  const porPersonaEmpresa = new Map<string, typeof rnp.rows>();
  for (const x of rnp.rows) porPersonaEmpresa.set(`${x.nombre}|${x.ruc}`, [...(porPersonaEmpresa.get(`${x.nombre}|${x.ruc}`) ?? []), x]);
  // Las personas que los unen (con un apellido tapado), una vez cada una.
  const nodoPersona = new Map<string, string>();
  const ponerPersona = (raw: string) => {
    if (nodoPersona.has(raw)) return nodoPersona.get(raw)!;
    const idp = `p${nodoPersona.size + 1}`;
    nodoPersona.set(raw, idp);
    const suyas = [...porPersonaEmpresa.entries()].filter(([k]) => k.startsWith(`${raw}|`));
    const deEmpresas = suyas.map(([k]) => k.split("|")[1]);
    nodos.push({
      id: idp, tipo: "persona", nombre: tapar(raw) ?? "Una persona",
      rol: deEmpresas.length > 1 ? `Figura en ${miles(deEmpresas.length)} empresas del grupo` : "Figura en una empresa del grupo",
      datos: suyas.map(([k, xs]) => {
        const desde = xs.map((x) => x.desde).filter((z): z is string => !!z).sort()[0];
        const baja = xs.every((x) => x.baja) ? xs.map((x) => x.baja!).sort().reverse()[0] : null;
        return { etiqueta: nombreDe.get(k.split("|")[1]) ?? "Empresa del grupo", valor: `${roles(xs.map((x) => x.rol))}${desde ? `, desde ${fechaLarga(desde)}` : ""}${baja ? `; ya no figura desde el corte de ${fechaLarga(baja)}` : ""}` };
      }),
    });
    return idp;
  };
  const vistos = new Set<string>();
  for (const v of vinc.rows) {
    if (v.via === "hermanos_probables" && v.persona && v.persona_b) {
      const p1 = ponerPersona(v.persona);
      const p2 = ponerPersona(v.persona_b);
      const k2 = [p1, p2].sort().join("|");
      if (!vistos.has(k2)) {
        vistos.add(k2);
        aristas.push({ de: p1, a: p2, tipo: "apellidos", texto: "los mismos dos apellidos (parentesco probable, no comprobado)" });
      }
      for (const [p, r] of [[p1, v.a], [p2, v.b]] as const) {
        const kk = `${p}|${r}`;
        if (!vistos.has(kk) && nodoDe.has(r)) {
          vistos.add(kk);
          aristas.push({ de: p, a: nodoDe.get(r)!, tipo: "socio", texto: roles((porPersonaEmpresa.get(`${p === p1 ? v.persona : v.persona_b}|${r}`) ?? []).map((x) => x.rol)) });
        }
      }
    } else if (v.persona) {
      const p = ponerPersona(v.persona);
      for (const r of [v.a, v.b]) {
        const kk = `${p}|${r}`;
        if (vistos.has(kk) || !nodoDe.has(r)) continue;
        vistos.add(kk);
        // «es_socio»: la persona que vende con su RUC es la misma persona (su nodo es el del integrante).
        aristas.push({ de: p, a: nodoDe.get(r)!, tipo: "socio", texto: v.via === "es_socio" && !r.startsWith("20") ? "es la misma persona, que vende con su RUC" : roles((porPersonaEmpresa.get(`${v.persona}|${r}`) ?? []).map((x) => x.rol)) });
      }
    }
  }
  // Funcionarios de la entidad que declararon a un integrante (o a su socio) como pariente: sólo su cargo.
  ((g.parientesDeFuncionarios ?? []) as { ruc: string; nombre: string | null; cargo: string | null; parentesco: string | null; via?: string }[]).forEach((d, i) => {
    const idf = `f${i + 1}`;
    const destino = [...nodoDe.entries()].find(([r]) => r === d.ruc || (!r.startsWith("20") && nombreDe.get(r) === d.nombre))?.[1];
    nodos.push({ id: idf, tipo: "funcionario", nombre: d.cargo ? titulo(d.cargo) : "Un funcionario de la entidad", rol: "Funcionario de la entidad (su declaración jurada)", severidad: "alta" });
    aristas.push({ de: idf, a: "e", tipo: "otro", texto: "trabaja en la entidad" });
    if (destino) aristas.push({ de: idf, a: destino, tipo: "pariente", texto: `${(d.parentesco ?? "pariente").toLowerCase()}${d.via === "socio" ? " de un socio o representante" : ""}, según su declaración jurada de intereses` });
  });

  // ── La historia, hecho por hecho ──
  const hitos: HitoCaso[] = [];
  for (const a of alta.rows) if (a.alta) hitos.push({ fecha: a.alta, tipo: "fundacion", titulo: `Se funda ${nombreDe.get(a.ruc) ?? "una empresa del grupo"}`, nodos: [nodoDe.get(a.ruc)!], fuente: "SUNAT (padrón RUC)" });
  for (const [k, xs] of porPersonaEmpresa) {
    const [nombre, ruc] = k.split("|");
    const p = nodoPersona.get(nombre);
    const quienes = [p, nodoDe.get(ruc)].filter((z): z is string => !!z);
    const desde = xs.map((x) => x.desde).filter((z): z is string => !!z).sort()[0];
    const baja = xs.every((x) => x.baja) ? xs.map((x) => x.baja!).sort().reverse()[0] : null;
    if (desde) hitos.push({ fecha: desde, tipo: "socio", titulo: `${tapar(nombre)} figura como ${roles(xs.map((x) => x.rol))} de ${nombreDe.get(ruc) ?? "una empresa del grupo"}`, nodos: quienes, fuente: "Registro Nacional de Proveedores (OECE)" });
    if (baja) hitos.push({ fecha: baja, tipo: "salida", titulo: `${tapar(nombre)} deja de figurar en ${nombreDe.get(ruc) ?? "una empresa del grupo"}`, detalle: "Fecha del corte del registro en que ya no aparece.", nodos: quienes, fuente: "Registro Nacional de Proveedores (OECE)" });
  }
  // Primera y última orden de cada integrante, y lo de cada año (todas las órdenes, no la muestra).
  const porAnio = await pool.query<{ ruc: string; anio: number; n: number; monto: number; primera: string; ultima: string }>(
    `SELECT ruc_contratista AS ruc, extract(year FROM fecha_emision)::int AS anio, count(*)::int AS n, COALESCE(sum(monto), 0)::float AS monto,
            to_char(min(fecha_emision), 'YYYY-MM-DD') AS primera, to_char(max(fecha_emision), 'YYYY-MM-DD') AS ultima
       FROM conosce_ordenes WHERE entidad_ruc = $1 AND ruc_contratista = ANY($2) AND fecha_emision IS NOT NULL GROUP BY 1, 2`, [id.entidad_ruc, rucs]);
  for (const r of rucs) {
    const xs = porAnio.rows.filter((x) => x.ruc === r);
    if (!xs.length) continue;
    const primera = xs.reduce((a, b) => (b.primera < a ? b.primera : a), xs[0].primera);
    hitos.push({ fecha: primera, tipo: "primera", titulo: `Primera orden de ${entNombre} a ${nombreDe.get(r)}`, nodos: [nodoDe.get(r)!, "e"], fuente: "CONOSCE (OECE)" });
  }
  const anios = [...new Set(porAnio.rows.map((x) => x.anio))].sort();
  for (const a of anios) {
    const xs = porAnio.rows.filter((x) => x.anio === a);
    const n = xs.reduce((t, x) => t + x.n, 0);
    const monto = xs.reduce((t, x) => t + x.monto, 0);
    hitos.push({
      fecha: `${a}-12-31`, tipo: "anio", titulo: `${a}: ${plural(n, "orden", "órdenes")} por ${soles(monto)} a ${plural(xs.length, "integrante", "integrantes")}`,
      detalle: xs.sort((p, q) => q.monto - p.monto).map((x) => `${nombreDe.get(x.ruc)}: ${plural(x.n, "orden", "órdenes")}, ${soles(x.monto)}`).join("; "),
      monto, nodos: [...xs.map((x) => nodoDe.get(x.ruc)!), "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&canio=${a}`,
    });
  }
  for (const d of (g.dias ?? []) as { fecha: string; ordenes: number; miembros: number; monto: number; correlativas: number; detalle: { ruc: string; nombre: string | null; orden: string; monto: number }[] }[]) {
    hitos.push({
      fecha: d.fecha, tipo: "dia", severidad: d.correlativas ? "alta" : "media", monto: d.monto,
      titulo: `El mismo día, ${plural(d.ordenes, "orden", "órdenes")} a ${plural(d.miembros, "integrante", "integrantes")} por ${soles(d.monto)}`,
      detalle: `${d.detalle.map((o) => `${o.orden} (${soles(o.monto)})`).join(", ")}${d.correlativas ? `. ${plural(d.correlativas, "par de números correlativos", "pares de números correlativos")}.` : "."}`,
      nodos: [...new Set(d.detalle.map((o) => nodoDeFila(o.ruc, o.nombre)).filter((z): z is string => !!z))],
      fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&canio=${d.fecha.slice(0, 4)}`,
    });
  }
  for (const x of (g.objetosRepartidos ?? []) as { anio: number; objeto: string; ordenes: number; miembros: number; monto: number; tope: number; detalle: { fecha: string }[] }[]) {
    const f = x.detalle.map((o) => o.fecha).sort()[0] ?? `${x.anio}-01-01`;
    hitos.push({
      fecha: f, tipo: "repartido", severidad: x.monto > x.tope ? "alta" : "media", monto: x.monto,
      titulo: `El mismo objeto, repartido: ${plural(x.ordenes, "orden", "órdenes")} a ${plural(x.miembros, "integrante", "integrantes")}`,
      detalle: `«${x.objeto}», ${soles(x.monto)} en ${x.anio}; el tope de una orden era ${soles(x.tope)}.`,
      fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&canio=${x.anio}`,
    });
  }
  for (const o of (g.sobreTopeOrdenes ?? []) as { ruc: string; nombre: string | null; orden: string; fecha: string; monto: number; tope: number; descripcion: string | null }[]) {
    hitos.push({
      fecha: o.fecha, tipo: "sobre_tope", severidad: "alta", monto: o.monto,
      titulo: `Una orden sobre el tope de 8 UIT: ${soles(o.monto)} (el tope era ${soles(o.tope)})`,
      detalle: `${o.orden}${o.descripcion ? `: «${o.descripcion.slice(0, 160)}»` : ""}`,
      fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&cq=${numeroDeOrden(o.orden)}&canio=${o.fecha.slice(0, 4)}`,
    });
  }
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

  // Año por año: lo del mayor integrante (por todo lo que vendió) y lo de los demás, apilado.
  const totalDe = new Map<string, number>();
  for (const x of porAnio.rows) totalDe.set(x.ruc, (totalDe.get(x.ruc) ?? 0) + x.monto);
  const mayor = [...totalDe.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const serie = mayor && anios.length > 1
    ? {
        titulo: "Lo que la entidad le compró al grupo, año por año",
        etiquetaA: nombreDe.get(mayor) ?? "El mayor integrante",
        etiquetaB: "Los demás integrantes",
        anios: anios.map((a) => {
          const xs = porAnio.rows.filter((x) => x.anio === a);
          const delMayor = xs.filter((x) => x.ruc === mayor);
          const otros = xs.filter((x) => x.ruc !== mayor);
          const suma = (ys: typeof xs) => ys.reduce((t, y) => t + y.monto, 0);
          const n = (ys: typeof xs) => ys.reduce((t, y) => t + y.n, 0);
          return {
            anio: a, a: suma(delMayor), b: suma(otros),
            detalleA: `${soles(suma(delMayor))} en ${plural(n(delMayor), "orden", "órdenes")}`,
            detalleB: `${soles(suma(otros))} en ${plural(n(otros), "orden", "órdenes")} de ${plural(otros.length, "integrante", "integrantes")}`,
          };
        }),
      }
    : null;

  // ── Por qué llama la atención ──
  const razones: RazonCaso[] = ([
    g.puestoGrupo && g.puestoMayor && g.puestoGrupo < g.puestoMayor
      ? { titulo: "Juntos pesan más", cifra: `n.° ${g.puestoGrupo}`, texto: `Sumados serían el proveedor n.° ${g.puestoGrupo} de la entidad; el mayor de ellos, solo, es el n.° ${g.puestoMayor}. Repartir las ventas entre empresas de los mismos dueños las hace parecer chicas.`, severidad: "media" as const }
      : null,
    g.parteEntidad != null
      ? { titulo: "Cuánto dependen de esta entidad", cifra: `${Math.round(g.parteEntidad * 100)} %`, texto: `De todo lo que el grupo le vendió al Estado por órdenes desde 2018, esa parte vino de ${entNombre}.`, severidad: g.parteEntidad >= 0.8 ? ("media" as const) : null }
      : null,
    g.hasta8Uit ? { titulo: "Al borde del tope de 8 UIT", cifra: `${miles(g.borde)} de ${miles(g.hasta8Uit)}`, texto: `De sus órdenes de hasta 8 UIT (las que no piden un proceso), ${miles(g.borde)} quedaron justo debajo del tope.`, severidad: g.borde > 0 && g.borde / g.hasta8Uit >= 0.3 ? ("media" as const) : null } : null,
    g.sobreTope ? { titulo: "Por encima del tope", cifra: miles(g.sobreTope), texto: "Órdenes que pasan el tope de 8 UIT sin un proceso de selección detrás.", severidad: "alta" as const } : null,
    g.diasJuntos ? { titulo: "El mismo día a varios integrantes", cifra: `${miles(g.diasJuntos)} ${g.diasJuntos === 1 ? "día" : "días"}`, texto: `Días en que la entidad emitió órdenes a dos o más empresas del grupo, por ${soles(g.montoJuntos)}. Si salieron del mismo requerimiento, es un fraccionamiento.`, severidad: g.correlativas ? ("alta" as const) : ("media" as const) } : null,
    g.correlativas ? { titulo: "Números correlativos", cifra: miles(g.correlativas), texto: "Pares de órdenes con números seguidos a integrantes distintos: se armaron juntas.", severidad: "alta" as const } : null,
    g.repartidos ? { titulo: "El mismo objeto, repartido", cifra: miles(g.repartidos), texto: `Objetos que se compraron en varias órdenes a integrantes distintos, por ${soles(g.montoRepartido)}.`, severidad: "alta" as const } : null,
    (g.parientesDeFuncionarios ?? []).length
      ? { titulo: "Parientes de funcionarios de la entidad", cifra: miles((g.parientesDeFuncionarios ?? []).length), texto: "Un funcionario de la entidad declaró a un integrante (o a su socio) como pariente en su declaración jurada de intereses.", severidad: "alta" as const }
      : null,
  ] as (RazonCaso | null)[]).filter((x): x is RazonCaso => !!x);

  // ── La evidencia: cada orden ──
  const filas: FilaEvidencia[] = ordenes.rows.map((o, i) => {
    const persona = !o.ruc.startsWith("20");
    const n = numeroDeOrden(o.orden ?? o.nro ?? "");
    const q = new URLSearchParams({ seccion: "contratos", ...(persona ? {} : { ccon: o.ruc }), ...(n.length >= 3 ? { cq: n } : {}), ...(o.fecha ? { canio: o.fecha.slice(0, 4) } : {}) });
    return {
      id: `o${i}`, fecha: o.fecha, documento: o.orden ?? o.nro ?? "Orden sin número", quien: nombreDe.get(o.ruc) ?? null, nodo: nodoDe.get(o.ruc) ?? null,
      que: o.que, monto: o.monto, moneda: o.moneda && !/sol/i.test(o.moneda) ? o.moneda : null, estado: o.estado,
      marcas: [...(marcas.get(o.orden ?? "") ?? [])],
      href: `/entidad/${ent.ruc}?${q}`,
    };
  });

  const sev: Severidad = g.severidad === "alta" ? "alta" : g.severidad === "media" ? "media" : "baja";
  const cuando = g.desde && g.hasta ? (g.desde.slice(0, 4) === g.hasta.slice(0, 4) ? `en ${g.desde.slice(0, 4)}` : `de ${g.desde.slice(0, 4)} a ${g.hasta.slice(0, 4)}`) : "";
  return {
    tipo: "grupos", clave, patron: "Grupo de proveedores en una entidad",
    titulo: `${plural(rucs.length, "proveedor", "proveedores")} de los mismos dueños en ${entNombre}`,
    severidad: sev, frase:
      `En ${entNombre}, ${plural(g.empresas, "empresa", "empresas")}${g.personas ? ` y ${plural(g.personas, "persona que vende", "personas que venden")} con su RUC` : ""} unidas por sus socios recibieron ` +
      `${plural(g.ordenes, "orden", "órdenes")} por ${soles(g.monto)}${cuando ? `, ${cuando}` : ""}.` +
      (g.puestoGrupo && g.puestoMayor && g.puestoGrupo < g.puestoMayor ? ` Juntos serían el proveedor n.° ${g.puestoGrupo} de la entidad; el mayor de ellos, solo, es el n.° ${g.puestoMayor}.` : ""),
    entidad: ent, desde: g.desde ?? null, hasta: g.hasta ?? null,
    cifras: [
      { etiqueta: "Órdenes de la entidad al grupo", valor: miles(g.ordenes), contexto: `por ${soles(g.monto)}` },
      { etiqueta: "Integrantes", valor: miles(rucs.length), contexto: [g.empresas ? plural(g.empresas, "empresa", "empresas") : null, g.personas ? plural(g.personas, "persona", "personas") : null].filter(Boolean).join(" y ") },
      { etiqueta: "Días con órdenes a varios", valor: miles(g.diasJuntos ?? 0), contexto: g.diasJuntos ? `por ${soles(g.montoJuntos)}` : "ninguno" },
      { etiqueta: "Al borde del tope de 8 UIT", valor: miles(g.borde ?? 0), contexto: g.hasta8Uit ? `de ${miles(g.hasta8Uit)} órdenes chicas` : "sin órdenes chicas" },
    ],
    serie, nodos, aristas, hitos, razones,
    evidencia: {
      titulo: "Las órdenes de la entidad al grupo", unidad: "órdenes", total: total.rows[0]?.n ?? filas.length, filas,
      nota: (total.rows[0]?.n ?? 0) > filas.length ? `Aquí van las ${miles(filas.length)} más recientes de ${miles(total.rows[0]?.n ?? 0)}; las demás están en las compras de la entidad.` : null,
      masHref: `/entidad/${ent.ruc}?seccion=contratos`,
    },
    revisar: [
      "Pide a la entidad los expedientes de las órdenes de los días destacados: si salieron de un mismo requerimiento, es un fraccionamiento.",
      "Confirma el parentesco con documentos (RENIEC, partidas): aquí sale de los apellidos y del Registro Nacional de Proveedores.",
      "Revisa quién pidió, cotizó, aprobó y dio conformidad a cada orden, y si los integrantes cotizaron unos contra otros.",
      "Compara las fechas en que entró cada socio con la primera orden de cada empresa: una empresa nueva que empieza a vender cuando entra el socio común es lo que más pesa.",
    ],
    fuentes: [
      { texto: "Órdenes de compra y de servicio (CONOSCE, OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Socios, representantes y directivos (Registro Nacional de Proveedores)", href: DATASET_SOCIOS_RNP },
      { texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT },
      ...((g.parientesDeFuncionarios ?? []).length ? [{ texto: "Declaraciones juradas de intereses (Contraloría)", href: DATASET_DJI }] : []),
    ],
    relacionados: [
      { texto: `Antecedentes y patrones de ${entNombre}`, href: `/entidad/${ent.ruc}?seccion=patrones&patron=grupos` },
      ...empresas20.slice(0, 6).map((r) => ({ texto: `Ficha de ${nombreDe.get(r) ?? "la empresa"}`, href: `/empresa/${r}` })),
      { texto: "Todos los grupos de proveedores del país", href: "/app/patrones?seccion=grupos" },
    ],
    como_leerlo:
      "Un grupo junta proveedores de una misma entidad unidos por un socio o representante común, por una persona que vende con su RUC y es socia de una empresa del grupo, o por socios con los mismos dos apellidos poco comunes (parentesco probable, no comprobado). Un patrón es un motivo para mirar, no una acusación.",
  };
}

// ─── Trabaja en compras y un familiar le vende a su entidad (migraciones 364-370) ────────────────

const MOMENTO: Record<string, string> = {
  en_puesto: "con la persona en el puesto",
  sin_familiar: "en el puesto, cuando el familiar aún no figuraba en la empresa",
  antes: "antes de que asumiera el puesto",
  despues: "después del puesto o de su última declaración",
  sin_fecha: "sin fecha de inicio del puesto",
};
const rutaContrato = (ocid: string) => `/app/contratos/${encodeURIComponent(ocid.replace(/^OECE-/i, ""))}`;

export async function casoComprasFamilia(clave: string, pedir: Pedir): Promise<CasoPatron | null> {
  const k = await pool.query<{ entidad_ruc: string }>(
    `SELECT k.entidad_ruc FROM funcionario_compras_familiar k
      WHERE md5(k.codigo || '|' || k.entidad_ruc || '|' || k.pariente || '|' || k.empresa_ruc) = $1 LIMIT 1`, [clave]);
  const ent0 = k.rows[0]?.entidad_ruc;
  if (!ent0) return null;
  const [lista, ventas] = await Promise.all([
    pedir(`/compras-familia?buscar=${ent0}&clave=${clave}&size=1`),
    pedir(`/compras-familia/ventas?clave=${clave}`),
  ]);
  const f = (lista?.data ?? [])[0] as Record<string, any> | undefined;
  // Sin fila (una autoridad electa: su parentesco va reservado) no hay caso.
  if (!f) return null;
  const v = (ventas?.ventas ?? []) as { tipo: string; fecha: string | null; monto: number | null; momento: string; orden: string | null; tipoOrden: string | null; estado: string | null; descripcion: string | null; nomenclatura: string | null; ocid: string | null }[];
  const empresa = (ventas?.empresa ?? null) as Record<string, any> | null;
  const ent = { ruc: f.entidadRuc as string, nombre: (f.entidad as string | null) ?? null };
  const entNombre = ent.nombre ? titulo(ent.nombre) : "la entidad";
  const parentesco = String(f.parentesco ?? "Familiar");
  const familiar = `${parentesco.charAt(0).toUpperCase()}${parentesco.slice(1).toLowerCase()}`;
  const cargo = f.cargo ? titulo(f.cargo) : "un puesto de compras";
  const viaEmpresa = f.via === "empresa" && f.empresaRuc;
  // «socio,representante legal,directivo» → «socio, representante legal y directivo».
  const papeles = (() => {
    const xs = String(f.rolEnEmpresa ?? "").split(/\s*,\s*/).filter(Boolean);
    return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] ?? "parte de su conformación";
  })();
  const empNombre = viaEmpresa ? titulo(f.empresa ?? empresa?.nombre ?? "su empresa") : null;

  // ── Nodos y aristas ──
  const nodos: NodoCaso[] = [
    { id: "e", tipo: "entidad", nombre: entNombre, rol: "La entidad que compró", href: `/entidad/${ent.ruc}?seccion=patrones&patron=compras` },
    {
      id: "f", tipo: "funcionario", nombre: f.persona ?? "Quien trabaja en compras", rol: `Declaró el puesto de «${cargo}»`, severidad: f.severidad === "alta" ? "alta" : "media",
      href: f.codigo ? `/app/personas/cargo/${f.codigo}` : null,
      datos: [
        { etiqueta: "Puesto declarado", valor: cargo },
        f.cargoDesde ? { etiqueta: "Desde", valor: fechaLarga(f.cargoDesde) } : null,
        f.cargoHasta ? { etiqueta: "Hasta", valor: fechaLarga(f.cargoHasta) } : f.vistoHasta ? { etiqueta: "Sigue en su última declaración", valor: fechaLarga(f.vistoHasta) } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    },
    {
      // El familiar nunca se nombra: sólo su parentesco.
      id: "p", tipo: "persona", nombre: familiar, rol: viaEmpresa ? `Figura en ${empNombre}` : "Recibe órdenes a su nombre",
      monto: viaEmpresa ? null : f.monto, ordenes: viaEmpresa ? null : f.ordenes, severidad: f.cercano ? "alta" : "media",
      datos: [
        { etiqueta: "Parentesco", valor: `${familiar}${f.cercano ? " (familiar cercano)" : ""}, según la declaración jurada de intereses del funcionario` },
        viaEmpresa && f.rolEnEmpresa ? { etiqueta: `En ${empNombre}`, valor: `${papeles}${f.parienteDesde ? `, desde ${fechaLarga(f.parienteDesde)}` : ""}` } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    },
  ];
  const aristas: AristaCaso[] = [
    { de: "f", a: "e", tipo: "otro", texto: `declaró el puesto de «${cargo}»` },
    { de: "f", a: "p", tipo: "pariente", texto: `${parentesco.toLowerCase()}, según su declaración jurada de intereses` },
  ];
  if (viaEmpresa) {
    nodos.push({
      id: "m", tipo: "empresa", nombre: empNombre!, rol: "La empresa del familiar", href: `/empresa/${f.empresaRuc}?seccion=antecedentes&atipo=patron-compras`,
      monto: f.monto, ordenes: f.ordenes, severidad: f.severidad === "alta" ? "alta" : "media",
      datos: [
        empresa?.fechaAlta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(empresa.fechaAlta) } : null,
        empresa?.estadoSunat && !/ACTIVO/i.test(empresa.estadoSunat) ? { etiqueta: "Estado en la SUNAT", valor: titulo(empresa.estadoSunat) } : null,
        empresa?.entidades ? { etiqueta: "Le vende a", valor: plural(empresa.entidades, "entidad", "entidades") } : null,
        empresa?.inhabilitada ? { etiqueta: "Sanción", valor: String(empresa.inhabilitada) } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    });
    aristas.push({ de: "p", a: "m", tipo: "socio", texto: papeles });
    aristas.push({ de: "m", a: "e", tipo: "vende", texto: `${plural(f.ordenes ?? 0, "orden", "órdenes")} por ${soles(f.monto)}${f.procesosEnPuesto ? ` y ${plural(f.procesosEnPuesto, "proceso", "procesos")}` : ""}` });
  } else {
    aristas.push({ de: "p", a: "e", tipo: "vende", texto: `${plural(f.ordenes ?? 0, "orden", "órdenes")} a su nombre por ${soles(f.monto)}` });
  }

  // ── La historia ──
  const hitos: HitoCaso[] = [];
  if (empresa?.fechaAlta) hitos.push({ fecha: empresa.fechaAlta, tipo: "fundacion", titulo: `Se funda ${empNombre}`, nodos: ["m"], fuente: "SUNAT (padrón RUC)" });
  if (f.parienteDesde) hitos.push({ fecha: f.parienteDesde, tipo: "socio", titulo: `El familiar (${parentesco.toLowerCase()}) figura en ${empNombre} como ${papeles}`, nodos: ["p", "m"], fuente: "Registro Nacional de Proveedores (OECE)" });
  if (f.cargoDesde) hitos.push({ fecha: f.cargoDesde, tipo: "otro", severidad: "media", titulo: `Asume el puesto de «${cargo}» en ${entNombre}`, detalle: "La fecha de inicio que declaró en su declaración jurada de intereses.", nodos: ["f", "e"], fuente: "Declaraciones juradas de intereses (Contraloría)" });
  if (f.cargoHasta) hitos.push({ fecha: f.cargoHasta, tipo: "salida", titulo: "Deja el puesto", detalle: "La fecha de cese que declaró.", nodos: ["f"], fuente: "Declaraciones juradas de intereses (Contraloría)" });
  else if (f.vistoHasta) hitos.push({ fecha: f.vistoHasta, tipo: "otro", titulo: "Su última declaración todavía lo nombra en el puesto", nodos: ["f"], fuente: "Declaraciones juradas de intereses (Contraloría)" });
  if (f.primeraEnPuesto) hitos.push({ fecha: f.primeraEnPuesto, tipo: "primera", severidad: f.cercano ? "alta" : "media", titulo: `Primera orden ${viaEmpresa ? `a ${empNombre}` : "al familiar"} con la persona en el puesto`, nodos: [viaEmpresa ? "m" : "p", "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&canio=${String(f.primeraEnPuesto).slice(0, 4)}${viaEmpresa ? `&ccon=${f.empresaRuc}` : ""}` });
  if (f.ultimaEnPuesto && f.ultimaEnPuesto !== f.primeraEnPuesto) hitos.push({ fecha: f.ultimaEnPuesto, tipo: "ultima", titulo: "Última orden con la persona en el puesto", nodos: [viaEmpresa ? "m" : "p", "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&canio=${String(f.ultimaEnPuesto).slice(0, 4)}${viaEmpresa ? `&ccon=${f.empresaRuc}` : ""}` });
  // Cada año: cuánto, y cuánto con la persona en el puesto.
  const anios = [...new Set(v.filter((x) => x.fecha).map((x) => Number(x.fecha!.slice(0, 4))))].sort();
  for (const a of anios) {
    const xs = v.filter((x) => x.fecha?.startsWith(String(a)));
    const enPuesto = xs.filter((x) => x.momento === "en_puesto");
    const suma = (ys: typeof xs) => ys.reduce((t, y) => t + (y.monto ?? 0), 0);
    hitos.push({
      fecha: `${a}-12-31`, tipo: "anio", severidad: enPuesto.length ? (f.cercano ? "alta" : "media") : null,
      titulo: `${a}: ${plural(xs.length, "venta", "ventas")} por ${soles(suma(xs))}${enPuesto.length ? `, ${miles(enPuesto.length)} con la persona en el puesto` : ""}`,
      detalle: [...new Set(xs.map((x) => x.momento))].map((m) => `${MOMENTO[m] ?? m}: ${plural(xs.filter((x) => x.momento === m).length, "venta", "ventas")}, ${soles(suma(xs.filter((x) => x.momento === m)))}`).join("; "),
      monto: suma(xs), nodos: [viaEmpresa ? "m" : "p", "e"], fuente: "CONOSCE y SEACE (OECE)",
      href: `/entidad/${ent.ruc}?seccion=contratos&canio=${a}${viaEmpresa ? `&ccon=${f.empresaRuc}` : ""}`,
    });
  }
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

  // Año por año: con la persona en el puesto y fuera de él.
  const serie = anios.length > 1
    ? {
        titulo: "Lo que la entidad le compró, año por año",
        etiquetaA: "Con la persona en el puesto",
        etiquetaB: "Antes, después o sin el familiar",
        anios: anios.map((a) => {
          const xs = v.filter((x) => x.fecha?.startsWith(String(a)));
          const dentro = xs.filter((x) => x.momento === "en_puesto");
          const fuera = xs.filter((x) => x.momento !== "en_puesto");
          const suma = (ys: typeof xs) => ys.reduce((t, y) => t + (y.monto ?? 0), 0);
          return { anio: a, a: suma(dentro), b: suma(fuera), detalleA: `${soles(suma(dentro))} en ${plural(dentro.length, "venta", "ventas")}`, detalleB: `${soles(suma(fuera))} en ${plural(fuera.length, "venta", "ventas")}` };
        }),
      }
    : null;

  // ── Por qué ──
  const razones: RazonCaso[] = ([
    f.ordenesEnPuesto
      ? { titulo: "Órdenes con la persona en el puesto", cifra: miles(f.ordenesEnPuesto), texto: `Por ${soles(f.montoEnPuesto)}, emitidas mientras tenía el puesto de «${cargo}».`, severidad: f.cercano ? "alta" : "media" }
      : { titulo: "Ninguna orden con la persona en el puesto", cifra: "0", texto: "Las ventas son de antes o de después del puesto: el impedimento rige mientras se interviene en las contrataciones.", severidad: null },
    f.procesosEnPuesto ? { titulo: "Procesos ganados con la persona en el puesto", cifra: miles(f.procesosEnPuesto), texto: `Por ${soles(f.montoProcesosEnPuesto)}.`, severidad: "alta" } : null,
    { titulo: "Parentesco", cifra: familiar, texto: f.cercano ? "Familiar cercano (cónyuge o conviviente, padres, hijos, hermanos): dentro del segundo grado que alcanza el impedimento." : "Familiar declarado; hay que ver si está dentro del segundo grado que alcanza el impedimento.", severidad: f.cercano ? "alta" : "media" },
    f.empezoDespues ? { titulo: "Empezó a venderle después de que asumiera", cifra: "Sí", texto: "Antes del puesto no le vendía a la entidad.", severidad: "media" } : null,
    { titulo: "Qué dice la ley", cifra: "Impedimento", texto: "La ley impide contratar con la entidad al cónyuge, conviviente y parientes hasta el segundo grado de quien interviene en sus contrataciones (artículo 11 del TUO de la Ley 30225; artículo 30 de la Ley 32069).", severidad: null },
  ] as (RazonCaso | null)[]).filter((x): x is RazonCaso => !!x);

  // ── Evidencia ──
  const filas: FilaEvidencia[] = v.map((x, i) => {
    const anio = x.fecha?.slice(0, 4);
    const n = x.orden ? numeroDeOrden(x.orden) : "";
    const q = new URLSearchParams({ seccion: "contratos", ...(viaEmpresa ? { ccon: f.empresaRuc } : {}), ...(n.length >= 3 ? { cq: n } : {}), ...(anio ? { canio: anio } : {}) });
    return {
      id: `v${i}`, fecha: x.fecha,
      // A nombre del familiar sólo hay fecha y monto (no se publica más).
      documento: x.tipo === "proceso" ? x.nomenclatura ?? "Proceso" : x.orden ?? (viaEmpresa ? "Orden" : "Orden a nombre del familiar"),
      quien: viaEmpresa ? empNombre : familiar, nodo: viaEmpresa ? "m" : "p",
      que: x.descripcion, monto: x.monto, estado: x.estado,
      marcas: [MOMENTO[x.momento] ?? x.momento],
      href: x.ocid ? rutaContrato(x.ocid) : `/entidad/${ent.ruc}?${q}`,
    };
  });

  const sev: Severidad = f.severidad === "alta" ? "alta" : f.severidad === "media" ? "media" : "baja";
  return {
    tipo: "compras", clave, patron: "Trabaja en compras y un familiar le vende a su entidad", observacion: true,
    titulo: `Trabaja en compras y ${viaEmpresa ? "la empresa de su familiar" : "su familiar"} le vende a ${entNombre}`,
    severidad: sev,
    frase:
      `${f.persona ?? "Quien trabaja en compras"} declaró el puesto de «${cargo}» en ${entNombre}${f.cargoDesde ? ` desde el ${fechaLarga(f.cargoDesde)}` : ""}. ` +
      `Su ${parentesco.toLowerCase()}${viaEmpresa ? ` figura en ${empNombre}, que` : ""} recibió ${plural(f.ordenes ?? 0, "orden", "órdenes")} de esa entidad por ${soles(f.monto)}` +
      (f.ordenesEnPuesto ? `; ${miles(f.ordenesEnPuesto)} de ellas, por ${soles(f.montoEnPuesto)}, mientras tenía el puesto.` : ", ninguna mientras tenía el puesto."),
    entidad: ent, desde: f.desde ?? null, hasta: f.hasta ?? null,
    cifras: [
      { etiqueta: "Ventas a la entidad", valor: miles(f.ordenes ?? 0), contexto: `por ${soles(f.monto)}` },
      { etiqueta: "Con la persona en el puesto", valor: miles(f.ordenesEnPuesto ?? 0), contexto: f.ordenesEnPuesto ? `por ${soles(f.montoEnPuesto)}` : "ninguna" },
      { etiqueta: "Antes del puesto", valor: miles(f.ordenesAntes ?? 0), contexto: null },
      { etiqueta: "Después del puesto", valor: miles(f.ordenesLuego ?? 0), contexto: null },
    ],
    serie, nodos, aristas, hitos, razones,
    evidencia: {
      titulo: viaEmpresa ? `Lo que ${entNombre} le compró a la empresa del familiar` : `Lo que ${entNombre} le compró al familiar`, unidad: "ventas",
      total: v.length, filas,
      nota: viaEmpresa ? null : "Las órdenes a nombre del familiar van sólo con su fecha y su monto: su nombre y su documento no se publican.",
      masHref: `/entidad/${ent.ruc}?seccion=contratos${viaEmpresa ? `&ccon=${f.empresaRuc}` : ""}`,
    },
    revisar: [
      "Pide a la entidad los expedientes de las órdenes emitidas mientras la persona tenía el puesto: quién hizo el requerimiento, quién cotizó, quién aprobó y quién dio la conformidad.",
      "Comprueba si la persona intervino en esas contrataciones (firmas, cuadros comparativos, actas) o si se abstuvo por escrito.",
      "Confirma el parentesco con documentos (RENIEC, partidas): aquí sale de su declaración jurada de intereses.",
      viaEmpresa ? "Revisa la participación del familiar en la empresa (el RNP no publica el porcentaje) y si la empresa declaró no estar impedida." : "Revisa si el familiar declaró no estar impedido al aceptar cada orden.",
    ],
    fuentes: [
      { texto: "Declaraciones juradas de intereses (Contraloría)", href: DATASET_DJI },
      { texto: "Órdenes de compra y de servicio (CONOSCE, OECE)", href: CONOSCE_BUSCADOR },
      ...(viaEmpresa ? [{ texto: "Socios, representantes y directivos (Registro Nacional de Proveedores)", href: DATASET_SOCIOS_RNP }, { texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT }] : []),
    ],
    relacionados: [
      ...(f.codigo ? [{ texto: "Ficha de la persona", href: `/app/personas/cargo/${f.codigo}` }] : []),
      { texto: `Antecedentes y patrones de ${entNombre}`, href: `/entidad/${ent.ruc}?seccion=patrones&patron=compras` },
      ...(viaEmpresa ? [{ texto: `Ficha de ${empNombre}`, href: `/empresa/${f.empresaRuc}` }] : []),
      { texto: "Todos los casos del país", href: "/app/patrones?seccion=compras" },
    ],
    como_leerlo: String(lista?.como_leerlo ?? "Un funcionario de compras y un familiar declarado que le vende a su entidad. Es una señal en observación: dice que el puesto, el parentesco y las órdenes coinciden, no que la persona intervino."),
  };
}

// ─── Lo que comparten los casos de un proveedor en una entidad ─────────────────────────────────

/** Las claves opacas de las listas de un proveedor en una entidad (con la sal: `sal` es el número de su parámetro). */
export const sqlClaveRepetida = (sal: string) => `left(md5(${sal} || x.entidad_ruc || '|' || x.ruc_contratista || '|' || x.desde || '|' || x.monto || '|' || COALESCE(x.objeto, '')), 16)`;
export const sqlClaveRecien = (sal: string) => `left(md5(${sal} || x.entidad_ruc || '|' || x.ruc_empresa), 16)`;

type FilaOrden = { fecha: string | null; orden: string | null; nro: string | null; que: string | null; estado: string | null; monto: number | null; moneda: string | null; contratacion: string | null };

/** Las órdenes de un proveedor a una entidad (las más recientes, con tope), cuántas son y lo de cada año. */
async function ordenesDelProveedor(entidad: string, ruc: string, tope = 1000) {
  const [filas, anios] = await Promise.all([
    pool.query<FilaOrden>(
      `SELECT to_char(fecha_emision, 'YYYY-MM-DD') AS fecha, orden, nro_orden AS nro, left(COALESCE(descripcion, objeto), 220) AS que, estado,
              monto::float AS monto, moneda, tipo_contratacion AS contratacion
         FROM conosce_ordenes WHERE entidad_ruc = $1 AND ruc_contratista = $2 ORDER BY fecha_emision DESC NULLS LAST LIMIT $3`, [entidad, ruc, tope]),
    pool.query<{ anio: number; n: number; monto: number; primera: string; ultima: string }>(
      `SELECT extract(year FROM fecha_emision)::int AS anio, count(*)::int AS n, COALESCE(sum(monto), 0)::float AS monto,
              to_char(min(fecha_emision), 'YYYY-MM-DD') AS primera, to_char(max(fecha_emision), 'YYYY-MM-DD') AS ultima
         FROM conosce_ordenes WHERE entidad_ruc = $1 AND ruc_contratista = $2 AND fecha_emision IS NOT NULL GROUP BY 1 ORDER BY 1`, [entidad, ruc]),
  ]);
  const total = anios.rows.reduce((t, x) => t + x.n, 0);
  return { filas: filas.rows, anios: anios.rows, total, primera: anios.rows[0]?.primera ?? null };
}

/** Una orden como fila de la evidencia, con su enlace a las compras de la entidad (sin el RUC de una persona). */
function filaDeOrden(o: FilaOrden, i: number, entidad: string, ruc: string, quien: string, marcas: string[]): FilaEvidencia {
  const n = numeroDeOrden(o.orden ?? o.nro ?? "");
  const q = new URLSearchParams({ seccion: "contratos", ...(ruc.startsWith("20") ? { ccon: ruc } : {}), ...(n.length >= 3 ? { cq: n } : {}), ...(o.fecha ? { canio: o.fecha.slice(0, 4) } : {}) });
  return {
    id: `o${i}`, fecha: o.fecha, documento: o.orden ?? o.nro ?? "Orden sin número", quien, nodo: "m", que: o.que, monto: o.monto,
    moneda: o.moneda && !/sol/i.test(o.moneda) ? o.moneda : null, estado: o.estado, marcas, href: `/entidad/${entidad}?${q}`,
  };
}

/** Los socios, representantes y directivos de una empresa en el RNP (nombres tapados), cuándo entraron y si salieron. */
async function genteDeEmpresa(ruc: string) {
  const r = await pool.query<{ nombre: string; rol: string; desde: string | null; baja: string | null }>(
    `SELECT nombre, tipo_rol AS rol, to_char(min(fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde, to_char(max(baja_corte), 'YYYY-MM-DD') AS baja
       FROM rnp_conformacion_juridica WHERE ruc_empresa = $1::bpchar GROUP BY 1, 2 ORDER BY 3 NULLS LAST LIMIT 60`, [ruc]).catch(() => ({ rows: [] }));
  const porPersona = new Map<string, typeof r.rows>();
  for (const x of r.rows) porPersona.set(x.nombre, [...(porPersona.get(x.nombre) ?? []), x]);
  return [...porPersona.entries()].slice(0, 12).map(([nombre, xs]) => ({
    nombre: tapar(nombre) ?? "Una persona",
    papeles: roles(xs.map((x) => x.rol)),
    desde: xs.map((x) => x.desde).filter((z): z is string => !!z).sort()[0] ?? null,
    baja: xs.every((x) => x.baja) ? xs.map((x) => x.baja!).sort().reverse()[0] : null,
  }));
}

/** La empresa en la SUNAT: alta y estado. */
async function empresaSunat(ruc: string) {
  if (!ruc.startsWith("20")) return null;
  const r = await pool.query<{ nombre: string | null; alta: string | null; estado: string | null; entidades: number | null }>(
    `SELECT nombre, to_char(fecha_alta, 'YYYY-MM-DD') AS alta, estado_sunat AS estado, entidades FROM empresa_resumen WHERE ruc = $1`, [ruc]).catch(() => ({ rows: [] }));
  return r.rows[0] ?? null;
}

/** La serie por año: lo marcado por el patrón y lo demás que le compró la entidad. */
function serieDeAnios(titulo: string, etiquetaA: string, etiquetaB: string, anios: { anio: number; n: number; monto: number }[], marcadoDe: (anio: number) => { n: number; monto: number }) {
  if (anios.length < 2) return null;
  return {
    titulo, etiquetaA, etiquetaB,
    anios: anios.map((x) => {
      const m = marcadoDe(x.anio);
      const resto = { n: Math.max(0, x.n - m.n), monto: Math.max(0, x.monto - m.monto) };
      return { anio: x.anio, a: m.monto, b: resto.monto, detalleA: `${soles(m.monto)} en ${plural(m.n, "orden", "órdenes")}`, detalleB: `${soles(resto.monto)} en ${plural(resto.n, "orden", "órdenes")}` };
    }),
  };
}

// ─── La misma compra repetida en semanas (migraciones 348-349) ─────────────────────────────────

export async function casoRepetida(clave: string, pedir: Pedir): Promise<CasoPatron | null> {
  const k = await pool.query<{ entidad_ruc: string; ruc_contratista: string; contratista: string | null }>(
    `SELECT x.entidad_ruc, x.ruc_contratista, x.contratista FROM ordenes_repetidas x WHERE ${sqlClaveRepetida("$2")} = $1 LIMIT 1`, [clave, salDeClaves()]);
  const id = k.rows[0];
  if (!id) return null;
  const lista = await pedir(`/repetidas?entidad=${id.entidad_ruc}&clave=${clave}&size=1`);
  const f = (lista?.data ?? [])[0] as Record<string, any> | undefined;
  if (!f) return null;
  const persona = !id.ruc_contratista.startsWith("20");
  const [ords, sunat, gente] = await Promise.all([
    ordenesDelProveedor(id.entidad_ruc, id.ruc_contratista),
    empresaSunat(id.ruc_contratista),
    persona ? Promise.resolve([]) : genteDeEmpresa(id.ruc_contratista),
  ]);
  const ent = { ruc: id.entidad_ruc, nombre: (f.entidad as string | null) ?? null };
  const entNombre = ent.nombre ? titulo(ent.nombre) : "la entidad";
  const prov = persona ? tapar(id.contratista) ?? "Una persona que vende con su RUC" : titulo(f.nombre ?? sunat?.nombre ?? "El proveedor");
  const det = (f.detalle ?? []) as { orden: string; fecha: string; estado: string | null }[];
  const repetidas = new Set(det.map((d) => d.orden));
  const objeto = f.objeto ? String(f.objeto) : "el mismo objeto";
  const pasa = Number(f.total) > Number(f.tope);

  const nodos: NodoCaso[] = [
    { id: "e", tipo: "entidad", nombre: entNombre, rol: "La entidad que compró", href: `/entidad/${ent.ruc}?seccion=patrones&patron=repetidas` },
    {
      id: "m", tipo: persona ? "persona" : "empresa", nombre: prov, rol: persona ? "Vende con su RUC de persona natural" : "El proveedor",
      href: persona ? null : `/empresa/${id.ruc_contratista}?seccion=antecedentes&atipo=patron-repetidas`,
      monto: ords.anios.reduce((t, x) => t + x.monto, 0), ordenes: ords.total, severidad: f.severidad === "alta" ? "alta" : "media",
      datos: [
        sunat?.alta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(sunat.alta) } : null,
        sunat?.estado && !/ACTIVO/i.test(sunat.estado) ? { etiqueta: "Estado en la SUNAT", valor: titulo(sunat.estado) } : null,
        ords.primera ? { etiqueta: "Le vende a la entidad desde", valor: fechaLarga(ords.primera) } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    },
  ];
  const aristas: AristaCaso[] = [{ de: "m", a: "e", tipo: "vende", texto: `${plural(ords.total, "orden", "órdenes")}; ${plural(f.ordenes, "repetida", "repetidas")} por ${soles(f.total)}` }];
  gente.forEach((g, i) => {
    nodos.push({ id: `p${i + 1}`, tipo: "persona", nombre: g.nombre, rol: `${g.papeles.charAt(0).toUpperCase()}${g.papeles.slice(1)} de la empresa`, datos: [g.desde ? { etiqueta: "Desde", valor: fechaLarga(g.desde) } : null, g.baja ? { etiqueta: "Ya no figura desde el corte de", valor: fechaLarga(g.baja) } : null].filter((x): x is { etiqueta: string; valor: string } => !!x) });
    aristas.push({ de: `p${i + 1}`, a: "m", tipo: "socio", texto: g.papeles });
  });

  const hitos: HitoCaso[] = [];
  if (sunat?.alta) hitos.push({ fecha: sunat.alta, tipo: "fundacion", titulo: `Se funda ${prov}`, nodos: ["m"], fuente: "SUNAT (padrón RUC)" });
  gente.forEach((g, i) => { if (g.desde) hitos.push({ fecha: g.desde, tipo: "socio", titulo: `${g.nombre} figura como ${g.papeles}`, nodos: [`p${i + 1}`, "m"], fuente: "Registro Nacional de Proveedores (OECE)" }); });
  if (ords.primera) hitos.push({ fecha: ords.primera, tipo: "primera", titulo: `Primera orden de ${entNombre} a ${prov}`, nodos: ["m", "e"], fuente: "CONOSCE (OECE)" });
  det.forEach((d, i) => {
    hitos.push({
      fecha: d.fecha, tipo: i === 0 ? "dia" : "repartido", severidad: f.severidad === "alta" ? "alta" : "media", monto: Number(f.monto),
      titulo: i === 0 ? `La compra: ${soles(f.monto)} por «${objeto.slice(0, 90)}»` : `La misma compra otra vez (${i + 1}.ª): ${soles(f.monto)}`,
      detalle: `${d.orden}${d.estado ? `, ${d.estado.toLowerCase()}` : ""}.${i === det.length - 1 && pasa ? ` Juntas suman ${soles(f.total)}: pasan el tope de una orden directa (${soles(f.tope)}).` : ""}`,
      nodos: ["m", "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&cq=${numeroDeOrden(d.orden)}&canio=${d.fecha.slice(0, 4)}${persona ? "" : `&ccon=${id.ruc_contratista}`}`,
    });
  });
  for (const a of ords.anios) hitos.push({ fecha: `${a.anio}-12-31`, tipo: "anio", titulo: `${a.anio}: ${plural(a.n, "orden", "órdenes")} por ${soles(a.monto)}`, monto: a.monto, nodos: ["m", "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&canio=${a.anio}${persona ? "" : `&ccon=${id.ruc_contratista}`}` });
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

  const razones: RazonCaso[] = ([
    { titulo: "La misma compra, varias veces", cifra: `${miles(f.ordenes)} órdenes`, texto: `Mismo proveedor, mismo monto (${soles(f.monto)}) y mismo objeto, en ${plural(f.dias, "día", "días")}.`, severidad: f.severidad === "alta" ? "alta" : "media" },
    pasa ? { titulo: "Juntas pasan el tope", cifra: soles(f.total), texto: `Una orden directa podía llegar a ${soles(f.tope)} (8 UIT). Partir una compra para quedar debajo del tope es fraccionamiento, que la ley prohíbe.`, severidad: "alta" } : { titulo: "Juntas no pasan el tope", cifra: soles(f.total), texto: `El tope de una orden directa era ${soles(f.tope)}.`, severidad: null },
    f.devengadas >= 2 ? { titulo: "Se devengaron", cifra: `${miles(f.devengadas)} de ${miles(f.ordenes)}`, texto: "Si eran la misma compra registrada dos veces y las dos se devengaron, pregunta si se pagó dos veces.", severidad: "media" } : null,
    { titulo: "Lo que puede explicarlo", cifra: "Suministro", texto: "Un suministro mensual o una compra periódica puede repetirse legítimamente: el requerimiento lo dice.", severidad: null },
  ] as (RazonCaso | null)[]).filter((x): x is RazonCaso => !!x);

  const filas = ords.filas.map((o, i) => filaDeOrden(o, i, ent.ruc, id.ruc_contratista, prov, repetidas.has(o.orden ?? "") ? ["la misma compra repetida"] : []));
  const sev: Severidad = f.severidad === "alta" ? "alta" : f.severidad === "media" ? "media" : "baja";
  return {
    tipo: "repetidas", clave, patron: "La misma compra repetida en semanas",
    titulo: persona ? `La misma compra repetida a una persona en ${entNombre}` : `La misma compra repetida a ${prov} en ${entNombre}`,
    severidad: sev,
    frase: `${entNombre} le compró a ${prov} lo mismo (${objeto.slice(0, 120)}), por el mismo monto (${soles(f.monto)}), ${plural(f.ordenes, "vez", "veces")} en ${plural(f.dias, "día", "días")}: ${soles(f.total)} en total${pasa ? `, por encima del tope de una orden directa (${soles(f.tope)})` : ""}.`,
    entidad: ent, desde: f.desde ?? null, hasta: f.hasta ?? null,
    cifras: [
      { etiqueta: "Órdenes repetidas", valor: miles(f.ordenes), contexto: `en ${plural(f.dias, "día", "días")}` },
      { etiqueta: "Juntas suman", valor: soles(f.total), contexto: `el tope era ${soles(f.tope)}` },
      { etiqueta: "Devengadas", valor: miles(f.devengadas ?? 0), contexto: `de ${miles(f.ordenes)}` },
      { etiqueta: "Todas sus órdenes de la entidad", valor: miles(ords.total), contexto: `por ${soles(ords.anios.reduce((t, x) => t + x.monto, 0))}` },
    ],
    serie: serieDeAnios("Lo que la entidad le compró, año por año", "La compra repetida", "Sus demás órdenes", ords.anios, (a) => {
      const n = det.filter((d) => d.fecha.startsWith(String(a))).length;
      return { n, monto: n * Number(f.monto) };
    }),
    nodos, aristas, hitos, razones,
    evidencia: {
      titulo: `Las órdenes de ${entNombre} a este proveedor`, unidad: "órdenes", total: ords.total, filas,
      nota: ords.total > filas.length ? `Aquí van las ${miles(filas.length)} más recientes de ${miles(ords.total)}.` : "Las repetidas van marcadas; las demás son el resto de lo que le compró.",
      masHref: `/entidad/${ent.ruc}?seccion=contratos${persona ? "" : `&ccon=${id.ruc_contratista}`}`,
    },
    revisar: [
      "Pide a la entidad los requerimientos de las órdenes repetidas: si son una sola necesidad partida, es un fraccionamiento.",
      "Compara las fechas de entrega y las conformidades: si se entregó una vez y se registraron dos órdenes, pregunta por el pago.",
      "Mira si en esos meses la entidad tenía un proceso para lo mismo (un proceso desierto o en curso explica compras de emergencia, no repetidas).",
    ],
    fuentes: [
      { texto: "Órdenes de compra y de servicio (CONOSCE, OECE)", href: CONOSCE_BUSCADOR },
      ...(persona ? [] : [{ texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT }, { texto: "Socios y representantes (Registro Nacional de Proveedores)", href: DATASET_SOCIOS_RNP }]),
    ],
    relacionados: [
      { texto: `Antecedentes y patrones de ${entNombre}`, href: `/entidad/${ent.ruc}?seccion=patrones&patron=repetidas` },
      ...(persona ? [] : [{ texto: `Ficha de ${prov}`, href: `/empresa/${id.ruc_contratista}` }]),
      { texto: "Todas las compras repetidas del país", href: "/app/patrones?seccion=repetidas" },
    ],
    como_leerlo: String(lista?.como_leerlo ?? "La misma compra en varias órdenes directas de 7 a 90 días entre sí."),
  };
}

// ─── Empresa recién creada con órdenes directas (migración 355) ────────────────────────────────

export async function casoRecien(clave: string, pedir: Pedir): Promise<CasoPatron | null> {
  const k = await pool.query<{ entidad_ruc: string; ruc_empresa: string }>(
    `SELECT x.entidad_ruc, x.ruc_empresa FROM empresa_recien_creada_ordenes x WHERE ${sqlClaveRecien("$2")} = $1 LIMIT 1`, [clave, salDeClaves()]);
  const id = k.rows[0];
  if (!id) return null;
  const lista = await pedir(`/recien?buscar=${id.entidad_ruc}&clave=${clave}&size=1`);
  const f = (lista?.data ?? [])[0] as Record<string, any> | undefined;
  if (!f) return null;
  const [ords, sunat, gente] = await Promise.all([ordenesDelProveedor(id.entidad_ruc, id.ruc_empresa), empresaSunat(id.ruc_empresa), genteDeEmpresa(id.ruc_empresa)]);
  const ent = { ruc: id.entidad_ruc, nombre: (f.entidad as string | null) ?? null };
  const entNombre = ent.nombre ? titulo(ent.nombre) : "la entidad";
  const emp = titulo(f.nombre ?? sunat?.nombre ?? "La empresa");
  const finPrimerAnio = f.primeraOrden ? `${Number(String(f.primeraOrden).slice(0, 4)) + 1}${String(f.primeraOrden).slice(4)}` : null;

  const nodos: NodoCaso[] = [
    { id: "e", tipo: "entidad", nombre: entNombre, rol: "La entidad que le compró", href: `/entidad/${ent.ruc}?seccion=patrones&patron=recien` },
    {
      id: "m", tipo: "empresa", nombre: emp, rol: `Recibió su primera orden ${plural(f.dias, "día", "días")} después de inscribirse`, href: `/empresa/${id.ruc_empresa}?seccion=antecedentes&atipo=patron-recien`,
      monto: f.monto, ordenes: f.ordenes, severidad: f.severidad === "alta" ? "alta" : "media",
      datos: [
        f.fechaAlta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(f.fechaAlta) } : null,
        sunat?.estado && !/ACTIVO/i.test(sunat.estado) ? { etiqueta: "Estado en la SUNAT", valor: titulo(sunat.estado) } : null,
        f.parteEntidad != null ? { etiqueta: "De sus ventas por órdenes, de esta entidad", valor: `${Math.round(f.parteEntidad * 100)} %` } : null,
        sunat?.entidades ? { etiqueta: "Le vende a", valor: plural(sunat.entidades, "entidad", "entidades") } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    },
  ];
  const aristas: AristaCaso[] = [{ de: "m", a: "e", tipo: "vende", texto: `${plural(f.ordenes, "orden", "órdenes")} por ${soles(f.monto)}` }];
  gente.forEach((g, i) => {
    nodos.push({ id: `p${i + 1}`, tipo: "persona", nombre: g.nombre, rol: `${g.papeles.charAt(0).toUpperCase()}${g.papeles.slice(1)} de la empresa`, datos: [g.desde ? { etiqueta: "Desde", valor: fechaLarga(g.desde) } : null, g.baja ? { etiqueta: "Ya no figura desde el corte de", valor: fechaLarga(g.baja) } : null].filter((x): x is { etiqueta: string; valor: string } => !!x) });
    aristas.push({ de: `p${i + 1}`, a: "m", tipo: "socio", texto: g.papeles });
  });

  const hitos: HitoCaso[] = [];
  if (f.fechaAlta) hitos.push({ fecha: f.fechaAlta, tipo: "fundacion", titulo: `Se inscribe ${emp} en la SUNAT`, nodos: ["m"], fuente: "SUNAT (padrón RUC)" });
  gente.forEach((g, i) => { if (g.desde) hitos.push({ fecha: g.desde, tipo: "socio", titulo: `${g.nombre} figura como ${g.papeles}`, nodos: [`p${i + 1}`, "m"], fuente: "Registro Nacional de Proveedores (OECE)" }); });
  if (f.primeraOrden) hitos.push({ fecha: f.primeraOrden, tipo: "primera", severidad: f.severidad === "alta" ? "alta" : "media", titulo: `Primera orden directa de ${entNombre}, ${plural(f.dias, "día", "días")} después de inscribirse`, nodos: ["m", "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&ccon=${id.ruc_empresa}&canio=${String(f.primeraOrden).slice(0, 4)}` });
  if (finPrimerAnio) hitos.push({ fecha: finPrimerAnio, tipo: "otro", severidad: f.severidad === "alta" ? "alta" : null, titulo: `En su primer año: ${plural(f.ordenesPrimerAnio, "orden", "órdenes")} por ${soles(f.montoPrimerAnio)}`, nodos: ["m", "e"], fuente: "CONOSCE (OECE)" });
  for (const a of ords.anios) hitos.push({ fecha: `${a.anio}-12-31`, tipo: "anio", titulo: `${a.anio}: ${plural(a.n, "orden", "órdenes")} por ${soles(a.monto)}`, monto: a.monto, nodos: ["m", "e"], fuente: "CONOSCE (OECE)", href: `/entidad/${ent.ruc}?seccion=contratos&ccon=${id.ruc_empresa}&canio=${a.anio}` });
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

  const razones: RazonCaso[] = ([
    { titulo: "De la inscripción a la primera orden", cifra: plural(f.dias, "día", "días"), texto: "Una orden directa (sin proceso) a una empresa que recién se había inscrito en la SUNAT: no tenía historia que mostrar.", severidad: f.dias <= 30 ? "alta" : "media" },
    { titulo: "Su primer año", cifra: soles(f.montoPrimerAnio), texto: `${plural(f.ordenesPrimerAnio, "orden", "órdenes")} de esta entidad en sus primeros doce meses.`, severidad: f.montoPrimerAnio >= 100000 ? "alta" : "media" },
    f.parteEntidad != null ? { titulo: "Cuánto depende de esta entidad", cifra: `${Math.round(f.parteEntidad * 100)} %`, texto: "De todo lo que le vendió al Estado por órdenes, esa parte vino de esta entidad.", severidad: f.parteEntidad >= 0.8 ? "media" : null } : null,
    gente.length ? { titulo: "Quién la creó", cifra: plural(gente.length, "persona", "personas"), texto: "Sus socios, representantes y directivos en el Registro Nacional de Proveedores, con la fecha en que figuran: mira si alguno trabajó en la entidad o ya le vendía con otra empresa.", severidad: null } : null,
  ] as (RazonCaso | null)[]).filter((x): x is RazonCaso => !!x);

  const filas = ords.filas.map((o, i) => filaDeOrden(o, i, ent.ruc, id.ruc_empresa, emp, o.fecha && finPrimerAnio && o.fecha < finPrimerAnio ? ["en su primer año"] : []));
  const sev: Severidad = f.severidad === "alta" ? "alta" : f.severidad === "media" ? "media" : "baja";
  return {
    tipo: "recien", clave, patron: "Empresa recién creada con órdenes directas",
    titulo: `${emp}: recién creada y ya le vendía a ${entNombre}`,
    severidad: sev,
    frase: `${emp} se inscribió en la SUNAT el ${f.fechaAlta ? fechaLarga(f.fechaAlta) : "(sin fecha)"} y ${plural(f.dias, "día", "días")} después ya tenía su primera orden directa de ${entNombre}. En su primer año recibió ${plural(f.ordenesPrimerAnio, "orden", "órdenes")} por ${soles(f.montoPrimerAnio)}; en total, ${plural(f.ordenes, "orden", "órdenes")} por ${soles(f.monto)}.`,
    entidad: ent, desde: f.primeraOrden ?? null, hasta: ords.anios[ords.anios.length - 1]?.ultima ?? null,
    cifras: [
      { etiqueta: "Días de la inscripción a la primera orden", valor: miles(f.dias), contexto: null },
      { etiqueta: "En su primer año", valor: soles(f.montoPrimerAnio), contexto: plural(f.ordenesPrimerAnio, "orden", "órdenes") },
      { etiqueta: "En total", valor: soles(f.monto), contexto: plural(f.ordenes, "orden", "órdenes") },
      { etiqueta: "De sus ventas, de esta entidad", valor: f.parteEntidad != null ? `${Math.round(f.parteEntidad * 100)} %` : "Sin dato", contexto: null },
    ],
    serie: null, nodos, aristas, hitos, razones,
    evidencia: {
      titulo: `Las órdenes de ${entNombre} a ${emp}`, unidad: "órdenes", total: ords.total, filas,
      nota: ords.total > filas.length ? `Aquí van las ${miles(filas.length)} más recientes de ${miles(ords.total)}.` : null,
      masHref: `/entidad/${ent.ruc}?seccion=contratos&ccon=${id.ruc_empresa}`,
    },
    revisar: [
      "Pide a la entidad el requerimiento y las cotizaciones de la primera orden: quién propuso a la empresa y contra quién cotizó.",
      "Mira quiénes son sus socios y representantes: si alguno trabajó en la entidad o ya le vendía con otra empresa, el negocio no es nuevo.",
      "Revisa su domicilio fiscal y su actividad en la SUNAT frente a lo que vendió.",
    ],
    fuentes: [
      { texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT },
      { texto: "Órdenes de compra y de servicio (CONOSCE, OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Socios y representantes (Registro Nacional de Proveedores)", href: DATASET_SOCIOS_RNP },
    ],
    relacionados: [
      { texto: `Ficha de ${emp}`, href: `/empresa/${id.ruc_empresa}` },
      { texto: `Antecedentes y patrones de ${entNombre}`, href: `/entidad/${ent.ruc}?seccion=patrones&patron=recien` },
      { texto: "Todas las empresas recién creadas del país", href: "/app/patrones?seccion=recien" },
    ],
    como_leerlo: String(lista?.como_leerlo ?? "Una empresa que se inscribió en la SUNAT y a los pocos días ya recibía órdenes directas de una entidad."),
  };
}

// ─── Un mismo dueño gana en una entidad con varias empresas (migraciones 292-293) ──────────────

export const sqlClaveDueno = (sal: string) => `left(md5(${sal} || g.entidad_ruc || '|' || g.nombre), 16)`;
const NOTA_SEGUIDO = "a 90 días o menos de otro parecido de una empresa hermana";

export async function casoDueno(clave: string, pedir: Pedir): Promise<CasoPatron | null> {
  // El documento del socio sólo sirve aquí adentro para encontrar sus filas: nunca sale.
  const k = await pool.query<{ entidad_ruc: string; persona_doc: string; rucs: string[] }>(
    `SELECT g.entidad_ruc, g.persona_doc, g.rucs FROM mismo_dueno_grupo g WHERE ${sqlClaveDueno("$2")} = $1 LIMIT 1`, [clave, salDeClaves()]);
  const id = k.rows[0];
  if (!id) return null;
  const lista = await pedir(`/duenos?ruc=${id.entidad_ruc}&clave=${clave}&size=1`);
  const f = (lista?.data ?? [])[0] as Record<string, any> | undefined;
  if (!f) return null;
  const rucs = id.rucs.filter((r) => /^20\d{9}$/.test(r));
  const [contratos, rnp, sunat] = await Promise.all([
    pool.query<{ ocid: string; ruc: string; severidad: string | null; fecha: string | null; monto: number | null; objeto: string | null; codigo: string | null; tipo: string | null }>(
      `SELECT DISTINCT ON (x.ocid, x.ruc_empresa) x.ocid, x.ruc_empresa AS ruc, x.severidad, to_char(x.fecha, 'YYYY-MM-DD') AS fecha, x.monto::float AS monto,
              left(c.objeto, 220) AS objeto, c.codigo, c.tipo_proceso AS tipo
         FROM cruces_proveedor x JOIN convocatorias c ON c.ocid = x.ocid
        WHERE x.tipo = 'mismo_dueno' AND x.persona_doc = $1 AND c.entidad_ruc = $2 AND x.ruc_empresa = ANY($3)
        ORDER BY x.ocid, x.ruc_empresa, (x.severidad = 'alta') DESC LIMIT 800`, [id.persona_doc, id.entidad_ruc, rucs]),
    pool.query<{ ruc: string; rol: string; desde: string | null; baja: string | null }>(
      `SELECT ruc_empresa::text AS ruc, tipo_rol AS rol, to_char(min(fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde, to_char(max(baja_corte), 'YYYY-MM-DD') AS baja
         FROM rnp_conformacion_juridica WHERE numero_documento = $1 AND ruc_empresa = ANY($2::bpchar[]) GROUP BY 1, 2`, [id.persona_doc, rucs]).catch(() => ({ rows: [] })),
    pool.query<{ ruc: string; nombre: string | null; alta: string | null; estado: string | null }>(
      `SELECT ruc, nombre, to_char(fecha_alta, 'YYYY-MM-DD') AS alta, estado_sunat AS estado FROM empresa_resumen WHERE ruc = ANY($1)`, [rucs]),
  ]);
  const ent = { ruc: id.entidad_ruc, nombre: (f.entidad as string | null) ?? null };
  const entNombre = ent.nombre ? titulo(ent.nombre) : "la entidad";
  const socio = String(((f.socios ?? [])[0] as { nombre?: string } | undefined)?.nombre ?? "Una persona");
  const nombreDe = new Map<string, string>();
  for (const e of (f.empresas ?? []) as { ruc: string; nombre: string | null }[]) nombreDe.set(e.ruc, titulo(e.nombre ?? "Empresa"));
  for (const s of sunat.rows) if (!nombreDe.has(s.ruc)) nombreDe.set(s.ruc, titulo(s.nombre ?? "Empresa"));
  const nodoDe = new Map(rucs.map((r, i) => [r, `m${i + 1}`]));
  const cs = [...contratos.rows].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));

  const nodos: NodoCaso[] = [
    { id: "e", tipo: "entidad", nombre: entNombre, rol: "La entidad que contrató", href: `/entidad/${ent.ruc}?seccion=patrones&patron=duenos` },
    { id: "p1", tipo: "persona", nombre: socio, rol: `Figura en ${plural(rucs.length, "empresa", "empresas")} que le ganan a la entidad`, severidad: f.seguidos ? "alta" : "media",
      datos: rucs.map((r) => {
        const xs = rnp.rows.filter((x) => x.ruc === r);
        const desde = xs.map((x) => x.desde).filter((z): z is string => !!z).sort()[0];
        return { etiqueta: nombreDe.get(r) ?? "Empresa", valor: xs.length ? `${roles(xs.map((x) => x.rol))}${desde ? `, desde ${fechaLarga(desde)}` : ""}` : "figura en su conformación" };
      }) },
  ];
  const aristas: AristaCaso[] = [];
  for (const r of rucs) {
    const suyos = cs.filter((c) => c.ruc === r);
    const s = sunat.rows.find((x) => x.ruc === r);
    nodos.push({
      id: nodoDe.get(r)!, tipo: "empresa", nombre: nombreDe.get(r) ?? "Empresa", rol: "Empresa del mismo dueño", href: `/empresa/${r}?seccion=antecedentes&atipo=patron-duenos`,
      monto: suyos.reduce((t, c) => t + (c.monto ?? 0), 0), ordenes: suyos.length, severidad: suyos.some((c) => c.severidad === "alta") ? "alta" : null,
      datos: [s?.alta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(s.alta) } : null, s?.estado && !/ACTIVO/i.test(s.estado) ? { etiqueta: "Estado en la SUNAT", valor: titulo(s.estado) } : null].filter((x): x is { etiqueta: string; valor: string } => !!x),
    });
    aristas.push({ de: "p1", a: nodoDe.get(r)!, tipo: "socio", texto: roles(rnp.rows.filter((x) => x.ruc === r).map((x) => x.rol)) });
    aristas.push({ de: nodoDe.get(r)!, a: "e", tipo: "vende", texto: `${plural(suyos.length, "contrato", "contratos")} por ${soles(suyos.reduce((t, c) => t + (c.monto ?? 0), 0))}` });
  }

  const hitos: HitoCaso[] = [];
  for (const s of sunat.rows) if (s.alta) hitos.push({ fecha: s.alta, tipo: "fundacion", titulo: `Se funda ${nombreDe.get(s.ruc)}`, nodos: [nodoDe.get(s.ruc)!], fuente: "SUNAT (padrón RUC)" });
  for (const r of rucs) {
    const xs = rnp.rows.filter((x) => x.ruc === r);
    const desde = xs.map((x) => x.desde).filter((z): z is string => !!z).sort()[0];
    if (desde) hitos.push({ fecha: desde, tipo: "socio", titulo: `${socio} figura como ${roles(xs.map((x) => x.rol))} de ${nombreDe.get(r)}`, nodos: ["p1", nodoDe.get(r)!], fuente: "Registro Nacional de Proveedores (OECE)" });
    const baja = xs.length && xs.every((x) => x.baja) ? xs.map((x) => x.baja!).sort().reverse()[0] : null;
    if (baja) hitos.push({ fecha: baja, tipo: "salida", titulo: `${socio} deja de figurar en ${nombreDe.get(r)}`, nodos: ["p1", nodoDe.get(r)!], fuente: "Registro Nacional de Proveedores (OECE)" });
  }
  // Cada contrato si son pocos; si no, los seguidos uno por uno y lo demás por año.
  const sueltos = cs.length <= 30 ? cs : cs.filter((c) => c.severidad === "alta").slice(0, 30);
  for (const c of sueltos) {
    if (!c.fecha) continue;
    hitos.push({
      fecha: c.fecha, tipo: c.severidad === "alta" ? "dia" : "otro", severidad: c.severidad === "alta" ? "alta" : null, monto: c.monto,
      titulo: `Gana ${nombreDe.get(c.ruc)}: ${c.objeto ? `«${c.objeto.slice(0, 90)}»` : c.codigo ?? "un contrato"}`,
      detalle: c.severidad === "alta" ? `Un contrato ${NOTA_SEGUIDO}.` : null,
      nodos: [nodoDe.get(c.ruc)!, "e"], fuente: "SEACE (OECE)", href: rutaContrato(c.ocid),
    });
  }
  const anios = [...new Set(cs.filter((c) => c.fecha).map((c) => Number(c.fecha!.slice(0, 4))))].sort();
  if (cs.length > 30) {
    for (const a of anios) {
      const xs = cs.filter((c) => c.fecha?.startsWith(String(a)));
      hitos.push({ fecha: `${a}-12-31`, tipo: "anio", titulo: `${a}: ${plural(xs.length, "contrato", "contratos")} por ${soles(xs.reduce((t, c) => t + (c.monto ?? 0), 0))} a ${plural(new Set(xs.map((c) => c.ruc)).size, "empresa", "empresas")} del mismo dueño`, nodos: [...new Set(xs.map((c) => nodoDe.get(c.ruc)!)), "e"], fuente: "SEACE (OECE)" });
    }
  }
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

  const totalDe = new Map<string, number>();
  for (const c of cs) totalDe.set(c.ruc, (totalDe.get(c.ruc) ?? 0) + (c.monto ?? 0));
  const mayor = [...totalDe.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const serie = mayor && anios.length > 1 ? {
    titulo: "Lo que la entidad les adjudicó, año por año", etiquetaA: nombreDe.get(mayor) ?? "La empresa mayor", etiquetaB: "Las demás empresas del mismo dueño",
    anios: anios.map((a) => {
      const xs = cs.filter((c) => c.fecha?.startsWith(String(a)));
      const da = xs.filter((c) => c.ruc === mayor);
      const db = xs.filter((c) => c.ruc !== mayor);
      const s = (ys: typeof xs) => ys.reduce((t, c) => t + (c.monto ?? 0), 0);
      return { anio: a, a: s(da), b: s(db), detalleA: `${soles(s(da))} en ${plural(da.length, "contrato", "contratos")}`, detalleB: `${soles(s(db))} en ${plural(db.length, "contrato", "contratos")}` };
    }),
  } : null;

  const razones: RazonCaso[] = ([
    { titulo: "Varias empresas, un mismo dueño", cifra: plural(rucs.length, "empresa", "empresas"), texto: `${socio} figura en todas, según el Registro Nacional de Proveedores, y todas le ganan contratos parecidos a ${entNombre}.`, severidad: "media" },
    f.seguidos ? { titulo: "Contratos seguidos", cifra: miles(f.seguidos), texto: `Contratos ${NOTA_SEGUIDO}: la misma necesidad repartida entre razones sociales, o empresas que no compiten de verdad.`, severidad: "alta" } : null,
    { titulo: "Lo que suman", cifra: soles(f.monto), texto: `${plural(f.contratos, "contrato", "contratos")} de objeto parecido.`, severidad: null },
    { titulo: "Lo que puede explicarlo", cifra: "Grupo", texto: "Un grupo empresarial puede tener varias empresas legítimas; lo que pesa es que compitan entre sí en el mismo proceso o se repartan la misma necesidad.", severidad: null },
  ] as (RazonCaso | null)[]).filter((x): x is RazonCaso => !!x);

  const filas: FilaEvidencia[] = cs.map((c, i) => ({
    id: `c${i}`, fecha: c.fecha, documento: c.codigo ?? c.ocid, quien: nombreDe.get(c.ruc) ?? null, nodo: nodoDe.get(c.ruc) ?? null,
    que: c.objeto, monto: c.monto, estado: c.tipo, marcas: c.severidad === "alta" ? [NOTA_SEGUIDO] : [], href: rutaContrato(c.ocid),
  }));
  return {
    tipo: "duenos", clave, patron: "Un mismo dueño gana con varias empresas",
    titulo: `${plural(rucs.length, "empresa", "empresas")} del mismo dueño le ganan a ${entNombre}`,
    severidad: f.seguidos ? "alta" : "media",
    frase: `${socio} figura en ${plural(rucs.length, "empresa", "empresas")} (${rucs.map((r) => nombreDe.get(r)).join(", ")}) que le ganaron a ${entNombre} ${plural(f.contratos, "contrato", "contratos")} de objeto parecido por ${soles(f.monto)}${f.seguidos ? `; ${miles(f.seguidos)} de ellos ${NOTA_SEGUIDO}` : ""}.`,
    entidad: ent, desde: f.desde ?? null, hasta: f.hasta ?? null,
    cifras: [
      { etiqueta: "Empresas del mismo dueño", valor: miles(rucs.length), contexto: null },
      { etiqueta: "Contratos parecidos", valor: miles(f.contratos), contexto: `por ${soles(f.monto)}` },
      { etiqueta: "Seguidos (90 días o menos)", valor: miles(f.seguidos ?? 0), contexto: f.seguidos ? "entre empresas hermanas" : "ninguno" },
      { etiqueta: "Periodo", valor: f.desde && f.hasta ? `${String(f.desde).slice(0, 4)} a ${String(f.hasta).slice(0, 4)}` : "Sin fecha", contexto: null },
    ],
    serie, nodos, aristas, hitos, razones,
    evidencia: { titulo: `Los contratos de sus empresas en ${entNombre}`, unidad: "contratos", total: cs.length, filas, nota: null, masHref: `/entidad/${ent.ruc}?seccion=contratos&vista=contratos` },
    revisar: [
      "Revisa en cada proceso si las empresas del mismo dueño postularon unas contra otras: competir consigo mismo es concertación.",
      "Para los contratos seguidos, pide los requerimientos: si eran la misma necesidad, se partió para darla a varias razones sociales.",
      "Confirma la participación del socio en cada empresa con la SUNARP: el RNP no publica porcentajes.",
    ],
    fuentes: [
      { texto: "Socios, representantes y directivos (Registro Nacional de Proveedores)", href: DATASET_SOCIOS_RNP },
      { texto: "Procesos y contratos (SEACE y CONOSCE, OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT },
    ],
    relacionados: [
      { texto: `Antecedentes y patrones de ${entNombre}`, href: `/entidad/${ent.ruc}?seccion=patrones&patron=duenos` },
      ...rucs.slice(0, 5).map((r) => ({ texto: `Ficha de ${nombreDe.get(r) ?? "la empresa"}`, href: `/empresa/${r}` })),
      { texto: "Todos los casos de mismo dueño", href: "/app/patrones?seccion=duenos" },
    ],
    como_leerlo: "Un mismo socio, representante o directivo figura en varias empresas que le ganan contratos de objeto parecido a una misma entidad. Un patrón es un motivo para mirar, no una acusación.",
  };
}

// ─── Postor de relleno (migración 276) ─────────────────────────────────────────────────────────

export const sqlClaveRelleno = (sal: string) => `left(md5(${sal} || ruc_ganador || '|' || ruc_acompanante), 16)`;

export async function casoRelleno(clave: string, pedir: Pedir): Promise<CasoPatron | null> {
  const k = await pool.query<{ ruc_ganador: string; ruc_acompanante: string }>(
    `SELECT ruc_ganador, ruc_acompanante FROM postor_acompanante WHERE ${sqlClaveRelleno("$2")} = $1 LIMIT 1`, [clave, salDeClaves()]);
  const id = k.rows[0];
  if (!id) return null;
  const [lista, procesos, sG, sA, gG, gA] = await Promise.all([
    pedir(`/acompanantes?ruc=${id.ruc_ganador}&clave=${clave}&size=1`),
    pedir(`/acompanantes/procesos?acompanante=${id.ruc_acompanante}&ganador=${id.ruc_ganador}`),
    empresaSunat(id.ruc_ganador), empresaSunat(id.ruc_acompanante),
    genteDeEmpresa(id.ruc_ganador), genteDeEmpresa(id.ruc_acompanante),
  ]);
  const f = (lista?.data ?? [])[0] as Record<string, any> | undefined;
  if (!f) return null;
  const ps = ((procesos?.data ?? []) as { codigo: string; ocid: string | null; entidadRuc: string | null; entidad: string | null; objeto: string | null; fecha: string | null; monto: number | null; ganoElGanador: boolean; ganoElAcompanante: boolean; postores: number }[]);
  const gan = titulo(f.ganador ?? sG?.nombre ?? "El ganador");
  const aco = titulo(f.acompanante ?? sA?.nombre ?? "El acompañante");
  const delPatron = (p: (typeof ps)[number]) => p.ganoElGanador && !p.ganoElAcompanante && p.postores >= 2 && p.postores <= 4;

  // Las entidades donde coincidieron (las seis con más procesos).
  const porEntidad = new Map<string, { nombre: string; n: number; gano: number }>();
  for (const p of ps) {
    if (!p.entidadRuc) continue;
    const x = porEntidad.get(p.entidadRuc) ?? { nombre: titulo(p.entidad ?? "Entidad"), n: 0, gano: 0 };
    x.n += 1;
    if (p.ganoElGanador) x.gano += 1;
    porEntidad.set(p.entidadRuc, x);
  }
  const entidades = [...porEntidad.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const nodos: NodoCaso[] = [
    { id: "g", tipo: "empresa", nombre: gan, rol: "La que gana", href: `/empresa/${id.ruc_ganador}?seccion=antecedentes&atipo=patron-relleno`, severidad: f.fuerte ? "alta" : "media",
      datos: [sG?.alta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(sG.alta) } : null].filter((x): x is { etiqueta: string; valor: string } => !!x) },
    { id: "a", tipo: "empresa", nombre: aco, rol: "La que la acompaña y casi nunca gana", href: `/empresa/${id.ruc_acompanante}?seccion=antecedentes&atipo=patron-relleno`, severidad: f.fuerte ? "alta" : "media",
      datos: [
        sA?.alta ? { etiqueta: "Fundada (SUNAT)", valor: fechaLarga(sA.alta) } : null,
        { etiqueta: "Postulaciones", valor: `${miles(f.postulacionesDelAcompanante)}; ganó ${miles(f.ganadasDelAcompanante)}` },
        { etiqueta: "Junto a esta ganadora", valor: `${Math.round(Number(f.parte) * 100)} % de sus postulaciones` },
      ].filter((x): x is { etiqueta: string; valor: string } => !!x) },
  ];
  const aristas: AristaCaso[] = [{ de: "a", a: "g", tipo: "otro", texto: `postularon juntas ${plural(f.juntos, "vez", "veces")}` }];
  entidades.forEach(([ruc, x], i) => {
    nodos.push({ id: `e${i + 1}`, tipo: "entidad", nombre: x.nombre, rol: `${plural(x.n, "proceso", "procesos")} con las dos; ganó la acompañada ${miles(x.gano)}`, href: `/entidad/${ruc}?seccion=patrones&patron=relleno` });
    aristas.push({ de: "g", a: `e${i + 1}`, tipo: "vende", texto: `ganó ${plural(x.gano, "proceso", "procesos")} con la otra de postora` });
  });
  // Las personas que figuran en las dos (el vínculo «socio común»).
  const comunes = gG.filter((p) => gA.some((q) => q.nombre === p.nombre));
  comunes.forEach((p, i) => {
    const q = gA.find((z) => z.nombre === p.nombre)!;
    nodos.push({ id: `p${i + 1}`, tipo: "persona", nombre: p.nombre, rol: "Figura en las dos empresas", severidad: "alta", datos: [{ etiqueta: gan, valor: p.papeles }, { etiqueta: aco, valor: q.papeles }] });
    aristas.push({ de: `p${i + 1}`, a: "g", tipo: "socio", texto: p.papeles });
    aristas.push({ de: `p${i + 1}`, a: "a", tipo: "socio", texto: q.papeles });
  });

  const hitos: HitoCaso[] = [];
  if (sG?.alta) hitos.push({ fecha: sG.alta, tipo: "fundacion", titulo: `Se funda ${gan}`, nodos: ["g"], fuente: "SUNAT (padrón RUC)" });
  if (sA?.alta) hitos.push({ fecha: sA.alta, tipo: "fundacion", titulo: `Se funda ${aco}`, nodos: ["a"], fuente: "SUNAT (padrón RUC)" });
  comunes.forEach((p, i) => { if (p.desde) hitos.push({ fecha: p.desde, tipo: "socio", titulo: `${p.nombre} figura en ${gan}`, nodos: [`p${i + 1}`, "g"], fuente: "Registro Nacional de Proveedores (OECE)" }); });
  for (const p of ps) {
    if (!p.fecha) continue;
    const quienGano = p.ganoElGanador ? gan : p.ganoElAcompanante ? aco : "otra empresa";
    hitos.push({
      fecha: p.fecha, tipo: delPatron(p) ? "dia" : "otro", severidad: delPatron(p) ? "media" : null, monto: p.monto,
      titulo: `Postulan las dos; gana ${quienGano}${p.postores ? ` (${plural(p.postores, "postor", "postores")})` : ""}`,
      detalle: `${p.entidad ? titulo(p.entidad) : "Entidad"}${p.objeto ? `: «${p.objeto.slice(0, 120)}»` : ""}`,
      nodos: ["g", "a"], fuente: "CONOSCE (OECE)", href: p.ocid ? rutaContrato(p.ocid) : null,
    });
  }
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

  const nPatron = ps.filter(delPatron).length;
  const razones: RazonCaso[] = ([
    { titulo: "Postula casi siempre con ella", cifra: `${Math.round(Number(f.parte) * 100)} %`, texto: `De las ${miles(f.postulacionesDelAcompanante)} postulaciones de ${aco}, esa parte fue junto a ${gan}.`, severidad: Number(f.parte) >= 0.5 ? "alta" : "media" },
    { titulo: "Y casi nunca gana", cifra: `${miles(f.ganadasDelAcompanante)} de ${miles(f.postulacionesDelAcompanante)}`, texto: "Una empresa que postula y no gana, siempre junto a la misma ganadora, cumple el papel de completar el número de postores.", severidad: "media" },
    { titulo: "Procesos con pocos postores que ganó la acompañada", cifra: miles(nPatron), texto: "De 2 a 4 postores: con tan pocos, un postor de relleno decide que el proceso no quede desierto.", severidad: nPatron >= 3 ? "alta" : "media" },
    comunes.length ? { titulo: "Comparten gente", cifra: plural(comunes.length, "persona", "personas"), texto: "Figuran en las dos empresas como socios, representantes o directivos: no son rivales.", severidad: "alta" } : null,
  ] as (RazonCaso | null)[]).filter((x): x is RazonCaso => !!x);

  const filas: FilaEvidencia[] = ps.map((p, i) => ({
    id: `p${i}`, fecha: p.fecha, documento: p.codigo, quien: p.entidad ? titulo(p.entidad) : null, que: p.objeto, monto: p.monto,
    estado: p.ganoElGanador ? `Ganó ${gan}` : p.ganoElAcompanante ? `Ganó ${aco}` : "Ganó otra",
    marcas: delPatron(p) ? ["ganó la acompañada con 2 a 4 postores"] : [], href: p.ocid ? rutaContrato(p.ocid) : null,
  }));
  return {
    tipo: "relleno", clave, patron: "Postor de relleno",
    titulo: `${aco} acompaña a ${gan}`,
    severidad: f.fuerte ? "alta" : "media",
    frase: `${aco} postuló ${plural(f.postulacionesDelAcompanante, "vez", "veces")} y ganó ${miles(f.ganadasDelAcompanante)}. El ${Math.round(Number(f.parte) * 100)} % de esas postulaciones fue junto a ${gan}, que ganó ${plural(nPatron, "proceso", "procesos")} de 2 a 4 postores con ella al lado${comunes.length ? `. Además comparten ${plural(comunes.length, "persona", "personas")} en su conformación` : ""}.`,
    entidad: null, desde: f.desde ?? null, hasta: f.hasta ?? null,
    cifras: [
      { etiqueta: "Procesos en que postularon las dos", valor: miles(f.juntos), contexto: `en ${plural(f.entidades, "entidad", "entidades")}` },
      { etiqueta: "De sus postulaciones, junto a ella", valor: `${Math.round(Number(f.parte) * 100)} %`, contexto: null },
      { etiqueta: "Ganadas por la acompañante", valor: miles(f.ganadasDelAcompanante), contexto: `de ${miles(f.postulacionesDelAcompanante)}` },
      { etiqueta: "Ganó la acompañada con 2 a 4 postores", valor: miles(nPatron), contexto: null },
    ],
    serie: null, nodos, aristas, hitos, razones,
    evidencia: { titulo: "Los procesos en que postularon las dos", unidad: "procesos", total: ps.length, filas, nota: ps.length >= 80 ? "Aquí van los 80 más recientes." : null, masHref: null },
    revisar: [
      "Abre las ofertas de los procesos marcados: precios calcados, errores repetidos, el mismo formato o la misma hora de registro delatan ofertas armadas juntas.",
      "Compara domicilios, teléfonos, correos y personas de las dos empresas (SUNAT, RNP, SUNARP).",
      "Si es un caso de concertación, la autoridad es el INDECOPI (libre competencia) y el Tribunal de Contrataciones.",
    ],
    fuentes: [
      { texto: "Postores de cada proceso (CONOSCE, OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Socios, representantes y directivos (Registro Nacional de Proveedores)", href: DATASET_SOCIOS_RNP },
      { texto: "Consulta RUC (SUNAT)", href: CONSULTA_RUC_SUNAT },
    ],
    relacionados: [
      { texto: `Ficha de ${gan}`, href: `/empresa/${id.ruc_ganador}` },
      { texto: `Ficha de ${aco}`, href: `/empresa/${id.ruc_acompanante}` },
      { texto: "Todos los postores de relleno del país", href: "/app/patrones?seccion=relleno" },
    ],
    como_leerlo: "Una empresa que postula casi siempre junto a la misma ganadora y casi nunca gana puede estar completando el número de postores. Un patrón es un motivo para mirar, no una acusación.",
  };
}
