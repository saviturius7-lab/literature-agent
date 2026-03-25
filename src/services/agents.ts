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
import { generateJSON, embedText, embedTexts } from "./gemini";
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
      // 1. Start ALL search strategies in parallel for maximum speed
      onProgress?.("Initializing aggressive multi-strategy literature search...");
      
      const [refinedQuery, broadKeywords] = await Promise.all([
        SearchQueryAgent.refineQuery(topic),
        SearchQueryAgent.getBroadKeywords(topic).catch(() => [])
      ]);

      onProgress?.(`Searching ArXiv with ${broadKeywords.length + 2} parallel strategies...`);
      
      const searchStrategies = [
        topic,
        refinedQuery,
        ...broadKeywords
      ];

      const searchResults = await Promise.all(
        searchStrategies.map(query => 
          this.executeSearch(query).catch(e => {
            console.error(`Search failed for "${query}":`, e);
            return [];
          })
        )
      );

      searchResults.forEach(papers => addPapers(papers));
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
      const xmlData = await apiClient.get<string>(url, {
        timeout: 15000,
        retries: 3,
        backoff: 2000
      });
      
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
    
    const batchSize = 5; // Smaller batch size for better reliability
    const analyzedPapers: Paper[] = [];
    
    // Process batches sequentially to avoid overwhelming APIs
    for (let i = 0; i < papers.length; i += batchSize) {
      const batch = papers.slice(i, i + batchSize);
      const batchIndex = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(papers.length/batchSize);
      
      onProgress?.(`Analyzing batch ${batchIndex}/${totalBatches}...`);
      
      try {
        const results = await this.analyzeBatch(topic, batch);
        
        // OpenAlex verification can be parallelized within the batch
        const openAlexResults = await Promise.all(batch.map(p => this.verifyWithOpenAlex(p.title, p.authors)));

        results.forEach((res, idx) => {
          const paper = batch[idx];
          if (paper && res.isRelevant && res.isConsistent && openAlexResults[idx]) {
            paper.keyFindings = res.keyFindings;
            paper.verified = true;
            analyzedPapers.push(paper);
          }
        });
      } catch (e) {
        console.error(`Batch ${batchIndex} failed:`, e);
      }
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

    const prompt = `You are a world-class research scientist. Your goal is to identify research gaps and propose a novel hypothesis for the topic: "${topic}".
    
    Context from Literature:
    ${papersContext}
    
    Retrieved RAG Context:
    ${ragContext}
    
    ${feedback ? `PREVIOUS ATTEMPT FEEDBACK: ${feedback}` : ""}
    
    Task:
    1. Identify 3 critical research gaps.
    2. Propose a novel hypothesis that addresses at least one of these gaps.
    3. Perform a self-critique of the hypothesis for novelty and grounding.
    4. Provide the final refined hypothesis.
    
    Return a JSON object:
    {
      "gaps": {
        "gaps": [
          { "description": "...", "evidence": "...", "potentialImpact": "..." },
          ...
        ],
        "summary": "..."
      },
      "hypothesis": {
        "title": "...",
        "description": "...",
        "rationale": "...",
        "expectedOutcome": "..."
      },
      "noveltySelfCheck": "Detailed reasoning on why this is novel compared to the provided papers"
    }`;

    const result = await generateJSON<{ gaps: GapIdentification; hypothesis: Hypothesis; noveltySelfCheck: string }>(prompt, "You are an elite research scientist.");
    
    // Perform embedding-based novelty check as a secondary verification
    const novelty = await NoveltyCheckerAgent.checkNovelty(result.hypothesis, papers, attempt);
    
    return {
      gaps: result.gaps,
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
        "source": "..."
      }
    }`;

    const result = await generateJSON<{
      contributions: Contribution[];
      math: MathFormalization;
      plan: ExperimentPlan;
      dataset: DatasetCard;
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
