<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Literature Agent

A full-stack AI research assistant that:

- refines a rough research topic,
- searches and filters arXiv literature,
- proposes a novel hypothesis,
- designs and executes a synthetic ML experiment,
- runs reviewer-style validation loops,
- and generates a final research report (exportable to Markdown/PDF).

The app combines a **React + Vite frontend**, an **Express backend**, and a multi-agent orchestration layer that uses Gemini/DeepSeek models for reasoning and report generation.

---

## Table of Contents

- [What this project does](#what-this-project-does)
- [Architecture overview](#architecture-overview)
- [Workflow stages](#workflow-stages)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Available scripts](#available-scripts)
- [Project structure](#project-structure)
- [How experiments are generated](#how-experiments-are-generated)
- [Output artifacts](#output-artifacts)
- [Troubleshooting](#troubleshooting)
- [Notes and limitations](#notes-and-limitations)

---

## What this project does

Given a topic like:

> "robustness in multimodal retrieval"

the agent pipeline will attempt to:

1. narrow this into a more concrete research question,
2. query arXiv across multiple search strategies,
3. verify and rank candidate papers,
4. infer research gaps and create a hypothesis,
5. design experimental methodology and synthetic dataset specs,
6. execute a backend ML experiment endpoint,
7. run reviewer simulation + validation checks,
8. iterate on hypothesis if results are weak,
9. generate a full report with citations and sections.

---

## Architecture overview

```text
React App (src/App.tsx)
   |
   |-- ResearchEngine (src/services/researchEngine.ts)
   |      |-- Topic refinement agent
   |      |-- Literature/search agents
   |      |-- Discovery + design agents
   |      |-- Experiment runner
   |      |-- Validation/reviewer/report agents
   |
   |-- API Client (src/services/apiClient.ts)
          |
          --> Express backend (api/index.ts)
                  |-- /api/arxiv (proxy to export.arxiv.org)
                  |-- /api/run-experiment (synthetic ML experiment)
```

The backend handles network-sensitive tasks (e.g., arXiv proxying and experiment simulation), while the frontend orchestrates agent logic and renders progress/results.

---

## Workflow stages

The UI tracks the research process through status stages such as:

- `refining_topic`
- `searching`
- `verifying_citations`
- `discovering`
- `designing`
- `experimenting`
- `validating_results`
- `revising` (when needed)
- `reporting`
- `verifying_report`
- `completed`

The orchestration includes an iterative refinement loop with a maximum of 3 hypothesis-improvement cycles.

---

## Tech stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Recharts (visualizing experiment outcomes)
- react-markdown
- html2pdf.js

### Backend

- Express
- TypeScript (run with `tsx`)
- `ml-*` ecosystem packages for synthetic training/evaluation simulation

### AI/LLM + retrieval pieces

- `@google/genai` (Gemini)
- DeepSeek/OpenRouter fallback path
- key-rotation + retry logic for LLM reliability
- internal vector store for chunk embedding/retrieval

---

## Getting started

### 1) Prerequisites

- Node.js 18+ (20+ recommended)
- npm 9+

### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Then set at least one Gemini key:

```env
VITE_GEMINI_API_KEY=your_key_here
```

You can optionally add multiple keys for rotation and DeepSeek/OpenRouter fallbacks.

### 4) Run in development

```bash
npm run dev
```

This starts the Express server entrypoint (`api/index.ts`) via `tsx` and serves API routes used by the app.

### 5) Build production assets

```bash
npm run build
```

### 6) Start server mode

```bash
npm run start
```

---

## Environment variables

Defined in `.env.example`:

- `VITE_GEMINI_API_KEY`
- `VITE_GEMINI_KEYS`
- `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ...
- `VITE_DEEPSEEK_API_KEY`
- `VITE_DEEPSEEK_KEYS`
- `DEEPSEEK_API_KEY_1`
- `VITE_OPENROUTER_API_KEY`

### Key handling behavior

The app supports:

- single key,
- comma-separated key lists,
- and key rotation with retry/cooldown logic.

This is useful when running long research workflows that may hit per-key rate limits.

---

## Available scripts

- `npm run dev` — run development server (`tsx api/index.ts`)
- `npm run build` — build frontend with Vite
- `npm run start` — start backend entrypoint with Node
- `npm run preview` — preview Vite build output
- `npm run clean` — remove `dist`
- `npm run lint` — TypeScript type-check (`tsc --noEmit`)

---

## Project structure

```text
.
├── api/
│   └── index.ts               # Express server, arXiv proxy, experiment endpoint
├── src/
│   ├── App.tsx                # Main UI and report/export interactions
│   ├── types.ts               # Core app/research data contracts
│   └── services/
│       ├── researchEngine.ts  # End-to-end orchestration pipeline
│       ├── agents.ts          # Specialized agents (search, design, reporting, etc.)
│       ├── gemini.ts          # Gemini requests, retries, key rotation
│       ├── deepseek.ts        # DeepSeek/OpenRouter fallback calls
│       ├── vectorStore.ts     # Embedding + similarity retrieval
│       ├── apiClient.ts       # Timeouts/retries/error handling for HTTP
│       └── keyRotator.ts      # Multi-key scheduling + failure tracking
├── .env.example
├── package.json
└── README.md
```

---

## How experiments are generated

When the workflow reaches execution:

1. The app posts hypothesis + plan + config to `POST /api/run-experiment`.
2. Backend generates synthetic tabular data based on:
   - dataset size,
   - feature complexity,
   - noise level,
   - task type (classification/regression).
3. Backend simulates an AutoGluon-like tabular ensemble:
   - Random Forest
   - KNN
   - GaussianNB (classification)
   - Logistic Regression meta-learner for stacking
4. It returns evaluation metrics, leaderboard-style summaries, and feature-importance-like signals.

This design gives fast, reproducible experiment evidence without requiring external training infrastructure.

---

## Output artifacts

From the UI, users can export:

- **Markdown report**
- **PDF report**

Reports include abstract, methodology, results, conclusion, and experiment/reviewer evidence sections.

---

## Troubleshooting

### "No papers found" or thin literature results

- Try a more specific topic phrasing.
- Re-run; the system uses multiple query strategies that may vary in quality.
- Confirm network access to arXiv/OpenAlex.

### Frequent model failures or quota errors

- Add multiple keys and use rotation variables.
- Wait for cooldown/retry windows.
- Use fallback provider keys (DeepSeek/OpenRouter).

### TypeScript check fails

Run:

```bash
npm run lint
```

and resolve the reported type errors.

---

## Notes and limitations

- Literature retrieval quality depends on external APIs (arXiv/OpenAlex).
- Experimentation is synthetic/simulated, not a substitute for full real-world benchmarking.
- LLM output can vary run-to-run; the iterative workflow is designed to mitigate but not eliminate variance.
- Research outputs should be treated as assistant-generated drafts requiring expert review before publication.

---

## Quick start (copy/paste)

```bash
npm install
cp .env.example .env.local
# add your VITE_GEMINI_API_KEY to .env.local
npm run dev
```

