// Red de personas detrás de cada alerta.
// En producción esta data la arman los agentes `network_agent` (RNP →
// socios), `web_research_agent` (búsquedas en OSCE, ONPE, JNE, PJ, prensa)
// y `compliance_agent` (cruce con sancionados). Acá la simulamos para
// demo. Los IDs y URLs apuntan a fuentes públicas reales.

export type FlagTipo =
  | "sancion"
  | "condena"
  | "inhabilitacion"
  | "aporte_politico"
  | "familiar_funcionario"
  | "investigacion_periodistica"
  | "edad_ruc"
  | "domicilio_compartido"
  | "rotacion_funcionario";

export type FlagSeveridad = "alta" | "media" | "baja";

export interface NetworkFlag {
  tipo: FlagTipo;
  titulo: string;
  detalle: string;
  fecha?: string;
  fuente: { nombre: string; url: string; fecha?: string };
  severidad: FlagSeveridad;
  agente: "network_agent" | "web_research_agent" | "compliance_agent";
}

export interface PersonaNetwork {
  dni: string;
  nombre: string;
  rol: string;
  participacion?: number;
  flags: NetworkFlag[];
  info?: NodeInfo;
}

export interface HallazgoWeb {
  titulo: string;
  fuente: string;
  url: string;
  fecha?: string;
  snippet: string;
}

export type NodoTipo =
  | "empresa"
  | "persona"
  | "entidad_publica"
  | "funcionario"
  | "comite"
  | "partido_politico"
  | "organo_sancionador";

/** Columna lógica en el grafo de 3 capas. */
export type Capa = "compradora" | "aprueban" | "proveedor" | "externo";

/** Posición dentro de la columna. */
export type Nivel = "institucion" | "cabeza" | "miembro";

export interface InfoField {
  label: string;
  value: string;
  mono?: boolean;
  link?: string;
}

export interface NodeInfo {
  fields: InfoField[];
  fuente?: { nombre: string; url: string };
  note?: string;
}

export interface NodoExterno {
  id: string;
  tipo: NodoTipo;
  nombre: string;
  detalle?: string;
  capa?: Capa;
  nivel?: Nivel;
  info?: NodeInfo;
}

export type ConexionTipo =
  | "adjudico"
  | "aprobo"
  | "representa"
  | "preside"
  | "familiar"
  | "aporte"
  | "sanciono"
  | "pertenece"
  | "denuncio"
  | "convoca";

export interface Conexion {
  from: string; // "empresa" para el nodo central, dni del socio, o id del nodo externo
  to: string;
  tipo: ConexionTipo;
  label?: string;
  severidad?: FlagSeveridad;
}

export interface EmpresaNetwork {
  ruc: string;
  razonSocial: string;
  edadRucDias: number;
  capitalSocial?: number;
  domicilio?: string;
  flagsEmpresa: NetworkFlag[];
  socios: PersonaNetwork[];
  hallazgosWeb: HallazgoWeb[];
  /** Entidades públicas, funcionarios, partidos y órganos sancionadores
   *  que aparecen en la red. Si está vacío, el grafo cae al layout simple
   *  empresa→socios. */
  entidadesRelacionadas?: NodoExterno[];
  /** Aristas explícitas. Si no se provee, se infieren ↓ */
  conexiones?: Conexion[];
}

