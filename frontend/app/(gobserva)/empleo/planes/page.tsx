import type { Metadata } from "next";
import { BellRing, Building, GraduationCap } from "lucide-react";
import { Planes, type Plan } from "@/components/gobserva/Planes";
import { Suscribirse } from "@/components/gobserva/Suscribirse";
import { Preguntas } from "@/components/empleo/Piezas";
import { REGIONES_EMPLEO, nombreRegion, slugRegion } from "@/lib/empleo";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Planes y alertas",
  description: "Gobserva Empleo es gratis para buscar plazas CAS. Con las alertas, te llegan cada mañana las plazas que buscas por correo o WhatsApp, desde S/ 4.90 al mes.",
  alternates: { canonical: urlCanonica("empleo", "/planes") },
};

/**
 * Los planes de Gobserva Empleo y la lista de espera (2026-11-01): buscar es gratis; las alertas, con precio de
 * fundador; y un plan para bolsas de trabajo e institutos (API, MCP con más límite, widget). Lo que todavía no funciona
 * va marcado «Pronto»: quien se anota reserva su lugar y su precio, y no se cobra nada hasta que lo confirme.
 */
export default function PlanesEmpleo() {
  const base = baseProducto("empleo");
  const unete = rutaEn(base, "/planes#unete");
  const planes: Plan[] = [
    {
      id: "gratis",
      nombre: "Gratis",
      para: "Para buscar y postular hoy.",
      precio: "S/ 0",
      periodo: "siempre",
      incluye: [
        "Todas las plazas CAS abiertas del país",
        "Filtros por región, sueldo, estudios y experiencia",
        "Fichas con requisitos y «¿Cumples?»",
        "Lo que pagan otras entidades por el mismo puesto",
        "Las señales de Vigía en cada plaza",
        "Consultas por MCP desde tu asistente de IA (beta)",
      ],
      accion: { href: rutaEn(base, "/plazas"), etiqueta: "Buscar plazas ahora" },
    },
    {
      id: "alertas",
      nombre: "Alertas",
      para: "Para no perderte ninguna plaza que calce contigo.",
      precio: "S/ 4.90",
      periodo: "al mes",
      antes: "S/ 9.90",
      nota: "Precio de fundador los 3 primeros meses",
      destacado: true,
      incluye: ["Todo lo del plan gratis"],
      pronto: [
        "Alerta diaria por correo con tus filtros",
        "Alerta por WhatsApp",
        "Recordatorio 2 días antes del cierre",
        "Tu «¿Cumples?» guardado en tu cuenta",
        "Historial de lo que pagaba cada puesto",
      ],
      accion: { href: unete, etiqueta: "Reservar a S/ 4.90" },
    },
    {
      id: "institucional",
      nombre: "Bolsas de trabajo e institutos",
      para: "Para universidades, institutos, colegios profesionales y bolsas de empleo.",
      precio: "S/ 149",
      periodo: "al mes",
      incluye: ["Todo lo del plan gratis"],
      pronto: [
        "API con todas las plazas y sus requisitos",
        "MCP con más consultas para tu equipo",
        "Widget de plazas para tu web, con tu marca",
        "Alertas para tus egresados por carrera",
        "Reporte mensual de lo que pide el Estado por carrera",
      ],
      accion: { href: unete, etiqueta: "Quiero una demo" },
    },
  ];

  return (
    <div className="container-page space-y-16 py-10 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Buscar es gratis. Que te avisen, casi.</h1>
        <p className="mt-4 text-bloque leading-relaxed text-inkSoft">
          Todas las plazas CAS del Perú, con sus requisitos y lo que nadie te dice, son gratis y lo seguirán siendo. Las alertas
          te ahorran revisar todos los días: reserva hoy tu lugar con precio de fundador.
        </p>
      </header>

      <Planes planes={planes} />

      <section id="unete" aria-labelledby="unete-t" className="scroll-mt-24 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <h2 id="unete-t" className="text-balance font-display text-titulo font-bold leading-tight text-ink">
            Reserva tus alertas
          </h2>
          <p className="mt-3 text-cuerpo leading-relaxed text-inkSoft">
            Cuéntanos qué buscas. Cuando abramos las alertas te escribimos con tu precio de fundador guardado; hasta entonces no
            pagas nada.
          </p>
          <ul className="mt-6 space-y-4">
            {[
              { icono: BellRing, t: "Lo nuevo, cada mañana", d: "Sólo las plazas que calzan con tu puesto, tu región y tu sueldo." },
              { icono: GraduationCap, t: "Con lo que piden", d: "Estudios, experiencia y cursos, para que sepas al toque si postulas." },
              { icono: Building, t: "Sin intermediarios", d: "Postulas siempre en la entidad. Gobserva no cobra por plazas ni elige a nadie." },
            ].map(({ icono: Icono, t, d }) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
                  <Icono size={18} aria-hidden />
                </span>
                <span>
                  <span className="block text-cuerpo font-semibold text-ink">{t}</span>
                  <span className="block text-dato leading-relaxed text-inkSoft">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Suscribirse
          producto="empleo"
          origen="empleo/planes"
          planInicial="alertas"
          planes={[
            { id: "alertas", nombre: "Alertas", detalle: "S/ 4.90 al mes los 3 primeros meses, después S/ 9.90" },
            { id: "gratis", nombre: "Sólo avísenme del lanzamiento", detalle: "Gratis, un correo cuando abramos" },
            { id: "institucional", nombre: "Bolsa de trabajo o instituto", detalle: "S/ 149 al mes: API, MCP y widget" },
          ]}
          intereses={[
            { clave: "puestos", etiqueta: "¿Qué puesto buscas?", tipo: "texto", placeholder: "Abogado, técnico en enfermería, chofer…" },
            {
              clave: "regiones",
              etiqueta: "¿En qué regiones?",
              tipo: "lista",
              ayuda: "Marca una o varias.",
              opciones: REGIONES_EMPLEO.map((r) => ({ valor: slugRegion(r), etiqueta: nombreRegion(r) })),
            },
            { clave: "sueldo_minimo", etiqueta: "¿Desde cuánto sueldo? (S/ al mes)", tipo: "numero", placeholder: "3000" },
          ]}
        />
      </section>

      <Preguntas
        items={[
          {
            p: "¿Cuándo empiezan las alertas?",
            r: "En las próximas semanas. Quien se anota ahora recibe el primer correo y guarda su precio de fundador. No cobramos nada hasta que abras tu plan y lo confirmes.",
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
            r: "Los usamos sólo para tus alertas. No los vendemos ni los compartimos, y puedes pedir que los borremos cuando quieras escribiendo a hello@gobserva.cloud.",
          },
        ]}
      />
    </div>
  );
}
