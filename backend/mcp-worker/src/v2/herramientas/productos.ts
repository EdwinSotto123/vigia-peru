// Las 7 herramientas de los productos de Gobserva (Empleo, Licitaciones, Obras), las mismas del MCP de antes
// (src/gobserva.ts y src/obras.ts, con su SQL de solo lectura por Hyperdrive). Acá solo se les pone título, anotaciones
// y el esquema en zod; la validación y la ejecución son las de siempre.
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DEFINICIONES_GOBSERVA, ejecutarGobserva } from "../../gobserva";
import { DEFINICIONES_OBRAS, ejecutarObras } from "../../obras";
import { ErrorValidacion, textoError, validarArgumentos, type Campo } from "../../python";
import { ErrorUsuario } from "../formato";
import { definir, type Herramienta } from "../registro";

const TITULOS: Record<string, string> = {
  buscar_plazas_cas: "Buscar plazas CAS",
  ficha_plaza_cas: "Ficha de una plaza CAS",
  buscar_licitaciones: "Buscar licitaciones abiertas",
  mercado_rubro: "Mercado de un rubro",
  buscar_proyectos_inversion: "Buscar proyectos de inversión",
  ficha_proyecto: "Ficha de un proyecto de inversión",
  mercado_obras: "Mercado de obras",
};

type Propiedad = { type?: string; default?: unknown; title?: string };

function esquemaZod(tool: Tool): z.ZodRawShape {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, Propiedad>;
  const requeridos = new Set((tool.inputSchema.required ?? []) as string[]);
  const forma: Record<string, z.ZodType> = {};
  for (const [nombre, p] of Object.entries(props)) {
    const numero = p.type === "integer" ? z.number().int() : z.number();
    const base: z.ZodType = p.type === "integer" || p.type === "number" ? numero : z.string();
    if (requeridos.has(nombre)) forma[nombre] = base;
    else if (p.default === undefined) forma[nombre] = base.optional();
    else forma[nombre] = typeof p.default === "number" ? numero.default(p.default) : z.string().default(String(p.default));
  }
  return forma as z.ZodRawShape;
}

function envolver(nombre: string, def: { tool: Tool; campos: Campo[] }, ejecutar: typeof ejecutarGobserva): Herramienta {
  return definir({
    nombre,
    titulo: TITULOS[nombre] ?? nombre,
    descripcion: def.tool.description ?? "",
    entrada: esquemaZod(def.tool),
    async ejecutar(args, cx) {
      let valores;
      try {
        valores = validarArgumentos(`${nombre}Arguments`, def.campos, args as Record<string, unknown>);
      } catch (e) {
        throw new ErrorUsuario(e instanceof ErrorValidacion ? e.message : textoError(e));
      }
      const salida = await ejecutar(nombre, valores, cx.env, cx.ctx);
      return (salida && typeof salida === "object" && !Array.isArray(salida) ? salida : { resultado: salida }) as Record<string, unknown>;
    },
  });
}

export const HERRAMIENTAS_PRODUCTOS: Herramienta[] = [
  ...Object.entries(DEFINICIONES_GOBSERVA).map(([n, d]) => envolver(n, d, ejecutarGobserva)),
  ...Object.entries(DEFINICIONES_OBRAS).map(([n, d]) => envolver(n, d, ejecutarObras)),
];
