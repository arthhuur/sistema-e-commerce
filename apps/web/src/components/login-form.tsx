"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AuthenticatedUser, MfaChallenge } from "@payment-router/shared";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * A tela de entrada.
 *
 * POR QUE AS DUAS ETAPAS FICAM NO MESMO COMPONENTE.
 *
 * O login em duas etapas não é "duas telas": é uma entrada só, que às vezes
 * precisa de mais um dado. Separar em duas rotas obrigaria a carregar um
 * estado entre elas — e o jeito mais fácil de fazer isso (guardar o e-mail
 * numa URL, ou num cookie legível) vazaria justamente o que a segunda etapa
 * existe para proteger. Aqui o estado vive na memória da página e morre com
 * ela, que é o que se quer.
 *
 * O QUE O NAVEGADOR GUARDA, E O QUE ELE NÃO GUARDA.
 *
 * A senha, o código e o cookie de sessão NUNCA passam pelo estado do React
 * além do instante do envio — e o que importa mesmo é o último: ele sai como
 * cookie `httpOnly` gravado pela API, que o JavaScript desta página é incapaz
 * de ler. Ou seja, nem um XSS nesta tela conseguiria roubar a sessão.
 */

/** Em que ponto do login estamos. */
type Step = "credentials" | "mfa";

/** Classes repetidas dos campos — num lugar só, para não saírem do lugar. */
const FIELD =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100";
const LABEL = "text-sm font-medium text-slate-700";
const BUTTON =
  "mt-1 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";

export function LoginForm() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Primeira etapa: e-mail e senha. */
  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<AuthenticatedUser | MfaChallenge>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );

      // A API responde 200 nos DOIS desfechos possíveis: sessão aberta, ou
      // senha certa e falta o código. Quem separa um do outro é o campo
      // `mfaRequired`. A checagem é explícita de propósito: um "veio e-mail,
      // então entrou" trataria o segundo fator como opcional — e é assim que
      // uma proteção vira enfeite.
      if ("mfaRequired" in result) {
        setCode("");
        setStep("mfa");
        return;
      }

      enterPanel();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  /** Segunda etapa: o código do aplicativo (ou um de recuperação). */
  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await apiFetch<AuthenticatedUser>("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      });

      enterPanel();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Segue para o painel depois de entrar.
   *
   * `replace`, e não `push`: entrando, o botão "voltar" do navegador não deve
   * devolver a pessoa para a tela de login.
   *
   * Nada de guardar "estou logado" em algum estado do front. A sessão JÁ
   * existe — ela é o cookie que a API acabou de gravar — e quem a reconhece é
   * a guarda do servidor, na navegação seguinte.
   */
  function enterPanel() {
    router.replace("/painel");
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Payment Router</h1>
        <p className="mt-1 text-sm text-slate-500">
          {step === "credentials"
            ? "Entre com o seu e-mail e a sua senha."
            : "Informe o código do seu aplicativo autenticador."}
        </p>
      </header>

      {/* `role="alert"` faz o leitor de tela anunciar a falha assim que ela
          aparece — sem isso, quem não vê a tela não sabe que o envio falhou. */}
      {error !== null && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {step === "credentials" ? (
        <form onSubmit={submitCredentials} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>E-mail</span>
            <input
              className={FIELD}
              type="email"
              name="email"
              autoComplete="email"
              required
              autoFocus
              disabled={busy}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Senha</span>
            <input
              className={FIELD}
              type="password"
              name="password"
              autoComplete="current-password"
              // O mínimo de 8 casa com o que a API aceita. Barrar aqui evita
              // uma ida ao servidor só para ouvir o que já se sabe.
              minLength={8}
              required
              disabled={busy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button className={BUTTON} type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Código</span>
            <input
              className={FIELD}
              type="text"
              name="code"
              // Deixa o navegador oferecer o código que acabou de chegar por
              // SMS/e-mail, quando houver.
              autoComplete="one-time-code"
              // Sem `inputMode="numeric"`: o mesmo campo aceita um código de
              // recuperação, que tem letras. Um teclado só numérico no celular
              // tornaria a recuperação impossível justamente na hora do aperto.
              minLength={6}
              maxLength={32}
              required
              autoFocus
              disabled={busy}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <span className="text-xs text-slate-500">
              Os 6 dígitos do aplicativo, ou um dos códigos de recuperação.
            </span>
          </label>

          <button className={BUTTON} type="submit" disabled={busy}>
            {busy ? "Confirmando…" : "Confirmar código"}
          </button>

          <button
            type="button"
            className="text-sm text-slate-500 underline-offset-2 hover:underline"
            disabled={busy}
            onClick={() => {
              setStep("credentials");
              setCode("");
              setError(null);
            }}
          >
            Voltar
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Traduz qualquer falha numa frase para a tela.
 *
 * Se o erro veio da API, a mensagem já é a certa e é reaproveitada — escrever
 * de novo aqui criaria duas versões da mesma verdade, que um dia divergem. O
 * texto de reserva é só para o caso em que nem houve resposta (a API fora do
 * ar, a rede caindo), que é uma falha DIFERENTE e merece um aviso diferente.
 */
function describe(caught: unknown): string {
  if (caught instanceof ApiError) {
    return caught.message;
  }

  return "Não foi possível falar com o servidor. Verifique a sua conexão e tente de novo.";
}
