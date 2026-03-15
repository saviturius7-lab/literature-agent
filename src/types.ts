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

export interface Contribution {
  type: string;
  description: string;
}

export interface ExperimentPlan {
  protocol: string;
  datasets: string[];
  baselines: string[];
  metrics: string[];
}

export interface DatasetCard {
  name: string;
  description: string;
  features: string[];
  size: string;
  source: string;
}

export interface MathFormalization {
  problemFormulation: string;
  notation: { symbol: string; definition: string; }[];
  objectiveFunction: string;
  algorithmSteps: string[];
}

export interface ReviewerCritique {
  reviewerId: number;
  weaknesses: string[];
  noveltyCritique: string;
  rating: number;
}

export interface AblationStudy {
  componentRemoved: string;
  impactOnMetric: number;
}

export interface FailureCase {
  example: string;
  explanation: string;
}

export interface ExperimentResult {
  accuracy: number;
  f1Score: number;
  baselines: { name: string; accuracy: number }[];
  ablationStudies: AblationStudy[];
  failureCases: FailureCase[];
  implementationDetails: string;
  logs: string[];
}

export interface Critique {
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  overallRating: number;
  isReliable: boolean;
}

export interface ResearchReport {
  abstract: string;
  introduction: string;
  methodology: string;
  results: string;
  discussion: string;
  conclusion: string;
  references: string[];
}

export type AgentStatus = 
  | 'idle' 
  | 'searching' 
  | 'filtering_relevance'
  | 'hypothesizing' 
  | 'checking_novelty'
  | 'extracting_contributions'
  | 'formalizing_math'
  | 'designing_experiment'
  | 'generating_dataset'
  | 'experimenting' 
  | 'reviewing'
  | 'revising'
  | 'reporting' 
  | 'verifying_report'
  | 'completed' 
  | 'error';

export interface AppState {
  status: AgentStatus;
  topic: string;
  papers: Paper[];
  hypothesis: Hypothesis | null;
  contributions: Contribution[];
  mathFormalization: MathFormalization | null;
  experimentPlan: ExperimentPlan | null;
  datasetCard: DatasetCard | null;
  experiment: ExperimentResult | null;
  reviewerCritiques: ReviewerCritique[];
  report: ResearchReport | null;
  error: string | null;
  iteration: number;
}
