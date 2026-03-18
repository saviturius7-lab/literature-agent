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
import { generateJSON, embedText } from "./gemini";

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
  async generateHypotheticalAbstract(topic: string): Promise<string> {
    const prompt = `Write a hypothetical, high-quality scientific abstract that would perfectly answer the research question: "${topic}".
    The abstract should include:
    1. Background and motivation.
    2. A novel methodology or approach.
    3. Key findings and implications.
    
    Make it sound like a top-tier AI/ML conference paper (NeurIPS, ICML, ICLR).
    
    Return a JSON object:
    {
      "hypotheticalAbstract": "The full text of the hypothetical abstract..."
    }`;
    
    const result = await generateJSON<{ hypotheticalAbstract: string }>(prompt, "You are a world-class AI researcher writing a groundbreaking paper.");
    return result.hypotheticalAbstract || "";
  },

  async refineQuery(topic: string): Promise<string> {
    // HyDE Implementation: Generate hypothetical abstract first
    const hypotheticalAbstract = await this.generateHypotheticalAbstract(topic);
    
    const prompt = `Based on the following research topic and a hypothetical ideal abstract, generate an optimized search query for the arXiv API.
    The query should use specific technical keywords found in the abstract to ensure high semantic alignment.
    Use boolean operators if necessary (AND, OR).
    Avoid stop words and conversational filler.
    Keep the query under 10 words for better compatibility.
    
    Topic: "${topic}"
    Hypothetical Abstract: "${hypotheticalAbstract.slice(0, 500)}..."
    
    Return a JSON object:
    {
      "refinedQuery": "optimized search query"
    }`;
    
    const result = await generateJSON<{ refinedQuery: string }>(prompt, "You are an expert research librarian specializing in academic search optimization and semantic retrieval.");
    return result.refinedQuery || topic;
  },

  async getBroadKeywords(topic: string): Promise<string[]> {
    const prompt = `Extract 3-5 broad, high-level keywords from the following research topic that would be effective for a general search.
    
    Topic: "${topic}"
    
    Return a JSON object:
    {
      "keywords": ["keyword1", "keyword2", ...]
    }`;
    
    const result = await generateJSON<{ keywords: string[] }>(prompt, "You are an expert at identifying core research concepts.");
    return result.keywords || [topic];
  }
};

