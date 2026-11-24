/**
 * Los planes de pago de Gobserva (2026-11-01): qué se cobra, cuánto, con qué precio de fundador y qué trae cada plan
 * (cuántas alertas, con qué frecuencia, cuántos guardados, si baja CSV). La API es la que manda: el precio que se cobra
 * sale de acá, nunca del navegador.
 *
 * Los valores por defecto viven en este archivo; el panel los puede cambiar sin desplegar (ajustes.clave = 'gobserva',
 * routes/admin_gobserva.ts): precios, precio de fundador, planes activos, medios de pago y los datos del vendedor que
 * salen en el recibo (RUC, razón social, dirección). Mientras no haya RUC, el recibo es una constancia de pago y lo dice.
 * El RUC también puede venir de la variable GOBSERVA_RUC (y GOBSERVA_RAZON_SOCIAL) del Worker.
 *
 * Precio de fundador: con `cupo`, para los primeros N que contraten ese plan (y lo conservan mientras sigan); con
 * `meses`, para los N primeros cobros de cada persona (después pasa solo al precio regular).
 */
import { pool } from "./db.js";
import { Memo } from "./cache.js";

export type ProductoPago = "empleo" | "licitaciones" | "obras";
export const PRODUCTOS_PAGO: ProductoPago[] = ["empleo", "licitaciones", "obras"];
export type Frecuencia = "diaria" | "semanal";
export type MedioPago = "tarjeta" | "yape" | "plin" | "transferencia" | "cortesia";

export const NOMBRE_PRODUCTO: Record<ProductoPago, string> = {
  empleo: "Gobserva Empleo",
  licitaciones: "Gobserva Licitaciones",
  obras: "Gobserva Obras",
};
export const HOST_PRODUCTO: Record<ProductoPago, string> = {
  empleo: "empleo.gobserva.cloud",
  licitaciones: "licitaciones.gobserva.cloud",
  obras: "obras.gobserva.cloud",
};

/** Lo que permite un plan. El plan gratis también tiene límites: es la puerta de entrada. */
export interface Limites {
  alertas: number;
  frecuencias: Frecuencia[];
  guardados: number;
  csv: boolean;
  /** Filas por descarga. */
  filasCsv: number;
  recordatorios: boolean;
  /** Líneas de negocio para «Para ti» (Licitaciones, migración 264): cuántas, y cuántas oportunidades se muestran. */
  lineas: number;
  paraTi: number;
  /** Créditos del MCP al mes (2026-11-08; 0: sin MCP). Cuánto descuenta cada herramienta: mcp-worker/src/v2/cupos.ts. */
  mcp: number;
}

export interface Fundador {
  precio: number;
  /** Para los primeros N que lo contraten. */
  cupo?: number | null;
  /** Durante los primeros N cobros. */
  meses?: number | null;
}

interface PlanBase {
  nombre: string;
  precio: number;
  fundador?: Fundador | null;
  limites: Limites;
  /** false: no se vende (sólo se puede dar de cortesía desde el panel). */
  activo: boolean;
}

export const LIMITES_GRATIS: Limites = { alertas: 1, frecuencias: ["semanal"], guardados: 30, csv: false, filasCsv: 0, recordatorios: true, lineas: 1, paraTi: 10, mcp: 0 };

/**
 * Los cobros en pausa (2026-11-24, el usuario: «las suscripciones a Gobserva, frena; por ahora próximamente, como
 * freemium: pueden usar el MCP y demás sólo si se crean cuenta con correo y se autentican»). Mientras tanto, toda cuenta
 * con correo verificado tiene el acceso abierto de cada producto (`LIMITES_ABIERTO`), como un plan sin cobro ni
 * vencimiento (`planVigente`); los planes ya pagados siguen como estaban. GOBSERVA_COBROS=activos vuelve a vender.
 */
export const cobrosEnPausa = () => (process.env.GOBSERVA_COBROS ?? "").trim().toLowerCase() !== "activos";
export const PLAN_ABIERTO = "abierto";
const ABIERTO_PROVEEDOR: Limites = {
  alertas: 5, frecuencias: ["diaria", "semanal"], guardados: 500, csv: true, filasCsv: 1000, recordatorios: true, lineas: 3, paraTi: 50, mcp: 1500,
};
export const LIMITES_ABIERTO: Record<ProductoPago, Limites> = {
  empleo: { alertas: 5, frecuencias: ["diaria", "semanal"], guardados: 300, csv: true, filasCsv: 500, recordatorios: true, lineas: 1, paraTi: 50, mcp: 300 },
  licitaciones: ABIERTO_PROVEEDOR,
  obras: ABIERTO_PROVEEDOR,
};
/** Uno por producto que se vendía (Obras va con Licitaciones: sus créditos del MCP no se suman dos veces). */
export const codigoAbierto = (producto: ProductoPago) => `ABIERTO-${producto === "obras" ? "LICITACIONES" : producto.toUpperCase()}`;
export const esAbierto = (codigo: string | null | undefined) => !!codigo?.startsWith("ABIERTO-");

