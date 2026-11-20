/**
 * Catálogo de los cruces del ganador con otros registros públicos (cruces_proveedor / casos_cruce): grupos, nombre corto
 * y qué significa cada uno. Lo usan la columna de cruces de /app/contratos y su panel de tipos (TiposCruce).
 */
export type Severidad = "alta" | "media" | "baja";

/** Grupos de cruces, en el orden en que se muestran; cada tipo con una explicación corta de qué se cruzó. */
/**
 * `chip`: el nombre para un chip en una celda angosta (la lista de contratos, el mapa de poder). Uno por tipo y sólo
 * aquí, para que el mismo cruce no tenga tres nombres; el `corto` completo y el `explica` van en el title o en la ⓘ.
 */
export const GRUPOS_CRUCE: { titulo: string; tipos: { tipo: string; corto: string; explica: string; chip?: string }[] }[] = [
  {
    titulo: "Política",
    tipos: [
      { tipo: "partido_gobernante", chip: "Financió al partido", corto: "Financió al que gobierna", explica: "El ganador o un socio aportó al partido que gobierna la entidad (ONPE × JNE)." },
      { tipo: "vendio_gobernante", chip: "Vendió a su campaña", corto: "Vendió al que gobierna", explica: "El ganador o un socio le vendió a la campaña del partido que gobierna la entidad (ONPE × JNE)." },
      { tipo: "aporte", chip: "Aportó a un partido", corto: "Aportó a algún partido", explica: "El proveedor, o un socio o representante suyo, aportó a cualquier organización política, no necesariamente la que gobierna la entidad; la que gobierna es «Financió al que gobierna» (ONPE)." },
      { tipo: "aporte_empresa", corto: "La empresa aportó", explica: "La empresa ganadora aportó con su RUC a una organización política (ONPE)." },
      { tipo: "proveedor_campana", corto: "Vendió a una campaña", explica: "La empresa le facturó a una campaña electoral (gastos de campaña, ONPE Claridad)." },
      { tipo: "candidato", corto: "Fue candidato", explica: "El proveedor o un socio postuló en una elección (ONPE)." },
      { tipo: "autoridad", corto: "Autoridad electa", explica: "El proveedor o un socio es autoridad electa (JNE)." },
    ],
  },
  {
    titulo: "En el proceso",
    tipos: [
      // Migración 313: una observación de un informe de control nombra este proceso (o la obra del contrato, por su CUI).
      { tipo: "observado_por_contraloria", chip: "Observado por la Contraloría", corto: "La Contraloría observó este proceso", explica: "Una observación de un informe de control de la Contraloría nombra este procedimiento de selección (se empata por la entidad, el tipo, el número, el año y la sigla) o la obra de este contrato (por su código único de inversión). El informe es posterior al proceso: dice lo que los auditores encontraron en él. La responsabilidad que identifica es PRESUNTA y recae en funcionarios y servidores; no sanciona al proveedor. Es grave si el informe señala responsabilidad penal y la observación es de la selección, la ejecución o los pagos; media si es penal o civil, o si cuantifica un perjuicio; leve si es sólo administrativa." },
      { tipo: "socio_comun", chip: "Socio común", corto: "Socio común entre postores", explica: "Dos postores del mismo proceso comparten socio o representante (RNP): competencia aparente." },
      { tipo: "unico_postor", corto: "Único postor", explica: "El proceso tuvo un solo postor (OCDS): no hubo competencia real. Pesa más si además se adjudicó pegado al valor referencial o es millonario: posible direccionamiento." },
      { tipo: "socio_en_entidad", chip: "Socio en la entidad", corto: "Socio del proveedor trabaja en la entidad", explica: "Un socio o representante del ganador es, además, una persona contratada por la MISMA entidad que le dio el contrato (RNP × registro de contratados): posible conflicto de interés, por revisar. Pesa más si tenía órdenes de la entidad cuando se dio la buena pro; si sus órdenes quedan a más de dos años, pesa poco." },
      { tipo: "interes_declarado", chip: "Interés de un funcionario", corto: "Un funcionario declaró un interés en el ganador", explica: "Un funcionario de la entidad declaró en su Declaración Jurada de Intereses (Contraloría) tener acciones, un poder o un asiento en el directorio de la empresa que ganó: posible conflicto de interés, por revisar." },
      { tipo: "pariente_funcionario", chip: "Familiar de un funcionario", corto: "Un familiar de un funcionario es socio del ganador", explica: "Un pariente que un funcionario de la misma entidad declaró en su DJI (Contraloría) figura en el RNP como socio, representante o directivo de la empresa que ganó. Grave si el parentesco es cercano. No se dice quiénes son." },
      { tipo: "postor_de_relleno", chip: "Postor de relleno", corto: "Lo acompaña un postor que casi nunca gana", explica: "Una empresa que gana 1 de cada 10 procesos o menos dedica la mayoría de sus postulaciones a presentarse junto a este ganador, en procesos de 2 a 4 postores (CONOSCE): puede ser una oferta de cobertura, que sólo aparenta competencia. Es grave si además comparten socio o representante." },
      { tipo: "consorcio_rival", chip: "Rival que fue su socia", corto: "Compitió contra una empresa que fue su socia en un consorcio", explica: "El ganador y otro postor del proceso postularon JUNTOS en un consorcio en otra ocasión, y por separado se enfrentan en 3 o más procesos de 2 a 4 postores que gana uno de los dos (CONOSCE): quien fue tu socio conoce tus precios, y que compita contigo una y otra vez puede ser un reparto. Es grave cuando los dos fueron los únicos postores." },
      { tipo: "puerta_giratoria", chip: "Puerta giratoria", corto: "Un socio del ganador trabajó antes en la entidad", explica: "Una persona que salió de la planilla de la entidad figura en el RNP como socia o representante de la empresa que le ganó DESPUÉS de su salida. El empate es por nombre completo (un solo documento en el RNP y una sola entidad en planilla), así que hay que confirmarlo. Es grave si la buena pro llegó en el primer año." },
      { tipo: "mismo_dueno", chip: "Mismo dueño, otra empresa", corto: "El mismo dueño ganó aquí algo parecido con otra empresa", explica: "Un socio del ganador es también socio de otra empresa que ganó, en esta misma entidad, un proceso de objeto parecido. Es grave cuando los dos procesos están a 90 días o menos; hasta 12 meses es para mirar. Repartir las ventas entre dos razones sociales deja a cada una bajo los topes y fuera de las señales de concentración. Sólo cuenta a socios (no a directores ni representantes) de 2 a 6 empresas, según el Registro Nacional de Proveedores. Un grupo familiar puede tener dos empresas legítimas: hay que ver si los procesos debieron ser uno solo." },
      { tipo: "socio_de_inhabilitada", chip: "Socio de inhabilitada", corto: "Su socio tiene otra empresa inhabilitada para contratar", explica: "Un socio del ganador es también socio de otra empresa que estaba inhabilitada para contratar con el Estado el día de la buena pro. La ley impide contratar a la empresa del mismo rubro cuyos socios con más de 30 % del capital, representantes o directivos formaron parte de una inhabilitada cuando cometió la infracción, mientras dure la sanción (artículo 30 de la Ley 32069, impedimento 3.E; antes, artículo 11 de la Ley 30225). Es grave si la sanción es definitiva o si la empresa ganadora se fundó, o el socio entró a ella, desde seis meses antes de la sanción. El registro no dice el porcentaje del socio ni si las dos empresas son del mismo rubro: eso hay que confirmarlo." },
      { tipo: "contrato_sobre_adjudicado", chip: "Firmado por más", corto: "El contrato se firmó por más de lo adjudicado", explica: "El contrato se celebra por el monto de la oferta que ganó. Aquí el monto leído en el contrato supera en 25 % o más lo adjudicado según los dos registros oficiales de la buena pro (CONOSCE y el registro abierto del proceso), con un solo ganador. Es grave desde 50 % más. El monto del contrato sale de una lectura automática: hay que abrir el documento y ver si incluye prestaciones que la buena pro registró aparte." },
      { tipo: "retencion_sobre_tope", chip: "Garantía por retención", corto: "Garantía por retención de pagos sobre el tope, sin parecer pequeña empresa", explica: "La garantía de fiel cumplimiento protege al Estado si el contratista incumple. La retención de pagos (descontarle al contratista de sus primeros pagos, sin un banco que responda) sólo vale hasta S/ 480 000 en bienes y servicios y S/ 5 000 000 en obras, salvo que el contratista sea micro o pequeña empresa (artículo 114 del Reglamento de la Ley 32069). Aquí el contrato supera ese tope y al contratista el Estado le adjudicó, en cada uno de los dos años anteriores, más de lo que vende una pequeña empresa (1 700 UIT). Lo adjudicado no es lo vendido: hay que pedir su constancia de MYPE." },
      { tipo: "renovacion_mas_cara", chip: "Renovación más cara", corto: "El servicio cuesta más al mes que en su contrato anterior", explica: "La entidad volvió a contratar el mismo servicio y el costo por mes (monto entre plazo) subió 30 % o más frente al contrato anterior. Sólo cuenta en servicios continuos de cinco meses o más, con objeto casi igual, cuando el contrato anterior ya había corrido la mayor parte de su plazo. Puede explicarse por más sedes, más personal o más alcance: hay que comparar los términos de referencia. Es grave con 60 % o más y objeto casi idéntico." },
      { tipo: "turno_postores", chip: "Posible reparto entre vinculadas", corto: "Compite con una empresa vinculada y se turnan", explica: "Dos empresas que comparten un socio, representante o directivo (RNP) o el domicilio fiscal compiten juntas en varios procesos con pocos postores y se reparten las buenas pro (CONOSCE): competencia aparente sostenida." },
      { tipo: "empleo_declarado", chip: "Trabajó ahí un funcionario", corto: "Un funcionario trabajó para el ganador", explica: "Un funcionario de la entidad declaró en su Declaración Jurada de Intereses haber trabajado o asesorado a la empresa que ganó: puerta giratoria." },
      { tipo: "domicilio_compartido", chip: "Mismo domicilio", corto: "Mismo domicilio que otro participante", explica: "El ganador comparte su domicilio fiscal en la SUNAT con otra empresa que participó en el mismo proceso: posible competencia aparente o empresas vinculadas. Pesa más si la otra también presentó oferta. No cuentan las direcciones con más de 5 empresas (centros de oficinas)." },
      { tipo: "visita_previa", chip: "Visita previa", corto: "Visita antes de la buena pro", explica: "Un socio o representante visitó una entidad pública en los 180 días previos a la buena pro (registro de visitas)." },
      { tipo: "visita_repetida", chip: "Visitas repetidas", corto: "Visitó al mismo funcionario una y otra vez", explica: "Un socio o representante del ganador visitó al mismo funcionario de la entidad en 3 o más días distintos en los 180 días antes de la buena pro (registro de visitas). Grave si ese funcionario decide la compra. Del funcionario sólo se muestra el cargo." },
      { tipo: "visita_fuera_horario", chip: "Visita fuera de horario", corto: "Visitó la entidad fuera del horario de atención", explica: "Un socio o representante del ganador visitó la entidad un fin de semana, antes de las 7 o desde las 19, en los 180 días antes de la buena pro (registro de visitas). La duración no cuenta: muchas salidas se anotan al cierre." },
      { tipo: "visita_antes_convocatoria", chip: "Visita antes de convocar", corto: "Visitó la entidad la semana antes de la convocatoria", explica: "Un socio o representante del ganador visitó la entidad en los 7 días antes de que se convocara el proceso que después ganó, cuando se cierran las bases (registro de visitas). Grave si visitó a quien decide la compra." },
      { tipo: "otro_postor", chip: "Buena pro de otro", corto: "Buena pro de otro postor", explica: "La buena pro fue primero de otro postor y se le adjudicó después a este, con su propia oferta (OCDS × CONOSCE): suele costar más." },
      { tipo: "sancion_vigente", corto: "Inhabilitado al ganar", explica: "Ganó la buena pro mientras tenía una inhabilitación vigente del Tribunal de Contrataciones: no podía contratar con el Estado." },
      { tipo: "empresa_espejo", chip: "Posible empresa espejo", corto: "Ganó mientras su empresa hermana estaba inhabilitada", explica: "Ganó la buena pro mientras otra empresa con la que comparte un socio, representante o directivo (RNP) estaba inhabilitada por el Tribunal de Contrataciones: puede ser la forma de seguir contratando con otra razón social. Pesa más si se fundó cerca de la sanción. No cuentan las personas que figuran en más de 10 empresas (apoderados de muchas)." },
      // Sobreprecio en bandas por cuánto pasa la mediana (migración 121).
      { tipo: "sobreprecio_extremo", chip: "Precio 3× o más", corto: "Precio 3 veces o más la mediana", explica: "El precio por unidad de un bien pasa 3 veces o más la mediana de lo que pagaron otras entidades por el mismo CUBSO y unidad (OCDS × CONOSCE): un sobreprecio extremo." },
      { tipo: "sobreprecio_alto", chip: "Precio 2 a 3×", corto: "Precio 2 a 3 veces la mediana", explica: "El precio por unidad pasa de 2 a 3 veces la mediana de otras entidades por el mismo CUBSO y unidad." },
      { tipo: "sobreprecio", chip: "Precio 1.5 a 2×", corto: "Precio 1.5 a 2 veces la mediana", explica: "El precio por unidad pasa de 1.5 a 2 veces la mediana de otras entidades. Puede tener explicación (poca cantidad, transporte, otra calidad)." },
    ],
  },
  {
    titulo: "Historial del proveedor",
    tipos: [
      // Sanción en bandas por el tipo de sanción del Tribunal (migración 121).
      { tipo: "sancion_definitiva", chip: "Inhabilitación definitiva", corto: "Inhabilitación definitiva antes", explica: "Tuvo una inhabilitación DEFINITIVA del Tribunal de Contrataciones antes de este proceso: la sanción más grave." },
      { tipo: "sancion_temporal", chip: "Inhabilitación temporal", corto: "Inhabilitación temporal antes", explica: "Tuvo una inhabilitación temporal del Tribunal antes de este proceso. Si además seguía vigente al ganar, también dice «Inhabilitado al ganar»." },
      { tipo: "sancion_multa", chip: "Multa del Tribunal", corto: "Multa del Tribunal antes", explica: "El Tribunal le puso una multa antes de este proceso (sin inhabilitación)." },
      // Migración 315: la entidad le adjudica después de un informe de control que observó otro proceso que él ganó ahí.
      { tipo: "gano_tras_observacion", chip: "Ganó tras una observación", corto: "La Contraloría ya había observado otro proceso suyo en esta entidad", explica: "Antes de esta buena pro, la Contraloría emitió un informe de control con una observación que nombra OTRO proceso que este mismo proveedor había ganado en esta misma entidad (ver «Observado por la Contraloría»). La entidad le volvió a adjudicar después. La responsabilidad que identifica un informe es PRESUNTA y recae en funcionarios y servidores: no sanciona al proveedor ni le impide contratar. Vale ver si la entidad corrigió lo observado. Es grave si el informe señala responsabilidad penal, la observación era de la selección, la ejecución o los pagos, y esta buena pro es de los dos años siguientes." },
      // Migración 303: la persona, por su DNI, en la lista de funcionarios comprendidos de un informe de control (302).
      { tipo: "socio_con_informe_control", chip: "Socio en informe de control", corto: "Un socio o representante figura con presunta responsabilidad en un informe de control", explica: "Una persona que figura en el Registro Nacional de Proveedores como socia o representante legal del ganador (se cruza por su DNI) está comprendida en un informe de control de la Contraloría emitido ANTES de la buena pro, con responsabilidad penal, civil o administrativa. Es responsabilidad PRESUNTA: la Contraloría la identifica y la deriva al Ministerio Público, a la procuraduría o a un procedimiento sancionador; no es una condena ni un impedimento para contratar. Es grave si la responsabilidad es penal y el informe es de la misma entidad que contrató o de los dos años anteriores a la buena pro; una penal más antigua o una civil es media, y sólo administrativa es leve." },
      { tipo: "penalidad", corto: "Penalidades", explica: "Le aplicaron penalidades en contratos anteriores." },
      // Adicionales en bandas por cuánto pasan el tope legal (25% bienes y servicios) (migración 121).
      { tipo: "adicional_sobre_tope", chip: "Adicionales sobre tope", corto: "Adicionales sobre el tope legal", explica: "El contrato sumó adicionales por más del 25% de lo contratado, el tope legal en bienes y servicios sin autorización de la Contraloría (CONOSCE)." },
      { tipo: "adicional_alto", chip: "Adicionales altos", corto: "Adicionales cerca del tope", explica: "El contrato sumó adicionales por entre 15% y 25% de lo contratado: cerca del tope legal." },
      { tipo: "adicional", chip: "Adicionales", corto: "Adicionales o prórrogas", explica: "El contrato tuvo adicionales (menos del 15%) o prórrogas (CONOSCE)." },
    ],
  },
  {
    titulo: "Patrón de compras",
    tipos: [
      { tipo: "fraccionamiento", chip: "Pasan 8 UIT", corto: "Órdenes que pasan 8 UIT", explica: "Recibió de la misma entidad, el mismo día, varias órdenes menores que juntas pasan el tope de 8 UIT (CONOSCE)." },
      // Proveedor recurrente en bandas por cuánto del gasto de la entidad concentra (migración 121).
      { tipo: "recurrente_dominante", chip: "Concentra el gasto", corto: "Concentra el gasto de la entidad", explica: "Se llevó la mitad o más de todo lo que esa entidad adjudicó desde 2018 (CONOSCE): un proveedor que domina sus compras." },
      { tipo: "recurrente_frecuente", chip: "Muchos procesos", corto: "Le ganó muchos procesos a la entidad", explica: "Le ganó 10 o más procesos a la misma entidad, o se llevó una parte importante (≥25%) de su gasto (CONOSCE)." },
      { tipo: "recurrente", chip: "Frecuente", corto: "Proveedor frecuente", explica: "Le ganó entre 3 y 9 procesos a la misma entidad (CONOSCE)." },
      { tipo: "proveedor_cautivo", chip: "Casi sólo esta entidad", corto: "Casi solo le vende a esta entidad", explica: "La empresa recibe la gran mayoría (≥75%) de todo lo que le compra el Estado de UNA sola entidad: dependencia fuerte. Distinto de «Concentra el gasto»: aquí es el proveedor el que depende de la entidad." },
    ],
  },
  {
    // Señales de la empresa desde la ficha RUC de la SUNAT (migración 116). Son hechos de la EMPRESA, no de un contrato.
    titulo: "Registro SUNAT",
    tipos: [
      { tipo: "recien_fundada_medio_ano", chip: "6 meses de fundada", corto: "Ganó con 6 meses o menos de fundada", explica: "Ganó este proceso del Estado a los 6 meses o menos de darse de alta en la SUNAT: muy nueva para ese contrato. No prueba nada por sí solo." },
      { tipo: "recien_fundada_un_ano", chip: "Menos de 1 año", corto: "Ganó con menos de 1 año de fundada", explica: "Ganó este proceso con entre 6 meses y 1 año desde su alta en la SUNAT. Pesa más si el contrato es millonario." },
      { tipo: "recien_fundada_dos_anos", chip: "Menos de 2 años", corto: "Ganó con menos de 2 años de fundada", explica: "Ganó este proceso con entre 1 y 2 años desde su alta en la SUNAT: una empresa todavía joven." },
      { tipo: "dada_de_baja", chip: "De baja (SUNAT)", corto: "Dada de baja en la SUNAT", explica: "Hoy figura dada de baja en la SUNAT. Es su estado actual; la SUNAT no publica desde cuándo, así que no se afirma que vendiera estando de baja." },
      { tipo: "suspendida", chip: "Suspendida (SUNAT)", corto: "Suspendida en la SUNAT", explica: "Hoy figura en suspensión temporal de actividades en la SUNAT." },
      { tipo: "no_habida", corto: "No habida", explica: "Hoy figura como «no habido» en la SUNAT: la autoridad no la ubica en su domicilio fiscal." },
    ],
  },
  {
    // La obra del contrato en INFOBRAS (Contraloría) y su inversión en Invierte.pe (MEF), migración 160. Son hechos de la
    // ejecución de ESTE contrato (la obra que construye o supervisa), no antecedentes de la empresa.
    titulo: "En la obra",
    tipos: [
      { tipo: "obra_paralizada_larga", chip: "Paralizada 6+ meses", corto: "Obra paralizada hace 6 meses o más", explica: "La obra de este contrato está paralizada hace 180 días o más según INFOBRAS, que la entidad registra. La causa puede ser de la entidad (falta de pago o de presupuesto) o del contratista." },
      { tipo: "obra_paralizada", chip: "Obra paralizada", corto: "Obra paralizada", explica: "La obra de este contrato está paralizada hoy, hace menos de 180 días, según INFOBRAS." },
      { tipo: "obra_paralizacion", chip: "Estuvo paralizada", corto: "La obra estuvo paralizada", explica: "La obra se paralizó en algún momento y después siguió o terminó (INFOBRAS dice cuántos días y por qué)." },
      { tipo: "obra_atraso_grave", chip: "Atraso de 40+ puntos", corto: "Obra atrasada 40 puntos o más", explica: "En ejecución, la obra lleva 40 puntos porcentuales o más de avance físico por debajo de lo que debía llevar a esa fecha (INFOBRAS)." },
      { tipo: "obra_atraso", chip: "Obra atrasada", corto: "Obra atrasada de 20 a 40 puntos", explica: "En ejecución, la obra lleva de 20 a 40 puntos porcentuales de avance físico por debajo de lo programado (INFOBRAS)." },
      { tipo: "obra_pagado_sin_avance", chip: "Pagada sin avance", corto: "Pagada 50 puntos por encima de lo construido", explica: "La ejecución financiera (lo pagado) pasa en 50 puntos o más al avance físico (lo construido), con la obra sin terminar (INFOBRAS)." },
      { tipo: "obra_pago_adelantado", chip: "Pago adelantado", corto: "Pagada 30 a 50 puntos por encima de lo construido", explica: "Lo pagado pasa en 30 a 50 puntos al avance físico de la obra (INFOBRAS). Puede haber un adelanto contractual: vale revisar." },
      { tipo: "obra_adicionales_sobre_tope", chip: "Adicionales sobre 15 %", corto: "Adicionales de obra por más del 15 %", explica: "La obra es por contrata y sus adicionales, restados los deductivos, pasan el 15 % del contrato: el tope que la ley permite sin la autorización previa de la Contraloría (INFOBRAS)." },
      { tipo: "obra_adicionales_altos", chip: "Adicionales sobre 10 %", corto: "Adicionales de obra por más del 10 %", explica: "Los adicionales de obra, restados los deductivos, pasan el 10 % del contrato (o del expediente técnico, si la obra no tiene contrato). En una obra por contrata, cerca del tope legal del 15 % (INFOBRAS)." },
      { tipo: "obra_adicionales", chip: "Adicionales de obra", corto: "La obra tuvo adicionales", explica: "La obra sumó adicionales (trabajos extra que se pagan aparte) por hasta el 10 % del contrato (INFOBRAS)." },
      { tipo: "obra_plazo_duplicado", chip: "Plazo duplicado", corto: "Plazo de la obra duplicado o más", explica: "Las ampliaciones de plazo suman el plazo original de la obra o más: se le dio el doble de tiempo (INFOBRAS)." },
      { tipo: "obra_plazo_ampliado", chip: "Plazo ampliado", corto: "Plazo ampliado a la mitad o más", explica: "Las ampliaciones de plazo suman la mitad del plazo original o más (INFOBRAS)." },
      { tipo: "obra_controversia", chip: "Controversia", corto: "Obra con controversias", explica: "INFOBRAS registra controversias entre la entidad y el contratista: arbitrajes o conciliaciones por pagos, plazos o adicionales." },
      { tipo: "obra_informe_control", chip: "Informe de control", corto: "Obra con informes de la Contraloría", explica: "La Contraloría emitió informes de control sobre esta obra: revisiones que señalan riesgos o problemas. No son una condena." },
      { tipo: "inversion_sobrecosto_extremo", chip: "Cuesta 2× o más", corto: "La inversión cuesta 2 veces o más lo aprobado", explica: "El costo actualizado de la inversión de este contrato es 2 veces o más el monto con que se declaró viable (Invierte.pe, MEF)." },
      { tipo: "inversion_sobrecosto", chip: "Cuesta 1.5× o más", corto: "La inversión cuesta 1.5 veces o más lo aprobado", explica: "El costo actualizado de la inversión es de 1.5 a 2 veces el monto con que se declaró viable, con S/ 100 mil de diferencia o más (Invierte.pe)." },
      { tipo: "inversion_laudo", chip: "Laudo arbitral", corto: "La inversión registra un laudo arbitral", explica: "Invierte.pe registra laudos arbitrales en la inversión de este contrato: la entidad y el contratista resolvieron una controversia en un arbitraje." },
    ],
  },
  {
    // El acta de buena pro y el pliego de consultas del SEACE, leídos con Claude (migraciones 245-246). Sólo banderas que
    // salen de reglas sobre los hechos del documento, probadas en backend/evals (estables entre lecturas).
    titulo: "En el acta, las bases y las consultas",
    tipos: [
      { tipo: "acta_oferta_mas_baja_descartada", chip: "Oferta más baja fuera", corto: "La oferta más baja quedó fuera", explica: "Según el acta de buena pro, la oferta más baja no fue admitida o fue descalificada, y el ganador cobra 5 % o más que ella: el monto es la diferencia. Puede ser legal (la oferta no cumplía): vale leer el motivo." },
      { tipo: "acta_solo_queda_el_ganador", chip: "Solo quedó el ganador", corto: "Todos los demás postores quedaron fuera", explica: "Según el acta, se presentaron dos o más postores y todos menos el ganador quedaron fuera (no admitidos o descalificados): en la práctica, compitió solo. Con dos postores pesa poco, porque pasa en la mitad de los procesos; con más postores es menos común y pesa más." },
      { tipo: "acta_descalificados_por_formalidad", chip: "Fuera por formalidad", corto: "Sacaron a un postor por una formalidad", explica: "Según el acta, al menos un postor quedó fuera por un documento o una formalidad (una firma, el foliado, un formato, una declaración jurada) y no por lo que ofrecía." },
      { tipo: "consultas_denuncia_direccionamiento", chip: "Denuncia de bases dirigidas", corto: "Un participante denunció bases dirigidas", explica: "En el pliego de consultas y observaciones, un participante escribió que las bases favorecen a una marca, un fabricante o un proveedor. Es su denuncia, no una prueba: lo encontraron dos lecturas independientes. Pesa más si después la competencia desapareció (una sola oferta, o una sola admitida); si se admitieron varias, pesa poco." },
      { tipo: "bases_marca_sin_equivalente", chip: "Marca sin equivalente", corto: "Las bases exigen una marca sin «o equivalente»", explica: "Las bases nombran o exigen una marca, un fabricante o un modelo sin admitir «o equivalente»: sólo puede ganar quien venda esa marca. La norma pide describir lo que se necesita, no la marca, salvo que se justifique. Lo encontraron dos lecturas independientes." },
      { tipo: "bases_experiencia_alta", chip: "Experiencia 3× o más", corto: "Las bases exigen experiencia de 3 veces el valor o más", explica: "La experiencia que se exige al postor (lo que facturó antes en el rubro) es 3 veces o más el valor referencial de esta compra: deja fuera a empresas que sí podrían hacerla. Vale revisar si se justificó. Lo encontraron dos lecturas independientes." },
      { tipo: "consultas_observaciones_a_requisitos_rechazadas", chip: "Observaciones rechazadas", corto: "No acogió ninguna observación a los requisitos", explica: "Los participantes observaron dos o más veces los requisitos o las especificaciones y la entidad no acogió ninguna (pliego de consultas y observaciones, dos lecturas)." },
    ],
  },
];