export const NETWORK_BY_ALERTA: Record<string, EmpresaNetwork> = {
  // ─── Yungay, Áncash — score 91. La más rica. ───
  "ALT-2026-0005": {
    ruc: "20613789012",
    razonSocial: "CORPORACIÓN VIAL RÁNRAHIRCA SAC",
    edadRucDias: 65,
    capitalSocial: 50_000,
    domicilio: "Av. Ramón Castilla 234, Yungay, Áncash",
    entidadesRelacionadas: [
      // Compradora
      {
        id: "ent-yungay", tipo: "entidad_publica", capa: "compradora", nivel: "institucion",
        nombre: "Mun. Distrital de Yungay", detalle: "RUC 20165498220",
        info: {
          fields: [
            { label: "RUC", value: "20165498220", mono: true },
            { label: "Departamento", value: "Áncash" },
            { label: "Provincia", value: "Yungay" },
            { label: "Dirección", value: "Plaza de Armas s/n, Yungay" },
            { label: "Tipo", value: "Municipalidad Distrital" },
            { label: "Presupuesto 2026 (PIA)", value: "S/. 28.4M aprox." },
          ],
          fuente: { nombre: "OECE Contrataciones Abiertas", url: "https://contratacionesabiertas.oece.gob.pe/" },
        },
      },
      {
        id: "alcalde-yungay", tipo: "funcionario", capa: "compradora", nivel: "cabeza",
        nombre: "Carlos Mendoza Quispe", detalle: "Alcalde Distrital de Yungay",
        info: {
          fields: [
            { label: "DNI", value: "31487256", mono: true },
            { label: "Cargo", value: "Alcalde Distrital de Yungay" },
            { label: "Periodo", value: "2023 — 2026" },
            { label: "Designación", value: "Proclamado por JNE el 02 ene 2023" },
            { label: "Partido", value: "Mov. Regional Áncash" },
            { label: "DJI presentada", value: "08 ene 2023", link: "https://dji.pide.gob.pe/consultas-dji/" },
            { label: "Hoja de vida JNE", value: "Ver registro →", link: "https://plataformaelectoral.jne.gob.pe/" },
          ],
          note: "Declara en su DJI a Pedro Ramírez Solano (cuñado, 2do grado afín) como pariente.",
        },
      },
      // Aprueban
      {
        id: "comite-yungay", tipo: "comite", capa: "aprueban", nivel: "institucion",
        nombre: "Comité de Selección", detalle: "Convocatoria 1322034-2026",
        info: {
          fields: [
            { label: "Convocatoria", value: "1322034-2026", mono: true },
            { label: "Tipo", value: "Adjudicación Simplificada · Obra" },
            { label: "Conformación", value: "Resolución de Alcaldía N° 047-2026" },
            { label: "Miembros", value: "3 titulares + 3 suplentes" },
            { label: "Fecha buena pro", value: "19 ene 2026" },
            { label: "Resultado", value: "Único postor · adjudicado al 99.8% del valor referencial" },
          ],
          fuente: { nombre: "SEACE V3 — bases públicas", url: "https://prodapp2.seace.gob.pe/" },
        },
      },
      {
        id: "pdte-yungay", tipo: "funcionario", capa: "aprueban", nivel: "cabeza",
        nombre: "Ricardo Salinas Vega", detalle: "Pdte. del Comité",
        info: {
          fields: [
            { label: "DNI", value: "44182937", mono: true },
            { label: "Cargo", value: "Gerente de Infraestructura · Mun. Yungay" },
            { label: "Profesión", value: "Ing. Civil · CIP 138204" },
            { label: "SICAN vigente", value: "Sí · vence dic 2026", link: "https://www.gob.pe/oece" },
            { label: "Antigüedad", value: "Designado 17 feb 2023" },
          ],
        },
      },
      // Externos
      {
        id: "partido-mra", tipo: "partido_politico", capa: "externo",
        nombre: "Mov. Regional Áncash", detalle: "Partido del alcalde — campaña 2022",
        info: {
          fields: [
            { label: "Tipo", value: "Movimiento Regional" },
            { label: "Inscripción JNE", value: "ROP 2018" },
            { label: "Cargos ganados 2022", value: "1 alcaldía distrital · 2 regidurías" },
            { label: "Aportes 2022", value: "S/. 218,500 declarados en ONPE" },
            { label: "Ver aportantes", value: "Portal Claridad →", link: "https://claridadportal.onpe.gob.pe/" },
          ],
        },
      },
      {
        id: "tribunal-osce", tipo: "organo_sancionador", capa: "externo",
        nombre: "Tribunal de Contrataciones", detalle: "OSCE · sancionó 2019",
        info: {
          fields: [
            { label: "Resolución", value: "N° 1842-2019-TCE-S2", mono: true },
            { label: "Fecha", value: "15 ago 2019" },
            { label: "Infractor", value: "Juan Pérez García (DNI 44512983)" },
            { label: "Infracción", value: "Colusión simple — Art. 50.1.a Ley 30225" },
            { label: "Sanción", value: "Inhabilitación 36 meses (ago 2019 – ago 2022)" },
            { label: "Estado actual", value: "Sanción cumplida pero RUC reactivado en nueva empresa" },
            { label: "Ver registro", value: "OSCE Inhabilitados →", link: "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml" },
          ],
          note: "La opinión OECE D012-2024 considera este patrón como 'reincidencia por testaferro'.",
        },
      },
    ],
    conexiones: [
      // Flujo legal
      { from: "ent-yungay", to: "comite-yungay", tipo: "convoca", label: "convoca" },
      { from: "comite-yungay", to: "empresa", tipo: "adjudico", label: "S/. 4.25M · adjudicó", severidad: "alta" },
      // Intra-columna (presidencias)
      { from: "alcalde-yungay", to: "ent-yungay", tipo: "preside", label: "alcalde" },
      { from: "pdte-yungay", to: "comite-yungay", tipo: "preside", label: "preside" },
      // Colusiones cruzadas
      { from: "alcalde-yungay", to: "70919283", tipo: "familiar", label: "cuñado · DJI 2023", severidad: "alta" },
      { from: "07234561", to: "partido-mra", tipo: "aporte", label: "S/. 35K · 2022", severidad: "alta" },
      { from: "partido-mra", to: "alcalde-yungay", tipo: "pertenece", label: "candidato 2022" },
      { from: "tribunal-osce", to: "44512983", tipo: "sanciono", label: "colusión 2019", severidad: "alta" },
    ],
    flagsEmpresa: [
      {
        tipo: "edad_ruc",
        titulo: "Edad de RUC < 90 días al ganar el contrato",
        detalle:
          "RUC dado de alta el 17 feb 2026. Buena pro firmada el 22 abr 2026 (65 días). Patrón clásico de empresa fachada (modelo Funes, OjoPúblico 2019).",
        fecha: "2026-02-17",
        fuente: { nombre: "SUNAT vía apis.net.pe", url: "https://apis.net.pe/" },
        severidad: "alta",
        agente: "compliance_agent",
      },
      {
        tipo: "domicilio_compartido",
        titulo: "Comparte domicilio fiscal con otras 3 empresas creadas en 2026",
        detalle:
          "El domicilio (Av. Ramón Castilla 234) figura como sede de 3 empresas distintas dadas de alta en los últimos 4 meses, todas con objeto similar. Indicio de RUC fachada en cadena.",
        fecha: "2026-04-30",
        fuente: { nombre: "SUNAT — consulta RUC", url: "https://e-consultaruc.sunat.gob.pe/" },
        severidad: "alta",
        agente: "network_agent",
      },
    ],
    socios: [
      {
        dni: "44512983",
        nombre: "Juan Pérez García",
        rol: "Gerente general · Accionista mayoritario",
        participacion: 60,
        info: {
          fields: [
            { label: "DNI", value: "44512983", mono: true },
            { label: "Edad", value: "52 años" },
            { label: "Dirección", value: "Jr. Comercio 145, Yungay" },
            { label: "Empresas vinculadas", value: "4 (incluyendo 2 inhabilitadas históricas)" },
            { label: "Estado RNP", value: "Activo (post-inhabilitación 2022)" },
            { label: "Antecedentes", value: "1 inhabilitación cumplida (2019-2022)" },
          ],
          note: "Aparece como gerente de un nuevo RUC creado 47 días antes de la firma del contrato. El patrón coincide con 'reincidencia por testaferro' según OECE.",
        },
        flags: [
          {
            tipo: "inhabilitacion",
            titulo: "Inhabilitación vigente en el RNP",
            detalle:
              "Sancionado por el Tribunal de Contrataciones Públicas por colusión simple. Inhabilitado 36 meses (2019-2022). Hoy figura como representante de un RUC distinto, lo que según la opinión OECE D012-2024 configura 'reincidencia por testaferro' (art. 50 TUO Ley 30225).",
            fecha: "2019-08-15",
            fuente: {
              nombre: "OSCE · Tribunal de Contrataciones",
              url: "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml",
              fecha: "2019-08-15",
            },
            severidad: "alta",
            agente: "compliance_agent",
          },
          {
            tipo: "investigacion_periodistica",
            titulo: "Mencionado en investigación OjoPúblico (2021)",
            detalle:
              "Reportaje 'Los albañiles de Áncash' lo señala como parte de una red de RUC fantasma usados para captar obras públicas del gobierno regional 2019-2022.",
            fecha: "2021-11-03",
            fuente: {
              nombre: "OjoPúblico",
              url: "https://ojo-publico.com/especiales/",
              fecha: "2021-11-03",
            },
            severidad: "media",
            agente: "web_research_agent",
          },
        ],
      },
      {
        dni: "07234561",
        nombre: "María López Vargas",
        rol: "Apoderada · Accionista",
        participacion: 30,
        info: {
          fields: [
            { label: "DNI", value: "07234561", mono: true },
            { label: "Edad", value: "44 años" },
            { label: "Profesión", value: "Contadora Pública · CCP Áncash" },
            { label: "Dirección", value: "Calle Bolognesi 308, Huaraz" },
            { label: "Aporte ONPE 2022", value: "S/. 35,000 (efectivo)" },
            { label: "Partido beneficiado", value: "Mov. Regional Áncash" },
          ],
          note: "Aporta a partido del alcalde 16 meses antes de la firma del contrato. Cae dentro de la ventana C3 del modelo Funes (24 meses).",
        },
        flags: [
          {
            tipo: "aporte_politico",
            titulo: "Aportó a la campaña del alcalde firmante (2022)",
            detalle:
              "Aporte de S/. 35,000 al partido del actual alcalde de Yungay durante la campaña 2022. Registro vigente en ONPE — Portal Claridad. La firma de contrato ocurre 16 meses después del aporte: dentro de la ventana de 24 meses que el modelo Funes señala como sospechosa (cruce C3).",
            fecha: "2022-09-12",
            fuente: {
              nombre: "ONPE · Portal Claridad",
              url: "https://claridadportal.onpe.gob.pe/",
              fecha: "2022-09-12",
            },
            severidad: "alta",
            agente: "web_research_agent",
          },
        ],
      },
      {
        dni: "70919283",
        nombre: "Pedro Ramírez Solano",
        rol: "Director · Accionista minoritario",
        participacion: 10,
        info: {
          fields: [
            { label: "DNI", value: "70919283", mono: true },
            { label: "Edad", value: "38 años" },
            { label: "Vínculo familiar", value: "Cuñado del alcalde Carlos Mendoza Quispe (2do grado afín)" },
            { label: "Fuente vínculo", value: "DJI presentada por el alcalde el 08 ene 2023", link: "https://dji.pide.gob.pe/consultas-dji/" },
            { label: "Otros cargos", value: "Director suplente en 2 empresas más del entorno familiar" },
          ],
          note: "El parentesco está formalmente declarado por el funcionario que firma el contrato → potencial nulidad bajo art. 11 Ley 31227.",
        },
        flags: [
          {
            tipo: "familiar_funcionario",
            titulo: "Cuñado declarado del alcalde firmante",
            detalle:
              "En la Declaración Jurada de Intereses presentada en enero 2023, el alcalde declara a 'Pedro Ramírez Solano' como pariente afín en segundo grado. La firma del contrato por parte del alcalde constituye aparente conflicto de interés (art. 11 Ley 31227).",
            fecha: "2023-01-08",
            fuente: {
              nombre: "PIDE · Declaración Jurada de Intereses",
              url: "https://dji.pide.gob.pe/consultas-dji/",
              fecha: "2023-01-08",
            },
            severidad: "alta",
            agente: "web_research_agent",
          },
        ],
      },
    ],
    hallazgosWeb: [
      {
        titulo: "Comunicado oficial — la municipalidad anuncia la obra",
        fuente: "Facebook · Mun. Distrital de Caraz",
        url: "https://www.facebook.com/",
        fecha: "2026-04-23",
        snippet:
          "El alcalde anuncia el inicio de obras del cerco perimétrico del complejo deportivo Yungay con un costo de S/. 1.49M.",
      },
      {
        titulo: "Investigación 2021: 'Los albañiles de Áncash'",
        fuente: "OjoPúblico",
        url: "https://ojo-publico.com/",
        fecha: "2021-11-03",
        snippet:
          "Documenta una red de empresas creadas en Yungay y Caraz para captar obras públicas. La empresa CORPORACIÓN VIAL RÁNRAHIRCA SAC no existía aún en esa fecha; sus actuales socios sí aparecen mencionados como integrantes del esquema.",
      },
      {
        titulo: "Designación del alcalde — Resolución",
        fuente: "El Peruano · Normas Legales",
        url: "https://busquedas.elperuano.pe/",
        fecha: "2023-01-02",
        snippet:
          "Resolución de proclamación del alcalde de Yungay para el periodo 2023-2026. Asume el cargo 17 días antes de que se presente la DJI que declara el parentesco con Pedro Ramírez Solano.",
      },
    ],
  },

  // ─── Piura — score 88, aporte = ganador. ───
  "ALT-2026-0007": {
    ruc: "20602345678",
    razonSocial: "CONSTRUCTORA DEL PACÍFICO NORTE SAC",
    edadRucDias: 34,
    capitalSocial: 30_000,
    domicilio: "Av. Sánchez Cerro 1245, Piura",
    entidadesRelacionadas: [
      {
        id: "ent-grpiura", tipo: "entidad_publica", capa: "compradora", nivel: "institucion",
        nombre: "Gob. Regional de Piura", detalle: "RUC 20484020611",
        info: {
          fields: [
            { label: "RUC", value: "20484020611", mono: true },
            { label: "Departamento", value: "Piura" },
            { label: "Tipo", value: "Gobierno Regional" },
            { label: "Presupuesto 2026", value: "S/. 1,856M aprox." },
            { label: "Dirección", value: "Av. San Ramón s/n, Urb. San Eduardo, Piura" },
          ],
        },
      },
      {
        id: "gobernador-piura", tipo: "funcionario", capa: "compradora", nivel: "cabeza",
        nombre: "Eduardo Vilela Castro", detalle: "Gobernador Regional de Piura",
        info: {
          fields: [
            { label: "DNI", value: "02845173", mono: true },
            { label: "Cargo", value: "Gobernador Regional de Piura" },
            { label: "Periodo", value: "2023 — 2026" },
            { label: "Partido", value: "Frente Regional del Norte" },
            { label: "Hoja de vida JNE", value: "Ver →", link: "https://plataformaelectoral.jne.gob.pe/" },
          ],
        },
      },
      {
        id: "comite-piura", tipo: "comite", capa: "aprueban", nivel: "institucion",
        nombre: "Comité de Selección", detalle: "Convocatoria 1351200-2026",
        info: {
          fields: [
            { label: "Convocatoria", value: "1351200-2026", mono: true },
            { label: "Tipo", value: "Adjudicación Simplificada · Obra" },
            { label: "Resultado", value: "Único postor · S/. 6.7M" },
          ],
        },
      },
      {
        id: "pdte-piura", tipo: "funcionario", capa: "aprueban", nivel: "cabeza",
        nombre: "Marco Acevedo Rojas", detalle: "Pdte. del Comité",
        info: {
          fields: [
            { label: "DNI", value: "40927185", mono: true },
            { label: "Cargo previo", value: "Asesor de Gerencia de Infraestructura GORE Piura (2019-2022)" },
            { label: "Cargo actual", value: "Subgerente de Obras GORE Piura" },
          ],
        },
      },
      {
        id: "partido-norte", tipo: "partido_politico", capa: "externo",
        nombre: "Frente Regional del Norte", detalle: "Partido del gobernador 2022",
        info: {
          fields: [
            { label: "Aportes 2022 declarados", value: "S/. 184,200 en efectivo" },
            { label: "Inscripción JNE", value: "ROP 2014" },
            { label: "Ver aportantes", value: "Portal Claridad →", link: "https://claridadportal.onpe.gob.pe/" },
          ],
        },
      },
    ],
    conexiones: [
      { from: "ent-grpiura", to: "comite-piura", tipo: "convoca", label: "convoca" },
      { from: "comite-piura", to: "empresa", tipo: "adjudico", label: "S/. 6.7M · adjudicó", severidad: "alta" },
      { from: "gobernador-piura", to: "ent-grpiura", tipo: "preside", label: "gobernador" },
      { from: "pdte-piura", to: "comite-piura", tipo: "preside", label: "preside" },
      { from: "40128756", to: "partido-norte", tipo: "aporte", label: "S/. 28K · 2022", severidad: "alta" },
      { from: "partido-norte", to: "gobernador-piura", tipo: "pertenece", label: "candidato 2022" },
      { from: "ent-grpiura", to: "08456712", tipo: "denuncio", label: "ex-asesora 2019-21", severidad: "media" },
    ],
    flagsEmpresa: [
      {
        tipo: "edad_ruc",
        titulo: "Empresa con 34 días al ganar contrato de S/. 6.7M",
        detalle:
          "Alta de RUC: 26 feb 2026. Buena pro: 30 mar 2026. Ratio monto/edad: S/. 197K por día desde la creación.",
        fuente: { nombre: "SUNAT", url: "https://apis.net.pe/" },
        severidad: "alta",
        agente: "compliance_agent",
      },
    ],
    socios: [
      {
        dni: "40128756",
        nombre: "Carlos Eduardo Saavedra Ríos",
        rol: "Gerente · Accionista mayoritario",
        participacion: 70,
        flags: [
          {
            tipo: "aporte_politico",
            titulo: "Aportó S/. 28,000 al partido del gobernador regional",
            detalle:
              "Aporte registrado en ONPE Claridad durante la campaña 2022. El gobernador regional firma el contrato 8 meses después, dentro de la ventana de 12 meses del cruce C3.",
            fecha: "2022-10-04",
            fuente: {
              nombre: "ONPE · Portal Claridad",
              url: "https://claridadportal.onpe.gob.pe/",
              fecha: "2022-10-04",
            },
            severidad: "alta",
            agente: "web_research_agent",
          },
        ],
      },
      {
        dni: "08456712",
        nombre: "Lucía Rivas Gonzales",
        rol: "Apoderada legal",
        participacion: 30,
        flags: [
          {
            tipo: "rotacion_funcionario",
            titulo: "Exempleada del gobierno regional 2019-2021",
            detalle:
              "Trabajó como asesora en la Gerencia de Infraestructura del Gob. Reg. de Piura entre 2019 y 2021. Renunció 9 meses antes de la creación del RUC actual.",
            fecha: "2021-04-30",
            fuente: {
              nombre: "El Peruano · Resoluciones",
              url: "https://busquedas.elperuano.pe/",
              fecha: "2021-04-30",
            },
            severidad: "media",
            agente: "web_research_agent",
          },
        ],
      },
    ],
    hallazgosWeb: [
      {
        titulo: "Informe IDL-Reporteros sobre licitaciones en salud — Piura 2024",
        fuente: "IDL-Reporteros",
        url: "https://www.idl-reporteros.pe/",
        fecha: "2024-08-22",
        snippet:
          "Reportaje sobre concentración de contratos del sector salud en Piura. Menciona a socios mayoritarios de varias empresas con historial de aportes políticos durante 2018-2022.",
      },
      {
        titulo: "Resolución de adjudicación publicada en El Peruano",
        fuente: "El Peruano · Normas Legales",
        url: "https://busquedas.elperuano.pe/",
        fecha: "2026-04-02",
        snippet:
          "Adjudicación del contrato a CONSTRUCTORA DEL PACÍFICO NORTE SAC por S/. 6,700,000 publicada en el diario oficial.",
      },
    ],
  },

  // ─── Independencia, Áncash — score 86. ───
  "ALT-2026-0001": {
    ruc: "20612478819",
    razonSocial: "CONSTRUCTORA ANDINA EXPRESS SAC",
    edadRucDias: 47,
    capitalSocial: 25_000,
    domicilio: "Jr. Sucre 480, Huaraz",
    entidadesRelacionadas: [
      {
        id: "ent-independencia", tipo: "entidad_publica", capa: "compradora", nivel: "institucion",
        nombre: "Mun. Dist. de Independencia", detalle: "RUC 20131369981 · Huaraz",
        info: {
          fields: [
            { label: "RUC", value: "20131369981", mono: true },
            { label: "Provincia", value: "Huaraz, Áncash" },
            { label: "Tipo", value: "Municipalidad Distrital" },
            { label: "Población", value: "76,000 habitantes (INEI 2017)" },
          ],
        },
      },
      {
        id: "alcalde-independencia", tipo: "funcionario", capa: "compradora", nivel: "cabeza",
        nombre: "Wilfredo Cerna Rondón", detalle: "Alcalde Distrital de Independencia",
        info: {
          fields: [
            { label: "DNI", value: "32815647", mono: true },
            { label: "Periodo", value: "2023 — 2026" },
            { label: "Profesión", value: "Abogado · CAA Áncash" },
            { label: "Hoja de vida JNE", value: "Ver →", link: "https://plataformaelectoral.jne.gob.pe/" },
          ],
        },
      },
      {
        id: "comite-independencia", tipo: "comite", capa: "aprueban", nivel: "institucion",
        nombre: "Comité de Selección", detalle: "Convocatoria 1245678-2026",
        info: {
          fields: [
            { label: "Convocatoria", value: "1245678-2026", mono: true },
            { label: "Resultado", value: "Único postor al 99.2%" },
          ],
        },
      },
      {
        id: "pdte-independencia", tipo: "funcionario", capa: "aprueban", nivel: "cabeza",
        nombre: "Hugo Atúncar Morán", detalle: "Pdte. del Comité",
        info: {
          fields: [
            { label: "DNI", value: "41928574", mono: true },
            { label: "Cargo", value: "Gerente de Obras · Mun. Independencia" },
            { label: "Designación", value: "Resolución 029-2023" },
          ],
        },
      },
      {
        id: "contraloria", tipo: "organo_sancionador", capa: "externo",
        nombre: "Contraloría General", detalle: "Oficio 2023 — archivado",
        info: {
          fields: [
            { label: "Oficio", value: "N° 03142-2023-CG/HCO", mono: true },
            { label: "Fecha", value: "17 may 2023" },
            { label: "Materia", value: "Presunto direccionamiento en obras viales" },
            { label: "Estado", value: "Archivado por falta de evidencia concluyente" },
            { label: "Investigado", value: "Roberto Vargas Espinoza (DNI 31729844)" },
          ],
        },
      },
    ],
    conexiones: [
      { from: "ent-independencia", to: "comite-independencia", tipo: "convoca", label: "convoca" },
      { from: "comite-independencia", to: "empresa", tipo: "adjudico", label: "S/. 2.84M · único postor", severidad: "alta" },
      { from: "alcalde-independencia", to: "ent-independencia", tipo: "preside", label: "alcalde" },
      { from: "pdte-independencia", to: "comite-independencia", tipo: "preside", label: "preside" },
      { from: "contraloria", to: "31729844", tipo: "denuncio", label: "oficio 2023", severidad: "media" },
    ],
    flagsEmpresa: [
      {
        tipo: "edad_ruc",
        titulo: "RUC de 47 días gana contrato de S/. 2.84M como único postor",
        detalle:
          "Cruce C1 + C2 del modelo Funes (edad RUC + único postor). Doble bandera roja.",
        fuente: { nombre: "SUNAT", url: "https://apis.net.pe/" },
        severidad: "alta",
        agente: "compliance_agent",
      },
    ],
    socios: [
      {
        dni: "31729844",
        nombre: "Roberto Vargas Espinoza",
        rol: "Gerente general · Accionista 80%",
        participacion: 80,
        flags: [
          {
            tipo: "investigacion_periodistica",
            titulo: "Mencionado en denuncia ante Contraloría (2023)",
            detalle:
              "Aparece en oficio de Contraloría sobre presunto direccionamiento en obras viales en Huaraz. Caso archivado por falta de pruebas concluyentes, pero el patrón documentado coincide.",
            fecha: "2023-05-17",
            fuente: {
              nombre: "Contraloría · oficios públicos",
              url: "https://www.contraloria.gob.pe/",
              fecha: "2023-05-17",
            },
            severidad: "media",
            agente: "web_research_agent",
          },
        ],
      },
      {
        dni: "70334512",
        nombre: "Sofía Mendoza Bravo",
        rol: "Apoderada",
        participacion: 20,
        flags: [],
      },
    ],
    hallazgosWeb: [
      {
        titulo: "Anuncio de adjudicación en redes sociales del distrito",
        fuente: "Facebook · Mun. Dist. Independencia",
        url: "https://www.facebook.com/",
        fecha: "2026-03-15",
        snippet:
          "Post oficial celebrando la adjudicación del mejoramiento educativo I.E. N° 86015 por S/. 2.84M. Comentarios deshabilitados.",
      },
    ],
  },

  // ─── Caraz, Áncash — score 93. ───
  "ALT-2026-0010": {
    ruc: "20614102983",
    razonSocial: "EDIFICACIONES MODERNAS HUAYLAS EIRL",
    edadRucDias: 18,
    capitalSocial: 10_000,
    domicilio: "Calle San Martín 89, Caraz",
    entidadesRelacionadas: [
      {
        id: "ent-caraz", tipo: "entidad_publica", capa: "compradora", nivel: "institucion",
        nombre: "Mun. Dist. de Caraz", detalle: "RUC 20162498770 · Huaylas",
        info: {
          fields: [
            { label: "RUC", value: "20162498770", mono: true },
            { label: "Provincia", value: "Huaylas, Áncash" },
            { label: "Capital provincial", value: "Caraz" },
          ],
        },
      },
      {
        id: "alcalde-caraz", tipo: "funcionario", capa: "compradora", nivel: "cabeza",
        nombre: "Pedro Llanos Rivera", detalle: "Alcalde Distrital de Caraz",
        info: {
          fields: [
            { label: "DNI", value: "32647819", mono: true },
            { label: "Periodo", value: "2023 — 2026" },
            { label: "Hoja de vida JNE", value: "Ver →", link: "https://plataformaelectoral.jne.gob.pe/" },
          ],
        },
      },
      {
        id: "comite-caraz", tipo: "comite", capa: "aprueban", nivel: "institucion",
        nombre: "Comité de Selección", detalle: "Convocatoria 1410023-2026",
        info: {
          fields: [
            { label: "Convocatoria", value: "1410023-2026", mono: true },
            { label: "Resultado", value: "Único postor · empresa con 18 días de RUC" },
          ],
        },
      },
      {
        id: "pdte-caraz", tipo: "funcionario", capa: "aprueban", nivel: "cabeza",
        nombre: "Walter Cárdenas Solís", detalle: "Pdte. del Comité",
        info: {
          fields: [
            { label: "DNI", value: "44128395", mono: true },
            { label: "Cargo", value: "Gerente Técnico · Mun. Caraz" },
          ],
        },
      },
      {
        id: "eirl-2", tipo: "empresa", capa: "externo",
        nombre: "Otras 3 EIRL del titular", detalle: "4 EIRL en 6 meses",
        info: {
          fields: [
            { label: "Patrón", value: "Fragmentación de identidad" },
            { label: "Cantidad", value: "4 EIRL creadas entre nov-2025 y abr-2026" },
            { label: "Capital social cada una", value: "S/. 10,000 (mínimo legal)" },
            { label: "Titular común", value: "Hugo Quispe Aranibar (DNI 44892017)" },
            { label: "Domicilios", value: "Todos distintos en provincia de Huaylas" },
          ],
          note: "Este patrón permite esquivar el tope de contratación por proveedor cuando se concentran obras en una misma región.",
        },
      },
    ],
    conexiones: [
      { from: "ent-caraz", to: "comite-caraz", tipo: "convoca", label: "convoca" },
      { from: "comite-caraz", to: "empresa", tipo: "adjudico", label: "S/. 1.49M · 18 días de RUC", severidad: "alta" },
      { from: "alcalde-caraz", to: "ent-caraz", tipo: "preside", label: "alcalde" },
      { from: "pdte-caraz", to: "comite-caraz", tipo: "preside", label: "preside" },
      { from: "44892017", to: "eirl-2", tipo: "representa", label: "titular en 4 EIRL", severidad: "alta" },
    ],
    flagsEmpresa: [
      {
        tipo: "edad_ruc",
        titulo: "Sólo 18 días de RUC al ganar S/. 1.49M",
        detalle:
          "RUC creado el 4 abr 2026. Buena pro: 22 abr 2026. Empresa unipersonal (EIRL) con capital social de S/. 10,000.",
        fuente: { nombre: "SUNAT", url: "https://apis.net.pe/" },
        severidad: "alta",
        agente: "compliance_agent",
      },
    ],
    socios: [
      {
        dni: "44892017",
        nombre: "Hugo Quispe Aranibar",
        rol: "Titular gerente único",
        participacion: 100,
        flags: [
          {
            tipo: "investigacion_periodistica",
            titulo: "Misma persona aparece como titular de 4 EIRL distintas",
            detalle:
              "Las 4 EIRL fueron creadas entre nov-2025 y abr-2026, todas en domicilios distintos de la provincia de Huaylas. Todas con capital mínimo. Patrón clásico de fragmentación de identidad para esquivar topes de contratación.",
            fecha: "2026-04-15",
            fuente: {
              nombre: "SUNARP · Directorio Personas Jurídicas",
              url: "https://www.sunarp.gob.pe/",
              fecha: "2026-04-15",
            },
            severidad: "alta",
            agente: "network_agent",
          },
        ],
      },
    ],
    hallazgosWeb: [
      {
        titulo: "Nota en medio local — adjudicación cuestionada",
        fuente: "Diario Áncash Noticias",
        url: "https://ancash.noticias.pe/",
        fecha: "2026-04-25",
        snippet:
          "Tres días después de la firma, un medio local publica una nota cuestionando que la empresa ganadora 'recién se haya creado este mes'.",
      },
    ],
  },
};

