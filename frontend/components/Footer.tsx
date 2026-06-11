import Link from "next/link";
import {
  Github,
  Mail,
  Heart,
  ArrowUpRight,
} from "lucide-react";
import { Logo } from "./Logo";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 bg-ink text-paper">
      <div className="container-page py-14">
        {/* Top: brand + CTA donación lado a lado */}
        <div className="grid items-center gap-8 lg:grid-cols-[1.6fr,1fr]">
          {/* Brand block */}
          <div>
            <Link href="/" aria-label="Vigía Perú · Inicio" className="inline-flex items-center">
              <span className="rounded-2xl bg-paper px-4 py-3">
                <Logo height={40} />
              </span>
            </Link>
            <div className="mt-3 text-[10px] font-medium uppercase tracking-[0.2em] text-paper/45">
              Infraestructura cívica anticorrupción
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-paper/70">
              Sin fines de lucro · 100% open source. Para que la verdad no dependa
              de quién paga el servidor.
            </p>
          </div>

          {/* CTA donar + GitHub stacked */}
          <div className="flex flex-col gap-2.5">
            <Link
              href="/donar"
              className="group flex items-center justify-between gap-3 rounded-xl bg-amber px-5 py-3.5 text-ink transition-transform hover:scale-[1.02]"
            >
              <div className="flex items-center gap-2.5">
                <Heart size={16} className="fill-rust text-rust" />
                <span className="font-serif text-base font-bold leading-tight">
                  Donar a Vigía Perú
                </span>
              </div>
              <ArrowUpRight
                size={18}
                className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
            <a
              href="https://github.com/"
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
            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber/80">
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
            <Link href="/app">Mapa de alertas</Link>
            <Link href="/app#entidades">Ranking de entidades</Link>
            <Link href="/reporte/nuevo">Reportar una obra</Link>
            <Link href="/noticia">Generador de notas</Link>
            <Link href="/preguntas">Preguntas frecuentes</Link>
          </FooterCol>

          <FooterCol title="Fuentes oficiales">
            <FooterExtLink href="https://contratacionesabiertas.oece.gob.pe/">
              Contrataciones Abiertas
            </FooterExtLink>
            <FooterExtLink href="https://apps.contraloria.gob.pe/ciudadano/">
              INFOBRAS · Contraloría
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
            <Link href="/donar">
              <Heart size={12} className="inline mr-1.5 fill-amber text-amber" />
              Donar
            </Link>
            <a href="mailto:hola@vigiaperu.org">
              <Mail size={12} className="inline mr-1.5" /> hola@vigiaperu.org
            </a>
            <a href="mailto:prensa@vigiaperu.org">
              Acceso periodistas
            </a>
            <Link href="/preguntas#transparencia">Cuentas claras</Link>
          </FooterCol>
        </div>

        {/* Bottom strip */}
        <div className="mt-10 flex flex-col gap-2 border-t border-paper/10 pt-5 text-[11px] text-paper/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Vigía Perú · Licencia MIT · Hecho en Lima</p>
          <p className="font-mono text-paper/35">
            Gemini 2.5 · Google ADK · Cloud Run · Cloud SQL
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber/80">
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
