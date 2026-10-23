import { Ayuda, DatosClave, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { fecha, fechaCorta, numero, oracion, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { type VisitaEmpresa } from "@/lib/empresas";
import { entidadTexto, NoCargo, opcionesLocales, paraClave } from "./comun";

/** La pestaña Visitas: las visitas de su gente a entidades del Estado. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Visitas ──────────────────────────────────────────────────────────────────

const COLUMNAS_VISITAS: Columna[] = [
  { clave: "fecha", titulo: "Fecha", ancho: "92px", desde: "md", apilar: true },
  { clave: "entidad", titulo: "Entidad visitada", ancho: "minmax(0,1.4fr)" },
  { clave: "quien", titulo: "Quién fue", ancho: "minmax(0,1fr)", desde: "lg" },
  {
    clave: "despues", titulo: "Después", ancho: "minmax(0,0.9fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué dice «Después»?">
        Si esa entidad le adjudicó un contrato o le dio una orden a la empresa después de la visita: lo primero que le dio y
        cuántos días después. Una visita no prueba nada: dice qué revisar.
      </Ayuda>
    ),
  },
];

export async function VisitasEmpresa({ datos }: { datos: Promise<{ total: number; visitas: VisitaEmpresa[] } | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus visitas" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Sin visitas registradas">
        Ningún socio, representante ni directivo de la empresa figura en los registros de visitas cargados, ni alguien que dijera
        venir de ella.
      </EstadoVacio>
    );
  }
  const filas: FilaFiltrable[] = d.visitas.map((v, i) => {
    const entidad = entidadTexto(v.entidad);
    const despues = v.despues ? (
      <span className="text-meta text-ink">
        {v.despuesTipo === "contrato" ? "Le adjudicó" : "Le dio una orden"}{" "}
        <span className="font-semibold">{v.diasDespues === 0 ? "ese mismo día" : `${plural(v.diasDespues ?? 0, "día", "días")} después`}</span>
      </span>
    ) : v.entidadRuc ? (
      <span className="text-meta text-mute">Le vendió antes, no después</span>
    ) : (
      <span className="text-meta text-mute">No le vende</span>
    );
    return {
      id: `${v.fecha}-${i}`,
      buscable: `${entidad} ${v.cargoFuncionario ?? ""} ${v.area ?? ""} ${v.motivo ?? ""} ${v.via}`,
      valores: {
        entidad: v.entidad ? paraClave(v.entidad) : null,
        via: v.via,
        despues: v.despues ? (v.despuesTipo ?? "contrato") : v.entidadRuc ? "antes" : "no_cliente",
        anio: v.fecha?.slice(0, 4) ?? null,
      },
      claves: { fecha: v.fecha, dias: v.diasDespues },
      celdas: {
        fecha: <CeldaFecha fecha={v.fecha} />,
        entidad: (
          <CeldaPrincipal
            titulo={entidad}
            meta={[
              v.cargoFuncionario && <Dato key="cargo" tipo="cargo" nombre="Cargo de quien recibió">{tituloNatural(v.cargoFuncionario)}</Dato>,
              v.motivo && <span key="motivo" className="text-inkSoft">{oracion(v.motivo).slice(0, 90)}</span>,
            ]}
          />
        ),
        quien: (
          <span className="text-meta text-ink">
            {v.visitante ?? "Sin nombre"} <span className="text-inkSoft">{`(${v.via})`}</span>
          </span>
        ),
        despues,
      },
      detalle: {
        titulo: `Visita a ${entidad}`,
        etiqueta: `Ver el detalle de la visita del ${v.fecha ? fechaCorta(v.fecha) : ""}`.trim(),
        descripcion: v.fecha ? fechaCorta(v.fecha) : undefined,
        contenido: (
          <DatosClave
            items={[
              { etiqueta: "Quién fue", valor: v.visitante },
              { etiqueta: "Qué es de la empresa", valor: v.via },
              { etiqueta: "Dijo venir de", valor: v.entidadDeclarada },
              { etiqueta: "Entidad visitada", valor: entidad },
              { etiqueta: "A quién visitó", valor: [v.funcionario, v.cargoFuncionario ? tituloNatural(v.cargoFuncionario) : null].filter(Boolean).join(", ") || null },
              { etiqueta: "Área", valor: v.area ? tituloNatural(v.area) : null },
              { etiqueta: "Motivo", valor: v.motivo ? oracion(v.motivo) : null },
              { etiqueta: "Lugar", valor: v.lugar },
              {
                etiqueta: "Después de la visita",
                valor: v.despues
                  ? `${v.despuesTipo === "contrato" ? "Le adjudicó un contrato" : "Le dio una orden"} el ${fechaCorta(v.despues)}${v.diasDespues ? `, ${plural(v.diasDespues, "día", "días")} después` : ""}`
                  : v.entidadRuc ? "Nada después de esa fecha" : "Esa entidad no le adjudicó ni le compró",
              },
            ]}
          />
        ),
        pie: <span className="text-rotulo text-mute">Fuente: registro de visitas de la entidad{v.fuente ? ` (${v.fuente})` : ""}</span>,
      },
    };
  });
  const aClientes = d.visitas.filter((v) => v.entidadRuc).length;
  const despues = d.visitas.filter((v) => v.despues).length;
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-meta text-inkSoft">
        {`${plural(d.total, "visita", "visitas")} de socios, representantes o directivos de la empresa (o de alguien que dijo venir de ella)`}
        {aClientes ? `; ${numero(aClientes)} a entidades que le adjudicaron o le compraron` : ""}
        {despues ? `, y tras ${plural(despues, "visita", "visitas")} esa entidad le dio algo después.` : "."}
      </p>
      <TablaFiltrable
        columnas={COLUMNAS_VISITAS}
        filas={filas}
        etiqueta="Visitas registradas de su gente"
        tam={20}
        nombre="visitas"
        buscar={{ placeholder: "Buscar entidad, cargo o motivo…", etiqueta: "Buscar en sus visitas" }}
        filtros={[
          { clave: "entidad", etiqueta: "Entidad visitada", corta: "Entidad", opciones: opcionesLocales(filas.map((f) => f.valores?.entidad as string | null), (v) => tituloNatural(v)) },
          { clave: "via", etiqueta: "Quién fue", corta: "Quién fue", opciones: opcionesLocales(filas.map((f) => f.valores?.via as string), (v) => v.charAt(0).toUpperCase() + v.slice(1)) },
          {
            clave: "despues", etiqueta: "Después de la visita", corta: "Después",
            opciones: [
              { valor: "contrato", etiqueta: "Le adjudicó un contrato" }, { valor: "orden", etiqueta: "Le dio una orden" },
              { valor: "antes", etiqueta: "Le vendió antes, no después" }, { valor: "no_cliente", etiqueta: "No le vende" },
            ],
          },
          { clave: "anio", etiqueta: "Año de la visita", corta: "Año", opciones: opcionesLocales(filas.map((f) => f.valores?.anio as string | null), (v) => v).reverse() },
        ]}
        ordenes={[
          { valor: "reciente", etiqueta: "Más recientes", clave: "fecha", dir: "desc" },
          { valor: "antigua", etiqueta: "Más antiguas", clave: "fecha", dir: "asc" },
          { valor: "rapido", etiqueta: "Lo que le dieron más pronto", clave: "dias", dir: "asc" },
        ]}
      />
    </div>
  );
}
