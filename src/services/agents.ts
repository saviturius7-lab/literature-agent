import { XMLParser } from "fast-xml-parser";
import { 
  Paper, 
  Chunk,
  Hypothesis, 
  ExperimentResult, 
  ResearchReport, 
  Contribution, 
  MathFormalization, 
  ExperimentPlan, 
  DatasetCard, 
  ReviewerCritique,
  AblationStudy,
  FailureCase,
  GapIdentification,
  FactualityResult
} from "../types";
import { generateJSON, embedText, embedTexts } from "./gemini";
import { vectorStore } from "./vectorStore";

const parser = new XMLParser();

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] * b[i]);
    mA += (a[i] * a[i]);
    mB += (b[i] * b[i]);
  }
  mA = Math.sqrt(mA);
  mB = Math.sqrt(mB);
  return dotProduct / (mA * mB);
}

export const TopicRefinementAgent = {
  async refine(topic: string): Promise<string> {
    const prompt = `Refine the following research topic into a specific, high-impact research question suitable for a scientific paper.
    Avoid overly broad topics. Focus on a specific niche in AI/ML.
    
    Initial Topic: "${topic}"
    
    Return a JSON object:
    {
      "refinedTopic": "Specific research question or title"
    }`;
    
    const result = await generateJSON<{ refinedTopic: string }>(prompt, "You are a senior research scientist who specializes in defining high-impact research directions.");
    return result.refinedTopic || topic;
  }
};

export const SearchQueryAgent = {
  async refineQuery(topic: string): Promise<string> {
    const prompt = `You are a research query optimization expert. Given a research topic, your goal is to generate an optimized search query for the arXiv API.
    
    Topic: "${topic}"
    
    First, imagine a hypothetical ideal abstract for a paper that would perfectly address this topic.
    Then, based on that hypothetical abstract and the topic itself, generate a concise, highly effective search query.
    
    The query should use arXiv search syntax if helpful (e.g., ti:title, au:author, abs:abstract, all:all fields).
    Focus on specific technical terms and keywords.
    
    Return your response in this JSON format:
    {
      "hypotheticalAbstract": "...",
      "refinedQuery": "..."
    }`;

    try {
      const result = await generateJSON<{ hypotheticalAbstract: string; refinedQuery: string }>(prompt, "You are a research query optimization expert.");
      console.log(`[SearchQueryAgent] Hypothetical Abstract: ${result.hypotheticalAbstract.slice(0, 100)}...`);
      return result.refinedQuery;
    } catch (error) {
      console.error("[SearchQueryAgent] Failed to refine query, using original topic:", error);
      return topic;
    }
  },

  async getBroadKeywords(topic: string): Promise<string[]> {
    const prompt = `Generate 5 broad, distinct technical keywords or short phrases related to this research topic that could be used to find relevant papers on arXiv.
    
    Topic: "${topic}"
    
    Return your response in this JSON format:
    {
      "keywords": ["keyword1", "keyword2", ...]
    }`;

    try {
      const result = await generateJSON<{ keywords: string[] }>(prompt, "You are an expert at identifying core research concepts.");
      return result.keywords || [topic];
    } catch (error) {
      console.error("[SearchQueryAgent] Failed to get broad keywords:", error);
      return [topic];
    }
  }
};

