"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Paginated, Payment, PaymentStatus } from "@payment-router/shared";
import { ApiError, apiFetchWithSession } from "@/lib/api";
import { formatBRL, formatDateTime } from "@/lib/format";

/**
 * A tela de pagamentos: o extrato da operação.
 *
 * O painel responde "como está o movimento de hoje?". Esta tela responde a
 * segunda pergunta — "onde está aquele pedido?" — e por isso é um extrato:
 * muitas linhas, do mais recente para o mais antigo, com o detalhe escondido
 * atrás de um clique.
 *
 * POR QUE O ESTADO MORA NA URL.
 *
 * Página, período e (no futuro) status vivem no endereço, não em `useState`.
 * A diferença aparece no dia a dia: com o estado na URL, o F5 mantém a pessoa
 * onde ela estava, o botão "voltar" do navegador funciona como se espera, e um
 * colega pode receber o link já filtrado. Guardado em memória, tudo isso se
 * perde no primeiro recarregamento — e o usuário culpa a tela.
 *
 * POR QUE A CARGA É "CHAVEADA".
 *
 * Cada resposta é guardada junto da consulta que a pediu (`key`). A tela só
 * aceita a resposta cuja chave bate com a consulta de agora. Sem esse cuidado,
 * trocar o filtro rápido duas vezes poderia fazer a resposta VELHA chegar
 * depois da nova e sobrescrevê-la — a tela mostraria o resultado do filtro
 * anterior, um bug que não se reproduz quando se testa devagar.
 */

/** Itens por página. O mesmo padrão que o servidor aplica quando ninguém pede. */
const PAGE_SIZE = 20;

/** Os status em português. Hoje só existe um — o mapa cresce junto com a API. */
const STATUS_LABELS: Record<PaymentStatus, string> = {
  approved: "Aprovado",
};

/** Uma página já carregada, amarrada à consulta que a produziu. */
interface LoadedPage {
  key: string;
  value: Paginated<Payment>;
}

/** Uma falha, amarrada à consulta que a produziu. */
interface FailedQuery {
  key: string;
  message: string;
}

