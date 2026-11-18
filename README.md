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

## Carga das crianças

1. Fotos: limpar os metadados (o GPS do celular revela onde as fotos foram tiradas), corrigir a rotação e reduzir o tamanho:
   ```bash
   python3 scripts/prepare_photos.py fotos-originais/ fotos/
   ```
2. A planilha deve ser salva como **CSV**, com cabeçalho `Turma;Nome;Idade;Foto;Pedido 1;Pedido 2;Pedido 3;Camisa;Calça;Tênis` (os campos digitados da cartinha). A coluna `Foto` traz o nome do arquivo da **foto da cartinha inteira** (ex.: `ana-souza.jpg`). É ela que o padrinho vê no card. A coluna opcional `Cartinha` aceita um texto livre, se houver.
3. Na VPS:
   ```bash
   docker cp fotos/. filhos_do_ritmo:/data/photos/
   docker cp planilha.csv filhos_do_ritmo:/data/planilha.csv
   docker exec filhos_do_ritmo node --disable-warning=ExperimentalWarning scripts/import.mjs /data/planilha.csv
   ```
   A importação pode ser repetida sem risco: ela atualiza por (turma, nome) e nunca apaga apadrinhamento nem entrega. Se uma foto não for encontrada, o script avisa.

## Dados de exemplo
Use para testar antes das cartinhas reais. No GitHub, vá em **Actions → Dados de exemplo → Run workflow** e escolha:
- `seed`: cria 10 cartinhas fictícias no layout real (ilustração no lugar da foto, faixa "EXEMPLO · NÃO É CRIANÇA REAL", Turma Exemplo A/B).
- `clear`: apaga **só** as de exemplo, inclusive apadrinhamentos de teste. As crianças reais não são tocadas.

**Rode `clear` antes de divulgar o link aos padrinhos.**

## Backup manual
```bash
docker cp filhos_do_ritmo:/data/backups ./backups-filhos
```
Exporte também o CSV pelo painel com frequência. É a cópia que fica fora da VPS.
