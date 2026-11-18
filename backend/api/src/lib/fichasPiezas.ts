/**
 * Lo que leyeron los lectores por pieza (backend/lector/por_pieza.py y fichas_cortas.py, migraciones 325-326) para la
 * ficha del contrato: hasta el 2026-11-17 ninguna pantalla lo leía y la ficha seguía mostrando lo que resumió el agente
 * (en el proceso 1225937, «un ítem» de lubricantes cuando las bases y el contrato traen diez productos).
 *
 *   perfilDeBases      lo que las bases le piden al contratista: experiencia, personal, equipamiento, exigencias,
 *                      documentos, factores de evaluación, plazos, garantías, penalidades, pago (ficha «bases», m3).
 *   itemsDeDocumentos  cada renglón de lo que se compró: lo que pedían las bases y lo que se firmó en el contrato (marca,
 *                      precio unitario y total, con la comprobación aritmética del lector).
 *   enriquecerPostores el acta o cuadro de evaluación (ficha «evaluacion») y el reporte de presentación de ofertas: por
 *                      postor, su admisión, calificación y motivo, puntajes, bonificación, prelación y hora de su oferta.
 *
 * Todo con su cita (página y frase) en la forma de CitaPublica. Los nombres de postores personas naturales salen tapados
 * por publicar() porque cada fila lleva su RUC (se completa con el de los participantes cuando la lectura no lo trae).
 */
import { pool } from "./db.js";
import type { CitaPublica } from "./citas.js";
import { pareceEmpresa, taparNombreSuelto } from "./privacidad.js";

export interface FichaPieza {
  lector: string;
  version: string;
  modelo: string;
  salida: Record<string, any>;
  tipo: string;
  documento: string | null;
  url: string | null;
  leido: string | null;
}

const LECTORES = ["bases", "contrato", "evaluacion", "reporte_presentacion", "reporte_evaluacion", "reporte_otorgamiento",
  "garantia", "modificacion", "resolucion", "desierto"];

/** La lectura con modelo más reciente de cada lector para el proceso (de las bases, las integradas primero). */
export async function leerFichasPiezas(ocid: string): Promise<Map<string, FichaPieza>> {
  const r = await pool.query(
    `SELECT DISTINCT ON (l.lector) l.lector, l.version, l.modelo, l.salida, p.tipo_documento AS tipo,
            g.titulo AS documento, g.url_origen AS url, to_char(l.leido_at, 'YYYY-MM-DD') AS leido
       FROM documento_pieza p
       JOIN pieza_lectura l ON l.pieza_id = p.id
       LEFT JOIN documentos_gcs g ON g.id = p.doc_id
      WHERE ocid_corto(p.ocid) = ocid_corto($1) AND l.lector = ANY($2::text[]) AND l.estado IN ('ok', 'parcial')
        AND l.modelo <> 'plantilla' AND jsonb_typeof(l.salida) = 'object'
      ORDER BY l.lector, (p.tipo_documento = 'bases_integradas') DESC, l.leido_at DESC`, [ocid, LECTORES]);
  return new Map(r.rows.map((x: FichaPieza) => [x.lector, x]));
}

/**
 * Los reportes del SEACE leídos SIN modelo (proceso_postor, migraciones 326 y 384: presentación, evaluación, otorgamiento
 * y desempate unidos por postor) en la forma de las fichas «evaluacion» y «reporte_presentacion», para cuando no hay
 * lectura con modelo: leerFichasPiezas deja fuera las plantillas y el 2026-11-18 había 14 708 reportes de evaluación
 * leídos así frente a 2 con modelo. Sin montos de oferta ni citas (la plantilla no los trae). Un postor sin RUC que no
 * parece empresa sale con el apellido tapado aquí mismo: publicar() sólo lo reconoce por su RUC 10.
 */
