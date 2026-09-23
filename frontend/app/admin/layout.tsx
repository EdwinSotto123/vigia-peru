import { DialogProvider } from "@/components/admin/Dialog";

export const metadata = { title: "Panel de administración", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <DialogProvider>{children}</DialogProvider>;
}
