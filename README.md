# Literature Agent

A production-oriented, multi-agent research workflow application that turns a broad idea into a structured, evidence-backed research report.

Literature Agent combines automated literature retrieval, hypothesis generation, experiment planning, synthetic/real-data experimentation, adversarial review, and factuality verification in a single end-to-end pipeline.

---

## Table of Contents

1. [What This Project Does](#what-this-project-does)
2. [Core Capabilities](#core-capabilities)
3. [System Architecture](#system-architecture)
4. [Research Workflow (Step-by-Step)](#research-workflow-step-by-step)
5. [Technology Stack](#technology-stack)
6. [Repository Structure](#repository-structure)
7. [Prerequisites](#prerequisites)
8. [Environment Variables](#environment-variables)
9. [Installation](#installation)
10. [Running the Application](#running-the-application)
11. [API Endpoints](#api-endpoints)
12. [Experiment Execution Strategy](#experiment-execution-strategy)
13. [State Model and Typed Contracts](#state-model-and-typed-contracts)
14. [Reliability, Rate Limits, and Error Handling](#reliability-rate-limits-and-error-handling)
15. [Output and Export Features](#output-and-export-features)
16. [Security and Operational Notes](#security-and-operational-notes)
17. [Troubleshooting Guide](#troubleshooting-guide)
18. [Development Commands](#development-commands)
19. [Build and Deployment Notes](#build-and-deployment-notes)
20. [Contributing](#contributing)
21. [License](#license)

---

## What This Project Does

Literature Agent is an AI-assisted research system designed to help users move from a **high-level research topic** to a **publishable-style report artifact** with structured sections, traceable literature grounding, experiment evidence, reviewer-style critiques, and a factuality pass.

At a high level, the system:

- Refines a topic into a focused research question.
- Searches literature from multiple sources (ArXiv and OpenAlex).
- Verifies and reranks papers for relevance.
- Extracts gaps and proposes a hypothesis.
- Designs contributions, mathematical framing, and an experiment plan.
- Runs experiments (Python-first with TypeScript fallback).
- Simulates reviewer critiques.
- Generates and iteratively improves a final report.

---

## Core Capabilities

### 1) Multi-agent orchestration
The pipeline is coordinated through a staged research engine that updates application state by phase and supports iterative hypothesis refinement when validation fails.

### 2) Literature retrieval and expansion
The system runs parallelized strategy-based search, semantic reranking, and citation-expansion-style discovery to improve coverage while retaining relevance.

### 3) Vector-based semantic memory
Paper chunks are embedded and loaded into an in-memory vector store to support semantic recall and downstream reasoning.

### 4) Real or synthetic experimentation
Experiments are executed through backend APIs with support for:
- Python-based execution path (preferred)
- TypeScript fallback pipeline
- Kaggle CSV ingestion (when configured)
- Synthetic data generation when external datasets are unavailable

### 5) Adversarial quality controls
The report is evaluated by reviewer simulation and factuality checks. If quality thresholds fail, an automatic refinement pass is triggered.

### 6) Rich reporting UX
The UI supports progress updates, structured output rendering, markdown export, and PDF generation workflows.

---

## System Architecture

```text
[React Frontend]
    |
    | (stateful orchestration + user controls)
    v
[ResearchEngine]
    |--> TopicRefinementAgent
    |--> LiteratureAgent (ArXiv + OpenAlex)
    |--> UnifiedPaperAnalyzerAgent
    |--> SelectionAgent / DiscoveryAgent
    |--> DesignAgent
    |--> ExperimentRunner -> /api/run-experiment
    |--> ResultValidationAgent + ReviewerSimulatorAgent
    |--> ReportAgent
    |--> ReviewerAgent + FactualityEvalAgent
    v
[Final Research Report + Quality Signals]

[Auxiliary Services]
  - Gemini + DeepSeek model access (with key rotation and retry)
  - In-memory vector store (embedding-based retrieval)
  - API client with timeout/retry semantics
  - ArXiv proxy queue with backoff and throttling
```

### Frontend
- Built with React + TypeScript.
- Hosts the full user workflow UI and status timeline.
- Maintains a strongly typed `AppState` object and reacts to orchestration updates.

### Backend
- Express API server exposed by `api/index.ts`.
- Provides ArXiv proxy and experiment execution endpoints.
- Includes robustness logic for queueing, retries, timeout handling, and backend fallback.

### Model/Inference Layer
- Gemini integration with key rotation and retry logic.
- DeepSeek integration with provider detection and structured JSON output.
- Automatic fallback behavior depending on model availability and failure conditions.

---

## Research Workflow (Step-by-Step)

The default pipeline follows these stages:

1. **Topic Refinement**  
   Input topic is transformed into a sharper research question.

2. **Literature Search**  
   Multiple refined and broad query strategies are issued against ArXiv and OpenAlex.

3. **Verification and Analysis**  
   Candidate papers are validated and filtered using a unified analyzer step.

4. **Discovery and Gap Analysis**  
   The system identifies open gaps and proposes an initial hypothesis.

5. **Design**  
   It drafts expected contributions, a mathematical formalization, experiment protocol, and dataset card.

6. **Experimentation**  
   The experiment runner executes with configured controls (dataset size, noise, feature complexity, task type, etc.).

7. **Validation + Reviewer Simulation**  
   Experimental soundness and reviewer-style critiques are generated in parallel.

8. **Iterative Revision (up to max iterations)**  
   If thresholds are not met, hypothesis/design is revised and rerun.

9. **Report Generation**  
   A complete scientific-style report is produced.

10. **Factuality + Adversarial Review**  
    Report is scored for support/faithfulness. If needed, refinement occurs and re-evaluation runs.

11. **Completion**  
    Final report and factuality metrics are surfaced to UI/export actions.

---

## Technology Stack

### Frontend
- React 19
- TypeScript
- Vite
- Tailwind CSS
- Recharts
- react-markdown
- motion
- lucide-react

### Backend
- Node.js + Express
- TypeScript runtime via `tsx`
- Python subprocess support for experiments
- Data processing helpers: PapaParse, AdmZip

### ML / Analytics Utilities
- `ml-random-forest`
- `ml-logistic-regression`
- `ml-knn`
- `ml-naivebayes`
- `ml-matrix`
- `ml-confusion-matrix`

### LLM + Embeddings
- `@google/genai` (Gemini)
- DeepSeek HTTP APIs (direct or OpenRouter path)

---

## Repository Structure

```text
.
├── api/
│   ├── index.ts               # Express server, ArXiv proxy, experiment endpoint
│   └── experiment.py          # Python experiment implementation (preferred execution path)
├── src/
│   ├── App.tsx                # Main UI and orchestration bindings
│   ├── main.tsx               # App bootstrap
│   ├── index.css              # Styling
│   ├── types.ts               # Shared domain/state type contracts
│   ├── lib/
│   │   └── jsonUtils.ts       # JSON sanitization helpers
│   └── services/
│       ├── agents.ts          # Research agents and stage logic
│       ├── researchEngine.ts  # End-to-end workflow orchestrator
│       ├── gemini.ts          # Gemini adapters, retries, key rotation integration
│       ├── deepseek.ts        # DeepSeek adapters and JSON generation helpers
│       ├── keyRotator.ts      # Multi-key rotation, cooldowns, circuit behavior
│       ├── apiClient.ts       # Request abstraction with timeout/retry/error structure
│       └── vectorStore.ts     # In-memory embedding-based semantic retrieval
├── .env.example               # Reference environment variable template
├── package.json               # Scripts and dependencies
├── vite.config.ts             # Vite config + env key aggregation logic
└── README.md
```

---

## Prerequisites

- **Node.js** 18+ (recommended 20+)
- **npm** (ships with Node.js)
- **Python 3** (for primary experiment pathway)
- API credentials for at least one LLM provider (Gemini and/or DeepSeek)

Optional but recommended:
- Kaggle credentials for real dataset execution.

---

## Environment Variables

Create a local `.env` (or equivalent) and configure values appropriate for your runtime.

### Core keys

- `VITE_GEMINI_API_KEY`
- `VITE_DEEPSEEK_API_KEY_1` (or other accepted DeepSeek key variants)

### Kaggle credentials (optional for real-data experiments)

- `KAGGLE_USERNAME`
- `KAGGLE_KEY`
- `KAGGLE_API_TOKEN`

> The project supports multiple key naming patterns and key collections through Vite-defined bundles (`VITE_GEMINI_KEYS`, `VITE_DEEPSEEK_KEYS`) and related aliases.

---

## Installation

```bash
npm install
```

If your workflow depends on Python experiments, ensure Python dependencies required by `api/experiment.py` are available in your environment.

---

## Running the Application

### Development mode

```bash
npm run dev
```

This launches the API server entrypoint (`tsx api/index.ts`) and serves the app workflow for local testing.

### Production build

```bash
npm run build
```

### Production start

```bash
npm run start
```

### Preview built frontend

```bash
npm run preview
```

---

## API Endpoints

### `GET /api/arxiv`
Proxy endpoint for ArXiv search with queueing and throttling.

**Query parameter**
- `q`: search string

**Behavior highlights**
- Auto-prefixes queries for ArXiv grammar when needed.
- Uses global queue to keep request pace conservative and robust.
- Retries on transient failures and 429 conditions.

### `POST /api/run-experiment`
Runs experiment pipeline for a generated hypothesis and plan.

**Expected body fields**
- `hypothesis`
- `plan`
- `config` (optional tuning controls)

**Execution strategy**
1. Attempt Python runner (`api/experiment.py`) first.
2. If Python path fails, fallback to TypeScript in-process implementation.
3. If Kaggle dataset fetch fails or is absent, fallback to synthetic data.

---

## Experiment Execution Strategy

The backend is designed for resilience and continuity:

- **Primary path:** Python subprocess for richer experimental logic.
- **Fallback path:** TypeScript ensemble simulation (RandomForest, KNN, GaussianNB, simulated MLP + stacking/meta-learner).
- **Data source hierarchy:** Kaggle -> synthetic generation.
- **Task modes:** classification, regression, clustering.
- **Evaluation outputs:** accuracy/F1, baselines, ablations, failure cases, optional leaderboard and feature importance.

This layered fallback architecture ensures the user receives meaningful output even under partial infrastructure failures.

---

## State Model and Typed Contracts

The UI and orchestration rely on strict TypeScript interfaces for:

- Papers and chunked literature context
- Hypothesis structures
- Experiment plans and dataset cards
- Experiment results and diagnostics
- Reviewer critiques and factuality outcomes
- Report sections and rendered markdown

The status lifecycle includes rich stages such as:

- `refining_topic`
- `searching`
- `verifying_citations`
- `discovering`
- `designing`
- `experimenting`
- `validating_results`
- `reporting`
- `verifying_report`
- `refining_report`
- `completed` / `error`

This model gives the UI deterministic rendering behavior and clear progress signaling across long-running operations.

---

## Reliability, Rate Limits, and Error Handling

### LLM key rotation and retries
- Multi-key rotation with per-key cooldown behavior.
- Distinct handling for auth errors, rate limits, transient server faults, and timeouts.
- Circuit-breaker-like behavior to avoid repeatedly hammering unhealthy keys.

### API client resiliency
- Request timeouts.
- Exponential backoff on retryable errors.
- Structured `ApiError` payloads including stage metadata.

### ArXiv proxy controls
- Global queue for pacing and compliance.
- Retry logic for 429 and timeout classes.
- Controlled delay between queue tasks.

### Workflow-level resilience
- Strict verification fallback to top candidates if no paper passes filters.
- Iterative hypothesis refinement with maximum iteration bounds.
- Report refinement triggered by quality/factuality thresholds.

---

## Output and Export Features

The interface supports output portability and review workflows:

- Full markdown report export.
- PDF generation support through `html2pdf.js` integration.
- Clipboard actions for selected report sections.
- Visual metric summaries (charts and comparisons).

---

## Security and Operational Notes

1. **Never commit real credentials.** Use local env files and secret management in deployment targets.
2. **Review source for hardcoded temporary keys before production.** If present, remove and rotate immediately.
3. **Constrain network egress and API scopes in production.**
4. **Use observability and logs for long-running multi-agent traces.**
5. **Treat generated outputs as assistive drafts requiring domain review for publication-grade claims.**

---

## Troubleshooting Guide

### “No papers found” or weak retrieval
- Try a narrower, highly technical topic phrase.
- Ensure network access to ArXiv/OpenAlex endpoints.
- Confirm backend process is running and proxy route is reachable.

### LLM calls fail repeatedly
- Verify API keys and provider quotas.
- Confirm environment variable names match accepted patterns.
- Reset runtime and re-test with a single known-valid key first.

### Experiment endpoint errors
- Ensure Python 3 is installed and callable as `python3`.
- If Python path fails, inspect fallback logs from TypeScript path.
- For Kaggle workflows, confirm credentials and dataset access permissions.

### Build/type issues
- Run `npm run lint` to surface TypeScript diagnostics.
- Validate `tsconfig.json` and Vite env assumptions.

---

## Development Commands

```bash
npm run dev      # run local development server (tsx api/index.ts)
npm run build    # create production bundle
npm run start    # run server entrypoint in node
npm run preview  # preview Vite build output
npm run lint     # TypeScript type-check (no emit)
npm run clean    # remove dist directory
```

---

## Build and Deployment Notes

- Vite configuration aggregates multiple key naming conventions and injects normalized key arrays into `import.meta.env`.
- A `vercel.json` file exists for deployment configuration patterns.
- Ensure runtime environment includes both frontend and backend variables when deploying a unified service.
- For production, configure process management (PM2/systemd/container) and request logging.

---

## Contributing

1. Fork or branch from your main line.
2. Create focused, testable changes.
3. Run type checks and smoke tests before PR.
4. Document behavior changes (especially agent workflow modifications).
5. Keep secrets out of commits and screenshots.

Recommended contribution areas:
- Better citation-grounding logic
- Enhanced experiment backends
- Improved UI explainability and observability
- Richer model provider abstraction

---

## License

This project is licensed under the **Apache License 2.0**. See [`LICENSE`](./LICENSE) for the full license text.
