"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  AuthenticatedUser,
  Gateway,
  GatewayFeeEstimate,
} from "@payment-router/shared";
import { ApiError, apiFetchWithSession } from "@/lib/api";
import { formatBRL, formatPercent } from "@/lib/format";

/**
 * A tela de gateways: por onde o dinheiro entra e quanto cada caminho custa.
 *
 * POR QUE ELA É DE CLIENTE.
 *
 * Precisa de dois dados que só o navegador tem: a sessão (que existe apenas
 * como cookie `httpOnly`) e o que a API responde. A guarda do servidor
 * (`proxy.ts`) já garantiu que existe um cookie antes desta tela montar; o que
 * ela faz aqui é buscar a lista de verdade e, se a sessão tiver acabado nesse
 * meio-tempo, tirar a pessoa daqui.
 *
 * POR QUE A LISTA É CURTA E SEM FILTRO AINDA.
 *
 * Hoje é um punhado de gateways — cabe numa tela. Um filtro de ativos com
 * poucas linhas economizaria um scroll e custaria uma leitura da URL inteira
 * (estado, `<Suspense>`, carga "chaveada"). Ele entra quando a lista justificar,
 * e aí a tela de pagamentos serve de molde.
 */
export function GatewaysExplorer() {
  const router = useRouter();

  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [gateways, setGateways] = useState<Gateway[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  // Qual gateway está com o detalhe aberto. Um clique abre, outro fecha.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /**
   * Muda a cada "tentar de novo".
   *
   * Serve como gatilho do efeito. É um contador, e não o texto do erro, porque
   * a intenção é "buscar outra vez" — e duas tentativas seguidas precisam ser
   * duas buscas, não uma.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // `AbortController` cancela a busca se a tela sair antes da resposta. Sem
    // ele, a resposta chegaria para um componente que já não existe.
    const controller = new AbortController();

    void Promise.allSettled([
      apiFetchWithSession<AuthenticatedUser>("/auth/me", {
        signal: controller.signal,
      }),
      apiFetchWithSession<Gateway[]>("/gateways", {
        signal: controller.signal,
      }),
    ]).then(([me, gatewaysResult]) => {
      if (me.status === "rejected") {
        const caught: unknown = me.reason;

        if (isAbort(caught)) {
          return;
        }

        if (caught instanceof ApiError && caught.status === 401) {
          // A sessão acabou mesmo depois da renovação automática. Login é mais
          // honesto do que repetir um erro na tela.
          router.replace("/login");
          return;
        }

        setUser(null);
        setGateways(null);
        setFailure(
          caught instanceof ApiError
            ? caught.message
            : "Não foi possível carregar os seus dados.",
        );
        return;
      }

      setUser(me.value);

      if (gatewaysResult.status === "fulfilled") {
        setGateways(gatewaysResult.value);
        setFailure(null);
        return;
      }

      if (isAbort(gatewaysResult.reason)) {
        return;
      }

      setGateways(null);
      setFailure(
        gatewaysResult.reason instanceof ApiError
          ? gatewaysResult.reason.message
          : "Não foi possível carregar os gateways.",
      );
    });

    return () => controller.abort();
  }, [attempt, router]);

  // "Carregando" é o que sobra quando não há nem lista nem erro. Derivar evita
  // o bug clássico do `loading` que fica `true` para sempre.
  const loading = user === null && gateways === null && failure === null;
  const canManage = user?.role === "gerente";

  async function removeGateway(gateway: Gateway) {
    setActionError(null);
    setDeletingId(gateway.id);

    try {
      await apiFetchWithSession<void>(`/gateways/${gateway.id}`, {
        method: "DELETE",
      });

      setGateways((current) =>
        current === null
          ? current
          : current.filter(({ id }) => id !== gateway.id),
      );
      setConfirmingDeleteId((current) =>
        current === gateway.id ? null : current,
      );
      setExpandedId((current) => (current === gateway.id ? null : current));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace("/login");
        return;
      }

      setActionError(
        caught instanceof ApiError
          ? caught.message
          : "Não foi possível excluir o gateway.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {user !== null && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">
            {canManage
              ? "Aqui você compara, cadastra, edita e remove gateways."
              : "Aqui você compara taxas e simula cenários. Alterações ficam só com o perfil Gerente."}
          </p>

          {canManage && (
            <Link
              href="/gateways/novo"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Novo gateway
            </Link>
          )}
        </section>
      )}

      {loading && <p className="text-sm text-slate-500">Carregando…</p>}

      {failure !== null && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-5">
          <p role="alert" className="text-sm text-slate-600">
            {failure}
          </p>
          <button
            type="button"
            onClick={() => {
              setFailure(null);
              setAttempt((current) => current + 1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {actionError !== null && (
        <p
          role="alert"
          className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600"
        >
          {actionError}
        </p>
      )}

      {/* Lista vazia não é erro: é uma loja que ainda não cadastrou gateway. A
          tela precisa dizer isso com todas as letras, senão o vazio parece
          falha de carregamento. */}
      {gateways !== null &&
        (gateways.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
            Nenhum gateway cadastrado ainda.
          </p>
        ) : (
          <section className="rounded-xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {gateways.map((gateway) => (
                <GatewayRow
                  key={gateway.id}
                  gateway={gateway}
                  canManage={canManage}
                  deleting={deletingId === gateway.id}
                  confirmingDelete={confirmingDeleteId === gateway.id}
                  expanded={expandedId === gateway.id}
                  onToggle={() =>
                    setExpandedId(expandedId === gateway.id ? null : gateway.id)
                  }
                  onAskDelete={() => {
                    setActionError(null);
                    setConfirmingDeleteId(gateway.id);
                  }}
                  onCancelDelete={() =>
                    setConfirmingDeleteId((current) =>
                      current === gateway.id ? null : current,
                    )
                  }
                  onDelete={() => void removeGateway(gateway)}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/**
 * Uma linha da lista, que abre os detalhes e o simulador ao ser clicada.
 *
 * A linha inteira é um `<button>`, e não uma `<div>` com `onClick`: só o botão
 * recebe foco pelo teclado e é anunciado como clicável por leitores de tela.
 * É a diferença entre um sistema que abre no celular do dono e um que só abre
 * no computador de quem o escreveu.
 */
function GatewayRow({
  gateway,
  canManage,
  deleting,
  confirmingDelete,
  expanded,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  gateway: Gateway;
  canManage: boolean;
  deleting: boolean;
  confirmingDelete: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-800">
              {gateway.displayName}
            </p>
            <StatusBadge active={gateway.active} />
          </div>
          {/* O resumo cabe numa linha só: percentual + fixo. É o que decide a
              escolha do gateway, e por isso aparece sem precisar abrir. */}
          <p className="truncate text-xs text-slate-500">
            {gateway.name} · {formatPercent(gateway.feePercent)} +{" "}
            {formatBRL(gateway.feeFixed)}
          </p>
        </div>

        {/* A seta é a única pista de que a linha abre. Sem ela, ninguém clica
            — e o simulador nunca é visto. */}
        <span aria-hidden className="shrink-0 text-slate-400">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Detail
              label="Taxa percentual"
              value={formatPercent(gateway.feePercent)}
            />
            <Detail label="Taxa fixa" value={formatBRL(gateway.feeFixed)} />
            {/* `approvalRate` chega como proporção (0,92). A tela converte para
                "92%": proporção é boa para calcular, ruim para ler. */}
            <Detail
              label="Aprovação observada"
              value={formatPercent(gateway.approvalRate * 100, 0)}
            />
          </dl>

          <FeeSimulator gateway={gateway} />

          {canManage && (
            <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200 pt-4">
              <Link
                href={`/gateways/${gateway.id}/editar`}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Editar gateway
              </Link>
              <button
                type="button"
                disabled={deleting}
                onClick={onAskDelete}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Excluir gateway
              </button>
            </div>
          )}

          {canManage && confirmingDelete && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-800">
                Excluir o gateway &quot;{gateway.displayName}&quot;? Esta ação não pode
                ser desfeita.
              </p>
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? "Excluindo…" : "Confirmar exclusão"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={onCancelDelete}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A simulação de taxa: "quanto sobra se eu vender R$ X por este gateway?".
 *
 * O cálculo NÃO acontece aqui. A tela manda o valor para
 * `GET /gateways/:id/estimate` e mostra o que voltou. Refazer a conta no front
 * daria um número que o servidor não confirma — e ele divergiria do extrato no
 * primeiro dia. O front formata; quem soma é o servidor.
 */
function FeeSimulator({ gateway }: { gateway: Gateway }) {
  const router = useRouter();

  // O valor digitado fica em REAIS, porque é assim que a pessoa pensa no
  // preço. Vira centavos só na hora de chamar a API.
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<GatewayFeeEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function simulate(event: FormEvent) {
    event.preventDefault();

    const cents = toCents(amount);

    // A validação local existe para dar uma mensagem útil sem gastar uma
    // viagem de rede. A API valida de novo (exige inteiro >= 1) — a checagem
    // daqui é conveniência, não a proteção.
    if (cents === null) {
      setResult(null);
      setError("Informe um valor maior que zero para simular.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const estimate = await apiFetchWithSession<GatewayFeeEstimate>(
        `/gateways/${gateway.id}/estimate?amountInCents=${cents}`,
      );
      setResult(estimate);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace("/login");
        return;
      }

      setResult(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Não foi possível estimar a taxa.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={simulate} className="mt-4 border-t border-slate-200 pt-4">
      <p className="text-xs text-slate-500">Simular taxa</p>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Valor da venda (R$)
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Calculando…" : "Calcular"}
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-slate-600">
          {error}
        </p>
      )}

      {result !== null && (
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-4">
          <Detail label="Valor" value={formatBRL(result.amountInCents)} />
          <Detail label="Taxa fixa" value={formatBRL(result.feeFixedInCents)} />
          <Detail
            label="Taxa percentual"
            value={formatBRL(result.feePercentInCents)}
          />
          <Detail
            label="Total de taxas"
            value={formatBRL(result.totalFeeInCents)}
          />
          <Detail
            label="Líquido recebido"
            value={formatBRL(result.netAmountInCents)}
          />
        </dl>
      )}
    </form>
  );
}

/** Um campo do detalhe: o rótulo pequeno em cima, o valor embaixo. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * A etiqueta de ativo/inativo.
 *
 * Existe porque a lista mostra TODOS os gateways, ativos e inativos. Sem a
 * etiqueta, um gateway desligado pareceria igual a um que está no ar — e
 * alguém ia se perguntar por que uma venda não passou por ele.
 */
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

/**
 * Converte o texto digitado em reais para centavos inteiros.
 *
 * Aceita vírgula ("12,50") porque é assim que o teclado brasileiro escreve — e
 * `Number("12,50")` seria `NaN`. Devolve `null` para entrada vazia, zero ou
 * texto que não é número, e quem chama transforma isso numa mensagem. A API
 * nunca recebe valor inválido (ela exigiria inteiro >= 1 de qualquer forma).
 */
function toCents(raw: string): number | null {
  const reais = Number(raw.replace(",", "."));

  if (!Number.isFinite(reais) || reais <= 0) {
    return null;
  }

  return Math.round(reais * 100);
}

/** Um erro de busca cancelada — não é falha, é descarte. */
function isAbort(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}
