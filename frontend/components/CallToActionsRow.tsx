import Link from "next/link";
import { Camera, Newspaper, MessageCircle } from "lucide-react";

export function CallToActionsRow() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Card
        href="/reporte/nuevo"
        icon={<Camera size={20} />}
        eyebrow="Denuncia en 60 segundos"
        title="¿Viste algo raro en tu distrito?"
        body="Foto, ubicación, descripción. Anónimo si quieres. Nosotros nos encargamos del resto."
        tone="crimson"
      />
      <Card
        href="/noticia"
        icon={<Newspaper size={20} />}
        eyebrow="Para periodistas"
        title="Genera un borrador de noticia con IA"
        body="Te damos el dictamen estructurado de un caso convergente. Tú verificas y publicas."
        tone="amber"
      />
      <Card
        href="/preguntas"
        icon={<MessageCircle size={20} />}
        eyebrow="Preguntas frecuentes"
        title="¿Esto es una acusación?"
        body="No. Te explicamos qué hacemos, qué no hacemos, y cómo validamos cada caso."
        tone="navy"
      />
    </section>
  );
}

function Card({
  href,
  icon,
  eyebrow,
  title,
  body,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  tone: "crimson" | "amber" | "navy";
}) {
  const accents = {
    crimson: "bg-crimson text-white",
    amber: "bg-amber text-white",
    navy: "bg-navy text-white",
  }[tone];
  return (
    <Link
      href={href}
      className="group surface flex flex-col gap-3 p-6 transition-shadow hover:shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${accents}`}>
          {icon}
        </span>
        <span className="font-mono text-xs uppercase tracking-wider text-ash">
          {eyebrow}
        </span>
      </div>
      <h3 className="font-serif text-lg font-bold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-ash">{body}</p>
      <span className="mt-auto pt-2 text-sm font-medium text-ink group-hover:underline">
        Empezar →
      </span>
    </Link>
  );
}
