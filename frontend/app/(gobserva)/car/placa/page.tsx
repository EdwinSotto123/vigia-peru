import type { Metadata } from "next";
import { ArrowUpRight, Bus, CarFront, FileSignature, Info, ShieldAlert, Wallet } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Migas } from "@/components/patrones/Migas";
import { Pestanas, type Pestana } from "@/components/patrones/Pestanas";
import { Pixel } from "@/components/pixel/Pixel";
import { CONSULTAS, placaDe, placaLegible, type ConsultaPlaca, type Momento } from "@/components/car/consultas";
import { FormPlaca, Placa } from "@/components/car/Placa";
import { CopiarNumero } from "@/components/salud/medico/CopiarNumero";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

type Props = { searchParams?: { p?: string | string[]; seccion?: string | string[] } };

const texto = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function generateMetadata({ searchParams }: Props): Metadata {
  const p = placaDe(texto(searchParams?.p));
  return {
    title: p ? `Placa ${placaLegible(p)}: dónde verificarla` : "Verificar una placa",
    description: "Las consultas oficiales de una placa del Perú (SUNARP, SOAT, revisión técnica, papeletas, SUTRAN, ATU) con la placa lista para copiar.",
    alternates: { canonical: urlCanonica("car", "/placa") },
    // Una página por placa no tiene por qué estar en los buscadores.
    robots: p ? { index: false, follow: true } : undefined,
  };
}

/** Una consulta oficial como casilla: su dibujo, la pregunta, lo que vas a ver, lo que pide y el botón para abrirla. */
function Casilla({ c }: { c: ConsultaPlaca }) {
  return (
    <li className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-granate-50 p-1.5">
          <Pixel nombre={c.sprite} escala={3} animado={false} acento="accion" className="max-h-full max-w-full" />
        </span>
        <div className="min-w-0">
          <h3 className="text-cuerpo font-bold leading-snug text-ink">{c.pregunta}</h3>
          <p className="mt-0.5 text-meta text-inkSoft">{c.fuente}</p>
        </div>
      </div>
      <p className="mt-2.5 px-4 text-dato leading-relaxed text-ink">{c.devuelve}</p>
      <p className="mt-2 px-4 text-meta text-mute">{c.pide}</p>
      <div className="mt-auto px-4 pb-4 pt-3">
        <a href={c.url} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "min-h-11 w-full")}>
          Abrir la consulta <ArrowUpRight size={15} aria-hidden />
          <span className="sr-only"> ({c.fuente}, se abre en otra pestaña)</span>
        </a>
      </div>
    </li>
  );
}

const Rejilla = ({ para }: { para: Momento }) => (
  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {CONSULTAS.filter((c) => c.para.includes(para)).map((c) => (
      <Casilla key={c.clave} c={c} />
    ))}
  </ul>
);

