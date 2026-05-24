# Challenge 14: Agentic Search

AI-powered product search with natural language understanding, multi-turn conversation memory (Valkey JSON), and agent tools.

## Prerequisites

- Node.js 18+
- Valkey or Redis 7+ with **RedisJSON** (`JSON.SET` / `JSON.GET`)

```bash
# Example with Docker
docker run -d --name valkey -p 6379:6379 redis/redis-stack:latest
```

## Setup

```bash
cd backend
cp .env.example .env   # or use existing .env
npm install
```

`.env`:

```
PORT=3001
VALKEY_URL=redis://localhost:6379
```

## Run

```bash
# Terminal 1 – API server (backend/)
npm start

# Terminal 2 – React UI (frontend/)
npm start
# Open http://localhost:3000/ai-search

# Terminal 3 – smoke tests (backend/)
npm run test:agent
```

### UI

- Route: **http://localhost:3000/ai-search**
- Nav: **Shop → AI Search** or top menu **AI Search**
- Chat supports sample prompts, multi-turn refinement, and thumbs up/down feedback

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/search` | Natural language search |
| GET | `/api/agent/conversation/:sessionId` | Conversation history |
| POST | `/api/agent/feedback` | Thumbs up/down on a result |
| POST | `/api/agent/refine` | Refine with same `sessionId` |
| GET | `/api/agent/debug/:sessionId` | Parsed params & tools per turn |

### Example

```bash
curl -X POST http://localhost:3001/api/agent/search \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"I need a birthday gift for my 10-year-old nephew who likes science\"}"

# Follow-up (use sessionId from response)
curl -X POST http://localhost:3001/api/agent/search \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"sess_...\",\"message\":\"Show me cheaper options\"}"
```

## Architecture

- `services/agent.js` – NLU parsing, tool orchestration, explanations
- `services/valkey.js` – Conversation storage, cache, product search
- `routes/agent.js` – REST endpoints

### Agent tools

`search_products`, `semantic_search`, `get_product_details`, `check_availability`, `find_similar`, `ask_clarification`

### Valkey keys

- `conversation:{sessionId}` – JSON document, TTL 1800s
- `agent_cache:{queryHash}` – cached results, TTL 300s
- `user_preferences:{userId}` – long-term prefs (API ready in valkey service)
- `feedback:{sessionId}:{productId}` – user feedback
