import Link from "next/link";
import type { Metadata } from "next";
import { GatewayForm } from "@/components/gateway-form";

export const metadata: Metadata = {
  title: "Editar gateway · Payment Router",
};

export const instant = false;

export default async function EditGatewayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Editar gateway
          </h1>
          <p className="text-sm text-slate-500">
            Ajuste taxas, aprovação observada e o status deste gateway.
          </p>
        </div>

        <Link
          href="/gateways"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Voltar aos gateways
        </Link>
      </header>

      <GatewayForm mode="edit" gatewayId={id} />
    </main>
  );
}