async function fetchWithRetry(url: string, retries = 3, backoff = 1500): Promise<Response> {
  const timeout = 10000; // 10s timeout for ArXiv
  
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (response.status === 429 && i < retries - 1) {
        const waitTime = backoff * Math.pow(2, i) + (Math.random() * 500);
        console.warn(`ArXiv API rate limited (429). Retrying in ${Math.round(waitTime)}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      if (response.status >= 500 && i < retries - 1) {
        const waitTime = backoff * Math.pow(1.5, i);
        console.warn(`ArXiv API server error (${response.status}). Retrying in ${Math.round(waitTime)}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      return response;
    } catch (error: any) {
      clearTimeout(id);
      if (error.name === 'AbortError') {
        console.warn(`ArXiv API request timed out (${timeout}ms). Retrying... (Attempt ${i + 1}/${retries})`);
      } else {
        console.warn(`ArXiv API request failed: ${error.message}. Retrying... (Attempt ${i + 1}/${retries})`);
      }
      
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
  return fetch(url); // Final attempt
}

export const LiteratureAgent = {
  async fetchPapers(topic: string, onProgress?: (msg: string) => void): Promise<Paper[]> {
    const allPapers: Paper[] = [];
    const seenTitles = new Set<string>();

    const addPapers = (papers: Paper[]) => {
      for (const p of papers) {
        const normalizedTitle = p.title.toLowerCase().trim();
        if (!seenTitles.has(normalizedTitle)) {
          allPapers.push(p);
          seenTitles.add(normalizedTitle);
        }
      }
    };

    try {
      // 1. Start Refined Query Generation, Broad Keywords, and Initial Topic Search ALL in parallel
      onProgress?.("Initializing multi-strategy literature search...");
      
      const [refinedQuery, initialTopicPapers, broadKeywords] = await Promise.all([
        SearchQueryAgent.refineQuery(topic),
        this.executeSearch(topic).catch(e => {
          console.error("Initial search failed:", e);
          return [];
        }),
        SearchQueryAgent.getBroadKeywords(topic).catch(e => {
          console.error("Broad keywords generation failed:", e);
          return [];
        })
      ]);

      addPapers(initialTopicPapers);
      console.log(`Search Strategy (Original Topic): Found ${initialTopicPapers.length} papers`);
      onProgress?.(`Initial search found ${initialTopicPapers.length} papers. Refining...`);

      // 2. Execute Refined Search and Keyword Searches in parallel
      console.log(`Search Strategy (Refined): "${refinedQuery}"`);
      onProgress?.(`Searching ArXiv with refined query and ${broadKeywords.length} keywords...`);
      
      const refinedSearchPromise = this.executeSearch(refinedQuery).catch(e => {
        console.error("Refined search failed:", e);
        return [];
      });
      
      const keywordSearchPromises = broadKeywords.map(keyword => 
        this.executeSearch(keyword).catch(e => {
          console.error(`Keyword search failed for "${keyword}":`, e);
          return [];
        })
      );
      
      const [refinedPapers, ...keywordResults] = await Promise.all([
        refinedSearchPromise,
        ...keywordSearchPromises
      ]);
      
      addPapers(refinedPapers);
      keywordResults.forEach(results => addPapers(results));
      
      console.log(`Multi-strategy search complete. Found ${allPapers.length} unique papers.`);

      // 3. General AI/ML fallback if still desperate
      if (allPapers.length < 5) {
        onProgress?.("Applying general AI/ML fallback search...");
        const fallbackQueries = ["machine learning", "artificial intelligence", "deep learning"];
        const fallbackResults = await Promise.all(fallbackQueries.map(q => this.executeSearch(q).catch(e => [])));
        fallbackResults.forEach(results => addPapers(results));
      }

      onProgress?.(`Found ${allPapers.length} unique papers. Starting relevance filtering...`);
      return allPapers;
    } catch (error) {
      console.error("[LiteratureAgent] Error in fetchPapers:", error);
      onProgress?.("Error during paper retrieval. Proceeding with available results.");
      return allPapers;
    }
  },

  async executeSearch(query: string): Promise<Paper[]> {
    const url = `/api/arxiv?q=${encodeURIComponent(query)}`;
    
    try {
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        console.warn(`ArXiv search failed for query "${query}": ${response.status}`);
        return [];
      }
      const xmlData = await response.text();
      const jsonObj = parser.parse(xmlData);
      
      if (!jsonObj || !jsonObj.feed || !jsonObj.feed.entry) {
        return [];
      }
      
      return this.processEntries(jsonObj.feed.entry);
    } catch (error) {
      console.error(`Error executing search for "${query}":`, error);
      return [];
    }
  },

  processEntries(entries: any): Paper[] {
    const entryList = Array.isArray(entries) ? entries : [entries];
    
    return entryList.slice(0, 15).map((entry: any) => {
      const authors = Array.isArray(entry.author) 
        ? entry.author.map((a: any) => a.name) 
        : (entry.author ? [entry.author.name] : ["Unknown Author"]);
      const year = entry.published ? new Date(entry.published).getFullYear() : "n.d.";
      const title = (entry.title || "Untitled").replace(/\n/g, " ").trim();
      const summary = (entry.summary || "No summary available").replace(/\n/g, " ").trim();
      
      return {
        title,
        summary,
        authors,
        published: entry.published || new Date().toISOString(),
        link: entry.id || "#",
        citation: `${authors.join(", ")} (${year}). ${title}. arXiv:${(entry.id || "").split('/').pop()}`,
        chunks: ChunkingAgent.chunkPaper(title, summary),
        keyFindings: []
      };
    });
  }
};

export const UnifiedPaperAnalyzerAgent = {
  async verifyWithOpenAlex(title: string, authors: string[] = []): Promise<boolean> {
    const timeout = 10000; // 10s timeout for OpenAlex
    
    try {
      // Clean title for search: remove punctuation, lowercase, and take first 100 chars
      const cleanTitle = title.replace(/[^\w\s]/gi, '').toLowerCase().trim();
      
      // Strategy 1: Title Search
      const titleUrl = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(cleanTitle.slice(0, 100))}&mailto=saviturius7@gmail.com`;
      
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(titleUrl, { signal: controller.signal });
        clearTimeout(id);
        
        if (!response.ok) return false;
        
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
          // Check top 3 results for a match
          for (const result of data.results.slice(0, 3)) {
            const resultTitle = result.display_name.toLowerCase().replace(/[^\w\s]/gi, '').trim();
            
            // Fuzzy match: check if one contains the other or high overlap
            if (resultTitle.includes(cleanTitle) || cleanTitle.includes(resultTitle)) {
              return true;
            }
            
            // Substring match for long titles
            if (cleanTitle.length > 30 && resultTitle.length > 30) {
              const startOfSearch = cleanTitle.slice(0, 30);
              const startOfResult = resultTitle.slice(0, 30);
              if (startOfResult.includes(startOfSearch) || startOfSearch.includes(startOfResult)) {
                return true;
              }
            }
          }
        }
      } catch (e) {
        clearTimeout(id);
        console.warn("OpenAlex title search error or timeout:", e);
      }
      
      // Strategy 2: Author + Year (if title search failed)
      if (authors.length > 0) {
        const firstAuthor = authors[0].split(' ').pop() || "";
        if (firstAuthor) {
          const authorUrl = `https://api.openalex.org/works?filter=author.search:${encodeURIComponent(firstAuthor)}&mailto=saviturius7@gmail.com`;
          
          const authController = new AbortController();
          const authId = setTimeout(() => authController.abort(), timeout);
          
          try {
            const authResponse = await fetch(authorUrl, { signal: authController.signal });
            authId && clearTimeout(authId);
            
            if (authResponse.ok) {
              const authData = await authResponse.json();
              for (const result of authData.results || []) {
                const resultTitle = result.display_name.toLowerCase().replace(/[^\w\s]/gi, '').trim();
                if (resultTitle.includes(cleanTitle.slice(0, 20)) || cleanTitle.includes(resultTitle.slice(0, 20))) {
                  return true;
                }
              }
            }
          } catch (e) {
            authId && clearTimeout(authId);
            console.warn("OpenAlex author search error or timeout:", e);
          }
        }
      }

      return false;
    } catch (e) {
      console.error("OpenAlex verification error:", e);
      return false;
    }
  },

  async analyzeBatch(topic: string, papers: Paper[]): Promise<{ index: number; isRelevant: boolean; isConsistent: boolean; keyFindings: string[] }[]> {
    if (papers.length === 0) return [];
    
    const prompt = `Analyze the following research papers for relevance to the topic: "${topic}".
    For each paper, determine:
    1. Relevance: Is it directly relevant or highly related?
    2. Consistency: Does the summary make sense and seem like a real paper (not a hallucination)?
    3. Key Findings: Extract 2-3 concise, technically accurate findings.
    
    Papers:
    ${papers.map((p, i) => `[Paper ${i}] Title: ${p.title}\nSummary: ${p.summary.slice(0, 500)}...`).join("\n\n")}
    
    Return a JSON object with the analysis for each paper index:
    {
      "results": [
        { 
          "index": 0, 
          "isRelevant": boolean, 
          "isConsistent": boolean, 
          "keyFindings": ["Finding 1", "Finding 2"] 
        },
        ...
      ]
    }`;

    try {
      const result = await generateJSON<{ results: { index: number; isRelevant: boolean; isConsistent: boolean; keyFindings: string[] }[] }>(prompt, "You are a meticulous academic auditor and expert researcher.");
      return result.results || [];
    } catch (e) {
      console.error(`Batch analysis failed:`, e);
      // Return default values on failure
      return papers.map((_, i) => ({ index: i, isRelevant: true, isConsistent: true, keyFindings: [] }));
    }
  },

  async analyze(topic: string, papers: Paper[], onProgress?: (msg: string) => void): Promise<Paper[]> {
    if (papers.length === 0) return [];

    onProgress?.(`Analyzing ${papers.length} papers for relevance, consistency, and findings...`);
    
    const batchSize = 8;
    const analyzedPapers: Paper[] = [];
    
    // Process in parallel batches for speed
    const batchPromises = [];
    for (let i = 0; i < papers.length; i += batchSize) {
      const batch = papers.slice(i, i + batchSize);
      batchPromises.push(this.analyzeBatch(topic, batch).then(results => ({ offset: i, results, batch })));
    }

    const allBatchResults = await Promise.all(batchPromises);
    
    for (const { offset, results, batch } of allBatchResults) {
      // OpenAlex verification is still per-paper, but we can parallelize it for the batch
      const openAlexPromises = batch.map(p => this.verifyWithOpenAlex(p.title, p.authors));
      const openAlexResults = await Promise.all(openAlexPromises);

      results.forEach((res, idx) => {
        const paper = batch[idx];
        if (paper && res.isRelevant && res.isConsistent && openAlexResults[idx]) {
          paper.keyFindings = res.keyFindings;
          paper.verified = true;
          analyzedPapers.push(paper);
        }
      });
    }

    onProgress?.(`Analysis complete. ${analyzedPapers.length} high-quality papers retained.`);
    return analyzedPapers;
  }
};

