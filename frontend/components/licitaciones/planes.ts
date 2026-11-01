import type { Plan } from "@/components/gobserva/Planes";
import type { OpcionPlan } from "@/components/gobserva/Suscribirse";
import { rutaEn } from "@/lib/gobserva";

/**
 * Los planes de Gobserva Licitaciones (2026-11-01, lista de espera con precio de fundador). Lo que ya funciona va en
 * `incluye`; lo que llega con el lanzamiento, en `pronto`. Durante la beta todo lo que se ve en la web es gratis.
 */
export function planesLicitaciones(base: string): Plan[] {
  const unete = (plan: string) => rutaEn(base, `/planes?plan=${plan}#unete`);
  return [
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
      ],
      accion: { href: rutaEn(base, "/oportunidades"), etiqueta: "Buscar oportunidades" },
    },
    {
      id: "pro",
      nombre: "Pro",
      para: "Para la empresa que le vende al Estado todos los meses.",
      precio: "S/ 39",
      periodo: "al mes",
      antes: "S/ 79",
      nota: "Precio de fundador para las primeras 50 empresas",
      destacado: true,
      incluye: ["Todo lo del plan Gratis", "Inteligencia completa de cada entidad y de tus competidores"],
      pronto: ["Alertas cada mañana por correo y WhatsApp, por rubro y región", "Descarga en Excel (CSV) de cualquier búsqueda", "Histórico desde 2015"],
      accion: { href: unete("pro"), etiqueta: "Reservar precio de fundador" },
    },
    {
      id: "empresa",
      nombre: "Empresa",
      para: "Para equipos comerciales y consultoras.",
      precio: "S/ 149",
      periodo: "al mes",
      incluye: ["Todo lo del plan Pro"],
      pronto: ["Hasta 5 usuarios", "Rubros y regiones sin límite", "API para conectar tu CRM o tu Excel", "Reporte mensual de tu mercado"],
      accion: { href: unete("empresa"), etiqueta: "Reservar mi lugar" },
    },
    {
      id: "institucional",
      nombre: "Institucional y MCP",
      para: "Gremios, cámaras de comercio, medios y grandes cuentas.",
      precio: "A medida",
      incluye: ["MCP gratis durante la beta: pregúntale a Claude, ChatGPT o Cursor"],
      pronto: ["MCP con límites altos y soporte", "API completa con todo el histórico", "Reportes por sector y región"],
      accion: { href: unete("institucional"), etiqueta: "Conversemos" },
    },
  ];
}

/** Las mismas opciones, para el formulario de la lista de espera. */
export const OPCIONES_PLAN_LICITACIONES: OpcionPlan[] = [
  { id: "pro", nombre: "Pro", detalle: "S/ 39 al mes (precio de fundador; luego S/ 79)" },
  { id: "empresa", nombre: "Empresa", detalle: "S/ 149 al mes, hasta 5 usuarios y API" },
  { id: "institucional", nombre: "Institucional y MCP", detalle: "A medida: MCP, API y reportes" },
  { id: "gratis", nombre: "Sólo avísenme", detalle: "Gratis: te escribimos cuando abramos" },
];
