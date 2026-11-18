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
  "Para investigar: empieza por patrones (señales que se repiten en una entidad o un proveedor, y postores de relleno), sigue a las",
  "personas con rastro_persona (por nombre completo: visitas, empresas, declaraciones, aportes, planilla y órdenes) y red_empresa,",
  "ordena los hechos por fecha y busca también la explicación inocente antes de concluir. Nunca digas «sin registros» de una",
  "persona sin haber usado rastro_persona.",
  "Lo que ya encontró la Contraloría: informes_control (los de una entidad, con sus observaciones y funcionarios comprendidos) y",
  "buscar_informes_control (por palabras o por sentido en las observaciones de todo el país, para hallar precedentes); la",
  "responsabilidad que señalan es presunta, no una condena. informe_control_contrato entrega las señales de un contrato como",
  "observaciones con condición, criterio, efecto y causa, listas para un órgano de control.",
  "Por privacidad no hay DNI, las personas naturales salen con un apellido tapado y un RUC 10 nunca se muestra ni se busca.",
  "Todas las herramientas piden conectar una cuenta de Gobserva con un plan de pago vigente: las de plazas CAS, el plan de Empleo; las de licitaciones, obras y mercado, el de Licitaciones; las demás, cualquier plan.",
  "Cada llamada descuenta créditos del mes de ese plan: 1 las búsquedas y fichas, 3 los análisis, 10 consultar_datos y documentos_zip; mi_cupo dice cuántos quedan. Pide solo lo necesario y reutiliza lo que ya trajiste.",
].join(" ");

/** /mcp/empleo: las plazas CAS para quien busca trabajo en el Estado. */
export const INSTRUCCIONES_EMPLEO = [
  "Gobserva Empleo: las plazas CAS que el Estado peruano publica en SERVIR, abiertas hoy (se leen cada día).",
  "buscar_plazas_cas busca por puesto o carrera, región, sueldo mínimo y experiencia; ficha_plaza_cas trae los requisitos,",
  "el sueldo frente a otras entidades, las señales de Vigía y el enlace oficial para postular.",
  "Responde con plazas reales y su enlace; no inventes plazas ni requisitos. Cada llamada descuenta créditos del plan de",
  "Empleo (1 por búsqueda o ficha); mi_cupo dice cuántos quedan. Pide solo lo necesario.",
].join(" ");

/** /mcp/licitaciones (y /mcp/obras): lo que necesita quien le vende al Estado. */
export const INSTRUCCIONES_LICITACIONES = [
  "Gobserva Licitaciones: lo que necesita quien le vende al Estado peruano.",
  "buscar_licitaciones (convocatorias del SEACE), compras_menores (hasta 8 UIT), buscar_proyectos_inversion, ficha_proyecto y",
  "mercado_obras (las obras que se vienen y quién las gana), mercado_rubro (quién compra, quién gana y a qué precio).",
  "Para conocer a un comprador o a un competidor: buscar (da el RUC u OCID), ficha_entidad, proveedores_de_entidad, ordenes,",
  "ficha_empresa, buscar_contratos y ficha_contrato; buscar_documentos busca dentro de bases y actas, y documentos_zip las baja.",
  "Cada resultado trae su fuente oficial y su enlace. Una señal es un indicio, no una acusación. Sin DNI ni RUC 10.",
  "Cada llamada descuenta créditos del plan (1 búsquedas y fichas, 3 análisis, 10 documentos_zip); mi_cupo dice cuántos quedan.",
].join(" ");

