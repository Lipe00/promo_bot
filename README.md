# Promo Bot

Bot que procura produtos em lojas brasileiras e avisa no Telegram quando o preço entra na sua faixa.

- **Produto**: `/add force one kabuto | 300 | 15` avisa até R$ 345 (alvo + 15%), uma mensagem por oferta.
- **Categoria**: `/categoria placa de video rtx 4060 | 2000`, ou o link de uma página de categoria da loja. Manda um resumo com os mais baratos até o teto.
- **Fontes**: ligar/desligar lojas (`/lojas off amazon`) e cadastrar loja nova por URL (`/fonte add …`).
- O alerta traz loja, preço (cartão e Pix), link, frete para o seu CEP quando dá para calcular e **até que horário vai a promoção** quando a loja informa.
- Hospedagem: Vercel (app) + Supabase (banco e agendamento). Uso pessoal, sem custo de API.

## O que funciona em cada loja (testado ao vivo em 22/11/2026)

Resultado de `npm run test:live` rodando de um IP residencial no Brasil:

| Loja | Sem chave | Com chave de API | Observações |
|---|---|---|---|
| **KaBuM!** | ✅ funciona | — | Lê cartão, Pix, **oferta relâmpago com horário de fim**, frete grátis. Links de categoria funcionam. |
| **Amazon** | ✅ funciona (IP residencial) | — | IP de datacenter (Vercel) costuma levar captcha; aí o `/status` mostra ⛔. |
| **AliExpress** | ✅ funciona | ✅ link de afiliado | O preço da busca é o da **variação mais barata** do anúncio; o alerta avisa "a partir de". |
| **Mercado Livre** | ⛔ bloqueia ("tráfego suspeito") | ✅ API oficial | Com a chave: busca, **frete pelo CEP** e fim da promoção. Se a busca principal da API for recusada, usa a busca de catálogo (`/products/search`). **Recomendo criar a chave.** |
| **Shopee** | ➖ não dá | ✅ API de afiliados | O site é montado por JavaScript e a API interna recusa robôs. Conta sem acesso aparece como "erro 10035" no `/status`. |

Magalu, Pichau e TerabyteShop foram removidas: bloqueiam robôs (403, robots.txt e Cloudflare). Se quiser tentar alguma loja assim, cadastre com `/fonte add`.

O bot **não contorna** bloqueio, captcha nem robots.txt. Quando uma loja bloqueia, ele registra e segue com as outras. A saída para ML e Shopee é a API oficial.

> As chaves de ML e Shopee ainda não foram testadas ao vivo (aguardando as credenciais). O código foi testado com respostas no formato da documentação e com respostas reais de erro das duas APIs.

## Chaves de API (opcionais, mas o Mercado Livre quase exige)

Cadastre na Vercel em **Settings → Environment Variables** (nunca pelo Telegram):

