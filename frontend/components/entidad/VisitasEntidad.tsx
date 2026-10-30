import { CloudOff, DoorOpen } from "lucide-react";
import { Indicadores, type Indicador } from "@/components/listado";
import { AyudaTermino, FuenteDato, Nota } from "@/components/patrones";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { fecha, fechaConAnio, numero, plural, porcentaje } from "@/lib/formato";
import { getVisitasEntidad } from "@/lib/visitas";
import { Areas, EmpresasDeSuGente, ListaVisitas, Organizaciones, Parientes } from "./VisitasTablas";

/**
 * La pestaña «Visitas» de una entidad (fase 2.3 del plan del 2026-10-27): quiénes la visitan y qué ganaron después, a qué
 * oficinas, las visitas de familiares declarados de sus funcionarios (sin decir quiénes) y la lista con sus filtros (quien
 * decide, fuera del horario, familiares). Antes las visitas sólo se veían desde la ficha de una empresa. Server component:
 * las cifras aquí; las tablas, armadas en el navegador (VisitasTablas).
 */
export async function VisitasEntidad({ ruc }: { ruc: string }) {
  const d = await getVisitasEntidad(ruc);
  if (!d) {
    return (
      <EstadoVacio variante="compacta" tono="error" icono={<CloudOff size={16} />}>
        No pudimos leer sus visitas ahora. Vuelve a intentarlo en un momento.
      </EstadoVacio>
    );
  }
  if (!d.total || !d.resumen) {
    return (
      <EstadoVacio variante="compacta" icono={<DoorOpen size={16} />}>
        No tenemos visitas registradas de esta entidad. El registro de la PCM no se puede consultar de forma automática: cargamos
        sus reportes publicados y el registro del Congreso.
      </EstadoVacio>
    );
  }
  const r = d.resumen;
  const orgs = d.organizaciones ?? [];
  const sinDespues = d.despuesSinCalcular === true;
  // Las empresas que ganaron algo después de una visita de su gente (migración 203: también por su socio, representante o
  // directivo); sin ese bloque, las organizaciones que declararon venir de una empresa reconocida.
  const emp = d.empresas;
  const ganaron = emp ? emp.ganaron : orgs.filter((o) => o.despues).length;
  const cifras: Indicador[] = [
    {
      valor: numero(d.total),
      etiqueta: d.total === 1 ? "visita registrada" : "visitas registradas",
      contexto: d.desde && d.hasta ? `del ${fechaConAnio(d.desde)} al ${fechaConAnio(d.hasta)}` : undefined,
      ayuda: <AyudaTermino clave="registro-visitas" />,
    },
    {
      valor: numero(r.privadas),
      etiqueta: "de empresas y organizaciones privadas",
      contexto: sinDespues && !emp
        ? `${porcentaje((r.privadas / d.total) * 100, { decimales: 0 })} del total`
        : `${porcentaje((r.privadas / d.total) * 100, { decimales: 0 })} del total; ${plural(ganaron, "empresa ganó algo después", "empresas ganaron algo después")}`,
      href: emp && emp.ganaron > 0 ? "#visitas-empresas" : undefined,
    },
    {
      valor: numero(r.decisores),
      etiqueta: "a quien decide las compras",
      contexto: "titular, gerencia, administración, logística o un comité",
      ayuda: <AyudaTermino clave="visita-decisor" />,
    },
    r.parientes > 0
      ? {
          valor: numero(r.parientes),
          etiqueta: r.parientes === 1 ? "visita de un familiar de un funcionario" : "visitas de familiares de funcionarios",
          contexto: "declarados en su DJI; no se dice quiénes",
          ayuda: <AyudaTermino clave="dji" />,
        }
      : {
          valor: numero(r.fueraDeHora),
          etiqueta: "fuera del horario de oficina",
          contexto: "antes de las 7, desde las 19 o en fin de semana",
          ayuda: <AyudaTermino clave="visita-fuera-horario" />,
        },
  ];

  return (
    <div className="space-y-6">
      <Indicadores items={cifras} />
      <Nota>
        Las visitas vienen de los reportes que publicó la entidad o la PCM y, en el Congreso, de su propio registro; llegan hasta el{" "}
        {d.hasta ? fecha(d.hasta) : "último día cargado"}. De quien recibe la visita se muestra sólo su cargo y su área; de quien visita,
        su nombre con un apellido tapado, y nada si es familiar de un funcionario.
      </Nota>
      {emp && emp.lista.length > 0 && <EmpresasDeSuGente e={emp} entidadRuc={ruc} />}
      {orgs.length > 0 && <Organizaciones orgs={orgs} sinDespues={sinDespues} />}
      {(d.parientes ?? []).length > 0 && <Parientes ps={d.parientes!} entidadRuc={ruc} fuentes={d.fuentes} />}
      {(d.areas ?? []).length > 0 && <Areas areas={d.areas!} />}
      <ListaVisitas vs={d.visitas ?? []} total={d.total} />
      <FuenteDato fuente="El registro de visitas de cada entidad" enlaces={d.fuentes ?? []} />
    </div>
  );
}