/**
 * Indicadores EN OBSERVACIÓN (migración 329): se muestran en la ficha con su evidencia y no cuentan para el riesgo del
 * contrato hasta que se mida su precisión con una muestra revisada. Van fuera de GRUPOS_CRUCE: la lista de contratos no
 * puede filtrar por ellos (no entran a los contratos con antecedentes); la de empresas sí los ofrece.
 */
export const GRUPO_EN_OBSERVACION: (typeof GRUPOS_CRUCE)[number] = {
  titulo: "En observación",
  tipos: [
    { tipo: "reunion_en_evaluacion", chip: "Reunión en la evaluación", corto: "Se reunió con quien decide mientras se evaluaban las ofertas", explica: "Un socio o representante del ganador se reunió con un funcionario que decide las compras de la entidad después de presentar su oferta y antes de la buena pro (registro de visitas). Sólo cuentan los motivos de trato directo que la propia visita declara: reunión, visita personal o gestión de intereses; un mantenimiento o una entrega no. Pesa más si la empresa no le vendía antes a la entidad; si ya era proveedora, la visita puede ser por lo que ya tenía contratado. También puede ser una subsanación o el trámite de otro contrato: vale ver si quien la recibió integró el comité de selección. Del funcionario sólo se muestra el cargo. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "visita_personal_decisor", chip: "Visitas personales a quien decide", corto: "Visitas «personales» repetidas a quien decide las compras", explica: "La misma persona del ganador (socio, representante o directivo) visitó al mismo funcionario que decide las compras de la entidad, declarando «visita personal», en 3 o más días de 2 o más meses distintos, en el año anterior a la buena pro (registro de visitas). Una relación personal entre quien vende y quien decide es un posible conflicto de intereses. Puede ser un familiar, un excompañero o un motivo mal llenado: no prueba nada por sí solo. Del funcionario sólo se muestra el cargo. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "trabajo_en_el_ganador", chip: "Funcionario que trabajó en el ganador", corto: "Un funcionario de la entidad declaró haber trabajado en el ganador", explica: "Un funcionario de la entidad declaró en su Declaración Jurada de Intereses (datos abiertos de la Contraloría) un empleo en la empresa que ganó, y la buena pro llegó mientras él ocupaba su cargo en esa entidad, según la misma declaración. Pesa más si el empleo seguía vigente ese día, si lo había dejado hace menos de dos años o si empezó a trabajar en la empresa después de la buena pro. La Ley 31227 obliga a declarar estos vínculos y el Código de Ética de la Función Pública (Ley 27815) a apartarse de lo que los toca. No dice si el funcionario intervino en la contratación: puede ser de otra área." + " Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "firma_en_plazo_de_apelacion", chip: "Firma antes de poder apelar", corto: "Se firmó el contrato cuando los otros postores todavía podían apelar", explica: "En un ítem con dos o más ofertas, la buena pro queda consentida recién cuando vence el plazo para apelarla (al menos 5 días hábiles), y el contrato se firma después. Este se firmó antes, según las fechas de CONOSCE. Puede ser un error de fecha en el registro: por eso se revisa el contrato." },
    { tipo: "solo_admitido_el_ganador", chip: "Sólo admitieron al ganador", corto: "Entre cuatro o más ofertas, sólo se admitió la del ganador", explica: "En la admisión el comité revisa que cada oferta traiga los documentos obligatorios, antes de comparar precios. En este ítem se presentaron cuatro o más ofertas y sólo se admitió la del ganador, según el reporte de evaluación que genera el SEACE. Es el patrón de unas bases con un requisito formal a la medida; también puede haber postores improvisados que no traían lo pedido: vale leer el motivo de cada no admisión. Pasa en el 10 % de los ítems con cuatro ofertas y en menos del 7 % con seis o más. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "comite_mismo_ganador", chip: "Mismo comité, mismo ganador", corto: "La misma persona del comité le adjudicó varias veces a esta empresa", explica: "Según las actas que leyeron los agentes de Vigía (cada nombre comprobado en el documento), una misma persona integró el comité de selección en 3 o más procesos de la entidad que ganó esta empresa: la mitad o más de los procesos de esa persona. En los procesos de la entidad sin esa persona, la empresa gana bastante menos (la mitad o menos). La relación entre quien evalúa y quien gana merece mirarse; también puede ser el único proveedor del rubro o un área que compra siempre lo mismo. De la persona sólo se dice su papel en el comité. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "comite_socio_proveedor", chip: "Comité socio del proveedor", corto: "Un integrante del comité de la entidad es socio o representante de esta empresa", explica: "Según las actas que leyeron los agentes de Vigía (cada nombre comprobado en el documento), una persona que integró el comité de selección en la entidad figura en el Registro Nacional de Proveedores como socio, gerente o representante de esta empresa, que le gana contratos a esa misma entidad. La ley de contrataciones impide contratar con su entidad al funcionario y a sus empresas mientras ejerce y hasta doce meses después. Se empareja por el nombre completo: pesa más si el DNI del registro aparece entre las personas con órdenes de la entidad o si el nombre tiene cuatro palabras o más, si la buena pro cayó mientras la persona integraba comités (o a un año o menos) y, sobre todo, si estuvo en el comité de ese mismo proceso. Puede ser un homónimo: confírmalo antes de concluir. De la persona sólo se dice su papel. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "comite_competencia_restringida", chip: "Evaluador que restringe la competencia", corto: "En los procesos de un mismo integrante del comité la competencia queda restringida más que en el resto de la entidad", explica: "Según las actas que leyeron Vigía y sus agentes, una misma persona integró el comité de selección en varios procesos de esta entidad, y en ellos la competencia quedó restringida (un solo postor, el acta deja sólo al ganador, descalificaciones por formalidad, la oferta más baja descartada o sólo se admitió al ganador) muchas más veces que en los demás procesos de la entidad. Se calcula la probabilidad de que tantos casos sean azar con la tasa de la entidad sin esa persona, y sólo sale quien pasa un control de falsos descubrimientos sobre todas las personas probadas. Puede ser un área que compra cosas muy específicas: vale leer cómo se calificó a los postores en esos procesos. De la persona sólo se dice su papel. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "ofertas_a_la_vez", chip: "Ofertas casi a la vez", corto: "Presentó su oferta casi a la vez que un rival vinculado", explica: "El ganador y otro postor del mismo ítem comparten un socio, representante o directivo (Registro Nacional de Proveedores) y registraron sus ofertas en el SEACE con 30 minutos o menos de diferencia (reporte de presentación de ofertas). Entre postores que ofertan tan seguido, compartir a una persona es varias veces más frecuente que entre los que ofertan con horas de diferencia: sugiere que las dos ofertas las preparó la misma mano. También puede ser el mismo estudio que tramita para varios clientes: vale comparar los precios y los documentos de las dos ofertas. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "comite_corregido_tribunal", chip: "Evaluador corregido por el Tribunal", corto: "Un integrante del comité cuyas evaluaciones el Tribunal corrige más que en el resto de la entidad", explica: "Según las actas que leyeron Vigía y sus agentes, una misma persona integró el comité de selección en varios procesos de esta entidad, y en dos o más el Tribunal de Contrataciones corrigió el proceso al resolver una apelación (la declaró fundada o anuló el procedimiento): muchas más veces que en los demás procesos de la entidad. Se calcula la probabilidad de que sea azar con la tasa de la entidad sin esa persona, y sólo sale quien pasa un control de falsos descubrimientos sobre todas las personas probadas. Puede ser un área con procesos más disputados: vale leer qué corrigió el Tribunal cada vez. De la persona sólo se dice su papel. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "tribunal_sancionador", chip: "Sancionador del Tribunal", corto: "El Tribunal ordenó abrirle un procedimiento sancionador por su oferta", explica: "Al resolver una apelación en este proceso, el Tribunal de Contrataciones encontró indicios de que la empresa presentó documentación falsa o información inexacta en su oferta, y ordenó abrirle un procedimiento administrativo sancionador. Es la orden de investigar, no la sanción: el Tribunal decide después, en otro expediente, si la inhabilita o la multa. Sale de la resolución que leyó Vigía, con el nombre comprobado en su parte resolutiva y unido al RUC entre los postores del proceso. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "tribunal_revoco_buena_pro", chip: "El Tribunal le quitó la buena pro", corto: "El comité le dio la buena pro y el Tribunal se la quitó", explica: "Otro postor apeló y el Tribunal de Contrataciones le dio la razón: revocó la buena pro que el comité había dado a esta empresa, o descalificó su oferta. Una vez puede ser un error del comité; que le pase a la misma empresa en varias entidades sugiere comités que la favorecen o ofertas que no cumplen y aun así ganan. Sale de la resolución que leyó Vigía, con el nombre comprobado en el texto. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "tribunal_corrigio_otra_vez", chip: "Corregido otra vez por el Tribunal", corto: "El Tribunal corrigió el proceso y, cuando la entidad volvió a decidir, lo corrigió otra vez", explica: "Al resolver una apelación el Tribunal de Contrataciones le ordena al comité qué rehacer. Aquí el proceso volvió al Tribunal y lo corrigió de nuevo: el comité repitió el error o no cumplió lo ordenado. Pesa más si la entidad mantuvo a la misma empresa con la buena pro en dos rondas, o si el Tribunal escribe que el comité no acató su mandato. Sale de las resoluciones que leyó Vigía, unidas al proceso. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
    { tipo: "gana_con_sancionador_abierto", chip: "Ganó con un sancionador abierto", corto: "Ganó mientras tenía abierto un sancionador que ordenó el Tribunal", explica: "El Tribunal de Contrataciones había ordenado abrirle a esta empresa un procedimiento sancionador por presentar documentación falsa o información inexacta en otro proceso, y antes de que la sancionara (o en los dos años siguientes, si no hay sanción) ganó este. No está prohibido: mientras no haya sanción, la empresa puede contratar. Pero la entidad pudo saberlo y revisar con más cuidado los documentos de su oferta. Indicador en observación: no cuenta para el riesgo del contrato hasta medir cuántas veces acierta." },
  ],
};

/** ¿Es un indicador en observación? (por su tipo; la ficha del contrato lo trae además en `observacion`). */
export const esEnObservacion = (tipo: string) => GRUPO_EN_OBSERVACION.tipos.some((t) => t.tipo === tipo);

/** Los patrones de visitas: sus visitas van una por una (fecha, hora, cargo de quien recibió). */
export const esPatronVisita = (tipo: string) =>
  (tipo !== "visita_previa" && tipo.startsWith("visita_")) || tipo === "reunion_en_evaluacion";

/** La etapa del procedimiento en que cayó una visita (migración 329), en palabras. */
export const ETAPA_VISITA: Record<string, string> = {
  antes_de_convocar: "antes de que se convocara el proceso",
  convocatoria: "entre la convocatoria y la presentación de su oferta",
  evaluacion: "después de presentar su oferta, mientras se evaluaba",
  dia_buena_pro: "el mismo día de la buena pro",
};

/** ¿Es una bandera leída de un documento con Claude (acta, bases o consultas)? */
export const esTipoLeido = (tipo: string) => tipo.startsWith("acta_") || tipo.startsWith("consultas_") || tipo.startsWith("bases_");

/** ¿Es una bandera de «En la obra» (INFOBRAS e Invierte.pe)? Hechos de la ejecución del contrato, no antecedentes de quien ganó. */
export const esTipoObra = (tipo: string) => tipo.startsWith("obra_") || tipo.startsWith("inversion_");
export const TIPOS_OBRA = GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => t.tipo)).filter(esTipoObra);

