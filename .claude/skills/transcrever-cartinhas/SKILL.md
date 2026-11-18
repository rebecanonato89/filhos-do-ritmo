---
name: transcrever-cartinhas
description: Lê as fotos das cartinhas de Natal do Filhos do Ritmo, transcreve nome, idade, pedidos e tamanhos, casa cada cartinha com a foto da criança e gera a planilha CSV e os arquivos renomeados para subir no Painel do portal. Use quando a usuária pedir para transcrever, ler ou processar as cartinhas.
---

# Transcrever cartinhas

Objetivo: transformar as fotos das cartinhas em **dados revisáveis**. Você não publica nada; quem confere e sobe no portal é uma pessoa.

## Pasta de entrada

A usuária informa a pasta (padrão: `./cartinhas`, que está no `.gitignore`). Estrutura esperada:

```
cartinhas/
  Turma 1/
    cartinhas/   ← fotos das cartinhas (qualquer nome de arquivo)
    fotos/       ← fotos das crianças (qualquer nome de arquivo)
  Turma 2/
    ...
```

O nome da subpasta é o nome da turma que aparece no portal. Se a estrutura não for essa, pergunte antes de começar. Não reorganize os arquivos originais.

## Regras invioláveis

- **Nunca** faça commit, push, upload ou cópia das fotos para fora da pasta de trabalho. São fotos reais de crianças.
- **Não invente.** Transcreva exatamente o que está escrito, inclusive marcas e apelidos de brinquedo ("Bebê Reborn", "Squishy de gelo"). Corrija só acentuação e maiúsculas óbvias.
- Se uma palavra estiver ilegível ou ambígua, escreva sua melhor leitura seguida de ` [?]` e inclua o campo em `duvidas`. Prefira marcar dúvida a acertar no chute.
- Campo vazio na cartinha → `null`. Não preencha tamanho ou idade por dedução.

## Passo a passo (uma turma por vez)

1. Liste `cartinhas/` e `fotos/` da turma e informe as quantidades. Se forem diferentes, avise e continue.
2. **Veja todas as fotos das crianças da turma primeiro** e anote, para cada arquivo, uma descrição curta que ajude a reconhecer a criança (roupa, cabelo, fundo, pose). A foto colada na cartinha é **a mesma foto impressa**, então o enquadramento e o fundo batem.
3. Para cada cartinha, abra a imagem e extraia os campos do modelo:
   - "Meu nome é" → `nome`
   - "Eu tenho __ anos" → `idade` (só o número)
   - `sexo`: a cartinha **não** informa. Sugira `F` ou `M` pelo nome e pela foto, mas **sempre** inclua `sexo` em `duvidas` para a revisão confirmar. Nome ambíguo → `null`.
   - as 3 linhas de "Neste Natal, eu gostaria de ganhar" → `pedido1`, `pedido2`, `pedido3`
   - "Meus tamanhos": Camiseta → `camisa`, Calça → `calca`, Tênis → `tenis`
   - compare a foto colada com as fotos do passo 2 e escolha o arquivo → `foto`. Em `foto_confianca` use `alta` só se tiver certeza; se ficar entre duas, escolha uma, use `baixa` e explique em `obs`.
   - Cada foto de criança só pode ser usada uma vez. Se sobrar foto sem cartinha, ou cartinha sem foto (`foto: null`), registre.
4. Grave `cartinhas/<Turma>/dados.json` neste formato (um objeto por cartinha):

```json
[
  {
    "cartinha": "IMG_2041.jpg",
    "foto": "DSC_0112.jpg",
    "foto_confianca": "alta",
    "nome": "Thessália Vitória Oliveira",
    "idade": "8",
    "sexo": "F",
    "pedido1": "Bebê Reborn",
    "pedido2": "Kit de pulseira",
    "pedido3": "Squishy de gelo",
    "camisa": "10",
    "calca": "10",
    "tenis": "31",
    "duvidas": ["sexo"],
    "obs": null
  }
]
```

5. Rode o montador, que valida, gera a planilha, renomeia as cópias e cria a página de revisão:

```bash
node tools/montar-saida.mjs cartinhas
```

6. Mostre o resumo que o script imprime: total, dúvidas, fotos com confiança baixa, nomes repetidos, problemas. **Peça para a usuária abrir `cartinhas/_saida/revisao.html` e conferir**, principalmente os itens destacados.
7. Correções: edite o `dados.json` e rode o montador de novo. Não edite o CSV à mão.

Processe uma turma por vez e mostre o progresso. Se o contexto ficar grande, termine a turma atual, rode o montador e continue a próxima numa nova leitura.

## Enviar ao portal (só depois da revisão e com confirmação explícita)

Pré-requisito (uma vez): arquivo `.env.portal` na raiz do repositório com `FDR_TOKEN=<valor do secret ADMIN_API_TOKEN>`, e dependências das ferramentas instaladas com `npm install --prefix tools`. Se faltar, peça para a usuária criar. **Nunca** escreva, mostre ou commite o valor da chave.

1. Pergunte se a usuária revisou o `revisao.html` e resolveu as dúvidas. Sem um "sim" explícito, **não envie**.
2. Rode a **simulação** e mostre o resumo (quantas crianças, quantas imagens, quais não casaram):
   ```bash
   node tools/enviar-portal.mjs cartinhas/_saida
   ```
3. Peça confirmação explícita ("posso enviar?"). Só então:
   ```bash
   node tools/enviar-portal.mjs cartinhas/_saida --enviar
   ```
4. Mostre o resultado. Imagens que não casaram (nome repetido entre turmas) são resolvidas pelo ✏️ no Painel.

O script aplica a marca d'água, remove o GPS e reduz as imagens **no computador** antes de enviar; aceita HEIC do iPhone. Reenviar é seguro: a planilha atualiza por turma+nome sem apagar apadrinhamentos, e cada imagem enviada substitui a anterior da mesma criança.

## Alternativa manual (pelo Painel)

Painel → **📥** (Carregar planilha e fotos):
1. Planilha: `cartinhas/_saida/planilha.csv`
2. Fotos das crianças: todos os arquivos de `cartinhas/_saida/fotos/`
3. Fotos das cartinhas: todos os arquivos de `cartinhas/_saida/cartinhas/`
