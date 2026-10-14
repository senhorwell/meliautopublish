# MeliAutoPublish AI

Aplicação web com interface de chat que **extrai anúncios do Mercado Livre**, **otimiza
título, descrição e ficha técnica com IA gratuita (Google Gemini)** e **publica o novo
anúncio na sua própria conta** do Mercado Livre — tudo em um clique.

Envie um ou mais links (ex.: `https://produto.mercadolivre.com.br/MLB-1234567890-...`)
e acompanhe o progresso em tempo real:

```
⏳ Extraindo dados do anúncio original...
🤖 Otimizando título, descrição e atributos via IA...
🚀 Publicando no Mercado Livre...
✅ Anúncio criado com sucesso! [Ver anúncio no ML]
```

---

## Stack

| Camada            | Tecnologia                                                   |
| ----------------- | ------------------------------------------------------------ |
| Framework         | Next.js 16 (App Router, Turbopack, Cache Components) + React 19 |
| Linguagem / estilo| TypeScript + Tailwind CSS v4 + lucide-react                  |
| Backend           | Route Handlers (SSE via `ReadableStream`)                    |
| Banco de dados    | SQLite + Prisma ORM                                          |
| IA                | Google Gemini (`@google/genai`) — tier gratuito do AI Studio |
| Integração        | Mercado Livre REST API (OAuth 2.0 + `/items` + `/categories`)|

---

## Arquitetura

```
src/
├── app/
│   ├── page.tsx                 # Shell (renderiza o chat)
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts    # Redireciona para o OAuth do ML (state/CSRF)
│       │   ├── callback/route.ts # Troca code -> token e salva a conta
│       │   ├── status/route.ts   # Informa se a conta está conectada
│       │   └── logout/route.ts   # Remove as credenciais salvas
│       └── publish/route.ts      # Pipeline em tempo real (Server-Sent Events)
├── components/chat.tsx          # UI de chat + cards de status
└── lib/
    ├── ml.ts                    # Cliente OAuth/REST do Mercado Livre + refresh
    ├── extract.ts               # Regex do MLB ID + fetch do item/descrição
    ├── ai.ts                    # Gemini com JSON estruturado (responseSchema)
    ├── pipeline.ts              # Orquestra extrair -> otimizar -> publicar
    ├── db.ts                    # Prisma Client singleton
    └── types.ts                 # Tipos compartilhados (eventos do pipeline)
```

### Fluxo

1. **Autenticação** — `GET /api/auth/login` monta a URL de autorização do Mercado
   Livre com um `state` anti-CSRF guardado em cookie. O `callback` troca o `code`
   por `access_token` + `refresh_token` e persiste em `MlAccount`. O `access_token`
   é renovado automaticamente via `refresh_token` quando está perto de expirar.
2. **Extração** — resolve os dados priorizando as APIs oficiais: links de
   catálogo (`/p/MLB...`) usam `GET /products/{id}`; o próprio anúncio da conta
   usa `GET /items/{id}`; anúncios de terceiros (bloqueados em `/items`) são
   resolvidos pelo produto de catálogo via `GET /products/search` a partir do
   título no link. O scrap da página HTML fica apenas como último recurso
   (o Mercado Livre bloqueia acesso automático com verificação anti-bot).
3. **Otimização** — `optimizeListing` envia título/preço/atributos/descrição ao
   Gemini com `responseSchema`, garantindo JSON válido:
   ```json
   {
     "title": "Título otimizado até 60 caracteres",
     "description": "Texto puro com Benefícios, Ficha Técnica, Conteúdo da Embalagem e Cuidados/Uso",
     "suggested_price_multiplier": 1.0
   }
   ```
4. **Publicação** — `POST /items` copia fotos, categoria, condição e atributos do
   anúncio original, aplica o markup de preço e, em seguida, define a descrição
   otimizada em `POST /items/{id}/description`.

> Observação: o Mercado Livre não expõe um campo nativo de "tags" — as palavras-chave
> são otimizadas dentro do título e da descrição.

---

## Pré-requisitos

- Node.js 20+
- Uma conta no [Google AI Studio](https://aistudio.google.com/apikey) (gratuito)
- Um app no [Mercado Livre Developers](https://developers.mercadolivre.com.br/devcenter)

---

## Configuração

### 1. Variáveis de ambiente

```bash
cp .env.example .env
```

Preencha o `.env`:

| Variável           | Descrição                                                        |
| ------------------ | ---------------------------------------------------------------- |
| `DATABASE_URL`     | Conexão SQLite (`file:./dev.db`)                                 |
| `APP_URL`          | URL base da app (`http://localhost:3000`)                        |
| `ML_CLIENT_ID`     | App ID do Mercado Livre                                          |
| `ML_CLIENT_SECRET` | Secret do app do Mercado Livre                                   |
| `ML_REDIRECT_URI`  | Deve ser exatamente `{APP_URL}/api/auth/callback`                |
| `ML_SITE_ID`       | Site do Mercado Livre (padrão `MLB` = Brasil)                    |
| `GEMINI_API_KEY`   | Chave gratuita do Google AI Studio                               |
| `GEMINI_MODEL`     | Modelo Gemini (padrão `gemini-1.5-flash`)                        |

### 2. Criar o app no Mercado Livre

1. Acesse [developers.mercadolivre.com.br/devcenter](https://developers.mercadolivre.com.br/devcenter).
2. Crie uma aplicação e copie **Client ID** e **Client Secret**.
3. Em **Redirect URIs**, cadastre exatamente: `http://localhost:3000/api/auth/callback`

### 3. Banco de dados

```bash
npx prisma db push
```

### 4. Rodar

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000), clique em
**Conectar Mercado Livre**, autorize e cole um link de anúncio no chat.

---

## Scripts

| Comando             | Descrição                              |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Ambiente de desenvolvimento            |
| `npm run build`     | Build de produção                      |
| `npm run start`     | Servidor de produção                   |
| `npm run lint`      | ESLint                                 |
| `npx prisma studio` | Inspecionar o banco (contas, jobs, chats) |

---

## Notas e limitações

- **App single-tenant**: as credenciais da conta do Mercado Livre ficam no servidor
  (não há login de usuários da aplicação). Ideal para uso pessoal; para SaaS
  multi-usuário, adicione autenticação e vincule `MlAccount` ao usuário.
- **Categoria/atributos**: o anúncio é criado reaproveitando a categoria e os
  atributos do original. Se o Mercado Livre rejeitar por causa de atributos, a app
  tenta novamente sem eles (veja `createItem` em `src/lib/ml.ts`).
- **Categorias que exigem atributos obrigatórios** podem retornar erro de validação;
  a mensagem do ML é exibida no card do chat para ajuste manual.
- Se o modelo `gemini-1.5-flash` não estiver disponível na sua conta, ajuste
  `GEMINI_MODEL` (ex.: `gemini-2.0-flash`).
