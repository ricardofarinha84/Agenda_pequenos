# Agenda dos Pequenos — Porto

Agenda de eventos para famílias no Porto. HTML/JS puro no frontend, GitHub Actions para refresh automático de eventos via API da Anthropic.

## Estrutura

```
agenda-porto/
├── index.html              # Frontend completo (sem frameworks)
├── fontes.json             # Whitelist de sites — EDITAR AQUI para adicionar/remover sites
├── eventos.json            # Gerado automaticamente — NÃO EDITAR À MÃO
├── package.json            # Dependências Node.js (@anthropic-ai/sdk)
├── scripts/
│   └── refresh.js          # Script que chama a API e atualiza eventos.json
└── .github/
    └── workflows/
        └── refresh.yml     # Cron semanal (segunda-feira 8h Lisboa) + workflow_dispatch
```

## Como funciona

1. **Frontend** (`index.html`): carrega `eventos.json` e `fontes.json` no arranque. Dados do utilizador (favoritos, eventos editados, fontes adicionadas manualmente) ficam em `localStorage`.

2. **Refresh automático** (`scripts/refresh.js`): corre via GitHub Actions. Lê `fontes.json`, pesquisa eventos em lotes de 5 sites usando a API da Anthropic com web search, grava `eventos.json` e atualiza os timestamps em `fontes.json`.

3. **Gestão de sites**: para adicionar/remover sites, editar `fontes.json` diretamente no GitHub. O campo `ultimaAtualizacao: null` garante que o site é pesquisado na próxima corrida.

## localStorage (dados do utilizador)

| Chave | Conteúdo |
|---|---|
| `agenda-porto:favoritos` | Array de strings `"titulo_lower\|dataInicio"` |
| `agenda-porto:eventosExtras` | Eventos editados/adicionados manualmente |
| `agenda-porto:fontesExtras` | Fontes adicionadas via UI |
| `agenda-porto:fontesRemovidas` | IDs de fontes de `fontes.json` removidas via UI |
| `agenda-porto:eventosOcultos` | Chaves estáveis de eventos auto removidos |

## Variáveis de ambiente necessárias

- `ANTHROPIC_API_KEY` — guardada em GitHub → Settings → Secrets → ANTHROPIC_API_KEY

## Para correr o refresh manualmente

GitHub → separador Actions → "Atualizar eventos" → "Run workflow"

## Stack

- Frontend: HTML + CSS + JS vanilla (sem frameworks)
- Backend: Node.js 20 + @anthropic-ai/sdk
- Hosting: GitHub Pages (branch main, pasta raiz)
- CI/CD: GitHub Actions

## Convenções

- Datas sempre em formato `AAAA-MM-DD` (ISO 8601 local, não UTC)
- IDs de eventos: string aleatória gerada em cada refresh (não persistente)
- Favoritos identificados por chave estável `titulo.toLowerCase()|dataInicio`
- Tipos de evento válidos: `Literatura, Workshop/Oficina, Música, Teatro/Espetáculo, Exposição, Ar livre, Família/Diversos, Cinema, Outro`
