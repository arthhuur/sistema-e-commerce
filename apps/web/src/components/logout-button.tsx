"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

/**
 * O botão de sair.
 *
 * A ORDEM DAS COISAS AQUI IMPORTA.
 *
 * Primeiro a API é avisada. Só ela consegue REVOGAR o token de renovação: se
 * a tela simplesmente "esquecesse" a sessão e fosse embora, aquele token
 * continuaria valendo por até sete dias para quem tivesse uma cópia — em
 * outros termos, sair não teria saído de lugar nenhum.
 *
 * A navegação vem depois, e o estado de "carregando" fica até o fim, para o
 * clique repetido não disparar saídas em paralelo.
 *
 * E SE A API NÃO RESPONDER?
 *
 * Aí a pessoa é avisada e continua na tela. Pode parecer ruim, mas é o
 * comportamento honesto: os cookies de sessão são `httpOnly`, então o front
 * NÃO consegue apagá-los sozinho. Fingir que saiu — indo para `/login` sem
 * apagar nada — resultaria na guarda mandando a pessoa de volta ao painel, um
 * vaivém sem explicação, e com a sessão ainda viva por trás.
 */
export function LogoutButton() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setBusy(true);
    setError(null);

    try {
      // A API revoga o token e apaga os cookies na mesma resposta.
      await apiFetch<void>("/auth/logout", { method: "POST" });

      // Sem sessão, a guarda libera a tela de login.
      router.replace("/login");
    } catch {
      setError("Não foi possível sair agora. Tente de novo.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleLogout}
        disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Saindo…" : "Sair"}
      </button>

      {error !== null && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
