import { 
  Paper, 
  Hypothesis, 
  ExperimentResult, 
  ResearchReport, 
  AppState,
  Chunk,
  ExperimentConfig
} from '../types';
import { 
  TopicRefinementAgent,
  LiteratureAgent, 
  SelectionAgent,
  DiscoveryAgent,
  DesignAgent,
  ExperimentRunner, 
  ResultValidationAgent,
  ReviewerSimulatorAgent,
  ReportAgent,
  FactualityEvalAgent,
  UnifiedPaperAnalyzerAgent
} from './agents';
import { vectorStore } from './vectorStore';

export type ResearchUpdate = (state: Partial<AppState>) => void;
export type ProgressUpdate = (msg: string) => void;

export class ResearchEngine {
  private isRunning = false;

  async run(
    inputTopic: string, 
    config: ExperimentConfig,
    onUpdate: ResearchUpdate,
    onProgress: ProgressUpdate
  ) {
    if (this.isRunning) return;
    this.isRunning = true;

    let currentIteration = 1;
    const MAX_WORKFLOW_ITERATIONS = 3;

    try {
      const stepDelay = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
      vectorStore.clear();

      // 1. Parallel Start: Topic Refinement + Initial Search
      onUpdate({ status: 'refining_topic', topic: inputTopic, iteration: 1 });
      
      // We start refinement and the first search in parallel to save time
      const [refinedTopic, initialPapers] = await Promise.all([
        TopicRefinementAgent.refine(inputTopic),
        LiteratureAgent.fetchPapers(inputTopic, (msg) => onProgress(msg))
      ]);

      onUpdate({ topic: refinedTopic, status: 'searching' });
      
      // 2. Comprehensive Search with Refined Topic
      let rawPapers = [...initialPapers];
      const refinedPapers = await LiteratureAgent.fetchPapers(refinedTopic, (msg) => onProgress(msg));
      
      // Merge and deduplicate
      const seen = new Set(rawPapers.map(p => p.title.toLowerCase().trim()));
      refinedPapers.forEach(p => {
        const t = p.title.toLowerCase().trim();
        if (!seen.has(t)) {
          rawPapers.push(p);
          seen.add(t);
        }
      });

      if (rawPapers.length === 0) throw new Error(`No papers found for "${refinedTopic}".`);

      // 3. Fast Verification & Analysis
      onUpdate({ status: 'verifying_citations' });
      const trulyVerified = await UnifiedPaperAnalyzerAgent.analyze(refinedTopic, rawPapers, (msg) => onProgress(msg));
      if (trulyVerified.length === 0) throw new Error(`Citation verification failed.`);

      // Parallelize: Vector Store Ingestion + Selection
      const ingestionPromise = (async () => {
        const allChunks: Chunk[] = [];
        trulyVerified.forEach(p => p.chunks && allChunks.push(...p.chunks));
        if (allChunks.length > 0) {
          await vectorStore.addDocuments(allChunks.map(c => ({
            id: `${c.source}-${c.metadata.index}`,
            text: c.text,
            metadata: { ...c.metadata, source: c.source }
          })));
        }
      })();

      const selectionPromise = SelectionAgent.selectPapers(refinedTopic, trulyVerified);
      
      const [, papers] = await Promise.all([ingestionPromise, selectionPromise]);
      onUpdate({ papers: trulyVerified, status: 'discovering' });

      // 4. Discovery
      let { gaps, hypothesis } = await DiscoveryAgent.discover(refinedTopic, papers);
      
      // 5. Iterative Refinement Loop
      let workflowIteration = 1;
      let isHypothesisCorrect = false;
      let finalExperiment: ExperimentResult | null = null;
      let finalCritiques: any[] = [];
      let finalDesign: any = null;

      while (workflowIteration <= MAX_WORKFLOW_ITERATIONS) {
        onUpdate({ iteration: workflowIteration, hypothesis, gapIdentification: gaps });

        // 5a. Design
        onUpdate({ status: 'designing' });
        const design = await DesignAgent.design(hypothesis);
        finalDesign = design;
        onUpdate({ 
          contributions: design.contributions,
          mathFormalization: design.math,
          experimentPlan: design.plan,
          datasetCard: design.dataset
        });

        // 5b. Execution
        onUpdate({ status: 'experimenting' });
        const experiment = await ExperimentRunner.runExperiment(hypothesis, design.plan, config);
        finalExperiment = experiment;
        onUpdate({ experiment });

        // 5c. Parallel Validation & Critique
        onUpdate({ status: 'validating_results' });
        const [validationResult, reviewerCritiques] = await Promise.all([
          ResultValidationAgent.validate(hypothesis, experiment),
          ReviewerSimulatorAgent.simulate(hypothesis, experiment)
        ]);
        finalCritiques = reviewerCritiques;
        onUpdate({ reviewerCritiques });

        const avgRating = reviewerCritiques.reduce((acc, c) => acc + c.rating, 0) / reviewerCritiques.length;
        const works = avgRating >= 7.5 && validationResult.isValid;

        if (works || workflowIteration === MAX_WORKFLOW_ITERATIONS) {
          isHypothesisCorrect = true;
          break;
        } else {
          onUpdate({ status: 'revising' });
          hypothesis = await DiscoveryAgent.debug(hypothesis, experiment, reviewerCritiques, papers);
        }

        workflowIteration++;
      }

      // 6. Final Reporting & Factuality (Parallelized)
      onUpdate({ status: 'reporting' });
      const report = await ReportAgent.generateReport(
        refinedTopic, 
        papers, 
        hypothesis, 
        finalDesign.contributions,
        finalDesign.math,
        finalDesign.plan,
        finalDesign.dataset,
        finalExperiment!, 
        finalCritiques
      );
      
      onUpdate({ status: 'verifying_report', report });
      const factualityResult = await FactualityEvalAgent.evaluate(report, papers);
      
      onUpdate({ 
        status: 'completed', 
        report,
        factualityResult
      });

    } catch (err: any) {
      throw err;
    } finally {
      this.isRunning = false;
    }
  }
}

export const researchEngine = new ResearchEngine();