/** Lo que conviene antes de pagar un usado: lo que sólo se sabe pagando y lo que se revisa en persona. */
function AntesDePagar() {
  const pasos: { Icono: typeof Wallet; titulo: string; texto: string }[] = [
    {
      Icono: Wallet,
      titulo: "Gravámenes y dueños anteriores: en SUNARP, pagando",
      texto:
        "La consulta gratis no dice si tiene embargos o prendas ni quiénes fueron sus dueños. Eso sale en la Boleta Informativa (S/ 6.10) o en el Certificado de Registro Vehicular (S/ 48.10) de SUNARP.",
    },
    {
      Icono: CarFront,
      titulo: "Compara la tarjeta con el auto",
      texto: "La placa, el número de motor y el de serie (VIN) de la tarjeta de identificación vehicular tienen que ser los mismos que los del auto.",
    },
    {
      Icono: FileSignature,
      titulo: "Firma ante notario",
      texto: "La compraventa de un vehículo se firma ante notario, que la envía a SUNARP para inscribirla a tu nombre.",
    },
    {
      Icono: ShieldAlert,
      titulo: "Desconfía de lo que no puedes ver",
      texto: "No adelantes pagos por un auto que no viste en persona ni por uno mucho más barato que los demás de su modelo y año.",
    },
  ];
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {pasos.map((p, i) => (
        <li key={p.titulo} className="flex gap-3.5 rounded-2xl border border-line bg-paper p-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-granate font-display text-bloque font-bold text-paper">
            {i + 1}
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-cuerpo font-bold leading-snug text-ink">
              <p.Icono size={16} aria-hidden className="shrink-0 text-granate" /> {p.titulo}
            </h3>
            <p className="mt-1 text-dato leading-relaxed text-inkSoft">{p.texto}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Verificar una placa (Gobserva Car, 2026-11-22). Las consultas oficiales por placa piden captcha: no las leemos; la
 * página pone la placa dibujada y lista para copiar, y cada consulta como una casilla con lo que responde y su botón,
 * separadas por lo que vas a hacer (comprarlo o subirte). Sin la placa, el formulario y lo que se puede consultar.
 */
export default function PaginaPlaca({ searchParams }: Props) {
  const base = baseProducto("car");
  const crudo = texto(searchParams?.p);
  const p = placaDe(crudo);
  const seccion = texto(searchParams?.seccion) || undefined;
  const accion = rutaEn(base, "/placa");
  const ico = (I: typeof Wallet) => <I size={15} aria-hidden />;

  const pestanas: Pestana[] = [
    { clave: "comprar", etiqueta: "Si lo vas a comprar", titulo: "Si lo vas a comprar", icono: ico(Wallet), conteo: CONSULTAS.filter((c) => c.para.includes("comprar")).length, contenido: <Rejilla para="comprar" /> },
    { clave: "subir", etiqueta: "Si te vas a subir", titulo: "Si te vas a subir (taxi, colectivo o bus)", icono: ico(Bus), conteo: CONSULTAS.filter((c) => c.para.includes("subir")).length, contenido: <Rejilla para="subir" /> },
    { clave: "antes", etiqueta: "Antes de pagar", titulo: "Antes de pagar un auto usado", icono: ico(FileSignature), contenido: <AntesDePagar /> },
  ];

  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, ...(p ? [{ etiqueta: "Verificar una placa", href: accion }, { etiqueta: placaLegible(p) }] : [{ etiqueta: "Verificar una placa" }])]} />

      {p ? (
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
          <section aria-labelledby="placa-t" className="flex min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-paper px-5 py-6 text-center">
            <h1 id="placa-t" className="sr-only">
              Placa {placaLegible(p)}
            </h1>
            <Placa placa={p} />
            <CopiarNumero numero={p} etiqueta="Copiar la placa" />
          </section>
          <section aria-labelledby="como-t" className="min-w-0 rounded-2xl border border-line bg-paper p-5">
            <h2 id="como-t" className="flex items-center gap-1.5 font-display text-bloque font-bold leading-snug text-ink">
              Dónde verificarla
              <Ayuda titulo="¿Por qué no te lo decimos aquí?">
                Todas las consultas oficiales por placa piden un captcha: no las leemos de forma automática. Copia la placa, abre cada consulta y
                pégala allá.
              </Ayuda>
            </h2>
            <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">
              Copia la placa y abre las consultas de abajo. Cada una es gratis y te dice algo distinto: de quién es, si tiene SOAT, revisión técnica,
              papeletas u orden de captura.
            </p>
            <FormPlaca accion={accion} className="mt-4" />
            <p className="mt-3 flex items-start gap-2 text-meta text-mute">
              <Info size={14} aria-hidden className="mt-0.5 shrink-0" /> No guardamos la placa ni consultamos nada con ella.
            </p>
          </section>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <h1 className="text-balance font-display text-seccion font-bold leading-tight tracking-[-0.015em] text-ink">Verificar una placa</h1>
            <p className="mt-1 max-w-[62ch] text-dato leading-relaxed text-inkSoft">
              Escribe la placa y te mostramos dónde verificar, en las fuentes oficiales, de quién es, su SOAT, su revisión técnica y sus papeletas.
            </p>
            {crudo && <p className="mt-2 text-dato font-semibold text-crimsonTexto">«{crudo}» no parece una placa: escribe 5 a 7 letras y números, por ejemplo ABC-123.</p>}
            <FormPlaca accion={accion} inicial={crudo} grande className="mt-5 max-w-xl" />
          </div>
          <span aria-hidden className="hidden h-36 w-44 items-center justify-center rounded-3xl bg-granate-50 p-4 lg:flex">
            <Pixel nombre="auto" escala={7} className="max-h-full max-w-full" />
          </span>
        </div>
      )}

      <div id="secciones" className="mt-8 scroll-mt-16">
        <Pestanas pestanas={pestanas} activa={seccion} etiqueta="Las consultas de una placa" fija className="[&>div:first-child]:top-16" />
      </div>
    </div>
  );
}
