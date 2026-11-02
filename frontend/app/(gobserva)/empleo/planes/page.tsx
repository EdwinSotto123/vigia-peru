import type { Metadata } from "next";
import { BellRing, Briefcase, GraduationCap, HandCoins, Sparkles, Timer } from "lucide-react";
import { AvisoPlanes, ComoFunciona } from "@/components/gobserva/ComoFunciona";
import { Planes, type Plan } from "@/components/gobserva/Planes";
import { Preguntas } from "@/components/empleo/Piezas";
import { Beneficios } from "@/components/patrones/Franja";
import { canalAlertas, getResumenEmpleo } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { entero, planesServidor, precioCorto, precioDe, precioHoy } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Planes y alertas",
  description: "Gobserva Empleo es gratis para buscar plazas CAS. Con el plan Alertas te llegan cada mañana las plazas nuevas que buscas, desde S/ 4.90 al mes.",
  alternates: { canonical: urlCanonica("empleo", "/planes") },
};

/**
 * Los planes de Gobserva Empleo, en modo «persuadir»: buscar es gratis y trae una alerta semanal; Alertas, con precio de
 * fundador, las manda cada mañana y baja las búsquedas en Excel; y el plan para bolsas de trabajo e institutos. Arriba, lo
 * que se publica de verdad en SERVIR (abiertas hoy, nuevas en tres días, las que cierran en dos): la razón para que te
 * avisen. En el celular, Alertas va primero (quien llega aquí tocó «Recibir alertas»). Los precios y los límites salen
 * del catálogo de la API (los cambia el panel); lo que todavía no funciona va marcado «Pronto»; el correo, sólo si ya
 * sale (`correoActivo`).
 */
export default async function PlanesEmpleo() {
  const base = baseProducto("empleo");
  const [cat, r] = await Promise.all([planesServidor("empleo"), getResumenEmpleo()]);
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
        `${g.alertas === 1 ? "1 alerta" : `${g.alertas} alertas`} cada semana, ${canalAlertas(cat.correoActivo)}`,
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
    <div className="container-page space-y-14 py-10 sm:space-y-16 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Buscar es gratis. Que te avisen, casi.</h1>
        <p className="mt-4 text-pretty text-cuerpo leading-relaxed text-inkSoft sm:text-bloque">
          Todas las plazas CAS del Perú, con sus requisitos y lo que nadie te dice, son gratis y lo seguirán siendo. Con tu cuenta gratis te avisamos una vez por
          semana; con Alertas, cada mañana, para que postules antes que nadie.
        </p>
        {r && (
          <ul className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-x-7" aria-label="Lo que se publica en SERVIR">
            <Hoy icono={<Briefcase size={16} aria-hidden />} n={r.abiertas} texto="plazas abiertas hoy" />
            {r.nuevas > 0 && <Hoy icono={<Sparkles size={16} aria-hidden />} n={r.nuevas} texto="publicadas en los últimos 3 días" />}
            {r.cierran2dias > 0 && <Hoy icono={<Timer size={16} aria-hidden />} n={r.cierran2dias} texto="cierran en los próximos 2 días" urgente />}
          </ul>
        )}
        <AvisoPlanes texto={cat.aviso} className="mt-6" />
      </header>

      {/* En el celular, el plan destacado primero: el orden de la página (gratis primero) queda igual en la computadora. */}
      <Planes planes={planes} className="max-md:[&>#plan-alertas]:order-first" />

      <section aria-labelledby="por-que-t">
        <h2 id="por-que-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          Lo que te ahorran las alertas
        </h2>
        <Beneficios
          className="mt-6"
          items={[
            { icono: <BellRing size={16} aria-hidden />, titulo: "Revisar todos los días", texto: "Las entidades publican a cualquier hora y algunas plazas cierran en una semana. La alerta mira por ti." },
            { icono: <GraduationCap size={16} aria-hidden />, titulo: "Leer bases que no son para ti", texto: "Te llega con lo que piden (estudios, experiencia y cursos) para que sepas al toque si postulas." },
            { icono: <HandCoins size={16} aria-hidden />, titulo: "Pagarle a un intermediario", texto: "Postulas siempre en la entidad, gratis. Gobserva no cobra por plazas ni elige a nadie." },
          ]}
        />
      </section>

      <ComoFunciona
        cat={cat}
        pasos={[
          { titulo: "Crea tu cuenta", texto: "Con Google o con tu correo, gratis y en un minuto." },
          { titulo: "Guarda tu búsqueda como alerta", texto: "Filtra las plazas por puesto, región y sueldo, y toca «Crear alerta con esta búsqueda»." },
          { titulo: "Te llega lo nuevo", texto: "Sólo las plazas que calzan contigo, con su cierre, para que postules a tiempo en la entidad." },
        ]}
      />

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

/** Una cifra de hoy en SERVIR, como dato con ícono: el número grande y qué es. */
function Hoy({ icono, n, texto, urgente = false }: { icono: React.ReactNode; n: number; texto: string; urgente?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-dato text-inkSoft">
      <span className={urgente ? "shrink-0 text-rust" : "shrink-0 text-granate"}>{icono}</span>
      <span>
        <b className={urgente ? "font-display text-bloque font-bold tabular-nums text-rust" : "font-display text-bloque font-bold tabular-nums text-ink"}>{numero(n)}</b> {texto}
      </span>
    </li>
  );
}