export function getNetworkForAlerta(alertaId: string): EmpresaNetwork | null {
  return NETWORK_BY_ALERTA[alertaId] ?? null;
}

// ─── Fuentes consultadas (catálogo del proyecto) ─────────────────────────

export type FuenteCategoria =
  | "empresas"
  | "personas"
  | "politica"
  | "sanciones"
  | "justicia"
  | "funcionarios"
  | "obras"
  | "contratos"
  | "prensa";

export type FuenteEstado =
  | "coincidencia"
  | "sin_coincidencias"
  | "pendiente"
  | "error";

export interface FuenteRef {
  id: string;
  nombre: string;
  agente: NetworkFlag["agente"];
  categoria: FuenteCategoria;
  url: string;
}

export const FUENTES_CATALOGO: FuenteRef[] = [
  { id: "sunat", nombre: "SUNAT — Consulta RUC", agente: "compliance_agent", categoria: "empresas", url: "https://e-consultaruc.sunat.gob.pe/" },
  { id: "sunarp", nombre: "SUNARP — Personas Jurídicas", agente: "network_agent", categoria: "personas", url: "https://www.sunarp.gob.pe/" },
  { id: "rnp", nombre: "OSCE — Registro Nacional Proveedores", agente: "network_agent", categoria: "personas", url: "https://www.gob.pe/oece" },
  { id: "osce-inhab", nombre: "OSCE — Inhabilitados", agente: "compliance_agent", categoria: "sanciones", url: "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml" },
  { id: "oefa", nombre: "OEFA — Infractores ambientales", agente: "compliance_agent", categoria: "sanciones", url: "https://www.oefa.gob.pe/" },
  { id: "onpe", nombre: "ONPE — Portal Claridad", agente: "web_research_agent", categoria: "politica", url: "https://claridadportal.onpe.gob.pe/" },
  { id: "jne", nombre: "JNE — Plataforma Electoral", agente: "web_research_agent", categoria: "politica", url: "https://plataformaelectoral.jne.gob.pe/" },
  { id: "pide-dji", nombre: "PIDE — Declaración Jurada Intereses", agente: "web_research_agent", categoria: "funcionarios", url: "https://dji.pide.gob.pe/consultas-dji/" },
  { id: "djbr", nombre: "Contraloría — DJ Bienes y Rentas", agente: "web_research_agent", categoria: "funcionarios", url: "https://apps1.contraloria.gob.pe/ddjj/" },
  { id: "pj-cej", nombre: "Poder Judicial — CEJ", agente: "web_research_agent", categoria: "justicia", url: "https://cej.pj.gob.pe/cej/forms/busquedaform.html" },
  { id: "mp", nombre: "Ministerio Público", agente: "web_research_agent", categoria: "justicia", url: "https://www.mpfn.gob.pe/" },
  { id: "el-peruano", nombre: "El Peruano — Normas Legales", agente: "web_research_agent", categoria: "funcionarios", url: "https://busquedas.elperuano.pe/" },
  { id: "infobras", nombre: "INFOBRAS — Contraloría", agente: "compliance_agent", categoria: "obras", url: "https://apps.contraloria.gob.pe/ciudadano/" },
  { id: "oece-ocds", nombre: "OECE — Contrataciones Abiertas", agente: "compliance_agent", categoria: "contratos", url: "https://contratacionesabiertas.oece.gob.pe/" },
];