export const ChunkingAgent = {
  chunkPaper(title: string, text: string): Chunk[] {
    const safeText = text || "No summary available.";
    // Recursive character splitting logic
    // We split by logical markers: Paragraphs, then Sentences
    const separators = ["\n\n", "\n", ". ", "! ", "? "];
    const targetSize = 500; // characters
    const overlapSize = 100; // characters
    
    let chunks: string[] = [];
    
    const splitRecursively = (input: string, sepIdx: number): string[] => {
      if (!input) return [];
      if (input.length <= targetSize) return [input];
      if (sepIdx >= separators.length) {
        // Fallback to character-based split if no separators left
        let result = [];
        for (let i = 0; i < input.length; i += targetSize - overlapSize) {
          result.push(input.slice(i, i + targetSize));
        }
        return result;
      }
      
      const sep = separators[sepIdx];
      const parts = input.split(sep);
      let currentChunks: string[] = [];
      let currentBuffer = "";
      
      for (const part of parts) {
        const partWithSep = currentBuffer ? sep + part : part;
        if ((currentBuffer + partWithSep).length <= targetSize) {
          currentBuffer += partWithSep;
        } else {
          if (currentBuffer) currentChunks.push(currentBuffer);
          // If a single part is too big, split it further with the next separator
          if (part.length > targetSize) {
            currentChunks.push(...splitRecursively(part, sepIdx + 1));
            currentBuffer = "";
          } else {
            currentBuffer = part;
          }
        }
      }
      if (currentBuffer) currentChunks.push(currentBuffer);
      return currentChunks;
    };

    const rawChunks = splitRecursively(safeText, 0);
    
    // Add metadata and logical sectioning
    return rawChunks.map((chunkText, i) => {
      // Heuristic for sectioning: first chunk is usually Abstract/Introduction
      let section = "Summary";
      if (i === 0) section = "Abstract/Introduction";
      else if (i === rawChunks.length - 1) section = "Conclusion/Summary";
      else section = `Body Section ${i}`;

      return {
        text: chunkText,
        section,
        source: title,
        metadata: {
          index: i,
          total: rawChunks.length,
          overlap: i > 0 // Simplified overlap flag
        }
      };
    });
  }
};

