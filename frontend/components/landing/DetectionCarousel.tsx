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
    title: "RUC con 18 días gana S/. 1.49M",
    location: "Caraz · Áncash",
    monto: "S/. 1,490,000",
    score: 93,
    flags: [
      "RUC creado 4 abr · buena pro 22 abr (18 días)",
      "Único postor al 99.9% del valor referencial",
      "Mismo titular figura en 4 EIRL paralelas",
      "Ninguna trabajadora declarada en SUNAT",
    ],
    article: "Heurística Funes C1",
    norma: "Art. 2 TUO Ley 30225 · Opinión OECE D56-2023",
  },
  {
    tag: "Aportante = ganador",
    tagColor: "rust",
    title: "Socio aportó S/. 35K al partido del alcalde",
    location: "Yungay · Áncash",
    monto: "S/. 4,250,000",
    score: 91,
    flags: [
      "Aporte ONPE 2022 → contrato 2026 con misma comuna",
      "Cuñado del alcalde figura como director (10%)",
      "Gerente con sanción OSCE vigente desde 2024",
      "Tres convocatorias adjudicadas al mismo grupo",
    ],
    article: "Cruce C3",
    norma: "Art. 27 Reglamento · Conflicto de intereses",
  },
  {
    tag: "Adenda inflada",
    tagColor: "amber",
    title: "Contrato modificado +31% post-firma",
    location: "Calca · Cusco",
    monto: "S/. 5,100,000 → 6,700,000",
    score: 64,
    flags: [
      "Original S/. 5.1M · adenda S/. 1.6M (+31%)",
      "Excede el tope legal del 25% sin sustento",
      "Sin justificación técnica publicada",
      "Tres adendas consecutivas en seis meses",
    ],
    article: "Regla compliance #3",
    norma: "Art. 34 TUO Ley 30225 · Modificaciones contractuales",
  },
  {
    tag: "Contratación directa",
    tagColor: "rust",
    title: "Emergencia sin acto resolutivo",
    location: "Tumbes · Tumbes",
    monto: "S/. 406,400",
    score: 88,
    flags: [
      "Causal Art. 27.1.a (emergencia) sin D.S./D.U. citado",
      "Persona natural con CIIU \"terminación de edificios\"",
      "Objeto: ayuda humanitaria · sin capacidad operativa",
      "Buena pro 6 mayo sin comité formal de evaluación",
    ],
    article: "Compliance C7 + contextual",
    norma: "Art. 27.1.a TUO · Art. 8 Reglamento",
  },
  {
    tag: "Spec restrictiva",
    tagColor: "amber",
    title: "Bases pedían logo institucional bordado",
    location: "Huánuco · Huánuco",
    monto: "S/. 285,000",
    score: 72,
    flags: [
      "Dimensiones no estándar (excluyen 9 de 11 marcas)",
      "Logo institucional pre-impreso obligatorio",
      "Plazo de entrega: 5 días hábiles desde firma",
      "Un único postor calificado · sin observaciones",
    ],
    article: "Regla compliance #5",
    norma: "Art. 2 Ley 30225 · Principio de concurrencia",
  },
  {
    tag: "Lobby pre-convocatoria",
    tagColor: "rust",
    title: "Postor visitó al alcalde 8 veces antes de la buena pro",
    location: "Sullana · Piura",
    monto: "S/. 2,150,000",
    score: 86,
    flags: [
      "Registro Único de Visitas: 8 ingresos en 60 días previos",
      "Misma persona figura como repr. legal del ganador",
      "Ingresos coinciden con fechas clave del proceso",
      "Sin sustento técnico del contacto previo",
    ],
    article: "Regla compliance C13",
    norma: "Ley 28024 · Registro Único de Visitas",
  },
];

export function DetectionCarousel() {
  return (
    <Carousel
      total={CASOS.length}
      ariaLabel="Patrones de corrupción detectados"
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
  const scoreBg =
    caso.score >= 85 ? "bg-rust" : caso.score >= 70 ? "bg-clay" : "bg-amber";

  return (
    <article className="surface relative overflow-hidden">
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
            <span className="text-line">·</span>
            <span className="font-mono text-clay">{caso.monto}</span>
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
            <span className="inline-flex items-center gap-1 text-[11px] text-clay">
              <Scale size={11} /> {caso.norma}
            </span>
          </div>
        </div>

        {/* Score side panel */}
        <div className="flex flex-col items-center justify-center gap-2 border-t border-line bg-paperDeep p-6 md:border-l md:border-t-0 md:px-8">
          <div
            className={
              "flex h-24 w-24 flex-col items-center justify-center rounded-2xl text-paper sm:h-28 sm:w-28 " +
              scoreBg
            }
          >
            <span className="font-serif text-4xl font-bold leading-none sm:text-5xl">
              {caso.score}
            </span>
            <span className="mt-0.5 text-[9px] uppercase tracking-[0.2em] opacity-80">
              / 100
            </span>
          </div>
          <span className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-mute">
            Score de riesgo
          </span>
        </div>
      </div>
    </article>
  );
}
