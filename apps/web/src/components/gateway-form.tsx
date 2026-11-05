"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthenticatedUser, Gateway } from "@payment-router/shared";
import { ApiError, apiFetchWithSession } from "@/lib/api";

type GatewayFormMode = "create" | "edit";

interface GatewayFormValues {
  name: string;
  displayName: string;
  feePercent: string;
  feeFixed: string;
  approvalRate: string;
  active: boolean;
}

const EMPTY_VALUES: GatewayFormValues = {
  name: "",
  displayName: "",
  feePercent: "",
  feeFixed: "",
  approvalRate: "",
  active: true,
};

/**
 * O formulário de gateway, reaproveitado entre criar e editar.
 *
 * POR QUE UM COMPONENTE SÓ.
 *
 * Criar e editar pedem a MESMA conversa com a pessoa: nome técnico, nome
 * visível, taxas, aprovação e ativo/inativo. Duplicar isso em duas telas seria
 * duplicar validação, rótulo e erro. O bug clássico nasce aí: corrige num lugar
 * e esquece no outro. Um componente só força as duas rotas a falarem a mesma
 * língua.
 *
 * O QUE MUDA ENTRE OS MODOS.
 *
 * No modo "create", ele começa vazio e faz `POST /gateways`. No modo "edit",
 * ele carrega `GET /gateways/:id`, preenche os campos e salva com
 * `PATCH /gateways/:id`. O corpo da tela é o mesmo; muda só a origem e o
 * destino do dado.
 */
