/**
 * Alertas, recordatorios y descargas de Gobserva (2026-11-01).
 *
 * Una alerta es una búsqueda guardada de un producto (los mismos filtros de su lista) que se avisa cada día o cada
 * semana con lo NUEVO desde el último aviso: plazas CAS que aparecieron o abrieron (empleo), convocatorias que
 * entraron a la base (licitaciones) y proyectos de inversión que aparecieron o cambiaron de fase (obras: pasan a
 * licitarse, empiezan la obra, se paralizan).
 *
 * El aviso va por correo (lib/correo.ts) si la persona verificó su correo y SES está configurado; si no, queda en la
 * bandeja de su cuenta, en la web (gobserva_envios con estado `en_la_web`). Las alertas diarias son de los planes de
 * pago: una alerta diaria de alguien que volvió al plan gratis se avisa una vez por semana.
 *
 * Corre en el cron de la API (worker.ts, todos los días a las 7:00 de Lima) por POST /admin/gobserva/tareas, y a mano
 * desde el panel.
 */
import { poolAdmin as db } from "./db.js";
import { registrar } from "./registro.js";
import { armarCorreo, correoAbierto, enviarCorreo, llegaCorreo, type FilaCorreo } from "./correo.js";
import { avisarPush } from "./gobservaPush.js";
import type { Notificacion } from "./webpush.js";
import { HOST_PRODUCTO, NOMBRE_PRODUCTO, limitesDe, planVigente, type Frecuencia, type ProductoPago } from "./gobservaPlanes.js";
import { filasPlazas, filtrosPlazas } from "../routes/empleo.js";
import { filasBandeja, filasOportunidades, filtrosBandejaAlerta, filtrosOportunidades } from "../routes/licitaciones.js";
import { condicionesProyectos, type FiltrosProyectos } from "../routes/proyectos.js";

