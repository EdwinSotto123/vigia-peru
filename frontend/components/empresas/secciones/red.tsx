import { RedFicha } from "@/components/personas/ficha/RedPersona";
import { EstadoVacio } from "@/components/patrones";
import { fecha as fechaLarga, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { ClienteEmpresa, SociosEmpresa } from "@/lib/empresas";
import { idEmpresaRed, redDeEmpresa } from "@/lib/redEmpresa";

/**
 * La red de una empresa (vista «Red» de «Su gente»): su gente, las otras empresas de esa gente y sus clientes del Estado,
 * en el mismo grafo que la red de una persona (RedFicha). Con lo que la ficha ya trae: socios (RNP) y clientes.
 */
export async function RedEmpresa({
  empresa,
  socios,
  clientes,
}: {
  empresa: { ruc: string; nombre: string };
  socios: Promise<SociosEmpresa | null>;
  clientes: Promise<{ total: number; data: ClienteEmpresa[] } | null>;
}) {
  const [s, c] = await Promise.all([socios, clientes]);
  if (!s && !c) {
    return <EstadoVacio titulo="No pudimos armar la red">Sus socios y sus clientes no respondieron a tiempo: vuelve a cargar la página en un momento.</EstadoVacio>;
  }
  const red = redDeEmpresa(empresa, s, c?.data ?? [], {
    formato: { nombre: tituloNatural, soles: solesCompacto, fecha: (d) => fechaLarga(d) },
  });
  if (red.nodos.length < 3) {
    return <EstadoVacio titulo="Sin red que mostrar">No figuran socios ni clientes del Estado con montos para esta empresa.</EstadoVacio>;
  }
  return (
    <RedFicha
      red={red}
      foco={idEmpresaRed(empresa.ruc)}
      de="la empresa"
      grupos={{ persona: "Su gente", empresa: "Empresas", entidad: "Sus clientes del Estado" }}
      nombres={{ persona: "Persona de la empresa" }}
    />
  );
}
