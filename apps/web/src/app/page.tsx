import { redirect } from "next/navigation";

/**
 * A porta de entrada do site.
 *
 * Não há tela de boas-vindas: quem chega quer entrar ou já está dentro. O
 * desvio é feito para `/painel`, e quem decide se aquilo é permitido é a
 * guarda em `src/proxy.ts` — se não houver sessão, ela manda para `/login`.
 *
 * Manter essa decisão num lugar só (a guarda) evita o clássico "a regra
 * existe em dois arquivos e um dia eles discordam".
 */
export default function Home() {
  redirect("/painel");
}
