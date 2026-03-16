import React, { useState, useEffect, useRef } from 'react';
import { Search, Lightbulb, FlaskConical, ClipboardCheck, FileText, Loader as Loader2, ChevronRight, CircleAlert as AlertCircle, ExternalLink, CircleCheck as CheckCircle2, BrainCircuit, Copy, Download, Printer, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
// @ts-ignore
import html2pdf from 'html2pdf.js';

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
  ReviewerCritique
} from './types';
import { 
  LiteratureAgent, 
  SelectionAgent,
  HypothesisAgent, 
  NoveltyCheckerAgent,
  ContributionAgent,
  MathFormalizerAgent,
  ExperimentDesignAgent,
  DatasetGeneratorAgent,
  ExperimentRunner, 
  ReviewerSimulatorAgent,
  RevisionAgent,
  ReportAgent,
  TopicRelevanceAgent,
  VerificationAgent
} from './services/agents';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [state, setState] = useState<AppState>({
    status: 'idle',
    topic: '',
    papers: [],
    hypothesis: null,
    contributions: [],
    mathFormalization: null,
    experimentPlan: null,
    datasetCard: null,
    experiment: null,
    reviewerCritiques: [],
    report: null,
    error: null,
    iteration: 0,
  });

  const [inputTopic, setInputTopic] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [usingRAG, setUsingRAG] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const runResearch = async () => {
    if (!inputTopic.trim()) return;

    let currentIteration = 1;
    const MAX_ITERATIONS = 3;
    let isReliable = false;

    setState(prev => ({ 
      ...prev, 
      status: 'searching', 
      topic: inputTopic,
      error: null,
      papers: [],
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

    try {
      while (!isReliable && currentIteration <= MAX_ITERATIONS) {
        setState(prev => ({ ...prev, iteration: currentIteration, status: 'searching' }));

        // 1. Literature Agent
        setUsingRAG(false);
        const rawPapers = await LiteratureAgent.fetchPapers(inputTopic, (isUsingRAG) => {
          setUsingRAG(isUsingRAG);
        });
        if (rawPapers.length === 0) {
          throw new Error("No papers found for this topic on arXiv.");
        }

        // 1a. Topic Relevance Agent
        setState(prev => ({ ...prev, status: 'filtering_relevance' }));
        const relevantPapers = await TopicRelevanceAgent.filterRelevantPapers(inputTopic, rawPapers);
        if (relevantPapers.length === 0) {
          throw new Error("No directly relevant papers found for this topic. Please try a more specific or common research topic.");
        }
        
        // 1b. Selection Agent
        const papers = await SelectionAgent.selectPapers(inputTopic, relevantPapers);
        setState(prev => ({ ...prev, status: 'hypothesizing', papers }));

        // 2. Hypothesis Agent
        let hypothesis = await HypothesisAgent.generateHypothesis(inputTopic, papers);
        
        // 2b. Novelty Checker (Loop up to 5 times)
        let noveltyAttempts = 0;
        const MAX_NOVELTY_ATTEMPTS = 5;
        let isNovel = false;
        let noveltyFeedback = "";
        while (!isNovel && noveltyAttempts < MAX_NOVELTY_ATTEMPTS) {
          setState(prev => ({ ...prev, status: 'checking_novelty', hypothesis }));
          const novelty = await NoveltyCheckerAgent.checkNovelty(hypothesis, papers, noveltyAttempts);
          isNovel = novelty.isNovel;
          noveltyFeedback = novelty.feedback || "";
          
          if (!isNovel) {
            console.log(`Hypothesis not novel enough (Attempt ${noveltyAttempts + 1}), regenerating...`);
            hypothesis = await HypothesisAgent.generateHypothesis(inputTopic, papers, noveltyFeedback);
            noveltyAttempts++;
          }
        }

        if (!isNovel) {
          throw new Error(`Failed to generate a sufficiently novel hypothesis after ${MAX_NOVELTY_ATTEMPTS} attempts.`);
        }

        // 2c. Contribution Agent
        setState(prev => ({ ...prev, status: 'extracting_contributions', hypothesis }));
        const contributions = await ContributionAgent.extractContributions(hypothesis);
        setState(prev => ({ ...prev, contributions }));

        // 2d. Math Formalizer
        setState(prev => ({ ...prev, status: 'formalizing_math' }));
        const mathFormalization = await MathFormalizerAgent.formalize(hypothesis);
        setState(prev => ({ ...prev, mathFormalization }));

        // 3. Experiment Design
        setState(prev => ({ ...prev, status: 'designing_experiment' }));
        const experimentPlan = await ExperimentDesignAgent.design(hypothesis, contributions);
        setState(prev => ({ ...prev, experimentPlan }));

        // 3b. Dataset Generator
        setState(prev => ({ ...prev, status: 'generating_dataset' }));
        const datasetCard = await DatasetGeneratorAgent.generate(experimentPlan);
        setState(prev => ({ ...prev, datasetCard }));

        // 3c. Experiment Runner
        setState(prev => ({ ...prev, status: 'experimenting' }));
        const experiment = await ExperimentRunner.runExperiment(hypothesis, experimentPlan);
        setState(prev => ({ ...prev, experiment }));

        // 4. Reviewer Simulator
        setState(prev => ({ ...prev, status: 'reviewing' }));
        const reviewerCritiques = await ReviewerSimulatorAgent.simulate(hypothesis, experiment);
        setState(prev => ({ ...prev, reviewerCritiques }));

        // Check reliability (average rating > 7)
        const avgRating = reviewerCritiques.reduce((acc, c) => acc + c.rating, 0) / reviewerCritiques.length;
        isReliable = avgRating >= 7;
        
        if (!isReliable && currentIteration < MAX_ITERATIONS) {
          console.log(`Iteration ${currentIteration} unreliable (Rating: ${avgRating.toFixed(1)}). Revising...`);
          
          // Update hypothesis and experiment with revised versions
          setState(prev => ({ ...prev, status: 'revising' }));
          const revision = await RevisionAgent.revise(hypothesis, experiment, reviewerCritiques);
          
          // Update hypothesis and experiment with revised versions
          hypothesis = revision.revisedHypothesis;
          const revisedExperiment = revision.revisedResult;
          
          currentIteration++;
          setState(prev => ({ 
            ...prev, 
            hypothesis, 
            experiment: revisedExperiment 
          }));
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        setState(prev => ({ ...prev, status: 'reporting' }));

        // 5. Report Agent
        const report = await ReportAgent.generateReport(
          inputTopic, 
          papers, 
          hypothesis, 
          contributions,
          mathFormalization,
          experimentPlan,
          datasetCard,
          experiment, 
          reviewerCritiques
        );

        // 6. Verification Agent
        setState(prev => ({ ...prev, status: 'verifying_report', report }));
        const verification = await VerificationAgent.verifyReport(report, papers);
        
        if (!verification.isValid) {
          console.warn("Report verification failed:", verification.issues);
          // If it's the first or second iteration, we might want to retry reporting with a stronger prompt
          // but for now we'll just log it and proceed, or we could throw an error to force a full iteration retry
          if (currentIteration < MAX_ITERATIONS) {
             console.log("Retrying iteration due to verification failure...");
             currentIteration++;
             continue;
          }
        }

        setState(prev => ({ ...prev, status: 'completed', report }));
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

## Results
${state.report.results}

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
    { id: 'searching', label: 'Literature Search', icon: Search },
    { id: 'hypothesizing', label: 'Hypothesis & Novelty', icon: Lightbulb },
    { id: 'formalizing_math', label: 'Math & Design', icon: BrainCircuit },
    { id: 'experimenting', label: 'ML Execution', icon: FlaskConical },
    { id: 'reviewing', label: 'Peer Review', icon: ClipboardCheck },
    { id: 'reporting', label: 'Final Report', icon: FileText },
  ];

  const currentStepIndex = steps.findIndex(s => {
    if (state.status === 'filtering_relevance') return s.id === 'searching';
    if (state.status === 'checking_novelty' || state.status === 'extracting_contributions') return s.id === 'hypothesizing';
    if (state.status === 'designing_experiment' || state.status === 'generating_dataset') return s.id === 'formalizing_math';
    if (state.status === 'revising') return s.id === 'reviewing';
    if (state.status === 'verifying_report') return s.id === 'reporting';
    return s.id === state.status;
  });
  const isCompleted = state.status === 'completed';

  return (
    <div className="min-h-screen bg-dark-bg text-pink-pale font-sans selection:bg-pink-deep selection:text-white relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 pointer-events-none opacity-30 overflow-hidden">
        <motion.div
          className="absolute top-0 left-1/4 w-96 h-96 bg-pink-deep/5 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-pink-deep/5 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.4, 0.3],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 w-96 h-96 bg-pink-deep/5 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
      </div>

      {/* Header */}
      <header className="border-b border-pink-pale/10 bg-dark-surface/80 backdrop-blur-md sticky top-0 z-50 relative">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-pink-deep/50 to-transparent" />
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              className="w-10 h-10 bg-gradient-to-br from-pink-deep to-pink-deep/60 rounded-xl flex items-center justify-center shadow-lg shadow-pink-deep/20"
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <BrainCircuit className="text-white w-5 h-5" />
            </motion.div>
            <h1 className="text-xl font-semibold tracking-tight italic serif bg-gradient-to-r from-pink-pale to-pink-deep bg-clip-text text-transparent">
              Literature Agent
            </h1>
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
            <motion.div
              className="absolute top-1/2 left-0 h-[2px] bg-gradient-to-r from-pink-deep to-pink-deep/50 -translate-y-1/2 z-0"
              initial={{ width: '0%' }}
              animate={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            />
            {(steps || []).map((step, idx) => {
              const Icon = step.icon;
              const isActive = state.status === step.id;
              const isPast = currentStepIndex > idx || isCompleted;

              return (
                <motion.div
                  key={step.id}
                  className="relative z-10 flex flex-col items-center gap-3"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <motion.div
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 border-2",
                      isActive ? "bg-pink-deep border-pink-deep text-white scale-110 shadow-lg shadow-pink-deep/20" :
                      isPast ? "bg-dark-bg border-pink-deep text-pink-deep" :
                      "bg-dark-bg border-pink-pale/10 text-pink-pale/20"
                    )}
                    animate={isActive ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ duration: 2, repeat: isActive ? Infinity : 0 }}
                  >
                    {isPast ? <CheckCircle2 className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
                  </motion.div>
                  <span className={cn(
                    "text-[10px] uppercase tracking-widest font-bold transition-colors",
                    isActive ? "text-pink-pale" : "text-pink-pale/40"
                  )}>
                    {step.label}
                  </span>
                </motion.div>
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
                    {usingRAG && state.papers.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 p-3 bg-emerald-900/20 border border-emerald-500/20 rounded-xl"
                      >
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                          Using Cached Papers (RAG)
                        </span>
                      </motion.div>
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
                          <li>Ensure <strong>GEMINI_API_KEYS</strong> are valid and not expired.</li>
                          <li>Add more keys to your rotation (up to 20) to bypass rate limits.</li>
                          <li>Check if your keys have hit their daily free-tier quota.</li>
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
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40 mb-6">Experimental Results</h2>
                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div>
                    <div className="text-3xl font-light mb-1 text-pink-deep">{(state.experiment.accuracy * 100).toFixed(1)}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-pink-pale/40">Accuracy</div>
                  </div>
                  <div>
                    <div className="text-3xl font-light mb-1 text-pink-deep">{(state.experiment.f1Score * 100).toFixed(1)}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-pink-pale/40">F1 Score</div>
                  </div>
                </div>

                {state.experiment.baselines && state.experiment.baselines.length > 0 && (
                  <div className="mb-8 p-4 bg-dark-bg rounded-xl border border-pink-pale/5">
                    <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-3">Baseline Comparison</h3>
                    <div className="space-y-2">
                      {(state.experiment.baselines || []).map((b, i) => (
                        <div key={`baseline-${i}`} className="flex justify-between items-center text-[10px]">
                          <span className="text-pink-pale/60">{b.name}</span>
                          <span className="font-mono text-pink-deep">{(b.accuracy * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {state.experiment.ablationStudies && state.experiment.ablationStudies.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40 mb-3">Ablation Studies</h3>
                    <div className="space-y-3">
                      {(state.experiment.ablationStudies || []).map((a, i) => (
                        <div key={`ablation-${i}`} className="text-[10px]">
                          <div className="flex justify-between mb-1">
                            <span className="text-pink-pale/60 italic">{a.componentRemoved} removed</span>
                            <span className="text-pink-deep">{(a.impactOnMetric * 100).toFixed(1)}% drop</span>
                          </div>
                          <div className="w-full bg-dark-bg h-1 rounded-full overflow-hidden">
                            <div 
                              className="bg-pink-deep h-full" 
                              style={{ width: `${Math.min(100, a.impactOnMetric * 500)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-6 border-t border-pink-pale/10">
                  <div className="text-[10px] uppercase tracking-widest text-pink-pale/40 mb-3">Execution Logs</div>
                  <div className="space-y-2 font-mono text-[10px] text-pink-pale/60">
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
                    <h2 className="text-2xl font-serif italic">Literature Review</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-pink-pale/40">LiteratureAgent</span>
                  </div>
                  <div className="space-y-4">
                    {(state.papers || []).map((paper, i) => (
                      <motion.div
                        key={`${paper.link}-${i}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="group p-6 bg-dark-surface border border-pink-pale/10 rounded-2xl hover:border-pink-deep/30 transition-all hover:shadow-xl hover:shadow-pink-deep/5 relative overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-pink-deep/5 rounded-full blur-2xl group-hover:bg-pink-deep/10 transition-all" />
                        <div className="relative z-10">
                          <div className="flex justify-between items-start gap-4 mb-3">
                            <h3 className="font-semibold text-lg leading-tight group-hover:text-pink-deep transition-colors">
                              {paper.title}
                            </h3>
                            <div className="flex gap-2">
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => copyToClipboard(paper.citation, i)}
                                className="text-pink-pale/40 hover:text-pink-deep transition-colors p-1"
                                title="Copy Citation"
                              >
                                {copiedIndex === i ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                              </motion.button>
                              <motion.a
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                href={paper.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-pink-pale/40 hover:text-pink-deep p-1"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </motion.a>
                            </div>
                          </div>
                          <p className="text-sm text-pink-pale/60 line-clamp-3 mb-4 leading-relaxed">{paper.summary}</p>

                          <div className="mb-4 p-3 bg-dark-bg rounded-xl border border-pink-pale/5">
                            <div className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/20 mb-1">Citation</div>
                            <div className="text-[11px] text-pink-pale/40 font-mono leading-relaxed">{paper.citation}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {(paper.authors || []).slice(0, 3).map((author, j) => (
                              <span key={`${paper.link}-auth-${i}-${j}`} className="text-[10px] px-2 py-1 bg-dark-bg rounded-md text-pink-pale/40 font-medium uppercase tracking-wider border border-pink-pale/5">
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
                      </motion.div>
                    ))}
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
                    <h2 className="text-3xl font-serif italic">Research Report</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">ReportAgent</span>
                  </div>
                  
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
          <div className="flex items-center gap-2 opacity-40">
            <BrainCircuit className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-widest font-bold">Literature Agent v1.1</span>
          </div>
          <p className="text-[10px] text-pink-pale/40 uppercase tracking-widest font-bold">
            Powered by Gemini 3.1 & arXiv API
          </p>
        </div>
      </footer>
    </div>
  );
}