| Loja | Variáveis | Onde conseguir |
|---|---|---|
| Mercado Livre | `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | [developers.mercadolivre.com.br/devcenter](https://developers.mercadolivre.com.br/devcenter) → **Criar aplicação**. É grátis. Pode usar qualquer URL de redirect (ex.: a do seu app na Vercel); o bot usa o fluxo `client_credentials`, sem login. |
| Shopee | `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET` | [affiliate.shopee.com.br](https://affiliate.shopee.com.br) → entrar no programa de afiliados → **Open API**. Precisa de aprovação. |
| AliExpress | `ALI_APP_KEY`, `ALI_APP_SECRET`, `ALI_TRACKING_ID` | [portals.aliexpress.com](https://portals.aliexpress.com) (afiliado) + [openservice.aliexpress.com](https://openservice.aliexpress.com) (criar app). Opcional: sem chave a busca já funciona. |
| Amazon | — | A API oficial (PA-API) exige conta de Associados com vendas aprovadas. Não está integrada. |

`/lojas` mostra como cada loja está sendo lida (API oficial, página da loja ou sem chave).

## Instalação (uns 20 minutos)

### 1. Bot do Telegram
1. No Telegram, fale com **@BotFather** → `/newbot` → copie o **token**.
2. Invente dois textos longos e aleatórios: `TELEGRAM_WEBHOOK_SECRET` e `CRON_SECRET`.

### 2. Supabase
1. Crie um projeto em supabase.com (região São Paulo).
2. **SQL Editor → New query**: cole `supabase/schema.sql` e rode.
   - **Já tinha rodado uma versão antiga?** Rode as migrações de `supabase/migrations/` que faltam, em ordem (002, 003, 004). Todas podem rodar mais de uma vez.
3. **Project Settings → API Keys**: copie a **Project URL** e a **Secret key** (`sb_secret_...`, a substituta da antiga `service_role`; só no servidor). Não use a *publishable key*.

### 3. Vercel
1. Suba esta pasta para um repositório **privado** no GitHub e importe na Vercel (**Add New → Project**).
2. Em **Settings → Environment Variables**, cadastre (veja `.env.example`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `PASSWORD_SALT`, `SESSION_SECRET` e as chaves de API que tiver (marque os segredos como *Sensitive*).
   Deixe `TELEGRAM_ALLOWED_CHAT_ID` **sem cadastrar** por enquanto.
3. Faça o deploy. O `vercel.json` coloca a função em São Paulo (`gru1`), mais perto das lojas.

### 4. Ligar o Telegram ao app
1. Registre o webhook e o menu de comandos (o segredo vai no header, nunca na URL; deve responder `ok: True`):
   ```powershell
   Invoke-RestMethod -Method Post -Uri "https://SEU-APP.vercel.app/api/telegram/setup" -Headers @{ Authorization = "Bearer SEU_CRON_SECRET" }
   ```
2. Mande `/start` pro seu bot. Ele responde com o seu **chat id**.
3. Cadastre `TELEGRAM_ALLOWED_CHAT_ID` com esse número na Vercel e faça **Redeploy**.
   A partir daí só você consegue usar o bot; mensagens de outras pessoas são ignoradas.

> Se você testou o bot no Docker local (modo `real`), o webhook foi apagado. É só rodar o comando do passo 4.1 de novo.

### 5. Agendamento
No Supabase, **SQL Editor**, abra `supabase/cron.sql`, troque `SEU-APP` e `SEU_CRON_SECRET` e rode.
O segredo fica guardado no **Vault** do Supabase (criptografado), não no texto do job. Para trocar o `CRON_SECRET`, mude na Vercel e rode o `cron.sql` de novo com o valor novo.
Por padrão roda **a cada 3 horas**. O cron grátis da Vercel só roda 1x por dia, por isso o agendamento fica no `pg_cron` do Supabase.

Cada rodada trabalha no máximo ~45s (a função tem 60s). Se você tiver muitas buscas, as que não couberem entram primeiro na rodada seguinte; nenhuma fica para trás.

## Painel web

Abra `https://SEU-APP.vercel.app` e entre com o usuário do painel. Funciona no celular e no computador.

- **Cards** com o menor preço encontrado de cada busca, a loja e o status (🔥 abaixo do alvo, 👀 na margem, acima do teto). O menor preço aparece mesmo quando está acima do teto: o bot guarda as 3 ofertas mais baratas de cada loja.
- **Clique num card** para abrir o painel (gaveta no computador, tela cheia no celular; o "voltar" do celular fecha). Abas:
  - **Ofertas**: preço, preço "de", frete, ⏰ fim da promoção e link para a loja.
  - **Histórico**: gráfico do menor preço por dia (com alvo e teto) e a lista de mudanças. Um ponto é gravado quando o preço muda, ou uma vez por dia; o histórico guarda 180 dias.
  - **Configurar**: alvo, margem, lojas, "apenas promoções", pausar e remover.
- **+ Produto**: cadastra produto ou categoria, com as mesmas regras do `/add` e do `/categoria`.
- **Apenas promoções**: só avisa ofertas com preço de/por (riscado maior que o atual) **ou** com prazo de fim. As outras continuam aparecendo no painel, só não geram alerta. No Telegram: `/promo id`.
- O painel e o Telegram mostram as mesmas buscas (a conta do painel aponta para o seu chat do Telegram).

### Contas e login
- Senha guardada com **scrypt**, usando o `PASSWORD_SALT` do ambiente + o nome do usuário como salt. A senha nunca fica em arquivo.
- Cada login cria uma **sessão** no banco (uma por aparelho, válida por 7 dias). **Sair** apaga a sessão daquele aparelho, então o cookie antigo deixa de valer mesmo se alguém o tiver copiado.
- Para saber se o login está válido: `GET /api/ui/session` → `200 {"authenticated":true,"username":...,"expiresAt":...}` ou `401`.
- Senha errada **não trava a conta**; só demora ~1s para responder (atrasa robôs).
- Criar uma conta ou trocar a senha (trocar também encerra todas as sessões da conta). A senha vai só numa variável na hora de rodar:
  ```powershell
  docker run --rm -v "${PWD}:/app" -v promobot_nm:/app/node_modules -w /app --env-file .env.deploy.local -e NEW_USER_NAME=felipe -e NEW_USER_PASSWORD="SUA-SENHA" -e NEW_USER_CHAT_ID=SEU_CHAT_ID node:22-bookworm-slim node --experimental-strip-types --no-warnings scripts/create-user.ts
  ```
  A tabela `users` já aceita várias contas, cada uma ligada a um chat do Telegram.

## Uso no Telegram

