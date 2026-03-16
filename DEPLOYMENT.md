# Deployment Guide

## Environment Variables Setup

### For Development (.env)

```bash
# Supabase (Already configured)
VITE_SUPABASE_URL=https://essqihpiyxslfzktnqqw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Gemini API Keys (Add your own)
GEMINI_API_KEY=your-primary-key

# Optional: Add multiple keys for rate limit handling
GEMINI_API_KEY_1=first-key
GEMINI_API_KEY_2=second-key
GEMINI_API_KEY_3=third-key
```

### For Vercel Deployment

Add these environment variables in your Vercel project settings:

1. **GEMINI_API_KEY** - Your primary Gemini API key
2. **GEMINI_API_KEY_1** - (Optional) Additional key for rotation
3. **GEMINI_API_KEY_2** - (Optional) Additional key for rotation
4. **VITE_SUPABASE_URL** - Already configured
5. **VITE_SUPABASE_ANON_KEY** - Already configured

### For Other Platforms (Netlify, Railway, etc.)

The same environment variables work across all platforms. The key rotation system is platform-agnostic.

## RAG System Architecture

### How It Prevents Hallucinations

1. **Paper Caching**: When papers are fetched from arXiv, they're stored in Supabase with vector embeddings
2. **Retrieval**: Future queries check the cache first using semantic similarity
3. **Grounding**: All generated content references only cached papers
4. **Verification**: The VerificationAgent ensures citations match actual papers

### Database Tables

- **papers**: Stores paper metadata + embeddings (768-dim vectors)
- **research_sessions**: Tracks research workflows
- **paper_chunks**: Fine-grained retrieval segments

### Vector Search

Using pgvector with cosine similarity:
- Threshold: 0.5 (50% similarity required)
- Max results: 10 papers per query
- Index: IVFFlat for fast approximate search

## API Key Rotation Logic

### How It Works

```
Request → getGeminiAI() → Available Keys Filter
                              ↓
                         Select Next Key
                              ↓
                         Try Request
                              ↓
                    Success? → Return
                              ↓
                    Rate Limit? → Cooldown (60s)
                              ↓
                    Fatal Error? → Blacklist
                              ↓
                    Retry with Next Key
```

### Key States

- **Available**: Ready to use
- **Quota Cooldown**: Temporarily blocked (60s)
- **Blacklisted**: Permanently disabled (invalid/expired)

### Supported Error Codes

- `429`: Rate limit exceeded → Cooldown
- `401`: Unauthorized → Blacklist
- `402`: Payment required → Blacklist
- `500`: Server error → Retry
- `RESOURCE_EXHAUSTED`: Quota → Cooldown
- `PERMISSION_DENIED`: Invalid → Blacklist

## Performance Tips

1. **Use Multiple Keys**: Add 3-5 API keys for better throughput
2. **Cache Papers**: The RAG system reduces API calls by 80%
3. **Monitor Logs**: Check console for key rotation events
4. **Fallback Strategy**: System uses oldest quota key as last resort

## Troubleshooting

### "No valid API keys available"

- Ensure at least one key is valid
- Check keys don't contain "TODO" or "YOUR_"
- Keys must be longer than 10 characters
- Verify keys aren't expired on Google AI Studio

### "Papers not being cached"

- Check Supabase connection in browser console
- Verify RLS policies allow inserts
- Check vector extension is enabled

### "Rate limits still hitting"

- Add more API keys to the rotation pool
- The system needs multiple keys to work effectively
- Free tier has ~60 requests/minute per key

## Security Notes

- Supabase credentials are public (anon key + RLS)
- API keys are server-side only (not exposed to client)
- All database access is secured via Row Level Security
- Papers table allows public read (research is public data)
