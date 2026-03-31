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
  FactualityResult,
  ExperimentConfig
} from "../types";
import { generateJSON, embedText, embedTexts, generateText } from "./gemini";
import { vectorStore } from "./vectorStore";
import { apiClient } from "./apiClient";

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
    
    try {
      const result = await generateJSON<{ refinedTopic: string }>(prompt, "You are a senior research scientist who specializes in defining high-impact research directions.");
      return result.refinedTopic || topic;
    } catch (error) {
      console.error("[TopicRefinementAgent] Failed to refine topic, using original:", error);
      return topic;
    }
  }
};

function decodeInvertedIndex(index: any): string {
  if (!index) return "";
  try {
    const words = Object.keys(index);
    if (words.length === 0) return "";
    
    // Find the maximum index to determine the array size
    let maxIdx = 0;
    for (const word of words) {
      const indices = index[word];
      if (Array.isArray(indices)) {
        for (const idx of indices) {
          if (idx > maxIdx) maxIdx = idx;
        }
      }
    }
    
    const result = new Array(maxIdx + 1).fill("");
    for (const word of words) {
      const indices = index[word];
      if (Array.isArray(indices)) {
        for (const idx of indices) {
          result[idx] = word;
        }
      }
    }
    return result.join(" ").trim();
  } catch (e) {
    console.warn("Failed to decode inverted index:", e);
    return "";
  }
}

export const SearchQueryAgent = {
  async refineQuery(topic: string): Promise<string> {
    const prompt = `You are a research query optimization expert for the arXiv API.
    
    Topic: "${topic}"
    
    Your goal is to generate a concise, highly effective search query. 
    ArXiv works best with specific technical keywords rather than long sentences.
    
    Rules:
    1. Use boolean operators (AND, OR) and field prefixes (ti:, abs:, all:) if helpful.
    2. Focus on the core technical innovations and domain.
    3. Keep the query under 80 characters.
    4. Do NOT just repeat the title; extract the most important 2-4 keywords.
    5. Example: "Quantifying Societal Bias in Vision-Language Models" -> "all:\"Vision-Language Models\" AND all:\"Societal Bias\""
    
    Return your response in this JSON format:
    {
      "refinedQuery": "..."
    }`;

    try {
      const result = await generateJSON<{ refinedQuery: string }>(prompt, "You are a research query optimization expert.");
      return result.refinedQuery;
    } catch (error) {
      console.error("[SearchQueryAgent] Failed to refine query, using original topic:", error);
      return topic.slice(0, 100);
    }
  },

  async getBroadKeywords(topic: string): Promise<string[]> {
    const prompt = `Generate 3-4 broad, distinct technical keywords or short phrases related to this research topic.
    These should be high-level concepts that will definitely return results.
    
    Topic: "${topic}"
    
    Return your response in this JSON format:
    {
      "keywords": ["keyword1", "keyword2", ...]
    }`;

    try {
      const result = await generateJSON<{ keywords: string[] }>(prompt, "You are an expert at identifying core research concepts.");
      return result.keywords || [topic.slice(0, 50)];
    } catch (error) {
      console.error("[SearchQueryAgent] Failed to get broad keywords:", error);
      return [topic.slice(0, 50)];
    }
  }
};

