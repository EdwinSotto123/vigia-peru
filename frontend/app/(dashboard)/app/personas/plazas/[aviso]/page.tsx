import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Ayuda, BanderasFicha, DatosClave, EncabezadoPagina, FichaNoLeida, FuenteDato, Migas, Pagina, Seccion, SinSenalesEstado } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Fila, type Indicador } from "@/components/listado";
import { FrenteMediana } from "@/components/charts/FrenteMediana";
import { DetallePlaza } from "@/components/personas/ListaPlazas";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { decimal, fechaCorta, numero, plural, soles } from "@/lib/formato";
import { TALENTO_PERU } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { SENAL_PLAZA, getFichaPlaza, rutaPlaza, type FichaPlaza } from "@/lib/planilla";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { aviso: string } }): Promise<Metadata> {
  const f = await getFichaPlaza(params.aviso);
  if (!f) return { title: "Plaza CAS" };
  return { title: `${tituloNatural(f.plaza.titulo)}, plaza CAS de ${tituloNatural(f.plaza.entidad)}` };
}

/**
 * /app/personas/plazas/[aviso] — una plaza CAS que una entidad publicó en SERVIR Talento Perú (fase 1D del plan del
 * 2026-10-27): lo que paga y pide, sus señales con su evidencia, lo que pagan otras entidades por el mismo título y las
 * otras plazas de la entidad con ese título. No trae datos de personas: se puede indexar.
 */
