import { robotsDe } from "@/lib/gobserva-seo";

export const dynamic = "force-static";

export function GET() {
  return robotsDe("obras");
}