export const GapIdentificationAgent = {
  async identify(papers: Paper[], topic: string): Promise<GapIdentification> {
    const papersContext = papers.map((p, i) => {
      const chunksInfo = p.chunks 
        ? p.chunks.map(c => `[Section: ${c.section}] ${c.text}`).join("\n")
        : p.summary;
      return `[${i+1}] ${p.title}:\n${chunksInfo}`;
    }).join("\n\n");

    const prompt = `Analyze the following research papers on "${topic}" and identify 3 critical research gaps.
    For each gap, provide specific evidence from the papers (refer to them as [1], [2], etc. and specify the section if available) and explain the potential impact of addressing it.
    
    Papers:
    ${papersContext}
    
    Return a JSON object:
    {
      "gaps": [
        { "description": "...", "evidence": "...", "potentialImpact": "..." },
        ...
      ],
      "summary": "Overall summary of the research landscape gaps"
    }`;
    
    return generateJSON<GapIdentification>(prompt, "You are an expert at identifying missing links and future directions in scientific literature.");
  }
};

export const SelectionAgent = {
  async selectPapers(topic: string, papers: Paper[]): Promise<Paper[]> {
    const prompt = `From the following list of research papers about "${topic}", select the 8 most foundational, seminal, or high-impact papers. 
    Prioritize papers that provide a strong theoretical or empirical basis for further research on "${topic}".
    Avoid papers that are only tangentially related.
    
    Papers:
    ${papers.map((p, i) => `ID: ${i} | Title: ${p.title} | Authors: ${p.authors.join(", ")} | Summary: ${p.summary.slice(0, 300)}...`).join("\n\n")}
    
    Return a JSON object with the indices of the selected papers:
    {
      "selectedIndices": [number, number, ...]
    }`;
    
    const result = await generateJSON<{ selectedIndices: number[] }>(prompt, "You are an expert research strategist and bibliometrician.");
    const selectedIndices = result.selectedIndices || [];
    const uniqueIndices = Array.from(new Set(selectedIndices));
    return uniqueIndices.map(idx => papers[idx]).filter(p => !!p);
  }
};