const PRO = (alertas: number, guardados: number, filasCsv: number, mcp: number, lineas = 1): Limites => ({
  alertas, frecuencias: ["diaria", "semanal"], guardados, csv: true, filasCsv, recordatorios: true, lineas, paraTi: 50, mcp,
});

/** Los planes para quien le vende al Estado: los de Licitaciones (que se venden) y su espejo en Obras (que no). */
const PLANES_PROVEEDOR = (activo: boolean): Record<string, PlanBase> => ({
  inicia: { nombre: "Inicia", precio: 99, fundador: { precio: 49, cupo: 50 }, limites: PRO(3, 300, 500, 1500, 1), activo },
  crece: { nombre: "Crece", precio: 199, fundador: { precio: 99, cupo: 50 }, limites: PRO(15, 1000, 2000, 5000, 3), activo },
  pro: { nombre: "Pro", precio: 349, fundador: { precio: 179, cupo: 50 }, limites: PRO(50, 3000, 5000, 15000, 10), activo },
});

/** Los planes que se pagan. Gratis no está: es la ausencia de plan. «Institucional» se conversa (no se vende acá). */
const CATALOGO: Record<ProductoPago, Record<string, PlanBase>> = {
  empleo: {
    alertas: { nombre: "Alertas", precio: 9.9, fundador: { precio: 4.9, meses: 3 }, limites: PRO(5, 300, 500, 300), activo: true },
    institucional: { nombre: "Bolsas de trabajo e institutos", precio: 149, limites: PRO(50, 3000, 2000, 5000), activo: true },
  },
  // Una sola plataforma para quien le vende al Estado (2026-11-07): Licitaciones trae Obras, los contratos menores
  // abiertos y el mercado. Precios por debajo de LicitaLAB Perú (S/ 240, 325 y 480) y de fundador para las primeras 50
  // empresas de cada plan. Antes: Pro S/ 79 y Empresa S/ 149 (sin clientes).
  licitaciones: PLANES_PROVEEDOR(true),
  // Obras ya no se vende aparte: un plan de Licitaciones lo cubre (planVigente). Quedan los mismos planes sin vender, para
  // que los límites de Obras salgan del plan de Licitaciones.
  obras: PLANES_PROVEEDOR(false),
};

export interface Vendedor {
  /** El nombre con el que se vende. */
  nombreComercial: string;
  ruc: string;
  razonSocial: string;
  direccion: string;
  correo: string;
}

export interface ConfigGobserva {
  vendedor: Vendedor;
  medios: { tarjeta: boolean; yape: boolean; plin: boolean; transferencia: boolean };
  /** Cambios del panel sobre el catálogo: precio, fundador (null lo quita) y si se vende. */
  planes: Partial<Record<ProductoPago, Record<string, { precio?: number; fundador?: Fundador | null; activo?: boolean }>>>;
  /** Un aviso corto arriba de los planes («Precio de fundador hasta el 30 de noviembre»). */
  aviso: string;
}

const CONFIG_BASE = (): ConfigGobserva => ({
  vendedor: {
    nombreComercial: "Gobserva",
    ruc: (process.env.GOBSERVA_RUC ?? "").trim(),
    razonSocial: (process.env.GOBSERVA_RAZON_SOCIAL ?? "").trim(),
    direccion: "",
    correo: "hello@gobserva.cloud",
  },
  medios: { tarjeta: true, yape: true, plin: true, transferencia: false },
  planes: {},
  aviso: "",
});

const memoConfig = new Memo<ConfigGobserva>({ nombre: "gobserva-config", ttlMs: 60_000, staleMs: 300_000, max: 2 });

/** La configuración: la base de este archivo con lo que guardó el panel encima. */
export function leerConfig(): Promise<ConfigGobserva> {
  return memoConfig.obtener("config", async () => {
    const base = CONFIG_BASE();
    const r = await pool.query<{ valor: Partial<ConfigGobserva> | null }>(`SELECT valor FROM ajustes WHERE clave = 'gobserva'`);
    const v = r.rows[0]?.valor ?? {};
    return {
      vendedor: { ...base.vendedor, ...(v.vendedor ?? {}), ruc: (v.vendedor?.ruc || base.vendedor.ruc || "").trim() },
      medios: { ...base.medios, ...(v.medios ?? {}) },
      planes: v.planes ?? {},
      aviso: typeof v.aviso === "string" ? v.aviso : "",
    };
  });
}

