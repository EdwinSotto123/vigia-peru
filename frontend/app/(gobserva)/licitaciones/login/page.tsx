import { redirect } from "next/navigation";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** «Ingresar» lleva a /login: la página de entrar es /entrar (con la misma vuelta, `next`). */
export default function Login({ searchParams }: { searchParams?: { next?: string } }) {
  const next = searchParams?.next?.startsWith("/") ? searchParams.next : "/app/bandeja";
  redirect(rutaEn(baseProducto("licitaciones"), `/entrar?next=${encodeURIComponent(next)}`));
}
