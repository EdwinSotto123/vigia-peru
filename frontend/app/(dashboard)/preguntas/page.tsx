"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ArrowLeft, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

const FAQ = [
  {
    q: "¿Vigía Perú acusa a alguien de corrupción?",
    a: "No. Decimos 'señal de riesgo' o 'patrón detectado'. La diferencia es jurídica y ética: las acusaciones las hacen el Ministerio Público o la Contraloría, no nosotros. Cada bandera roja del mapa cita la norma específica que aparenta incumplirse, no a la persona detrás del contrato.",
  },
  {
    q: "¿De dónde sacan los datos?",
    a: "De fuentes públicas. Las principales para el MVP: Contrataciones Abiertas OECE (contratos), SUNAT vía apis.net.pe (edad de RUC), INFOBRAS de la Contraloría (avance físico de obras), Claridad ONPE (aportes a campañas) y JNE Plataforma Electoral (hojas de vida de candidatos). En total son 25 fuentes verificadas, todas listadas en el repo público.",
  },
  {
    q: "Si reporto algo, ¿se publica mi nombre?",
    a: "No. Los reportes son anónimos por defecto. No mostramos DNIs ni nombres de personas naturales en los pines públicos. Si dejas email, sólo nosotros lo vemos para volver a contactarte, nunca se publica.",
  },
  {
    q: "¿Cómo verifican que un reporte ciudadano es real?",
    a: "Dos cosas. Primero: el reporte requiere foto. Segundo: para que aparezca como 'verificado' en el mapa público, necesitamos al menos 2 reportes independientes sobre el mismo punto en menos de 30 días, o la convergencia con una alerta automática del sistema. Reportes sin foto no aparecen en el mapa público.",
  },
  {
    q: "¿Qué es un caso convergente (pin negro)?",
    a: "Es cuando una alerta automática del sistema (pin amarillo, generada por el cruce de datos) coincide en ubicación y tiempo con un reporte ciudadano (pin rojo). Esa convergencia es lo más valioso que produce Vigía: data oficial + testigo presencial sobre el mismo punto. Son los casos que enviamos a periodistas y fiscales.",
  },
  {
    q: "¿Cuáles son las 'reglas duras' del motor de detección?",
    a: "Ocho reglas, basadas en el modelo Funes de OjoPúblico y la Ley de Contrataciones peruana: 1) Edad RUC del ganador < 90 días, 2) Único postor con oferta cerca del 100% del referencial, 3) Adenda > 25% del monto original, 4) Plazo legal mínimo incumplido, 5) Contratación directa sin causal válida, 6) Miembro de comité sin certificación SICAN, 7) Fraccionamiento de órdenes pequeñas, 8) Aportante de campaña que después gana contrato.",
  },
  {
    q: "¿La IA decide quién es corrupto?",
    a: "No, y no queremos que lo haga. Los modelos de lenguaje (Gemini 2.5 Pro en nuestro caso) se usan para 1) reconstruir el expediente leyendo los datos, 2) cruzar con opiniones normativas del OECE, y 3) redactar el dictamen en lenguaje claro. La detección de banderas la hace código determinista en Python, no IA generativa. Esto es importante: una bandera roja siempre tiene una regla y una norma asociada, nunca es una opinión del modelo.",
  },
  {
    q: "¿Puedo ayudar con el código?",
    a: "Sí. Vigía Perú es open source desde el día cero (no podría ser de otra manera: una herramienta anticorrupción cerrada sería una contradicción). El repo está en GitHub, las contribuciones se hacen vía pull request. No se aceptan dependencias propietarias.",
  },
  {
    q: "¿Cómo se financia el proyecto?",
    a: "Subvenciones y donaciones, nunca publicidad ni venta de datos. La razón es directa: un sistema anticorrupción con conflictos de interés financieros sería incoherente. Hoy corremos con costos mínimos (Gemini free tier, Cloud SQL Postgres, Cloud Run).",
  },
  {
    q: "¿Va a reemplazar a la Contraloría o al periodismo?",
    a: "No. Vigía es un sistema de detección y priorización. Nuestra propuesta de valor es que les llegue a Contraloría, fiscalía y periodistas una lista ordenada por riesgo, con el expediente ya pre-armado y la cita normativa lista. Acortamos el ciclo de detección de años a semanas. La investigación y la sanción siguen siendo de ellos.",
  },
];

export default function PreguntasPage() {
  return (
    <div className="container-page py-10 max-w-3xl space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-ash hover:text-ink">
        <ArrowLeft size={16} /> Volver al mapa
      </Link>

      <header className="space-y-3">
        <Badge>
          <MessageSquare size={12} /> Preguntas y respuestas
        </Badge>
        <h1 className="font-serif text-4xl font-bold leading-tight">
          ¿Cómo funciona Vigía Perú?
        </h1>
        <p className="text-lg text-ash">
          Diez preguntas que todo el mundo se hace. Si la tuya no está, escribinos a{" "}
          <a className="text-navy underline" href="mailto:hola@vigiaperu.org">
            hola@vigiaperu.org
          </a>
          .
        </p>
      </header>

      <div className="surface divide-y divide-line p-0">
        {FAQ.map((item, i) => (
          <Accordion key={i} q={item.q} a={item.a} defaultOpen={i === 0} />
        ))}
      </div>

      <div className="surface bg-coal p-6 text-bone">
        <h3 className="font-serif text-xl font-bold">¿Sos periodista o fiscal?</h3>
        <p className="mt-2 text-sm text-bone/80">
          Podemos darte acceso prioritario a los dictámenes completos antes de la
          publicación pública en el mapa. Escribinos.
        </p>
        <a
          href="mailto:prensa@vigiaperu.org"
          className="mt-4 inline-flex rounded-full bg-amber px-4 py-2 text-sm font-medium text-coal"
        >
          prensa@vigiaperu.org
        </a>
      </div>
    </div>
  );
}

function Accordion({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-bone/50"
      >
        <span className="font-serif text-lg font-semibold text-ink">{q}</span>
        <ChevronDown
          size={20}
          className={"shrink-0 text-ash transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>
      {open && (
        <div className="px-6 pb-5 text-[15px] leading-relaxed text-ash">{a}</div>
      )}
    </div>
  );
}
