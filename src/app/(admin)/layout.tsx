import AdminShell from "@/components/layout/AdminShell";
import { ThemeProvider } from "@/context/ThemeContext";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AdminShell>{children}</AdminShell>
    </ThemeProvider>
  );
}
