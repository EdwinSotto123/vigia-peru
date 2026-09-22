import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { CapacidadColectiva } from "@/components/aliados/CapacidadColectiva";
import { MuroAliados } from "@/components/aliados/MuroAliados";
import { ReglasIndependencia } from "@/components/aliados/ReglasIndependencia";
import { FiltroRegion } from "@/components/auditoria/FiltroRegion";
import { getEstadoGlobal, getZonas } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";

export const metadata = {
  title: "Aliados de transparencia — Vigía Perú",
  description:
    "Cuánto se ha leído de todo lo que hay por leer, y quién pagó por ello. El reconocimiento se cuenta en contratos, nunca en soles, y nadie elige qué se audita.",
};

export const revalidate = 300;

/**
 * /app/aliados — reordenada de raíz.
 *
 * Antes abría con un podio de tres puestos sobre un escenario morado, dos de
 * ellos "vacante", con medallas emoji y una animación en el puesto 1. Con un
 * único financiador —que es la propia plataforma— esa superficie probaba
 * soledad, y le daba escenario a quien paga en una herramienta cuya promesa
 * central es que *el que paga no elige*.
 *
 * El orden nuevo: primero la capacidad colectiva y el déficit (33 leídos de
 * 18.394: la historia real del producto, y hasta hoy invisible porque ninguna
 * cifra se comparaba con otra), después el libro mayor de quién aportó, y al
 * final las reglas que hacen que ese dinero no compre nada.
 *
 * También se fue el hero con degradado y orbe borroso: consumía la primera
 * pantalla entera antes del primer dato.
 */
export default async function AliadosPage({ searchParams }: { searchParams?: { ubigeo?: string; pagina?: string } }) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);

  const [estado, zonas, resumenPais, resumenZona] = await Promise.all([
    getEstadoGlobal(),
    getZonas("departamento"),
    getResumenContratos(),
    ubigeo ? getResumenContratos({ ubigeo }) : Promise.resolve(null),
  ]);

  // El filtro ya no lista solo las regiones con aliados: una región con cola y sin
  // nadie que la financie es justo la que hay que poder mirar, y ahora su vacío
  // enseña qué falta en vez de quedar en blanco.
  const opciones = (zonas ?? [])
    .filter((z) => z.totalCola > 0)
    .sort((a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es"))
    .map((z) => ({
      ubigeo: z.ubigeo,
      nombre: z.nombre,
      hint: `${z.pendientes.toLocaleString("es-PE")} sin financiar`,
    }));
  const zona = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;
  const ambito = zona?.nombre ?? "todo el Perú";

  const publicados = (ubigeo ? resumenZona?.total : resumenPais?.total) ?? 0;
  const leidos = zona ? zona.procesados : estado?.contratosProcesados ?? 0;
  const financiados = zona ? zona.financiados : estado?.contratosFinanciados ?? 0;

  return (
    <div className="container-page space-y-10 py-8">
      <PageHeader
        title="Aliados de transparencia"
        subtitle="Quién financia que estos contratos se lean de verdad. Nadie compra un resultado ni una región: los contratos se asignan por antigüedad, en código, y lo que salga se publica igual."
        contexto={
          estado ? (
            <span className="font-mono">
              {financiados.toLocaleString("es-PE")} financiados · {leidos.toLocaleString("es-PE")} leídos
              {publicados > 0 && <> de {publicados.toLocaleString("es-PE")}</>}
            </span>
          ) : undefined
        }
      />

      {/* Filtro pegajoso: el libro mayor pagina hasta 24 filas, cambiar de región no debería
          obligar a volver arriba. top-0 porque esta ruta cuelga de (dashboard)/layout.tsx, que
          no renderiza Header público — solo la barra LATERAL. */}
      <div className="sticky top-0 z-barra -mx-4 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mute">
            {zona
              ? `Mirando ${zona.nombre}: ${zona.pendientes.toLocaleString("es-PE")} contratos esperan que alguien pague su lectura.`
              : "Mirando todo el Perú. Filtrá por región para ver su déficit y quién lo cubre."}
          </p>
          <FiltroRegion opciones={opciones} valor={ubigeo} />
        </div>
      </div>

      {/* P0 de la dirección: si el API cae, se dice — no se dibujan ceros que parezcan dato. */}
      {estado ? (
        <CapacidadColectiva
          ambito={ambito}
          publicados={publicados}
          cola={zona ? zona.totalCola : (estado.colaGlobal ?? 0) + estado.contratosFinanciados}
          documentosListos={(zona ? zona.documentosListos : estado.documentosListos) ?? 0}
          financiados={financiados}
          leidos={leidos}
          conSenal={zona ? zona.senales : estado.senalesHalladas}
          enRevision={(zona ? zona.enRevision : estado.enRevision) ?? 0}
          precioPen={zona?.precioPen ?? estado.tarifa?.precioPen ?? 3}
          alcance={estado.alcance ?? null}
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm leading-relaxed text-mute">
          No se pudo leer el estado de la cola ahora mismo. Preferimos decirlo antes que mostrar cifras
          en cero que parezcan un dato.
        </p>
      )}

      <MuroAliados region={ubigeo} pagina={pagina} nombreRegion={zona?.nombre} financiadosAmbito={financiados} />

      <ReglasIndependencia />

      <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-line bg-paperSoft px-5 py-4">
        <p className="max-w-[60ch] text-sm leading-relaxed text-inkSoft">
          Desde 5 contratos. Con tu nombre, como colectivo o sin nombre —{" "}
          <span className="text-mute">en el conteo pesa exactamente igual.</span>
        </p>
        <Link
          href="/app/financiar"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-heroViolet-deep"
        >
          Financiar una auditoría <ArrowRight size={14} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
