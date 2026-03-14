export interface Paper {
  title: string;
  summary: string;
  authors: string[];
  published: string;
  link: string;
  citation: string;
}

export interface Hypothesis {
  title: string;
  description: string;
  rationale: string;
  expectedOutcome: string;
}

export interface ExperimentResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  details: string;
  logs: string[];
}

export interface Critique {
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  overallRating: number;
}

export interface ResearchReport {
  abstract: string;
  introduction: string;
  methodology: string;
  results: string;
  discussion: string;
  conclusion: string;
}

export type AgentStatus = 'idle' | 'searching' | 'hypothesizing' | 'experimenting' | 'critiquing' | 'reporting' | 'completed' | 'error';

export interface AppState {
  status: AgentStatus;
  topic: string;
  papers: Paper[];
  hypothesis: Hypothesis | null;
  experiment: ExperimentResult | null;
  critique: Critique | null;
  report: ResearchReport | null;
  error: string | null;
}