| Comando | O que faz |
|---|---|
| `/add force one kabuto \| 300 \| 15` | monitora um produto (margem opcional, padrão 15%) |
| `/add kabuto -almofada \| 300` | `-palavra` exclui títulos com essa palavra |
| `/add ssd 1tb \| 400 \| 10 \| kabum,amazon` | 4º campo: só nessas lojas |
| `/categoria placa de video rtx 4060 \| 2000` | categoria por termo: tudo com essas palavras até R$ 2000, num resumo |
| `/categoria https://www.kabum.com.br/hardware/placa-de-video-vga \| 2000` | categoria por link (de uma loja cadastrada) |
| `/lista` | mostra as buscas |
| `/preco 1 280` · `/margem 1 10` | muda alvo ou margem da busca #1 |
| `/pausar 1` · `/ativar 1` · `/remover 1` | gerencia |
| `/promo 1` | liga/desliga "apenas promoções" na busca #1 |
| `/lojas` · `/lojas off amazon` · `/lojas on amazon` | lojas e como cada uma é lida; liga/desliga |
| `/fonte add Nome \| https://loja.com.br/busca?q={q}` | cadastra loja nova (testa na hora) |
| `/fonte remover 3` | remove a fonte #3 |
| `/cep 16010-000` | guarda o CEP (frete) |
| `/frete total` · `/frete produto` | compara alvo com preço + frete (padrão) ou só o produto |
| `/checar` | roda agora |
| `/testar force one kabuto` | mostra o que cada loja devolveu, sem salvar |
| `/status` | saúde de cada loja na última checagem |

### Lojas novas (`/fonte add`)
O link precisa ter `{q}` no lugar do termo (abra a busca da loja no navegador, procure "teste" e troque `teste` por `{q}`).
O bot lê produtos de **dados estruturados** que muitas lojas publicam (JSON-LD `schema.org/Product`, ou `__NEXT_DATA__`).
Se a loja não publica, o teste responde "não achei produtos" e você remove com `/fonte remover`.
Só links `https://` de domínio público. Links de produtos de outros domínios são descartados.

## Como o bot decide

- **Produto**: o título precisa ter **todas** as palavras da busca. Número por extenso vale como dígito ("force one" casa com "Force 1"). Ofertas abaixo de 40% do alvo são ignoradas (costumam ser acessório).
- **Categoria**: mesmas palavras (no termo) ou a página inteira (no link), sem o piso de 40%; só o teto. Um resumo com os 5 mais baratos e "+N outros".
- Compara pelo **menor** entre preço normal e à vista/Pix. Com `/frete total` e frete conhecido, soma o frete.
- **Abaixo do alvo** → 🔥; **entre o alvo e alvo+margem** → 👀.
- Não repete aviso da mesma oferta, exceto se o preço cair pelo menos 2%, se ela sair da faixa e voltar, ou como lembrete depois de 7 dias.
- Promoção cujo fim já passou não gera alerta.

### Frete
- **Mercado Livre (com chave)**: calcula o frete para o seu CEP (`/items/{id}/shipping_options`), só para as ofertas que já entraram na faixa.
- **KaBuM, AliExpress, Amazon**: repetem "frete grátis" quando a listagem informa. O valor exato por CEP essas lojas só mostram no carrinho; o alerta pede para conferir.

## Testes

Não precisa de Node instalado: tudo roda no Docker.

```powershell
docker compose -f docker/compose.yml --profile mock up -d
```
```powershell
docker compose -f docker/compose.yml --profile e2e run --rm e2e
```

- `npm test`: 134 testes de unidade (lógica, comandos, checagem, frete, categorias, fontes, APIs com respostas gravadas, leitores das lojas contra **páginas reais reduzidas** em `test/fixtures/`).
- E2E (`test/e2e/`): sobe Postgres + PostgREST (imitando o Supabase), um Telegram falso e uma loja falsa; manda comandos pelo webhook e confere banco e mensagens.
- `npm run test:live`: busca **real** em todas as lojas e imprime o que achou. Use `LIVE_TERM="rtx 4060"` para trocar o termo.

Para rodar `npm test` sem Node na máquina:
```powershell
docker run --rm -v "${PWD}:/app" -v promobot_nm:/app/node_modules -w /app node:22-bookworm-slim sh -c "npm install && npm test"
```

### Testar com o bot de verdade, no seu PC
Com `TELEGRAM_BOT_TOKEN` e `TELEGRAM_WEBHOOK_SECRET` no `.env.local`:
```powershell
docker compose -f docker/compose.yml --profile real up -d
```
O serviço `poller` busca as mensagens do Telegram (o Telegram não alcança `localhost` por webhook) e repassa ao app. Ele **apaga o webhook** do bot: depois de testar, rode de novo o comando do passo 4.1.
Banco local: `http://localhost:54321` (some com `docker compose -f docker/compose.yml --profile mock --profile real down -v`).