export const HypothesisAgent = {
  async generateHypothesis(topic: string, papers: Paper[], feedback?: string): Promise<Hypothesis> {
    // RAG: Retrieve relevant chunks from vector store
    const relevantChunks = await vectorStore.search(topic, 10);
    const ragContext = relevantChunks.map(c => `[Source: ${c.metadata.source}] ${c.text}`).join("\n\n");

    const papersContext = papers.map((p, i) => {
      const chunksInfo = p.chunks 
        ? p.chunks.map(c => `[Section: ${c.section}] ${c.text}`).join("\n")
        : p.summary;
      return `Paper [${i+1}]: ${p.title}\n${chunksInfo}`;
    }).join("\n\n");

    // Unified Step: Generate and Self-Verify in one go
    const prompt = `Based STRICTLY on the following research papers and retrieved context about "${topic}", propose a novel research hypothesis.
    
    Retrieved Context (RAG):
    ${ragContext}

    Papers:
    ${papersContext}
    
    ${feedback ? `PREVIOUS ATTEMPT FEEDBACK: ${feedback}\nPlease adjust your hypothesis to be more novel and distinct from existing work.` : ""}
    
    CRITICAL: After generating the hypothesis, perform a self-critique. Identify any potential hallucinations or unsupported claims. 
    Then, provide the FINAL refined hypothesis that is 100% grounded in the literature.
    
    Return a JSON object:
    {
      "initialHypothesis": {
        "title": "...",
        "description": "...",
        "rationale": "...",
        "expectedOutcome": "..."
      },
      "selfCritique": "...",
      "finalHypothesis": {
        "title": "...",
        "description": "...",
        "rationale": "...",
        "expectedOutcome": "..."
      }
    }`;
    
    const result = await generateJSON<{ initialHypothesis: Hypothesis; selfCritique: string; finalHypothesis: Hypothesis }>(prompt, "You are a world-class research scientist who values empirical grounding and rigorous self-correction.");
    console.log(`[HypothesisAgent] Self-Critique: ${result.selfCritique}`);
    return result.finalHypothesis;
  }
};

export const NoveltyCheckerAgent = {
  async checkNovelty(hypothesis: Hypothesis, papers: Paper[], attempt: number = 0): Promise<{ isNovel: boolean; similarity: number; mostSimilarPaper?: string; feedback?: string }> {
    const [hypothesisEmbedding, ...paperEmbeddings] = await embedTexts([
      `${hypothesis.title} ${hypothesis.description}`,
      ...papers.map(p => `${p.title} ${p.summary}`)
    ]);
    
    let maxSimilarity = -1;
    let mostSimilarPaper = "";

    paperEmbeddings.forEach((paperEmbedding, idx) => {
      const similarity = cosineSimilarity(hypothesisEmbedding, paperEmbedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mostSimilarPaper = papers[idx].title;
      }
    });

    // Adaptive threshold: starts at 0.85, increases by 0.02 per attempt up to 0.93
    const threshold = Math.min(0.93, 0.85 + (attempt * 0.02));
    const isNovel = maxSimilarity < threshold;
    
    let feedback = "";
    if (!isNovel) {
      feedback = `The hypothesis is too similar to the existing paper: "${mostSimilarPaper}" (Similarity score: ${maxSimilarity.toFixed(2)}, Threshold: ${threshold.toFixed(2)}). Try to find a different angle or a gap that this paper doesn't address.`;
    }

    return {
      isNovel,
      similarity: maxSimilarity,
      mostSimilarPaper,
      feedback
    };
  }
};

export const ContributionAgent = {
  async extractContributions(hypothesis: Hypothesis): Promise<Contribution[]> {
    const prompt = `Given the hypothesis: "${hypothesis.title}" and the existing literature, identify the specific research contributions this work would make.
    
    Hypothesis: ${hypothesis.description}
    
    You MUST generate at least 2 concrete contributions.
    Examples: New architecture, New dataset, New evaluation metric, Empirical findings.
    
    Return a JSON object:
    {
      "contributions": [
        { "type": "Architecture", "description": "..." },
        { "type": "Dataset", "description": "..." }
      ]
    }`;
    
    const result = await generateJSON<{ contributions: Contribution[] }>(prompt, "You are a senior research lead at a top AI lab.");
    const contributions = Array.isArray(result.contributions) ? result.contributions : [];
    if (contributions.length < 2) {
      throw new Error("Failed to generate at least 2 concrete contributions.");
    }
    return contributions;
  }
};

export const MathFormalizerAgent = {
  async formalize(hypothesis: Hypothesis): Promise<MathFormalization> {
    const prompt = `Provide a rigorous mathematical formalization for the following research hypothesis:
    "${hypothesis.title}"
    
    Description: ${hypothesis.description}
    
    Return a JSON object with:
    {
      "problemFormulation": "Formal definition of the problem space",
      "notation": [
        { "symbol": "x", "definition": "Input vector" },
        { "symbol": "y", "definition": "Target label" }
      ],
      "objectiveFunction": "L = sum(y - f(x))^2",
      "algorithmSteps": ["Step 1: ...", "Step 2: ..."]
    }`;
    
    const result = await generateJSON<MathFormalization>(prompt, "You are a world-class theoretical computer scientist and mathematician.");
    return {
      ...result,
      notation: Array.isArray(result.notation) ? result.notation : [],
      algorithmSteps: Array.isArray(result.algorithmSteps) ? result.algorithmSteps : []
    };
  }
};

