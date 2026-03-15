import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
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
      const data = await response.text();
      res.set("Content-Type", "application/xml");
      res.send(data);
    } catch (error) {
      console.error("ArXiv Proxy Error:", error);
      res.status(500).json({ error: "Failed to fetch from arXiv" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
