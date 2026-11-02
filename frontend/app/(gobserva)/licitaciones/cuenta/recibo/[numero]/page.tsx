import type { Metadata } from "next";
import { Recibo } from "@/components/gobserva/cuenta/Recibo";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Recibo", robots: { index: false, follow: false } };

export default function Page({ params }: { params: { numero: string } }) {
  return <Recibo producto="licitaciones" base={baseProducto("licitaciones")} numero={decodeURIComponent(params.numero)} />;
}
