import express from "express";
import path from "path";

const app = express();
const PORT = 3000;

// API Proxy for arXiv to bypass CORS
app.get("/api/arxiv", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });

  // Use 'all:' prefix if not already present to broaden search across all fields
  const query = (q as string).startsWith("all:") || (q as string).startsWith("ti:") || (q as string).startsWith("au:") 
    ? q 
    : `all:${q}`;

  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query as string)}&start=0&max_results=30&sortBy=relevance&sortOrder=descending`;
  
  console.log(`Proxying arXiv request: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ResearchAgent/1.0 (mailto:saviturius7@gmail.com)"
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error body");
      console.error(`ArXiv API responded with status: ${response.status}. Body: ${errorText}`);
      return res.status(response.status).json({ 
        error: `ArXiv API error: ${response.status}`,
        details: errorText.slice(0, 200)
      });
    }

    const data = await response.text();
    
    // Check if we got an empty feed or an error in the XML
    if (data.includes("<entry>") === false) {
      console.warn(`ArXiv returned no entries for query: ${query}`);
    }

    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    res.send(data);
  } catch (error) {
    console.error("ArXiv Proxy Error:", error);
    res.status(500).json({ 
      error: "Failed to fetch from arXiv",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

async function setupServer() {
  // Vite middleware for development ONLY
  // On Vercel, static files are served by the CDN, not this Express app.
  if (process.env.NODE_ENV !== "production") {
    try {
      // Dynamic import to avoid loading 'vite' in production
      const { createServer: createViteServer } = await import("vite");
      
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Development server running on http://localhost:${PORT}`);
      });
    } catch (e) {
      console.error("Failed to start Vite dev server:", e);
    }
  }
}

setupServer();

export default app;