export interface PlanPago {
  producto: ProductoPago;
  id: string;
  nombre: string;
  precio: number;
  fundador: Fundador | null;
  limites: Limites;
  activo: boolean;
}

/** Un plan con lo que cambió el panel. null si no existe. */
export async function planDe(producto: ProductoPago, id: string): Promise<PlanPago | null> {
  const base = CATALOGO[producto]?.[id];
  if (!base) return null;
  const cambio = (await leerConfig()).planes[producto]?.[id] ?? {};
  const fundador = cambio.fundador === null ? null : (cambio.fundador ?? base.fundador ?? null);
  return {
    producto,
    id,
    nombre: base.nombre,
    precio: Number.isFinite(cambio.precio) && (cambio.precio as number) > 0 ? (cambio.precio as number) : base.precio,
    fundador,
    limites: base.limites,
    activo: cambio.activo ?? base.activo,
  };
}

export async function planesDe(producto: ProductoPago): Promise<PlanPago[]> {
  const ids = Object.keys(CATALOGO[producto] ?? {});
  return (await Promise.all(ids.map((id) => planDe(producto, id)))).filter((p): p is PlanPago => !!p);
}

/** Los planes tal como los define este archivo (para el panel: qué se cambió y qué no). */
export function catalogoBase(): Record<ProductoPago, Record<string, Omit<PlanBase, "limites">>> {
  return Object.fromEntries(
    PRODUCTOS_PAGO.map((p) => [p, Object.fromEntries(Object.entries(CATALOGO[p]).map(([id, b]) => [id, { nombre: b.nombre, precio: b.precio, fundador: b.fundador ?? null, activo: b.activo }]))]),
  ) as Record<ProductoPago, Record<string, Omit<PlanBase, "limites">>>;
}

