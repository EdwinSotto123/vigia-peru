/**
 * Las consultas oficiales por placa (Gobserva Car, 2026-11-22). Todas piden captcha o una verificación de persona: no se
 * leen de forma automática; se enlazan con la placa lista para copiar. Direcciones probadas el 2026-11-22 (dos antiguas
 * cambiaron: la de revisión técnica del MTC y la de ATU). Sin JSX: lo usan la página de la placa y la de fuentes.
 */
import type { NombreSprite } from "@/components/pixel/sprites";

export type Momento = "comprar" | "subir";

export interface ConsultaPlaca {
  clave: string;
  /** La pregunta que responde, como la haría cualquiera. */
  pregunta: string;
  /** Quién la publica. */
  fuente: string;
  url: string;
  /** Qué vas a ver allá. */
  devuelve: string;
  /** Lo que pide antes de responder. */
  pide: string;
  /** Si sirve para comprar un auto, para subirse a uno o para ambos. */
  para: Momento[];
  sprite: NombreSprite;
}

export const CONSULTAS: ConsultaPlaca[] = [
  {
    clave: "sunarp",
    pregunta: "¿De quién es y tiene alerta de robo?",
    fuente: "SUNARP, Consulta Vehicular",
    url: "https://consultavehicular.sunarp.gob.pe/consulta-vehicular/inicio",
    devuelve: "Los datos del registro del vehículo y si tiene un aviso de «Alerta Robo».",
    pide: "Captcha. Gratis.",
    para: ["comprar"],
    sprite: "documento",
  },
  {
    clave: "soat",
    pregunta: "¿Tiene SOAT vigente?",
    fuente: "APESEG, consulta de SOAT",
    url: "https://www.apeseg.org.pe/consultas-soat/",
    devuelve: "Si el SOAT está vigente, de qué aseguradora y hasta cuándo.",
    pide: "Verificación de persona. Gratis.",
    para: ["comprar", "subir"],
    sprite: "escudoCheck",
  },
  {
    clave: "revision",
    pregunta: "¿Pasó la revisión técnica?",
    fuente: "MTC, revisión técnica por placa",
    url: "https://rec.mtc.gob.pe/Citv/ArConsultaCitv",
    devuelve: "Si la revisión técnica está vigente, su resultado y el centro que la hizo.",
    pide: "Captcha. Gratis.",
    para: ["comprar", "subir"],
    sprite: "chequeo",
  },
  {
    clave: "sat-lima",
    pregunta: "¿Tiene papeletas o deudas en Lima?",
    fuente: "SAT de Lima",
    url: "https://www.sat.gob.pe/pagosenlinea/",
    devuelve: "Las papeletas y deudas del vehículo en Lima Metropolitana.",
    pide: "Captcha. Gratis.",
    para: ["comprar"],
    sprite: "iconoCaja",
  },
  {
    clave: "sat-captura",
    pregunta: "¿Tiene orden de captura en Lima?",
    fuente: "SAT de Lima, órdenes de captura",
    url: "https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx",
    devuelve: "Si el vehículo tiene una orden de captura por deudas en Lima.",
    pide: "Captcha. Gratis.",
    para: ["comprar"],
    sprite: "cono",
  },
  {
    clave: "sat-callao",
    pregunta: "¿Tiene papeletas en el Callao?",
    fuente: "SAT del Callao",
    url: "https://pagopapeletascallao.pe/",
    devuelve: "Las papeletas del vehículo en el Callao.",
    pide: "Captcha. Gratis.",
    para: ["comprar"],
    sprite: "iconoCaja",
  },
  {
    clave: "sutran",
    pregunta: "¿Tiene infracciones en las carreteras?",
    fuente: "SUTRAN, récord de infracciones",
    url: "https://www.sutran.gob.pe/consultas/record-de-infracciones/record-de-infracciones/",
    devuelve: "Las infracciones del vehículo en la red vial nacional.",
    pide: "Captcha. Gratis.",
    para: ["comprar"],
    sprite: "camion",
  },
  {
    clave: "atu",
    pregunta: "Si es taxi o transporte en Lima y Callao: ¿está autorizado?",
    fuente: "ATU, consulta de vehículos",
    url: "https://soluciones.atu.gob.pe/ConsultaVehiculo",
    devuelve: "Si el vehículo está autorizado para dar servicio de transporte en Lima y Callao.",
    pide: "Captcha. Gratis.",
    para: ["subir"],
    sprite: "auto",
  },
  {
    clave: "sutran-viaje",
    pregunta: "Si viajas en bus: ¿el bus tiene sus documentos?",
    fuente: "SUTRAN, bus y conductor de tu viaje",
    url: "https://www.sutran.gob.pe/informacion-del-conductor-y-bus-de-tu-viaje/",
    devuelve: "Los documentos del bus por su placa (y los del conductor por su DNI).",
    pide: "Captcha. Gratis.",
    para: ["subir"],
    sprite: "camion",
  },
];

/** «abc-123», «A1B 234» → «ABC123»; null si no parece una placa peruana (5 a 7 letras y números, con al menos un número). */
export function placaDe(texto: string | null | undefined): string | null {
  const p = (texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5,7}$/.test(p) && /\d/.test(p) ? p : null;
}

/** «ABC123» → «ABC-123» (las de 6: tres y tres; las demás, tal cual). */
export const placaLegible = (p: string) => (p.length === 6 ? `${p.slice(0, 3)}-${p.slice(3)}` : p);
