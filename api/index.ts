import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

const app = express();
const PORT = 3000;

// API Proxy for arXiv to bypass CORS
app.get("/api/arxiv", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });

  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q as string)}&start=0&max_results=20&sortBy=relevance&sortOrder=descending`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ResearchAgent/1.0 (mailto:saviturius7@gmail.com)"
      }
    });
    
    if (!response.ok) {
      console.error(`ArXiv API responded with status: ${response.status}`);
      return res.status(response.status).json({ error: `ArXiv API error: ${response.status}` });
    }

    const data = await response.text();
    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    res.send(data);
  } catch (error) {
    console.error("ArXiv Proxy Error:", error);
    res.status(500).json({ error: "Failed to fetch from arXiv" });
  }
});

async function setupServer() {
  // Vite middleware for development ONLY
  // On Vercel, static files are served by the CDN, not this Express app.
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Development server running on http://localhost:${PORT}`);
    });
  }
}

setupServer();

export default app;
