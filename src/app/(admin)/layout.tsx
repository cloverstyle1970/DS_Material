import AdminShell from "@/components/layout/AdminShell";
import { ThemeProvider } from "@/context/ThemeContext";
import { ViewModeProvider } from "@/context/ViewModeContext";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ViewModeProvider>
        <AdminShell>{children}</AdminShell>
      </ViewModeProvider>
    </ThemeProvider>
  );
}
