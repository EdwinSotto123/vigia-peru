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
  evidencia: { titulo: string; total: number; filas: FilaEvidencia[]; nota?: string | null; masHref?: string | null };
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
    .replace(/\b(S\.?a\.?c|E\.?i\.?r\.?l|S\.?a\.?a|S\.?r\.?l|S\.?a)\b\.?/gi, (m) => m.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Y|E|En|Para|Por|Con)\b/g, (m) => m.toLowerCase());
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

/** La clave opaca de un caso: los primeros 16 hex del md5 de sus partes, igual en SQL (`left(md5(a||'|'||b), 16)`). */
export const SQL_CLAVE_GRUPO = `left(md5(r.entidad_ruc || '|' || r.grupo), 16)`;

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
    `SELECT r.entidad_ruc, r.grupo FROM grupo_proveedor_resumen r WHERE ${SQL_CLAVE_GRUPO} = $1 LIMIT 1`, [clave]);
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
      titulo: "Las órdenes de la entidad al grupo", total: total.rows[0]?.n ?? filas.length, filas,
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
  const empNombre = viaEmpresa ? titulo(f.empresa ?? empresa?.nombre ?? "su empresa") : null;

  // ── Nodos y aristas ──
  const nodos: NodoCaso[] = [
    { id: "e", tipo: "entidad", nombre: entNombre, rol: "La entidad que compró", href: `/entidad/${ent.ruc}?seccion=patrones&patron=compras` },
    {
      id: "f", tipo: "funcionario", nombre: f.persona ?? "Funcionario de la entidad", rol: `Declaró trabajar en ${cargo}`, severidad: f.severidad === "alta" ? "alta" : "media",
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
        viaEmpresa && f.rolEnEmpresa ? { etiqueta: `En ${empNombre}`, valor: `${String(f.rolEnEmpresa)}${f.parienteDesde ? `, desde ${fechaLarga(f.parienteDesde)}` : ""}` } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    },
  ];
  const aristas: AristaCaso[] = [
    { de: "f", a: "e", tipo: "otro", texto: `trabaja en ${cargo}` },
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
    aristas.push({ de: "p", a: "m", tipo: "socio", texto: String(f.rolEnEmpresa ?? "figura en su conformación") });
    aristas.push({ de: "m", a: "e", tipo: "vende", texto: `${plural(f.ordenes ?? 0, "orden", "órdenes")} por ${soles(f.monto)}${f.procesosEnPuesto ? ` y ${plural(f.procesosEnPuesto, "proceso", "procesos")}` : ""}` });
  } else {
    aristas.push({ de: "p", a: "e", tipo: "vende", texto: `${plural(f.ordenes ?? 0, "orden", "órdenes")} a su nombre por ${soles(f.monto)}` });
  }

  // ── La historia ──
  const hitos: HitoCaso[] = [];
  if (empresa?.fechaAlta) hitos.push({ fecha: empresa.fechaAlta, tipo: "fundacion", titulo: `Se funda ${empNombre}`, nodos: ["m"], fuente: "SUNAT (padrón RUC)" });
  if (f.parienteDesde) hitos.push({ fecha: f.parienteDesde, tipo: "socio", titulo: `El familiar (${parentesco.toLowerCase()}) figura en ${empNombre} como ${String(f.rolEnEmpresa ?? "parte de su conformación")}`, nodos: ["p", "m"], fuente: "Registro Nacional de Proveedores (OECE)" });
  if (f.cargoDesde) hitos.push({ fecha: f.cargoDesde, tipo: "otro", severidad: "media", titulo: `El funcionario asume ${cargo} en ${entNombre}`, detalle: "La fecha de inicio que declaró en su declaración jurada de intereses.", nodos: ["f", "e"], fuente: "Declaraciones juradas de intereses (Contraloría)" });
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
      ? { titulo: "Órdenes con la persona en el puesto", cifra: miles(f.ordenesEnPuesto), texto: `Por ${soles(f.montoEnPuesto)}, emitidas mientras declaraba trabajar en ${cargo}.`, severidad: f.cercano ? "alta" : "media" }
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
    titulo: `Un funcionario de compras y ${viaEmpresa ? `la empresa de su familiar` : "su familiar"} en ${entNombre}`,
    severidad: sev,
    frase:
      `${f.persona ?? "Un funcionario"} declaró trabajar en ${cargo} de ${entNombre}${f.cargoDesde ? ` desde ${fechaLarga(f.cargoDesde)}` : ""}. ` +
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
      titulo: viaEmpresa ? `Lo que ${entNombre} le compró a la empresa del familiar` : `Lo que ${entNombre} le compró al familiar`,
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
      ...(f.codigo ? [{ texto: "Ficha del funcionario", href: `/app/personas/cargo/${f.codigo}` }] : []),
      { texto: `Antecedentes y patrones de ${entNombre}`, href: `/entidad/${ent.ruc}?seccion=patrones&patron=compras` },
      ...(viaEmpresa ? [{ texto: `Ficha de ${empNombre}`, href: `/empresa/${f.empresaRuc}` }] : []),
      { texto: "Todos los casos del país", href: "/app/patrones?seccion=compras" },
    ],
    como_leerlo: String(lista?.como_leerlo ?? "Un funcionario de compras y un familiar declarado que le vende a su entidad. Es una señal en observación: dice que el puesto, el parentesco y las órdenes coinciden, no que la persona intervino."),
  };
}
