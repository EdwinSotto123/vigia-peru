import { Hono } from "hono";
import { z } from "zod";
import { limiteEscritura } from "../lib/antibots.js";
import { requireAuth } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { SIN_CACHE } from "../lib/http.js";

/**
 * La cuenta gratis de Gobserva Salud (2026-11-21, migración 442): lo que cada quien guarda (un establecimiento, un médico
 * por su colegiatura, un medicamento) y lo nuevo desde que lo guardó. Sólo con una cuenta de Salud (su grupo de Cognito):
 * una de Empleo o Licitaciones no entra. Se monta en /salud/cuenta (app.ts).
 *
 *   GET    /salud/cuenta/guardados                 lo guardado, con su estado de hoy y lo nuevo desde que se guardó.
 *   PUT    /salud/cuenta/guardados {tipo, ref, nombre}
 *   DELETE /salud/cuenta/guardados?tipo=&ref=
 *
 * Lo nuevo: una sanción firme emitida después de guardarlo, un cambio en RENIPRESS detectado después, o una alerta de
 * DIGEMID sobre el registro sanitario del medicamento publicada después.
 */
export const saludCuentaRouter = new Hono();

/** Cuántas cosas puede guardar una cuenta (sin planes: un tope para que no sea un vertedero). */
export const TOPE_GUARDADOS = 300;

saludCuentaRouter.use("*", requireAuth, async (c, next) => {
  c.header("Cache-Control", SIN_CACHE);
  if (c.get("user").app !== "salud") {
    return c.json({ error: "otra_app", detail: "Esta no es una cuenta de Gobserva Salud. Salud tiene su propia cuenta, gratis: créala o entra con ella." }, 403);
  }
  await next();
});

const TIPOS = ["establecimiento", "medico", "medicamento"] as const;

export const Guardado = z.object({
  tipo: z.enum(TIPOS),
  ref: z.string().trim().regex(/^\d{1,10}$/),
  nombre: z.string().trim().max(200).optional().nullable(),
});

/** El código como se guarda: la IPRESS con sus 8 cifras; la colegiatura y el medicamento sin ceros a la izquierda. */
export function refNormal(tipo: (typeof TIPOS)[number], ref: string): string {
  return tipo === "establecimiento" ? ref.padStart(8, "0") : ref.replace(/^0+(?=\d)/, "");
}

saludCuentaRouter.get("/guardados", async (c) => {
  const uid = c.get("user").uid;
  const r = await pool.query(
    `SELECT g.tipo, g.ref, g.nombre, to_char(g.creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "guardadoAl",
            i.nombre AS "ipressNombre", i.estado AS "ipressEstado", i.activo AS "ipressActivo", i.en_registro AS "ipressEnRegistro",
            i.categoria, i.distrito, i.departamento,
            coalesce(x.sanciones, 0)::int AS sanciones,
            (SELECT count(*) FROM salud_sancion s WHERE g.tipo = 'establecimiento' AND s.ipress_codigo = g.ref AND s.en_registro
                AND s.fecha_emision >= (g.creado_at AT TIME ZONE 'America/Lima')::date)::int AS "sancionesNuevas",
            (SELECT count(*) FROM salud_ipress_cambio ca WHERE g.tipo = 'establecimiento' AND ca.codigo = g.ref
                AND ca.detectado > g.creado_at AND ca.campo <> 'telefono')::int AS "cambiosNuevos",
            m.nombre AS "medNombre", m.concentracion, m.forma, m.registro, m.precio_mediana::float AS "precioMediana",
            (SELECT count(*) FROM salud_alerta a WHERE m.registro IS NOT NULL AND m.registro = ANY(a.registros))::int AS alertas,
            (SELECT count(*) FROM salud_alerta a WHERE m.registro IS NOT NULL AND m.registro = ANY(a.registros)
                AND a.fecha >= (g.creado_at AT TIME ZONE 'America/Lima')::date)::int AS "alertasNuevas",
            (SELECT count(*) FROM salud_ipress_detalle d WHERE g.tipo = 'medico' AND d.responsable_colegiatura = g.ref)::int AS "comoResponsable"
       FROM salud_guardado g
       LEFT JOIN salud_ipress i ON g.tipo = 'establecimiento' AND i.codigo = g.ref
       LEFT JOIN salud_indicador x ON x.codigo = i.codigo
       LEFT JOIN salud_medicamento m ON g.tipo = 'medicamento' AND m.codigo::text = g.ref
      WHERE g.uid = $1
      ORDER BY g.creado_at DESC
      LIMIT ${TOPE_GUARDADOS}`,
    [uid],
  );
  return c.json({ guardados: r.rows, tope: TOPE_GUARDADOS });
});

saludCuentaRouter.put("/guardados", limiteEscritura, async (c) => {
  const b = Guardado.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "datos_invalidos", detail: "Falta qué guardar (tipo y código)." }, 400);
  const uid = c.get("user").uid;
  const ref = refNormal(b.data.tipo, b.data.ref);
  const n = await pool.query(`SELECT count(*)::int AS n FROM salud_guardado WHERE uid = $1`, [uid]);
  if (n.rows[0].n >= TOPE_GUARDADOS) {
    return c.json({ error: "limite_guardados", detail: `Ya guardaste ${TOPE_GUARDADOS}. Quita algunos para guardar más.` }, 402);
  }
  await pool.query(
    `INSERT INTO salud_guardado (uid, tipo, ref, nombre) VALUES ($1, $2, $3, $4)
     ON CONFLICT (uid, tipo, ref) DO UPDATE SET nombre = coalesce(EXCLUDED.nombre, salud_guardado.nombre)`,
    [uid, b.data.tipo, ref, b.data.nombre ?? null],
  );
  return c.json({ ok: true, tipo: b.data.tipo, ref });
});

saludCuentaRouter.delete("/guardados", limiteEscritura, async (c) => {
  const b = Guardado.omit({ nombre: true }).safeParse({ tipo: c.req.query("tipo"), ref: c.req.query("ref") });
  if (!b.success) return c.json({ error: "datos_invalidos" }, 400);
  await pool.query(`DELETE FROM salud_guardado WHERE uid = $1 AND tipo = $2 AND ref = $3`, [c.get("user").uid, b.data.tipo, refNormal(b.data.tipo, b.data.ref)]);
  return c.json({ ok: true });
});
