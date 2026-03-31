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
  PieChart as PieChartIcon,
  Database
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
  ExperimentConfig,
  Chunk
} from './types';
import { researchEngine } from './services/researchEngine';
import { getGeminiStatus, resetGeminiStatus } from './services/gemini';
import { getDeepSeekStatus, resetDeepSeekStatus } from './services/deepseek';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const steps = [
  { id: 'refining_topic', label: 'Topic', icon: Search },
  { id: 'searching', label: 'Literature', icon: Search },
  { id: 'discovering', label: 'Discovery', icon: Lightbulb },
  { id: 'designing', label: 'Design', icon: BrainCircuit },
  { id: 'experimenting', label: 'Execution', icon: FlaskConical },
  { id: 'reporting', label: 'Report', icon: FileText },
];

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
    experimentConfig: {
      datasetSize: 1000,
      noiseLevel: 0.05,
      featureComplexity: 10,
      dataType: 'classification'
    },
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
  const [deepseekStatus, setDeepseekStatus] = useState(getDeepSeekStatus());
  const reportRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setGeminiStatus(getGeminiStatus());
      setDeepseekStatus(getDeepSeekStatus());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleResetAPI = () => {
    resetGeminiStatus();
    resetDeepSeekStatus();
    setGeminiStatus(getGeminiStatus());
    setDeepseekStatus(getDeepSeekStatus());
  };

  const updateExperimentConfig = (updates: Partial<ExperimentConfig>) => {
    setState(prev => ({
      ...prev,
      experimentConfig: {
        ...prev.experimentConfig,
        ...updates
      }
    }));
  };

  const runResearch = async () => {
    if (!inputTopic.trim()) return;

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
      iteration: 1
    }));
    setSearchingProgress('');

    try {
      await researchEngine.run(
        inputTopic,
        state.experimentConfig,
        (updates) => setState(prev => ({ ...prev, ...updates })),
        (msg) => setSearchingProgress(msg)
      );
    } catch (err: any) {
      console.error("Research workflow error:", err);
      let displayError = "";
      
      if (typeof err === 'string') {
        displayError = err;
      } else if (err && typeof err === 'object') {
        displayError = err.message || err.error?.message || err.error || "";
        if (!displayError || displayError === "[object Object]") {
          try {
            displayError = JSON.stringify(err);
          } catch (e) {
            displayError = String(err);
          }
        }
      } else {
        displayError = String(err);
      }
      
      setState(prev => ({ ...prev, status: 'error', error: displayError }));
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const exportMarkdown = () => {
    if (!state.report) return;
    
    const content = state.report.fullMarkdown || `
# Research Report: ${state.report.title || state.topic}
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
    const element = reportRef.current;
    if (!element) return;
    
    const opt = {
      margin: 1,
      filename: `research_report_${state.topic.replace(/\s+/g, '_').toLowerCase()}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  const exportSnapshotPDF = (iteration: number) => {
    const element = snapshotRef.current;
    if (!element) return;

    const opt = {
      margin: 1,
      filename: `research_snapshot_iter${iteration}_${state.topic.replace(/\s+/g, '_').toLowerCase()}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  // Auto-export PDF at each iteration or completion
  useEffect(() => {
    if (state.status === 'completed' && state.report) {
      // Small delay to ensure DOM is updated
      setTimeout(() => exportPDF(), 1000);
    } else if (state.iteration > 0 && (state.status === 'revising' || state.status === 'reporting')) {
      // Snapshot at the end of an iteration
      setTimeout(() => exportSnapshotPDF(state.iteration), 1000);
    }
  }, [state.iteration, state.status === 'completed']);

  const currentStepIndex = React.useMemo(() => steps.findIndex(s => {
    if (state.status === 'verifying_citations') return s.id === 'searching';
    if (state.status === 'identifying_gaps' || state.status === 'hypothesizing' || state.status === 'checking_novelty' || state.status === 'discovering') return s.id === 'discovering';
    if (state.status === 'designing_experiment' || state.status === 'formalizing_math' || state.status === 'generating_dataset' || state.status === 'designing') return s.id === 'designing';
    if (state.status === 'validating_results' || state.status === 'reviewing' || state.status === 'revising' || state.status === 'experimenting') return s.id === 'experimenting';
    if (state.status === 'verifying_report' || state.status === 'reporting') return s.id === 'reporting';
    return s.id === state.status;
  }), [state.status]);
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
                disabled={(state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error') || (geminiStatus.available === 0 && deepseekStatus.available === 0)}
                className="absolute right-1 top-1 bottom-1 px-4 bg-pink-deep text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-pink-deep/90 transition-colors disabled:opacity-50"
                title={(geminiStatus.available === 0 && deepseekStatus.available === 0) ? "No API keys available. Check your Gemini or DeepSeek keys in Settings -> Secrets." : ""}
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
                    
                    {/* API Status Overlays */}
                    {(geminiStatus.total > 0 || deepseekStatus.total > 0) && (
                      <div className="pl-7 pt-2 border-t border-pink-pale/5 mt-2 space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/20">API Infrastructure</span>
                          <button 
                            onClick={handleResetAPI}
                            className="text-[8px] uppercase tracking-widest font-bold text-pink-deep hover:text-pink-deep/80 transition-colors flex items-center gap-1"
                          >
                            <RefreshCw className="w-2 h-2" />
                            Reset Status
                          </button>
                        </div>
                        {deepseekStatus.total > 0 && (
                          <div>
                            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider mb-1">
                              <span className="text-pink-pale/40">DeepSeek Status (Preferred)</span>
                              <span className={cn(
                                "font-bold",
                                deepseekStatus.available > 0 ? "text-emerald-500" : "text-amber-500"
                              )}>
                                {deepseekStatus.available} / {deepseekStatus.total} Keys
                              </span>
                            </div>
                            {deepseekStatus.total > 0 && deepseekStatus.available === 0 && (
                              <p className="text-[8px] text-amber-500 italic">
                                All DeepSeek keys failed or invalid. Falling back to Gemini.
                              </p>
                            )}
                          </div>
                        )}

                        {geminiStatus.total > 0 && (
                          <div>
                            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider mb-1">
                              <span className="text-pink-pale/40">Gemini Status (Fallback)</span>
                              <span className={cn(
                                "font-bold",
                                geminiStatus.available > 0 ? "text-emerald-500" : "text-amber-500"
                              )}>
                                {geminiStatus.available} / {geminiStatus.total} Keys
                              </span>
                            </div>
                            {geminiStatus.coolingDown > 0 && (
                              <p className={cn(
                                "text-[8px] italic",
                                geminiStatus.hardQuota > 0 ? "text-red-500" : "text-amber-500/80"
                              )}>
                                {geminiStatus.hardQuota > 0 
                                  ? `${geminiStatus.hardQuota} keys reached hard quota (5m wait)...` 
                                  : `${geminiStatus.coolingDown} keys waiting for quota reset...`}
                              </p>
                            )}
                          </div>
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
                    {(state.error.includes("API key") || state.error.includes("PERMISSION_DENIED") || state.error.includes("Balance") || state.error.includes("Unauthorized") || state.error.includes("RESOURCE_EXHAUSTED") || state.error.includes("429") || state.error.includes("quota") || state.error.includes("hard quota")) && (
                      <div className="p-3 bg-dark-bg/50 rounded-lg border border-pink-deep/10">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] text-pink-deep font-bold uppercase tracking-wider">Troubleshooting Advice:</p>
                          <button 
                            onClick={handleResetAPI}
                            className="text-[8px] px-2 py-1 bg-pink-deep/10 border border-pink-deep/20 rounded-md text-pink-deep font-bold uppercase tracking-widest hover:bg-pink-deep/20 transition-all"
                          >
                            Reset API Cooldowns
                          </button>
                        </div>
                        <p className="text-[10px] text-pink-pale/60 leading-relaxed">
                          It looks like there's an issue with your API keys, account balance, or rate limits. 
                          The app is automatically rotating through your keys, but you may need to:
                        </p>
                        <ul className="text-[10px] text-pink-pale/40 mt-2 list-disc list-inside space-y-1">
                          <li>DeepSeek is now the <strong>preferred provider</strong> for research tasks.</li>
                          <li>Add DeepSeek keys as <strong>VITE_DEEPSEEK_API_KEY_1</strong> (up to 10) for maximum performance.</li>
                          <li>The app <strong>automatically falls back to Gemini</strong> if DeepSeek keys are exhausted or rate-limited.</li>
                          <li>If you see "authentication fails" or "user not found", your DeepSeek/OpenRouter key is invalid. Please update it in Settings &rarr; Secrets.</li>
                          <li>Ensure <strong>VITE_GEMINI_API_KEY_1</strong> (up to 32) are valid for reliable fallback support.</li>
                          <li>If you see "hard quota" errors, your Gemini key has likely reached its free tier limit or billing cap. You can try adding more keys or wait for the 5-minute cooldown.</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Simulation Configuration */}
            <div className="bg-dark-surface border border-pink-pale/10 rounded-2xl p-6 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-widest text-pink-pale/40 mb-4">Simulation Parameters</h2>
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-pink-pale/60">Dataset Size</label>
                    <span className="text-[10px] font-mono text-pink-deep">{state.experimentConfig.datasetSize}</span>
                  </div>
                  <input 
                    type="range" 
                    min="100" 
                    max="5000" 
                    step="100"
                    value={state.experimentConfig.datasetSize}
                    onChange={(e) => updateExperimentConfig({ datasetSize: parseInt(e.target.value) })}
                    className="w-full h-1 bg-pink-pale/10 rounded-lg appearance-none cursor-pointer accent-pink-deep"
                    disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-pink-pale/60">Noise Level</label>
                    <span className="text-[10px] font-mono text-pink-deep">{(state.experimentConfig.noiseLevel * 100).toFixed(0)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="0.5" 
                    step="0.01"
                    value={state.experimentConfig.noiseLevel}
                    onChange={(e) => updateExperimentConfig({ noiseLevel: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-pink-pale/10 rounded-lg appearance-none cursor-pointer accent-pink-deep"
                    disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-pink-pale/60">Feature Complexity</label>
                    <span className="text-[10px] font-mono text-pink-deep">{state.experimentConfig.featureComplexity}</span>
                  </div>
                  <input 
                    type="range" 
                    min="2" 
                    max="50" 
                    step="1"
                    value={state.experimentConfig.featureComplexity}
                    onChange={(e) => updateExperimentConfig({ featureComplexity: parseInt(e.target.value) })}
                    className="w-full h-1 bg-pink-pale/10 rounded-lg appearance-none cursor-pointer accent-pink-deep"
                    disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-pink-pale/60">Data Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['classification', 'regression', 'clustering'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => updateExperimentConfig({ dataType: type })}
                        disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                        className={cn(
                          "px-2 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all border",
                          state.experimentConfig.dataType === type 
                            ? "bg-pink-deep border-pink-deep text-white" 
                            : "bg-dark-bg border-pink-pale/10 text-pink-pale/40 hover:border-pink-pale/20"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
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
                    <div className="text-3xl font-light mb-1 text-pink-deep">{((state.experiment?.accuracy || 0) * 100).toFixed(1)}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-pink-pale/40">Accuracy</div>
                  </div>
                  <div className="p-4 bg-dark-bg/50 rounded-xl border border-pink-pale/5">
                    <div className="text-3xl font-light mb-1 text-pink-deep">{((state.experiment?.f1Score || 0) * 100).toFixed(1)}%</div>
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
                        ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
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
                            ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                          ]
                        ).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#FF6321' : '#f5f2ed20'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {state.experiment.leaderboard && state.experiment.leaderboard.length > 0 && (
                  <div className="mb-8 p-4 bg-dark-bg/50 rounded-xl border border-pink-pale/5">
                    <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-deep mb-4 flex items-center gap-2">
                      <TrendingUp className="w-3 h-3" />
                      AutoGluon Leaderboard
                    </h3>
                    <div className="space-y-2">
                      {state.experiment.leaderboard.map((m, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className="text-pink-pale/40">{idx + 1}.</span>
                            <span className={cn("font-medium", m.stack_level > 0 ? "text-pink-deep" : "text-pink-pale/80")}>
                              {m.model}
                              {m.stack_level > 0 && <span className="ml-1 text-[8px] bg-pink-deep/20 px-1 rounded text-pink-deep">Ensemble</span>}
                            </span>
                          </div>
                          <span className="font-mono text-pink-deep">{(m.score_test * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {state.experiment.featureImportance && Object.keys(state.experiment.featureImportance).length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40 mb-4 flex items-center gap-2">
                      <BarChartIcon className="w-3 h-3" />
                      Feature Importance
                    </h3>
                    <div className="space-y-3">
                      {Object.entries(state.experiment.featureImportance)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5)
                        .map(([feature, importance], idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-[9px] uppercase tracking-wider">
                              <span className="text-pink-pale/60">{feature}</span>
                              <span className="text-pink-deep font-mono">{(importance * 100).toFixed(1)}%</span>
                            </div>
                            <div className="h-1 w-full bg-pink-pale/5 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${importance * 100}%` }}
                                className="h-full bg-pink-deep"
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

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
                          data={(Array.isArray(state.experiment.ablationStudies) ? state.experiment.ablationStudies : []).map(a => ({
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
                    {(Array.isArray(state.experiment.logs) ? state.experiment.logs : []).map((log, i) => (
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
                      <h1 className="text-4xl font-serif italic mb-2 text-pink-deep">{state.report.title || state.topic}</h1>
                      <p className="text-xs uppercase tracking-widest text-pink-pale/40">Generated by Literature Agent • {new Date().toLocaleDateString()}</p>
                    </div>

                    <div className="bg-dark-bg p-8 rounded-2xl border border-pink-pale/5">
                      <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Abstract</h3>
                      <p className="text-lg leading-relaxed font-serif italic text-pink-pale/80">{state.report.abstract}</p>
                    </div>

                    {state.hypothesis && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Research Hypothesis</h3>
                        <div className="space-y-4">
                          <h4 className="text-lg font-serif italic text-pink-pale">{state.hypothesis.title}</h4>
                          <p className="text-sm text-pink-pale/70 leading-relaxed">{state.hypothesis.description}</p>
                        </div>
                      </section>
                    )}

                    {state.experimentPlan && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Experiment Design & Parameters</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                          <div className="space-y-4">
                            <h4 className="text-[10px] uppercase tracking-widest font-bold text-pink-deep/60">Simulation Parameters</h4>
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <span className="text-pink-pale/40 block mb-1">Dataset Size</span>
                                <span className="text-pink-pale/80 font-mono">{state.experimentConfig.datasetSize}</span>
                              </div>
                              <div>
                                <span className="text-pink-pale/40 block mb-1">Noise Level</span>
                                <span className="text-pink-pale/80 font-mono">{(state.experimentConfig.noiseLevel || 0) * 100}%</span>
                              </div>
                              <div>
                                <span className="text-pink-pale/40 block mb-1">Complexity</span>
                                <span className="text-pink-pale/80 font-mono">{state.experimentConfig.featureComplexity} features</span>
                              </div>
                              <div>
                                <span className="text-pink-pale/40 block mb-1">Task Type</span>
                                <span className="text-pink-pale/80 font-mono uppercase">{state.experimentConfig.dataType}</span>
                              </div>
                            </div>
                            {state.experimentConfig.kaggleDataset && (
                              <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/20 rounded-xl flex items-center gap-3">
                                <Database className="w-4 h-4 text-blue-400" />
                                <div className="flex flex-col">
                                  <span className="text-[10px] uppercase tracking-widest font-bold text-blue-400">Kaggle Dataset Integrated</span>
                                  <span className="text-xs font-mono text-blue-200/80">{state.experimentConfig.kaggleDataset}</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-4">
                            <h4 className="text-[10px] uppercase tracking-widest font-bold text-pink-deep/60">Evaluation Protocol</h4>
                            <p className="text-xs text-pink-pale/70 leading-relaxed italic">{state.experimentPlan.protocol}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs border-t border-pink-pale/5 pt-6">
                          <div>
                            <span className="text-pink-deep/40 uppercase tracking-widest font-bold block mb-2">Datasets</span>
                            <ul className="space-y-1">
                              {state.experimentPlan.datasets.map((d, i) => <li key={i} className="text-pink-pale/60">• {d}</li>)}
                            </ul>
                          </div>
                          <div>
                            <span className="text-pink-deep/40 uppercase tracking-widest font-bold block mb-2">Baselines</span>
                            <ul className="space-y-1">
                              {state.experimentPlan.baselines.map((b, i) => <li key={i} className="text-pink-pale/60">• {b}</li>)}
                            </ul>
                          </div>
                          <div>
                            <span className="text-pink-deep/40 uppercase tracking-widest font-bold block mb-2">Metrics</span>
                            <ul className="space-y-1">
                              {state.experimentPlan.metrics.map((m, i) => <li key={i} className="text-pink-pale/60">• {m}</li>)}
                            </ul>
                          </div>
                        </div>
                      </section>
                    )}

                    {state.mathFormalization && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Mathematical Formalization</h3>
                        <div className="bg-black/20 p-6 rounded-xl font-mono text-xs text-pink-pale/80 leading-relaxed overflow-x-auto">
                          <div className="mb-4 pb-4 border-b border-pink-pale/5">
                            <span className="text-pink-deep/40 block mb-2 uppercase tracking-tighter font-bold">Problem Formulation</span>
                            <div className="prose-invert"><Markdown>{state.mathFormalization.problemFormulation}</Markdown></div>
                          </div>
                          <div className="mb-4 pb-4 border-b border-pink-pale/5">
                            <span className="text-pink-deep/40 block mb-2 uppercase tracking-tighter font-bold">Notation</span>
                            <div className="space-y-1">
                              {state.mathFormalization.notation.map((n, i) => (
                                <div key={i} className="flex gap-2">
                                  <span className="text-pink-deep font-bold">{n.symbol}:</span>
                                  <span>{n.definition}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="mb-4 pb-4 border-b border-pink-pale/5">
                            <span className="text-pink-deep/40 block mb-2 uppercase tracking-tighter font-bold">Objective Function</span>
                            <div className="prose-invert"><Markdown>{state.mathFormalization.objectiveFunction}</Markdown></div>
                          </div>
                          <div>
                            <span className="text-pink-deep/40 block mb-2 uppercase tracking-tighter font-bold">Algorithm Steps</span>
                            <ul className="list-decimal list-inside space-y-1">
                              {state.mathFormalization.algorithmSteps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </section>
                    )}

                    {state.contributions && state.contributions.length > 0 && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-4 text-pink-deep">Key Contributions</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {state.contributions.map((c, i) => (
                            <div key={i} className="p-4 bg-black/20 rounded-xl border border-pink-pale/5">
                              <h4 className="text-[10px] font-bold text-pink-deep mb-1 uppercase tracking-widest">{c.type}</h4>
                              <p className="text-[10px] text-pink-pale/60 leading-relaxed">{c.description}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

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
                      <h3 className="text-xs uppercase tracking-widest font-bold mb-6 text-center text-pink-deep">Experimental Results & Visual Evidence</h3>
                      <div className="text-sm leading-relaxed text-pink-pale/70 prose-invert mb-8"><Markdown>{state.report.results}</Markdown></div>
                      
                      {state.experiment && (
                        <div className="space-y-12 mt-8 pt-8 border-t border-pink-pale/5">
                          {/* Performance Chart in PDF */}
                          <div className="h-64 w-full">
                            <h4 className="text-[10px] uppercase tracking-widest font-bold text-pink-deep mb-4 flex items-center gap-2">
                              <TrendingUp className="w-3 h-3" />
                              Performance Comparison
                            </h4>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={[
                                  { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                                  ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                                ]}
                                margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                <XAxis dataKey="name" stroke="#f5f2ed40" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="#f5f2ed40" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                                <Bar dataKey="accuracy" radius={[4, 4, 0, 0]}>
                                  {[
                                    { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                                    ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                                  ].map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index === 0 ? '#FF6321' : '#f5f2ed20'} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Leaderboard in PDF */}
                            {state.experiment.leaderboard && (
                              <div className="p-4 bg-black/20 rounded-xl border border-pink-pale/5">
                                <h4 className="text-[10px] uppercase tracking-widest font-bold text-pink-deep mb-4">AutoGluon Leaderboard</h4>
                                <div className="space-y-2">
                                  {state.experiment.leaderboard.map((m, idx) => (
                                    <div key={idx} className="flex items-center justify-between text-[10px]">
                                      <span className="text-pink-pale/80">{m.model}</span>
                                      <span className="font-mono text-pink-deep">{(m.score_test * 100).toFixed(1)}%</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Feature Importance in PDF */}
                            {state.experiment.featureImportance && (
                              <div className="p-4 bg-black/20 rounded-xl border border-pink-pale/5">
                                <h4 className="text-[10px] uppercase tracking-widest font-bold text-pink-deep mb-4">Feature Importance</h4>
                                <div className="space-y-3">
                                  {Object.entries(state.experiment.featureImportance)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 5)
                                    .map(([feature, importance], idx) => (
                                      <div key={idx} className="space-y-1">
                                        <div className="flex justify-between text-[8px] uppercase tracking-wider">
                                          <span className="text-pink-pale/60">{feature}</span>
                                          <span className="text-pink-deep">{(importance * 100).toFixed(1)}%</span>
                                        </div>
                                        <div className="h-1 w-full bg-pink-pale/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-pink-deep" style={{ width: `${importance * 100}%` }} />
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </section>

                    {state.reviewerCritiques && state.reviewerCritiques.length > 0 && (
                      <section className="bg-dark-bg border border-pink-pale/10 p-8 rounded-2xl">
                        <h3 className="text-xs uppercase tracking-widest font-bold mb-6 text-center text-pink-deep">Peer Review Analysis</h3>
                        <div className="h-48 w-full mb-8">
                          <h4 className="text-[10px] uppercase tracking-widest font-bold text-pink-deep mb-4 flex items-center gap-2">
                            <ClipboardCheck className="w-3 h-3" />
                            Reviewer Ratings
                          </h4>
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
                              <Line type="monotone" dataKey="rating" stroke="#FF6321" strokeWidth={2} dot={{ fill: '#FF6321', r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {state.reviewerCritiques.map((c, i) => (
                            <div key={i} className="p-4 bg-black/20 rounded-xl border border-pink-pale/5">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-bold text-pink-deep">Reviewer {i+1}</span>
                                <span className="text-xs font-mono text-pink-deep">{c.rating}/10</span>
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <span className="text-[8px] uppercase text-pink-pale/40 block">Weaknesses</span>
                                  <ul className="text-[8px] text-pink-pale/60 list-disc list-inside">
                                    {c.weaknesses.slice(0, 2).map((w, j) => <li key={j}>{w}</li>)}
                                  </ul>
                                </div>
                                <div>
                                  <span className="text-[8px] uppercase text-pink-pale/40 block">Novelty Critique</span>
                                  <p className="text-[8px] text-pink-pale/60 italic leading-relaxed">"{c.noveltyCritique.slice(0, 100)}..."</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

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

      {/* Hidden Snapshot for PDF Generation */}
      <div className="hidden">
        <div ref={snapshotRef} className="p-12 bg-white text-black font-serif">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-2">Research Snapshot</h1>
            <p className="text-sm uppercase tracking-widest text-gray-500">
              Iteration {state.iteration} • {state.status} • {new Date().toLocaleString()}
            </p>
            <p className="text-xl mt-4 font-bold">{state.topic}</p>
          </div>

          {state.hypothesis && (
            <section className="mb-8 p-6 border border-gray-200 rounded-xl">
              <h2 className="text-xl font-bold mb-4 text-blue-800">Hypothesis</h2>
              <h3 className="text-lg font-bold mb-2">{state.hypothesis.title}</h3>
              <p className="text-sm leading-relaxed">{state.hypothesis.description}</p>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <h4 className="text-xs font-bold uppercase text-gray-500">Rationale</h4>
                  <p className="text-xs">{state.hypothesis.rationale}</p>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase text-gray-500">Expected Outcome</h4>
                  <p className="text-xs">{state.hypothesis.expectedOutcome}</p>
                </div>
              </div>
            </section>
          )}

          {state.gapIdentification && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-blue-800">Gap Analysis</h2>
              <p className="text-sm italic mb-4">{state.gapIdentification.summary}</p>
              <div className="space-y-4">
                {state.gapIdentification.gaps.map((gap, i) => (
                  <div key={i} className="p-4 bg-gray-50 rounded-lg">
                    <h4 className="text-sm font-bold">{gap.description}</h4>
                    <p className="text-xs mt-1"><strong>Evidence:</strong> {gap.evidence}</p>
                    <p className="text-xs"><strong>Impact:</strong> {gap.potentialImpact}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {state.mathFormalization && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-blue-800">Formalization</h2>
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold uppercase text-gray-500">Problem</h4>
                  <p className="text-sm">{state.mathFormalization.problemFormulation}</p>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase text-gray-500">Objective</h4>
                  <p className="text-sm font-mono bg-gray-100 p-2 rounded">{state.mathFormalization.objectiveFunction}</p>
                </div>
              </div>
            </section>
          )}

          {state.experiment && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-blue-800">Experimental Results</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-4 bg-blue-50 rounded-xl text-center">
                  <div className="text-2xl font-bold">{((state.experiment?.accuracy || 0) * 100).toFixed(1)}%</div>
                  <div className="text-xs uppercase">Accuracy</div>
                </div>
                <div className="p-4 bg-blue-50 rounded-xl text-center">
                  <div className="text-2xl font-bold">{((state.experiment?.f1Score || 0) * 100).toFixed(1)}%</div>
                  <div className="text-xs uppercase">F1 Score</div>
                </div>
              </div>
              <div className="text-xs font-mono bg-gray-900 text-gray-300 p-4 rounded-lg max-h-60 overflow-hidden">
                {state.experiment?.logs?.slice(-20).map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </section>
          )}

          {state.papers.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-blue-800">Key References</h2>
              <div className="space-y-2">
                {state.papers.slice(0, 10).map((paper, i) => (
                  <div key={i} className="text-xs">
                    <strong>[{i+1}]</strong> {paper.title} ({paper.authors?.join(', ')})
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-pink-pale/10 py-12 mt-24 bg-dark-surface">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 opacity-40">
              <BrainCircuit className="w-4 h-4" />
              <span className="text-[10px] uppercase tracking-widest font-bold">Literature Agent v1.1</span>
            </div>
            
            {/* API Status Monitors */}
            <div className="flex flex-wrap items-center gap-4 px-5 py-2 bg-black/30 rounded-full border border-pink-pale/5 backdrop-blur-md">
              {/* Gemini */}
              <div className="flex items-center gap-3 border-r border-pink-pale/10 pr-4">
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]",
                    geminiStatus.available > 0 ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                  )} />
                  <span className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40">Gemini</span>
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono text-pink-pale/60">
                  <span title="Available" className="hover:text-emerald-400 transition-colors cursor-help">A:{geminiStatus.available}</span>
                  <span title="Cooling" className={cn("transition-colors cursor-help", geminiStatus.coolingDown > 0 ? "text-amber-400" : "hover:text-amber-400")}>C:{geminiStatus.coolingDown}</span>
                  <span title="Failed" className={cn("transition-colors cursor-help", geminiStatus.failed > 0 ? "text-red-400" : "hover:text-red-400")}>F:{geminiStatus.failed}</span>
                  <span title="Total" className="hover:text-pink-pale transition-colors cursor-help">T:{geminiStatus.total}</span>
                  <button 
                    onClick={() => {
                      resetGeminiStatus();
                      setGeminiStatus(getGeminiStatus());
                    }}
                    className="p-1 rounded hover:bg-pink-pale/10 text-pink-pale/30 hover:text-pink-pale/80 transition-all active:scale-90"
                    title="Reset Gemini Rotation"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* DeepSeek */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]",
                    deepseekStatus.available > 0 ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                  )} />
                  <span className="text-[9px] uppercase tracking-widest font-bold text-pink-pale/40">DeepSeek</span>
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono text-pink-pale/60">
                  <span title="Available" className="hover:text-emerald-400 transition-colors cursor-help">A:{deepseekStatus.available}</span>
                  <span title="Cooling" className={cn("transition-colors cursor-help", deepseekStatus.coolingDown > 0 ? "text-amber-400" : "hover:text-amber-400")}>C:{deepseekStatus.coolingDown}</span>
                  <span title="Failed" className={cn("transition-colors cursor-help", deepseekStatus.failed > 0 ? "text-red-400" : "hover:text-red-400")}>F:{deepseekStatus.failed}</span>
                  <span title="Total" className="hover:text-pink-pale transition-colors cursor-help">T:{deepseekStatus.total}</span>
                  <button 
                    onClick={() => {
                      resetDeepSeekStatus();
                      setDeepseekStatus(getDeepSeekStatus());
                    }}
                    className="p-1 rounded hover:bg-pink-pale/10 text-pink-pale/30 hover:text-pink-pale/80 transition-all active:scale-90"
                    title="Reset DeepSeek Rotation"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                  </button>
                </div>
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