export async function fichasDeReportes(ocid: string): Promise<{ evaluacion?: FichaPieza; presentacion?: FichaPieza }> {
  const [r, d] = await Promise.all([
    pool.query(
      `SELECT pp.item, pp.nombre, pp.codigo, pp.admitida, pp.calificada, pp.puntaje_tecnico::float AS puntaje_tecnico,
              pp.orden_prelacion, pp.puntaje_total::float AS puntaje_total, pp.gano, pp.fuentes,
              to_char(pp.presento_at, 'YYYY-MM-DD') AS fecha, to_char(pp.presento_at, 'HH24:MI:SS') AS hora
         FROM proceso_postor pp WHERE ocid_corto(pp.ocid) = ocid_corto($1)
        ORDER BY pp.item, pp.gano DESC, pp.orden_prelacion NULLS LAST, pp.nombre`, [ocid]),
    pool.query(
      `SELECT DISTINCT ON (l.lector) l.lector, g.titulo AS documento, g.url_origen AS url, to_char(l.leido_at, 'YYYY-MM-DD') AS leido
         FROM documento_pieza p JOIN pieza_lectura l ON l.pieza_id = p.id LEFT JOIN documentos_gcs g ON g.id = p.doc_id
        WHERE ocid_corto(p.ocid) = ocid_corto($1) AND l.modelo = 'plantilla' AND l.estado = 'ok'
          AND l.lector IN ('reporte_evaluacion', 'reporte_presentacion')
        ORDER BY l.lector, l.leido_at DESC`, [ocid]),
  ]);
  if (!r.rows.length) return {};
  const doc = new Map(d.rows.map((x: any) => [x.lector, x]));
  const nombreDe = (x: any) => {
    const n = txt(x.nombre) ?? "";
    return /^\d{11}$/.test(x.codigo ?? "") || pareceEmpresa(n) ? n : taparNombreSuelto(n);
  };
  const ficha = (lector: string, salida: Record<string, any>): FichaPieza => ({
    lector, version: "p1", modelo: "plantilla", salida, tipo: lector,
    documento: doc.get(lector)?.documento ?? null, url: doc.get(lector)?.url ?? null, leido: doc.get(lector)?.leido ?? null,
  });
  const evaluados = r.rows.filter((x: any) => x.fuentes?.includes("reporte_evaluacion"));
  const presentados = r.rows.filter((x: any) => x.hora);
  const items = [...new Set(presentados.map((x: any) => x.item))];
  return {
    evaluacion: evaluados.length ? ficha("reporte_evaluacion", {
      postores: evaluados.map((x: any) => ({
        nombre: nombreDe(x), ruc: /^\d{11}$/.test(x.codigo ?? "") ? x.codigo : null, item: x.item,
        admitida: x.admitida, calificada: x.calificada, ganador: x.gano === true,
        puntaje_total: x.puntaje_total ?? x.puntaje_tecnico, orden_prelacion: x.orden_prelacion,
      })),
    }) : undefined,
    presentacion: presentados.length ? ficha("reporte_presentacion", {
      items: items.map((it) => ({
        item: it,
        ofertas: presentados.filter((x: any) => x.item === it)
          .map((x: any) => ({ nombre: nombreDe(x), ruc: /^\d{11}$/.test(x.codigo ?? "") ? x.codigo : null, fecha: x.fecha, hora: x.hora })),
      })),
    }) : undefined,
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Una cita de la ficha en la forma pública: la página y la frase, con el documento de la pieza. */
export function citaDe(o: any, f: Pick<FichaPieza, "documento" | "url">, enVigia: Set<string>): CitaPublica | null {
  const pagina = num(o?.pagina);
  const cita = txt(o?.cita);
  if (pagina == null && !cita) return null;
  return { pagina, cita, documentoUrl: f.url, documentoTitulo: f.documento, enVigia: !!f.url && enVigia.has(f.url), verificada: null };
}

// ─── Perfil del contratista: lo que piden las bases ──────────────────────────────────────────────────────────────────

export function perfilDeBases(f: FichaPieza | undefined, enVigia: Set<string>) {
  if (!f) return null;
  const s = f.salida;
  const c = (o: any) => citaDe(o, f, enVigia);
  const lista = (v: unknown) => (Array.isArray(v) ? v : []);
  const perfil = {
    documento: f.documento, documentoUrl: f.url, enVigia: !!f.url && enVigia.has(f.url), integradas: f.tipo === "bases_integradas",
    leido: f.leido, modelo: f.modelo,
    resumen: txt(s.resumen),
    cuantia: s.cuantia && typeof s.cuantia === "object"
      ? { estado: txt(s.cuantia.estado), valor: num(s.cuantia.valor), moneda: txt(s.cuantia.moneda), cita: c(s.cuantia) } : null,
    sistema: txt(s.sistema_contratacion),
    financiamiento: txt(s.fuente_financiamiento),
    experiencia: lista(s.requisitos_calificacion).map((x: any) => ({
      tipo: txt(x?.tipo), requisito: txt(x?.requisito), para: txt(x?.para), cantidad: num(x?.cantidad), unidad: txt(x?.unidad),
      anios: num(x?.anios), acreditacion: txt(x?.acreditacion), cita: c(x),
    })),
    personalClave: lista(s.personal_clave).map((x: any) => ({
      cargo: txt(x?.cargo), cantidad: num(x?.cantidad), profesion: txt(x?.profesion),
      experiencia: txt(x?.experiencia), cita: c(x),
    })),
    equipamiento: lista(s.equipamiento).map((x: any) => ({ equipo: txt(x?.equipo), cantidad: num(x?.cantidad), cita: c(x) })),
    exigencias: lista(s.exigencias_particulares).map((x: any) => ({ exigencia: txt(x?.exigencia), cita: c(x) })),
    documentosAdmision: lista(s.documentos_admision).map((x: any) => ({ documento: txt(x?.documento), cita: c(x) })),
    documentosContrato: lista(s.requisitos_perfeccionar).map((x: any) => ({ documento: txt(x?.documento), cita: c(x) })),
    factores: lista(s.factores_evaluacion).map((x: any) => ({
      factor: txt(x?.factor), puntajeMaximo: num(x?.puntaje_maximo), monto: num(x?.monto), cita: c(x),
    })),
    plazos: lista(s.plazos).map((x: any) => ({ que: txt(x?.que), dias: num(x?.dias), cita: c(x) })),
    garantias: lista(s.garantias).map((x: any) => ({ tipo: txt(x?.tipo), porcentaje: num(x?.porcentaje), cita: c(x) })),
    penalidades: lista(s.penalidades).map((x: any) => ({
      tipo: txt(x?.tipo), descripcion: txt(x?.descripcion), topePct: num(x?.tope_pct), cita: c(x),
    })),
    marcas: lista(s.marcas).map((x: any) => (typeof x === "string" ? { marca: x, admiteEquivalente: null, cita: null } : {
      marca: txt(x?.marca), admiteEquivalente: typeof x?.admite_equivalente === "boolean" ? x.admite_equivalente : null, cita: c(x),
    })),
    formaDePago: txt(s.forma_de_pago),
    adelantos: s.adelantos && typeof s.adelantos === "object" && (num(s.adelantos.directo_pct) != null || num(s.adelantos.materiales_pct) != null)
      ? { directoPct: num(s.adelantos.directo_pct), materialesPct: num(s.adelantos.materiales_pct), cita: c(s.adelantos) } : null,
    controversias: txt(s.solucion_controversias),
  };
  return perfil;
}

// ─── Ítems: lo que pedían las bases y lo que se firmó ────────────────────────────────────────────────────────────────

/** «01», «1», «Ítem 1» → «1». */
const clave = (v: unknown) => {
  const m = String(v ?? "").match(/\d+/);
  return m ? String(Number(m[0])) : null;
};

export function itemsDeDocumentos(bases: FichaPieza | undefined, contrato: FichaPieza | undefined, enVigia: Set<string>) {
  const deBases = (Array.isArray(bases?.salida?.items) ? bases!.salida.items : []) as any[];
  const deContrato = (Array.isArray(contrato?.salida?.items) ? contrato!.salida.items : []) as any[];
  if (deBases.length < 2 && deContrato.length < 2) return null;
  const porClave = new Map(deContrato.map((x, i) => [clave(x?.numero) ?? `#${i}`, x]));
  const usados = new Set<any>();
  // Sin número en alguno de los dos y con el mismo largo, se emparejan por orden.
  const porOrden = deBases.length === deContrato.length;
  const contratado = (x: any) => {
    if (!x) return null;
    usados.add(x);
    return {
      descripcion: txt(x.descripcion), marca: txt(x.marca), unidad: txt(x.unidad), cantidad: num(x.cantidad),
      precioUnitario: num(x.precio_unitario), precioTotal: num(x.precio_total),
      cuadra: typeof x.cuadra === "boolean" ? x.cuadra : null, cita: contrato ? citaDe(x, contrato, enVigia) : null,
    };
  };
  const filas = deBases.map((b, i) => {
    const k = clave(b?.numero);
    const x = (k && porClave.get(k)) || (porOrden ? deContrato[i] : undefined);
    return {
      numero: k ?? String(i + 1), descripcion: txt(b?.descripcion), unidad: txt(b?.unidad), cantidad: num(b?.cantidad),
      cita: bases ? citaDe(b, bases, enVigia) : null, contratado: contratado(x),
    };
  });
  // Los renglones del contrato que no estaban en las bases (o todos, si las bases no traían tabla).
  deContrato.forEach((x, i) => {
    if (usados.has(x)) return;
    filas.push({ numero: clave(x?.numero) ?? String(filas.length + 1), descripcion: null, unidad: null, cantidad: null, cita: null,
                 contratado: contratado(x) });
    void i;
  });
  const ar = contrato?.salida?.aritmetica ?? null;
  return {
    filas,
    bases: bases ? { documento: bases.documento, documentoUrl: bases.url, enVigia: !!bases.url && enVigia.has(bases.url) } : null,
    contrato: contrato ? {
      documento: contrato.documento, documentoUrl: contrato.url, enVigia: !!contrato.url && enVigia.has(contrato.url),
      numero: txt(contrato.salida?.numero?.valor), monto: num(contrato.salida?.monto_total?.valor),
      // Comprobación sin modelo: cada renglón cantidad × unitario = total, y la suma = el monto del contrato.
      renglonesQueCuadran: num(ar?.renglones_ok), renglones: num(ar?.renglones), sumaCuadra: typeof ar?.suma_cuadra === "boolean" ? ar.suma_cuadra : null,
    } : null,
  };
}

// ─── Postores: la evaluación del acta y la hora de cada oferta ──────────────────────────────────────────────────────

export interface PostorDetalle {
  ruc: string | null;
  razonSocial: string | null;
  estado: string | null;
  motivoEstado: string | null;
  montoOferta: number | null;
  puntaje: number | null;
  esGanador: boolean;
  ordenPrelacion: number | null;
  item: number | null;
  citas: CitaPublica[];
  [k: string]: unknown;
}

const normNombre = (t: unknown) => String(t ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9 ]+/g, " ").replace(/\b(S ?A ?C|S ?R ?L|E ?I ?R ?L|S ?A ?A|S ?A|SOCIEDAD|ANONIMA|CERRADA|COMERCIAL|DE|RESPONSABILIDAD|LIMITADA|DEL|LA|EL)\b/g, " ")
  .replace(/\s+/g, " ").trim();

/** ¿Es el mismo postor? Por RUC si los dos lo traen; si no, por el comienzo de su nombre sin la forma societaria. */
function mismo(a: { ruc?: unknown; nombre?: unknown }, b: { ruc?: unknown; nombre?: unknown }) {
  const ra = txt(a.ruc)?.replace(/\D/g, "");
  const rb = txt(b.ruc)?.replace(/\D/g, "");
  if (ra && rb && ra.length === 11 && rb.length === 11) return ra === rb;
  const na = normNombre(a.nombre);
  const nb = normNombre(b.nombre);
  if (na.length < 6 || nb.length < 6) return false;
  const n = Math.min(na.length, nb.length, 24);
  return na.slice(0, n) === nb.slice(0, n);
}

/**
 * Lo que sumaron los demás factores, comprobado: precio + otros tiene que dar el total (el total coincide con el reporte de
 * evaluación del SEACE). Si el modelo lo leyó mal (en el proceso 1225937 leyó 50 donde el acta dice 60), se calcula.
 */
export function otrosDe(e: any): number | null {
  const precio = num(e?.puntaje_precio);
  const total = num(e?.puntaje_total);
  const otros = num(e?.puntaje_otros);
  if (precio == null || total == null) return otros;
  const calculado = Math.round((total - precio) * 100) / 100;
  return otros != null && Math.abs(precio + otros - total) <= 0.05 ? otros : calculado;
}

export function enriquecerPostores(
  postores: PostorDetalle[], evaluacion: FichaPieza | undefined, presentacion: FichaPieza | undefined,
  participantes: { ruc: string; nombre: string | null }[], enVigia: Set<string>,
): { postores: PostorDetalle[]; evaluacion: Record<string, unknown> | null } {
  const ev = (Array.isArray(evaluacion?.salida?.postores) ? evaluacion!.salida.postores : []) as any[];
  const horas = ((Array.isArray(presentacion?.salida?.items) ? presentacion!.salida.items : []) as any[])
    .flatMap((it) => (Array.isArray(it?.ofertas) ? it.ofertas : []).map((o: any) => ({ ruc: txt(o?.ruc), nombre: txt(o?.nombre), fecha: txt(o?.fecha), hora: txt(o?.hora), item: num(it?.item) })));
  // El RUC de cada postor leído: el suyo o el del participante con el mismo nombre (para que publicar() tape a las personas).
  const rucDe = (p: { ruc?: unknown; nombre?: unknown }) => {
    const r = txt(p.ruc)?.replace(/\D/g, "");
    if (r && r.length === 11) return r;
    return participantes.find((x) => mismo({ nombre: x.nombre }, p))?.ruc ?? null;
  };
  const datosEv = (e: any) => ({
    admitida: typeof e?.admitida === "boolean" ? e.admitida : null,
    motivoNoAdmitida: txt(e?.motivo_no_admitida)?.slice(0, 400) ?? null,
    calificada: typeof e?.calificada === "boolean" ? e.calificada : null,
    motivoNoCalificada: txt(e?.motivo_no_calificada)?.slice(0, 400) ?? null,
    puntajePrecio: num(e?.puntaje_precio), puntajeOtros: otrosDe(e), puntajeTotal: num(e?.puntaje_total),
    bonificacion: num(e?.bonificacion), puntajeFinal: num(e?.puntaje_final),
    citaEvaluacion: evaluacion ? citaDe(e, evaluacion, enVigia) : null,
  });
  const horaDe = (p: { ruc?: unknown; nombre?: unknown }) => {
    const h = horas.find((x) => mismo(x, p));
    return h ? { fechaOferta: h.fecha, horaOferta: h.hora } : {};
  };
  const usados = new Set<any>();
  const out: PostorDetalle[] = postores.map((p) => {
    const e = ev.find((x) => !usados.has(x) && mismo({ ruc: x?.ruc, nombre: x?.nombre }, { ruc: p.ruc, nombre: p.razonSocial }));
    if (!e) return { ...p, ...horaDe({ ruc: p.ruc, nombre: p.razonSocial }) };
    usados.add(e);
    const d = datosEv(e);
    return {
      ...p,
      montoOferta: p.montoOferta ?? num(e.monto_oferta),
      ordenPrelacion: p.ordenPrelacion ?? num(e.orden_prelacion),
      puntaje: d.puntajeFinal ?? p.puntaje,
      motivoEstado: p.motivoEstado ?? d.motivoNoAdmitida ?? d.motivoNoCalificada,
      ...d,
      ...horaDe({ ruc: p.ruc, nombre: p.razonSocial }),
    };
  });
  // Los postores del acta que la ficha no tenía (sin expediente de los agentes ni acta leída antes).
  for (const e of ev) {
    if (usados.has(e)) continue;
    const ruc = rucDe({ ruc: e?.ruc, nombre: e?.nombre });
    const d = datosEv(e);
    out.push({
      ruc, razonSocial: txt(e?.nombre),
      estado: e?.ganador ? "ganador" : d.admitida === false ? "no_admitido" : d.calificada === false ? "descalificado" : "admitido",
      motivoEstado: d.motivoNoAdmitida ?? d.motivoNoCalificada, montoOferta: num(e?.monto_oferta), puntaje: d.puntajeFinal ?? d.puntajeTotal,
      esGanador: e?.ganador === true, ordenPrelacion: num(e?.orden_prelacion), item: num(e?.item), citas: [],
      ...d, ...horaDe({ ruc, nombre: e?.nombre }),
    });
  }
  if (!evaluacion) return { postores: out, evaluacion: null };
  const s = evaluacion.salida;
  // Lo que el acta deja ver: si la oferta más baja entre las admitidas perdió, y por cuánto.
  const conOferta = ev.filter((e) => num(e?.monto_oferta) != null && e?.admitida !== false);
  const ganador = ev.find((e) => e?.ganador === true);
  const masBaja = conOferta.reduce<any>((m, e) => (!m || num(e.monto_oferta)! < num(m.monto_oferta)! ? e : m), null);
  const perdioLaMasBaja = !!ganador && !!masBaja && ganador !== masBaja && num(ganador.monto_oferta) != null
    && num(ganador.monto_oferta)! > num(masBaja.monto_oferta)!;
  return {
    postores: out,
    evaluacion: {
      documento: evaluacion.documento, documentoUrl: evaluacion.url, enVigia: !!evaluacion.url && enVigia.has(evaluacion.url),
      leido: evaluacion.leido, modelo: evaluacion.modelo,
      factores: (Array.isArray(s.factores) ? s.factores : []).map((x: any) => ({ factor: txt(x?.factor), puntajeMaximo: num(x?.puntaje_maximo) })),
      fechaBuenaPro: txt(s.fecha_buena_pro?.valor),
      montoAdjudicado: num(s.monto_adjudicado?.valor),
      ofertas: conOferta.length,
      masBajaPerdio: perdioLaMasBaja ? {
        masBaja: { ruc: rucDe({ ruc: masBaja.ruc, nombre: masBaja.nombre }), nombre: txt(masBaja.nombre), monto: num(masBaja.monto_oferta), puntajeFinal: num(masBaja.puntaje_final) ?? num(masBaja.puntaje_total) },
        ganador: { ruc: rucDe({ ruc: ganador.ruc, nombre: ganador.nombre }), nombre: txt(ganador.nombre), monto: num(ganador.monto_oferta), puntajeFinal: num(ganador.puntaje_final) ?? num(ganador.puntaje_total),
                   bonificacion: num(ganador.bonificacion) },
        diferenciaSoles: num(ganador.monto_oferta)! - num(masBaja.monto_oferta)!,
        diferenciaPct: (num(ganador.monto_oferta)! / num(masBaja.monto_oferta)! - 1) * 100,
      } : null,
    },
  };
}