export default async function FichaPlazaPage({ params }: { params: { aviso: string } }) {
  const f = await getFichaPlaza(params.aviso);
  if (!f) {
    if (!/^[0-9]{1,9}$/.test(params.aviso)) notFound();
    return (
      <FichaNoLeida
        migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: "/app/personas" }, { etiqueta: "Plazas CAS", href: "/app/personas?seccion=plazas" }]}
        titulo={`Plaza ${params.aviso}`}
        error="No pudimos leer esta plaza"
        reintentar={{ href: rutaPlaza(params.aviso) }}
      >
        Puede que ya no esté publicada o que el servidor no haya respondido. Prueba de nuevo en unos minutos.
      </FichaNoLeida>
    );
  }
  const p = f.plaza;
  const ruta = rutaPlaza(p.aviso);
  const titulo = tituloNatural(p.titulo);
  const entidad = tituloNatural(p.entidad);
  const banderas = p.senales.map((s) => ({
    tipo: s.tipo, severidad: s.severidad, nombre: SENAL_PLAZA[s.tipo]?.corto ?? s.tipo, explica: SENAL_PLAZA[s.tipo]?.titulo, href: "#senales",
  }));
  const requisitos = [
    { etiqueta: "Experiencia", valor: p.experiencia },
    { etiqueta: "Formación", valor: p.formacion },
    { etiqueta: "Especialización", valor: p.especializacion },
    { etiqueta: "Conocimientos", valor: p.conocimiento },
    { etiqueta: "Tipo de servicio", valor: p.servicio },
  ];
  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Personas contratadas", href: "/app/personas" },
          { etiqueta: "Plazas CAS", href: "/app/personas?seccion=plazas" },
          { etiqueta: titulo, href: ruta },
        ]}
      />
      <EncabezadoPagina
        titulo={titulo}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {p.entidadRuc ? (
              <Link href={`/entidad/${p.entidadRuc}?seccion=plazas`} className="underline-offset-2 hover:text-granate hover:underline">
                <Dato tipo="entidad">{entidad}</Dato>
              </Link>
            ) : (
              <Dato tipo="entidad">{entidad}</Dato>
            )}
            {p.ubicacion && <Dato tipo="lugar">{tituloNatural(p.ubicacion)}</Dato>}
            <Dato tipo="codigo" nombre="Aviso" mono>{`Aviso ${p.aviso}`}</Dato>
          </span>
        }
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta plaza" banderas={banderas} /> : undefined}
        ayuda={
          <Ayuda titulo="¿Qué es una plaza CAS?">
            <span className="block">
              Un puesto del Estado con Contrato Administrativo de Servicios: temporal, con concurso público y con menos beneficios
              que un puesto de planta. Las entidades los publican en SERVIR Talento Perú; Vigía los guarda mientras están
              publicados y les busca señales de plaza a la medida.
            </span>
          </Ayuda>
        }
      />
      <Indicadores items={indicadores(f)} />

      <Seccion titulo="Lo que se encontró" id="senales" descripcion={p.senales.length ? `${plural(p.senales.length, "señal", "señales")} en esta plaza.` : undefined}>
        {p.senales.length ? (
          <ul className="divide-y divide-line/70 rounded-2xl border border-line bg-paper px-4 sm:px-5">
            {p.senales.map((s) => (
              <li key={s.tipo} className="space-y-1.5 py-4">
                <Severidad bandera={s.severidad} formato="linea" />
                <p className="text-dato font-semibold leading-snug text-ink">{SENAL_PLAZA[s.tipo]?.titulo ?? s.tipo}</p>
                {SENAL_PLAZA[s.tipo]?.explica && <p className="text-meta leading-snug text-inkSoft">{SENAL_PLAZA[s.tipo].explica}</p>}
                <DetallePlaza tipo={s.tipo} d={s.detalle} />
              </li>
            ))}
          </ul>
        ) : (
          <SinSenalesEstado titulo="Sin señales de plaza a la medida">
            No pide experiencia en la propia entidad, su plazo no fue corto, no paga mucho pidiendo poco y la entidad no pagaba ese
            servicio por órdenes en el año anterior.
          </SinSenalesEstado>
        )}
      </Seccion>

      <Seccion titulo="Lo que pide">
        <DatosClave items={requisitos} />
      </Seccion>

      {f.enOtras && f.enOtras.mediana != null && p.remuneracion != null && (
        <Seccion
          titulo="Lo que pagan otras entidades por la misma plaza"
          descripcion={`${plural(f.enOtras.plazas, "plaza", "plazas")} con el mismo título en ${plural(f.enOtras.entidades, "otra entidad", "otras entidades")}.`}
        >
          <FrenteMediana valor={p.remuneracion} mediana={f.enOtras.mediana} etiquetaValor="Esta plaza" etiquetaMediana="Mediana en otras entidades" />
          <p className="mt-2 text-meta text-inkSoft">
            {`La mitad de esas plazas paga entre ${soles(f.enOtras.p25 ?? 0)} y ${soles(f.enOtras.p75 ?? 0)}.`}
            {f.enOtras.mediana > 0 && ` Esta paga ${decimal(p.remuneracion / f.enOtras.mediana)} veces la mediana.`}
          </p>
        </Seccion>
      )}

      {f.mismoTitulo.length > 0 && (
        <Seccion
          titulo="Otras plazas de la entidad con el mismo título"
          descripcion="Una convocatoria de varias vacantes suele publicarse como varias plazas con el mismo nombre."
        >
          <Tabla
            etiqueta="Otras plazas de la entidad con el mismo título"
            medida="contenedor"
            densidad="compacta"
            columnas={[
              { clave: "plaza", titulo: "Plaza", ancho: "minmax(0,1fr)" },
              { clave: "sueldo", titulo: "Sueldo", ancho: "8rem", alinear: "der" },
            ]}
            filas={f.mismoTitulo.map((x): Fila => ({
              id: String(x.aviso),
              href: rutaPlaza(x.aviso),
              celdas: {
                plaza: (
                  <CeldaPrincipal
                    titulo={x.numero ? `Convocatoria ${x.numero}` : `Aviso ${x.aviso}`}
                    meta={[
                      x.fechaInicio ? <Dato key="f" tipo="fecha" nombre="Publicada">{fechaCorta(x.fechaInicio)}</Dato> : null,
                      x.ubicacion ? <Dato key="l" tipo="lugar">{tituloNatural(x.ubicacion)}</Dato> : null,
                    ]}
                  />
                ),
                sueldo: <CeldaNumero sub={x.vacantes && x.vacantes > 1 ? plural(x.vacantes, "vacante", "vacantes") : undefined}>{x.remuneracion != null ? soles(x.remuneracion) : "Sin dato"}</CeldaNumero>,
              },
            }))}
          />
        </Seccion>
      )}

      <div className="flex flex-wrap gap-3">
        {p.detalleUrl && (
          <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={claseAccion("primario")}>
            Ver la convocatoria en SERVIR <ExternalLink size={14} aria-hidden />
          </a>
        )}
        {p.entidadRuc && (
          <EnlaceAccion href={`/entidad/${p.entidadRuc}?seccion=plazas`} variante={p.detalleUrl ? "secundario" : "primario"}>
            Las plazas de {entidad}
          </EnlaceAccion>
        )}
      </div>
      {/* La convocatoria en SERVIR; si no se guardó su enlace, el buscador de ofertas de Talento Perú. */}
      <FuenteDato fuente={`SERVIR, Talento Perú (aviso ${p.aviso})`} href={p.detalleUrl ?? TALENTO_PERU} />
      <Aviso tono="neutro">
        Una señal no es una acusación: dice qué registro público coincide con esta plaza. Quién la ganó no está en los datos de
        SERVIR.
      </Aviso>
    </Pagina>
  );
}

function indicadores(f: FichaPlaza): Indicador[] {
  const p = f.plaza;
  const veces = f.enOtras?.mediana && p.remuneracion ? p.remuneracion / f.enOtras.mediana : null;
  return [
    {
      valor: p.remuneracion != null ? soles(p.remuneracion) : "Sin dato",
      etiqueta: "de sueldo al mes",
      contexto: veces != null ? `${decimal(veces)} veces la mediana de la misma plaza en otras entidades` : "sin plazas iguales con qué comparar",
    },
    { valor: numero(p.vacantes ?? 1), etiqueta: p.vacantes === 1 ? "vacante" : "vacantes", contexto: p.numero ? `convocatoria ${p.numero}` : "en esta plaza" },
    {
      valor: p.fechaFin ? fechaCorta(p.fechaFin) : "Sin dato",
      etiqueta: "cierre de la postulación",
      contexto: p.fechaInicio ? `publicada el ${fechaCorta(p.fechaInicio)}` : "sin fecha de publicación",
    },
    {
      valor: numero(p.senales.length),
      etiqueta: p.senales.length === 1 ? "señal" : "señales",
      contexto: p.senales.length ? "de plaza a la medida o de contexto" : "ninguna coincidencia",
      href: "#senales",
    },
  ];
}
