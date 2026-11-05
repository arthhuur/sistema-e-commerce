/**
 * A formatação de valores para a tela.
 *
 * POR QUE ESTE ARQUIVO EXISTE.
 *
 * Os valores chegam da API em CENTAVOS, como inteiros — a API nunca manda
 * `1450.0` para dizer mil e quatrocentos e cinquenta reais, porque dinheiro em
 * ponto flutuante arredonda errado e o erro aparece no extrato. Quem vira
 * "R$ 1.450,00" é a tela.
 *
 * Se cada componente fizesse essa conta do seu jeito, dois lugares mostrariam
 * o mesmo valor escrito de formas diferentes — e alguém ia passar um dia
 * procurando um bug que é só formatação.
 *
 * O `Intl` do próprio navegador cuida do formato brasileiro (ponto de milhar,
 * vírgula decimal, símbolo na frente, `R$`). Escrever isso à mão seria
 * reimplementar, pior, algo que já vem pronto.
 */

/** Converte centavos em "R$ 1.450,00". */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

/**
 * Converte uma proporção no texto em português, ex.: 3.99 -> "3,99%".
 *
 * O `%` já vem colado no número porque percentual sem o símbolo é um número
 * solto — "3,99" na tela não diz que é taxa. A vírgula decimal é do pt-BR,
 * então ela sai do `Intl`, e não de um `replace` que quebraria em outro idioma.
 *
 * `maximumFractionDigits` existe porque nem toda taxa precisa de duas casas:
 * percentual de taxa pede precisão ("3,99%"), mas taxa de aprovação é um
 * número redondo ("92%").
 */
export function formatPercent(
  value: number,
  maximumFractionDigits = 2,
): string {
  const formatted = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);

  return `${formatted}%`;
}

/**
 * Converte uma data ISO 8601 (o que a API manda) em "05/11/2026 14:32".
 *
 * O fuso é o do navegador de quem está olhando — que é o que a pessoa espera:
 * o horário dela, não o do servidor.
 */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
