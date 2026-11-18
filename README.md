# Filhos do Ritmo — Natal Solidário

Apadrinhamento de cartinhas de Natal. Padrinhos entram com Google, a organização libera o acesso e cada padrinho escolhe uma ou mais crianças. A reserva é atômica no banco, então duas pessoas nunca ficam com a mesma criança.

**Produção:** https://filhosdoritmo.rebecanonato89.dev

## Regras
- Sem login, nada aparece. Depois do login, o acesso fica **aguardando liberação** até um gestor aprovar o e-mail (`REQUIRE_APPROVAL=true`).
- O padrinho vê todas as crianças com status *Disponível* ou *Já apadrinhada*, e as suas aparecem em "Minhas crianças". Nunca vê nome nem telefone de outro padrinho.
- O gestor (`ADMIN_EMAILS`) vê padrinho, e-mail e WhatsApp, marca a entrega, libera a criança (desistência), aprova ou bloqueia acessos e exporta a planilha CSV.
- O padrinho não cancela sozinho: em caso de desistência, fala com a organização e o gestor clica em "Liberar".

## Stack
Node 22 sem dependências npm (`node:http`, `node:sqlite`, `fetch`). O SQLite fica no volume `/data`, com backup automático a cada 6 h em `/data/backups`. As fotos ficam em `/data/photos` e só são servidas para usuários aprovados.

```bash
npm test
SESSION_SECRET=$(openssl rand -hex 32) ADMIN_EMAILS=voce@gmail.com npm start   # http://localhost:3000
```

## Configuração única (antes do 1º deploy)

1. **DNS:** registro `A` de `filhosdoritmo.rebecanonato89.dev` apontando para o IP da VPS.
2. **Google OAuth:** no Google Cloud Console, vá em *APIs e serviços → Credenciais → Criar ID do cliente OAuth → Aplicativo da Web*.
   - Origem JavaScript: `https://filhosdoritmo.rebecanonato89.dev`
   - URI de redirecionamento: `https://filhosdoritmo.rebecanonato89.dev/auth/google/callback`
   - Tela de consentimento: tipo *Externo*, publicada (em "Teste", só os e-mails cadastrados conseguem entrar).
3. **Secrets do repositório no GitHub:**

| Secret | Valor |
|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | os mesmos do allrev |
| `DOCKER_USERNAME`, `DOCKER_PASSWORD` | os mesmos do allrev |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | do passo 2 |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ADMIN_EMAILS` | e-mails dos gestores separados por vírgula |

Push na `main`: testes, imagem no Docker Hub, deploy em `~/filhos-do-ritmo` na VPS, usando o Traefik do allrev.

## Transcrever as cartinhas com o Claude Code (local)
Sem planilha? O Claude Code lê as fotos das cartinhas no seu computador e gera tudo pronto para o Painel.

1. Na raiz deste repositório, crie a pasta `cartinhas/` (ela está no `.gitignore` e **nunca** vai para o Git):
   ```
   cartinhas/Turma 1/cartinhas/   ← fotos das cartinhas
   cartinhas/Turma 1/fotos/       ← fotos das crianças
   cartinhas/Turma 2/...
   ```
2. Rode `claude` na raiz do repositório e peça: **/transcrever-cartinhas**. Ele lê cada cartinha, casa com a foto da criança e grava `dados.json` por turma.
3. O montador (`node tools/montar-saida.mjs cartinhas`) gera `cartinhas/_saida/` com:
   - `planilha.csv`
   - `fotos/<Nome>.jpg` e `cartinhas/<Nome>.jpg`
   - `revisao.html`
4. **Abra `revisao.html` e confira**, principalmente o que estiver em laranja (letra duvidosa ou foto com casamento incerto). Corrija no `dados.json` e rode o montador de novo.
5. Suba no Painel (passos abaixo): planilha, depois a pasta `fotos`, depois a pasta `cartinhas`.

## Carga das crianças (pelo Painel, sem SSH)
Em **Painel → 📥 Carregar planilha e fotos**:
1. **Planilha CSV** com as colunas `Turma; Nome; Idade; Pedido 1; Pedido 2; Pedido 3; Camisa; Calça; Tênis`. Aceita CSV do Excel (Windows-1252) ou UTF-8. Pode importar de novo para corrigir dados: isso atualiza por (turma, nome) e nunca apaga apadrinhamento, entrega nem imagens.
2. **Fotos das crianças** e **fotos das cartinhas**: o nome do arquivo deve ser o nome da criança (`Ana Clara Souza.jpg`). Dá para selecionar várias de uma vez. Nomes repetidos em turmas diferentes não são casados; use os ícones 📷 / ✉️ na linha da criança.

O navegador de quem envia aplica a **marca d'água** (logo no centro da foto; grade suave na cartinha), remove o EXIF/GPS e reduz a imagem. **O arquivo original nunca sai do aparelho.** O servidor só aceita JPEG.

> Não versionar fotos reais neste repositório: elas entrariam no histórico do Git e na imagem Docker.

Alternativa por linha de comando: `scripts/import.mjs` (veja o cabeçalho do arquivo).

## Dados de exemplo
Use para testar antes das cartinhas reais. No GitHub, vá em **Actions → Dados de exemplo → Run workflow** e escolha:
- `seed`: cria 10 crianças fictícias (foto ilustrada + cartinha no layout real, ambas com marca d'água e faixa "EXEMPLO · NÃO É CRIANÇA REAL", Turma Exemplo A/B).
- `clear`: apaga **só** as de exemplo, inclusive apadrinhamentos de teste. As crianças reais não são tocadas.

**Rode `clear` antes de divulgar o link aos padrinhos.**

## Backup manual
```bash
docker cp filhos_do_ritmo:/data/backups ./backups-filhos
```
Exporte também o CSV pelo painel com frequência. É a cópia que fica fora da VPS.
