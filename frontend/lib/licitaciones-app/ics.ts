/**
 * Un archivo .ics (Google Calendar, Outlook, el calendario del celular) con los plazos de un proceso, cada uno con un
 * aviso un día antes. Una fecha sin hora es un evento de día entero (el día de Lima); con hora, se escribe en UTC.
 */
export interface EventoIcs {
  uid: string;
  titulo: string;
  fecha: string;
  descripcion?: string;
  url?: string;
}

const escapar = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dia = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const siguiente = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

/** Las líneas de más de 75 octetos se doblan (RFC 5545): una línea siguiente empieza con un espacio. */
function doblar(linea: string): string {
  const partes: string[] = [];
  let resto = linea;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = ` ${resto.slice(74)}`;
  }
  partes.push(resto);
  return partes.join("\r\n");
}

export function crearIcs(eventos: EventoIcs[], creado: Date = new Date()): string {
  const l = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gobserva//Licitaciones//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of eventos) {
    const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(e.fecha);
    l.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@licitaciones.gobserva.cloud`,
      `DTSTAMP:${utc(creado)}`,
      ...(soloDia ? [`DTSTART;VALUE=DATE:${dia(e.fecha)}`, `DTEND;VALUE=DATE:${siguiente(e.fecha)}`] : [`DTSTART:${utc(new Date(e.fecha))}`]),
      `SUMMARY:${escapar(e.titulo)}`,
      ...(e.descripcion ? [`DESCRIPTION:${escapar(e.descripcion)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapar(e.titulo)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  l.push("END:VCALENDAR");
  return l.map(doblar).join("\r\n") + "\r\n";
}