export const LiteratureAgent = {
  async fetchPapers(topic: string, onProgress?: (msg: string) => void): Promise<Paper[]> {
    const allPapers: Paper[] = [];
    const seenTitles = new Set<string>();

    const addPapers = (papers: Paper[]) => {
      for (const p of papers) {
        const normalizedTitle = p.title.toLowerCase().trim().replace(/[^\w\s]/gi, '');
        if (!seenTitles.has(normalizedTitle)) {
          allPapers.push(p);
          seenTitles.add(normalizedTitle);
        }
      }
    };

    try {
      onProgress?.(`Refining search topic: "${topic}"...`);
      const [refinedQuery, broadKeywords] = await Promise.all([
        SearchQueryAgent.refineQuery(topic),
        SearchQueryAgent.getBroadKeywords(topic).catch(() => [])
      ]);

      console.log(`[LiteratureAgent] Refined Query: "${refinedQuery}"`);
      console.log(`[LiteratureAgent] Broad Keywords: ${JSON.stringify(broadKeywords)}`);

      // Limit strategies to avoid excessive wait times
      const searchStrategies = Array.from(new Set([
        topic,
        refinedQuery,
        ...broadKeywords
      ])).filter(q => q && q.length > 2).slice(0, 8);

      onProgress?.(`Searching ArXiv and OpenAlex with ${searchStrategies.length} strategies...`);
      console.log(`[LiteratureAgent] Search Strategies: ${JSON.stringify(searchStrategies)}`);
      
      let completedStrategies = 0;
      const searchPromises = searchStrategies.map(async (query, i) => {
        // Stagger OpenAlex calls slightly
        await new Promise(r => setTimeout(r, 500 * i));
        
        try {
          const openAlexResults = await this.executeOpenAlexSearch(query).catch((e) => {
            console.warn(`[LiteratureAgent] OpenAlex failed for "${query}":`, e);
            return [];
          });

          // ArXiv stagger - the proxy queue handles the hard rate limit, 
          // so we just need enough stagger to not flood the proxy all at once.
          const arxivDelay = 1000 * i;
          
          console.log(`[LiteratureAgent] Strategy ${i}: "${query}" (ArXiv delay: ${arxivDelay}ms)`);
          
          // Wait for the staggered ArXiv slot
          await new Promise(r => setTimeout(r, arxivDelay));
          const arxivResults = await this.executeArXivSearch(query).catch((e) => {
            console.warn(`[LiteratureAgent] ArXiv failed for "${query}":`, e);
            return [];
          });

          return [...arxivResults, ...openAlexResults];
        } finally {
          completedStrategies++;
          onProgress?.(`Literature search: ${completedStrategies}/${searchStrategies.length} strategies processed...`);
        }
      });

      const results = await Promise.all(searchPromises);
      results.forEach(papers => addPapers(papers));

      console.log(`[LiteratureAgent] Found ${allPapers.length} unique papers before fallback.`);

      if (allPapers.length === 0) {
        onProgress?.("No papers found. Applying emergency fallback...");
        console.warn(`[LiteratureAgent] Emergency fallback for topic: "${topic}"`);
        
        // Use a very broad version of the topic for fallback
        const broadTopic = topic.split(' ').slice(0, 3).join(' ');
        const fallbackResults = await Promise.all([
          this.executeArXivSearch(broadTopic),
          this.executeOpenAlexSearch(broadTopic),
          this.executeArXivSearch("machine learning artificial intelligence")
        ]);
        fallbackResults.forEach(papers => addPapers(papers));
      }

      if (allPapers.length === 0) {
        console.error("[LiteratureAgent] Total failure: No papers found even with fallback.");
        return [];
      }

      // 2. Semantic Reranking (Fast)
      onProgress?.(`Semantic reranking ${allPapers.length} candidates...`);
      console.log(`[LiteratureAgent] Reranking ${allPapers.length} papers...`);
      const rerankedPapers = await this.semanticRerank(topic, allPapers);

      // 3. Citation Expansion (Smart Discovery) - Parallelized
      const topPapers = rerankedPapers.slice(0, 5); // Take top 5 for better coverage
      if (topPapers.length > 0) {
        onProgress?.("Expanding discovery via citation traversal...");
        const relatedResults = await Promise.all(
          topPapers.map(p => this.fetchRelatedPapers(p).catch(() => []))
        );
        relatedResults.forEach(papers => addPapers(papers));
      }

      // Final Rerank after expansion
      const finalPapers = await this.semanticRerank(topic, allPapers);
      
      onProgress?.(`Discovery complete. ${finalPapers.length} unique papers identified.`);
      return finalPapers.slice(0, 40); 
    } catch (error) {
      console.error("[LiteratureAgent] Error in fetchPapers:", error);
      onProgress?.("Error during paper retrieval. Proceeding with available results.");
      return allPapers;
    }
  },

  async executeArXivSearch(query: string): Promise<Paper[]> {
    // Ensure query is not too long for ArXiv
    const truncatedQuery = query.length > 80 ? query.slice(0, 80).split(' ').slice(0, -1).join(' ') : query;
    const url = `/api/arxiv?q=${encodeURIComponent(truncatedQuery)}`;
    
    try {
      const xmlData = await apiClient.get<string>(url, {
        timeout: 300000, // 5 minutes to allow for queue wait and proxy retries
        retries: 1, // Proxy already retries, so client-side retry is mostly redundant
        backoff: 3000
      });
      
      const jsonObj = parser.parse(xmlData);
      if (!jsonObj || !jsonObj.feed || !jsonObj.feed.entry) return [];
      
      const entryList = Array.isArray(jsonObj.feed.entry) ? jsonObj.feed.entry : [jsonObj.feed.entry];
      return entryList.map((entry: any) => {
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
    } catch (error) {
      console.error(`ArXiv search failed for "${query}":`, error);
      return [];
    }
  },

  async executeOpenAlexSearch(query: string): Promise<Paper[]> {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&mailto=saviturius7@gmail.com&per_page=15`;
    
    try {
      const data = await apiClient.get<any>(url, { timeout: 15000 });
      if (!data || !data.results) return [];
      
      console.log(`[LiteratureAgent] OpenAlex found ${data.results.length} results for "${query}"`);
      
      return data.results.map((res: any) => {
        const title = res.title || "Untitled";
        const abstract = decodeInvertedIndex(res.abstract_inverted_index);
        const authors = res.authorships?.map((a: any) => a.author.display_name) || ["Unknown Author"];
        const year = res.publication_year || "n.d.";
        
        return {
          title,
          summary: abstract || "No summary available",
          authors,
          published: res.publication_date || new Date().toISOString(),
          link: res.doi || res.id || "#",
          citation: `${authors[0] || "Unknown"} (${year}). ${title}. ${res.doi || ""}`,
          chunks: ChunkingAgent.chunkPaper(title, abstract || "OpenAlex Paper"),
          keyFindings: []
        };
      });
    } catch (error) {
      console.error(`OpenAlex search failed for "${query}":`, error);
      return [];
    }
  },

  async fetchRelatedPapers(paper: Paper): Promise<Paper[]> {
    // OpenAlex has a 'related_works' field which is a list of work IDs
    // But it's easier to search for papers that cite this one or have similar concepts
    const url = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(paper.title.slice(0, 100))}&mailto=saviturius7@gmail.com`;
    
    try {
      const data = await apiClient.get<any>(url, { timeout: 8000 });
      if (!data || !data.results || data.results.length === 0) return [];
      
      const workId = data.results[0].id;
      const relatedUrl = `https://api.openalex.org/works?filter=related_to:${workId.split('/').pop()}&mailto=saviturius7@gmail.com&per_page=5`;
      
      const relatedData = await apiClient.get<any>(relatedUrl, { timeout: 8000 });
      if (!relatedData || !relatedData.results) return [];
      
      return relatedData.results.map((res: any) => ({
        title: res.title || "Untitled",
        summary: "Related work discovered via citation traversal",
        authors: res.authorships?.map((a: any) => a.author.display_name) || ["Unknown Author"],
        published: res.publication_date || new Date().toISOString(),
        link: res.doi || res.id || "#",
        citation: `${res.authorships?.[0]?.author.display_name || "Unknown"} (${res.publication_year}). ${res.title}.`,
        chunks: ChunkingAgent.chunkPaper(res.title || "", "Related Work"),
        keyFindings: []
      }));
    } catch (error) {
      return [];
    }
  },

  async semanticRerank(topic: string, papers: Paper[]): Promise<Paper[]> {
    if (papers.length === 0) return [];
    
    try {
      const topicEmbedding = await embedText(topic);
      
      // Identify papers that need embedding
      const papersToEmbed = papers.filter(p => !p.embedding);
      if (papersToEmbed.length > 0) {
        const paperTexts = papersToEmbed.map(p => `${p.title} ${p.summary.slice(0, 200)}`);
        const paperEmbeddings = await embedTexts(paperTexts);
        
        // Store embeddings back in the paper objects
        papersToEmbed.forEach((p, i) => {
          p.embedding = paperEmbeddings[i];
        });
      }
      
      const scoredPapers = papers.map((paper) => ({
        paper,
        score: paper.embedding ? cosineSimilarity(topicEmbedding, paper.embedding) : 0
      }));
      
      return scoredPapers
        .sort((a, b) => b.score - a.score)
        .map(s => s.paper);
    } catch (error) {
      console.error("[LiteratureAgent] Semantic reranking failed:", error);
      return papers;
    }
  }
};

export const UnifiedPaperAnalyzerAgent = {
  async verifyBatchWithOpenAlex(papers: Paper[]): Promise<boolean[]> {
    if (papers.length === 0) return [];
    
    try {
      // OpenAlex supports filtering by multiple titles using |
      const titles = papers.map(p => p.title.replace(/[^\w\s]/gi, '').toLowerCase().trim().slice(0, 50));
      const filter = `title.search:(${titles.join('|')})`;
      const url = `https://api.openalex.org/works?filter=${filter}&mailto=saviturius7@gmail.com&per_page=50`;
      
      const data = await apiClient.get<any>(url, { 
        timeout: 15000,
        retries: 2,
        backoff: 1000
      });
      
      if (data && data.results) {
        const foundTitles = data.results.map((r: any) => (r.display_name || r.title || "").toLowerCase().replace(/[^\w\s]/gi, '').trim());
        
        return papers.map(p => {
          const normalizedP = p.title.toLowerCase().replace(/[^\w\s]/gi, '').trim();
          return foundTitles.some((ft: string) => ft.includes(normalizedP) || normalizedP.includes(ft) || (normalizedP.length > 20 && ft.startsWith(normalizedP.slice(0, 20))));
        });
      }
    } catch (error) {
      console.error("[UnifiedPaperAnalyzerAgent] Batch verification failed:", error);
    }
    
    return Promise.all(papers.map(p => this.verifyWithOpenAlex(p.title, p.authors)));
  },

  async verifyWithOpenAlex(title: string, authors: string[] = []): Promise<boolean> {
    try {
      // Clean title for search: remove punctuation, lowercase, and take first 100 chars
      const cleanTitle = title.replace(/[^\w\s]/gi, '').toLowerCase().trim();
      
      // Strategy 1: Title Search
      const titleUrl = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(cleanTitle.slice(0, 100))}&mailto=saviturius7@gmail.com`;
      
      try {
        const data = await apiClient.get<any>(titleUrl, {
          timeout: 12000,
          retries: 2,
          backoff: 1000
        });
        
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
        console.warn("OpenAlex title search error:", e);
      }
      
      // Strategy 2: Author + Year (if title search failed)
      if (authors.length > 0) {
        const firstAuthor = authors[0].split(' ').pop() || "";
        if (firstAuthor) {
          const authorUrl = `https://api.openalex.org/works?filter=author.search:${encodeURIComponent(firstAuthor)}&mailto=saviturius7@gmail.com`;
          
          try {
            const authData = await apiClient.get<any>(authorUrl, {
              timeout: 12000,
              retries: 2,
              backoff: 1000
            });
            
            for (const result of authData.results || []) {
              const resultTitle = result.display_name.toLowerCase().replace(/[^\w\s]/gi, '').trim();
              if (resultTitle.includes(cleanTitle.slice(0, 20)) || cleanTitle.includes(resultTitle.slice(0, 20))) {
                return true;
              }
            }
          } catch (e) {
            console.warn("OpenAlex author search error:", e);
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
    4. Summary: Provide a one-sentence high-level summary of the paper's core contribution.
    
    Papers:
    ${papers.map((p, i) => `[Paper ${i}] Title: ${p.title}\nSummary: ${p.summary.slice(0, 500)}...`).join("\n\n")}
    
    Return a JSON object with the analysis for each paper index:
    {
      "results": [
        { 
          "index": 0, 
          "isRelevant": boolean, 
          "isConsistent": boolean, 
          "keyFindings": ["Finding 1", "Finding 2"],
          "summary": "One sentence summary"
        },
        ...
      ]
    }`;

    try {
      const result = await generateJSON<{ results: { index: number; isRelevant: boolean; isConsistent: boolean; keyFindings: string[]; summary: string }[] }>(prompt, "You are a meticulous academic auditor and expert researcher.");
      return result.results || [];
    } catch (e) {
      console.error(`Batch analysis failed:`, e);
      // Return default values on failure
      return papers.map((_, i) => ({ index: i, isRelevant: true, isConsistent: true, keyFindings: [], summary: papers[i].summary }));
    }
  },

  async analyze(topic: string, papers: Paper[], onProgress?: (msg: string) => void): Promise<Paper[]> {
    if (papers.length === 0) return [];

    const pool = papers.slice(0, 40);
    onProgress?.(`Analyzing top ${pool.length} papers with high-concurrency engine...`);
    
    const batchSize = 5;
    const verifiedPapers: Paper[] = [];
    const batches = [];
    for (let i = 0; i < pool.length; i += batchSize) {
      batches.push(pool.slice(i, i + batchSize));
    }

    const concurrencyLimit = 10; 
    const targetVerified = 12;

    for (let i = 0; i < batches.length; i += concurrencyLimit) {
      const currentBatches = batches.slice(i, i + concurrencyLimit);
      
      await Promise.all(currentBatches.map(async (batch) => {
        if (verifiedPapers.length >= targetVerified) return;

        try {
          const [analysisResults, verificationResults] = await Promise.all([
            this.analyzeBatch(topic, batch),
            this.verifyBatchWithOpenAlex(batch)
          ]);
          
          analysisResults.forEach((res) => {
            const paper = batch[res.index];
            const isVerified = verificationResults[res.index];
            
            if (paper && res.isRelevant && res.isConsistent && isVerified) {
              verifiedPapers.push({
                ...paper,
                isVerified: true,
                relevanceScore: 8,
                keyFindings: res.keyFindings,
                summary: res.summary || paper.summary
              });
            }
          });
        } catch (error) {
          console.error("Batch processing failed:", error);
        }
      }));
      
      if (verifiedPapers.length >= targetVerified) break;
    }

    onProgress?.(`Analysis complete. ${verifiedPapers.length} verified papers retained.`);
    return verifiedPapers;
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

export const NoveltyCheckerAgent = {
  async checkNovelty(hypothesis: Hypothesis, papers: Paper[], attempt: number = 0): Promise<{ isNovel: boolean; similarity: number; mostSimilarPaper?: string; feedback?: string }> {
    // RAG: Search for the most similar existing work in the vector store (which contains chunks)
    const query = `${hypothesis.title} ${hypothesis.description}`;
    const similarChunks = await vectorStore.search(query, 10);
    
    let maxSimilarity = -1;
    let mostSimilarSource = "";

    if (similarChunks.length > 0) {
      const [hypothesisEmbedding, ...chunkEmbeddings] = await embedTexts([
        query,
        ...similarChunks.map(c => c.text)
      ]);

      chunkEmbeddings.forEach((chunkEmbedding, idx) => {
        const similarity = cosineSimilarity(hypothesisEmbedding, chunkEmbedding);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mostSimilarSource = similarChunks[idx].metadata.source;
        }
      });
    }

    // Also check against summaries for global context
    const [hypothesisEmbedding, ...summaryEmbeddings] = await embedTexts([
      query,
      ...papers.map(p => `${p.title} ${p.summary}`)
    ]);

    summaryEmbeddings.forEach((summaryEmbedding, idx) => {
      const similarity = cosineSimilarity(hypothesisEmbedding, summaryEmbedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mostSimilarSource = papers[idx].title;
      }
    });

    // Adaptive threshold: starts at 0.8, increases per attempt
    const threshold = Math.min(0.9, 0.8 + (attempt * 0.02));
    const isNovel = maxSimilarity < threshold;
    
    let feedback = "";
    if (!isNovel) {
      feedback = `The hypothesis is too similar to existing work: "${mostSimilarSource}" (Similarity score: ${maxSimilarity.toFixed(2)}, Threshold: ${threshold.toFixed(2)}). You must find a more novel angle.`;
    }

    return {
      isNovel,
      similarity: maxSimilarity,
      mostSimilarPaper: mostSimilarSource,
      feedback
    };
  }
};

export const GapAnalysisAgent = {
  async analyze(topic: string, papers: Paper[]): Promise<GapIdentification> {
    const prompt = `You are a critical research auditor. Analyze the following papers to identify 3 non-obvious research gaps for the topic: "${topic}".
    
    Papers:
    ${papers.map((p, i) => `[${i+1}] ${p.title}\nSummary: ${p.summary}`).join("\n\n")}
    
    Task:
    1. Look for contradictions between papers.
    2. Identify assumptions that are taken for granted but not proven.
    3. Find areas where current methodologies fail or are inefficient.
    4. Propose 3 specific gaps with evidence from the provided summaries.
    
    Return a JSON object:
    {
      "gaps": [
        { "description": "...", "evidence": "...", "potentialImpact": "..." },
        ...
      ],
      "summary": "Cohesive summary of the research landscape and the identified gaps."
    }`;
    
    return await generateJSON<GapIdentification>(prompt, "You are a skeptical and rigorous research auditor.");
  }
};

export const DiscoveryAgent = {
  async discover(topic: string, papers: Paper[], attempt: number = 0, feedback?: string): Promise<{
    gaps: GapIdentification;
    hypothesis: Hypothesis;
    novelty: { isNovel: boolean; similarity: number; mostSimilarPaper?: string; feedback?: string };
  }> {
    const relevantChunks = await vectorStore.search(topic, 15);
    const ragContext = relevantChunks.map(c => `[Source: ${c.metadata.source}] ${c.text}`).join("\n\n");
    
    const papersContext = papers.map((p, i) => {
      const chunksInfo = p.chunks 
        ? p.chunks.map(c => `[Section: ${c.section}] ${c.text}`).join("\n")
        : p.summary;
      return `Paper [${i+1}]: ${p.title}\n${chunksInfo}`;
    }).join("\n\n");

    const gaps = await GapAnalysisAgent.analyze(topic, papers);
    
    const prompt = `You are a world-class research scientist. Your goal is to propose a novel hypothesis for the topic: "${topic}" based on these identified research gaps.
    
    Identified Gaps:
    ${JSON.stringify(gaps)}
    
    Context from Literature:
    ${papersContext}
    
    Retrieved RAG Context:
    ${ragContext}
    
    ${feedback ? `PREVIOUS ATTEMPT FEEDBACK: ${feedback}` : ""}
    
    Task:
    1. Propose a novel hypothesis that directly addresses one or more of the identified gaps.
    2. Provide a detailed rationale and expected outcome.
    3. Perform a self-critique for novelty and grounding.
    
    Return a JSON object:
    {
      "hypothesis": {
        "title": "...",
        "description": "...",
        "rationale": "...",
        "expectedOutcome": "..."
      },
      "noveltySelfCheck": "Detailed reasoning on why this is novel compared to the provided papers"
    }`;

    const result = await generateJSON<{ hypothesis: Hypothesis; noveltySelfCheck: string }>(prompt, "You are an elite research scientist.");
    
    // Perform embedding-based novelty check as a secondary verification
    const novelty = await NoveltyCheckerAgent.checkNovelty(result.hypothesis, papers, attempt);
    
    return {
      gaps,
      hypothesis: result.hypothesis,
      novelty
    };
  },

  async refine(hypothesis: Hypothesis, result: ExperimentResult, papers: Paper[]): Promise<Hypothesis> {
    const prompt = `The following hypothesis was successful in experiments. Your task is to refine it by adding more technical details to the main parts and resolving any ambiguous aspects.
    
    Original Hypothesis:
    Title: ${hypothesis.title}
    Description: ${hypothesis.description}
    Rationale: ${hypothesis.rationale}
    
    Experiment Results:
    Accuracy: ${result.accuracy.toFixed(4)}
    F1 Score: ${result.f1Score.toFixed(4)}
    
    Context from Literature:
    ${papers.map(p => `- ${p.title}: ${p.summary.slice(0, 200)}...`).join("\n")}
    
    Return a JSON object with the refined hypothesis:
    {
      "title": "Refined Title",
      "description": "More detailed and precise description",
      "rationale": "Updated rationale with more depth",
      "expectedOutcome": "Updated expected outcome"
    }`;

    return generateJSON<Hypothesis>(prompt, "You are a meticulous researcher focused on precision and technical depth.");
  },

  async debug(hypothesis: Hypothesis, result: ExperimentResult, critiques: ReviewerCritique[], papers: Paper[]): Promise<Hypothesis> {
    const prompt = `The following hypothesis failed to meet expectations in experiments. Your task is to identify where the mistake might be and change the hypothesis until it is corrected.
    
    Failed Hypothesis:
    Title: ${hypothesis.title}
    Description: ${hypothesis.description}
    Rationale: ${hypothesis.rationale}
    
    Experiment Results:
    Accuracy: ${result.accuracy.toFixed(4)}
    F1 Score: ${result.f1Score.toFixed(4)}
    
    Critiques:
    ${critiques.map(c => `- [Rating: ${c.rating}/10] Novelty: ${c.noveltyCritique}\n  Weaknesses: ${c.weaknesses.join(", ")}`).join("\n")}
    
    Context from Literature:
    ${papers.map(p => `- ${p.title}: ${p.summary.slice(0, 200)}...`).join("\n")}
    
    Analyze the failure, identify the core mistake, and provide a corrected hypothesis.
    
    Return a JSON object with the corrected hypothesis:
    {
      "title": "Corrected Title",
      "description": "Revised description fixing the identified mistakes",
      "rationale": "Revised rationale explaining why this version should work",
      "expectedOutcome": "Revised expected outcome"
    }`;

    return generateJSON<Hypothesis>(prompt, "You are an expert at debugging research failures and pivoting to better directions.");
  }
};

export const DesignAgent = {
  async design(hypothesis: Hypothesis): Promise<{
    contributions: Contribution[];
    math: MathFormalization;
    plan: ExperimentPlan;
    dataset: DatasetCard;
  }> {
    const prompt = `You are a senior research architect. Design a complete research project for the following hypothesis:
    "${hypothesis.title}"
    
    Description: ${hypothesis.description}
    Rationale: ${hypothesis.rationale}
    
    Task:
    1. Define 2-3 specific research contributions.
    2. Provide a rigorous mathematical formalization (notation, objective function, algorithm).
    3. Design a detailed experiment plan (protocol, datasets, baselines, metrics).
    4. Generate a Dataset Card for the primary proposed dataset.
    5. Suggest a real Kaggle dataset (format: 'owner/dataset') that could be used for this experiment if applicable.
    
    NOTE: The implementation will use AutoGluon's TabularPredictor.
    
    Return a JSON object:
    {
      "contributions": [
        { "type": "...", "description": "..." },
        ...
      ],
      "math": {
        "problemFormulation": "...",
        "notation": [{ "symbol": "...", "definition": "..." }],
        "objectiveFunction": "...",
        "algorithmSteps": ["..."]
      },
      "plan": {
        "protocol": "...",
        "datasets": ["..."],
        "baselines": ["..."],
        "metrics": ["..."]
      },
      "dataset": {
        "name": "...",
        "description": "...",
        "features": ["..."],
        "size": "...",
        "source": "...",
        "kaggleDataset": "owner/dataset (optional)",
        "targetColumn": "column_name (optional)"
      }
    }`;

    const result = await generateJSON<{
      contributions: Contribution[];
      math: MathFormalization;
      plan: ExperimentPlan;
      dataset: DatasetCard & { kaggleDataset?: string; targetColumn?: string };
    }>(prompt, "You are a senior research architect at a top AI lab.");

    return result;
  }
};

export const ExperimentRunner = {
  async runExperiment(hypothesis: Hypothesis, plan: ExperimentPlan, config: ExperimentConfig): Promise<ExperimentResult> {
    console.log(`[ExperimentRunner] Executing experiment for: ${hypothesis.title}`);
    
    try {
      const result = await apiClient.post<ExperimentResult>('/api/run-experiment', {
        hypothesis,
        plan,
        config
      }, {
        timeout: 60000, // Experiments can take a while
        retries: 2,
        backoff: 5000
      });
      
      return result;
    } catch (error: any) {
      console.error("[ExperimentRunner] Backend experiment failed:", error);
      throw new Error(`Experiment execution failed: ${error.message || String(error)}`);
    }
  }
};

export const ResultValidationAgent = {
  async validate(hypothesis: Hypothesis, result: ExperimentResult): Promise<{ isValid: boolean; feedback: string }> {
    const prompt = `Validate the experimental results against the original hypothesis.
    
    Hypothesis: ${hypothesis.description}
    Results: Accuracy ${(result.accuracy || 0).toFixed(2)}, F1 ${(result.f1Score || 0).toFixed(2)}
    Baselines: ${(Array.isArray(result.baselines) ? result.baselines : []).map(b => `${b.name}: ${(b.accuracy || 0).toFixed(2)}`).join(", ")}
    
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

export const LiteratureSynthesisAgent = {
  async synthesize(topic: string, papers: Paper[]): Promise<string> {
    const prompt = `You are a world-class AI researcher. Synthesize the following papers into a cohesive "Related Work" narrative for a research paper on "${topic}".
    
    Papers:
    ${papers.map((p, i) => `[${i+1}] ${p.title}\nSummary: ${p.summary}`).join("\n\n")}
    
    Task:
    1. Group the papers by theme or methodology.
    2. Provide a narrative that explains the evolution of the field and where the current research fits in.
    3. Use in-text citations like [1], [2], etc.
    4. Be critical and highlight the strengths and weaknesses of existing work.
    
    Return the synthesized narrative in Markdown format.`;
    
    try {
      return await generateText(prompt, "You are an expert in scientific literature synthesis.");
    } catch (e) {
      console.error("Literature synthesis failed:", e);
      return papers.map((p, i) => `### [${i+1}] ${p.title}\n${p.summary}`).join("\n\n");
    }
  }
};

export const ReportAgent = {
  async generateSection(
    sectionName: string,
    topic: string,
    hypothesis: Hypothesis,
    papers: Paper[],
    contributions: Contribution[],
    math: MathFormalization,
    experimentPlan: ExperimentPlan,
    datasetCard: DatasetCard,
    result: ExperimentResult,
    critiques: ReviewerCritique[],
    previousSections: string = ""
  ): Promise<string> {
    const prompt = `You are a world-class AI researcher writing a high-impact conference paper (e.g., NeurIPS, ICML).
    Write the **${sectionName}** section of the research report.
    
    Topic: ${topic}
    Hypothesis: ${hypothesis.title}
    
    Context from Literature:
    ${papers.map((p, i) => `[${i+1}] ${p.title}: ${p.summary.slice(0, 300)}...`).join("\n")}
    
    Research Details:
    - Contributions: ${JSON.stringify(contributions)}
    - Math: ${JSON.stringify(math)}
    - Plan: ${JSON.stringify(experimentPlan)}
    - Dataset: ${JSON.stringify(datasetCard)}
    - Results: ${JSON.stringify(result)}
    - Critiques: ${JSON.stringify(critiques)}
    
    ${previousSections ? `Previous Sections for Context:\n${previousSections.slice(-2000)}` : ""}
    
    Instructions for this section (${sectionName}):
    - Use professional, academic language.
    - Be technically precise.
    - Use LaTeX-style notation for math where appropriate.
    - Cite the provided papers using [1], [2], etc. ONLY if they are relevant to this section.
    - Do NOT invent papers.
    - For the Results section, include detailed analysis of the metrics and feature importance.
    - For the Discussion section, address the reviewer critiques and explain how they were mitigated or why they are limitations.
    
    Return ONLY the text for the ${sectionName} section in Markdown format.`;

    try {
      return await generateText(prompt, "You are a senior research scientist and expert technical writer.");
    } catch (e) {
      console.error(`Failed to generate section ${sectionName}:`, e);
      return `## ${sectionName}\n[Content generation failed for this section.]`;
    }
  },

  async generateReport(
    topic: string, 
    papers: Paper[], 
    hypothesis: Hypothesis, 
    contributions: Contribution[],
    math: MathFormalization,
    experimentPlan: ExperimentPlan,
    datasetCard: DatasetCard,
    result: ExperimentResult,
    critiques: ReviewerCritique[],
    onProgress?: (msg: string) => void
  ): Promise<ResearchReport> {
    onProgress?.("Generating structured research report...");
    
    const sections = [
      "Abstract",
      "Introduction",
      "Related Work",
      "Methodology",
      "Experimental Setup",
      "Results",
      "Discussion",
      "Conclusion"
    ];
    
    let fullReportText = `# ${hypothesis.title}\n\nGenerated by Literature Agent\n\n`;
    const sectionContents: Record<string, string> = {};
    
    for (const section of sections) {
      onProgress?.(`Writing section: ${section}...`);
      let content = "";
      if (section === "Related Work") {
        content = await LiteratureSynthesisAgent.synthesize(topic, papers);
      } else {
        content = await this.generateSection(
          section,
          topic,
          hypothesis,
          papers,
          contributions,
          math,
          experimentPlan,
          datasetCard,
          result,
          critiques,
          fullReportText
        );
      }
      sectionContents[section] = content;
      fullReportText += `\n\n${content}`;
    }

    fullReportText += `\n\n## References\n\n${papers.map((p, i) => `[${i+1}] ${p.citation}`).join("\n\n")}`;

    return {
      title: hypothesis.title,
      abstract: sectionContents["Abstract"] || "No abstract generated.",
      introduction: sectionContents["Introduction"] || "No introduction generated.",
      methodology: sectionContents["Methodology"] || "No methodology generated.",
      results: sectionContents["Results"] || "No results generated.",
      discussion: sectionContents["Discussion"] || "No discussion generated.",
      conclusion: sectionContents["Conclusion"] || "No conclusion generated.",
      references: papers.map(p => p.citation),
      fullMarkdown: fullReportText
    };
  },

  async refineReport(
    report: ResearchReport,
    papers: Paper[],
    critiques: ReviewerCritique[],
    factualityIssues: { claim: string; reason: string }[]
  ): Promise<ResearchReport> {
    const prompt = `Refine the following research report based on adversarial feedback and factuality issues.
    
    Current Report Title: ${report.title}
    
    Feedback from Reviewers:
    ${critiques.map(c => `- Weaknesses: ${c.weaknesses.join(", ")}\n- Technical Critique: ${c.technicalCritique}`).join("\n")}
    
    Factuality Issues (HALLUCINATIONS TO FIX):
    ${factualityIssues.map(i => `- Claim: ${i.claim}\n- Reason: ${i.reason}`).join("\n")}
    
    Source Literature for Grounding:
    ${papers.map((p, i) => `[${i+1}] ${p.title}: ${p.summary}`).join("\n")}
    
    Instructions:
    1. Fix all factuality issues by removing or correcting unsupported claims.
    2. Address the reviewer weaknesses by adding technical depth and precision.
    3. Ensure the final report is 100% grounded in the provided literature.
    
    Return the full, refined report in Markdown format.`;

    const refinedMarkdown = await generateText(prompt, "You are a world-class researcher performing a final, rigorous refinement of a scientific paper.");
    
    // Parse the refined markdown back into sections (simplified for now)
    return {
      ...report,
      fullMarkdown: refinedMarkdown
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

export const ReviewerAgent = {
  async review(report: ResearchReport, papers: Paper[]): Promise<ReviewerCritique[]> {
    const prompt = `You are a senior reviewer for a top-tier AI conference (e.g., NeurIPS).
    Critically evaluate the following research report for technical depth, novelty, and potential "degenerate strategies" (e.g., citation stuffing, generic claims, lack of technical detail).
    
    Report Title: ${report.title}
    Abstract: ${report.abstract.slice(0, 500)}...
    Methodology: ${report.methodology.slice(0, 1000)}...
    
    Review Criteria:
    1. **Technical Depth**: Does the methodology provide enough detail (math, algorithms, parameters) for a peer to reproduce?
    2. **Novelty**: Is the hypothesis a significant departure from the provided literature, or just a minor tweak?
    3. **Citation Integrity**: Are citations [1], [2], etc. used to support specific technical claims, or just "stuffed" into sentences?
    4. **Experimental Rigor**: Are the results analyzed deeply, or just listed?
    
    Return a JSON object with 3 distinct reviewer critiques:
    {
      "critiques": [
        {
          "rating": number (1-10),
          "strengths": ["..."],
          "weaknesses": ["..."],
          "noveltyCritique": "...",
          "technicalCritique": "..."
        },
        ...
      ]
    }`;
    
    const result = await generateJSON<{ critiques: ReviewerCritique[] }>(prompt, "You are a highly critical and technically proficient academic reviewer.");
    return result.critiques;
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

    const prompt = `Perform a RUTHLESS factuality evaluation of the following research report.
    Your goal is to find ANY claim that is not explicitly supported by the provided literature.
    
    Report Abstract: ${report.abstract.slice(0, 500)}...
    Report Methodology: ${report.methodology.slice(0, 1500)}...
    Report Results: ${report.results.slice(0, 500)}...
    
    Source Literature:
    ${papersContext}
    
    Evaluation Protocol:
    1. Identify the 15 most specific technical claims (e.g., "Method X achieves Y", "Paper [Z] proves W").
    2. Cross-reference each claim with the source literature.
    3. If a claim is "plausible" but not "explicitly stated", it is UNSUPPORTED.
    4. Be extremely wary of "citation stuffing" where a citation is used to hide a generic claim.
    
    Return a JSON object:
    {
      "faithfulnessScore": number (0.0 to 1.0),
      "totalClaims": number,
      "supportedClaims": number,
      "unsupportedClaims": [
        { "claim": "...", "reason": "Why it's unsupported or a hallucination" },
        ...
      ],
      "isPassed": boolean (true if score >= 0.9)
    }`;

    return generateJSON<FactualityResult>(prompt, "You are a ruthless academic auditor. Your reputation depends on finding even the smallest hallucination.", "gemini-3.1-pro-preview");
  }
};
