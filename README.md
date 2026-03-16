# Literature Agent - AI-Powered Research Assistant

A sophisticated multi-agent research system that fetches arXiv papers, generates novel hypotheses, runs simulated ML experiments, and produces peer-reviewed reports with RAG-based hallucination prevention.

## Features

- **RAG-Powered Research**: Vector database storage prevents hallucinations by grounding all claims in actual papers
- **Multi-Agent Workflow**: 12+ specialized agents work together for comprehensive research
- **Smart API Key Management**: Automatic rotation, rate limit handling, and failover across multiple Gemini API keys
- **Enhanced Visuals**: Beautiful animated UI with gradient effects, smooth transitions, and engaging interactions
- **Cross-Platform Ready**: Works on Vercel, Netlify, and other serverless platforms without API key restrictions

## Run Locally

**Prerequisites:** Node.js 18+

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API Keys:**

   Copy `.env.example` to `.env` and add your Gemini API keys:

   ```bash
   # Single key
   GEMINI_API_KEY=your-api-key

   # Or multiple keys for better rate limit handling
   GEMINI_API_KEY_1=first-key
   GEMINI_API_KEY_2=second-key
   ```

3. **Run the app:**
   ```bash
   npm run dev
   ```

## How It Works

### RAG System (Hallucination Prevention)

The system uses Supabase vector database to:
1. Cache fetched papers with embeddings
2. Retrieve similar cached papers for future queries
3. Ground all AI-generated content in actual research
4. Prevent hallucinated citations or fake papers

### API Key Management

The backend automatically:
- Rotates through multiple API keys
- Detects rate limits and quota exhaustion
- Blacklists permanently failed keys
- Implements cooldown periods for quota-limited keys
- Retries with different providers on failure

This ensures zero downtime even with free-tier API limits.

## Deploy to Vercel

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables (GEMINI_API_KEY, etc.)
4. Deploy

The app works seamlessly on Vercel with automatic API key rotation.

## Tech Stack

- **Frontend**: React 19, TypeScript, TailwindCSS 4, Motion
- **Backend**: Express, Gemini 3.1 Flash & Pro
- **Database**: Supabase (PostgreSQL + pgvector)
- **APIs**: arXiv, Google Gemini