export const CATEGORIA_LABEL: Record<FuenteCategoria, string> = {
  empresas: "Empresas",
  personas: "Personas",
  politica: "Política",
  sanciones: "Sanciones",
  justicia: "Justicia",
  funcionarios: "Funcionarios",
  obras: "Obras",
  contratos: "Contratos",
  prensa: "Prensa",
};

/** Devuelve, para una red dada, el estado consultado de cada fuente del catálogo. */
export function fuentesConsultadasFor(
  net: EmpresaNetwork | null,
): Array<FuenteRef & { estado: FuenteEstado; hallazgos: number }> {
  // Sin red: todo pendiente
  if (!net) {
    return FUENTES_CATALOGO.map((f) => ({ ...f, estado: "pendiente", hallazgos: 0 }));
  }
  // Mapa fuente.nombre → count, derivado de los flags
  const hitsByName: Record<string, number> = {};
  const allFlags = [
    ...net.flagsEmpresa,
    ...net.socios.flatMap((s) => s.flags),
  ];
  for (const f of allFlags) {
    const nm = f.fuente.nombre.toLowerCase();
    hitsByName[nm] = (hitsByName[nm] || 0) + 1;
  }
  return FUENTES_CATALOGO.map((f) => {
    // Match aprox: la fuente del catálogo aparece en alguna fuente.nombre de los flags
    const tag = f.nombre.split("—")[0].trim().toLowerCase();
    const hallazgos = Object.entries(hitsByName)
      .filter(([k]) => k.includes(tag.split(" ")[0].toLowerCase()))
      .reduce((s, [, v]) => s + v, 0);
    return {
      ...f,
      estado: hallazgos > 0 ? "coincidencia" : "sin_coincidencias",
      hallazgos,
    };
  });
}

