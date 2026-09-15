"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

const FAQ = [
  {
    q: "¿Vigía Perú acusa a alguien de corrupción?",
    a: "No. Decimos 'señal de riesgo' o 'patrón detectado'. La diferencia es jurídica y ética: las acusaciones las hacen el Ministerio Público o la Contraloría, no nosotros. Cada señal cita la norma específica que aparenta incumplirse y enlaza a la fuente oficial (SEACE, OECE, MEF).",
  },
  {
    q: "¿De dónde salen los contratos?",
    a: "De la API de Contrataciones Abiertas del OECE (estándar OCDS): todos los procesos publicados en el SEACE, de todo el Perú, se descargan y quedan representados en el mapa y en la lista de contratos aunque todavía nadie los haya analizado. Para el análisis se cruzan además SUNAT (edad del RUC), INFOBRAS (avance de obras), Claridad ONPE (aportes de campaña), JNE (hojas de vida) y el registro de sancionados del OSCE.",
  },
  {
    q: "¿Qué significa 'financiar una auditoría'?",
    a: "Leer un contrato público con todos sus documentos cuesta S/ 3 de procesamiento e infraestructura. Al financiar, aportas capacidad de lectura para una zona (región, provincia o distrito). Los contratos se toman en orden de llegada: nadie —ni tú, ni nosotros— elige cuál se analiza ni qué se publica. Recibes un comprobante público con cada contrato procesado y las señales halladas.",
  },
  {
    q: "¿Por qué no puedo elegir qué contrato se audita?",
    a: "Porque si el financiador eligiera el contrato, el sistema podría usarse para presionar a una entidad o a un competidor. Financias capacidad, no resultados. Además, quien tiene interés directo en un contrato (proveedor, funcionario de la entidad) no puede financiar la zona donde ese contrato está en cola.",
  },
  {
    q: "¿Todos los contratos del SEACE se analizan igual?",
    a: "No. Cada contrato se clasifica por tipo (bienes, servicios, consultoría, obras, convenio, contratación directa) y por etapa (convocado, adjudicado, contratado, en ejecución, desierto…). Solo corren los análisis que aplican: por ejemplo, la comparación de precios de mercado solo tiene sentido en bienes con ítems y cantidades; el cruce de proveedores solo cuando ya hay adjudicación. Lo que aún no se puede analizar queda marcado como 'pendiente de procesamiento' con el motivo visible.",
  },
  {
    q: "Si reporto algo, ¿se publica mi nombre?",
    a: "No. Los reportes son anónimos por defecto. No mostramos DNI ni nombres de personas naturales. Si dejas un correo, solo lo usamos para contactarte de vuelta y nunca se publica.",
  },
  {
    q: "¿Cómo verifican que un reporte ciudadano es real?",
    a: "Dos filtros. Primero: el reporte requiere foto. Segundo: para aparecer como 'verificado' en el mapa se necesitan al menos dos reportes independientes sobre el mismo punto en menos de 30 días, o la convergencia con una señal automática sobre el mismo contrato. Reportes sin foto no se publican en el mapa.",
  },
  {
    q: "¿La IA decide quién es corrupto?",
    a: "No, y no queremos que lo haga. Los modelos de lenguaje se usan para leer los expedientes, cruzarlos con las opiniones normativas del OECE y redactar el dictamen en lenguaje claro. Las señales las produce código determinista con reglas y normas explícitas; una señal siempre tiene regla, norma y fuente, nunca es una opinión del modelo.",
  },
  {
    q: "¿Cómo se sostiene el proyecto?",
    a: "Con los aportes de 'Financia una auditoría' y donaciones, nunca con publicidad ni venta de datos. El código es abierto; una herramienta anticorrupción cerrada sería una contradicción.",
  },
  {
    q: "¿Reemplaza a la Contraloría o al periodismo?",
    a: "No. Vigía detecta y prioriza: entrega a Contraloría, fiscalía y periodistas una cola ordenada por riesgo con el expediente pre-armado y la cita normativa lista. La investigación y la sanción siguen siendo de ellos.",
  },
];

export default function PreguntasPage() {
  return (
    <div className="container-page max-w-3xl space-y-8 py-10">
      <header className="space-y-3">
        <Badge>
          <MessageSquare size={12} /> Preguntas frecuentes
        </Badge>
        <h1 className="font-serif text-4xl font-bold leading-tight">¿Cómo funciona Vigía Perú?</h1>
        <p className="text-lg text-mute">
          Si tu pregunta no está, escríbenos a{" "}
          <a className="text-ink underline" href="mailto:hola@vigiaperu.org">hola@vigiaperu.org</a>.
        </p>
      </header>

      <div className="surface divide-y divide-line p-0">
        {FAQ.map((item, i) => (
          <Accordion key={i} q={item.q} a={item.a} defaultOpen={i === 0} />
        ))}
      </div>

      <div className="surface bg-ink p-6 text-paper">
        <h3 className="font-serif text-xl font-bold">¿Eres periodista, fiscal o auditor?</h3>
        <p className="mt-2 text-sm text-paper/80">
          Podemos darte acceso prioritario a los dictámenes completos antes de su publicación en el mapa.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="mailto:prensa@vigiaperu.org" className="inline-flex rounded-full bg-amber px-4 py-2 text-sm font-medium text-ink">
            prensa@vigiaperu.org
          </a>
          <Link href="/app/auditoria" className="inline-flex rounded-full border border-paper/30 px-4 py-2 text-sm font-medium text-paper hover:bg-paper/10">
            Ver la auditoría en vivo
          </Link>
        </div>
      </div>
    </div>
  );
}

function Accordion({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-paperSoft"
        aria-expanded={open}
      >
        <span className="font-serif text-lg font-semibold text-ink">{q}</span>
        <ChevronDown size={20} className={"shrink-0 text-mute transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && <div className="px-6 pb-5 text-[15px] leading-relaxed text-mute">{a}</div>}
    </div>
  );
}