export const DEPARTAMENTOS: Record<string, string> = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca", "07": "Callao",
  "08": "Cusco", "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque",
  "15": "Lima", "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura", "21": "Puno",
  "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const fechaCorta = (iso: unknown) => {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : null;
};
const NUM = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });
const soles = (n: unknown) => (typeof n === "number" && n > 0 ? `S/ ${NUM.format(n)}` : null);
const solesCortos = (n: unknown) => {
  if (typeof n !== "number" || n <= 0) return null;
  if (n >= 1e6) return `S/ ${(n / 1e6).toLocaleString("es-PE", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `S/ ${NUM.format(n / 1e3)} mil`;
  return `S/ ${NUM.format(n)}`;
};
/** «MEDICO CIRUJANO» → «Medico cirujano» (los títulos de SERVIR llegan en mayúsculas). */
const oracion = (t: unknown) => {
  const s = String(t ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const minus = s === s.toUpperCase() ? s.toLowerCase() : s;
  return minus.charAt(0).toUpperCase() + minus.slice(1);
};
/** «MUNICIPALIDAD DISTRITAL DE SAN JUAN» → «Municipalidad Distrital De San Juan» con artículos en minúscula. */
const nombrePropio = (t: unknown) =>
  oracion(t)
    .split(" ")
    .map((w, i) => (i > 0 && /^(de|del|la|las|los|y|e|en|el|para|por)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
const limpiarTitulo = (t: unknown) => String(t ?? "").replace(/^["“”'«»\s]+|["“”'«»\s]+$/g, "").trim();
const hoyLima = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const diasHasta = (iso: unknown) => {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(hoyLima())) / 86400_000);
};

/** Un resultado de una alerta, listo para el correo y para la bandeja de la web. */
export interface ItemAlerta {
  ref: string;
  titulo: string;
  enlace: string;
  datos: string[];
  marca?: string;
  /** La fecha en que cierra (para recordar a quien la guarde). */
  cierre?: string | null;
}

interface Buscador {
  /** Los filtros válidos (los mismos de la lista del producto) o null. */
  validar(f: Record<string, unknown>): object | null;
  buscar(f: object, limite: number, desde?: Date): Promise<ItemAlerta[]>;
  csv(f: object, limite: number): Promise<{ columnas: string[]; filas: (string | number | null)[][] }>;
}

const urlDe = (producto: ProductoPago, ruta: string) => `https://${HOST_PRODUCTO[producto]}${ruta}`;

/** Las fases y los sectores de Obras como los nombra la web (lib/gobserva-obras.ts). */
const FASE_OBRA: Record<string, string> = {
  viable: "Viable, sin expediente", expediente: "Con expediente técnico", licitacion: "Licitándose", ejecucion: "En ejecución",
  paralizada: "Paralizada", terminada: "Obra terminada", sin_movimiento: "Sin movimiento", cerrada: "Inversión cerrada",
};
const SECTOR_OBRA: Record<string, string> = {
  transporte: "Transporte", saneamiento: "Agua y saneamiento", educacion: "Educación", salud: "Salud", agro: "Agro, riego y pesca",
  urbano: "Vivienda y desarrollo urbano", deporte: "Cultura y deporte", energia: "Energía", ambiente: "Ambiente", seguridad: "Orden público y seguridad",
  gestion: "Gestión pública", social: "Protección social", comercio: "Comercio, turismo e industria", justicia: "Justicia",
  comunicaciones: "Comunicaciones", otros: "Otros",
};
const CAMPOS_OBRAS = ["pestana", "q", "region", "sector", "nivel", "fase", "modalidad", "tipo", "min", "max", "entidad"];

/**
 * Los proyectos de una búsqueda de Obras. Con `desde`, sólo lo nuevo: los que entraron a la tabla o cambiaron de fase
 * después de esa fecha y después de la primera carga (en la primera carga todos «entraron» a la vez: no son noticia).
 */
async function filasProyectos(f: FiltrosProyectos, limite: number, desde?: Date) {
  const { where, vals } = condicionesProyectos(f);
  const n = vals.length;
  const nuevo = desde
    ? ` AND (p.primera_vez > GREATEST($${n + 1}::timestamptz, (SELECT min(primera_vez) FROM gobserva_proyecto) + interval '1 hour')
          OR p.fase_cambio_at > GREATEST($${n + 1}::timestamptz, (SELECT min(primera_vez) FROM gobserva_proyecto) + interval '1 hour'))`
    : "";
  const r = await db.query(
    `SELECT p.cui, p.nombre, p.fase, p.sector, p.nivel, p.modalidad, p.entidad, p.entidad_ruc AS "entidadRuc", p.region, p.provincia,
            p.distrito, p.costo::float, p.por_ejecutar::float AS "porEjecutar", p.obra_fisico::float AS "obraFisico",
            to_char(p.fecha_viable, 'YYYY-MM-DD') AS "fechaViable", p.convocatoria_ocid AS "convocatoriaOcid",
            ${desde ? `p.primera_vez > $${n + 1}::timestamptz` : "false"} AS nuevo
       FROM gobserva_proyecto p
      WHERE ${where}${nuevo}
      ORDER BY ${desde ? "GREATEST(p.primera_vez, p.fase_cambio_at) DESC, " : ""}p.costo DESC NULLS LAST, p.cui DESC
      LIMIT ${Math.max(1, Math.min(5000, Math.floor(limite)))}`,
    desde ? [...vals, desde] : vals,
  );
  return r.rows as Record<string, unknown>[];
}

const BUSCADORES: Partial<Record<ProductoPago, Buscador>> = {
  empleo: {
    validar: (f) => filtrosPlazas(f),
    async buscar(f, limite, desde) {
      const filas = await filasPlazas(f as NonNullable<ReturnType<typeof filtrosPlazas>>, limite, desde);
      return filas.map((p) => {
        const dias = diasHasta(p.fechaFin);
        const lugar = String(p.ubicacion ?? "").split(" - ").map(nombrePropio).filter(Boolean).join(", ");
        return {
          ref: String(p.aviso),
          titulo: oracion(p.titulo) || "Plaza CAS",
          enlace: urlDe("empleo", `/plaza/${p.aviso}`),
          datos: [nombrePropio(p.entidad), lugar, soles(p.remuneracion) ? `${soles(p.remuneracion)} al mes` : null, p.fechaFin ? `Cierra el ${fechaCorta(p.fechaFin)}` : null]
            .filter((x): x is string => !!x),
          marca: dias === 0 ? "Cierra hoy" : dias === 1 ? "Cierra mañana" : undefined,
          cierre: typeof p.fechaFin === "string" ? p.fechaFin : null,
        };
      });
    },
    async csv(f, limite) {
      const filas = await filasPlazas(f as NonNullable<ReturnType<typeof filtrosPlazas>>, limite);
      return {
        columnas: ["Aviso", "Puesto", "Entidad", "Ubicación", "Sueldo mensual (S/)", "Vacantes", "Publicada", "Cierra", "Experiencia (años)", "Formación", "Enlace"],
        filas: filas.map((p) => [
          String(p.aviso), oracion(p.titulo), nombrePropio(p.entidad), String(p.ubicacion ?? ""), (p.remuneracion as number) ?? null,
          (p.vacantes as number) ?? null, (p.fechaInicio as string) ?? null, (p.fechaFin as string) ?? null, (p.expGeneral as number) ?? null,
          String(p.formacion ?? ""), urlDe("empleo", `/plaza/${p.aviso}`),
        ]),
      };
    },
  },
  licitaciones: {
    // Una alerta de la bandeja de la app (con `bandeja`) filtra como la bandeja; las demás, como /oportunidades.
    validar: (f) => (f.bandeja ? filtrosBandejaAlerta(f) : filtrosOportunidades(f)),
    async buscar(f, limite, desde) {
      const filas = esBandeja(f)
        ? await filasBandeja(f, limite, desde)
        : await filasOportunidades(f as NonNullable<ReturnType<typeof filtrosOportunidades>>, limite, desde);
      return filas.map((o) => {
        const dias = diasHasta(o.consultasHasta);
        return {
          ref: String(o.ocid),
          titulo: oracion(limpiarTitulo(o.objeto)) || "Convocatoria",
          enlace: urlDe("licitaciones", `/oportunidad/${encodeURIComponent(String(o.ocid))}`),
          datos: [
            nombrePropio(o.entidad),
            DEPARTAMENTOS[String(o.region ?? "")] ?? null,
            solesCortos(o.valor) ? `Valor ${solesCortos(o.valor)}` : null,
            o.consultasHasta ? `Consultas hasta el ${fechaCorta(o.consultasHasta)}` : null,
          ].filter((x): x is string => !!x),
          marca: dias != null && dias >= 0 && dias <= 2 ? (dias === 0 ? "Consultas cierran hoy" : `Consultas cierran en ${dias} ${dias === 1 ? "día" : "días"}`) : undefined,
          cierre: typeof o.consultasHasta === "string" ? o.consultasHasta : null,
        };
      });
    },
    async csv(f, limite) {
      const filas = esBandeja(f) ? await filasBandeja(f, limite) : await filasOportunidades(f as NonNullable<ReturnType<typeof filtrosOportunidades>>, limite);
      return {
        columnas: ["Convocada", "Código", "Objeto", "Tipo", "Procedimiento", "Entidad", "RUC de la entidad", "Región", "Valor referencial (S/)", "Consultas hasta", "Ítems", "Enlace"],
        filas: filas.map((o) => [
          (o.fecha as string) ?? null, (o.codigo as string) ?? null, limpiarTitulo(o.objeto), (o.tipo as string) ?? null, (o.procedimiento as string) ?? null,
          nombrePropio(o.entidad), (o.entidadRuc as string) ?? null, DEPARTAMENTOS[String(o.region ?? "")] ?? null, (o.valor as number) ?? null,
          (o.consultasHasta as string) ?? null, (o.items as number) ?? null, urlDe("licitaciones", `/oportunidad/${encodeURIComponent(String(o.ocid))}`),
        ]),
      };
    },
  },
  obras: {
    validar(f) {
      // Los filtros que no valen los descarta condicionesProyectos; aquí sólo quedan los campos conocidos.
      return Object.fromEntries(Object.entries(f).filter(([k, v]) => CAMPOS_OBRAS.includes(k) && v != null && v !== "")) as FiltrosProyectos;
    },
    async buscar(f, limite, desde) {
      const filas = await filasProyectos(f as FiltrosProyectos, limite, desde);
      return filas.map((p) => {
        const fase = FASE_OBRA[String(p.fase)] ?? null;
        return {
          ref: String(p.cui),
          titulo: oracion(p.nombre) || "Proyecto de inversión",
          enlace: urlDe("obras", `/proyecto/${p.cui}`),
          datos: [
            nombrePropio(p.entidad),
            DEPARTAMENTOS[String(p.region ?? "")] ?? null,
            solesCortos(p.costo) ? `Costo ${solesCortos(p.costo)}` : null,
            fase,
          ].filter((x): x is string => !!x),
          marca: desde ? (p.nuevo ? "Nuevo" : fase ? `Ahora: ${fase.toLowerCase()}` : undefined) : undefined,
        };
      });
    },
    async csv(f, limite) {
      const filas = await filasProyectos(f as FiltrosProyectos, limite);
      return {
        columnas: ["CUI", "Proyecto", "Fase", "Sector", "Entidad", "RUC de la entidad", "Región", "Provincia", "Distrito", "Costo (S/)",
          "Por ejecutar (S/)", "Avance físico de la obra (%)", "Viable desde", "Enlace"],
        filas: filas.map((p) => [
          String(p.cui), oracion(p.nombre), FASE_OBRA[String(p.fase)] ?? String(p.fase ?? ""), SECTOR_OBRA[String(p.sector)] ?? String(p.sector ?? ""),
          nombrePropio(p.entidad), (p.entidadRuc as string) ?? null, DEPARTAMENTOS[String(p.region ?? "")] ?? null, nombrePropio(p.provincia),
          nombrePropio(p.distrito), (p.costo as number) ?? null, (p.porEjecutar as number) ?? null, (p.obraFisico as number) ?? null,
          (p.fechaViable as string) ?? null, urlDe("obras", `/proyecto/${p.cui}`),
        ]),
      };
    },
  },
};

export const productoConAlertas = (p: ProductoPago) => !!BUSCADORES[p];

/** ¿Son filtros validados de la bandeja de la app? */
function esBandeja(f: object): f is NonNullable<ReturnType<typeof filtrosBandejaAlerta>> {
  return (f as { bandeja?: unknown }).bandeja === true;
}

/** Los filtros válidos de un producto (o null si el producto todavía no tiene alertas o los filtros no sirven). */
export function validarFiltros(producto: ProductoPago, f: Record<string, unknown>): object | null {
  return BUSCADORES[producto]?.validar(f) ?? null;
}

/** Lo que una alerta avisaría hoy (la vista previa del formulario): lo de los últimos `dias` días. */
export async function probarAlerta(producto: ProductoPago, f: Record<string, unknown>, dias = 7): Promise<{ total: number; items: ItemAlerta[] } | null> {
  const b = BUSCADORES[producto];
  const v = b?.validar(f);
  if (!b || !v) return null;
  const items = await b.buscar(v, 11, new Date(Date.now() - dias * 86400_000));
  return { total: items.length, items: items.slice(0, 10) };
}

// ─── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const celdaCsv = (v: string | number | null) => {
  if (v == null) return "";
  const s = String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Una búsqueda en CSV (con BOM: Excel lo abre con tildes). null si el producto no exporta o los filtros no sirven. */
export async function exportarCsv(producto: ProductoPago, f: Record<string, unknown>, limite: number): Promise<{ csv: string; filas: number } | null> {
  const b = BUSCADORES[producto];
  const v = b?.validar(f);
  if (!b || !v) return null;
  const { columnas, filas } = await b.csv(v, limite);
  const lineas = [columnas.map(celdaCsv).join(","), ...filas.map((fila) => fila.map(celdaCsv).join(","))];
  return { csv: `﻿${lineas.join("\r\n")}\r\n`, filas: filas.length };
}

// ─── Envío ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface AlertaPorEnviar {
  id: number;
  firebase_uid: string;
  producto: ProductoPago;
  nombre: string;
  filtros: Record<string, unknown>;
  frecuencia: Frecuencia;
  token_pausa: string;
  ultimo_envio_at: Date | null;
  email: string;
  email_verificado: boolean;
}

