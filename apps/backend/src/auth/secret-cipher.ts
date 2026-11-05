import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { MINIMUM_SECRET_LENGTH, resolveJwtSecret } from './jwt-secret.js';

/**
 * Guarda o segredo do TOTP CIFRADO, não em texto.
 *
 * POR QUE ISSO NÃO É PARANOIA.
 *
 * O segredo do TOTP é o que gera os códigos de seis dígitos a cada 30
 * segundos. Quem tem esse segredo consegue gerar os códigos — ou seja, tem,
 * sozinho, o segundo fator daquela pessoa. Guardá-lo em texto no banco
 * significa que um vazamento da tabela `users` entrega os segredos junto e o
 * "segundo fator" deixa de ser um fator.
 *
 * COM O QUE ELE É CIFRADO, E O QUE ISSO CUSTA.
 *
 * A chave vem de `MFA_SECRET_KEY` quando definida; senão, é DERIVADA do
 * `JWT_SECRET` por HKDF-SHA256. Derivar não é reaproveitar o segredo: o HKDF
 * produz uma chave independente, e o rótulo (`info`) garante que a chave do
 * JWT e a do TOTP nunca coincidem. O ganho é não exigir mais uma variável de
 * ambiente para o sistema subir.
 *
 * O PREÇO, QUE PRECISA ESTAR ESCRITO: se o `JWT_SECRET` for trocado sem
 * definir um `MFA_SECRET_KEY` próprio, os segredos já gravados deixam de ser
 * decifráveis e quem tinha 2FA perde o aplicativo autenticador. Os CÓDIGOS DE
 * RECUPERAÇÃO continuam valendo (são hash, não cifra), então ninguém fica
 * trancado para fora — mas o caminho de saída é por eles. Definir
 * `MFA_SECRET_KEY` desacopla as duas coisas.
 *
 * FORMATO GRAVADO: `v1.<iv>.<tag>.<cifra>`, tudo em base64url. O prefixo de
 * versão existe para o dia em que o algoritmo mudar: dá para reconhecer o que
 * é antigo sem adivinhar.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // nonce recomendado para o GCM
const VERSION = 'v1';

/** Separadores de domínio do HKDF: a mesma raiz, chaves diferentes. */
const HKDF_SALT = 'payment-router/mfa';
const HKDF_INFO = 'totp-secret-encryption';

/**
 * A chave é calculada uma vez e reaproveitada.
 *
 * O HKDF é barato, mas a chave não muda durante a execução — recalcular a
 * cada requisição seria trabalho jogado fora. O cache morre junto com o
 * processo, e o processo morre quando a configuração muda.
 */
let cachedKey: Buffer | undefined;

function encryptionKey(): Buffer {
  cachedKey ??= Buffer.from(
    hkdfSync('sha256', rootSecret(), HKDF_SALT, HKDF_INFO, KEY_LENGTH),
  );

  return cachedKey;
}

/**
 * A raiz de onde a chave é derivada.
 *
 * Uma variável dedicada é melhor quando existir (trocar o `JWT_SECRET` deixa
 * de ter efeito colateral sobre o 2FA), mas ela é OPCIONAL: obrigatória,
 * seria mais uma etapa para errar no deploy, e a alternativa — derivar do
 * segredo que já é obrigatório — é segura.
 */
function rootSecret(): string {
  const dedicated = process.env.MFA_SECRET_KEY?.trim();

  if (!dedicated) {
    return resolveJwtSecret();
  }

  if (dedicated.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `MFA_SECRET_KEY precisa ter ao menos ${MINIMUM_SECRET_LENGTH} caracteres. ` +
        'Gere um novo com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }

  return dedicated;
}

/** Cifra o segredo do TOTP para ser gravado no banco. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // O GCM produz, além do texto cifrado, uma "tag" de autenticação. É ela que
  // faz uma adulteração no banco ser DETECTADA em vez de decifrada errado: sem
  // a tag, um byte alterado viraria um segredo plausível e o bug apareceria
  // como "o código do usuário não confere", longe da causa.
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Devolve o segredo em texto. Lança se o valor foi adulterado ou se a chave
 * atual não é a mesma que cifrou (o caso da troca do `JWT_SECRET`).
 */
export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.');

  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Segredo em formato desconhecido.');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