export const ExperimentDesignAgent = {
  async design(hypothesis: Hypothesis, contributions: Contribution[]): Promise<ExperimentPlan> {
    const prompt = `Design a rigorous experiment to test the following hypothesis:
    "${hypothesis.title}"
    
    Contributions: ${contributions.map(c => c.description).join(", ")}
    
    You MUST include:
    1. A specific dataset.
    2. At least 2 baseline models for comparison.
    3. Specific evaluation metrics.
    4. A detailed evaluation protocol.
    
    Return a JSON object:
    {
      "protocol": "Step-by-step protocol",
      "datasets": ["Dataset 1", "Dataset 2"],
      "baselines": ["Baseline 1", "Baseline 2"],
      "metrics": ["Metric 1", "Metric 2"]
    }`;
    
    const result = await generateJSON<ExperimentPlan>(prompt, "You are an expert in experimental design and ML evaluation.");
    return {
      ...result,
      datasets: Array.isArray(result.datasets) ? result.datasets : [],
      baselines: Array.isArray(result.baselines) ? result.baselines : [],
      metrics: Array.isArray(result.metrics) ? result.metrics : []
    };
  }
};

export const DatasetGeneratorAgent = {
  async generate(plan: ExperimentPlan): Promise<DatasetCard> {
    const prompt = `Generate a detailed Dataset Card for the primary dataset proposed in the experiment plan:
    "${plan.datasets[0]}"
    
    Return a JSON object:
    {
      "name": "Dataset Name",
      "description": "Detailed description",
      "features": ["feature1", "feature2"],
      "size": "100k samples",
      "source": "Synthetic/Public Repository"
    }`;
    
    const result = await generateJSON<DatasetCard>(prompt, "You are a data engineer specializing in high-quality ML datasets.");
    return {
      ...result,
      features: result.features || []
    };
  }
};

export const ExperimentRunner = {
  async runExperiment(hypothesis: Hypothesis, plan: ExperimentPlan): Promise<ExperimentResult> {
    try {
      const response = await fetch("/api/run-experiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesis, plan })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        let stageInfo = "";
        if (data.stage) {
          const stages: Record<string, string> = {
            "validation": "Input Validation",
            "data_preparation": "Data Preparation",
            "model_training_rf": "Proposed Model Training (Random Forest)",
            "model_training_lr": "Baseline Model Training (Logistic Regression)",
            "unknown": "General Execution"
          };
          stageInfo = ` [Stage: ${stages[data.stage] || data.stage}]`;
        }
        throw new Error(`Experiment failed during ${stageInfo}: ${data.error || response.statusText}`);
      }
      
      return data;
    } catch (error: any) {
      console.error("ExperimentRunner error:", error);
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error("Network error: Could not connect to the experiment server. Please check your connection.");
      }
      throw error;
    }
  }
};

export const ResultValidationAgent = {
  async validate(hypothesis: Hypothesis, result: ExperimentResult): Promise<{ isValid: boolean; feedback: string }> {
    const prompt = `Validate the experimental results against the original hypothesis.
    
    Hypothesis: ${hypothesis.description}
    Results: Accuracy ${result.accuracy.toFixed(2)}, F1 ${result.f1Score.toFixed(2)}
    Baselines: ${(Array.isArray(result.baselines) ? result.baselines : []).map(b => `${b.name}: ${b.accuracy.toFixed(2)}`).join(", ")}
    
    Does the data support the hypothesis? Is the improvement over baselines significant?
    
    Return a JSON object:
    {
      "isValid": boolean,
      "feedback": "Detailed validation feedback"
    }`;
    
    return generateJSON<{ isValid: boolean; feedback: string }>(prompt, "You are a skeptical statistician and experimentalist.");
  }
};

export const ReviewerSimulatorAgent = {
  async simulate(hypothesis: Hypothesis, result: ExperimentResult): Promise<ReviewerCritique[]> {
    const prompt = `Simulate 3 peer reviews for the following research:
    
    Hypothesis: ${hypothesis.title}
    Results: Accuracy ${result.accuracy.toFixed(2)}, F1 ${result.f1Score.toFixed(2)}
    
    Each reviewer should provide:
    1. Weaknesses
    2. Novelty critique
    3. A rating (1-10)
    
    Return a JSON object:
    {
      "critiques": [
        {
          "reviewerId": 1,
          "weaknesses": ["..."],
          "noveltyCritique": "...",
          "rating": 7
        },
        ...
      ]
    }`;
    
    const resultJson = await generateJSON<{ critiques: ReviewerCritique[] }>(prompt, "You are a panel of elite peer reviewers for ICML/NeurIPS.");
    const critiques = Array.isArray(resultJson.critiques) ? resultJson.critiques : [];
    return critiques.map(c => ({
      ...c,
      weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses : []
    }));
  }
};

