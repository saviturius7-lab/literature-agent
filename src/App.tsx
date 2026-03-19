import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Lightbulb, 
  FlaskConical, 
  ClipboardCheck, 
  FileText, 
  Loader2, 
  ChevronRight, 
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  BrainCircuit,
  Copy,
  Download,
  Printer,
  RefreshCw,
  BarChart as BarChartIcon,
  TrendingUp,
  PieChart as PieChartIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell,
  LineChart,
  Line
} from 'recharts';

import { vectorStore } from './services/vectorStore';
import { 
  Paper, 
  Hypothesis, 
  ExperimentResult, 
  Critique, 
  ResearchReport, 
  AgentStatus, 
  AppState,
  Contribution,
  MathFormalization,
  ExperimentPlan,
  DatasetCard,
  ReviewerCritique,
  Chunk
} from './types';
import { 
  TopicRefinementAgent,
  SearchQueryAgent,
  LiteratureAgent, 
  SelectionAgent,
  CitationVerificationAgent,
  GapIdentificationAgent,
  HypothesisAgent, 
  NoveltyCheckerAgent,
  ContributionAgent,
  MathFormalizerAgent,
  ExperimentDesignAgent,
  DatasetGeneratorAgent,
  ExperimentRunner, 
  ResultValidationAgent,
  ReviewerSimulatorAgent,
  RevisionAgent,
  ReportAgent,
  TopicRelevanceAgent,
  VerificationAgent,
  FactualityEvalAgent,
  KeyFindingsAgent
} from './services/agents';
import { getGeminiStatus } from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [state, setState] = useState<AppState>({
    status: 'idle',
    topic: '',
    papers: [],
    gapIdentification: null,
    hypothesis: null,
    contributions: [],
    mathFormalization: null,
    experimentPlan: null,
    datasetCard: null,
    experiment: null,
    reviewerCritiques: [],
    report: null,
    factualityResult: null,
    error: null,
    iteration: 0,
  });

  const [inputTopic, setInputTopic] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [searchingProgress, setSearchingProgress] = useState('');
  const [geminiStatus, setGeminiStatus] = useState(getGeminiStatus());
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setGeminiStatus(getGeminiStatus());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const runResearch = async () => {
    if (!inputTopic.trim()) return;

    let currentIteration = 1;
    const MAX_ITERATIONS = 3;
    let isReliable = false;

    setState(prev => ({ 
      ...prev, 
      status: 'refining_topic', 
      topic: inputTopic,
      error: null,
      papers: [],
      gapIdentification: null,
      hypothesis: null,
      contributions: [],
      mathFormalization: null,
      experimentPlan: null,
      datasetCard: null,
      experiment: null,
      reviewerCritiques: [],
      report: null,
      iteration: currentIteration
    }));
    setSearchingProgress('');

    try {
      // Small delay between steps to avoid hitting rate limits
      const stepDelay = (ms = 1500) => new Promise(resolve => setTimeout(resolve, ms));

      // Clear vector store for new research
      vectorStore.clear();

      // 1. Topic Selection (Refinement)
      const refinedTopic = await TopicRefinementAgent.refine(inputTopic);
      setState(prev => ({ ...prev, topic: refinedTopic }));
      await stepDelay();

      while (!isReliable && currentIteration <= MAX_ITERATIONS) {
        setState(prev => ({ ...prev, iteration: currentIteration, status: 'searching' }));
        setSearchingProgress('Initializing literature search...');

        // 2. Literature Retrieval (REAL papers only)
        let rawPapers = await LiteratureAgent.fetchPapers(refinedTopic, (msg) => setSearchingProgress(msg));
        await stepDelay();
        
        // If no papers found, try a broader search immediately
        if (rawPapers.length === 0) {
          console.log("No papers found with refined topic, trying original input...");
          setSearchingProgress('No papers found for refined topic. Trying original input...');
          rawPapers = await LiteratureAgent.fetchPapers(inputTopic, (msg) => setSearchingProgress(msg));
          await stepDelay();
        }

        if (rawPapers.length === 0) {
          throw new Error(`No papers found for "${refinedTopic}" or "${inputTopic}" on arXiv. This can happen if the topic is too niche or the search query is too specific. Try a broader research topic.`);
        }

        // 2a. Topic Relevance Agent
        setState(prev => ({ ...prev, status: 'filtering_relevance' }));
        const relevantPapers = await TopicRelevanceAgent.filterRelevantPapers(refinedTopic, rawPapers);
        await stepDelay();
        
        // 3. Citation Verification
        setState(prev => ({ ...prev, status: 'verifying_citations' }));
        setSearchingProgress('Verifying citations against real-world databases...');
        const { verifiedPapers, issues } = await CitationVerificationAgent.verify(relevantPapers.length > 0 ? relevantPapers : rawPapers, refinedTopic, (msg) => setSearchingProgress(msg));
        await stepDelay();
        
        // Enrich with key findings (batch enrichment)
        setState(prev => ({ ...prev, status: 'extracting_findings' }));
        const enrichedPapers = await KeyFindingsAgent.extract(verifiedPapers);
        await stepDelay();
        
        // We keep all papers in the state for visibility, but only use verified ones for the pipeline
        const trulyVerified = verifiedPapers.filter(p => p.verified !== false);
        
        if (trulyVerified.length === 0) {
          // If no papers verified, and we haven't tried a broad fallback yet, try one more time
          if (currentIteration === 1) {
            console.warn("No papers verified. Retrying with broad search...");
            const broadKeywords = await SearchQueryAgent.getBroadKeywords(refinedTopic);
            await stepDelay();
            const broadPapers = await LiteratureAgent.executeSearch(broadKeywords.join(" "));
            await stepDelay();
            const broadVerified = await CitationVerificationAgent.verify(broadPapers, refinedTopic);
            await stepDelay();
            const broadTrulyVerified = broadVerified.verifiedPapers.filter(p => p.verified !== false);
            
            if (broadTrulyVerified.length > 0) {
              verifiedPapers.push(...broadVerified.verifiedPapers);
              trulyVerified.push(...broadTrulyVerified);
            }
          }
        }

        if (trulyVerified.length === 0) {
          throw new Error(`Citation verification failed: No papers could be verified in real-world databases. Issues: ${issues.join(", ")}`);
        }

        // Add verified chunks to vector store for RAG
        const allChunks: Chunk[] = [];
        trulyVerified.forEach(p => {
          if (p.chunks) allChunks.push(...p.chunks);
        });
        if (allChunks.length > 0) {
          await vectorStore.addDocuments(allChunks.map(c => ({
            id: `${c.source}-${c.metadata.index}`,
            text: c.text,
            metadata: { ...c.metadata, source: c.source }
          })));
        }

        // 3b. Selection Agent
        const papers = await SelectionAgent.selectPapers(refinedTopic, trulyVerified);
        await stepDelay();
        // We set the state to all enrichedPapers (including flagged ones) for the UI
        setState(prev => ({ ...prev, status: 'identifying_gaps', papers: enrichedPapers }));

        // 4. Gap Identification
        // But we only use the selected (verified) papers for the next steps
        const gapIdentification = await GapIdentificationAgent.identify(papers, refinedTopic);
        await stepDelay();
        setState(prev => ({ ...prev, status: 'hypothesizing', gapIdentification }));

        // 5. Hypothesis Generation
        let hypothesis = await HypothesisAgent.generateHypothesis(refinedTopic, papers);
        await stepDelay();
        
        // 5b. Novelty Checker (Loop up to 5 times)
        let noveltyAttempts = 0;
        const MAX_NOVELTY_ATTEMPTS = 5;
        let isNovel = false;
        let noveltyFeedback = "";
        while (!isNovel && noveltyAttempts < MAX_NOVELTY_ATTEMPTS) {
          setState(prev => ({ ...prev, status: 'checking_novelty', hypothesis }));
          const novelty = await NoveltyCheckerAgent.checkNovelty(hypothesis, papers, noveltyAttempts);
          await stepDelay();
          isNovel = novelty.isNovel;
          noveltyFeedback = novelty.feedback || "";
          
          if (!isNovel) {
            console.log(`Hypothesis not novel enough (Attempt ${noveltyAttempts + 1}), regenerating...`);
            hypothesis = await HypothesisAgent.generateHypothesis(refinedTopic, papers, noveltyFeedback);
            await stepDelay();
            noveltyAttempts++;
          }
        }

        if (!isNovel) {
          throw new Error(`Failed to generate a sufficiently novel hypothesis after ${MAX_NOVELTY_ATTEMPTS} attempts.`);
        }

        // 5c. Contribution Agent
        setState(prev => ({ ...prev, status: 'extracting_contributions', hypothesis }));
        const contributions = await ContributionAgent.extractContributions(hypothesis);
        await stepDelay();
        setState(prev => ({ ...prev, contributions }));

        // 5d. Math Formalizer
        setState(prev => ({ ...prev, status: 'formalizing_math' }));
        const mathFormalization = await MathFormalizerAgent.formalize(hypothesis);
        await stepDelay();
        setState(prev => ({ ...prev, mathFormalization }));

        // 6. Experiment Design (constrained)
        setState(prev => ({ ...prev, status: 'designing_experiment' }));
        const experimentPlan = await ExperimentDesignAgent.design(hypothesis, contributions);
        await stepDelay();
        setState(prev => ({ ...prev, experimentPlan }));

        // 6b. Dataset Generator
        setState(prev => ({ ...prev, status: 'generating_dataset' }));
        const datasetCard = await DatasetGeneratorAgent.generate(experimentPlan);
        await stepDelay();
        setState(prev => ({ ...prev, datasetCard }));

        // 7. Execution / simulation with limits
        setState(prev => ({ ...prev, status: 'experimenting' }));
        const experiment = await ExperimentRunner.runExperiment(hypothesis, experimentPlan);
        await stepDelay();
        setState(prev => ({ ...prev, experiment }));

        // 8. Result Validation
        setState(prev => ({ ...prev, status: 'validating_results' }));
        const validationResult = await ResultValidationAgent.validate(hypothesis, experiment);
        await stepDelay();
        
        // 8b. Reviewer Simulator
        setState(prev => ({ ...prev, status: 'reviewing' }));
        const reviewerCritiques = await ReviewerSimulatorAgent.simulate(hypothesis, experiment);
        await stepDelay();
        setState(prev => ({ ...prev, reviewerCritiques }));

        // Check reliability (average rating > 7 AND result validation passed)
        const avgRating = reviewerCritiques.reduce((acc, c) => acc + c.rating, 0) / reviewerCritiques.length;
        isReliable = avgRating >= 7 && validationResult.isValid;
        
        if (!isReliable && currentIteration < MAX_ITERATIONS) {
          console.log(`Iteration ${currentIteration} unreliable (Rating: ${avgRating.toFixed(1)}, Valid: ${validationResult.isValid}). Revising...`);
          
          // Update hypothesis and experiment with revised versions
          setState(prev => ({ ...prev, status: 'revising' }));
          const revision = await RevisionAgent.revise(hypothesis, experiment, reviewerCritiques);
          await stepDelay();
          
          // Update hypothesis and experiment with revised versions
          hypothesis = revision.revisedHypothesis;
          const revisedExperiment = revision.revisedResult;
          
          currentIteration++;
          setState(prev => ({ 
            ...prev, 
            hypothesis, 
            experiment: revisedExperiment 
          }));
          
          await new Promise(resolve => setTimeout(resolve, 4000));
          continue;
        }

        setState(prev => ({ ...prev, status: 'reporting' }));

        // 9. Writing (last step)
        const report = await ReportAgent.generateReport(
          refinedTopic, 
          papers, 
          hypothesis, 
          contributions,
          mathFormalization,
          experimentPlan,
          datasetCard,
          experiment, 
          reviewerCritiques
        );
        await stepDelay();

        // 6. Verification Agent
        setState(prev => ({ ...prev, status: 'verifying_report', report }));
        const verification = await VerificationAgent.verifyReport(report, papers);
        
        // 7. Factuality Evaluation (Judge LLM)
        const factualityResult = await FactualityEvalAgent.evaluate(report, papers);
        
        if (!verification.isValid || !factualityResult.isPassed) {
          console.warn("Report verification or factuality evaluation failed:", verification.issues, factualityResult.unsupportedClaims);
          
          if (currentIteration < MAX_ITERATIONS) {
             console.log("Retrying iteration due to verification/factuality failure...");
             currentIteration++;
             continue;
          }
        }

        setState(prev => ({ 
          ...prev, 
          status: 'completed', 
          report,
          factualityResult
        }));
        break;
      }

      if (!isReliable && currentIteration > MAX_ITERATIONS) {
        setState(prev => ({ ...prev, status: 'completed', error: "Max iterations reached without achieving full reliability. Final report generated based on best attempt." }));
      }

    } catch (err: any) {
      console.error("Research workflow error:", err);
      setState(prev => ({ ...prev, status: 'error', error: err.message }));
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const exportMarkdown = () => {
    if (!state.report) return;
    
    const content = `
# Research Report: ${state.topic}
Generated by Literature Agent

## Abstract
${state.report.abstract}

## Introduction
${state.report.introduction}

## Methodology
${state.report.methodology}

${state.datasetCard ? `
## Dataset Description
- **Name**: ${state.datasetCard.name}
- **Size**: ${state.datasetCard.size}
- **Source**: ${state.datasetCard.source}
- **Description**: ${state.datasetCard.description}
- **Features**: ${state.datasetCard.features.join(', ')}
` : ''}

## Results
${state.report.results}

${state.experiment ? `
## Experimental Evidence (Logs)
\`\`\`
${state.experiment.logs.join('\n')}
\`\`\`

## Implementation Details
${state.experiment.implementationDetails}
` : ''}

## Discussion
${state.report.discussion}

## Conclusion
${state.report.conclusion}

---
## References
${(state.report.references || []).map(ref => `- ${ref}`).join('\n')}
    `.trim();

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research_report_${state.topic.replace(/\s+/g, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    if (!reportRef.current) return;

    const element = reportRef.current;
    const opt = {
      margin: 1,
      filename: `research_report_${state.topic.replace(/\s+/g, '_').toLowerCase()}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  const steps = [
    { id: 'refining_topic', label: 'Topic Selection', icon: Search },
    { id: 'searching', label: 'Literature Retrieval', icon: Search },
    { id: 'verifying_citations', label: 'Citation Verification', icon: ClipboardCheck },
    { id: 'extracting_findings', label: 'Key Findings', icon: Lightbulb },
    { id: 'identifying_gaps', label: 'Gap Identification', icon: Lightbulb },
    { id: 'hypothesizing', label: 'Hypothesis Generation', icon: Lightbulb },
    { id: 'designing_experiment', label: 'Experiment Design', icon: BrainCircuit },
    { id: 'experimenting', label: 'Execution', icon: FlaskConical },
    { id: 'validating_results', label: 'Result Validation', icon: ClipboardCheck },
    { id: 'reporting', label: 'Writing', icon: FileText },
  ];

  const currentStepIndex = steps.findIndex(s => {
    if (state.status === 'filtering_relevance') return s.id === 'searching';
    if (state.status === 'extracting_findings') return s.id === 'extracting_findings';
    if (state.status === 'checking_novelty' || state.status === 'extracting_contributions') return s.id === 'hypothesizing';
    if (state.status === 'formalizing_math' || state.status === 'generating_dataset') return s.id === 'designing_experiment';
    if (state.status === 'reviewing' || state.status === 'revising') return s.id === 'validating_results';
    if (state.status === 'verifying_report') return s.id === 'reporting';
    return s.id === state.status;
  });
  const isCompleted = state.status === 'completed';

  return (
    <div className="min-h-screen bg-dark-bg text-pink-pale font-sans selection:bg-pink-deep selection:text-white">
      {/* Header */}
      <header className="border-b border-pink-pale/10 bg-dark-surface/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-pink-deep rounded-lg flex items-center justify-center">
              <BrainCircuit className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight italic serif">Literature Agent</h1>
          </div>
          
            <div className="flex items-center gap-4">
              {state.iteration > 0 && (
                <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-pink-deep/10 border border-pink-deep/20 rounded-full">
                  <RefreshCw className={cn("w-3 h-3 text-pink-deep", state.status !== 'completed' && "animate-spin")} />
                  <span className="text-[10px] font-bold text-pink-deep uppercase tracking-wider">Iter: {state.iteration}</span>
                </div>
              )}
              <div className="relative">
              <input 
                type="text"
                value={inputTopic}
                onChange={(e) => setInputTopic(e.target.value)}
                placeholder="Enter research topic..."
                className="w-64 md:w-96 px-4 py-2 bg-dark-bg border border-pink-pale/10 focus:border-pink-deep/40 focus:bg-dark-surface rounded-full text-sm transition-all outline-none placeholder:text-pink-pale/20"
                onKeyDown={(e) => e.key === 'Enter' && runResearch()}
                disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
              />
              <button 
                onClick={runResearch}
                disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                className="absolute right-1 top-1 bottom-1 px-4 bg-pink-deep text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-pink-deep/90 transition-colors disabled:opacity-50"
              >
                {state.status === 'idle' || isCompleted || state.status === 'error' ? 'Start' : 'Running...'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Progress Tracker */}
        <div className="mb-16">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-pink-pale/10 -translate-y-1/2 z-0" />
            {(steps || []).map((step, idx) => {
              const Icon = step.icon;
              const isActive = state.status === step.id;
              const isPast = currentStepIndex > idx || isCompleted;
              
              return (
                <div key={step.id} className="relative z-10 flex flex-col items-center gap-3">
                  <div className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 border-2",
                    isActive ? "bg-pink-deep border-pink-deep text-white scale-110 shadow-lg shadow-pink-deep/20" : 
                    isPast ? "bg-dark-bg border-pink-deep text-pink-deep" : 
                    "bg-dark-bg border-pink-pale/10 text-pink-pale/20"
                  )}>
                    {isPast ? <CheckCircle2 className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
                  </div>
                  <span className={cn(
                    "text-[10px] uppercase tracking-widest font-bold transition-colors",
                    isActive ? "text-pink-pale" : "text-pink-pale/40"
                  )}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Logs & Status */}
          <div className="lg:col-span-4 space-y-8">
            <div className="bg-dark-surface border border-pink-pale/10 rounded-2xl p-6 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-widest text-pink-pale/40 mb-4">Agent Status</h2>
              <div className="space-y-4">
                {state.status === 'idle' && (
                  <p className="text-sm text-pink-pale/60 italic">Enter a topic to begin the multi-agent research workflow.</p>
                )}
                {state.status !== 'idle' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      {state.status !== 'completed' && state.status !== 'error' && (
                        <Loader2 className="w-4 h-4 animate-spin text-pink-deep" />
                      )}
                      <span className="text-sm font-medium capitalize">
                        {state.status.replace('-', ' ')}...
                      </span>
                    </div>
                    {state.status === 'searching' && searchingProgress && (
                      <p className="text-[10px] text-pink-pale/60 italic pl-7 animate-pulse">
                        {searchingProgress}
                      </p>
                    )}
                    
                    {/* Gemini Status Overlay */}
                    {geminiStatus.total > 0 && (
                      <div className="pl-7 pt-2 border-t border-pink-pale/5 mt-2">
                        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider mb-1">
                          <span className="text-pink-pale/40">API Status</span>
                          <span className={cn(
                            "font-bold",
                            geminiStatus.available > 0 ? "text-emerald-500" : "text-amber-500"
                          )}>
                            {geminiStatus.available} / {geminiStatus.total} Keys Available
                          </span>
                        </div>
                        {geminiStatus.coolingDown > 0 && (
                          <p className="text-[8px] text-amber-500/80 italic">
                            {geminiStatus.coolingDown} keys waiting for quota reset...
                          </p>
                        )}
                        {geminiStatus.totalRetries > 0 && (
                          <p className="text-[8px] text-pink-pale/30">
                            Total API Retries: {geminiStatus.totalRetries}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {state.error && (
                  <div className="p-4 bg-pink-deep/10 border border-pink-deep/20 rounded-xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-3 items-start">
                      <AlertCircle className="w-4 h-4 text-pink-deep shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-pink-deep mb-1">Error Occurred</p>
                        <p className="text-xs text-pink-pale/80 leading-relaxed">{state.error}</p>
                      </div>
                    </div>
                    {(state.error.includes("API key") || state.error.includes("PERMISSION_DENIED") || state.error.includes("Balance") || state.error.includes("Unauthorized") || state.error.includes("RESOURCE_EXHAUSTED") || state.error.includes("429") || state.error.includes("quota")) && (
                      <div className="p-3 bg-dark-bg/50 rounded-lg border border-pink-deep/10">
                        <p className="text-[9px] text-pink-deep font-bold uppercase tracking-wider mb-1">Troubleshooting Advice:</p>
                        <p className="text-[10px] text-pink-pale/60 leading-relaxed">
                          It looks like there's an issue with your API keys, account balance, or rate limits. 
                          The app is automatically rotating through your keys, but you may need to:
                        </p>
                        <ul className="text-[10px] text-pink-pale/40 mt-2 list-disc list-inside space-y-1">
                          <li>Ensure <strong>VITE_GEMINI_API_KEY_1</strong> (up to 32) are valid and have billing enabled if using paid tiers.</li>
                          <li>Add more keys to your rotation (up to 32) to bypass free-tier rate limits.</li>
                          <li>If using the free tier, the "Pro" model used for factuality evaluation is limited to 2 requests per minute.</li>
                          <li>Wait a few minutes for your quota to reset.</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {state.experiment && (
              <div className="bg-dark-surface border border-pink-pale/10 text-pink-pale rounded-2xl p-6 shadow-xl overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <FlaskConical className="w-24 h-24 text-pink-deep" />
                </div>
                <div className="flex items-center gap-2 mb-6">
                  <BarChartIcon className="w-4 h-4 text-pink-deep" />
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">Experimental Results</h2>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div className="p-4 bg-dark-bg/50 rounded-xl border border-pink-pale/5">
                    <div className="text-3xl font-light mb-1 text-pink-deep">{(state.experiment.accuracy * 100).toFixed(1)}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-pink-pale/40">Accuracy</div>
                  </div>
                  <div className="p-4 bg-dark-bg/50 rounded-xl border border-pink-pale/5">
                    <div className="text-3xl font-light mb-1 text-pink-deep">{(state.experiment.f1Score * 100).toFixed(1)}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-pink-pale/40">F1 Score</div>
                  </div>
                </div>

                {/* Performance Comparison Chart */}
                <div className="mb-8 h-64 w-full">
                  <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-4 flex items-center gap-2">
                    <TrendingUp className="w-3 h-3" />
                    Performance vs Baselines
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                        ...(state.experiment.baselines || []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                      ]}
                      margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#f5f2ed40" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#f5f2ed40" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false}
                        domain={[0, 100]}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #f5f2ed10', borderRadius: '8px', fontSize: '10px' }}
                        itemStyle={{ color: '#FF6321' }}
                      />
                      <Bar dataKey="accuracy" radius={[4, 4, 0, 0]}>
                        {(
                          [
                            { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                            ...(state.experiment.baselines || []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                          ]
                        ).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#FF6321' : '#f5f2ed20'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {state.experiment.ablationStudies && state.experiment.ablationStudies.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40 mb-4 flex items-center gap-2">
                      <PieChartIcon className="w-3 h-3" />
                      Ablation Impact
                    </h3>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={(state.experiment.ablationStudies || []).map(a => ({
                            name: a.componentRemoved,
                            impact: a.impactOnMetric * 100
                          }))}
                          margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                          <XAxis type="number" hide />
                          <YAxis 
                            dataKey="name" 
                            type="category" 
                            stroke="#f5f2ed40" 
                            fontSize={9} 
                            tickLine={false} 
                            axisLine={false}
                            width={80}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #f5f2ed10', borderRadius: '8px', fontSize: '10px' }}
                          />
                          <Bar dataKey="impact" fill="#FF6321" radius={[0, 4, 4, 0]} barSize={12} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {state.reviewerCritiques && state.reviewerCritiques.length > 0 && (
                  <div className="mb-8 pt-6 border-t border-pink-pale/10">
                    <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40 mb-4">Reviewer Ratings</h3>
                    <div className="h-32 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={state.reviewerCritiques.map((c, i) => ({
                            name: `R${i+1}`,
                            rating: c.rating
                          }))}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                          <XAxis dataKey="name" stroke="#f5f2ed40" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#f5f2ed40" fontSize={10} tickLine={false} axisLine={false} domain={[0, 10]} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #f5f2ed10', borderRadius: '8px', fontSize: '10px' }}
                          />
                          <Line type="monotone" dataKey="rating" stroke="#FF6321" strokeWidth={2} dot={{ fill: '#FF6321', r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <div className="pt-6 border-t border-pink-pale/10">
                  <div className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-3">Execution Logs</div>
                  <div className="space-y-2 font-mono text-[10px] text-pink-pale/60 max-h-40 overflow-y-auto custom-scrollbar">
                    {(state.experiment.logs || []).map((log, i) => (
                      <div key={`log-${i}`} className="flex gap-2">
                        <span className="text-pink-deep/40">[{i+1}]</span>
                        <span>{log}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8 space-y-12">
            <AnimatePresence mode="wait">
              {/* Literature Results */}
              {state.papers.length > 0 && (
                <motion.section 
                  key="literature-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <h2 className="text-2xl font-serif italic">Literature Review</h2>
                      {state.status !== 'searching' && state.status !== 'filtering_relevance' && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-bold text-emerald-400 uppercase tracking-widest">
                          <ClipboardCheck className="w-3 h-3" />
                          Citations Verified
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">LiteratureAgent</span>
                  </div>
                  <div className="space-y-4">
                    {(state.papers || []).map((paper, i) => (
                      <div key={`${paper.link}-${i}`} className="group p-6 bg-dark-surface border border-pink-pale/10 rounded-2xl hover:border-pink-deep/30 transition-all">
                        {paper.verified === false ? (
                          <div className="flex items-center gap-1 text-[9px] font-bold text-amber-500 uppercase tracking-widest mb-2">
                            <AlertCircle className="w-3 h-3" />
                            Unverified Citation
                          </div>
                        ) : paper.verified === true ? (
                          <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-2">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified Citation
                          </div>
                        ) : null}
                        <div className="flex justify-between items-start gap-4 mb-3">
                          <h3 className="font-semibold text-lg leading-tight group-hover:text-pink-deep transition-colors">
                            {paper.title}
                          </h3>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => copyToClipboard(paper.citation, i)}
                              className="text-pink-pale/40 hover:text-pink-deep transition-colors p-1"
                              title="Copy Citation"
                            >
                              {copiedIndex === i ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <a href={paper.link} target="_blank" rel="noreferrer" className="text-pink-pale/40 hover:text-pink-deep p-1">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        </div>
                        <p className="text-sm text-pink-pale/60 line-clamp-3 mb-4 leading-relaxed">{paper.summary}</p>
                        
                        {paper.keyFindings && paper.keyFindings.length > 0 && (
                          <div className="mb-4 space-y-2">
                            <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep/60 mb-2">Key Findings</div>
                            <div className="grid grid-cols-1 gap-2">
                              {paper.keyFindings.map((finding, idx) => (
                                <div key={`finding-${idx}`} className="flex items-start gap-2 p-2 bg-pink-deep/5 border border-pink-deep/10 rounded-lg">
                                  <div className="w-1 h-1 rounded-full bg-pink-deep mt-1.5 shrink-0" />
                                  <p className="text-[11px] text-pink-pale/80 italic serif leading-relaxed">{finding}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mb-4 p-3 bg-dark-bg rounded-xl">
                          <div className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/20 mb-1">Citation</div>
                          <div className="text-[11px] text-pink-pale/40 font-mono leading-relaxed">{paper.citation}</div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {(paper.authors || []).slice(0, 3).map((author, j) => (
                            <span key={`${paper.link}-auth-${i}-${j}`} className="text-[10px] px-2 py-1 bg-dark-bg rounded-md text-pink-pale/40 font-medium uppercase tracking-wider">
                              {author}
                            </span>
                          ))}
                          {(paper.authors || []).length > 3 && (
                            <span className="text-[10px] px-2 py-1 text-pink-pale/20 font-medium italic">
                              + {paper.authors.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Gap Identification */}
              {state.gapIdentification && (
                <motion.section 
                  key="gap-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 pt-12 border-t border-pink-pale/10"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-serif italic">Research Gap Analysis</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">GapIdentificationAgent</span>
                  </div>
                  <div className="bg-dark-surface border border-pink-pale/10 p-8 rounded-3xl">
                    <p className="text-sm text-pink-pale/60 italic mb-8 leading-relaxed">
                      {state.gapIdentification.summary}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {(state.gapIdentification.gaps || []).map((gap, i) => (
                        <div key={`gap-${i}`} className="p-6 bg-dark-bg rounded-2xl border border-pink-pale/5 hover:border-pink-deep/20 transition-all">
                          <div className="w-8 h-8 bg-pink-deep/10 rounded-lg flex items-center justify-center mb-4">
                            <span className="text-pink-deep font-bold text-xs">{i+1}</span>
                          </div>
                          <h4 className="text-xs font-bold text-pink-pale mb-2 leading-tight">{gap.description}</h4>
                          <div className="space-y-3">
                            <div>
                              <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep/40 mb-1">Evidence</div>
                              <p className="text-[10px] text-pink-pale/40 italic">{gap.evidence}</p>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep/40 mb-1">Potential Impact</div>
                              <p className="text-[10px] text-pink-pale/60">{gap.potentialImpact}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.section>
              )}

              {/* Hypothesis & Contributions */}
              {state.hypothesis && (
                <motion.section 
                  key="hypothesis-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 pt-12 border-t border-pink-pale/10"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-serif italic">Proposed Hypothesis</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">HypothesisAgent</span>
                  </div>
                  <div className="bg-dark-surface border border-pink-pale/10 text-pink-pale p-8 rounded-3xl shadow-2xl">
                    <h3 className="text-xl font-medium mb-4 text-pink-deep">{state.hypothesis.title}</h3>
                    <p className="text-pink-pale/80 leading-relaxed mb-8">{state.hypothesis.description}</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-2">Rationale</h4>
                        <p className="text-sm text-pink-pale/60 leading-relaxed">{state.hypothesis.rationale}</p>
                      </div>
                      <div>
                        <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-2">Expected Outcome</h4>
                        <p className="text-sm text-pink-pale/60 leading-relaxed">{state.hypothesis.expectedOutcome}</p>
                      </div>
                    </div>

                    {state.contributions.length > 0 && (
                      <div className="mt-8 pt-8 border-t border-pink-pale/10">
                        <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-4">Key Contributions</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {(state.contributions || []).map((c, i) => (
                            <div key={`contribution-${i}`} className="p-4 bg-dark-bg rounded-xl border border-pink-pale/5">
                              <div className="text-xs font-bold text-pink-deep mb-1">{c.type}</div>
                              <p className="text-xs text-pink-pale/60">{c.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.section>
              )}

              {/* Math Formalization */}
              {state.mathFormalization && (
                <motion.section 
                  key="math-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 pt-12 border-t border-pink-pale/10"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-serif italic">Mathematical Formalization</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">MathFormalizerAgent</span>
                  </div>
                  <div className="bg-dark-surface border border-pink-pale/10 p-8 rounded-3xl">
                    <div className="space-y-8">
                      <div>
                        <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-3">Problem Formulation</h4>
                        <p className="text-sm text-pink-pale/70 leading-relaxed">{state.mathFormalization.problemFormulation}</p>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                          <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-3">Notation</h4>
                          <div className="space-y-2">
                            {(state.mathFormalization.notation || []).map((n, i) => (
                              <div key={`notation-${i}`} className="flex gap-3 text-xs">
                                <code className="text-pink-deep font-mono bg-dark-bg px-1.5 rounded">{n.symbol}</code>
                                <span className="text-pink-pale/60">{n.definition}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-3">Objective Function</h4>
                          <div className="p-4 bg-dark-bg rounded-xl font-mono text-xs text-pink-deep overflow-x-auto">
                            {state.mathFormalization.objectiveFunction}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-3">Algorithm Steps</h4>
                        <div className="space-y-3">
                          {(state.mathFormalization.algorithmSteps || []).map((step, i) => (
                            <div key={`algo-${i}`} className="flex gap-4 items-start">
                              <span className="text-pink-deep font-mono text-xs mt-0.5">{i+1}.</span>
                              <p className="text-sm text-pink-pale/70">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.section>
              )}

              {/* Experiment Plan & Dataset Card */}
              {state.experimentPlan && (
                <motion.section 
                  key="plan-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 pt-12 border-t border-pink-pale/10"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-serif italic">Experimental Design</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">ExperimentDesignAgent</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-dark-surface border border-pink-pale/10 p-6 rounded-2xl">
                      <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-4">Protocol & Metrics</h4>
                      <div className="space-y-4">
                        <div>
                          <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-1">Evaluation Protocol</div>
                          <p className="text-xs text-pink-pale/70">{state.experimentPlan.protocol}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(state.experimentPlan.metrics || []).map((m, i) => (
                            <span key={`metric-${i}`} className="px-2 py-1 bg-dark-bg rounded text-[10px] text-pink-pale/60 border border-pink-pale/5">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {state.datasetCard && (
                      <div className="bg-dark-surface border border-pink-pale/10 p-6 rounded-2xl">
                        <h4 className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-4">Dataset Card</h4>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-pink-deep">{state.datasetCard.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-pink-deep/10 text-pink-deep rounded border border-pink-deep/20 uppercase">{state.datasetCard.size}</span>
                          </div>
                          <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-1">Description</div>
                          <p className="text-[11px] text-pink-pale/60 leading-relaxed">{state.datasetCard.description}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(state.datasetCard.features || []).map((f, i) => (
                              <span key={`feature-${i}`} className="text-[9px] text-pink-pale/40 font-mono">#{f}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.section>
              )}

              {/* Reviewer Critiques */}
              {state.reviewerCritiques.length > 0 && (
                <motion.section 
                  key={`critique-section-${state.iteration}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 pt-12 border-t border-pink-pale/10"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-serif italic">Simulated Peer Review</h2>
                      <span className="text-[10px] text-pink-pale/40 font-mono">(Iteration {state.iteration})</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">ReviewerSimulatorAgent</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {(state.reviewerCritiques || []).map((critique, i) => (
                      <div key={`reviewer-${i}`} className="p-6 bg-dark-surface border border-pink-pale/10 rounded-2xl flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">Reviewer #{i+1}</span>
                          <div className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold border",
                            critique.rating >= 7 ? "bg-emerald-900/30 text-emerald-400 border-emerald-500/20" :
                            critique.rating >= 5 ? "bg-amber-900/30 text-amber-400 border-amber-500/20" :
                            "bg-pink-900/30 text-pink-400 border-pink-500/20"
                          )}>
                            Score: {critique.rating}/10
                          </div>
                        </div>
                        
                        <div className="space-y-4 flex-1">
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-1">Weaknesses</div>
                            <ul className="space-y-1">
                              {(critique.weaknesses || []).map((w, j) => (
                                <li key={`w-${i}-${j}`} className="text-[11px] text-pink-pale/60 flex gap-1.5">
                                  <span className="text-pink-deep opacity-50">•</span> {w}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-1">Novelty Check</div>
                            <p className="text-[11px] text-pink-pale/60 italic leading-relaxed">"{critique.noveltyCritique}"</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Final Report */}
              {state.report && (
                <motion.section 
                  key="report-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8 pt-12 border-t border-[#1A1A1A]/10"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <h2 className="text-3xl font-serif italic">Research Report</h2>
                      {state.factualityResult && (
                        <div className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold border flex items-center gap-2",
                          state.factualityResult.isPassed ? "bg-emerald-900/30 text-emerald-400 border-emerald-500/20" : "bg-pink-900/30 text-pink-400 border-pink-500/20"
                        )}>
                          <ClipboardCheck className="w-3 h-3" />
                          Factuality Score: {(state.factualityResult.faithfulnessScore * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">ReportAgent</span>
                  </div>
                  
                  {state.factualityResult && !state.factualityResult.isPassed && (
                    <div className="p-4 bg-pink-900/20 border border-pink-500/20 rounded-2xl flex gap-4 items-start">
                      <AlertCircle className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />
                      <div className="space-y-2">
                        <h4 className="text-sm font-bold text-pink-400">Factuality Warning</h4>
                        <p className="text-xs text-pink-pale/60">The Judge LLM identified {state.factualityResult.unsupportedClaims.length} potentially unsupported claims in this report. Please review with caution.</p>
                        <ul className="space-y-1">
                          {state.factualityResult.unsupportedClaims.map((claim, i) => (
                            <li key={`unsupported-${i}`} className="text-[10px] text-pink-pale/40 italic">
                              • "{claim.claim}" — <span className="text-pink-deep/60">{claim.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  
                  <div ref={reportRef} className="prose prose-sm max-w-none space-y-8 bg-dark-surface p-8 rounded-3xl border border-pink-pale/10">
                    <div className="text-center mb-12">
                      <h1 className="text-4xl font-serif italic mb-2 text-pink-deep">{state.topic}</h1>
                      <p className="text-xs uppercase tracking-widest text-pink-pale/40">Generated by Literature Agent • {new Date().toLocaleDateString()}</p>
                    </div>

                    <div className="bg-dark-bg p-8 rounded-2xl border border-pink-pale/5">
                      <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Abstract</h3>
                      <p className="text-lg leading-relaxed font-serif italic text-pink-pale/80">{state.report.abstract}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <section>
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 border-b border-pink-pale/10 pb-2 text-pink-deep">Introduction</h3>
                        <div className="text-sm leading-relaxed text-pink-pale/70 prose-invert"><Markdown>{state.report.introduction}</Markdown></div>
                      </section>
                      <section>
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 border-b border-pink-pale/10 pb-2 text-pink-deep">Methodology</h3>
                        <div className="text-sm leading-relaxed text-pink-pale/70 prose-invert"><Markdown>{state.report.methodology}</Markdown></div>
                      </section>
                    </div>

                    <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                      <h3 className="text-xs uppercase tracking-widest font-bold mb-6 text-center text-pink-deep">Experimental Results</h3>
                      <div className="text-sm leading-relaxed text-pink-pale/70 prose-invert"><Markdown>{state.report.results}</Markdown></div>
                    </section>

                    {state.datasetCard && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Dataset Description</h3>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-pink-deep">{state.datasetCard.name}</span>
                            <span className="text-[10px] px-2 py-1 bg-pink-deep/10 text-pink-deep rounded border border-pink-deep/20 uppercase">{state.datasetCard.size}</span>
                          </div>
                          <p className="text-sm text-pink-pale/70 leading-relaxed italic">{state.datasetCard.description}</p>
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-pink-deep/40 uppercase tracking-widest font-bold block mb-1">Source</span>
                              <span className="text-pink-pale/60">{state.datasetCard.source}</span>
                            </div>
                            <div>
                              <span className="text-pink-deep/40 uppercase tracking-widest font-bold block mb-1">Features</span>
                              <div className="flex flex-wrap gap-1">
                                {state.datasetCard.features.map((f, i) => (
                                  <span key={i} className="text-pink-pale/40">#{f}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    )}

                    {state.experiment && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl overflow-hidden">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Experimental Evidence (Execution Logs)</h3>
                        <div className="bg-black/40 p-4 rounded-xl font-mono text-[10px] text-pink-pale/40 leading-relaxed overflow-x-auto max-h-60 overflow-y-auto">
                          {state.experiment.logs.map((log, i) => (
                            <div key={i} className="flex gap-3">
                              <span className="text-pink-deep/20">[{i+1}]</span>
                              <span>{log}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 pt-4 border-t border-pink-pale/5">
                          <h4 className="text-[10px] uppercase tracking-widest font-bold mb-2 text-pink-deep/60">Implementation Details</h4>
                          <p className="text-xs text-pink-pale/50 italic">{state.experiment.implementationDetails}</p>
                        </div>
                      </section>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <section>
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 border-b border-pink-pale/10 pb-2 text-pink-deep">Discussion</h3>
                        <div className="text-sm leading-relaxed text-pink-pale/70 prose-invert"><Markdown>{state.report.discussion}</Markdown></div>
                      </section>
                      <section>
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 border-b border-pink-pale/10 pb-2 text-pink-deep">Conclusion</h3>
                        <div className="text-sm leading-relaxed text-pink-pale/70 prose-invert"><Markdown>{state.report.conclusion}</Markdown></div>
                      </section>
                    </div>

                    <section className="pt-8 border-t border-pink-pale/10">
                      <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">References</h3>
                      <ul className="space-y-2">
                        {(state.report.references || []).map((ref, i) => (
                          <li key={`ref-${i}`} className="text-[11px] text-pink-pale/40 font-mono leading-relaxed">
                            <span className="text-pink-deep">[{i+1}]</span> {ref}
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-center gap-4 pt-12">
                    <button 
                      onClick={exportMarkdown}
                      className="flex items-center justify-center gap-2 px-8 py-3 bg-dark-surface border border-pink-pale/10 text-pink-pale rounded-full hover:bg-dark-bg transition-all shadow-sm"
                    >
                      <FileText className="w-4 h-4" />
                      Export Markdown (.md)
                    </button>
                    <button 
                      onClick={exportPDF}
                      className="flex items-center justify-center gap-2 px-8 py-3 bg-pink-deep text-white rounded-full hover:bg-pink-deep/90 transition-all shadow-lg shadow-pink-deep/20"
                    >
                      <Download className="w-4 h-4" />
                      Export PDF (.pdf)
                    </button>
                    <button 
                      onClick={() => window.print()}
                      className="flex items-center justify-center gap-2 px-8 py-3 bg-dark-surface border border-pink-pale/10 text-pink-pale rounded-full hover:bg-dark-bg transition-all shadow-sm"
                    >
                      <Printer className="w-4 h-4" />
                      Print
                    </button>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-pink-pale/10 py-12 mt-24 bg-dark-surface">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 opacity-40">
              <BrainCircuit className="w-4 h-4" />
              <span className="text-[10px] uppercase tracking-widest font-bold">Literature Agent v1.1</span>
            </div>
            
            {/* Gemini API Status Monitor */}
            <div className="flex items-center gap-4 px-4 py-1.5 bg-black/20 rounded-full border border-pink-pale/5">
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full animate-pulse",
                  geminiStatus.available > 0 ? "bg-emerald-500" : "bg-red-500"
                )} />
                <span className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40">API Status</span>
              </div>
              <div className="flex items-center gap-3 text-[9px] font-mono text-pink-pale/60">
                <span title="Available Keys">AVAIL: {geminiStatus.available}</span>
                <span title="Cooling Down Keys" className={geminiStatus.coolingDown > 0 ? "text-amber-400" : ""}>COOL: {geminiStatus.coolingDown}</span>
                <span title="Failed Keys" className={geminiStatus.failed > 0 ? "text-red-400" : ""}>FAIL: {geminiStatus.failed}</span>
                <span title="Total Keys">TOTAL: {geminiStatus.total}</span>
                {geminiStatus.totalRetries > 0 && (
                  <span title="Total Retries" className="text-pink-deep/60 animate-pulse">RETRIES: {geminiStatus.totalRetries}</span>
                )}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-pink-pale/40 uppercase tracking-widest font-bold">
            Powered by Gemini 3.1 & arXiv API
          </p>
        </div>
      </footer>
    </div>
  );
}