export const TIPO_CRUCE = Object.fromEntries([...GRUPOS_CRUCE, GRUPO_EN_OBSERVACION].flatMap((g) => g.tipos.map((t) => [t.tipo, t])));

/** El nombre de un cruce para un chip angosto (o su `corto` si no tiene uno más breve). */
export const chipCruce = (tipo: string): string => TIPO_CRUCE[tipo]?.chip ?? TIPO_CRUCE[tipo]?.corto ?? tipo;

/** Cada responsabilidad que señala un informe de control (migraciones 90 y 302), en palabras. Siempre presunta. */
const RESPONSABILIDAD_CONTROL: Record<string, string> = {
  penal: "penal",
  civil: "civil",
  administrativa_entidad: "administrativa (la procesa la entidad)",
  administrativa_pas: "administrativa (la procesa la Contraloría)",
  administrativa: "administrativa",
};
/** El tema de una observación de un informe de control (lectura de IA, lista cerrada), para una frase («trata de…»). */
export const TEMA_OBSERVACION_CONTROL: Record<string, string> = {
  seleccion_contratacion: "la selección y la contratación",
  ejecucion_contractual: "la ejecución del contrato o de la obra",
  pagos_adelantos: "pagos y adelantos",
  personal_planillas: "personal y planillas",
  bienes_almacen: "bienes y almacén",
  presupuesto_tesoreria: "presupuesto y tesorería",
};
/** ["penal", "administrativa_entidad"] → «penal y administrativa (la procesa la entidad)»; null si no hay ninguna. */
export function responsabilidadesEnPalabras(v: unknown): string | null {
  const orden = Object.keys(RESPONSABILIDAD_CONTROL);
  const xs = (Array.isArray(v) ? v : [])
    .filter((r): r is string => typeof r === "string" && r in RESPONSABILIDAD_CONTROL)
    .sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
    .map((r) => RESPONSABILIDAD_CONTROL[r]);
  if (!xs.length) return null;
  return xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}
