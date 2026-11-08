// Cómo se define y se registra una herramienta del MCP v2: título y anotaciones (lo que pide el directorio de Claude),
// cupo antes de ejecutar, errores que se entienden y una línea de registro mínima por llamada (herramienta, cuenta sí/no,
// duración y si salió bien; nunca los argumentos de texto libre ni la conversación, que el MCP no ve).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ErrorApi } from "./api";
import { revisarPlan } from "./acceso";
import { pasarCupo } from "./cupos";
import type { EnvV2, Usuario } from "./entorno";
import { ErrorSesion } from "./firebase";
import { ErrorUsuario, fallo, resultado } from "./formato";

export interface Contexto {
  env: EnvV2;
  ctx: ExecutionContext;
  usuario: Usuario | null;
  ip: string | null;
}

export interface Herramienta<S extends z.ZodRawShape = z.ZodRawShape> {
  nombre: string;
  titulo: string;
  descripcion: string;
  entrada: S;
  /**
   * Usa la cuenta de quien pregunta (seguir, lo que sigue). Desde 2026-11-08 TODAS piden cuenta con plan de pago: sin
   * token, el servidor responde 401 antes de llegar acá (autenticación perezosa) y acá se revisa el plan.
   */
  cuenta?: boolean;
  /** De qué producto es (pide el plan de ese producto; Obras va con Licitaciones). Sin producto: cualquier plan. */
  producto?: "empleo" | "licitaciones";
  /** Escribe en la cuenta de quien la usa. «borrar» además es destructiva: Claude siempre pide confirmación. */
  escritura?: "crear" | "borrar";
  ejecutar(args: z.infer<z.ZodObject<S>>, cx: Contexto): Promise<Record<string, unknown> | CallToolResult>;
}

export function definir<S extends z.ZodRawShape>(h: Herramienta<S>): Herramienta {
  return h as unknown as Herramienta;
}

const esResultado = (x: unknown): x is CallToolResult => !!x && typeof x === "object" && Array.isArray((x as CallToolResult).content);

export function registrar(server: McpServer, h: Herramienta, cx: Contexto): void {
  server.registerTool(
    h.nombre,
    {
      title: h.titulo,
      description: h.descripcion,
      inputSchema: h.entrada,
      annotations: {
        title: h.titulo,
        readOnlyHint: !h.escritura,
        destructiveHint: h.escritura === "borrar",
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (async (args: Record<string, unknown>) => {
      const inicio = Date.now();
      let ok = false;
      try {
        const sinPlan = await revisarPlan(cx.env, cx.usuario, h.producto);
        if (sinPlan) return fallo(sinPlan);
        const sinCupo = await pasarCupo(cx.env, cx.ip, cx.usuario, h.nombre);
        if (sinCupo) return fallo(sinCupo);
        const r = await h.ejecutar(args as never, cx);
        ok = true;
        return esResultado(r) ? r : resultado(r);
      } catch (e) {
        if (e instanceof ErrorUsuario) return fallo(e.message);
        if (e instanceof ErrorApi) return fallo(e.message);
        if (e instanceof ErrorSesion) return fallo("La sesión de Gobserva ya no es válida: desconecta y vuelve a conectar tu cuenta en el conector.");
        console.error(JSON.stringify({ mcp: "error", herramienta: h.nombre, error: String((e as Error)?.message ?? e).slice(0, 300) }));
        return fallo(`No se pudo completar la consulta (${h.nombre}). Intenta de nuevo; si sigue fallando, avísanos en gobserva.cloud.`);
      } finally {
        console.log(JSON.stringify({ mcp: "llamada", herramienta: h.nombre, cuenta: !!cx.usuario, ms: Date.now() - inicio, ok }));
      }
    }) as never,
  );
}
