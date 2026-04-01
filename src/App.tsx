import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Lightbulb, 
  FlaskConical, 
  ClipboardCheck, 
  FileText, 
  Loader2, 
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
  Database,
  ChevronRight
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

/* ── Reusable Win2000 Window Component ── */
function WinWindow({ 
  title, 
  icon, 
  children, 
  className = '',
  actions
}: { 
  title: string; 
  icon?: React.ReactNode; 
  children: React.ReactNode; 
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`win-panel ${className}`} style={{ background: '#d4d0c8' }}>
      <div className="win-titlebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
          <span>{title}</span>
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>{actions}</div>}
      </div>
      <div style={{ padding: '8px' }}>
        {children}
      </div>
    </div>
  );
}

/* ── Win2000 Title Bar Buttons ── */
function WinTitleBtn({ label }: { label: string }) {
  return (
    <button 
      className="win-btn" 
      style={{ minWidth: '16px', width: '16px', height: '14px', padding: '0', fontSize: '9px', lineHeight: '1', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {label}
    </button>
  );
}

/* ── Win2000 Section Separator ── */
function WinSeparatorLine() {
  return <div className="win-separator" />;
}

/* ── Win2000 Label ── */
function WinLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span style={{ fontSize: '11px', color: '#000', fontWeight: 'bold' }} className={className}>
      {children}
    </span>
  );
}

