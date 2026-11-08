import type { Plan } from "@/components/gobserva/Planes";
import { canalAlertas } from "@/lib/empleo";
import { rutaEn } from "@/lib/gobserva";
import { entero, precioCorto, precioDe, precioHoy, type PlanesServidor } from "@/lib/gobserva-planes";

/**
 * Los planes de Gobserva Empleo (la portada y /planes los muestran igual): buscar es gratis y trae una alerta semanal;
 * Alertas, con precio de fundador, las manda cada mañana y baja las búsquedas en Excel; y el plan para bolsas de trabajo
 * e institutos. Precios y límites del catálogo de la API (los cambia el panel); lo que todavía no funciona va en `pronto`;
 * el correo, sólo si ya sale (`correoActivo`). Crear la cuenta lleva a la entrevista (el onboarding).
 */
export function planesEmpleo(base: string, cat: PlanesServidor): Plan[] {
  const alertas = cat.planes.find((p) => p.id === "alertas");
  const inst = cat.planes.find((p) => p.id === "institucional");
  const pagar = (id: string) => rutaEn(base, `/checkout?plan=${id}`);
  const g = cat.gratis;
  const planes: Plan[] = [
    {
      id: "gratis",
      nombre: "Gratis",
      para: "Para buscar y postular hoy.",
      precio: "S/ 0",
      periodo: "siempre",
      incluye: [
        "Todas las plazas CAS abiertas del país, con filtros",
        "«Para ti»: las que calzan con tu perfil, de las que cierran primero a las últimas",
        "Fichas con requisitos, «¿Cumples?» y lo que pagan otras entidades por el mismo puesto",
        `${g.alertas === 1 ? "1 alerta" : `${g.alertas} alertas`} cada semana, ${canalAlertas(cat.correoActivo)}`,
        `Guarda hasta ${entero(g.guardados)} plazas y lleva tus postulaciones en un tablero`,
        "Recordatorio 2 días antes de que cierre una plaza guardada",
      ],
      accion: { href: rutaEn(base, "/entrar?crear=1"), etiqueta: "Crear mi cuenta gratis" },
    },
  ];
  if (alertas) {
    planes.push({
      id: "alertas",
      nombre: alertas.nombre,
      para: "Para no perderte ninguna plaza que calce contigo.",
      ...precioDe(alertas),
      destacado: true,
      incluye: [
        "Todo lo del plan gratis",
        `Hasta ${alertas.limites.alertas} alertas, cada mañana o cada semana`,
        `Guarda hasta ${entero(alertas.limites.guardados)} plazas`,
        `Descarga tus búsquedas en Excel, hasta ${entero(alertas.limites.filasCsv)} filas`,
      ],
      pronto: ["Historial de lo que pagaba cada puesto"],
      accion: { href: pagar("alertas"), etiqueta: `Empezar por ${precioHoy(alertas)}` },
    });
  }
  if (inst) {
    planes.push({
      id: "institucional",
      nombre: inst.nombre,
      para: "Para universidades, institutos, colegios profesionales y bolsas de empleo.",
      precio: precioCorto(inst.precio),
      periodo: "al mes",
      incluye: [
        "Todo lo del plan Alertas",
        `Hasta ${inst.limites.alertas} alertas, una por carrera o por región`,
        `Descargas de hasta ${entero(inst.limites.filasCsv)} filas`,
      ],
      pronto: [
        "API con todas las plazas y sus requisitos",
        "MCP con más consultas para tu equipo",
        "Widget de plazas para tu web, con tu marca",
        "Reporte mensual de lo que pide el Estado por carrera",
      ],
      accion: { href: pagar("institucional"), etiqueta: "Contratar el plan" },
    });
  }
  return planes;
}
