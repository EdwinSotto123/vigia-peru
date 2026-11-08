import type { Plan } from "@/components/gobserva/Planes";
import { rutaEn } from "@/lib/gobserva";
import { entero, precioDe, precioHoy, type PlanesServidor } from "@/lib/gobserva-planes";

/**
 * Los planes de Gobserva Licitaciones, la plataforma para quien le vende al Estado (2026-11-07): las licitaciones del
 * SEACE, los contratos menores abiertos y las obras que se vienen (Gobserva Obras viene incluido), con el precio y los
 * límites del catálogo de la API (los cambia el panel). Lo que ya funciona va en `incluye`; lo que todavía no, en
 * `pronto`: nunca se promete lo que no está hecho. Gratis crea la cuenta; Inicia, Crece y Pro van al pago; Institucional
 * se conversa.
 */
export function planesLicitaciones(base: string, cat: PlanesServidor): Plan[] {
  const inicia = cat.planes.find((p) => p.id === "inicia");
  const crece = cat.planes.find((p) => p.id === "crece");
  const pro = cat.planes.find((p) => p.id === "pro");
  const g = cat.gratis;
  const alertas = (n: number) => (n === 1 ? "1 alerta" : `${entero(n)} alertas`);
  const planes: Plan[] = [
    {
      id: "gratis",
      nombre: "Gratis",
      para: "Para conocer el mercado y decidir dónde competir.",
      precio: "S/ 0",
      incluye: [
        "Las convocatorias del SEACE de los últimos 60 días, con filtros",
        "Los contratos menores (hasta 8 UIT) abiertos para cotizar, con su requerimiento",
        "Las obras que se vienen: proyectos viables de Invierte.pe que todavía no se licitan",
        "La ficha de cada una: ítems, bases, la entidad en 12 meses y lo que se pagó antes",
        // Mientras los correos no salen (catálogo: correoActivo), lo nuevo queda en la cuenta: no se promete el correo.
        `${alertas(g.alertas)} cada semana, ${cat.correoActivo ? "por correo" : "en tu cuenta"} y en tu celular`,
        `Guarda hasta ${entero(g.guardados)} procesos, con recordatorio antes de que cierren las consultas`,
      ],
      accion: { href: rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/oportunidades")}`), etiqueta: "Crear mi cuenta gratis" },
    },
  ];
  if (inicia) {
    planes.push({
      id: "inicia",
      nombre: inicia.nombre,
      para: "Para la empresa que empieza a venderle al Estado.",
      ...precioDe(inicia),
      incluye: [
        "Todo lo del plan Gratis",
        `${alertas(inicia.limites.alertas)} cada mañana, de licitaciones o de obras, por rubro, región y monto`,
        `Guarda hasta ${entero(inicia.limites.guardados)} procesos y marca si preparas, presentaste o ganaste`,
        `Descarga en Excel (CSV) de cualquier búsqueda, hasta ${entero(inicia.limites.filasCsv)} filas`,
        "Tu MCP: pregúntale a Claude, ChatGPT o Cursor por licitaciones, obras y tu mercado",
      ],
      pronto: ["Alertas de contratos menores apenas se publican"],
      accion: { href: rutaEn(base, "/checkout?plan=inicia"), etiqueta: `Empezar por ${precioHoy(inicia)}` },
    });
  }
  if (crece) {
    planes.push({
      id: "crece",
      nombre: crece.nombre,
      para: "Para la empresa que le vende al Estado todos los meses.",
      ...precioDe(crece),
      destacado: true,
      incluye: [
        "Todo lo del plan Inicia",
        `${alertas(crece.limites.alertas)}: una por rubro, región o línea de negocio`,
        `Guarda hasta ${entero(crece.limites.guardados)} procesos`,
        `Descargas de hasta ${entero(crece.limites.filasCsv)} filas`,
      ],
      pronto: [
        "Oportunidades del día ordenadas según el perfil de tu empresa",
        "Resumen de las bases con IA: requisitos y riesgo de descalificación",
        "Ficha de cada competidor y de cada comprador",
      ],
      accion: { href: rutaEn(base, "/checkout?plan=crece"), etiqueta: `Empezar por ${precioHoy(crece)}` },
    });
  }
  if (pro) {
    planes.push({
      id: "pro",
      nombre: pro.nombre,
      para: "Para equipos comerciales y consultoras.",
      ...precioDe(pro),
      incluye: [
        "Todo lo del plan Crece",
        `${alertas(pro.limites.alertas)}`,
        `Guarda hasta ${entero(pro.limites.guardados)} procesos`,
        `Descargas de hasta ${entero(pro.limites.filasCsv)} filas`,
      ],
      pronto: ["Hasta 3 usuarios con sus negocios por etapas", "IA sin límite", "API para conectar tu CRM o tu Excel"],
      accion: { href: rutaEn(base, "/checkout?plan=pro"), etiqueta: `Empezar por ${precioHoy(pro)}` },
    });
  }
  planes.push({
    id: "institucional",
    nombre: "Institucional",
    para: "Gremios, cámaras de comercio, medios y grandes cuentas.",
    precio: "A medida",
    incluye: ["MCP para todo tu equipo: pregúntale a Claude, ChatGPT o Cursor"],
    pronto: ["MCP con límites altos y soporte", "API completa con todo el histórico", "Reportes por sector y región"],
    accion: { href: "mailto:hello@gobserva.cloud?subject=Gobserva%20Licitaciones%20institucional", etiqueta: "Conversemos" },
  });
  return planes;
}