export interface ResumenTareas {
  alertas: number;
  conNovedades: number;
  correos: number;
  enLaWeb: number;
  fallidas: number;
  recordatorios: number;
  vencidos: number;
  correoActivo: boolean;
}

const pie = (producto: ProductoPago, extra: string[] = []) => [
  ...extra,
  `${NOMBRE_PRODUCTO[producto]} ordena datos públicos del Estado peruano y enlaza siempre a la fuente oficial.`,
  `Gobserva no es una entidad del Estado. Escríbenos a hello@gobserva.cloud.`,
];

/**
 * Guarda lo avisado y, si se puede, lo manda por correo y como notificación a los dispositivos que la persona activó.
 * Devuelve el estado del correo (la notificación es aparte: `push` en gobserva_envios).
 */
async function avisar(a: {
  uid: string; producto: ProductoPago; alertaId: number | null; tipo: "alerta" | "recordatorio" | "recibo" | "aviso";
  email: string; verificado: boolean; asunto: string; html: string; texto: string; items: ItemAlerta[]; baja?: string;
  notificacion?: Partial<Notificacion>;
}): Promise<"enviado" | "en_la_web" | "fallido"> {
  let estado: "enviado" | "en_la_web" | "fallido" = "en_la_web";
  let mensajeId: string | null = null;
  let error: string | null = null;
  if (a.verificado && a.email && !a.email.endsWith(".invalid") && !a.email.endsWith("@vigia.local") && (await llegaCorreo(a.email))) {
    try {
      mensajeId = await enviarCorreo({ para: a.email, asunto: a.asunto, html: a.html, texto: a.texto, baja: a.baja });
      estado = "enviado";
    } catch (e) {
      estado = "fallido";
      error = (e as Error).message.slice(0, 480);
    }
  }
  const primero = a.items[0];
  const mas = a.items.length > 3 ? `\ny ${a.items.length - 3} más` : "";
  const push = await avisarPush(a.uid, a.producto, {
    titulo: a.notificacion?.titulo ?? a.asunto,
    cuerpo: a.notificacion?.cuerpo ?? (a.items.length ? a.items.slice(0, 3).map((i) => i.titulo).join("\n") + mas : "Ya está en tu cuenta."),
    url: a.notificacion?.url ?? (a.items.length === 1 && primero?.enlace ? primero.enlace : urlDe(a.producto, "/cuenta?tab=alertas")),
    tag: a.notificacion?.tag ?? (a.alertaId ? `alerta-${a.alertaId}` : a.tipo),
  }).catch(() => 0);
  await db.query(
    `INSERT INTO gobserva_envios (alerta_id, firebase_uid, producto, tipo, asunto, items, n_items, estado, error, mensaje_id, push)
     VALUES ($1, $2, $3, $4, left($5, 200), $6, $7, $8, $9, $10, $11)`,
    [a.alertaId, a.uid, a.producto, a.tipo, a.asunto, JSON.stringify(a.items.slice(0, 30).map(({ cierre: _c, ...i }) => i)), a.items.length, estado, error, mensajeId, push]);
  return estado;
}

