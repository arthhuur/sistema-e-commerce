import { vi } from 'vitest';

/**
 * TESTES DA CIFRA DO SEGREDO DO TOTP.
 *
 * O que está em jogo aqui não é "o texto volta igual" — isso qualquer cifra
 * faz. É a promessa de que o segredo do segundo fator NÃO fica legível no
 * banco, e de que uma adulteração é DETECTADA em vez de virar um segredo
 * plausível.
 *
 * Detalhe de execução que importa: a chave é derivada uma vez e guardada em
 * cache no módulo (`cachedKey`). Para testar caminhos que dependem de uma
 * raiz diferente, o módulo precisa ser reavaliado do zero — é o que
 * `vi.resetModules()` faz antes de cada import dinâmico.
 */

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_MFA_KEY = process.env.MFA_SECRET_KEY;

/** Repõe uma variável de ambiente ao valor original (ou a remove). */
function restore(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

describe('cifra do segredo do TOTP', () => {
  beforeEach(() => {
    // Uma raiz fixa deixa os testes independentes do NODE_ENV: o padrão é
    // derivar a chave do JWT_SECRET, então ele precisa existir.
    process.env.JWT_SECRET = 'j'.repeat(48);
    delete process.env.MFA_SECRET_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    restore('JWT_SECRET', ORIGINAL_JWT_SECRET);
    restore('MFA_SECRET_KEY', ORIGINAL_MFA_KEY);
    vi.resetModules();
  });

  it('devolve o texto original depois de cifrar e decifrar', async () => {
    const { encryptSecret, decryptSecret } = await import('./secret-cipher.js');
    const segredo = 'JBSWY3DPEHPK3PXP';

    expect(decryptSecret(encryptSecret(segredo))).toBe(segredo);
  });

  it('grava no formato versionado v1.<iv>.<tag>.<cifra>', async () => {
    const { encryptSecret } = await import('./secret-cipher.js');
    const partes = encryptSecret('segredo').split('.');

    expect(partes).toHaveLength(4);
    expect(partes[0]).toBe('v1');
    // IV (12 bytes) e tag (16 bytes) em base64url: nenhum vazio.
    expect(partes[1]).not.toBe('');
    expect(partes[2]).not.toBe('');
    expect(partes[3]).not.toBe('');
  });

  it('cifra o MESMO segredo em valores diferentes (IV novo a cada vez)', async () => {
    const { encryptSecret } = await import('./secret-cipher.js');

    // Se dois textos iguais gerassem a mesma saída, daria para saber que dois
    // usuários têm o mesmo segredo só olhando o banco.
    expect(encryptSecret('mesmo-segredo')).not.toBe(
      encryptSecret('mesmo-segredo'),
    );
  });

  it('NÃO guarda o segredo em texto puro', async () => {
    const { encryptSecret } = await import('./secret-cipher.js');
    const segredo = 'JBSWY3DPEHPK3PXP';

    expect(encryptSecret(segredo)).not.toContain(segredo);
  });

  it('detecta adulteração do texto cifrado (tag do GCM)', async () => {
    const { encryptSecret, decryptSecret } = await import('./secret-cipher.js');
    const [versao, iv, tag, cifra] = encryptSecret('segredo').split('.');

    // Troca o primeiro caractere da cifra. Num esquema SEM autenticação isso
    // decifraria para "outra coisa" em silêncio; no GCM a tag denuncia.
    const alterada = (cifra.startsWith('A') ? 'B' : 'A') + cifra.slice(1);

    expect(() => decryptSecret([versao, iv, tag, alterada].join('.'))).toThrow();
  });

  it('recusa um valor em formato desconhecido', async () => {
    const { decryptSecret } = await import('./secret-cipher.js');

    expect(() => decryptSecret('nao-e-um-payload')).toThrow();
  });

  it('usa a MFA_SECRET_KEY dedicada quando ela existe', async () => {
    process.env.MFA_SECRET_KEY = 'k'.repeat(48);
    vi.resetModules();

    const { encryptSecret, decryptSecret } = await import('./secret-cipher.js');

    expect(decryptSecret(encryptSecret('segredo'))).toBe('segredo');
  });

  it('exige o tamanho mínimo da MFA_SECRET_KEY', async () => {
    process.env.MFA_SECRET_KEY = 'curta';
    vi.resetModules();

    const { encryptSecret } = await import('./secret-cipher.js');

    expect(() => encryptSecret('segredo')).toThrow(/MFA_SECRET_KEY/);
  });

  it('não decifra o que foi cifrado com OUTRA raiz (troca de chave)', async () => {
    const comJwt = await import('./secret-cipher.js');
    const payload = comJwt.encryptSecret('segredo');

    // Troca a raiz: a chave derivada passa a ser outra. É o cenário de girar
    // o JWT_SECRET — o segredo antigo deixa de ser decifrável.
    process.env.MFA_SECRET_KEY = 'z'.repeat(48);
    vi.resetModules();
    const comDedicada = await import('./secret-cipher.js');

    expect(() => comDedicada.decryptSecret(payload)).toThrow();
  });
});