export function PaymentsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A URL é a fonte da verdade: se o endereço diz `page=3`, é a página 3.
  const page = readPage(searchParams.get("page"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  // A identidade da consulta de agora. É contra ela que as respostas são
  // conferidas antes de virar tela.
  const queryKey = `${page}|${from}|${to}`;

  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [failed, setFailed] = useState<FailedQuery | null>(null);

  // Qual linha está com o detalhe aberto. Um clique abre, outro fecha.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const result = loaded !== null && loaded.key === queryKey ? loaded.value : null;
  const failure =
    failed !== null && failed.key === queryKey ? failed.message : null;

  // "Carregando" não é um estado guardado: é o que sobra quando não há nem
  // resposta nem erro para a consulta atual. Derivar evita a classe de bug em
  // que o `loading` fica `true` para sempre porque alguém esqueceu de baixá-lo.
  const loading = result === null && failure === null;

  useEffect(() => {
    // O `AbortController` cancela a busca anterior quando a consulta muda. Sem
    // ele, cada tecla digitada no filtro deixaria uma requisição viva.
    const controller = new AbortController();

    apiFetchWithSession<Paginated<Payment>>(buildQuery({ page, from, to }), {
      signal: controller.signal,
    }).then(
      (value) => {
        setLoaded({ key: queryKey, value });
        setFailed(null);
      },
      (caught: unknown) => {
        // Busca cancelada porque a consulta mudou: não é erro, é descarte.
        if (isAbort(caught)) {
          return;
        }

        if (caught instanceof ApiError && caught.status === 401) {
          // A sessão acabou mesmo depois da renovação automática. Mandar para o
          // login é mais honesto do que ficar repetindo um erro na tela.
          router.replace("/login");
          return;
        }

        setLoaded(null);
        setFailed({
          key: queryKey,
          message:
            caught instanceof ApiError
              ? caught.message
              : "Não foi possível carregar os pagamentos.",
        });
      },
    );

    return () => controller.abort();
  }, [queryKey, page, from, to, router]);

  /**
   * Reescreve a URL com as mudanças pedidas.
   *
   * Valor `null` ou vazio REMOVE o parâmetro, em vez de deixá-lo no endereço
   * sem valor. É o que mantém o link limpo (`/pagamentos` e não
   * `/pagamentos?from=&to=&page=`) — e o que faz o F5 voltar ao estado padrão.
   */
  function changeQuery(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    router.push(query === "" ? pathname : `${pathname}?${query}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            De
            <input
              type="date"
              value={from}
              // Mudar o filtro volta para a primeira página: continuar na
              // página 7 de um resultado novo mostraria uma lista vazia sem
              // explicação.
              onChange={(event) =>
                changeQuery({ from: event.target.value, page: null })
              }
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Até
            <input
              type="date"
              value={to}
              onChange={(event) =>
                changeQuery({ to: event.target.value, page: null })
              }
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800"
            />
          </label>

          {/* Só aparece quando há algo para limpar: um botão sempre visível que
              não faz nada é ruído. */}
          {(from !== "" || to !== "") && (
            <button
              type="button"
              onClick={() => changeQuery({ from: null, to: null, page: null })}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Limpar período
            </button>
          )}
        </div>
      </section>

      {loading && <p className="text-sm text-slate-500">Carregando…</p>}

      {failure !== null && (
        <p
          role="alert"
          className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600"
        >
          {failure}
        </p>
      )}

      {result !== null &&
        (result.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
            Nenhum pagamento encontrado neste período.
          </p>
        ) : (
          <section className="rounded-xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {result.data.map((payment) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  expanded={expandedId === payment.id}
                  onToggle={() =>
                    setExpandedId(expandedId === payment.id ? null : payment.id)
                  }
                />
              ))}
            </ul>
          </section>
        ))}

      {result !== null && result.total > 0 && (
        <Pagination
          page={page}
          total={result.total}
          limit={result.limit}
          onChange={(next) => changeQuery({ page: String(next) })}
        />
      )}
    </div>
  );
}

/**
 * Uma linha do extrato, que abre o registro completo ao ser clicada.
 *
 * A linha inteira é um `<button>`, e não uma `<div>` com `onClick`: só o botão
 * recebe foco pelo teclado e é anunciado como algo clicável por leitores de
 * tela. Um `onClick` numa `<div>` funciona no mouse e deixa todo o resto de
 * fora — é a diferença entre um sistema que abre no celular do dono e um que
 * só abre no computador de quem o escreveu.
 */
function PaymentRow({
  payment,
  expanded,
  onToggle,
}: {
  payment: Payment;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">
            {payment.productId}
          </p>
          <p className="text-xs text-slate-500">
            {payment.gatewayName} · {formatDateTime(payment.createdAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <p className="text-sm font-semibold">
            {formatBRL(payment.amountInCents)}
          </p>
          {/* A seta é a única pista de que a linha abre. Sem ela, ninguém
              clica — e o detalhe nunca é visto. */}
          <span aria-hidden className="text-slate-400">
            {expanded ? "▾" : "▸"}
          </span>
        </div>
      </button>

      {expanded && (
        <dl className="grid gap-x-6 gap-y-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:grid-cols-2">
          <Detail label="Valor cobrado" value={formatBRL(payment.amountInCents)} />
          <Detail label="Taxas do gateway" value={formatBRL(payment.totalFeeInCents)} />
          <Detail label="Líquido recebido" value={formatBRL(payment.netAmountInCents)} />
          <Detail label="Status" value={STATUS_LABELS[payment.status]} />
          <Detail label="Produto" value={payment.productId} />
          <Detail label="Gateway" value={`${payment.gatewayName} (${payment.gatewayId})`} />
          <Detail label="Data" value={formatDateTime(payment.createdAt)} />
          <Detail label="Identificador" value={payment.id} />
        </dl>
      )}
    </li>
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
 * O rodapé de navegação entre páginas.
 *
 * Ele não guarda estado nem busca nada: recebe os números e avisa quem o usa
 * quando alguém pede outra página. Assim a paginação não decide nada sozinha —
 * quem manda continua sendo a URL.
 */
function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Se a URL pedir uma página que não existe mais (alguém apagou dados, ou
  // digitou o número à mão), a navegação se ancora na última real em vez de
  // oferecer um "anterior" que levaria a lugar nenhum.
  const current = Math.min(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-sm text-slate-500">
        Página {current} de {totalPages} · {total}{" "}
        {total === 1 ? "pagamento" : "pagamentos"}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={current >= totalPages}
          onClick={() => onChange(current + 1)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

/** Monta o caminho da API para uma consulta. */
function buildQuery({
  page,
  from,
  to,
}: {
  page: number;
  from: string;
  to: string;
}): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });

  // Parâmetro vazio NÃO é enviado. A API valida `from`/`to` como data ISO: um
  // `from=` vazio seria recusado com 400 — um erro causado por um filtro que a
  // pessoa nem usou.
  if (from !== "") {
    params.set("from", from);
  }
  if (to !== "") {
    params.set("to", to);
  }

  return `/payments?${params.toString()}`;
}

/**
 * Lê o número da página da URL, com piso em 1.
 *
 * A URL é texto que qualquer um edita. `?page=abc` ou `?page=-3` não podem
 * virar uma consulta inválida: viram a página 1, que é o que a pessoa queria
 * dizer quando não disse nada de útil.
 */
function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Um erro de busca cancelada — não é falha, é descarte. */
function isAbort(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}
