import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payment Router",
  description:
    "Painel operacional do roteamento de pagamentos e do dropshipping nacional.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `lang="pt-BR"` não é detalhe: é o que faz o leitor de tela pronunciar
    // "pagamento" em português e o navegador oferecer a tradução certa.
    <html lang="pt-BR">
      {/* As classes no `body` valem para o site inteiro: fundo claro, texto
          escuro e o `antialiased`, que suaviza a fonte que o Tailwind usa. */}
      <body className="bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