export const RevisionAgent = {
  async revise(hypothesis: Hypothesis, result: ExperimentResult, critiques: ReviewerCritique[]): Promise<{ revisedHypothesis: Hypothesis; revisedResult: ExperimentResult }> {
    const prompt = `Revise the research based on the following reviewer critiques:
    
    Critiques: ${JSON.stringify(critiques)}
    
    Address the weaknesses and clarity issues. 
    Return a JSON object with the revised hypothesis and refined results (minor adjustments to reflect addressed concerns).
    
    {
      "revisedHypothesis": { ... },
      "revisedResult": { ... }
    }`;
    
    return generateJSON<{ revisedHypothesis: Hypothesis; revisedResult: ExperimentResult }>(prompt, "You are a meticulous lead researcher refining a paper for final submission.");
  }
};

export const ReportAgent = {
  async generateReport(
    topic: string, 
    papers: Paper[], 
    hypothesis: Hypothesis, 
    contributions: Contribution[],
    math: MathFormalization,
    experimentPlan: ExperimentPlan,
    datasetCard: DatasetCard,
    result: ExperimentResult,
    critiques: ReviewerCritique[]
  ): Promise<ResearchReport> {
    // RAG: Retrieve relevant chunks for the report
    const relevantChunks = await vectorStore.search(`${topic} ${hypothesis.description}`, 15);
    const ragContext = relevantChunks.map(c => `[Source: ${c.metadata.source}] ${c.text}`).join("\n\n");

    const papersContext = papers.map((p, i) => {
      const chunksInfo = p.chunks 
        ? p.chunks.map(c => `[Section: ${c.section}] ${c.text}`).join("\n")
        : p.summary;
      return `[${i+1}] ${p.title}:\n${chunksInfo}`;
    }).join("\n\n");

    // Step 1: Generate initial response
    const initialPrompt = `Write an extensive, professional research report in the style of an arXiv preprint.
    
    CRITICAL INSTRUCTIONS:
    1. ONLY use the provided papers and their specific sections for citations. Do NOT invent any papers or citations.
    2. Every in-text citation like [1], [2] MUST correspond to the paper list provided below.
    3. Ensure the methodology and discussion are deeply grounded in the provided literature, referencing specific sections where appropriate.
    4. If a claim is made, it should ideally be supported by one of the provided papers or the retrieved context.
    
    Topic: ${topic}
    Hypothesis: ${hypothesis.title}
    
    Retrieved Context (RAG):
    ${ragContext}

    Provided Literature (Grounded Context):
    ${papersContext}
    
    Contributions: ${contributions.map(c => c.description).join(", ")}
    Mathematical Formalization: ${math.problemFormulation}
    Algorithm: ${math.algorithmSteps.join(" -> ")}
    Experiment Plan: ${experimentPlan.protocol}
    Dataset: ${datasetCard.name} - ${datasetCard.description}
    Dataset Features: ${datasetCard.features.join(", ")}
    Dataset Size: ${datasetCard.size}
    Dataset Source: ${datasetCard.source}
    Results: Accuracy ${result.accuracy.toFixed(2)}, F1 ${result.f1Score.toFixed(2)}
    Baselines: ${(Array.isArray(result.baselines) ? result.baselines : []).map(b => `${b.name} (${b.accuracy.toFixed(2)})`).join(", ")}
    Ablations: ${(Array.isArray(result.ablationStudies) ? result.ablationStudies : []).map(a => `${a.componentRemoved} (-${a.impactOnMetric.toFixed(2)})`).join(", ")}
    Failure Cases: ${(Array.isArray(result.failureCases) ? result.failureCases : []).map(f => f.example).join("; ")}
    Implementation Details: ${result.implementationDetails}
    Experiment Logs (Evidence):
    ${(Array.isArray(result.logs) ? result.logs : []).join("\n")}
    Reviewer Feedback: ${critiques.map(c => c.weaknesses.join(", ")).join("; ")}
    
    You MUST include:
    1. A clear "Contributions" section in the Introduction.
    2. A "Mathematical Formalization" section with notation and algorithms.
    3. A "Dataset Description" section with full details (name, description, features, size, source).
    4. A "Baseline Comparison" table/section with at least 2 baselines.
    5. An "Ablation Study" section.
    6. A "Failure Case Analysis" section with concrete examples.
    7. An "Implementation Details" section for reproducibility.
    8. An "Experimental Evidence" section that includes the execution logs as proof of the experiments being conducted.
    
    Requirements:
    - Professional academic language.
    - Heavy in-text citations [1], [2], etc.
    - Comprehensive sections (2000+ words).
    
    Return a JSON object:
    {
      "abstract": "...",
      "introduction": "...",
      "methodology": "...",
      "results": "...",
      "discussion": "...",
      "conclusion": "...",
      "references": ["Full list in APA style"]
    }
    
    Allowed Citations (ONLY USE THESE):
    ${papers.map((p, i) => `[${i+1}] ${p.citation}`).join("\n")}
    `;
    
    const initialReport = await generateJSON<ResearchReport>(initialPrompt, "You are a world-class scientific researcher who adheres to the highest standards of academic integrity and grounding.");

    // Step 2: Generate validation questions
    const verificationQuestionsPrompt = `Based on the following research report and the provided literature, generate 5-8 specific verification questions to check for hallucinations, mis-citations, or unsupported claims.
    
    Report Abstract: ${initialReport.abstract.slice(0, 500)}...
    Report Methodology: ${initialReport.methodology.slice(0, 500)}...
    
    Questions should be like: "Does Paper [X] actually support the claim about Y in the methodology?" or "Is the citation [Z] correctly used for the concept of W?"
    
    Return a JSON object:
    {
      "questions": ["Question 1", "Question 2", ...]
    }`;
    
    const { questions } = await generateJSON<{ questions: string[] }>(verificationQuestionsPrompt, "You are a skeptical academic auditor.");

    // Step 3: Answer validation questions independently
    const verificationAnswersPrompt = `Answer the following verification questions using ONLY the provided research papers context. Be extremely objective and factual.
    
    Questions:
    ${questions.map((q, i) => `${i+1}. ${q}`).join("\n")}
    
    Context:
    ${papersContext}
    
    Return a JSON object:
    {
      "answers": [
        { "question": "...", "answer": "...", "isSupported": boolean },
        ...
      ]
    }`;
    
    const { answers } = await generateJSON<{ answers: { question: string; answer: string; isSupported: boolean }[] }>(verificationAnswersPrompt, "You are a meticulous fact-checker.");

    // Step 4: Produce final corrected response
    const finalRefinementPrompt = `Refine the initial research report based on the verification results. 
    If any part of the initial report was found to be unsupported or hallucinated, correct it or remove it.
    Ensure the final report is 100% grounded in the provided literature.
    
    Initial Report: ${JSON.stringify(initialReport)}
    Verification Results: ${JSON.stringify(answers)}
    
    Return a JSON object with the final, verified report:
    {
      "abstract": "...",
      "introduction": "...",
      "methodology": "...",
      "results": "...",
      "discussion": "...",
      "conclusion": "...",
      "references": [...]
    }`;
    
    const reportResult = await generateJSON<ResearchReport>(finalRefinementPrompt, "You are a world-class researcher ensuring absolute accuracy and integrity.");
    return {
      ...reportResult,
      references: reportResult.references || []
    };
  }
};

