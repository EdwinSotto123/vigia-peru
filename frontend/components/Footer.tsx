import Link from "next/link";
import {
  Github,
  Mail,
  Heart,
  ArrowUpRight,
} from "lucide-react";
import { Marca } from "./Marca";
import { PeruFlag } from "./landing/CountryFlags";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 bg-ink text-paper">
      <div className="container-page py-14">
        {/* Top: brand + CTA donación lado a lado */}
        <div className="grid items-center gap-8 lg:grid-cols-[1.6fr,1fr]">
          {/* Brand block */}
          {/* El PNG vivía acá dentro de una caja blanca, porque sobre tinta se
              perdía. Esa caja se leía como una calcomanía pegada encima del pie,
              no como la firma del sitio. El nombre escrito no necesita fondo. */}
          <div>
            <Link
              href="/"
              aria-label="Vigía Perú, ir al inicio"
              className="inline-flex rounded-lg transition-opacity duration-rapido hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              <Marca tono="oscuro" tamano="lg" nota="Infraestructura cívica anticorrupción" />
            </Link>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-paper/70">
              Sin fines de lucro y 100% open source. Para que la verdad no dependa
              de quién paga el servidor.
            </p>
          </div>

          {/* CTA donar + GitHub stacked */}
          <div className="flex flex-col gap-2.5">
            <Link
              href="/app/financiar"
              className="group flex items-center justify-between gap-3 rounded-xl bg-heroViolet px-5 py-3.5 text-paper transition-transform hover:scale-[1.02]"
            >
              <div className="flex items-center gap-2.5">
                <Heart size={16} className="fill-paper text-paper" />
                <span className="font-serif text-base font-bold leading-tight">
                  Financiar una auditoría
                </span>
              </div>
              <ArrowUpRight
                size={18}
                className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
            <a
              href="https://github.com/EdwinSotto123/vigia-peru"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-paper/15 px-5 py-2.5 text-paper transition-colors hover:bg-paper/5"
            >
              <div className="flex items-center gap-2.5">
                <Github size={15} />
                <span className="text-sm font-medium">Contribuir al código</span>
              </div>
              <ArrowUpRight size={14} className="text-paper/50" />
            </a>
          </div>
        </div>

        {/* Disclaimer + columnas */}
        <div className="mt-12 grid gap-10 border-t border-paper/10 pt-10 lg:grid-cols-[1.4fr,1fr,1fr,1fr]">
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-heroGreen-soft/80">
              Postura editorial
            </h4>
            <p className="mt-3 text-[13px] leading-relaxed text-paper/65">
              <strong className="text-paper/90">No acusamos a nadie.</strong> Detectamos
              señales y publicamos fuentes. La denuncia formal corresponde al
              Ministerio Público, la Contraloría o el periodismo. Los reportes
              ciudadanos son anónimos por defecto.
            </p>
          </div>

          <FooterCol title="Plataforma">
            <Link href="/app/mapa">Mapa de auditoría</Link>
            <Link href="/app/financiar">Financiar una auditoría</Link>
            <Link href="/app/auditoria">Auditoría en vivo</Link>
            <Link href="/app/aliados">Aliados de transparencia</Link>
            <Link href="/reporte/nuevo">Denunciar una obra</Link>
            <Link href="/preguntas">Preguntas frecuentes</Link>
          </FooterCol>

          <FooterCol title="Fuentes oficiales">
            <FooterExtLink href="https://contratacionesabiertas.oece.gob.pe/">
              Contrataciones Abiertas
            </FooterExtLink>
            <FooterExtLink href="https://apps.contraloria.gob.pe/ciudadano/">
              INFOBRAS de la Contraloría
            </FooterExtLink>
            <FooterExtLink href="https://www.onpe.gob.pe/claridad/">
              ONPE Claridad
            </FooterExtLink>
            <FooterExtLink href="https://plataformaelectoral.jne.gob.pe/">
              JNE Plataforma Electoral
            </FooterExtLink>
            <FooterExtLink href="https://www.elperuano.pe/">
              El Peruano
            </FooterExtLink>
          </FooterCol>

          <FooterCol title="Proyecto">
            <Link href="/app/financiar">
              <Heart size={12} className="inline mr-1.5 fill-heroViolet text-heroViolet" />
              Financiar
            </Link>
            <a href="mailto:hola@vigiaperu.org">
              <Mail size={12} className="inline mr-1.5" /> hola@vigiaperu.org
            </a>
            <a href="mailto:prensa@vigiaperu.org">
              Acceso periodistas
            </a>
            <Link href="/preguntas#cuentas">Cuentas claras</Link>
          </FooterCol>
        </div>

        {/* Bottom strip.
            Antes eran dos cadenas de puntos medios ("Vigía Perú · Licencia MIT ·
            Hecho en Lima"). Son listas: se dibujan como listas, con espacio
            entre ítems, no con una raya de texto plano entre medio. */}
        <div className="mt-10 flex flex-col gap-3 border-t border-paper/10 pt-5 text-[11px] text-paper/45 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <li className="inline-flex items-center gap-1.5">
              <PeruFlag size={16} className="rounded-[2px] ring-1 ring-paper/20" />© {year} Vigía Perú
            </li>
            <li>Licencia MIT</li>
            <li>Hecho en Lima</li>
          </ul>
          {/* paper/35 daba 3.23:1 sobre tinta. Que sea la línea menos importante
              del pie no la exime del mínimo AA: sigue siendo texto. */}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-paper/55">
            {["Gemini 2.5", "Google ADK", "Cloud Run", "Cloud SQL"].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-heroGreen-soft/80">
        {title}
      </h4>
      <div className="mt-3 flex flex-col gap-2 text-[13px] text-paper/65 [&>*]:transition-colors [&>*:hover]:text-paper">
        {children}
      </div>
    </div>
  );
}

function FooterExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center"
    >
      {children}
    </a>
  );
}
