# Literature Agent

A multi-agent AI research assistant that turns a user topic into a full mini research cycle:

1. Refines the research topic.
2. Searches and ranks literature (arXiv + OpenAlex).
3. Discovers gaps and proposes a hypothesis.
4. Designs an experiment and synthetic dataset spec.
5. Runs an actual ML experiment through a backend simulation stack.
6. Performs reviewer + factuality checks.
7. Produces a publication-style report with export options.

---

## Table of Contents

- [What this project does](#what-this-project-does)
- [Core capabilities](#core-capabilities)
- [High-level architecture](#high-level-architecture)
- [Agent workflow (end-to-end pipeline)](#agent-workflow-end-to-end-pipeline)
- [Tech stack and libraries used](#tech-stack-and-libraries-used)
- [Project structure](#project-structure)
- [Data flow](#data-flow)
- [Backend APIs](#backend-apis)
- [Configuration and environment variables](#configuration-and-environment-variables)
- [Local development](#local-development)
- [Build and run](#build-and-run)
- [Operational notes](#operational-notes)
- [Known limitations](#known-limitations)
- [Roadmap ideas](#roadmap-ideas)

---

## What this project does

**Literature Agent** is a React + TypeScript application with a Node/Express backend that automates a research-like workflow using LLM agents and retrieval.

From a single input topic, the app:

- Performs topic refinement to increase query quality.
- Runs parallel paper discovery and citation expansion.
- Builds a lightweight in-memory vector index over paper chunks.
- Generates research gaps, hypothesis, contribution list, math formalization, and experimental plan.
- Executes a backend ML simulation (ensemble/stacking inspired by AutoGluon patterns).
- Simulates reviewer critiques and runs factuality verification.
- Produces a detailed report that can be exported as Markdown or PDF.

---

## Core capabilities

- **Multi-agent orchestration** via a central `ResearchEngine`.
- **Literature ingestion pipeline** with deduplication and semantic reranking.
- **Hybrid provider strategy**: DeepSeek preferred, Gemini fallback in generation paths.
- **Adaptive key rotation** with retry/cooldown/hedging to improve reliability.
- **Experiment simulation endpoint** with synthetic data + multiple ML models.
- **Interactive UI** with progress state machine, charts, logs, and report export.

---

## High-level architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                              Frontend (Vite + React)                │
│  App.tsx                                                             │
│  - Input topic                                                       │
│  - Progress timeline                                                 │
│  - Agent status + API key status                                    │
│  - Charts, logs, report rendering (Markdown)                        │
└───────────────┬──────────────────────────────────────────────────────┘
                │
                │ orchestrates
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Research Engine (services/)                  │
│  researchEngine.run(...)                                            │
│  - TopicRefinementAgent                                             │
│  - LiteratureAgent / UnifiedPaperAnalyzerAgent                      │
│  - SelectionAgent / DiscoveryAgent                                  │
│  - DesignAgent / ExperimentRunner                                   │
│  - Validation + Reviewer + Report + Factuality agents              │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │                               │
                │ LLM calls                     │ backend calls
                ▼                               ▼
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ LLM Provider Layer            │     │ Express API (api/index.ts)    │
│ - deepseek.ts                 │     │ - /api/arxiv                  │
│ - gemini.ts                   │     │ - /api/run-experiment         │
│ - keyRotator.ts               │     │   (ML simulation pipeline)     │
└───────────────────────────────┘     └───────────────────────────────┘
                │
                │ embeddings
                ▼
┌───────────────────────────────┐
│ In-memory Vector Store        │
│ vectorStore.ts                │
│ - addDocuments                │
│ - search (cosine similarity)  │
└───────────────────────────────┘
```

---

## Agent workflow (end-to-end pipeline)

The application state advances through explicit statuses (`idle`, `refining_topic`, `searching`, `discovering`, `designing`, `experimenting`, `reporting`, `completed`, etc.).

### Step-by-step

1. **Topic Refinement**  
   `TopicRefinementAgent.refine` narrows broad prompts into focused research questions.

2. **Literature Search + Expansion**  
   `LiteratureAgent.fetchPapers`:
   - Refines search query.
   - Runs parallel search strategies.
   - Queries arXiv through local proxy and OpenAlex directly.
   - Deduplicates papers.
   - Performs semantic rerank.
   - Expands results through related-work traversal.

3. **Verification and Selection**  
   `UnifiedPaperAnalyzerAgent` verifies and structures candidate papers; `SelectionAgent` curates best papers.

4. **Vector Index Ingestion**  
   Chunks are embedded and stored in `SimpleVectorStore` for semantic retrieval.

5. **Discovery**  
   `DiscoveryAgent.discover` identifies gaps and proposes initial hypothesis.

6. **Iterative Research Loop (up to 3 iterations)**
   - `DesignAgent.design` builds contributions, math formalization, experiment plan, dataset card.
   - `ExperimentRunner.runExperiment` executes backend simulation.
   - `ResultValidationAgent` + `ReviewerSimulatorAgent` score results.
   - If weak: `DiscoveryAgent.debug` revises hypothesis and repeats.

7. **Report Generation + Quality Gate**
   - `ReportAgent.generateReport` builds full report.
   - `ReviewerAgent.review` + `FactualityEvalAgent.evaluate` judge quality/faithfulness.
   - Optional one-pass refinement via `ReportAgent.refineReport`.

8. **Final Output**
   Report is displayed in UI and can be exported as `.md` or `.pdf`.

---

## Tech stack and libraries used

### Frontend

- **React 19** (`react`, `react-dom`)
- **TypeScript**
- **Vite**
- **Tailwind CSS v4** + `@tailwindcss/vite`
- **motion** for UI transitions
- **lucide-react** icons
- **react-markdown** for rendering report sections
- **recharts** for experiment/reviewer visualizations
- **html2pdf.js** for client-side PDF export

### Backend

- **Node.js + Express** (`api/index.ts`)
- Custom experiment simulation endpoint
- arXiv XML proxy endpoint

### AI / Retrieval / ML

- **Gemini SDK** (`@google/genai`) for text/JSON generation and embeddings
- **DeepSeek/OpenRouter HTTP integration** as preferred generation provider
- **KeyRotator** custom reliability layer (cooldown, hedging, adaptive concurrency)
- **fast-xml-parser** for arXiv responses
- **In-memory vector store** with cosine similarity
- **ML libraries** for experiment simulation:
  - `ml-random-forest`
  - `ml-logistic-regression`
  - `ml-knn`
  - `ml-naivebayes`
  - `ml-matrix`
  - `ml-confusion-matrix`

### Utility

- `dotenv`
- `clsx` + `tailwind-merge`
- `papaparse` (available for data handling extensions)

---

## Project structure

```text
.
├── api/
│   └── index.ts                # Express server: arXiv proxy + experiment endpoint
├── src/
│   ├── App.tsx                 # Main UI and orchestration hooks
│   ├── main.tsx                # Frontend entry
│   ├── index.css               # Global styles
│   ├── types.ts                # Domain types and app state machine statuses
│   └── services/
│       ├── agents.ts           # Individual agent implementations
│       ├── researchEngine.ts   # Workflow orchestrator
│       ├── gemini.ts           # Gemini integration + fallback strategy
│       ├── deepseek.ts         # DeepSeek/OpenRouter integration
│       ├── keyRotator.ts       # API key reliability + concurrency control
│       ├── vectorStore.ts      # Embedding-based retrieval store
│       └── apiClient.ts        # HTTP client with retries/timeouts
├── .env.example                # Environment variable template
├── package.json                # Scripts and dependencies
├── vite.config.ts
└── README.md
```

---

## Data flow

1. User enters topic in UI.
2. UI calls `researchEngine.run(...)`.
3. Engine coordinates agents and updates `AppState` incrementally.
4. Literature fetched from arXiv/OpenAlex; chunks embedded and indexed.
5. Experiment requests sent to backend `/api/run-experiment`.
6. Report and factuality result streamed back into frontend state.
7. UI renders all artifacts: papers, hypothesis, charts, critiques, final report.

---

## Backend APIs

### `GET /api/arxiv?q=<query>`

- Acts as proxy to arXiv API (CORS-safe for browser client).
- Adds timeout and standardized error handling.
- Returns XML body from arXiv.

### `POST /api/run-experiment`

- Input: `{ hypothesis, plan, config }`
- Builds synthetic data according to config:
  - dataset size
  - feature complexity
  - noise level
  - task type (`classification`/`regression`/`clustering`)
- Trains a simulated stacked ensemble and returns metrics, leaderboard, feature importance, and logs.

---

## Configuration and environment variables

Copy `.env.example` to `.env.local` and set keys.

### Supported key formats

- Single key
- Comma-separated key list
- Multiple numbered variables
- Optional OpenRouter key

### Important variables

```bash
# Gemini
VITE_GEMINI_API_KEY=
VITE_GEMINI_KEYS=key1,key2,key3
GEMINI_API_KEY_1=
GEMINI_API_KEY_2=

# DeepSeek
VITE_DEEPSEEK_API_KEY=
VITE_DEEPSEEK_KEYS=
DEEPSEEK_API_KEY_1=

# OpenRouter
VITE_OPENROUTER_API_KEY=
```

---

## Local development

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Run dev server

```bash
npm run dev
```

This starts the app via `tsx api/index.ts` (Express backend entry used by this project setup).

---

## Build and run

### Type check

```bash
npm run lint
```

### Build static assets

```bash
npm run build
```

### Start backend

```bash
npm run start
```

### Preview built frontend

```bash
npm run preview
```

---

## Operational notes

- The workflow is designed for resilience: retries, cooldowns, and key rotation are built in.
- DeepSeek is treated as preferred generation path; Gemini is integrated broadly and used for embeddings.
- The app uses an in-memory vector store, so retrieval state resets on refresh/restart.
- The engine performs bounded iteration (`MAX_WORKFLOW_ITERATIONS = 3`) to avoid runaway loops.

---

## Known limitations

- Not all sources provide full abstracts (OpenAlex often returns metadata-only summary in current mapping).
- Vector retrieval is in-memory only (no persistence).
- Experiment pipeline is a simulation of AutoML-style behavior, not full AutoGluon itself.
- Production hardening items (auth, rate policy, secret management, monitoring) are not fully wired.

---

## Roadmap ideas

- Persist vector index and experiment runs (e.g., SQLite/Postgres + pgvector).
- Add true citation graph scoring and DOI/metadata normalization.
- Add human-in-the-loop controls for paper inclusion/exclusion.
- Add prompt/version tracing and structured observability.
- Add reproducible experiment seeds and downloadable artifacts.
- Add integration tests for end-to-end workflow and API contracts.

---

## Quick script reference

```bash
npm run dev      # Run development server
npm run build    # Build frontend
npm run start    # Start backend service
npm run preview  # Preview build
npm run lint     # Type-check (no emit)
npm run clean    # Remove dist folder
```