async function fetchWithRetry(url: string, retries = 3, backoff = 1000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url);
    if (response.status === 429 && i < retries - 1) {
      const waitTime = backoff * Math.pow(2, i);
      console.warn(`ArXiv API rate limited (429). Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }
    return response;
  }
  return fetch(url); // Final attempt
}

export const LiteratureAgent = {
  async fetchPapers(topic: string): Promise<Paper[]> {
    // Strategy 1: Refined Query
    const refinedQuery = await SearchQueryAgent.refineQuery(topic);
    console.log(`Search Strategy 1 (Refined): "${refinedQuery}"`);
    let papers = await this.executeSearch(refinedQuery);
    if (papers.length > 0) return papers;

    // Strategy 2: Original Topic
    if (refinedQuery !== topic) {
      console.log(`Search Strategy 2 (Original): "${topic}"`);
      papers = await this.executeSearch(topic);
      if (papers.length > 0) return papers;
    }

    // Strategy 3: Broad Keywords
    console.log("Search Strategy 3 (Broad Keywords)");
    const keywords = await SearchQueryAgent.getBroadKeywords(topic);
    for (const keyword of keywords) {
      console.log(`Trying keyword: "${keyword}"`);
      papers = await this.executeSearch(keyword);
      if (papers.length > 0) return papers;
    }

    // Strategy 4: Very Broad Fallback (AI/ML general)
    console.log("Search Strategy 4 (Very Broad Fallback)");
    papers = await this.executeSearch("artificial intelligence machine learning");
    
    return papers;
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
        chunks: ChunkingAgent.chunkPaper(title, summary)
      };
    });
  }
};

export const ChunkingAgent = {
  chunkPaper(title: string, text: string): Chunk[] {
    // Recursive character splitting logic
    // We split by logical markers: Paragraphs, then Sentences
    const separators = ["\n\n", "\n", ". ", "! ", "? "];
    const targetSize = 500; // characters
    const overlapSize = 100; // characters
    
    let chunks: string[] = [];
    
    const splitRecursively = (input: string, sepIdx: number): string[] => {
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

    const rawChunks = splitRecursively(text, 0);
    
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

export const TopicRelevanceAgent = {
  async filterRelevantPapers(topic: string, papers: Paper[]): Promise<Paper[]> {
    if (papers.length === 0) return [];

    const prompt = `Evaluate the relevance of the following research papers to the topic: "${topic}".
    For each paper, determine if it is directly relevant or highly related.
    
    Papers:
    ${papers.map((p, i) => `ID: ${i} | Title: ${p.title} | Summary: ${p.summary.slice(0, 300)}...`).join("\n\n")}
    
    Return a JSON object with the indices of papers that are TRULY relevant to "${topic}":
    {
      "relevantIndices": [number, number, ...]
    }`;

    const result = await generateJSON<{ relevantIndices: number[] }>(prompt, "You are a strict academic reviewer who filters out irrelevant search results.");
    const relevantIndices = result.relevantIndices || [];
    return relevantIndices.map(idx => papers[idx]).filter(p => !!p);
  }
};

export const CitationVerificationAgent = {
  async verifyWithOpenAlex(title: string): Promise<boolean> {
    try {
      // Clean title for search
      const cleanTitle = title.replace(/[^\w\s]/gi, '').slice(0, 100);
      const url = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(cleanTitle)}&mailto=saviturius7@gmail.com`;
      
      const response = await fetch(url);
      if (!response.ok) return false;
      
      const data = await response.json();
      // Check if any result matches the title closely (fuzzy match)
      if (data.results && data.results.length > 0) {
        const topResult = data.results[0];
        const resultTitle = topResult.display_name.toLowerCase();
        const searchTitle = title.toLowerCase();
        
        // Simple inclusion check or similarity
        return resultTitle.includes(searchTitle) || searchTitle.includes(resultTitle);
      }
      return false;
    } catch (e) {
      console.error("OpenAlex verification error:", e);
      return false;
    }
  },

  async verify(papers: Paper[], topic: string): Promise<{ verifiedPapers: Paper[]; issues: string[] }> {
    // 1. LLM Pre-filtering (Consistency check)
    const prompt = `Verify that the following papers are REAL and RELEVANT to the topic: "${topic}".
    Check if the titles and summaries make sense and are not hallucinations.
    
    Papers:
    ${papers.map((p, i) => `[${i+1}] Title: ${p.title}\nSummary: ${p.summary.slice(0, 200)}...`).join("\n\n")}
    
    Return a JSON object:
    {
      "verifiedIndices": [number, number, ...],
      "issues": ["Issue 1", "Issue 2", ...]
    }`;
    
    const result = await generateJSON<{ verifiedIndices: number[]; issues: string[] }>(prompt, "You are a meticulous academic auditor who detects hallucinations and irrelevant content.");
    const verifiedIndices = new Set(result.verifiedIndices || []);
    
    // 2. Real-world Verification Loop (OpenAlex)
    const issues: string[] = [...(result.issues || [])];
    
    // We verify in parallel for speed
    const verificationResults = await Promise.all(
      papers.map(async (paper, i) => {
        const llmVerified = verifiedIndices.has(i + 1);
        const realWorldVerified = await this.verifyWithOpenAlex(paper.title);
        
        return { 
          ...paper, 
          verified: llmVerified && realWorldVerified 
        };
      })
    );
    
    for (const paper of verificationResults) {
      if (!paper.verified) {
        issues.push(`Could not fully verify existence of paper: "${paper.title}" in real-world databases.`);
      }
    }
    
    return {
      verifiedPapers: verificationResults,
      issues
    };
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
    const papersContext = papers.map((p, i) => {
      const chunksInfo = p.chunks 
        ? p.chunks.map(c => `[Section: ${c.section}] ${c.text}`).join("\n")
        : p.summary;
      return `Paper [${i+1}]: ${p.title}\n${chunksInfo}`;
    }).join("\n\n");

    // Step 1: Generate initial response
    const initialPrompt = `Based STRICTLY on the following research papers about "${topic}", propose a novel research hypothesis.
    Do NOT invent information that is not supported by or extrapolated from these specific papers.
    
    Papers:
    ${papersContext}
    
    ${feedback ? `PREVIOUS ATTEMPT FEEDBACK: ${feedback}\nPlease adjust your hypothesis to be more novel and distinct from existing work.` : ""}
    
    Return a JSON object with:
    {
      "title": "Hypothesis Title",
      "description": "Clear statement of the hypothesis",
      "rationale": "Why this hypothesis makes sense given the provided literature. Refer to specific papers by their index [1], [2], etc. and specify the section if available.",
      "expectedOutcome": "What we expect to see if the hypothesis is true"
    }`;
    
    const initialHypothesis = await generateJSON<Hypothesis>(initialPrompt, "You are a brilliant research scientist who values empirical grounding and avoids speculation.");

    // Step 2: Generate validation questions
    const verificationQuestionsPrompt = `Based on the following hypothesis and the provided research papers, generate 3-5 specific verification questions to check if the hypothesis is truly grounded in the literature and not hallucinated.
    
    Hypothesis: ${initialHypothesis.description}
    Rationale: ${initialHypothesis.rationale}
    
    Questions should be like: "Does Paper [X] actually mention Y?" or "Is the claim about Z supported by the methodology in Paper [W]?"
    
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
    const finalRefinementPrompt = `Refine the initial research hypothesis based on the verification results. 
    If any part of the initial hypothesis was found to be unsupported or hallucinated, correct it or remove it.
    Ensure the final hypothesis is 100% grounded in the provided literature.
    
    Initial Hypothesis: ${JSON.stringify(initialHypothesis)}
    Verification Results: ${JSON.stringify(answers)}
    
    Return a JSON object with the final, verified hypothesis:
    {
      "title": "...",
      "description": "...",
      "rationale": "...",
      "expectedOutcome": "..."
    }`;
    
    return generateJSON<Hypothesis>(finalRefinementPrompt, "You are a world-class researcher ensuring absolute accuracy and integrity.");
  }
};

export const NoveltyCheckerAgent = {
  async checkNovelty(hypothesis: Hypothesis, papers: Paper[], attempt: number = 0): Promise<{ isNovel: boolean; similarity: number; mostSimilarPaper?: string; feedback?: string }> {
    const hypothesisEmbedding = await embedText(`${hypothesis.title} ${hypothesis.description}`);
    let maxSimilarity = -1;
    let mostSimilarPaper = "";

    for (const paper of papers) {
      const paperEmbedding = await embedText(`${paper.title} ${paper.summary}`);
      const similarity = cosineSimilarity(hypothesisEmbedding, paperEmbedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mostSimilarPaper = paper.title;
      }
    }

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
    const contributions = result.contributions || [];
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
      notation: result.notation || [],
      algorithmSteps: result.algorithmSteps || []
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
      datasets: result.datasets || [],
      baselines: result.baselines || [],
      metrics: result.metrics || []
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
    Baselines: ${result.baselines.map(b => `${b.name}: ${b.accuracy.toFixed(2)}`).join(", ")}
    
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
    const critiques = resultJson.critiques || [];
    return critiques.map(c => ({
      ...c,
      weaknesses: c.weaknesses || []
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
    4. If a claim is made, it should ideally be supported by one of the provided papers.
    
    Topic: ${topic}
    Hypothesis: ${hypothesis.title}
    
    Provided Literature (Grounded Context):
    ${papersContext}
    
    Contributions: ${contributions.map(c => c.description).join(", ")}
    Mathematical Formalization: ${math.problemFormulation}
    Algorithm: ${math.algorithmSteps.join(" -> ")}
    Experiment Plan: ${experimentPlan.protocol}
    Dataset: ${datasetCard.name} - ${datasetCard.description}
    Results: Accuracy ${result.accuracy.toFixed(2)}, F1 ${result.f1Score.toFixed(2)}
    Baselines: ${result.baselines.map(b => `${b.name} (${b.accuracy.toFixed(2)})`).join(", ")}
    Ablations: ${result.ablationStudies.map(a => `${a.componentRemoved} (-${a.impactOnMetric.toFixed(2)})`).join(", ")}
    Failure Cases: ${result.failureCases.map(f => f.example).join("; ")}
    Reviewer Feedback: ${critiques.map(c => c.weaknesses.join(", ")).join("; ")}
    
    You MUST include:
    1. A clear "Contributions" section in the Introduction.
    2. A "Mathematical Formalization" section with notation and algorithms.
    3. A "Dataset Card" section describing the data.
    4. A "Baseline Comparison" table/section with at least 2 baselines.
    5. An "Ablation Study" section.
    6. A "Failure Case Analysis" section with concrete examples.
    7. An "Implementation Details" section for reproducibility.
    
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