export function GatewayForm({
  mode,
  gatewayId,
}: {
  mode: GatewayFormMode;
  gatewayId?: string;
}) {
  const router = useRouter();

  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [values, setValues] = useState<GatewayFormValues>(EMPTY_VALUES);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    if (mode === "create") {
      apiFetchWithSession<AuthenticatedUser>("/auth/me", {
        signal: controller.signal,
      }).then(
        (me) => {
          setUser(me);
          setFailure(null);
        },
        (caught: unknown) => {
          if (isAbort(caught)) {
            return;
          }

          if (caught instanceof ApiError && caught.status === 401) {
            router.replace("/login");
            return;
          }

          setUser(null);
          setFailure(
            caught instanceof ApiError
              ? caught.message
              : "Não foi possível carregar os seus dados.",
          );
        },
      );

      return () => controller.abort();
    }

    void Promise.allSettled([
      apiFetchWithSession<AuthenticatedUser>("/auth/me", {
        signal: controller.signal,
      }),
      apiFetchWithSession<Gateway>(`/gateways/${gatewayId}`, {
        signal: controller.signal,
      }),
    ]).then(([me, gatewayResult]) => {
      if (me.status === "rejected") {
        const caught: unknown = me.reason;

        if (isAbort(caught)) {
          return;
        }

        if (caught instanceof ApiError && caught.status === 401) {
          router.replace("/login");
          return;
        }

        setUser(null);
        setFailure(
          caught instanceof ApiError
            ? caught.message
            : "Não foi possível carregar os seus dados.",
        );
        return;
      }

      setUser(me.value);

      if (gatewayResult.status === "fulfilled") {
        setValues(toFormValues(gatewayResult.value));
        setFailure(null);
        return;
      }

      if (isAbort(gatewayResult.reason)) {
        return;
      }

      setFailure(
        gatewayResult.reason instanceof ApiError
          ? gatewayResult.reason.message
          : "Não foi possível carregar o gateway.",
      );
    });

    return () => controller.abort();
  }, [gatewayId, mode, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = toPayload(values);
    if ("message" in payload) {
      setSubmitError(payload.message);
      return;
    }

    setSaving(true);
    setSubmitError(null);

    try {
      await apiFetchWithSession<Gateway>(
        mode === "create" ? "/gateways" : `/gateways/${gatewayId}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          body: JSON.stringify(payload),
        },
      );

      router.replace("/gateways");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace("/login");
        return;
      }

      setSubmitError(
        caught instanceof ApiError
          ? caught.message
          : mode === "create"
            ? "Não foi possível cadastrar o gateway."
            : "Não foi possível salvar o gateway.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (failure !== null) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
        <p role="alert" className="text-sm text-slate-600">
          {failure}
        </p>
      </section>
    );
  }

  if (user === null) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  if (user.role !== "gerente") {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
        Só o perfil Gerente pode cadastrar, editar ou excluir gateways. A
        consulta e a simulação continuam disponíveis na{" "}
        <Link href="/gateways" className="underline underline-offset-4">
          lista de gateways
        </Link>
        .
      </section>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-6 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nome técnico"
          hint='Ex.: "mercado_pago". É o identificador que aparece em log e integrações.'
        >
          <input
            type="text"
            value={values.name}
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </Field>

        <Field
          label="Nome exibido"
          hint='Ex.: "Mercado Pago". É o que a operação lê na tela.'
        >
          <input
            type="text"
            value={values.displayName}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                displayName: event.target.value,
              }))
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </Field>

        <Field
          label="Taxa percentual (%)"
          hint="Vai direto para a API como percentual de 0 a 100."
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={values.feePercent}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                feePercent: event.target.value,
              }))
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </Field>

        <Field
          label="Taxa fixa (R$)"
          hint="A API guarda em centavos; a tela pede em reais porque é assim que a operação pensa."
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={values.feeFixed}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                feeFixed: event.target.value,
              }))
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </Field>

        <Field
          label="Aprovação observada (%)"
          hint="A API espera uma proporção de 0 a 1. Aqui a pessoa digita em porcentagem, e a conversão acontece antes do envio."
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={values.approvalRate}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                approvalRate: event.target.value,
              }))
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </Field>

        <label className="flex items-center gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                active: event.target.checked,
              }))
            }
            className="size-4 rounded border-slate-300"
          />
          Gateway ativo
        </label>
      </div>

      {submitError !== null && (
        <p role="alert" className="text-sm text-slate-600">
          {submitError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving
            ? mode === "create"
              ? "Cadastrando…"
              : "Salvando…"
            : mode === "create"
              ? "Cadastrar gateway"
              : "Salvar alterações"}
        </button>

        <Link
          href="/gateways"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-700">
      <span>{label}</span>
      {children}
      <span className="text-xs text-slate-500">{hint}</span>
    </label>
  );
}

function toFormValues(gateway: Gateway): GatewayFormValues {
  return {
    name: gateway.name,
    displayName: gateway.displayName,
    feePercent: String(gateway.feePercent),
    feeFixed: formatReaisInput(gateway.feeFixed),
    approvalRate: formatPercentInput(gateway.approvalRate * 100),
    active: gateway.active,
  };
}

function toPayload(values: GatewayFormValues):
  | {
      name: string;
      displayName: string;
      feePercent: number;
      feeFixed: number;
      approvalRate: number;
      active: boolean;
    }
  | { message: string } {
  const name = values.name.trim();
  const displayName = values.displayName.trim();
  const feePercent = Number(values.feePercent.replace(",", "."));
  const feeFixed = toCents(values.feeFixed);
  const approvalRatePercent = Number(values.approvalRate.replace(",", "."));

  if (name === "" || displayName === "") {
    return { message: "Preencha o nome técnico e o nome exibido." };
  }

  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
    return { message: "A taxa percentual precisa ficar entre 0 e 100." };
  }

  if (feeFixed === null || feeFixed < 0) {
    return { message: "A taxa fixa precisa ser um valor igual ou maior que zero." };
  }

  if (
    !Number.isFinite(approvalRatePercent) ||
    approvalRatePercent < 0 ||
    approvalRatePercent > 100
  ) {
    return {
      message: "A aprovação observada precisa ficar entre 0% e 100%.",
    };
  }

  return {
    name,
    displayName,
    feePercent,
    feeFixed,
    approvalRate: approvalRatePercent / 100,
    active: values.active,
  };
}

function formatReaisInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatPercentInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function toCents(raw: string): number | null {
  const reais = Number(raw.replace(",", "."));

  if (!Number.isFinite(reais)) {
    return null;
  }

  return Math.round(reais * 100);
}

function isAbort(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}