export const VerificationAgent = {
  async verifyReport(report: ResearchReport, papers: Paper[]): Promise<{ isValid: boolean; issues: string[] }> {
    const prompt = `Verify the following research report for hallucinations and citation accuracy.
    
    Report Abstract: ${report.abstract.slice(0, 500)}...
    Report References: ${report.references.join("\n")}
    
    Allowed Papers:
    ${papers.map((p, i) => `[${i+1}] ${p.title} by ${p.authors.join(", ")}`).join("\n")}
    
    Check for:
    1. Citations in the text that are NOT in the allowed list.
    2. References listed that are NOT in the allowed list.
    3. Claims that seem completely disconnected from the provided papers.
    
    Return a JSON object:
    {
      "isValid": boolean,
      "issues": ["Issue 1", "Issue 2", ...]
    }`;

    return generateJSON<{ isValid: boolean; issues: string[] }>(prompt, "You are a rigorous fact-checker and academic auditor.");
  }
};

export const FactualityEvalAgent = {
  async evaluate(report: ResearchReport, papers: Paper[]): Promise<FactualityResult> {
    const papersContext = papers.map((p, i) => {
      const chunksInfo = p.chunks 
        ? p.chunks.map(c => `[Section: ${c.section}] ${c.text}`).join("\n")
        : p.summary;
      return `[${i+1}] ${p.title}:\n${chunksInfo}`;
    }).join("\n\n");

    const prompt = `Perform a rigorous factuality evaluation of the following research report against the provided source literature.
    
    Report Abstract: ${report.abstract.slice(0, 500)}...
    Report Methodology: ${report.methodology.slice(0, 1000)}...
    Report Discussion: ${report.discussion.slice(0, 500)}...
    
    Source Literature:
    ${papersContext}
    
    Evaluation Steps:
    1. Extract the 10 most critical factual claims from the report.
    2. For each claim, determine if it is explicitly supported by the provided source literature.
    3. Calculate a "Faithfulness Score" (Supported Claims / Total Claims).
    4. Identify any specific unsupported or hallucinated statements.
    
    Return a JSON object:
    {
      "faithfulnessScore": number (0.0 to 1.0),
      "totalClaims": number,
      "supportedClaims": number,
      "unsupportedClaims": [
        { "claim": "...", "reason": "Why it's unsupported" },
        ...
      ],
      "isPassed": boolean (true if score >= 0.8)
    }`;

    // Using a stronger model (Pro) for the judge role
    return generateJSON<FactualityResult>(prompt, "You are an elite academic judge and fact-checker. You are extremely strict and do not allow any unsupported claims.", "gemini-3.1-pro-preview");
  }
};