const COMO_USAR = `# Cómo usar el MCP de Vigía

1. Con un nombre: buscar → da el OCID, RUC, CUI o clave.
2. Un contrato: ficha_contrato (datos, postores, documentos del SEACE), dictamen (puntaje y señales con evidencia) e
   informe_control_contrato (sus señales como observaciones en formato de informe de control: condición, criterio de la
   ley de esa fecha, efecto, causa, evidencia y precedentes de informes reales de la Contraloría).
   En ficha_contrato, «postores_detalle» dice de cada oferta si fue admitida y calificada y a qué hora se presentó (de los
   reportes del SEACE); «ofertas» es cuántos ofertaron y «participantes_registrados» cuántos sólo se inscribieron. Si todos
   menos el ganador quedaron fuera en la admisión, mira los motivos en el acta (documentos) y las consultas: es la señal
   «Todos los demás postores quedaron fuera», un indicio, no una falta.
3. Una empresa: ficha_empresa (SUNAT, cifras, antecedentes) y red_empresa (socios, empresas vinculadas, clientes).
4. Una entidad: ficha_entidad (resumen), gasto_entidad (en qué gasta), proveedores_de_entidad (concentración), ordenes, obras_entidad,
   informes_control (Contraloría: cada informe con su objetivo, sus observaciones y los funcionarios comprendidos, con
   responsabilidad presunta), planilla_entidad y visitas_entidad.
   Lo que encontró la Contraloría en todo el país: buscar_informes_control (por palabras o por sentido) e
   informes_control SIN ruc (el mapa: perjuicio que cuantifican las observaciones por tema y por año, y las entidades con más).
5. Documentos: documentos_zip arma un ZIP con bases, actas y contratos de hasta 10 procesos.
   Lo raro: hallazgos_entidad (la entidad frente a sus pares) y ranking_entidades (quién destaca en una métrica).
   Contenido de documentos: buscar_documentos (bases, actas, contratos, lecturas de la IA y dictámenes).
6. Cifras agregadas: consultar_datos (sin medida devuelve el catálogo de la fuente).
7. Contexto: historia (línea de tiempo), partido, persona_publica, senales y estado_fuentes.
9. Lo que se repite: patrones (por entidad, por proveedor, postores de relleno, socias de consorcio que compiten,
   renovaciones más caras, un mismo dueño con varias empresas, socios de una empresa inhabilitada, grupos de proveedores
   por dueño y familia en las órdenes de una entidad y la misma compra repetida en semanas). Es por donde empieza una
   investigación.
10. Antes de investigar a fondo, lee la guía «Método para investigar con Vigía» (vigia://guia/metodo).
8. Una persona por su nombre: rastro_persona SIEMPRE primero (visitas a entidades, empresas, declaraciones juradas, aportes, planilla, órdenes y candidaturas en una sola llamada). No concluyas «sin registros» sin haberla usado.

Cita siempre el enlace de Vigía y la fuente oficial que trae cada respuesta, con la fecha de la consulta.`;

