import type { Plan } from "@/components/gobserva/Planes";
import { rutaEn } from "@/lib/gobserva";
import { entero, precioCorto, precioDe, precioHoy, type PlanesServidor } from "@/lib/gobserva-planes";

/**
 * Los planes de Gobserva Licitaciones (2026-11-01), con el precio y los límites del catálogo de la API (los cambia el
 * panel). Lo que ya funciona va en `incluye`; lo que todavía no, en `pronto`. Gratis crea la cuenta; Pro y Empresa van al
 * pago; Institucional se conversa.
 */
export function planesLicitaciones(base: string, cat: PlanesServidor): Plan[] {
  const pro = cat.planes.find((p) => p.id === "pro");
  const empresa = cat.planes.find((p) => p.id === "empresa");
  const g = cat.gratis;
  const planes: Plan[] = [
    {
      id: "gratis",
      nombre: "Gratis",
      para: "Para conocer el mercado y decidir dónde competir.",
      precio: "S/ 0",
      incluye: [
        "Todas las convocatorias de los últimos 60 días, con filtros",
        "La ficha de cada una: ítems con su CUBSO y las bases para descargar",
        "La entidad en 12 meses y procesos parecidos con sus precios",
        "El tamaño del mercado de cualquier rubro",
        `${g.alertas === 1 ? "1 alerta" : `${g.alertas} alertas`} cada semana, por correo y en tu celular`,
        `Guarda hasta ${entero(g.guardados)} procesos, con recordatorio antes de que cierren las consultas`,
      ],
      accion: { href: rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/oportunidades")}`), etiqueta: "Crear mi cuenta gratis" },
    },
  ];
  if (pro) {
    planes.push({
      id: "pro",
      nombre: pro.nombre,
      para: "Para la empresa que le vende al Estado todos los meses.",
      ...precioDe(pro),
      destacado: true,
      incluye: [
        "Todo lo del plan Gratis",
        `Hasta ${pro.limites.alertas} alertas cada mañana, por rubro, región y monto`,
        `Guarda hasta ${entero(pro.limites.guardados)} procesos y marca si preparas, presentaste o ganaste`,
        `Descarga en Excel (CSV) de cualquier búsqueda, hasta ${entero(pro.limites.filasCsv)} filas`,
      ],
      pronto: ["Histórico desde 2015"],
      accion: { href: rutaEn(base, "/checkout?plan=pro"), etiqueta: `Empezar por ${precioHoy(pro)}` },
    });
  }
  if (empresa) {
    planes.push({
      id: "empresa",
      nombre: empresa.nombre,
      para: "Para equipos comerciales y consultoras.",
      precio: precioCorto(empresa.precio),
      periodo: "al mes",
      incluye: [
        "Todo lo del plan Pro",
        `Hasta ${empresa.limites.alertas} alertas: una por rubro, región o vendedor`,
        `Guarda hasta ${entero(empresa.limites.guardados)} procesos`,
        `Descargas de hasta ${entero(empresa.limites.filasCsv)} filas`,
      ],
      pronto: ["Hasta 5 usuarios", "API para conectar tu CRM o tu Excel", "Reporte mensual de tu mercado"],
      accion: { href: rutaEn(base, "/checkout?plan=empresa"), etiqueta: "Contratar Empresa" },
    });
  }
  planes.push({
    id: "institucional",
    nombre: "Institucional y MCP",
    para: "Gremios, cámaras de comercio, medios y grandes cuentas.",
    precio: "A medida",
    incluye: ["MCP gratis durante la beta: pregúntale a Claude, ChatGPT o Cursor"],
    pronto: ["MCP con límites altos y soporte", "API completa con todo el histórico", "Reportes por sector y región"],
    accion: { href: "mailto:hello@gobserva.cloud?subject=Gobserva%20Licitaciones%20institucional", etiqueta: "Conversemos" },
  });
  return planes;
}
