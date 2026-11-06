// Lo que explica el servidor: las instrucciones del initialize, los recursos (cómo se usa, el puntaje, las señales, las
// fuentes y su frescura, el catálogo de cifras, la privacidad) y los prompts: plantillas de investigación que se eligen
// en claude.ai (+ > el conector) para periodistas, investigadores y fiscalizadores.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api";
import type { Contexto } from "./registro";

export const INSTRUCCIONES = [
  "Vigía (Vigía by Gobserva) reúne datos públicos de la contratación del Estado peruano: SEACE/OECE, CONOSCE, Perú Compras,",
  "presupuesto del MEF, SUNAT, RNP, Contraloría, Procuraduría, JNE/ONPE, planillas y visitas, y los dictámenes que sus agentes",
  "escriben sobre cada contrato.",
  "Cada resultado trae códigos que encadenan (OCID de un contrato, RUC de una entidad o empresa, CUI de una inversión, clave de",
  "un partido), su enlace en Vigía, la fuente oficial y la fecha de la consulta. Con solo un nombre, la herramienta buscar da",
  "el código. estado_fuentes dice hasta qué fecha llega cada fuente.",
  "Una señal o un puntaje es un indicio para revisar, no una acusación: la denuncia corresponde a la Contraloría o a la Fiscalía.",
  "Por privacidad no hay DNI, las personas naturales salen con un apellido tapado y un RUC 10 nunca se muestra ni se busca.",
  "Las herramientas red_empresa, historia, consultar_datos, persona_publica, planilla_entidad, visitas_entidad y las de seguimiento piden la cuenta gratis de Gobserva.",
].join(" ");

const COMO_USAR = `# Cómo usar el MCP de Vigía

1. Con un nombre: buscar → da el OCID, RUC, CUI o clave.
2. Un contrato: ficha_contrato (datos, postores, documentos del SEACE) y dictamen (puntaje y señales con evidencia).
3. Una empresa: ficha_empresa (SUNAT, cifras, antecedentes) y red_empresa (socios, empresas vinculadas, clientes).
4. Una entidad: ficha_entidad (resumen), gasto_entidad (en qué gasta), proveedores_de_entidad (concentración), ordenes, obras_entidad,
   informes_control (Contraloría con PDF), planilla_entidad y visitas_entidad.
5. Documentos: documentos_zip arma un ZIP con bases, actas y contratos de hasta 10 procesos.
   Lo raro: hallazgos_entidad (la entidad frente a sus pares) y ranking_entidades (quién destaca en una métrica).
   Contenido de documentos: buscar_documentos (bases, actas, contratos, lecturas de la IA y dictámenes).
6. Cifras agregadas: consultar_datos (sin medida devuelve el catálogo de la fuente).
7. Contexto: historia (línea de tiempo), partido, persona_publica, senales y estado_fuentes.

Cita siempre el enlace de Vigía y la fuente oficial que trae cada respuesta, con la fecha de la consulta.`;

const PUNTAJE = `# Cómo se calcula el puntaje de un dictamen

- El puntaje suma el peso de cada señal del contrato, con tope de 100. No es una probabilidad.
- Pesos de las reglas de cumplimiento normativo: alta 35, media 18, baja 8. Las demás señales: alta 25, media 12, baja 5.
- Dos señales que nacen del mismo hecho no se cuentan dos veces: «único postor con oferta alta» y «oferta igual al valor
  referencial» salen de la misma oferta, y la de menor peso suma la mitad.
- Cada señal trae su evidencia (lo que se leyó y dónde), la norma o el criterio de Vigía que la sustenta y su fuente.
- Un dictamen pasa por revisión antes de publicarse; los que están en revisión no salen en el MCP.`;

const PRIVACIDAD = `# Privacidad

- No hay DNI en ninguna respuesta, ni se busca por DNI.
- Las personas naturales salen con un apellido tapado («CARPIO ••• ABEL»). Las autoridades electas salen con su nombre.
- Un RUC 10 (persona natural) nunca se muestra ni se busca; en las cifras, las personas naturales van sumadas en un grupo.
- El MCP registra qué herramienta se usó, si había cuenta, cuánto tardó y si salió bien. No ve la conversación.`;

