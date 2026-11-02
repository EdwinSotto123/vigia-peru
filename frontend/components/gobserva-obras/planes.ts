import type { Plan } from "@/components/gobserva/Planes";
import { rutaEn } from "@/lib/gobserva";
import { entero, precioCorto, precioDe, precioHoy, type PlanesServidor } from "@/lib/gobserva-planes";

/**
 * Los planes de Gobserva Obras (2026-11-01), con el precio y los límites del catálogo de la API (los cambia el panel),
 * con la misma forma que los de Licitaciones (components/licitaciones/planes.ts). Lo que ya funciona va en `incluye`; lo
 * que todavía no, en `pronto`. Gratis crea la cuenta; Pro y Empresa van al pago; Institucional se conversa.
 */
export function planesObras(base: string, cat: PlanesServidor): Plan[] {
  const pro = cat.planes.find((p) => p.id === "pro");
  const empresa = cat.planes.find((p) => p.id === "empresa");
  const g = cat.gratis;
  const planes: Plan[] = [
    {
      id: "gratis",
      nombre: "Gratis",
      para: "Para conocer el pipeline de obras y decidir dónde competir.",
      precio: "S/ 0",
      incluye: [
        "Los proyectos que se vienen, los que están en marcha y los paralizados, con filtros",
        "La ficha de cada proyecto: montos, fase, avance de la obra y procesos del SEACE",
        "El mercado de obras de cada región y sector, y quién las gana",
        // Mientras los correos no salen (el panel lo dice en `correoActivo`), lo nuevo llega a la cuenta: no se promete el correo.
        `${g.alertas === 1 ? "1 alerta" : `${g.alertas} alertas`} cada semana, ${cat.correoActivo ? "por correo y en tu celular" : "en tu cuenta y en tu celular"}`,
        `Guarda hasta ${entero(g.guardados)} proyectos para seguirlos`,
      ],
      accion: { href: rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/proyectos")}`), etiqueta: "Crear mi cuenta gratis" },
    },
  ];
  if (pro) {
    planes.push({
      id: "pro",
      nombre: pro.nombre,
      para: "Para la constructora, la consultora o el proveedor que vende a obras públicas.",
      ...precioDe(pro),
      destacado: true,
      incluye: [
        "Todo lo del plan Gratis",
        `Hasta ${pro.limites.alertas} alertas cada mañana: los proyectos nuevos y los que cambian de fase`,
        `Guarda hasta ${entero(pro.limites.guardados)} proyectos y sigue cuándo se licitan o se paralizan`,
        `Descarga en Excel (CSV) de cualquier búsqueda, hasta ${entero(pro.limites.filasCsv)} filas`,
      ],
      pronto: ["Histórico de avance de cada obra"],
      accion: { href: rutaEn(base, "/checkout?plan=pro"), etiqueta: `Empezar por ${precioHoy(pro)}` },
    });
  }
  if (empresa) {
    planes.push({
      id: "empresa",
      nombre: empresa.nombre,
      para: "Para equipos comerciales y de licitaciones.",
      precio: precioCorto(empresa.precio),
      periodo: "al mes",
      incluye: [
        "Todo lo del plan Pro",
        `Hasta ${empresa.limites.alertas} alertas: una por región, sector o vendedor`,
        `Guarda hasta ${entero(empresa.limites.guardados)} proyectos`,
        `Descargas de hasta ${entero(empresa.limites.filasCsv)} filas`,
      ],
      pronto: ["Hasta 5 usuarios", "API para conectar tu CRM o tu Excel", "Reporte mensual de tu mercado de obras"],
      accion: { href: rutaEn(base, "/checkout?plan=empresa"), etiqueta: "Contratar Empresa" },
    });
  }
  planes.push({
    id: "institucional",
    nombre: "Institucional y MCP",
    para: "Gremios de la construcción, colegios profesionales, medios y grandes cuentas.",
    precio: "A medida",
    incluye: ["MCP gratis durante la beta: pregúntale a Claude, ChatGPT o Cursor"],
    pronto: ["MCP con límites altos y soporte", "API completa con todo el histórico", "Reportes por región y sector"],
    accion: { href: "mailto:hello@gobserva.cloud?subject=Gobserva%20Obras%20institucional", etiqueta: "Conversemos" },
  });
  return planes;
}
