# Literature Agent

A multi-agent research system that fetches arXiv papers, generates hypotheses, runs simulated ML experiments, and produces peer-reviewed reports with RAG-based hallucination prevention.


This contains everything you need to run your app locally.

- **RAG-Based Research**: Vector database storage reduces hallucinations by grounding claims in retrieved papers.
- **Multi-Agent Workflow**: 12+ specialized agents coordinate to produce a full research pipeline.
- **Robust API Key Management**: Automatic rotation, rate-limit handling, and failover across multiple keys.
- **Enhanced Visuals**: Animated UI with gradient effects, smooth transitions, and interactive components.
- **Cross-Platform Ready**: Works on Vercel, Netlify, and other serverless platforms.


## Run Locally

**Prerequisites:**  Node.js


2. **Configure environment variables:**

   Copy `.env.example` to `.env` and fill in the required values:

   ```bash
   cp .env.example .env
   ```

3. **Run the app:**
   ```bash
   npm run dev
   ```

## How It Works

### RAG System (Hallucination Prevention)

The system uses Supabase vector storage to:
1. Cache fetched papers with embeddings.
2. Retrieve similar cached papers for future queries.
3. Ground generated content in actual research.
4. Reduce fabricated citations or fake papers.

### API Key Management

The backend automatically:
- Rotates through multiple API keys.
- Detects rate limits and quota exhaustion.
- Blacklists permanently failed keys.
- Implements cooldown periods for quota-limited keys.
- Retries with alternate keys on failure.

This helps maintain reliability under free-tier limits.

## Deploy to Vercel

1. Push code to GitHub.
2. Import project in Vercel.
3. Add required environment variables from `.env.example`.
4. Deploy.

## Tech Stack

- **Frontend**: React 19, TypeScript, TailwindCSS 4, Motion.
- **Backend**: Express.
- **Database**: Supabase (PostgreSQL + pgvector).
- **Data Source**: arXiv.
1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