export function registrarGuias(server: McpServer, cx: Contexto): void {
  const texto = (uri: string, t: string) => ({ contents: [{ uri, mimeType: "text/markdown", text: t }] });
  const json = (uri: string, d: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(d) }] });

  server.registerResource("como-usar", "vigia://guia/como-usar", { title: "Cómo usar el MCP de Vigía", mimeType: "text/markdown" }, async (u) => texto(u.href, COMO_USAR));
  server.registerResource("puntaje", "vigia://guia/puntaje", { title: "Cómo se calcula el puntaje", mimeType: "text/markdown" }, async (u) => texto(u.href, PUNTAJE));
  server.registerResource("privacidad", "vigia://guia/privacidad", { title: "Privacidad", mimeType: "text/markdown" }, async (u) => texto(u.href, PRIVACIDAD));
  server.registerResource("fuentes", "vigia://guia/fuentes", { title: "Fuentes y hasta qué fecha llegan", mimeType: "application/json" }, async (u) =>
    json(u.href, await api(cx.env, "/estado/datos")),
  );
  server.registerResource("senales", "vigia://guia/senales", { title: "Catálogo de señales y cuántas hay", mimeType: "application/json" }, async (u) => {
    const r = await api<Record<string, any>>(cx.env, "/senales", { limit: 1 });
    return json(u.href, { reglas: r.facetas?.regla ?? [], severidad: r.facetas?.severidad ?? [] });
  });
  server.registerResource("datos", "vigia://guia/datos", { title: "Catálogo de consultar_datos", mimeType: "application/json" }, async (u) =>
    json(u.href, await api(cx.env, "/datos/esquema")),
  );

  const pedir = (t: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }] });
  const CIERRE =
    "Para cada afirmación cita el enlace de Vigía y la fuente oficial, con la fecha de los datos (estado_fuentes). " +
    "Separa hechos de señales, y di qué falta verificar. Una señal no es una acusación.";

  server.registerPrompt(
    "investigar_proveedor",
    { title: "Investigar un proveedor", description: "Perfil de una empresa: quién es, a quién le vende, con quién está vinculada y qué señales tiene.", argsSchema: { empresa: z.string().describe("Nombre o RUC 20") } },
    ({ empresa }) =>
      pedir(
        `Investiga a la empresa «${empresa}» con el MCP de Vigía. Pasos: buscar (si no tienes el RUC), ficha_empresa, red_empresa, ` +
          `buscar_contratos con proveedor_ruc (sus procesos), historia (tipo empresa) y dictamen de los contratos con puntaje. ` +
          `Responde: quién es (SUNAT, antigüedad, actividad), cuánto le vende al Estado y a quién (concentración), con quién comparte ` +
          `socios o representantes y si esas empresas compiten con ella, sus antecedentes y las señales más graves. ${CIERRE}`,
      ),
  );
  server.registerPrompt(
    "revisar_entidad",
    { title: "Revisar una entidad", description: "Cómo compra una entidad pública: presupuesto, proveedores, señales y control.", argsSchema: { entidad: z.string().describe("Nombre o RUC"), desde: z.string().optional().describe("Año desde") } },
    ({ entidad, desde }) =>
      pedir(
        `Revisa la entidad «${entidad}»${desde ? ` desde ${desde}` : ""} con el MCP de Vigía. Pasos: buscar, ficha_entidad, ` +
          `proveedores_de_entidad, ordenes (por vía y año), senales (vista banderas con su RUC), historia (tipo entidad) y ` +
          `consultar_datos (fuente adjudicaciones, filtro entidad, por anio, medidas pct_unico_postor y pct_directas). Responde: ` +
          `cuánto gasta y ejecuta, a quién le compra y qué tan concentrado está, cómo compra (procesos, directas, catálogo, menores), ` +
          `qué señales y patrones hay, y qué dijo la Contraloría. ${CIERRE}`,
      ),
  );
  server.registerPrompt(
    "explicar_contrato",
    { title: "Explicar un contrato", description: "Qué se compró, quién ganó, contra quién y por qué tiene (o no) señales.", argsSchema: { contrato: z.string().describe("OCID o código") } },
    ({ contrato }) =>
      pedir(
        `Explica el contrato «${contrato}» con el MCP de Vigía: ficha_contrato, dictamen, ficha_empresa del ganador y ` +
          `buscar_contratos con su proveedor_ruc y la entidad (si ya le había ganado). Cuenta qué se compró, a qué precio frente al ` +
          `valor referencial y al mercado, cuántos postores hubo y quién ganó, el cronograma, y cada señal con su evidencia y norma. ` +
          `Enlaza los documentos del SEACE que sustentan cada punto. ${CIERRE}`,
      ),
  );
  server.registerPrompt(
    "comparar_entidades",
    { title: "Comparar dos entidades", description: "Dos entidades lado a lado: presupuesto, ejecución, competencia y señales.", argsSchema: { entidad_a: z.string(), entidad_b: z.string() } },
    ({ entidad_a, entidad_b }) =>
      pedir(
        `Compara «${entidad_a}» y «${entidad_b}» con el MCP de Vigía: buscar, ficha_entidad de ambas, proveedores_de_entidad y ` +
          `consultar_datos (adjudicaciones por anio con filtro entidad: monto_adjudicado, pct_unico_postor, pct_directas; ` +
          `presupuesto por anio: pct_ejecucion). Presenta una tabla por año y señala las diferencias que merecen revisión. ${CIERRE}`,
      ),
  );
  server.registerPrompt(
    "seguir_al_partido",
    { title: "Seguir a un partido", description: "Qué contratan las entidades que gobierna un partido y quién gana.", argsSchema: { partido: z.string().describe("Nombre del partido") } },
    ({ partido }) =>
      pedir(
        `Revisa al partido «${partido}» con el MCP de Vigía: partido (texto), sus entidades con más contratos (ficha_entidad y ` +
          `proveedores_de_entidad de las tres primeras), senales de esas entidades e historia (tipo partido). Responde dónde gobierna, ` +
          `cuánto contratan sus gobiernos, qué empresas se repiten entre ellos y qué señales aparecen. ${CIERRE}`,
      ),
  );
  server.registerPrompt(
    "panorama_region",
    { title: "Panorama de una región", description: "La contratación de un departamento en cifras y sus casos más llamativos.", argsSchema: { region: z.string(), anio: z.string().optional() } },
    ({ region, anio }) =>
      pedir(
        `Arma el panorama de la región ${region}${anio ? ` en ${anio}` : ""} con el MCP de Vigía: consultar_datos (adjudicaciones ` +
          `por entidad con filtro region: monto_adjudicado y pct_unico_postor; presupuesto por anio con filtro region: ` +
          `pct_ejecucion), senales (vista dictamenes con la región) y buscar_contratos (riesgo alto en la región). Responde con las ` +
          `cifras principales, las entidades que más contratan, las que concentran señales y los cinco contratos a revisar primero. ${CIERRE}`,
      ),
  );
}
