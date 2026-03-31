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
  UnifiedPaperAnalyzerAgent,
  ReviewerAgent
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

      // 1. Topic Refinement
      onUpdate({ status: 'refining_topic', topic: inputTopic, iteration: 1 });
      const refinedTopic = await TopicRefinementAgent.refine(inputTopic);
      onUpdate({ topic: refinedTopic, status: 'searching' });

      // 2. Comprehensive Search with Refined Topic
      // We only search once with the refined topic to avoid redundancy and save time
      const rawPapers = await LiteratureAgent.fetchPapers(refinedTopic, (msg) => onProgress(msg));
      
      if (rawPapers.length === 0) throw new Error(`No papers found for "${refinedTopic}".`);

      // 3. Fast Verification & Analysis
      onUpdate({ status: 'verifying_citations' });
      const trulyVerified = await UnifiedPaperAnalyzerAgent.analyze(refinedTopic, rawPapers, (msg) => onProgress(msg));
      
      if (trulyVerified.length === 0) {
        console.warn("No papers passed strict verification. Using top raw papers as fallback.");
        onProgress("Strict verification failed. Using best available matches...");
        trulyVerified.push(...rawPapers.slice(0, 10));
      }

      // Parallelize: Vector Store Ingestion + Selection + Discovery
      onUpdate({ status: 'discovering' });
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
      const [ , papers] = await Promise.all([ingestionPromise, selectionPromise]);
      
      onUpdate({ papers: trulyVerified });
      const { gaps, hypothesis: initialHypothesis } = await DiscoveryAgent.discover(refinedTopic, papers);
      let hypothesis = initialHypothesis;
      
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
        const experimentConfig: ExperimentConfig = {
          ...config,
          kaggleDataset: design.dataset.kaggleDataset,
          targetColumn: design.dataset.targetColumn,
          topic: refinedTopic
        };
        const experiment = await ExperimentRunner.runExperiment(hypothesis, design.plan, experimentConfig);
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
      let report = await ReportAgent.generateReport(
        refinedTopic, 
        papers, 
        hypothesis, 
        finalDesign.contributions,
        finalDesign.math,
        finalDesign.plan,
        finalDesign.dataset,
        finalExperiment!, 
        finalCritiques,
        (msg) => onProgress(msg)
      );
      
      onUpdate({ status: 'verifying_report', report });
      
      // Adversarial Review Phase (Parallelized)
      const [reviewerCritiques, factualityResult] = await Promise.all([
        ReviewerAgent.review(report, papers),
        FactualityEvalAgent.evaluate(report, papers)
      ]);
      
      // If report is poor or has factuality issues, attempt ONE refinement
      const avgRating = reviewerCritiques.reduce((acc, c) => acc + c.rating, 0) / reviewerCritiques.length;
      
      if (avgRating < 6 || !factualityResult.isPassed) {
        onUpdate({ status: 'refining_report', report });
        onProgress(`Report quality issues detected (Rating: ${(avgRating || 0).toFixed(1)}, Factuality: ${(factualityResult?.faithfulnessScore || 0).toFixed(2)}). Refining...`);
        
        report = await ReportAgent.refineReport(
          report,
          papers,
          reviewerCritiques,
          factualityResult.unsupportedClaims
        );
        
        // Re-evaluate after refinement
        onProgress("Re-evaluating refined report...");
        const finalFactuality = await FactualityEvalAgent.evaluate(report, papers);
        
        onUpdate({ 
          status: 'completed', 
          report,
          factualityResult: finalFactuality
        });
      } else {
        onUpdate({ 
          status: 'completed', 
          report,
          factualityResult
        });
      }

    } catch (err: any) {
      throw err;
    } finally {
      this.isRunning = false;
    }
  }
}

export const researchEngine = new ResearchEngine();
