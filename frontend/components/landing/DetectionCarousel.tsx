"use client";

import { MapPin, Scale } from "lucide-react";
import { Carousel } from "@/components/Carousel";

type Caso = {
  tag: string;
  tagColor: "rust" | "amber" | "clay";
  title: string;
  location: string;
  monto: string;
  score: number;
  flags: string[];
  article: string;
  norma: string;
};

const CASOS: Caso[] = [
  {
    tag: "Empresa fachada",
    tagColor: "rust",
    title: "RUC con 18 días gana S/ 1.49M",
    location: "Caraz, Áncash",
    monto: "S/ 1,490,000",
    score: 93,
    flags: [
      "RUC creado el 4 abr y buena pro el 22 abr (18 días)",
      "Único postor al 99.9% del valor referencial",
      "Mismo titular figura en 4 EIRL paralelas",
      "Ninguna trabajadora declarada en SUNAT",
    ],
    article: "Heurística Funes C1",
    norma: "Art. 2 TUO Ley 30225, con la Opinión OECE D56-2023",
  },
  {
    tag: "Aportante = ganador",
    tagColor: "rust",
    title: "Socio aportó S/ 35K al partido del alcalde",
    location: "Yungay, Áncash",
    monto: "S/ 4,250,000",
    score: 91,
    flags: [
      "Aporte ONPE 2022 → contrato 2026 con misma comuna",
      "Cuñado del alcalde figura como director (10%)",
      "Gerente con sanción OSCE vigente desde 2024",
      "Tres convocatorias adjudicadas al mismo grupo",
    ],
    article: "Cruce C3",
    norma: "Art. 27 del Reglamento, conflicto de intereses",
  },
  {
    tag: "Adenda inflada",
    tagColor: "amber",
    title: "Contrato modificado +31% post-firma",
    location: "Calca, Cusco",
    monto: "S/ 5,100,000 → 6,700,000",
    score: 64,
    flags: [
      "Original S/ 5.1M y adenda S/ 1.6M (+31%)",
      "Excede el tope legal del 25% sin sustento",
      "Sin justificación técnica publicada",
      "Tres adendas consecutivas en seis meses",
    ],
    article: "Regla compliance #3",
    norma: "Art. 34 TUO Ley 30225, modificaciones contractuales",
  },
  {
    tag: "Contratación directa",
    tagColor: "rust",
    title: "Emergencia sin acto resolutivo",
    location: "Tumbes, Tumbes",
    monto: "S/ 406,400",
    score: 88,
    flags: [
      "Causal Art. 27.1.a (emergencia) sin D.S./D.U. citado",
      "Persona natural con CIIU \"terminación de edificios\"",
      "Objeto: ayuda humanitaria, sin capacidad operativa",
      "Buena pro 6 mayo sin comité formal de evaluación",
    ],
    article: "Compliance C7 + contextual",
    norma: "Art. 27.1.a del TUO y Art. 8 del Reglamento",
  },
  {
    tag: "Spec restrictiva",
    tagColor: "amber",
    title: "Bases pedían logo institucional bordado",
    location: "Huánuco, Huánuco",
    monto: "S/ 285,000",
    score: 72,
    flags: [
      "Dimensiones no estándar (excluyen 9 de 11 marcas)",
      "Logo institucional pre-impreso obligatorio",
      "Plazo de entrega: 5 días hábiles desde firma",
      "Un único postor calificado y sin observaciones",
    ],
    article: "Regla compliance #5",
    norma: "Art. 2 Ley 30225, principio de concurrencia",
  },
  {
    tag: "Lobby pre-convocatoria",
    tagColor: "rust",
    title: "Postor visitó al alcalde 8 veces antes de la buena pro",
    location: "Sullana, Piura",
    monto: "S/ 2,150,000",
    score: 86,
    flags: [
      "Registro Único de Visitas: 8 ingresos en 60 días previos",
      "Misma persona figura como repr. legal del ganador",
      "Ingresos coinciden con fechas clave del proceso",
      "Sin sustento técnico del contacto previo",
    ],
    article: "Regla compliance C13",
    norma: "Ley 28024, Registro Único de Visitas",
  },
];

export function DetectionCarousel() {
  return (
    <Carousel
      total={CASOS.length}
      ariaLabel="Patrones de riesgo detectados en contratos — ejemplos ilustrativos"
      activeDotClass="bg-rust"
      renderSlide={(i) => <CasoCard caso={CASOS[i]} />}
    />
  );
}

function CasoCard({ caso }: { caso: Caso }) {
  const tagBg =
    caso.tagColor === "rust"
      ? "bg-rust"
      : caso.tagColor === "clay"
        ? "bg-clay"
        : "bg-amber";

  return (
    <article className="relative overflow-hidden rounded-3xl border border-line bg-paper shadow-card">
      <div className="grid gap-0 md:grid-cols-[1fr,auto]">
        {/* Body */}
        <div className="p-7 sm:p-9">
          <span
            className={
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-paper " +
              tagBg
            }
          >
            {caso.tag}
          </span>
          <h3 className="mt-4 font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
            {caso.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute">
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {caso.location}
            </span>
            <span className="font-mono text-ink">{caso.monto}</span>
          </div>

          <ul className="mt-5 space-y-2.5">
            {caso.flags.map((f, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-[13px] leading-snug text-ink"
              >
                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rust" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="rounded-full bg-paperDeep px-2.5 py-1 font-mono text-[10px] text-mute">
              {caso.article}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-heroViolet">
              <Scale size={11} /> {caso.norma}
            </span>
          </div>
        </div>

        {/* Score side panel: arco tipo gauge, no un cuadrado flotando en un panel vacío;
            anclado arriba (sin justify-center) para que no dependa de la altura del body. */}
        <div className="flex flex-col items-center gap-2.5 border-t border-line bg-paperDeep p-6 pt-7 md:w-[200px] md:border-l md:border-t-0 md:px-6 md:pt-9">
          <ScoreGauge score={caso.score} />
          <span className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-mute">
            Score de riesgo
          </span>
          <p className="text-center text-[11px] leading-snug text-mute/80">
            {caso.score >= 85 ? "Riesgo alto" : caso.score >= 70 ? "Riesgo medio-alto" : "Riesgo medio"}
          </p>
        </div>
      </div>
    </article>
  );
}

/** Arco de progreso 0-100 (mismo strokeDasharray que los "anillos" del mapa) en vez de
 * un cuadrado de color plano — el score deja de ser un número decorativo y se lee como
 * un dato medido. Color interpolado moss→amber→rust, igual escala que antes usaba el fondo. */
function ScoreGauge({ score }: { score: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(100, score)) / 100;
  // Tokens del tema, no hexadecimales sueltos: `rust` pasó de #CF3A2C a #A81E12
  // cuando se corrigió su contraste y este arco se quedó con el valor viejo.
  const color = score >= 85 ? "#A81E12" : score >= 70 ? "#B26A2E" : "#BE7B26";
  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center sm:h-28 sm:w-28">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#E4E7EB" strokeWidth={9} />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${(c * f).toFixed(1)} ${c.toFixed(1)}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-3xl font-bold leading-none text-ink sm:text-4xl">{score}</span>
        <span className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-mute">/ 100</span>
      </div>
    </div>
  );
}
