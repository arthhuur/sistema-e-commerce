import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Entrar · Payment Router",
};

/**
 * A rota `/login`.
 *
 * Ela é um componente de servidor e não faz nada além de centralizar o
 * formulário — que é um componente de cliente, porque só ele pode guardar o
 * que a pessoa digita enquanto o login acontece.
 *
 * Quem já tem sessão não fica aqui: a guarda em `src/proxy.ts` devolve para
 * o painel antes de a página sequer ser montada.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