/** Cuántos lugares de fundador quedan en un plan con cupo (null si el plan no tiene cupo). */
export async function cupoFundadorLibre(p: PlanPago): Promise<number | null> {
  if (!p.fundador?.cupo) return null;
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM gobserva_planes_cliente
      WHERE producto = $1 AND plan = $2 AND fundador AND estado IN ('activa', 'cancelada', 'vencida') AND cobros > 0`,
    [p.producto, p.id]);
  return Math.max(0, p.fundador.cupo - (r.rows[0]?.n ?? 0));
}

/** El precio de un plan nuevo hoy: con el de fundador si corresponde. */
export async function precioNuevo(p: PlanPago): Promise<{ monto: number; regular: number; fundador: boolean; mesesFundador: number | null }> {
  const regular = p.precio;
  if (!p.fundador) return { monto: regular, regular, fundador: false, mesesFundador: null };
  if (p.fundador.cupo) {
    const libre = await cupoFundadorLibre(p);
    if (!libre) return { monto: regular, regular, fundador: false, mesesFundador: null };
  }
  return { monto: p.fundador.precio, regular, fundador: true, mesesFundador: p.fundador.meses ?? null };
}

/**
 * Lo que cuesta pagar `meses` por adelantado (Yape, Plin o transferencia): con precio de fundador por mes, salvo que el
 * fundador tenga meses (los que pasen de ahí van a precio regular).
 */
export function montoPorMeses(precio: { monto: number; regular: number; fundador: boolean; mesesFundador: number | null }, meses: number): number {
  if (!precio.fundador) return round2(precio.regular * meses);
  const conDescuento = precio.mesesFundador ? Math.min(meses, precio.mesesFundador) : meses;
  return round2(precio.monto * conDescuento + precio.regular * (meses - conDescuento));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Los límites de una persona en un producto según su plan vigente (o los del plan gratis). */
export async function limitesDe(producto: ProductoPago, plan: string | null): Promise<Limites> {
  if (!plan) return LIMITES_GRATIS;
  if (plan === PLAN_ABIERTO) return LIMITES_ABIERTO[producto];
  return (await planDe(producto, plan))?.limites ?? LIMITES_GRATIS;
}

/** El plan del equipo en cada producto (migración 273): el más alto. Obras viene con el de Licitaciones. */
export const PLAN_EQUIPO: Record<ProductoPago, string> = { empleo: "institucional", licitaciones: "pro", obras: "pro" };
/** El código del plan del equipo: uno por producto que se vende (Obras usa el de Licitaciones, así sus créditos no se suman dos veces). */
export const codigoEquipo = (producto: ProductoPago) => `EQUIPO-${producto === "obras" ? "LICITACIONES" : producto.toUpperCase()}`;

const memoEquipo = new Memo<boolean>({ nombre: "gobserva-equipo", ttlMs: 60_000, staleMs: 300_000, max: 2000 });

/**
 * ¿La cuenta es del equipo? (migración 273: gobserva_equipo por correo exacto o «@dominio», más los administradores del
 * panel). Sólo con correo VERIFICADO: el del token si lo hay; si no (las alertas, que sólo tienen el uid), el que guardó
 * la cuenta.
 */
export function esEquipo(uid: string, correoVerificado?: string | null): Promise<boolean> {
  const correo = correoVerificado?.trim().toLowerCase() || null;
  return memoEquipo.obtener(`${uid}|${correo ?? ""}`, async () => {
    const r = await pool.query<{ si: boolean }>(
      `WITH c AS (SELECT coalesce($2::text, (SELECT lower(email) FROM gobserva_cuentas WHERE firebase_uid = $1 AND email_verificado)) AS correo)
       SELECT EXISTS (SELECT 1 FROM c JOIN gobserva_equipo e
                        ON e.patron = c.correo OR (left(e.patron, 1) = '@' AND right(c.correo, length(e.patron)) = e.patron))
           OR EXISTS (SELECT 1 FROM c JOIN equipo q ON q.correo = c.correo AND q.activo AND q.rol = 'admin') AS si`,
      [uid, correo]);
    return r.rows[0]?.si === true;
  });
}

/** El correo de la sesión, si quien la abrió lo verificó (para `planVigente` y `esEquipo`). */
export const correoVerificado = (u: { email: string | null; emailVerificado: boolean }) => (u.emailVerificado ? u.email : null);

/** Un correo real (no el sintético de una cuenta de Vigía, «…@vigia.local»). */
const correoReal = (correo: string | null | undefined) => !!correo && !/@vigia\.local$/i.test(correo);

/**
 * ¿La cuenta tiene un correo real verificado? El de la sesión si se pasó (null: no lo verificó); si no se pasó (las
 * alertas, que sólo tienen el uid), el que guardó la cuenta.
 */
async function conCorreoVerificado(uid: string, correo: string | null | undefined): Promise<boolean> {
  if (correo !== undefined) return correoReal(correo);
  const r = await pool.query<{ email: string | null }>(
    `SELECT email FROM gobserva_cuentas WHERE firebase_uid = $1 AND email_verificado AND baja_at IS NULL`, [uid]);
  return correoReal(r.rows[0]?.email);
}

/**
 * El plan vigente de una persona en un producto: activo y pagado (con 3 días de gracia: un cobro mensual puede llegar
 * un poco tarde). null = gratis. El equipo (`esEquipo`) tiene siempre el más alto, sin fila ni vencimiento. Con los cobros
 * en pausa (`cobrosEnPausa`), una cuenta con correo verificado y sin plan pagado tiene el abierto (`PLAN_ABIERTO`).
 */
export async function planVigente(uid: string, producto: ProductoPago, correo?: string | null): Promise<{ codigo: string; plan: string; vigenteHasta: string | null } | null> {
  const pagado = await planPagado(uid, producto, correo);
  if (pagado) return pagado;
  if (cobrosEnPausa() && (await conCorreoVerificado(uid, correo).catch(() => false))) {
    return { codigo: codigoAbierto(producto), plan: PLAN_ABIERTO, vigenteHasta: null };
  }
  return null;
}

async function planPagado(uid: string, producto: ProductoPago, correo?: string | null): Promise<{ codigo: string; plan: string; vigenteHasta: string | null } | null> {
  if (await esEquipo(uid, correo).catch(() => false)) return { codigo: codigoEquipo(producto), plan: PLAN_EQUIPO[producto], vigenteHasta: null };
  // Obras viene con Licitaciones (2026-11-07): un plan de cualquiera de los dos vale para Obras.
  const productos = producto === "obras" ? ["obras", "licitaciones"] : [producto];
  const r = await pool.query<{ codigo: string; plan: string; vigenteHasta: string | null }>(
    `SELECT codigo, plan, to_char(vigente_hasta AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "vigenteHasta"
       FROM gobserva_planes_cliente
      WHERE firebase_uid = $1 AND producto = ANY($2::text[]) AND estado = 'activa'
        AND (vigente_hasta IS NULL OR vigente_hasta + interval '3 days' > now())
      ORDER BY creado_at DESC LIMIT 1`,
    [uid, productos]);
  return r.rows[0] ?? null;
}

export const esProductoPago = (v: unknown): v is ProductoPago => typeof v === "string" && (PRODUCTOS_PAGO as string[]).includes(v);