## Quando uma loja quebrar

1. `/status` e `/testar` dizem o que houve: bloqueio, robots.txt, "abriu mas sem produtos" (layout mudou) ou erro.
2. Só o "abriu mas sem produtos" é conserto de código. Recapture a página e veja o que o leitor extrai:
   ```powershell
   docker run --rm -v "${PWD}:/app" -v promobot_nm:/app/node_modules -w /app node:22-bookworm-slim npm run calibrate -- "headset force one" .calib/agora
   ```
   O HTML fica em `.calib/agora/`. Ajuste `src/lib/stores/<loja>.ts`, gere fixtures novas com `node scripts/make-fixtures.mjs .calib/agora test/fixtures` e rode os testes.

## Depuração

- Logs: Vercel → Deployments → Functions/Logs.
- Rodar uma checagem e ver o resultado na hora:
  `curl -H "Authorization: Bearer SEU_CRON_SECRET" "https://SEU-APP.vercel.app/api/cron/check?sync=1"`
- Execuções do agendamento: `select * from cron.job_run_details order by start_time desc limit 10;`

## Estrutura

```
supabase/schema.sql                 tabelas, RLS e trava (instalação nova)
supabase/migrations/002_*.sql       atualização de quem já tinha o schema antigo
supabase/cron.sql                   agendamento (pg_cron + pg_net)
src/app/api/telegram/               webhook do Telegram (+ /setup)
src/app/api/cron/check/             rotina de checagem
src/lib/commands.ts                 comandos do Telegram
src/lib/webhook.ts                  trata cada mensagem (dono, ações demoradas)
src/lib/auth.ts · web-auth.ts       senha (scrypt + salt), sessões e proteção das rotas do painel
src/lib/dashboard.ts                cards, detalhe e histórico do painel
src/lib/watch-input.ts              regras de cadastro (Telegram e painel)
src/app/page.tsx · login/ · _ui/    painel web
src/app/api/ui/                     API do painel
src/lib/checker.ts                  busca, margem, frete, categorias, orçamento de tempo, alertas
src/lib/alerts.ts                   regra de quando avisar
src/lib/matching.ts                 palavras da busca × título
src/lib/shipping.ts                 preço comparado (com ou sem frete)
src/lib/http.ts · robots.ts         requisição educada, robots.txt, detecção de bloqueio
src/lib/stores/                     um arquivo por loja + generic.ts (fontes cadastradas)
docker/                             ambiente local (Postgres, PostgREST, Telegram falso, poller)
scripts/                            calibrate.ts (lojas reais) e make-fixtures.mjs
test/                               unidade · e2e/ · live/ · fixtures/
```

## Segurança (auditado em 22/11/2026)

- **Painel**: as rotas `/api/ui/*` exigem sessão válida (cookie `HttpOnly`, `Secure`, `SameSite=Lax`, assinado e conferido no banco) e recusam `Origin` de outro site. O navegador nunca fala com a Supabase, só com o próprio app.
- **Banco**: RLS ligado em todas as tabelas e **nenhum privilégio** para as roles públicas (`anon` = publishable key, `authenticated`). Só a secret key (servidor) acessa. A API REST expõe só `public`/`graphql_public`; a GraphQL fica desligada.
- **Agendamento**: o `CRON_SECRET` fica no Vault do Supabase. O schema `net` (pg_net) é liberado pelo próprio Supabase para `PUBLIC` e não dá para revogar sem ser `supabase_admin`, mas ele não é alcançável pela API: só por conexão direta ao banco, que exige a senha.
- **Vercel**: variáveis marcadas como *Sensitive* (o valor não pode ser lido depois). As rotas exigem segredo: `x-telegram-bot-api-secret-token` no webhook, `Authorization: Bearer` no cron e no setup (nunca na URL). O bot só responde ao `TELEGRAM_ALLOWED_CHAT_ID` e ignora mensagens editadas. Deploys de preview ficam atrás do login da Vercel. Cabeçalhos `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; respostas da API com `no-store`.
- **Repositório**: nenhum segredo no histórico; `.env*` e `.vercelignore` impedem o envio de arquivos locais.

## Avisos

- Ler páginas de lojas automaticamente pode ir contra os termos de uso delas, mesmo em volume baixo. O bot é feito para uso pessoal e leve (poucas requisições, com intervalo, respeitando robots.txt), mas a responsabilidade é sua.
- O plano Hobby da Vercel é para uso pessoal e não comercial.
- Nunca commite o `.env.local` nem o `.env.deploy.local`. A secret key do Supabase dá acesso total ao banco. O token do bot também: se ele vazar, gere outro no @BotFather (`/revoke`).
