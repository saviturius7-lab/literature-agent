import { XMLParser } from "fast-xml-parser";
import { 
  Paper, 
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
  GapIdentification
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
  async refineQuery(topic: string): Promise<string> {
    const prompt = `Convert the following research topic into an optimized search query for the arXiv API.
    The query should be concise and use relevant keywords. 
    Use boolean operators if necessary (AND, OR).
    Avoid stop words and conversational filler.
    
    Topic: "${topic}"
    
    Return a JSON object:
    {
      "refinedQuery": "optimized search query"
    }`;
    
    const result = await generateJSON<{ refinedQuery: string }>(prompt, "You are an expert research librarian specializing in academic search optimization.");
    return result.refinedQuery || topic;
  }
};

export const LiteratureAgent = {
  async fetchPapers(topic: string): Promise<Paper[]> {
    // First, refine the query
    const refinedQuery = await SearchQueryAgent.refineQuery(topic);
    console.log(`Refined query: "${refinedQuery}" for topic: "${topic}"`);
    
    const url = `/api/arxiv?q=${encodeURIComponent(refinedQuery)}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Proxy responded with status: ${response.status}`);
      }
      const xmlData = await response.text();
      const jsonObj = parser.parse(xmlData);
      
      if (!jsonObj || !jsonObj.feed) {
        console.warn("ArXiv response structure unexpected or empty. XML:", xmlData.slice(0, 500));
        return [];
      }
      
      const entries = jsonObj.feed.entry;
      if (!entries) {
        // If refined query failed, try the original topic as a fallback
        if (refinedQuery !== topic) {
          console.log("Refined query returned no results, falling back to original topic...");
          const fallbackUrl = `/api/arxiv?q=${encodeURIComponent(topic)}`;
          const fallbackResponse = await fetch(fallbackUrl);
          if (fallbackResponse.ok) {
            const fallbackXml = await fallbackResponse.text();
            const fallbackJson = parser.parse(fallbackXml);
            const fallbackEntries = fallbackJson?.feed?.entry;
            if (fallbackEntries) {
              return this.processEntries(fallbackEntries);
            }
          }
        }
        return [];
      }
      
      return this.processEntries(entries);
    } catch (error: any) {
      console.error("LiteratureAgent error:", error);
      throw new Error(`Research workflow error: ${error.message || "Failed to fetch from arXiv via proxy. Please try again."}`);
    }
  },

  processEntries(entries: any): Paper[] {
    const entryList = Array.isArray(entries) ? entries : [entries];
    
    return entryList.slice(0, 15).map((entry: any) => {
      const authors = Array.isArray(entry.author) 
        ? entry.author.map((a: any) => a.name) 
        : (entry.author ? [entry.author.name] : ["Unknown Author"]);
      const year = entry.published ? new Date(entry.published).getFullYear() : "n.d.";
      
      return {
        title: (entry.title || "Untitled").replace(/\n/g, " ").trim(),
        summary: (entry.summary || "No summary available").replace(/\n/g, " ").trim(),
        authors,
        published: entry.published || new Date().toISOString(),
        link: entry.id || "#",
        citation: `${authors.join(", ")} (${year}). ${(entry.title || "Untitled").trim()}. arXiv:${(entry.id || "").split('/').pop()}`
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
  async verify(papers: Paper[], topic: string): Promise<{ verifiedPapers: Paper[]; issues: string[] }> {
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
    const verifiedIndices = result.verifiedIndices || [];
    return {
      verifiedPapers: verifiedIndices.map(idx => papers[idx - 1]).filter(p => !!p),
      issues: result.issues || []
    };
  }
};

export const GapIdentificationAgent = {
  async identify(papers: Paper[], topic: string): Promise<GapIdentification> {
    const prompt = `Analyze the following research papers on "${topic}" and identify 3 critical research gaps.
    For each gap, provide evidence from the papers (refer to them as [1], [2], etc.) and explain the potential impact of addressing it.
    
    Papers:
    ${papers.map((p, i) => `[${i+1}] ${p.title}: ${p.summary}`).join("\n\n")}
    
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
    const papersContext = papers.map((p, i) => `Paper [${i+1}]: ${p.title}\nSummary: ${p.summary}`).join("\n\n");
    const prompt = `Based STRICTLY on the following research papers about "${topic}", propose a novel research hypothesis.
    Do NOT invent information that is not supported by or extrapolated from these specific papers.
    
    Papers:
    ${papersContext}
    
    ${feedback ? `PREVIOUS ATTEMPT FEEDBACK: ${feedback}\nPlease adjust your hypothesis to be more novel and distinct from existing work.` : ""}
    
    Return a JSON object with:
    {
      "title": "Hypothesis Title",
      "description": "Clear statement of the hypothesis",
      "rationale": "Why this hypothesis makes sense given the provided literature. Refer to specific papers by their index [1], [2], etc.",
      "expectedOutcome": "What we expect to see if the hypothesis is true"
    }`;
    
    return generateJSON<Hypothesis>(prompt, "You are a brilliant research scientist who values empirical grounding and avoids speculation.");
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
    const prompt = `Write an extensive, professional research report in the style of an arXiv preprint.
    
    CRITICAL INSTRUCTIONS:
    1. ONLY use the provided papers for citations. Do NOT invent any papers or citations.
    2. Every in-text citation like [1], [2] MUST correspond to the paper list provided below.
    3. Ensure the methodology and discussion are grounded in the provided literature.
    4. If a claim is made, it should ideally be supported by one of the provided papers.
    
    Topic: ${topic}
    Hypothesis: ${hypothesis.title}
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
    
    const reportResult = await generateJSON<ResearchReport>(prompt, "You are a world-class scientific researcher who adheres to the highest standards of academic integrity and grounding.");
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
