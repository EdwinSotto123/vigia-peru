// consultar_datos: cifras agregadas a pedido sobre la capa de la API (/datos/esquema y /datos/consulta). Claude elige
// una medida, hasta dos dimensiones y filtros de una lista cerrada; la API arma el SQL con fragmentos fijos (sin SQL
// libre), con 5 segundos y 100 filas de tope. El proveedor solo sale si es una empresa (RUC 20); lo demás va sumado.
import { z } from "zod";
import { api } from "../api";
import { definir } from "../registro";

type Fila = Record<string, any>;

const RESERVADAS = new Set(["fuente", "medida", "por", "orden", "limite"]);

export const consultarDatos = definir({
  nombre: "consultar_datos",
  titulo: "Consultar cifras",
  descripcion:
    "Cifras agregadas de la contratación y el presupuesto públicos del Perú: una medida por una o dos dimensiones, con " +
    "filtros. Fuentes: «adjudicaciones» (monto adjudicado, procesos, proveedores, % con único postor, % de contratación " +
    "directa; por año, mes, región, nivel de gobierno, entidad, proveedor, objeto o tipo de proceso), «ordenes» (monto y " +
    "número de órdenes de compra y servicio), «presupuesto» (PIM, devengado y % de ejecución del MEF; por año, región, " +
    "nivel, sector o ejecutora), «senales» (casos de cruces de riesgo por tipo y severidad) y «menores» (compras de hasta " +
    "8 UIT). Sin medida devuelve el catálogo completo de medidas, dimensiones y filtros de la fuente.",
  cuenta: true,
  entrada: {
    fuente: z.enum(["adjudicaciones", "ordenes", "presupuesto", "senales", "menores"]),
    medida: z.string().max(40).optional().describe("Clave de la medida, por ejemplo «monto_adjudicado» o «pct_unico_postor»."),
    por: z.array(z.string().max(30)).max(2).default([]).describe("Hasta dos dimensiones, por ejemplo [\"region\", \"anio\"]."),
    filtros: z.record(z.string(), z.union([z.string(), z.number()])).default({})
      .describe("Filtros de la fuente, por ejemplo {\"anio_desde\": 2023, \"region\": \"Cusco\", \"entidad\": \"20527147612\"}."),
    orden: z.enum(["desc", "asc"]).default("desc"),
    limite: z.number().int().min(1).max(100).default(25),
  },
  async ejecutar(a, cx) {
    if (!a.medida) {
      const esquema = await api<Fila>(cx.env, "/datos/esquema");
      const fuentes = (esquema.fuentes ?? esquema) as Fila;
      const de = Array.isArray(fuentes) ? fuentes.find((f: Fila) => f.clave === a.fuente) : fuentes[a.fuente];
      return { fuente: a.fuente, catalogo: de ?? esquema };
    }
    const filtros = Object.fromEntries(Object.entries(a.filtros).filter(([k]) => !RESERVADAS.has(k)));
    const r = await api<Fila>(cx.env, "/datos/consulta", {
      fuente: a.fuente, medida: a.medida, por: a.por.join(","), orden: a.orden, limite: a.limite, ...filtros,
    });
    return r;
  },
});

export const HERRAMIENTAS_DATOS = [consultarDatos];