/* ── Win2000 Status LED ── */
function WinLed({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '8px', height: '8px',
      borderRadius: '50%',
      background: active ? '#00aa00' : '#cc0000',
      border: '1px solid #888',
      flexShrink: 0,
    }} />
  );
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
      experimentConfig: { ...prev.experimentConfig, ...updates }
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
          try { displayError = JSON.stringify(err); } catch (e) { displayError = String(err); }
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
    const content = state.report.fullMarkdown || `# Research Report: ${state.report.title || state.topic}\nGenerated by Literature Agent\n\n## Abstract\n${state.report.abstract}`.trim();
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

  useEffect(() => {
    if (state.status === 'completed' && state.report) {
      setTimeout(() => exportPDF(), 1000);
    } else if (state.iteration > 0 && (state.status === 'revising' || state.status === 'reporting')) {
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
  const isRunning = state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error';

  return (
    <div style={{ minHeight: '100vh', background: '#008080', fontFamily: 'MS Sans Serif, Microsoft Sans Serif, Tahoma, Arial, sans-serif', fontSize: '11px' }}>
      {/* ── Simulated Window Chrome ── */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '12px 8px' }}>

        {/* ── Application Window ── */}
        <div className="win-panel" style={{ background: '#d4d0c8' }}>
          {/* Title Bar */}
          <div className="win-titlebar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <BrainCircuit size={12} color="#fff" />
              <span style={{ fontWeight: 'bold' }}>Literature Agent v1.1 — Research Automation System</span>
            </div>
            <div style={{ display: 'flex', gap: '2px' }}>
              <WinTitleBtn label="−" />
              <WinTitleBtn label="□" />
              <WinTitleBtn label="✕" />
            </div>
          </div>

          {/* ── Menu Bar ── */}
          <div style={{ background: '#d4d0c8', borderBottom: '1px solid #999', padding: '2px 4px', display: 'flex', gap: '2px' }}>
            {['File', 'Edit', 'View', 'Research', 'Tools', 'Help'].map(item => (
              <button key={item} style={{ background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit' }}
                onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = '#0a246a'; (e.target as HTMLButtonElement).style.color = '#fff'; }}
                onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'none'; (e.target as HTMLButtonElement).style.color = '#000'; }}
              >{item}</button>
            ))}
          </div>

          {/* ── Toolbar ── */}
          <div style={{ background: '#d4d0c8', borderBottom: '1px solid #999', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
              <span style={{ fontSize: '11px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>Research Topic:</span>
              <input
                type="text"
                value={inputTopic}
                onChange={(e) => setInputTopic(e.target.value)}
                placeholder="Enter research topic..."
                className="win-input"
                style={{ flex: 1, maxWidth: '500px' }}
                onKeyDown={(e) => e.key === 'Enter' && runResearch()}
                disabled={isRunning}
              />
              <button
                onClick={runResearch}
                disabled={isRunning || (geminiStatus.available === 0 && deepseekStatus.available === 0)}
                className="win-btn win-btn-default"
                style={{ fontWeight: 'bold' }}
              >
                {isRunning ? 'Running...' : 'Start Research'}
              </button>
            </div>
            {state.iteration > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', background: '#000080', color: '#fff', fontSize: '10px' }}>
                <RefreshCw size={10} className={isRunning ? 'animate-spin' : ''} />
                <span>Iteration: {state.iteration}</span>
              </div>
            )}
          </div>

          {/* ── Progress Tracker ── */}
          <div style={{ background: '#d4d0c8', padding: '6px 8px', borderBottom: '1px solid #999' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              {steps.map((step, idx) => {
                const Icon = step.icon;
                const isActive = currentStepIndex === idx && isRunning;
                const isPast = (currentStepIndex > idx) || isCompleted;
                return (
                  <React.Fragment key={step.id}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px',
                      background: isActive ? '#0a246a' : isPast ? '#000080' : '#d4d0c8',
                      color: (isActive || isPast) ? '#fff' : '#666',
                      borderTop: isActive || isPast ? '1px solid #4444aa' : '1px solid #fff',
                      borderLeft: isActive || isPast ? '1px solid #4444aa' : '1px solid #fff',
                      borderRight: isActive || isPast ? '1px solid #00004a' : '1px solid #888',
                      borderBottom: isActive || isPast ? '1px solid #00004a' : '1px solid #888',
                      fontSize: '10px',
                      fontWeight: isActive ? 'bold' : 'normal',
                      whiteSpace: 'nowrap',
                    }}>
                      {isPast 
                        ? <CheckCircle2 size={10} /> 
                        : isActive 
                          ? <Loader2 size={10} className="animate-spin" /> 
                          : <Icon size={10} />
                      }
                      <span>{step.label}</span>
                    </div>
                    {idx < steps.length - 1 && (
                      <ChevronRight size={10} style={{ color: '#888', flexShrink: 0 }} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* ── Main Content Area ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '8px', padding: '8px', minHeight: '600px' }}>

            {/* ── Left Sidebar ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

              {/* Agent Status Panel */}
              <WinWindow title="Agent Status" icon={<BrainCircuit size={12} color="#fff" />}>
                <div style={{ fontSize: '11px' }}>
                  {state.status === 'idle' && (
                    <p style={{ color: '#555', fontStyle: 'italic', padding: '4px' }}>
                      Enter a research topic above to begin the multi-agent workflow.
                    </p>
                  )}
                  {state.status !== 'idle' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px', background: '#fff', border: '1px inset #888' }}>
                        {state.status !== 'completed' && state.status !== 'error' 
                          ? <Loader2 size={12} className="animate-spin" style={{ color: '#000080' }} />
                          : state.status === 'completed' 
                            ? <CheckCircle2 size={12} style={{ color: '#008000' }} />
                            : <AlertCircle size={12} style={{ color: '#cc0000' }} />
                        }
                        <span style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                          {state.status.replace(/_/g, ' ')}...
                        </span>
                      </div>
                      {state.status === 'searching' && searchingProgress && (
                        <p style={{ fontSize: '10px', color: '#555', fontStyle: 'italic', padding: '2px 4px', animation: 'win-blink 1s infinite' }}>
                          {searchingProgress}
                        </p>
                      )}

                      {/* API Status */}
                      {(geminiStatus.total > 0 || deepseekStatus.total > 0) && (
                        <div>
                          <div className="win-separator" />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>API Infrastructure</span>
                            <button onClick={handleResetAPI} className="win-btn" style={{ fontSize: '9px', minWidth: 'auto', padding: '1px 6px' }}>
                              Reset
                            </button>
                          </div>
                          {deepseekStatus.total > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '2px 0' }}>
                              <span>DeepSeek (Preferred)</span>
                              <span style={{ color: deepseekStatus.available > 0 ? '#008000' : '#cc8800', fontWeight: 'bold' }}>
                                {deepseekStatus.available}/{deepseekStatus.total} keys
                              </span>
                            </div>
                          )}
                          {geminiStatus.total > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '2px 0' }}>
                              <span>Gemini (Fallback)</span>
                              <span style={{ color: geminiStatus.available > 0 ? '#008000' : '#cc8800', fontWeight: 'bold' }}>
                                {geminiStatus.available}/{geminiStatus.total} keys
                              </span>
                            </div>
                          )}
                          {geminiStatus.coolingDown > 0 && (
                            <p style={{ fontSize: '9px', color: geminiStatus.hardQuota > 0 ? '#cc0000' : '#cc8800', fontStyle: 'italic', marginTop: '2px' }}>
                              {geminiStatus.hardQuota > 0
                                ? `${geminiStatus.hardQuota} key(s) reached hard quota`
                                : `${geminiStatus.coolingDown} key(s) cooling down...`}
                            </p>
                          )}
                          {geminiStatus.totalRetries > 0 && (
                            <p style={{ fontSize: '9px', color: '#888', marginTop: '2px' }}>
                              Total retries: {geminiStatus.totalRetries}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error Display */}
                  {state.error && (
                    <div style={{ marginTop: '6px', padding: '6px', background: '#fff0f0', border: '2px inset #cc0000' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <AlertCircle size={12} style={{ color: '#cc0000', flexShrink: 0, marginTop: '1px' }} />
                        <div>
                          <p style={{ fontWeight: 'bold', color: '#cc0000', fontSize: '11px' }}>Error Occurred</p>
                          <p style={{ fontSize: '10px', color: '#444', marginTop: '2px', lineHeight: '1.4' }}>{state.error}</p>
                        </div>
                      </div>
                      {(state.error.includes("API key") || state.error.includes("quota") || state.error.includes("429")) && (
                        <div style={{ marginTop: '4px', padding: '4px', background: '#d4d0c8', border: '1px inset #888' }}>
                          <p style={{ fontSize: '9px', fontWeight: 'bold', marginBottom: '4px' }}>Troubleshooting:</p>
                          <ul style={{ fontSize: '9px', paddingLeft: '12px', color: '#444', lineHeight: '1.5' }}>
                            <li>Check your API keys in Settings → Secrets</li>
                            <li>DeepSeek: VITE_DEEPSEEK_API_KEY_1 (up to 10)</li>
                            <li>Gemini: VITE_GEMINI_API_KEY_1 (up to 32)</li>
                          </ul>
                          <button onClick={handleResetAPI} className="win-btn" style={{ marginTop: '4px', fontSize: '9px', padding: '1px 8px' }}>
                            Reset API Cooldowns
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </WinWindow>

              {/* Simulation Parameters */}
              <WinWindow title="Simulation Parameters" icon={<FlaskConical size={12} color="#fff" />}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <label style={{ fontWeight: 'bold' }}>Dataset Size:</label>
                      <span style={{ fontFamily: 'Courier New', color: '#000080', fontWeight: 'bold' }}>{state.experimentConfig.datasetSize}</span>
                    </div>
                    <input type="range" min="100" max="5000" step="100" value={state.experimentConfig.datasetSize}
                      onChange={(e) => updateExperimentConfig({ datasetSize: parseInt(e.target.value) })}
                      style={{ width: '100%' }}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <label style={{ fontWeight: 'bold' }}>Noise Level:</label>
                      <span style={{ fontFamily: 'Courier New', color: '#000080', fontWeight: 'bold' }}>{(state.experimentConfig.noiseLevel * 100).toFixed(0)}%</span>
                    </div>
                    <input type="range" min="0" max="0.5" step="0.01" value={state.experimentConfig.noiseLevel}
                      onChange={(e) => updateExperimentConfig({ noiseLevel: parseFloat(e.target.value) })}
                      style={{ width: '100%' }}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <label style={{ fontWeight: 'bold' }}>Feature Complexity:</label>
                      <span style={{ fontFamily: 'Courier New', color: '#000080', fontWeight: 'bold' }}>{state.experimentConfig.featureComplexity}</span>
                    </div>
                    <input type="range" min="2" max="50" step="1" value={state.experimentConfig.featureComplexity}
                      onChange={(e) => updateExperimentConfig({ featureComplexity: parseInt(e.target.value) })}
                      style={{ width: '100%' }}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Data Type:</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px' }}>
                      {(['classification', 'regression', 'clustering'] as const).map((type) => (
                        <button key={type} onClick={() => updateExperimentConfig({ dataType: type })} disabled={isRunning}
                          className="win-btn"
                          style={{
                            fontSize: '9px', padding: '2px 0', minWidth: 'auto', textTransform: 'capitalize',
                            background: state.experimentConfig.dataType === type ? '#000080' : '#d4d0c8',
                            color: state.experimentConfig.dataType === type ? '#fff' : '#000',
                          }}>
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </WinWindow>

              {/* Experimental Results Panel */}
              {state.experiment && (
                <WinWindow title="Experimental Results" icon={<BarChartIcon size={12} color="#fff" />}>
                  <div style={{ fontSize: '11px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '8px' }}>
                      <div style={{ padding: '6px', background: '#fff', border: '2px inset #888', textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#000080', fontFamily: 'Courier New' }}>
                          {((state.experiment?.accuracy || 0) * 100).toFixed(1)}%
                        </div>
                        <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase' }}>Accuracy</div>
                      </div>
                      <div style={{ padding: '6px', background: '#fff', border: '2px inset #888', textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#000080', fontFamily: 'Courier New' }}>
                          {((state.experiment?.f1Score || 0) * 100).toFixed(1)}%
                        </div>
                        <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase' }}>F1 Score</div>
                      </div>
                    </div>

                    {/* Bar Chart */}
                    <div style={{ marginBottom: '8px' }}>
                      <p style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <TrendingUp size={10} /> Performance vs Baselines
                      </p>
                      <div style={{ height: '160px', background: '#fff', border: '2px inset #888', padding: '4px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={[
                            { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                            ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                          ]} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ccc" vertical={false} />
                            <XAxis dataKey="name" stroke="#666" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#666" fontSize={9} tickLine={false} axisLine={false} domain={[0, 100]} />
                            <Tooltip contentStyle={{ background: '#d4d0c8', border: '2px outset #fff', fontSize: '10px', fontFamily: 'MS Sans Serif, Arial, sans-serif' }} />
                            <Bar dataKey="accuracy" radius={[0, 0, 0, 0]}>
                              {([
                                { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                                ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                              ]).map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={index === 0 ? '#000080' : '#a0a0c0'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Leaderboard */}
                    {state.experiment.leaderboard && state.experiment.leaderboard.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <p style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>AutoGluon Leaderboard</p>
                        <div style={{ background: '#fff', border: '2px inset #888', padding: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                          {state.experiment.leaderboard.map((m, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '1px 0', borderBottom: idx < state.experiment!.leaderboard!.length - 1 ? '1px solid #eee' : 'none' }}>
                              <span style={{ color: m.stack_level > 0 ? '#000080' : '#000' }}>{idx + 1}. {m.model}</span>
                              <span style={{ fontFamily: 'Courier New', fontWeight: 'bold', color: '#000080' }}>{(m.score_test * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Feature Importance */}
                    {state.experiment.featureImportance && Object.keys(state.experiment.featureImportance).length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <p style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>Feature Importance</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {Object.entries(state.experiment.featureImportance).sort(([, a], [, b]) => b - a).slice(0, 5).map(([feature, importance], idx) => (
                            <div key={idx}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                                <span>{feature}</span>
                                <span style={{ fontFamily: 'Courier New', color: '#000080' }}>{(importance * 100).toFixed(1)}%</span>
                              </div>
                              <div className="win-progress">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${importance * 100}%` }} className="win-progress-fill" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reviewer Ratings Chart */}
                    {state.reviewerCritiques && state.reviewerCritiques.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div className="win-separator" />
                        <p style={{ fontWeight: 'bold', fontSize: '10px', margin: '4px 0' }}>Reviewer Ratings</p>
                        <div style={{ height: '80px', background: '#fff', border: '2px inset #888' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={state.reviewerCritiques.map((c, i) => ({ name: `R${i+1}`, rating: c.rating }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#ccc" vertical={false} />
                              <XAxis dataKey="name" stroke="#666" fontSize={9} tickLine={false} axisLine={false} />
                              <YAxis stroke="#666" fontSize={9} tickLine={false} axisLine={false} domain={[0, 10]} />
                              <Tooltip contentStyle={{ background: '#d4d0c8', border: '2px outset #fff', fontSize: '10px' }} />
                              <Line type="monotone" dataKey="rating" stroke="#000080" strokeWidth={2} dot={{ fill: '#000080', r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Execution Logs */}
                    <div>
                      <div className="win-separator" />
                      <p style={{ fontWeight: 'bold', fontSize: '10px', margin: '4px 0' }}>Execution Logs</p>
                      <div style={{ background: '#000', color: '#c0c0c0', fontFamily: 'Courier New', fontSize: '9px', padding: '4px', maxHeight: '100px', overflowY: 'auto', border: '2px inset #888', lineHeight: '1.4' }}>
                        {(Array.isArray(state.experiment.logs) ? state.experiment.logs : []).map((log, i) => (
                          <div key={i}><span style={{ color: '#00aa00' }}>[{i+1}]</span> {log}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </WinWindow>
              )}
            </div>

            {/* ── Right Content Area ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
              <AnimatePresence mode="wait">

                {/* Welcome screen when idle */}
                {state.status === 'idle' && !state.papers.length && (
                  <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <WinWindow title="Welcome to Literature Agent" icon={<BrainCircuit size={12} color="#fff" />}>
                      <div style={{ padding: '16px', textAlign: 'center', color: '#555' }}>
                        <BrainCircuit size={48} style={{ color: '#000080', margin: '0 auto 12px' }} />
                        <p style={{ fontSize: '13px', fontWeight: 'bold', color: '#000080', marginBottom: '8px' }}>Literature Agent v1.1</p>
                        <p style={{ fontSize: '11px', marginBottom: '8px' }}>Multi-Agent AI Research Automation System</p>
                        <p style={{ fontSize: '10px', color: '#888' }}>Enter a research topic in the toolbar above and click <strong>Start Research</strong> to begin the automated literature review, hypothesis generation, and experimental design pipeline.</p>
                      </div>
                    </WinWindow>
                  </motion.div>
                )}

                {/* Literature Results */}
                {state.papers.length > 0 && (
                  <motion.section key="literature-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow 
                      title={`Literature Review — ${state.papers.length} Papers Found`}
                      icon={<Search size={12} color="#fff" />}
                      actions={
                        state.status !== 'searching' && state.status !== 'filtering_relevance' ? (
                          <span style={{ fontSize: '9px', background: '#008000', color: '#fff', padding: '1px 6px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <ClipboardCheck size={9} /> Citations Verified
                          </span>
                        ) : undefined
                      }
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {(state.papers || []).map((paper, i) => (
                          <div key={`${paper.link}-${i}`} className="win-panel-inner" style={{ padding: '6px', background: '#fff' }}>
                            {paper.verified === false ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#cc8800', fontWeight: 'bold', marginBottom: '3px' }}>
                                <AlertCircle size={10} /> Unverified Citation
                              </div>
                            ) : paper.verified === true ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#008000', fontWeight: 'bold', marginBottom: '3px' }}>
                                <CheckCircle2 size={10} /> Verified
                              </div>
                            ) : null}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                              <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#000080', margin: 0 }}>{paper.title}</h3>
                              <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                                <button onClick={() => copyToClipboard(paper.citation, i)} className="win-btn" style={{ minWidth: 'auto', padding: '1px 4px', fontSize: '9px' }}
                                  title="Copy Citation">
                                  {copiedIndex === i ? <CheckCircle2 size={10} style={{ color: '#008000' }} /> : <Copy size={10} />}
                                </button>
                                <a href={paper.link} target="_blank" rel="noreferrer" className="win-btn" style={{ minWidth: 'auto', padding: '1px 4px', fontSize: '9px', display: 'flex', alignItems: 'center', textDecoration: 'none', color: '#000' }}>
                                  <ExternalLink size={10} />
                                </a>
                              </div>
                            </div>
                            <p style={{ fontSize: '10px', color: '#555', lineHeight: '1.4', marginBottom: '4px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any }}>{paper.summary}</p>
                            
                            {paper.keyFindings && paper.keyFindings.length > 0 && (
                              <div style={{ marginBottom: '4px' }}>
                                <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', marginBottom: '2px' }}>Key Findings</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  {paper.keyFindings.map((finding, idx) => (
                                    <div key={idx} style={{ display: 'flex', gap: '4px', padding: '2px 4px', background: '#e8e8f8', border: '1px solid #aaaacc', fontSize: '10px' }}>
                                      <span style={{ color: '#000080', fontWeight: 'bold' }}>▶</span>
                                      <span style={{ color: '#333' }}>{finding}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div style={{ background: '#f5f5f5', border: '1px inset #888', padding: '3px 6px', marginBottom: '4px' }}>
                              <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#888', marginBottom: '2px' }}>Citation</p>
                              <p style={{ fontSize: '9px', fontFamily: 'Courier New', color: '#555', lineHeight: '1.4' }}>{paper.citation}</p>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                              {(paper.authors || []).slice(0, 3).map((author, j) => (
                                <span key={j} style={{ fontSize: '9px', padding: '1px 5px', background: '#d4d0c8', border: '1px outset #fff', color: '#333' }}>{author}</span>
                              ))}
                              {(paper.authors || []).length > 3 && (
                                <span style={{ fontSize: '9px', color: '#888', fontStyle: 'italic' }}>+{paper.authors.length - 3} more</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

                {/* Gap Identification */}
                {state.gapIdentification && (
                  <motion.section key="gap-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow title="Research Gap Analysis" icon={<Lightbulb size={12} color="#fff" />}
                      actions={<span style={{ fontSize: '9px', color: '#ffdd88' }}>GapIdentificationAgent</span>}>
                      <div>
                        <p style={{ fontSize: '11px', color: '#555', fontStyle: 'italic', marginBottom: '8px', padding: '4px', background: '#fffff0', border: '1px inset #888', lineHeight: '1.5' }}>
                          {state.gapIdentification.summary}
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                          {(state.gapIdentification.gaps || []).map((gap, i) => (
                            <div key={i} className="win-panel-inner" style={{ padding: '6px', background: '#fff' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                <div style={{ width: '16px', height: '16px', background: '#000080', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', flexShrink: 0 }}>
                                  {i + 1}
                                </div>
                                <p style={{ fontSize: '11px', fontWeight: 'bold', margin: 0 }}>{gap.description}</p>
                              </div>
                              <div className="win-separator" />
                              <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666', marginTop: '4px' }}>EVIDENCE</p>
                              <p style={{ fontSize: '10px', color: '#555', fontStyle: 'italic', marginBottom: '4px' }}>{gap.evidence}</p>
                              <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666' }}>POTENTIAL IMPACT</p>
                              <p style={{ fontSize: '10px', color: '#333' }}>{gap.potentialImpact}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

                {/* Hypothesis */}
                {state.hypothesis && (
                  <motion.section key="hypothesis-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow title="Proposed Hypothesis" icon={<Lightbulb size={12} color="#fff" />}
                      actions={<span style={{ fontSize: '9px', color: '#ffdd88' }}>HypothesisAgent</span>}>
                      <div style={{ background: '#fff', border: '2px inset #888', padding: '8px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#000080', marginBottom: '6px' }}>{state.hypothesis.title}</h3>
                        <p style={{ fontSize: '11px', color: '#333', lineHeight: '1.5', marginBottom: '8px' }}>{state.hypothesis.description}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                          <div style={{ background: '#d4d0c8', border: '2px inset #888', padding: '6px' }}>
                            <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', marginBottom: '3px' }}>Rationale</p>
                            <p style={{ fontSize: '10px', color: '#444', lineHeight: '1.4' }}>{state.hypothesis.rationale}</p>
                          </div>
                          <div style={{ background: '#d4d0c8', border: '2px inset #888', padding: '6px' }}>
                            <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', marginBottom: '3px' }}>Expected Outcome</p>
                            <p style={{ fontSize: '10px', color: '#444', lineHeight: '1.4' }}>{state.hypothesis.expectedOutcome}</p>
                          </div>
                        </div>

                        {state.contributions.length > 0 && (
                          <>
                            <div className="win-separator" />
                            <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', margin: '6px 0 4px' }}>Key Contributions</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                              {(state.contributions || []).map((c, i) => (
                                <div key={i} style={{ padding: '4px 6px', background: '#d4d0c8', border: '2px inset #888' }}>
                                  <p style={{ fontSize: '10px', fontWeight: 'bold', color: '#000080', marginBottom: '2px' }}>{c.type}</p>
                                  <p style={{ fontSize: '10px', color: '#555' }}>{c.description}</p>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

                {/* Math Formalization */}
                {state.mathFormalization && (
                  <motion.section key="math-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow title="Mathematical Formalization" icon={<Database size={12} color="#fff" />}
                      actions={<span style={{ fontSize: '9px', color: '#ffdd88' }}>MathFormalizerAgent</span>}>
                      <div>
                        <div style={{ background: '#000', color: '#c0ffc0', fontFamily: 'Courier New', fontSize: '10px', padding: '8px', border: '2px inset #888', lineHeight: '1.6' }}>
                          <div style={{ marginBottom: '8px' }}>
                            <span style={{ color: '#ffff00', fontWeight: 'bold' }}>PROBLEM FORMULATION</span>
                            <div style={{ marginTop: '4px', color: '#c0c0ff' }}>{state.mathFormalization.problemFormulation}</div>
                          </div>
                          <div style={{ marginBottom: '8px', borderTop: '1px solid #333', paddingTop: '8px' }}>
                            <span style={{ color: '#ffff00', fontWeight: 'bold' }}>NOTATION</span>
                            <div style={{ marginTop: '4px' }}>
                              {state.mathFormalization.notation.map((n, i) => (
                                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '2px' }}>
                                  <span style={{ color: '#00ffff', minWidth: '60px' }}>{n.symbol}</span>
                                  <span style={{ color: '#c0c0c0' }}>{n.definition}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div style={{ marginBottom: '8px', borderTop: '1px solid #333', paddingTop: '8px' }}>
                            <span style={{ color: '#ffff00', fontWeight: 'bold' }}>OBJECTIVE FUNCTION</span>
                            <div style={{ marginTop: '4px', color: '#c0ffc0', padding: '4px', background: '#001100' }}>{state.mathFormalization.objectiveFunction}</div>
                          </div>
                          <div style={{ borderTop: '1px solid #333', paddingTop: '8px' }}>
                            <span style={{ color: '#ffff00', fontWeight: 'bold' }}>ALGORITHM STEPS</span>
                            <div style={{ marginTop: '4px' }}>
                              {state.mathFormalization.algorithmSteps.map((step, i) => (
                                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '2px' }}>
                                  <span style={{ color: '#00ff00', minWidth: '20px' }}>{i+1}.</span>
                                  <span style={{ color: '#c0c0c0' }}>{step}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

                {/* Experiment Plan */}
                {state.experimentPlan && (
                  <motion.section key="plan-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow title="Experimental Design" icon={<FlaskConical size={12} color="#fff" />}
                      actions={<span style={{ fontSize: '9px', color: '#ffdd88' }}>ExperimentDesignAgent</span>}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <div className="win-panel-inner" style={{ padding: '6px', background: '#fff' }}>
                          <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Protocol &amp; Metrics</p>
                          <p style={{ fontSize: '10px', color: '#555', marginBottom: '6px', lineHeight: '1.4' }}>{state.experimentPlan.protocol}</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {(state.experimentPlan.metrics || []).map((m, i) => (
                              <span key={i} style={{ fontSize: '9px', padding: '1px 5px', background: '#d4d0c8', border: '1px outset #fff' }}>{m}</span>
                            ))}
                          </div>
                        </div>
                        {state.datasetCard && (
                          <div className="win-panel-inner" style={{ padding: '6px', background: '#fff' }}>
                            <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Dataset Card</p>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000080' }}>{state.datasetCard.name}</span>
                              <span style={{ fontSize: '9px', padding: '1px 5px', background: '#000080', color: '#fff' }}>{state.datasetCard.size}</span>
                            </div>
                            <p style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.4', fontStyle: 'italic' }}>{state.datasetCard.description}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                              {(state.datasetCard.features || []).map((f, i) => (
                                <span key={i} style={{ fontSize: '9px', fontFamily: 'Courier New', color: '#666' }}>#{f}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

                {/* Reviewer Critiques */}
                {state.reviewerCritiques.length > 0 && (
                  <motion.section key={`critique-section-${state.iteration}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow 
                      title={`Simulated Peer Review — Iteration ${state.iteration}`}
                      icon={<ClipboardCheck size={12} color="#fff" />}
                      actions={<span style={{ fontSize: '9px', color: '#ffdd88' }}>ReviewerSimulatorAgent</span>}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                        {(state.reviewerCritiques || []).map((critique, i) => (
                          <div key={i} className="win-panel-inner" style={{ padding: '6px', background: '#fff' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 'bold' }}>Reviewer #{i+1}</span>
                              <span style={{
                                fontSize: '10px', fontWeight: 'bold', padding: '1px 6px',
                                background: critique.rating >= 7 ? '#008000' : critique.rating >= 5 ? '#cc8800' : '#cc0000',
                                color: '#fff'
                              }}>
                                {critique.rating}/10
                              </span>
                            </div>
                            <div className="win-separator" />
                            <div style={{ marginTop: '4px' }}>
                              <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#008000', textTransform: 'uppercase', marginBottom: '2px' }}>Strengths</p>
                              <ul style={{ fontSize: '9px', paddingLeft: '12px', color: '#555', margin: '0 0 4px 0', lineHeight: '1.5' }}>
                                {(critique.strengths || []).map((s, j) => <li key={j}>{s}</li>)}
                              </ul>
                              <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#cc0000', textTransform: 'uppercase', marginBottom: '2px' }}>Weaknesses</p>
                              <ul style={{ fontSize: '9px', paddingLeft: '12px', color: '#555', margin: '0 0 4px 0', lineHeight: '1.5' }}>
                                {(critique.weaknesses || []).map((w, j) => <li key={j}>{w}</li>)}
                              </ul>
                              <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#000080', textTransform: 'uppercase', marginBottom: '2px' }}>Novelty Check</p>
                              <p style={{ fontSize: '9px', color: '#555', fontStyle: 'italic', lineHeight: '1.4' }}>&quot;{critique.noveltyCritique}&quot;</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

                {/* Final Report */}
                {state.report && (
                  <motion.section key="report-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <WinWindow 
                      title="Research Report"
                      icon={<FileText size={12} color="#fff" />}
                      actions={
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {state.factualityResult && (
                            <span style={{
                              fontSize: '9px', padding: '1px 6px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '3px',
                              background: state.factualityResult.isPassed ? '#008000' : '#cc0000', color: '#fff'
                            }}>
                              <ClipboardCheck size={9} />
                              Factuality: {(state.factualityResult.faithfulnessScore * 100).toFixed(0)}%
                            </span>
                          )}
                          <span style={{ fontSize: '9px', color: '#ffdd88' }}>ReportAgent</span>
                        </div>
                      }
                    >
                      {state.factualityResult && !state.factualityResult.isPassed && (
                        <div style={{ marginBottom: '8px', padding: '6px', background: '#fff0f0', border: '2px inset #cc0000', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <AlertCircle size={14} style={{ color: '#cc0000', flexShrink: 0 }} />
                          <div>
                            <p style={{ fontWeight: 'bold', color: '#cc0000', marginBottom: '2px' }}>Factuality Warning</p>
                            <p style={{ fontSize: '10px', color: '#555' }}>
                              {state.factualityResult.unsupportedClaims.length} potentially unsupported claim(s) found. Review with caution.
                            </p>
                            <ul style={{ fontSize: '9px', paddingLeft: '12px', marginTop: '4px', color: '#888' }}>
                              {state.factualityResult.unsupportedClaims.map((claim, i) => (
                                <li key={i}>&quot;{claim.claim}&quot; — {claim.reason}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      <div ref={reportRef} style={{ background: '#fff', border: '2px inset #888', padding: '16px' }}>
                        {/* Report Header */}
                        <div style={{ textAlign: 'center', borderBottom: '2px solid #000080', paddingBottom: '12px', marginBottom: '16px' }}>
                          <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#000080', marginBottom: '4px' }}>
                            {state.report.title || state.topic}
                          </h1>
                          <p style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            Generated by Literature Agent • {new Date().toLocaleDateString()}
                          </p>
                        </div>

                        {/* Abstract */}
                        <div style={{ marginBottom: '16px', padding: '8px 12px', background: '#fffff0', border: '1px solid #cccc88', borderLeft: '4px solid #000080' }}>
                          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '4px' }}>Abstract</p>
                          <p style={{ fontSize: '11px', lineHeight: '1.6', color: '#333', fontStyle: 'italic' }}>{state.report.abstract}</p>
                        </div>

                        {/* Hypothesis */}
                        {state.hypothesis && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#f0f0ff', border: '1px solid #aaaacc' }}>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '4px' }}>Research Hypothesis</p>
                            <h4 style={{ fontSize: '12px', fontWeight: 'bold', color: '#000', marginBottom: '4px' }}>{state.hypothesis.title}</h4>
                            <p style={{ fontSize: '11px', color: '#555', lineHeight: '1.5' }}>{state.hypothesis.description}</p>
                          </div>
                        )}

                        {/* Experiment Plan */}
                        {state.experimentPlan && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#f8f8f8', border: '1px solid #ccc' }}>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '8px' }}>Experiment Design &amp; Parameters</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                              <div>
                                <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>Simulation Params</p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
                                  {[
                                    ['Dataset Size', state.experimentConfig.datasetSize],
                                    ['Noise Level', `${(state.experimentConfig.noiseLevel || 0) * 100}%`],
                                    ['Complexity', `${state.experimentConfig.featureComplexity} features`],
                                    ['Task Type', state.experimentConfig.dataType],
                                  ].map(([label, val]) => (
                                    <div key={String(label)}>
                                      <span style={{ display: 'block', color: '#888', fontSize: '9px' }}>{label}</span>
                                      <span style={{ fontFamily: 'Courier New', fontWeight: 'bold' }}>{String(val)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>Evaluation Protocol</p>
                                <p style={{ fontSize: '10px', color: '#555', lineHeight: '1.4', fontStyle: 'italic' }}>{state.experimentPlan.protocol}</p>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', borderTop: '1px solid #ddd', paddingTop: '8px' }}>
                              {[
                                { label: 'Datasets', items: state.experimentPlan.datasets },
                                { label: 'Baselines', items: state.experimentPlan.baselines },
                                { label: 'Metrics', items: state.experimentPlan.metrics },
                              ].map(({ label, items }) => (
                                <div key={label}>
                                  <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: '3px' }}>{label}</p>
                                  <ul style={{ fontSize: '10px', paddingLeft: '12px', color: '#555', lineHeight: '1.5', margin: 0 }}>
                                    {items.map((item, i) => <li key={i}>{item}</li>)}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Math Formalization */}
                        {state.mathFormalization && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#000', color: '#c0ffc0', fontFamily: 'Courier New', fontSize: '10px', border: '1px solid #333', lineHeight: '1.6' }}>
                            <p style={{ color: '#ffff00', fontWeight: 'bold', marginBottom: '4px' }}>MATHEMATICAL FORMALIZATION</p>
                            <div><span style={{ color: '#00ffff' }}>OBJECTIVE: </span>{state.mathFormalization.objectiveFunction}</div>
                          </div>
                        )}

                        {/* Contributions */}
                        {state.contributions && state.contributions.length > 0 && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#f8f8f8', border: '1px solid #ccc' }}>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '6px' }}>Key Contributions</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                              {state.contributions.map((c, i) => (
                                <div key={i} style={{ padding: '4px 6px', background: '#d4d0c8', border: '2px outset #fff' }}>
                                  <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#000080', marginBottom: '2px' }}>{c.type}</p>
                                  <p style={{ fontSize: '10px', color: '#555' }}>{c.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Intro + Methodology */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                          <div>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', borderBottom: '2px solid #000080', paddingBottom: '3px', marginBottom: '6px' }}>Introduction</p>
                            <div className="win-prose" style={{ fontSize: '10px', color: '#333', lineHeight: '1.6' }}><Markdown>{state.report.introduction}</Markdown></div>
                          </div>
                          <div>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', borderBottom: '2px solid #000080', paddingBottom: '3px', marginBottom: '6px' }}>Methodology</p>
                            <div className="win-prose" style={{ fontSize: '10px', color: '#333', lineHeight: '1.6' }}><Markdown>{state.report.methodology}</Markdown></div>
                          </div>
                        </div>

                        {/* Results */}
                        <div style={{ marginBottom: '16px', padding: '8px', background: '#f8f8f8', border: '1px solid #ccc' }}>
                          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', textAlign: 'center', marginBottom: '8px' }}>Experimental Results &amp; Visual Evidence</p>
                          <div className="win-prose" style={{ fontSize: '10px', color: '#333', lineHeight: '1.6', marginBottom: '8px' }}><Markdown>{state.report.results}</Markdown></div>

                          {state.experiment && (
                            <div style={{ marginTop: '8px', borderTop: '1px solid #ddd', paddingTop: '8px' }}>
                              <div style={{ height: '160px', background: '#fff', border: '1px inset #888', padding: '4px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={[
                                    { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                                    ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                                  ]}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ccc" vertical={false} />
                                    <XAxis dataKey="name" stroke="#666" fontSize={9} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#666" fontSize={9} tickLine={false} axisLine={false} domain={[0, 100]} />
                                    <Bar dataKey="accuracy">
                                      {[
                                        { name: 'Proposed', accuracy: state.experiment.accuracy * 100 },
                                        ...(Array.isArray(state.experiment.baselines) ? state.experiment.baselines : []).map(b => ({ name: b.name, accuracy: b.accuracy * 100 }))
                                      ].map((entry, index) => (
                                        <Cell key={index} fill={index === 0 ? '#000080' : '#a0a0c0'} />
                                      ))}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>

                              {state.experiment.leaderboard && (
                                <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                  <div style={{ padding: '4px', background: '#fff', border: '1px inset #888' }}>
                                    <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '4px' }}>AutoGluon Leaderboard</p>
                                    {state.experiment.leaderboard.map((m, idx) => (
                                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', padding: '1px 0' }}>
                                        <span>{m.model}</span>
                                        <span style={{ fontFamily: 'Courier New', color: '#000080' }}>{(m.score_test * 100).toFixed(1)}%</span>
                                      </div>
                                    ))}
                                  </div>
                                  {state.experiment.featureImportance && (
                                    <div style={{ padding: '4px', background: '#fff', border: '1px inset #888' }}>
                                      <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '4px' }}>Feature Importance</p>
                                      {Object.entries(state.experiment.featureImportance).sort(([,a],[,b]) => b-a).slice(0,5).map(([feature, importance], idx) => (
                                        <div key={idx} style={{ marginBottom: '4px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                                            <span>{feature}</span>
                                            <span style={{ fontFamily: 'Courier New', color: '#000080' }}>{(importance * 100).toFixed(1)}%</span>
                                          </div>
                                          <div className="win-progress" style={{ height: '8px' }}>
                                            <div className="win-progress-fill" style={{ width: `${importance * 100}%` }} />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Peer Review */}
                        {state.reviewerCritiques && state.reviewerCritiques.length > 0 && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#f8f8f8', border: '1px solid #ccc' }}>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', textAlign: 'center', marginBottom: '8px' }}>Peer Review Analysis</p>
                            <div style={{ height: '120px', background: '#fff', border: '1px inset #888', marginBottom: '8px' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={state.reviewerCritiques.map((c, i) => ({ name: `R${i+1}`, rating: c.rating }))}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
                                  <XAxis dataKey="name" stroke="#666" fontSize={9} />
                                  <YAxis stroke="#666" fontSize={9} domain={[0, 10]} />
                                  <Line type="monotone" dataKey="rating" stroke="#000080" strokeWidth={2} dot={{ fill: '#000080', r: 3 }} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                              {state.reviewerCritiques.map((c, i) => (
                                <div key={i} style={{ padding: '4px', background: '#fff', border: '1px inset #888' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                                    <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#000080' }}>Reviewer {i+1}</span>
                                    <span style={{ fontSize: '9px', fontFamily: 'Courier New', color: '#000080' }}>{c.rating}/10</span>
                                  </div>
                                  <ul style={{ fontSize: '8px', paddingLeft: '10px', color: '#555', lineHeight: '1.4', margin: '0 0 3px 0' }}>
                                    {c.weaknesses.slice(0, 2).map((w, j) => <li key={j}>{w}</li>)}
                                  </ul>
                                  <p style={{ fontSize: '8px', color: '#555', fontStyle: 'italic' }}>&quot;{c.noveltyCritique.slice(0, 80)}...&quot;</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Dataset Card */}
                        {state.datasetCard && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#f8f8f8', border: '1px solid #ccc' }}>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '6px' }}>Dataset Description</p>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 'bold', color: '#000080', fontSize: '12px' }}>{state.datasetCard.name}</span>
                              <span style={{ fontSize: '9px', padding: '1px 6px', background: '#000080', color: '#fff' }}>{state.datasetCard.size}</span>
                            </div>
                            <p style={{ fontSize: '10px', color: '#555', fontStyle: 'italic', lineHeight: '1.5', marginBottom: '6px' }}>{state.datasetCard.description}</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '10px' }}>
                              <div>
                                <span style={{ color: '#888', fontSize: '9px', display: 'block', marginBottom: '2px' }}>SOURCE</span>
                                <span style={{ color: '#444' }}>{state.datasetCard.source}</span>
                              </div>
                              <div>
                                <span style={{ color: '#888', fontSize: '9px', display: 'block', marginBottom: '2px' }}>FEATURES</span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                  {state.datasetCard.features.map((f, i) => (
                                    <span key={i} style={{ fontSize: '9px', fontFamily: 'Courier New', color: '#666' }}>#{f}</span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Execution Logs */}
                        {state.experiment && (
                          <div style={{ marginBottom: '16px', padding: '8px', background: '#f8f8f8', border: '1px solid #ccc' }}>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '4px' }}>Experimental Evidence (Execution Logs)</p>
                            <div style={{ background: '#000', color: '#c0c0c0', fontFamily: 'Courier New', fontSize: '9px', padding: '6px', maxHeight: '150px', overflowY: 'auto', lineHeight: '1.4' }}>
                              {state.experiment.logs.map((log, i) => (
                                <div key={i}><span style={{ color: '#00aa00' }}>[{i+1}]</span> {log}</div>
                              ))}
                            </div>
                            <p style={{ fontSize: '9px', fontWeight: 'bold', color: '#666', margin: '4px 0 2px', textTransform: 'uppercase' }}>Implementation Details</p>
                            <p style={{ fontSize: '9px', color: '#555', fontStyle: 'italic' }}>{state.experiment.implementationDetails}</p>
                          </div>
                        )}

                        {/* Discussion + Conclusion */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                          <div>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', borderBottom: '2px solid #000080', paddingBottom: '3px', marginBottom: '6px' }}>Discussion</p>
                            <div className="win-prose" style={{ fontSize: '10px', color: '#333', lineHeight: '1.6' }}><Markdown>{state.report.discussion}</Markdown></div>
                          </div>
                          <div>
                            <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', borderBottom: '2px solid #000080', paddingBottom: '3px', marginBottom: '6px' }}>Conclusion</p>
                            <div className="win-prose" style={{ fontSize: '10px', color: '#333', lineHeight: '1.6' }}><Markdown>{state.report.conclusion}</Markdown></div>
                          </div>
                        </div>

                        {/* References */}
                        <div style={{ borderTop: '2px solid #000080', paddingTop: '8px' }}>
                          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000080', marginBottom: '6px' }}>References</p>
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {(state.report.references || []).map((ref, i) => (
                              <li key={i} style={{ fontSize: '9px', fontFamily: 'Courier New', color: '#555', lineHeight: '1.6', borderBottom: '1px solid #eee', padding: '2px 0' }}>
                                <span style={{ color: '#000080', fontWeight: 'bold' }}>[{i+1}]</span> {ref}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Export Buttons */}
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '8px', padding: '8px 0', borderTop: '1px solid #999' }}>
                        <button onClick={exportMarkdown} className="win-btn" style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '140px', justifyContent: 'center' }}>
                          <FileText size={12} /> Export Markdown
                        </button>
                        <button onClick={exportPDF} className="win-btn win-btn-default" style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '120px', justifyContent: 'center', background: '#000080', color: '#fff' }}>
                          <Download size={12} /> Export PDF
                        </button>
                        <button onClick={() => window.print()} className="win-btn" style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '100px', justifyContent: 'center' }}>
                          <Printer size={12} /> Print
                        </button>
                      </div>
                    </WinWindow>
                  </motion.section>
                )}

              </AnimatePresence>
            </div>
          </div>

          {/* ── Status Bar ── */}
          <div className="win-statusbar" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid #888' }}>
            <div className="win-panel-inner" style={{ padding: '1px 8px', display: 'flex', alignItems: 'center', gap: '4px', background: '#d4d0c8' }}>
              <span style={{ fontSize: '10px', fontWeight: 'bold' }}>Literature Agent v1.1</span>
            </div>

            {/* Gemini Status */}
            <div className="win-panel-inner" style={{ padding: '1px 8px', display: 'flex', alignItems: 'center', gap: '4px', background: '#d4d0c8' }}>
              <WinLed active={geminiStatus.available > 0} />
              <span style={{ fontSize: '10px' }}>Gemini: A:{geminiStatus.available} C:{geminiStatus.coolingDown} F:{geminiStatus.failed} T:{geminiStatus.total}</span>
              <button onClick={() => { resetGeminiStatus(); setGeminiStatus(getGeminiStatus()); }} title="Reset Gemini" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center' }}>
                <RefreshCw size={9} style={{ color: '#666' }} />
              </button>
            </div>

            {/* DeepSeek Status */}
            <div className="win-panel-inner" style={{ padding: '1px 8px', display: 'flex', alignItems: 'center', gap: '4px', background: '#d4d0c8' }}>
              <WinLed active={deepseekStatus.available > 0} />
              <span style={{ fontSize: '10px' }}>DeepSeek: A:{deepseekStatus.available} C:{deepseekStatus.coolingDown} F:{deepseekStatus.failed} T:{deepseekStatus.total}</span>
              <button onClick={() => { resetDeepSeekStatus(); setDeepseekStatus(getDeepSeekStatus()); }} title="Reset DeepSeek" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center' }}>
                <RefreshCw size={9} style={{ color: '#666' }} />
              </button>
            </div>

            <div style={{ marginLeft: 'auto' }}>
              <div className="win-panel-inner" style={{ padding: '1px 8px', background: '#d4d0c8' }}>
                <span style={{ fontSize: '10px' }}>Powered by Gemini 3.1 &amp; arXiv API</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden Snapshot for PDF */}
      <div className="hidden">
        <div ref={snapshotRef} style={{ padding: '48px', background: '#fff', color: '#000', fontFamily: 'Arial, sans-serif' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Research Snapshot</h1>
            <p style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>
              Iteration {state.iteration} • {state.status} • {new Date().toLocaleString()}
            </p>
            <p style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '8px' }}>{state.topic}</p>
          </div>
          {state.hypothesis && (
            <section style={{ marginBottom: '24px', padding: '16px', border: '1px solid #ccc' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#000080', marginBottom: '8px' }}>Hypothesis</h2>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>{state.hypothesis.title}</h3>
              <p style={{ fontSize: '11px', lineHeight: '1.5' }}>{state.hypothesis.description}</p>
            </section>
          )}
          {state.experiment && (
            <section style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#000080', marginBottom: '8px' }}>Experimental Results</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <div style={{ padding: '12px', background: '#e8e8ff', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{((state.experiment?.accuracy || 0) * 100).toFixed(1)}%</div>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase' }}>Accuracy</div>
                </div>
                <div style={{ padding: '12px', background: '#e8e8ff', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{((state.experiment?.f1Score || 0) * 100).toFixed(1)}%</div>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase' }}>F1 Score</div>
                </div>
              </div>
              <div style={{ fontFamily: 'Courier New', background: '#111', color: '#ccc', padding: '8px', fontSize: '9px', lineHeight: '1.4', maxHeight: '150px', overflow: 'hidden' }}>
                {state.experiment?.logs?.slice(-20).map((log, i) => <div key={i}>{log}</div>)}
              </div>
            </section>
          )}
          {state.papers.length > 0 && (
            <section>
              <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#000080', marginBottom: '8px' }}>Key References</h2>
              {state.papers.slice(0, 10).map((paper, i) => (
                <div key={i} style={{ fontSize: '10px', marginBottom: '4px' }}>
                  <strong>[{i+1}]</strong> {paper.title} ({paper.authors?.join(', ')})
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
