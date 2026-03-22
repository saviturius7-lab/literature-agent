# Literature Agent

Literature Agent is a research-oriented web application that orchestrates a multi-step, multi-agent workflow for turning a rough topic into a grounded pseudo-paper workflow. It combines arXiv retrieval, OpenAlex verification, retrieval-augmented generation (RAG), hypothesis generation, synthetic experiment execution, reviewer simulation, and report drafting inside a single React + Express application.
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

The project is designed to do more than just chat about a topic. It attempts to:

- refine an initial idea into a narrower research question,
- search arXiv using multiple retrieval strategies,
- verify candidate papers against a real-world scholarly index,
- chunk and embed paper summaries for later retrieval,
- identify literature gaps,
- generate and test a hypothesis,
- simulate an actual machine learning experiment on the backend,
- critique the output with reviewer personas, and
- assemble a report that is repeatedly checked for factual grounding.

---

## Table of Contents

1. [What the application does](#what-the-application-does)
2. [Core capabilities](#core-capabilities)
3. [End-to-end workflow](#end-to-end-workflow)
4. [Architecture overview](#architecture-overview)
5. [Tech stack](#tech-stack)
6. [Project structure](#project-structure)
7. [Environment variables](#environment-variables)
8. [Getting started](#getting-started)
9. [Available scripts](#available-scripts)
10. [How the backend works](#how-the-backend-works)
11. [How the agent system works](#how-the-agent-system-works)
12. [Retrieval, grounding, and verification strategy](#retrieval-grounding-and-verification-strategy)
13. [Experiment system details](#experiment-system-details)
14. [Report generation and factuality checks](#report-generation-and-factuality-checks)
15. [Operational notes and limitations](#operational-notes-and-limitations)
16. [Troubleshooting](#troubleshooting)
17. [Development notes](#development-notes)
18. [Future improvement ideas](#future-improvement-ideas)

---

## What the application does

At a high level, Literature Agent is a full-stack research workflow assistant focused on technical literature exploration.

A user enters a topic, such as a modeling problem or a subfield idea. The application then runs a staged workflow that tries to mimic a lightweight research pipeline:

1. **Topic refinement** narrows the user input into a more research-ready question.
2. **Literature search** queries arXiv using several search strategies in parallel.
3. **Verification** filters papers for relevance and checks whether they can be corroborated through OpenAlex.
4. **Chunking + embeddings** convert paper summaries into searchable context for downstream RAG.
5. **Gap analysis** identifies missing opportunities in the retrieved literature.
6. **Hypothesis generation** proposes a grounded idea based on the retrieved evidence.
7. **Novelty checking** compares the hypothesis to the literature using embeddings.
8. **Contribution extraction** enumerates what the proposed work would contribute.
9. **Mathematical formalization** frames the proposal more rigorously.
10. **Experiment design** outlines datasets, baselines, metrics, and protocol.
11. **Dataset card generation** drafts metadata for the proposed dataset.
12. **Backend experiment execution** runs a concrete synthetic ML experiment.
13. **Result validation** checks whether results support the hypothesis.
14. **Reviewer simulation** creates critical peer-review style feedback.
15. **Revision** refines the hypothesis/results package.
16. **Report generation** writes a report using the curated literature and experiment output.
17. **Verification + factuality evaluation** attempts to catch unsupported claims.

This makes the app useful as a demonstration of agent orchestration, retrieval grounding, and model-assisted research workflow design, rather than as a production-grade scientific discovery platform.

---

## Core capabilities

### 1. Multi-strategy literature retrieval
The app does not rely on a single search query. It combines:

- the raw user topic,
- an LLM-refined arXiv query,
- broad keyword expansion, and
- a generic fallback search if too few papers are found.

This improves recall for niche or overly specific topics.

### 2. Real-paper bias through verification
Retrieved arXiv entries are not accepted blindly. Candidate papers are screened by a unified analyzer that:

- checks topical relevance,
- evaluates whether the summary appears internally consistent, and
- verifies title/author signals against OpenAlex.

### 3. Lightweight RAG over the paper set
Paper summaries are chunked, embedded, and stored in an in-memory vector store. That store is later queried when generating hypotheses and drafting reports so the language model can condition on retrieved context rather than only on the latest prompt.

### 4. Provider key rotation and fallback logic
The provider layer is built to support:

- multiple keys,
- rotation,
- concurrency throttling,
- cooldowns for rate-limited keys,
- invalid-key removal, and
- retry behavior.

The current runtime prefers DeepSeek for JSON and text generation when keys are available, then falls back to Gemini when needed.

### 5. Faster semantic retrieval
The in-memory vector store now stores a cached norm alongside each embedding and uses a bounded min-heap during search. That means the store:

- avoids recomputing document magnitudes on every query,
- keeps only the best `k` candidates while scanning documents, and
- returns top matches without sorting the full corpus each time.

### 6. Real backend experiment execution
The experiment stage is not a static fake response. The backend actually:

- generates a synthetic binary classification dataset,
- trains a Random Forest model,
- trains a Logistic Regression baseline,
- computes evaluation metrics using confusion matrices, and
- returns structured experiment output with baselines, ablations, failure cases, and logs.

### 7. Report generation with self-checking
The reporting pipeline tries to stay grounded by:

- restricting citations to the selected paper list,
- generating verification questions about the report,
- answering those questions against the source context, and
- refining the report based on verification outputs.

---

## End-to-end workflow

Below is the practical flow from user input to final report.

### Stage 1: Topic intake and reset
When the user starts a new run, the app resets prior state, clears previous papers and outputs, resets progress messaging, and empties the vector store so the next run does not mix evidence across topics.

### Stage 2: Topic refinement
The `TopicRefinementAgent` transforms a broad topic into a narrower research question that is more appropriate for the rest of the pipeline.

### Stage 3: Literature search
The `LiteratureAgent` performs a multi-pronged search:

- searches the original topic,
- asks `SearchQueryAgent` for an optimized arXiv query,
- asks the same agent for broad technical keywords,
- executes the refined and keyword-based searches in parallel,
- deduplicates by normalized title,
- falls back to broader generic research queries if needed.

### Stage 4: Relevance and verification
The `UnifiedPaperAnalyzerAgent` batches papers and asks the model to judge:

- relevance to the topic,
- whether the summary seems coherent/realistic,
- what the key findings are.

It then checks each paper against OpenAlex. Only papers that pass both model-based screening and OpenAlex verification are retained.

### Stage 5: Chunking and vector indexing
Each retained paper summary is chunked into smaller sections using recursive separators. Chunks are embedded and inserted into `SimpleVectorStore`, which enables future semantic search.

### Stage 6: Gap identification and paper selection
The app identifies likely research gaps and then narrows the literature list to a smaller set of foundational or high-impact papers to support downstream generation.

### Stage 7: Hypothesis generation and novelty check
The hypothesis generator pulls top retrieved chunks from the vector store, combines them with the selected papers, and proposes a grounded hypothesis. The novelty checker embeds the hypothesis and the literature to estimate similarity and reject ideas that appear too close to existing work.

### Stage 8: Research package expansion
After a viable hypothesis is found, the app generates:

- explicit contributions,
- a mathematical formalization,
- an experiment plan,
- and a dataset card.

### Stage 9: Experiment execution
The backend receives the hypothesis and experiment plan, then runs a synthetic ML experiment. The app uses these results as evidence in later validation and reporting stages.

### Stage 10: Critique, revision, and reporting
The experiment results are validated, peer reviewers are simulated, the work is revised, and a long-form report is generated. The report is then checked for unsupported claims and evaluated for factuality.

---

## Architecture overview

The application is a small monorepo-style full-stack project with a shared TypeScript codebase.

### Frontend
- **React 19** powers the interface.
- **Vite** provides bundling and frontend tooling.
- **Tailwind CSS via the Vite plugin** supports styling.
- **Lucide React** provides icons.
- **Motion** powers animations.
- **Recharts** is used for metric visualizations.
- **react-markdown** renders generated content.
- **html2pdf.js** supports exporting reports.

### Backend
- **Express** provides the HTTP server.
- The backend serves two main API capabilities:
  - an arXiv proxy endpoint to bypass browser CORS restrictions,
  - an experiment endpoint that runs real synthetic ML training/evaluation.

### Model services
- **DeepSeek** is the preferred generation provider when keys are available.
- **Gemini** is available as the fallback path and also supplies embeddings.
- Embeddings are used for novelty checks and vector retrieval.

### Data flow style
The app uses mostly in-memory state:

- React component state stores the current run,
- vector embeddings live in an in-memory store,
- no persistent database is configured,
- experiment artifacts are generated on demand and discarded when the session resets.

---

## Tech stack

### Runtime and language
- Node.js
- TypeScript
- ECMAScript modules

### Frontend libraries
- React
- React DOM
- Vite
- Tailwind CSS
- Lucide React
- Motion
- React Markdown
- Recharts
- html2pdf.js
- clsx
- tailwind-merge

### Backend and data processing
- Express
- fast-xml-parser
- dotenv
- papaparse

### ML / evaluation libraries
- ml-random-forest
- ml-logistic-regression
- ml-matrix
- ml-confusion-matrix

### Model integrations
- @google/genai
- DeepSeek HTTP API integration

---

## Project structure

```text
.
├── api/
│   └── index.ts              # Express server, arXiv proxy, experiment endpoint
├── src/
│   ├── services/
│   │   ├── agents.ts         # Main agent pipeline and orchestration logic
│   │   ├── deepseek.ts       # DeepSeek key rotation and JSON generation
│   │   ├── gemini.ts         # Gemini key rotation, retries, embeddings, generation
│   │   └── vectorStore.ts    # In-memory vector store for semantic retrieval
│   ├── App.tsx               # Main UI and end-to-end workflow controller
│   ├── main.tsx              # Frontend bootstrap
│   ├── index.css             # App styling
│   └── types.ts              # Shared application and workflow types
├── .env.example              # Example environment variable layout
├── metadata.json             # App metadata
├── package.json              # Scripts and dependencies
├── vercel.json               # Deployment configuration
├── vite.config.ts            # Vite config and environment key collection
└── README.md                 # Project documentation
```

---

## Environment variables

Copy `.env.example` to a local env file such as `.env.local` or `.env` and populate the keys you need.

### Gemini variables
You can provide Gemini credentials in several forms:

- `VITE_GEMINI_API_KEY`
- `VITE_GEMINI_API_KEYS` as a comma-separated list
- `GEMINI_API_KEY`
- `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc.
- `VITE_GEMINI_API_KEY_1`, `VITE_GEMINI_API_KEY_2`, etc.
- `VITE_GEMINI_KEYS`
- `GEMINI_KEYS`

The Vite config collects matching variables and injects them into `import.meta.env.VITE_GEMINI_KEYS`, which the frontend key manager then deduplicates and filters.

### DeepSeek variables
Optional fallback support can be configured through:

- `VITE_DEEPSEEK_API_KEY`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_API_KEY_1`, etc.
- `VITE_DEEPSEEK_API_KEY_1`, etc.
- `VITE_DEEPSEEK_KEYS`
- `DEEPSEEK_KEYS`

### Example

```env
# Gemini
VITE_GEMINI_API_KEY=your_primary_key
VITE_GEMINI_API_KEYS=key_a,key_b,key_c
GEMINI_API_KEY_1=optional_extra_key
GEMINI_API_KEY_2=optional_extra_key

# DeepSeek (optional fallback)
VITE_DEEPSEEK_API_KEY_1=optional_deepseek_key
VITE_DEEPSEEK_KEYS=key_x,key_y
```

### Important notes
- Placeholder-looking values are intentionally filtered out.
- The app expects valid keys to be at least moderately long.
- If no Gemini keys are available, model-driven stages will fail.
- DeepSeek is optional, but useful if you want additional resiliency for JSON generation.

---

## Getting started

### Prerequisites
Make sure you have:

- **Node.js** installed,
- **npm** available,
- at least one valid **Gemini API key**,
- internet access for arXiv, OpenAlex, Gemini, and optionally DeepSeek.

### Installation

```bash
npm install
```

### Configure environment

Create a local environment file and add your keys:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and populate the API keys.

### Start the application in development mode

```bash
npm run dev
```

The dev script starts the Express server via `tsx api/index.ts`. In development, the server creates a Vite middleware instance and serves the React app through the same Node process.

### Build for production

```bash
npm run build
```

### Run production server

```bash
npm run start
```

Note: the `start` script runs `node api/index.ts`. Depending on your runtime/tooling, you may prefer a compiled or `tsx`-based production start flow if plain Node execution of TypeScript is not available in your deployment environment.

---

## Available scripts

### `npm run dev`
Runs the Express server in development mode with Vite middleware.

### `npm run build`
Builds the frontend using Vite.

### `npm run start`
Starts the server entrypoint.

### `npm run preview`
Runs Vite preview for the built frontend.

### `npm run clean`
Removes the `dist` directory.

### `npm run lint`
Runs `tsc --noEmit` as a TypeScript correctness check.

---

## How the backend works

The backend is intentionally small and focused.

### `/api/arxiv`
This endpoint accepts a `q` query parameter and forwards the request to the arXiv API.

#### Why it exists
The frontend cannot reliably call arXiv directly from the browser due to CORS restrictions, so the backend proxies the request.

#### Behavior
- Accepts query strings directly.
- If the query does not already start with `all:`, `ti:`, or `au:`, it prefixes `all:`.
- Requests up to 30 results sorted by relevance.
- Returns XML directly.
- Uses a 10-second timeout.

### `/api/run-experiment`
This endpoint accepts a hypothesis and experiment plan and returns a structured experiment result.

#### Input validation
If either `hypothesis` or `plan` is missing, the endpoint returns a validation error.

#### Data generation
The backend synthesizes a binary classification dataset with:

- 1000 samples,
- 10 features,
- labels determined by a nonlinear sum-of-squares threshold,
- 5% noise injection.

#### Models trained
1. **Random Forest** as the proposed model
2. **Logistic Regression** as the baseline

#### Metrics returned
- Accuracy
- F1 score
- Precision
- Recall

#### Additional structured outputs
The endpoint also returns:

- baseline summaries,
- example ablation studies,
- example failure cases,
- implementation details,
- execution logs.

#### Error handling
The endpoint reports a stage label for failures such as:

- validation,
- data preparation,
- random forest training,
- logistic regression training,
- unknown errors.

---

## How the agent system works

All primary orchestration logic lives in `src/services/agents.ts`.

### TopicRefinementAgent
Refines a user topic into a narrower, more actionable research question.

### SearchQueryAgent
Generates:
- an optimized arXiv query,
- broad keyword expansions for fallback retrieval.

### LiteratureAgent
Handles:
- parallel search strategies,
- response parsing from arXiv XML,
- deduplication,
- fallback searches,
- conversion of entries into internal `Paper` objects.

### UnifiedPaperAnalyzerAgent
Applies a combined screening step that evaluates:
- relevance,
- internal consistency,
- extracted findings,
- external verification via OpenAlex.

### ChunkingAgent
Splits paper summaries into overlapping chunks with lightweight section labels so the text can later be searched semantically.

### GapIdentificationAgent
Looks across the evidence set and proposes research gaps with supporting references.

### SelectionAgent
Selects a smaller set of the most foundational or highest-impact papers for downstream reasoning.

### HypothesisAgent
Uses retrieved vector context plus selected paper evidence to produce a hypothesis and self-critique before returning a final grounded version.

### NoveltyCheckerAgent
Embeds the hypothesis and source papers, computes cosine similarity, and checks whether the idea is too close to existing work under an adaptive threshold.

### ContributionAgent
Extracts at least two explicit contributions from the hypothesis.

### MathFormalizerAgent
Creates:
- a problem formulation,
- notation,
- an objective function,
- algorithm steps.

### ExperimentDesignAgent
Produces:
- experiment protocol,
- dataset list,
- baseline list,
- metric list.

### DatasetGeneratorAgent
Builds a dataset card for the primary experimental dataset.

### ExperimentRunner
Calls the backend experiment endpoint and normalizes errors into more actionable messages.

### ResultValidationAgent
Asks whether the observed metrics support the original hypothesis.

### ReviewerSimulatorAgent
Simulates three reviewer critiques with weaknesses, novelty feedback, and ratings.

### RevisionAgent
Creates a revised hypothesis/result package that addresses reviewer concerns.

### ReportAgent
Writes a long-form report, generates verification questions, answers those questions against the evidence set, and refines the report accordingly.

### VerificationAgent
Performs a basic citation/report integrity check.

### FactualityEvalAgent
Evaluates report faithfulness against the provided literature and flags unsupported claims.

---

## Retrieval, grounding, and verification strategy

One of the more interesting aspects of the project is how it tries to reduce hallucinations.

### 1. Retrieval diversity
The app does not trust one search query. It intentionally broadens and refines the topic simultaneously.

### 2. External verification
OpenAlex is used as an external signal that a retrieved item corresponds to a real scholarly work.

### 3. Chunked evidence representation
The system does not treat each paper as a single monolithic blob. It converts summaries into chunks and uses those chunks for later retrieval.

### 4. Embedding-based novelty estimation
The novelty checker uses embedding similarity to determine whether the generated hypothesis may be derivative.

### 5. Citation-constrained report drafting
The report prompt explicitly restricts citations to the provided list of papers.

### 6. Verification loop after drafting
The report generator creates verification questions, answers them from source context, and asks the model to refine the report based on those answers.

### 7. Final factuality scoring
A separate factuality evaluation stage estimates a faithfulness score and flags unsupported claims.

### Caveat
These mechanisms improve grounding, but they do **not** guarantee actual scientific validity. The app is best understood as a careful prototype for grounded research assistance rather than an authoritative scientific system.

---

## Experiment system details

The experiment subsystem is intentionally modest but still meaningful for a demo.

### Synthetic dataset
The backend generates a binary classification problem with a nonlinear boundary. This is useful because:

- it gives the Random Forest a natural advantage over a linear baseline,
- it creates a deterministic story for comparison,
- it allows the app to return concrete metrics instead of fabricated ones.

### Proposed model vs baseline
The current setup compares:

- **Random Forest (Proposed)**
- **Logistic Regression (Baseline)**

This aligns with the backend response shape, where the best model is used as the headline result and the remaining model(s) are exposed as baselines.

### Why this matters
Many “research workflow assistant” demos only generate narrative text. This project at least executes an actual backend ML routine and feeds those outputs into later analysis.

### What it does not do
- It does not train on real domain datasets.
- It does not dynamically map the generated hypothesis into a custom model architecture.
- It does not produce reproducible experiment seeds/config files.
- It does not persist artifacts.

So the experiment stage should be viewed as a real-but-simplified demonstration of evidence generation.

---

## Report generation and factuality checks

The reporting system is more sophisticated than a single prompt.

### Phase 1: Initial report generation
The report is drafted from:
- selected papers,
- retrieved chunks from vector search,
- contributions,
- mathematical formalization,
- dataset details,
- experiment plan,
- actual experiment outputs,
- reviewer feedback.

The prompt explicitly requires:
- contributions,
- mathematical formalization,
- dataset description,
- baseline comparison,
- ablation study,
- failure case analysis,
- implementation details,
- experimental evidence,
- citation restrictions.

### Phase 2: Verification question generation
The system asks for a list of questions that could uncover hallucinations, miscitations, or unsupported claims in the generated report.

### Phase 3: Independent verification answers
It then answers those questions using only the paper context.

### Phase 4: Final refinement
The report is rewritten or corrected based on the verification answers.

### Separate post-checks
After generation, additional validation can be performed by:
- `VerificationAgent`
- `FactualityEvalAgent`

This layered approach is one of the strongest design ideas in the project.

---

## Operational notes and limitations

### Important limitations

#### 1. This is not a real autonomous scientist
The system can assist with ideation and workflow automation, but it does not replace careful manual research judgment.

#### 2. Literature coverage is arXiv-centric
Search is driven primarily by arXiv. Important papers outside arXiv may be missed.

#### 3. Verification is heuristic
OpenAlex matching is fuzzy and title/author-based. False negatives and false positives are possible.

#### 4. Vector store is ephemeral
Embeddings are kept in memory only. Refreshing the app or restarting the server loses the indexed context.

#### 5. Report quality depends on model quality
Poor prompts, rate limits, or weak model outputs can degrade downstream stages.

#### 6. The experiment is synthetic
Even though it really runs, it is still a toy experiment relative to actual research evaluation.

#### 7. Frontend and backend are tightly coupled
The development experience is convenient, but scaling this into a multi-service architecture would likely require separation and persistent storage.

---

## Troubleshooting

### No papers found
Try:
- using a broader topic,
- reducing niche jargon,
- removing overly narrow constraints,
- checking internet connectivity.

### Papers retrieved but all fail verification
Possible causes:
- the topic is too obscure,
- title matching against OpenAlex is too strict for the returned entries,
- network requests to OpenAlex are failing.

### Gemini failures or quota exhaustion
Try:
- adding more Gemini keys,
- rotating keys through the supported env variable patterns,
- waiting for cooldowns to expire,
- resetting key state from the UI if available.

### DeepSeek fallback not working
Verify that:
- the DeepSeek keys are valid,
- the env variable names are correct,
- outbound network access is available.

### Experiment endpoint errors
Check whether:
- the server is running,
- the frontend and backend are served from the same process in dev mode,
- malformed hypothesis or plan payloads are reaching the backend.

### Build issues
Run:

```bash
npm run lint
npm run build
```

If TypeScript errors appear, fix the type issue before debugging runtime behavior.

---

## Development notes

### Single-process development model
In development, the Express server boots Vite in middleware mode. That means one Node process serves both the app shell and the API routes.

### Environment key injection strategy
The Vite config inspects environment variables and exposes aggregated Gemini/DeepSeek key lists to the frontend. This keeps the frontend code relatively simple while still allowing multiple key naming conventions.

### Type-driven workflow state
The app defines a fairly rich set of shared interfaces for:
- papers,
- chunks,
- hypotheses,
- contributions,
- experiment plans,
- dataset cards,
- critiques,
- reports,
- factuality evaluations,
- top-level app state.

This helps keep the workflow legible even though the pipeline is long.

### Why the app is interesting from an engineering perspective
The project demonstrates several patterns that are useful beyond this exact use case:

- agent chaining,
- retrieval grounding,
- retry/cooldown logic for model providers,
- structured JSON generation,
- lightweight semantic search without a database,
- backend execution as evidence generation,
- self-verification loops for long-form output.

---

## Future improvement ideas

If you want to evolve the project, these are high-value directions.

### Research quality improvements
- Add support for Semantic Scholar, Crossref, PubMed, or ACL Anthology.
- Retrieve full abstracts/full text where licensing permits.
- Replace fuzzy OpenAlex matching with a stronger bibliographic resolution strategy.
- Add citation graph reasoning or paper clustering.

### Experiment improvements
- Map hypotheses to experiment templates by task type.
- Allow real datasets and user-uploaded datasets.
- Persist metrics, seeds, and artifacts.
- Support more model families and benchmark suites.

### Product improvements
- Add saved sessions and exportable project histories.
- Add per-stage controls so users can rerun only failed steps.
- Add observability for token usage, provider latency, and failure rates.
- Add cost tracking across providers.

### Reliability improvements
- Persist the vector store.
- Add background job handling for long-running pipelines.
- Separate frontend and backend deployments.
- Add test coverage for agent prompt contracts and experiment API responses.

### UX improvements
- Show paper provenance more explicitly.
- Let users inspect retrieved chunks that informed the hypothesis/report.
- Provide side-by-side draft vs revised hypothesis/report comparisons.
- Add downloadable structured outputs such as JSON or BibTeX bundles.

---

## Closing summary

Literature Agent is a thoughtful prototype for grounded model-assisted research workflow generation. Its main strengths are not that it “solves research,” but that it combines:

- real retrieval,
- external verification,
- semantic memory,
- structured generation,
- actual backend experiment execution,
- critique and revision loops,
- and post-generation factuality checks.

If you want a project that showcases multi-agent orchestration, retrieval-augmented reasoning, and research-pipeline UX in a compact TypeScript codebase, this repository is a strong starting point.
