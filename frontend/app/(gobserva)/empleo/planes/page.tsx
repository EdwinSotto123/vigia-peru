import type { Metadata } from "next";
import { BellRing, Building, GraduationCap } from "lucide-react";
import { AvisoPlanes, ComoFunciona } from "@/components/gobserva/ComoFunciona";
import { Planes, type Plan } from "@/components/gobserva/Planes";
import { Preguntas } from "@/components/empleo/Piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { entero, planesServidor, precioCorto, precioDe, precioHoy } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Planes y alertas",
  description: "Gobserva Empleo es gratis para buscar plazas CAS. Con el plan Alertas te llegan cada mañana las plazas nuevas que buscas, desde S/ 4.90 al mes.",
  alternates: { canonical: urlCanonica("empleo", "/planes") },
};

/**
 * Los planes de Gobserva Empleo (2026-11-01): buscar es gratis y trae una alerta semanal; Alertas, con precio de fundador,
 * las manda cada mañana y baja las búsquedas en Excel; y el plan para bolsas de trabajo e institutos. Los precios y los
 * límites salen del catálogo de la API (los cambia el panel); lo que todavía no funciona va marcado «Pronto».
 */
export default async function PlanesEmpleo() {
  const base = baseProducto("empleo");
  const cat = await planesServidor("empleo");
  const alertas = cat.planes.find((p) => p.id === "alertas");
  const inst = cat.planes.find((p) => p.id === "institucional");
  const crear = rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/plazas")}`);
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
        "Fichas con requisitos y «¿Cumples?»",
        "Lo que pagan otras entidades por el mismo puesto",
        `${g.alertas === 1 ? "1 alerta" : `${g.alertas} alertas`} cada semana, por correo y en tu celular`,
        `Guarda hasta ${entero(g.guardados)} plazas y sigue tus postulaciones`,
        "Recordatorio 2 días antes de que cierre una plaza guardada",
        "Consultas por MCP desde tu asistente de IA (beta)",
      ],
      accion: { href: crear, etiqueta: "Crear mi cuenta gratis" },
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

  return (
    <div className="container-page space-y-16 py-10 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Buscar es gratis. Que te avisen, casi.</h1>
        <p className="mt-4 text-pretty text-bloque leading-relaxed text-inkSoft">
          Todas las plazas CAS del Perú, con sus requisitos y lo que nadie te dice, son gratis y lo seguirán siendo. Con tu cuenta gratis te avisamos
          una vez por semana; con Alertas, cada mañana, para que postules antes que nadie.
        </p>
        <AvisoPlanes texto={cat.aviso} className="mt-5" />
      </header>

      <Planes planes={planes} />

      <ComoFunciona
        cat={cat}
        pasos={[
          { titulo: "Crea tu cuenta", texto: "Con Google o con tu correo, gratis y en un minuto." },
          { titulo: "Guarda tu búsqueda como alerta", texto: "Filtra las plazas por puesto, región y sueldo, y toca «Crear alerta con esta búsqueda»." },
          { titulo: "Te llega lo nuevo", texto: "Sólo las plazas que calzan contigo, con su cierre, para que postules a tiempo en la entidad." },
        ]}
      />

      <section aria-labelledby="por-que-t">
        <h2 id="por-que-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">Lo que te ahorran las alertas</h2>
        <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icono: BellRing, t: "Revisar todos los días", d: "Las entidades publican a cualquier hora y algunas plazas cierran en una semana. La alerta mira por ti." },
            { icono: GraduationCap, t: "Leer bases que no son para ti", d: "Te llega con lo que piden: estudios, experiencia y cursos, para que sepas al toque si postulas." },
            { icono: Building, t: "Intermediarios", d: "Postulas siempre en la entidad. Gobserva no cobra por plazas ni elige a nadie." },
          ].map(({ icono: Icono, t, d }) => (
            <li key={t} className="flex gap-3 rounded-2xl border border-line bg-paper p-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
                <Icono size={18} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-cuerpo font-semibold text-ink">{t}</span>
                <span className="mt-0.5 block text-dato leading-relaxed text-inkSoft">{d}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Preguntas
        items={[
          {
            p: "¿Cuándo empiezan las alertas?",
            r: "Hoy mismo. Crea tu cuenta, guarda una búsqueda como alerta y desde mañana te llega lo nuevo: una vez por semana con la cuenta gratis, cada mañana con Alertas.",
          },
          {
            p: "¿Cómo pago?",
            r: "Con tarjeta de crédito o débito por Mercado Pago, que se cobra cada mes, o con Yape o Plin por 1, 3, 6 o 12 meses de una vez.",
          },
          {
            p: "¿Puedo cancelar?",
            r: "Sí, desde tu cuenta y cuando quieras. No se vuelve a cobrar y sigues con tu plan hasta el final de lo que pagaste.",
          },
          {
            p: "¿Qué es una plaza CAS?",
            r: "Un puesto en el Estado con Contrato Administrativo de Servicios: sueldo mensual, vacaciones, aguinaldo y seguro. Se gana por concurso público: evaluación curricular, examen y entrevista.",
          },
          {
            p: "¿Ustedes cobran por postular?",
            r: "No. Postular es gratis y siempre en la entidad o en SERVIR. Gobserva ordena la información y te avisa a tiempo; nunca intermedia ni elige a nadie.",
          },
          {
            p: "¿De dónde salen los datos?",
            r: "De las ofertas laborales que las entidades publican en SERVIR, que leemos todos los días, cruzadas con lo que Vigía sabe de cada entidad (órdenes de servicio, cambios de gestión).",
          },
          {
            p: "¿Qué hacen con mis datos?",
            r: "Los usamos sólo para tu cuenta y tus alertas. No los vendemos ni los compartimos, y puedes borrar tu cuenta tú mismo desde «Perfil».",
          },
        ]}
      />
    </div>
  );
}