const METODO = `# Método para investigar con Vigía

Trabaja como un perito, no como un buscador: cada afirmación con su registro, cada sospecha con su descarte.

## 1. Empieza por lo que se repite
- patrones (alcance entidad): dónde una señal aparece mucho más que en el resto del país.
- patrones (alcance proveedor): empresas con la misma señal en varias entidades.
- patrones (alcance relleno): postores que casi nunca ganan y siempre acompañan al mismo ganador.
- patrones (alcance consorcio): empresas que fueron socias en un consorcio y luego «compiten» entre sí.
- patrones (alcance renovacion): servicios que la entidad volvió a contratar pagando mucho más por mes.
- patrones (alcance dueno): un mismo socio que gana en una entidad con dos o más empresas procesos de objeto parecido.
- patrones (alcance inhabilitada): empresas que ganan mientras otra empresa del mismo socio está inhabilitada.
- patrones (alcance grupo): empresas y personas (venden con su RUC) de un mismo dueño o de una familia probable que le
  venden a la misma entidad por órdenes; cada una sola parece pequeña. Trae cuánto dependen de esa entidad, las órdenes
  de números correlativos, el objeto repartido entre integrantes y si alguno es pariente declarado de un funcionario.
- patrones (alcance repetida): la misma compra (proveedor, monto y objeto) en varias órdenes directas de 7 a 90 días.
- patrones (alcance recien_creada): empresas que se inscriben en la SUNAT y a los pocos días ya reciben órdenes directas
  de una entidad; mira quién las creó (red_empresa) y si viven de ese solo cliente.
- patrones (alcance doble): personas en la planilla de una entidad con órdenes de servicio de otra los mismos meses.
- patrones (alcance compras_familia, en observación): quien trabaja en compras o logística de una entidad y tiene un
  familiar declarado que recibe órdenes de esa misma entidad. Mira cuántas órdenes se emitieron con la persona en el
  puesto y si el familiar no tenía ninguna antes de que asumiera.
- patrones (alcance autoridad_exsocio, en observación): la autoridad electa que dejó de figurar en una empresa del RNP y
  lo que esa empresa le vendió a su entidad en su periodo. El impedimento sigue 12 meses después de salir si tenía más
  del 30 %: pide la partida registral. red_empresa trae también a quienes ya no figuran, con el corte en que salieron.
- buscar_contratos con varias señales y todas_las_senales: los contratos que juntan dos indicios (único postor y socio de
  una inhabilitada, por ejemplo).
- hallazgos_entidad y ranking_entidades: la entidad frente a sus pares.
Un contrato raro puede ser un error; diez iguales son un modo de trabajar.

## 2. Sigue a las personas, no sólo a las empresas
- rastro_persona con el nombre completo: visitas, empresas, declaraciones juradas, aportes, planilla y órdenes de una vez.
  Si tiene cargo público (declaró intereses o está o estuvo en una planilla), trae el enlace a su ficha de rastro en la web.
  También dice si figura en informes de control (responsabilidad presunta) y si la entidad del informe le dio órdenes
  después, y si una empresa suya está inhabilitada mientras otra suya gana.
  Con cargo público trae además su FAMILIA DECLARADA (lo que obtuvo del Estado cada familiar que puso en su declaración
  jurada: órdenes a su nombre y empresas en que es socio, y cuánto salió de la entidad de la persona) y si cobra del
  Estado por DOS LADOS (planilla de una entidad y órdenes de servicio de otra los mismos meses). Su ficha en la web reúne
  cargo, planilla, órdenes y familia en una sola página: da ese enlace.
- red_empresa: socios y representantes, y las otras empresas donde están. Pregunta si esas empresas compiten entre sí.
- visitas_entidad: quién entró a la entidad antes de la convocatoria y a qué oficina.
- persona_publica y partido: quién gobierna la entidad y desde cuándo.

## 2b. Lo menudo pasa por las órdenes
Las órdenes de compra y de servicio se emiten a empresas (RUC 20) y a personas naturales (RUC 10): desde 2022, más del
doble de órdenes a personas que a empresas. Un proceso de selección deja postores y actas; una orden directa de hasta 8
UIT, casi nada. Por eso:
- ordenes con entidad_ruc: cada orden trae sus «banderas». Con bandera=pariente_socio salen las órdenes a empresas donde
  un socio o representante es pariente declarado (DJI) de un funcionario de la entidad; con bandera=nepotismo, las
  órdenes a la persona que es ese pariente; con bandera=repetida o fraccionamiento, las compras partidas.
- Los proveedores no presentan declaración jurada; los funcionarios sí, y en ella declaran a sus parientes (cónyuge,
  hijos, padres, hermanos, cuñados, suegros, primos). El parentesco que no está declarado sólo es probable (apellidos):
  dilo así y pide confirmarlo con RENIEC o partidas.
- Suma al grupo, no a la empresa: cuatro empresas y una persona con S/ 40 mil cada una son un proveedor de S/ 200 mil.
- Una orden al borde del tope no es nada; veinte del mismo grupo en un mes, con números seguidos, es un modo de comprar.

## 3. Arma la línea de tiempo
Ordena por fecha: alta de la empresa en la SUNAT, visitas, convocatoria, consultas, buena pro, contrato, adicionales, pagos.
Lo que importa es el ORDEN: una visita al área usuaria antes de la convocatoria pesa; una después de la firma, casi nada.
historia y ficha_contrato dan las fechas.

## 4. Las preguntas que separan un indicio de una coincidencia
- ¿Hubo competencia de verdad? Cuántos postularon, cuántos ofertaron, cuántos quedaron válidos y por qué cayeron los demás.
- ¿El requisito que dejó fuera a los demás lo cumple sólo uno? ¿Lo pidió alguien en las consultas y no se acogió?
- ¿El precio se parece al de otras entidades por el mismo bien y la misma unidad? Un sobreprecio sin unidad comprobada no se afirma.
  precios_referencia da lo que pagó el Estado por un producto (catálogo de Perú Compras, procesos, compras menores) y el costo mensual de un servicio;
  precios_de_mercado, lo que averiguó el laboratorio de precios para cada renglón de un contrato (tiendas con enlace y referencias del Estado).
- ¿Qué norma se habría incumplido, y regía en la fecha del proceso? norma_aplicable da el artículo exacto (con el texto de
  esa fecha) y los criterios del OECE; una opinión emitida bajo la otra ley sólo vale por analogía.
- ¿La Contraloría ya observó ESTE proceso? Si la ficha del contrato trae la señal «observado_por_contraloria», una
  observación de un informe de control lo nombra: cita el número del informe y léela antes de seguir (el informe es de
  funcionarios, no sanciona al proveedor). patrones con alcance «observado» dice a qué proveedores les siguió adjudicando
  la misma entidad después del informe, y cada uno de esos contratos nuevos lleva la señal «gano_tras_observacion».
- ¿La Contraloría ya observó algo parecido? buscar_informes_control trae observaciones reales (con número de informe,
  entidad y fecha): sirven de precedente, no de prueba de este caso. informes_control da las de la misma entidad.
- ¿La relación entre personas está en un registro (RNP, declaración jurada, planilla) o es sólo un apellido igual?
- ¿El documento publicado es de este proceso? Fecha, proveedor y monto tienen que cuadrar con el registro.
- ¿El patrón sobrevive si quitas el caso más llamativo?

## 5. Busca lo que desmiente tu hipótesis
Antes de concluir, busca la explicación inocente: mercado de pocos proveedores, bien de marca única por compatibilidad,
proveedor local en zona alejada, proceso declarado desierto antes, emergencia real. Si la encuentras, dilo.

## 6. Cómo escribir el resultado
- Hechos (con fuente y fecha) separados de señales (indicios) y de lo que falta verificar.
- Montos en soles, fechas completas, el nombre de la entidad y de la empresa, y el enlace de Vigía de cada contrato.
- Personas naturales con un apellido tapado, como las entrega Vigía. Nunca un documento.
- Para entregarlo a un órgano de control: informe_control_contrato arma las observaciones en su formato (condición,
  criterio, efecto, causa, evidencia). Es un informe de indicios de Vigía, no un informe de la Contraloría.
- Nada de «corrupto», «fraude» o «culpable»: eso lo dice un juez. Di qué se observa y a quién le toca investigarlo
  (Contraloría para el control, Fiscalía para el delito, OECE para el procedimiento).
- Si no hay datos, dilo así: «Vigía no tiene…». No rellenes con suposiciones ni concluyas «sin registros» sin haber
  usado rastro_persona (personas) o buscar (empresas y entidades).`;

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
  server.registerResource("metodo", "vigia://guia/metodo", { title: "Método para investigar con Vigía", mimeType: "text/markdown" }, async (u) => texto(u.href, METODO));
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
    "investigar_patron",
    { title: "Investigar un patrón", description: "Parte de lo que se repite en una entidad o un proveedor y llega a los contratos y las personas.", argsSchema: { quien: z.string().describe("Nombre o RUC de la entidad o empresa (opcional)").optional() } },
    ({ quien }) =>
      pedir(
        `Investiga ${quien ? `a «${quien}»` : "los patrones más fuertes del país"} con el MCP de Vigía, siguiendo la guía vigia://guia/metodo. ` +
          `Pasos: ${quien ? "buscar (para su RUC), " : ""}patrones con alcance entidad, proveedor y relleno; abre con dictamen y ficha_contrato ` +
          `tres contratos de ejemplo de cada patrón; red_empresa de los ganadores que se repiten y rastro_persona de sus representantes; ` +
          `visitas_entidad de la entidad. Arma la línea de tiempo y, para cada patrón, di qué lo explicaría sin irregularidad y si esa ` +
          `explicación se sostiene. ${CIERRE}`,
      ),
  );
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
          `proveedores_de_entidad, ordenes (por vía y año), senales (vista banderas con su RUC), historia (tipo entidad; cada patrón ` +
          `de órdenes trae su siguiente_paso: ordenes_en_periodo con esas fechas, para ver qué se ordenó y a cuántas personas nuevas) y ` +
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