/**
 * Pausar una alerta desde el correo. En el cuerpo va una página con un botón (los filtros de correo abren los enlaces
 * solos: un GET no puede pausar nada); en la cabecera List-Unsubscribe, la API, que pausa con un POST de un clic
 * (RFC 8058, lo que hace Gmail con «Anular suscripción»).
 */
export const enlacePausaWeb = (producto: ProductoPago, token: string) => `https://${HOST_PRODUCTO[producto]}/pausar?t=${token}`;
export const enlacePausa = (producto: ProductoPago, token: string) => `https://${HOST_PRODUCTO[producto]}/v1/gobserva/alertas/pausar?t=${token}`;

/**
 * Avisa las alertas que tocan: las diarias que no se avisaron en 20 horas y las semanales que no se avisaron en 6 días
 * y medio. `soloAlerta` avisa una (botón «Enviar ahora» del panel) aunque no le toque.
 */
export async function enviarAlertas(opciones: { soloAlerta?: number; tope?: number } = {}): Promise<Omit<ResumenTareas, "recordatorios" | "vencidos">> {
  const r = await db.query<AlertaPorEnviar>(
    `SELECT a.id, a.firebase_uid, a.producto, a.nombre, a.filtros, a.frecuencia, a.token_pausa, a.ultimo_envio_at, c.email, c.email_verificado
       FROM gobserva_alertas a JOIN gobserva_cuentas c ON c.firebase_uid = a.firebase_uid
      WHERE a.activa AND c.baja_at IS NULL
        AND ${opciones.soloAlerta ? "a.id = $1" : `(a.ultimo_envio_at IS NULL
             OR (a.frecuencia = 'diaria' AND a.ultimo_envio_at < now() - interval '20 hours')
             OR a.ultimo_envio_at < now() - interval '6 days 12 hours')`}
      ORDER BY a.ultimo_envio_at NULLS FIRST, a.id
      LIMIT ${Math.max(1, Math.min(500, opciones.tope ?? 300))}`,
    opciones.soloAlerta ? [opciones.soloAlerta] : []);
  const resumen = { alertas: 0, conNovedades: 0, correos: 0, enLaWeb: 0, fallidas: 0, correoActivo: await correoAbierto() };
  for (const a of r.rows) {
    resumen.alertas++;
    try {
      const b = BUSCADORES[a.producto];
      const filtros = b?.validar(a.filtros ?? {});
      if (!b || !filtros) continue;
      // Una alerta diaria de quien ya no tiene un plan de pago se avisa una vez por semana.
      const plan = await planVigente(a.firebase_uid, a.producto);
      const limites = await limitesDe(a.producto, plan?.plan ?? null);
      const diaria = a.frecuencia === "diaria" && limites.frecuencias.includes("diaria");
      if (!opciones.soloAlerta && !diaria && a.ultimo_envio_at && Date.now() - a.ultimo_envio_at.getTime() < 6.5 * 86400_000) continue;
      const desde = a.ultimo_envio_at ?? new Date(Date.now() - (diaria ? 1 : 7) * 86400_000);
      const encontrados = await b.buscar(filtros, 21, desde);
      if (!encontrados.length) {
        await db.query(`UPDATE gobserva_alertas SET ultimo_envio_at = now(), ultimo_conteo = 0 WHERE id = $1`, [a.id]);
        continue;
      }
      resumen.conNovedades++;
      const items = encontrados.slice(0, 20);
      const hay = encontrados.length > 20 ? "más de 20" : String(encontrados.length);
      const uno = encontrados.length === 1;
      const que = {
        empleo: uno ? "plaza nueva" : "plazas nuevas",
        licitaciones: uno ? "oportunidad nueva" : "oportunidades nuevas",
        obras: uno ? "proyecto con novedades" : "proyectos con novedades",
      }[a.producto];
      const asunto = `${hay} ${que}: ${a.nombre}`;
      const lista = { empleo: "/plazas", licitaciones: "/oportunidades", obras: "/proyectos" }[a.producto];
      // En Obras, sin pestaña la lista abre «Se vienen»: el enlace lleva a todas para que se vea lo avisado.
      const filtrosLista = a.producto === "obras" && !a.filtros?.pestana ? { pestana: "todos", ...a.filtros } : (a.filtros ?? {});
      const qs = new URLSearchParams(Object.entries(filtrosLista).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
      const pausa = enlacePausaWeb(a.producto, a.token_pausa);
      const { html, texto } = armarCorreo({
        producto: a.producto,
        titular: `${hay} ${que} para «${a.nombre}»`,
        bajada: diaria ? "Lo que apareció desde tu último aviso." : "Lo que apareció esta semana.",
        filas: items.map<FilaCorreo>((i) => ({ titulo: i.titulo, enlace: i.enlace, datos: i.datos, marca: i.marca })),
        boton: { texto: "Ver todo en la web", enlace: urlDe(a.producto, `${lista}${qs ? `?${qs}` : ""}`) },
        pie: pie(a.producto, [
          `Recibes esto porque creaste la alerta «${a.nombre}». Para pausarla: ${pausa}`,
          `Para cambiarla: ${urlDe(a.producto, "/cuenta?tab=alertas")}`,
        ]),
      });
      const estado = await avisar({
        uid: a.firebase_uid, producto: a.producto, alertaId: a.id, tipo: "alerta", email: a.email, verificado: a.email_verificado,
        asunto, html, texto, items, baja: enlacePausa(a.producto, a.token_pausa),
      });
      if (estado === "enviado") resumen.correos++;
      else if (estado === "en_la_web") resumen.enLaWeb++;
      else resumen.fallidas++;
      await db.query(`UPDATE gobserva_alertas SET ultimo_envio_at = now(), ultimo_conteo = $2 WHERE id = $1`, [a.id, encontrados.length]);
    } catch (e) {
      resumen.fallidas++;
      registrar("WARNING", `[gobserva] alerta ${a.id}: ${(e as Error).message}`);
    }
  }
  return resumen;
}

/** «Cierra en 2 días»: lo guardado que cierra (o cuyas consultas cierran) pasado mañana, una vez por cosa guardada. */
export async function enviarRecordatorios(): Promise<number> {
  const r = await db.query<{ firebase_uid: string; producto: ProductoPago; email: string; email_verificado: boolean; items: { ref: string; titulo: string; tipo: string; datos: Record<string, unknown> }[] }>(
    `SELECT g.firebase_uid, g.producto, c.email, c.email_verificado,
            json_agg(json_build_object('ref', g.ref, 'titulo', g.titulo, 'tipo', g.tipo, 'datos', g.datos) ORDER BY g.titulo) AS items
       FROM gobserva_guardados g JOIN gobserva_cuentas c ON c.firebase_uid = g.firebase_uid
      WHERE g.recordar AND g.recordado_at IS NULL AND c.baja_at IS NULL
        AND g.estado IN ('guardada', 'preparando')
        AND g.datos ? 'cierre' AND (g.datos->>'cierre') ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND left(g.datos->>'cierre', 10)::date = (now() AT TIME ZONE 'America/Lima')::date + 2
      GROUP BY 1, 2, 3, 4`);
  let n = 0;
  for (const g of r.rows) {
    try {
      const items: ItemAlerta[] = g.items.map((i) => ({
        ref: i.ref,
        titulo: i.titulo || i.ref,
        enlace: urlDe(g.producto, i.tipo === "plaza" ? `/plaza/${i.ref}` : i.tipo === "oportunidad" ? `/oportunidad/${encodeURIComponent(i.ref)}` : `/proyecto/${i.ref}`),
        datos: [typeof i.datos?.entidad === "string" ? nombrePropio(i.datos.entidad) : null, `Cierra el ${fechaCorta(i.datos?.cierre)}`].filter((x): x is string => !!x),
        marca: "Cierra en 2 días",
      }));
      const asunto = items.length === 1 ? `Cierra en 2 días: ${items[0].titulo}` : `${items.length} de tus guardados cierran en 2 días`;
      const { html, texto } = armarCorreo({
        producto: g.producto,
        titular: asunto,
        bajada: g.producto === "empleo" ? "Si te interesa, postula antes de que cierre." : "Si vas a participar, revisa las bases y el cronograma a tiempo.",
        filas: items,
        boton: { texto: "Ver mis guardados", enlace: urlDe(g.producto, "/cuenta?tab=guardados") },
        pie: pie(g.producto, [`Puedes apagar estos recordatorios en ${urlDe(g.producto, "/cuenta?tab=guardados")}`]),
      });
      await avisar({ uid: g.firebase_uid, producto: g.producto, alertaId: null, tipo: "recordatorio", email: g.email, verificado: g.email_verificado, asunto, html, texto, items });
      await db.query(
        `UPDATE gobserva_guardados SET recordado_at = now() WHERE firebase_uid = $1 AND producto = $2 AND ref = ANY($3::text[])`,
        [g.firebase_uid, g.producto, g.items.map((i) => i.ref)]);
      n += items.length;
    } catch (e) {
      registrar("WARNING", `[gobserva] recordatorio ${g.producto}: ${(e as Error).message}`);
    }
  }
  return n;
}

/** Planes que ya no tienen pago (tres días de gracia), y lo pendiente de pagar con QR que nadie pagó en 10 días. */
export async function vencerPlanes(): Promise<number> {
  const r = await db.query(
    `UPDATE gobserva_planes_cliente SET estado = 'vencida', actualizado_at = now()
      WHERE estado = 'activa' AND vigente_hasta IS NOT NULL AND vigente_hasta + interval '3 days' < now() RETURNING id`);
  await db.query(
    `UPDATE gobserva_cobros SET estado = 'rechazado', motivo = 'Sin pago en 10 días'
      WHERE estado = 'pendiente' AND medio <> 'tarjeta' AND creado_at < now() - interval '10 days'`);
  await db.query(
    `UPDATE gobserva_planes_cliente p SET estado = 'rechazada', motivo = COALESCE(p.motivo, 'Sin pago en 10 días'), actualizado_at = now()
      WHERE p.estado = 'pendiente' AND p.creado_at < now() - interval '10 days'`);
  return r.rowCount ?? 0;
}

/** Lo que corre cada mañana: vencimientos, alertas y recordatorios. */
export async function tareasDiarias(): Promise<ResumenTareas> {
  const vencidos = await vencerPlanes();
  const alertas = await enviarAlertas();
  const recordatorios = await enviarRecordatorios();
  const resumen = { ...alertas, recordatorios, vencidos };
  registrar("INFO", `[gobserva] tareas diarias: ${JSON.stringify(resumen)}`);
  return resumen;
}

/** Pausa una alerta por el enlace de su correo. Devuelve su nombre y producto, o null si el enlace no existe. */
export async function pausarPorToken(token: string): Promise<{ nombre: string; producto: ProductoPago } | null> {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  const r = await db.query<{ nombre: string; producto: ProductoPago }>(
    `UPDATE gobserva_alertas SET activa = false, actualizado_at = now() WHERE token_pausa = $1 RETURNING nombre, producto`, [token]);
  return r.rows[0] ?? null;
}

/** El recibo de un cobro pagado, por correo (y en la bandeja). */
export async function avisarRecibo(cobroId: number): Promise<void> {
  const r = await db.query<{
    numero: string; monto: number; meses: number; medio: string; pagado: string; producto: ProductoPago; plan: string; uid: string;
    email: string; verificado: boolean; vigente: string | null;
  }>(
    `SELECT k.numero, k.monto_pen::float AS monto, k.meses, k.medio, to_char(k.pagado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS pagado,
            p.producto, p.plan, p.firebase_uid AS uid, c.email, c.email_verificado AS verificado,
            to_char(p.vigente_hasta AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS vigente
       FROM gobserva_cobros k JOIN gobserva_planes_cliente p ON p.id = k.plan_id JOIN gobserva_cuentas c ON c.firebase_uid = p.firebase_uid
      WHERE k.id = $1 AND k.estado = 'pagado'`, [cobroId]);
  const k = r.rows[0];
  if (!k) return;
  const medio = { tarjeta: "Tarjeta (Mercado Pago)", yape: "Yape", plin: "Plin", transferencia: "Transferencia", cortesia: "Cortesía" }[k.medio] ?? k.medio;
  const asunto = `Recibo ${k.numero}: ${NOMBRE_PRODUCTO[k.producto]}`;
  const { html, texto } = armarCorreo({
    producto: k.producto,
    titular: "Recibimos tu pago. Gracias.",
    bajada: `Tu plan de ${NOMBRE_PRODUCTO[k.producto]} está activo${k.vigente ? ` hasta el ${fechaCorta(k.vigente)}` : ""}.`,
    detalle: [
      ["Recibo", k.numero],
      ["Plan", `${NOMBRE_PRODUCTO[k.producto]}, ${k.plan}`],
      ["Monto", `S/ ${k.monto.toFixed(2)}${k.meses > 1 ? ` (${k.meses} meses)` : ""}`],
      ["Medio de pago", medio],
      ["Fecha", k.pagado ?? ""],
    ],
    boton: { texto: "Ver mi recibo", enlace: urlDe(k.producto, `/cuenta/recibo/${k.numero}`) },
    pie: pie(k.producto, ["Puedes cancelar tu plan cuando quieras desde tu cuenta: no se vuelve a cobrar."]),
  });
  await avisar({
    uid: k.uid, producto: k.producto, alertaId: null, tipo: "recibo", email: k.email, verificado: true, asunto, html, texto, items: [],
    notificacion: {
      titulo: "Recibimos tu pago",
      cuerpo: `Tu plan de ${NOMBRE_PRODUCTO[k.producto]} está activo${k.vigente ? ` hasta el ${fechaCorta(k.vigente)}` : ""}.`,
      url: urlDe(k.producto, `/cuenta/recibo/${k.numero}`),
    },
  });
}