// ─── Timeline de eventos ─────────────────────────────────────────────────

export interface EventoTimeline {
  fecha: string;            // ISO o yyyy-mm-dd
  titulo: string;
  descripcion?: string;
  fuente?: { nombre: string; url?: string };
  tipo:
    | "ruc_alta"
    | "buena_pro"
    | "sancion"
    | "aporte_politico"
    | "designacion"
    | "dji"
    | "investigacion"
    | "contratacion"
    | "otro";
  severidad?: FlagSeveridad;
}

const FLAG_TIPO_TO_EVENTO: Record<FlagTipo, EventoTimeline["tipo"]> = {
  sancion: "sancion",
  condena: "sancion",
  inhabilitacion: "sancion",
  aporte_politico: "aporte_politico",
  familiar_funcionario: "dji",
  investigacion_periodistica: "investigacion",
  edad_ruc: "ruc_alta",
  domicilio_compartido: "otro",
  rotacion_funcionario: "designacion",
};

export interface AlertaContext {
  fechaBuenaPro: string;
  monto: number;
  proveedor: string;
}

/** Construye los eventos chronológicos de la red + contexto del contrato. */
export function eventosTimelineFor(
  net: EmpresaNetwork | null,
  ctx: AlertaContext,
): EventoTimeline[] {
  const eventos: EventoTimeline[] = [];

  if (net) {
    for (const f of net.flagsEmpresa) {
      if (f.fecha) {
        eventos.push({
          fecha: f.fecha,
          titulo: f.titulo,
          descripcion: f.detalle,
          fuente: { nombre: f.fuente.nombre, url: f.fuente.url },
          tipo: FLAG_TIPO_TO_EVENTO[f.tipo] ?? "otro",
          severidad: f.severidad,
        });
      }
    }
    for (const p of net.socios) {
      for (const f of p.flags) {
        if (f.fecha) {
          eventos.push({
            fecha: f.fecha,
            titulo: `${p.nombre}: ${f.titulo}`,
            descripcion: f.detalle,
            fuente: { nombre: f.fuente.nombre, url: f.fuente.url },
            tipo: FLAG_TIPO_TO_EVENTO[f.tipo] ?? "otro",
            severidad: f.severidad,
          });
        }
      }
    }
  }

  // Buena pro siempre presente
  eventos.push({
    fecha: ctx.fechaBuenaPro,
    titulo: "Buena pro del contrato",
    descripcion: `Adjudicado por S/. ${ctx.monto.toLocaleString("es-PE")} a ${ctx.proveedor}.`,
    fuente: { nombre: "OECE Contrataciones Abiertas", url: "https://contratacionesabiertas.oece.gob.pe/" },
    tipo: "buena_pro",
    severidad: "alta",
  });

  return eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}


export const FLAG_META: Record<
  FlagTipo,
  { label: string; icon: string; tone: "rust" | "amber" | "clay" | "mute" }
> = {
  sancion: { label: "Sanción administrativa", icon: "🛑", tone: "rust" },
  condena: { label: "Condena penal", icon: "⚖️", tone: "rust" },
  inhabilitacion: { label: "Inhabilitación vigente", icon: "🚫", tone: "rust" },
  aporte_politico: { label: "Aporte político", icon: "🪙", tone: "rust" },
  familiar_funcionario: { label: "Familiar de funcionario", icon: "👥", tone: "rust" },
  investigacion_periodistica: { label: "Investigación periodística", icon: "📰", tone: "amber" },
  edad_ruc: { label: "Edad RUC sospechosa", icon: "🆕", tone: "amber" },
  domicilio_compartido: { label: "Domicilio compartido", icon: "🏚️", tone: "amber" },
  rotacion_funcionario: { label: "Rotación funcionario↔proveedor", icon: "🔄", tone: "amber" },
};

export const AGENTE_LABEL: Record<NetworkFlag["agente"], string> = {
  compliance_agent: "compliance_agent",
  network_agent: "network_agent",
  web_research_agent: "web_research_agent",
};
