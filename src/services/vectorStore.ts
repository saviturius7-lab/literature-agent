import { embedText, embedTexts } from "./gemini";

export interface VectorDocument {
  id: string;
  text: string;
  metadata: any;
  embedding?: number[];
}

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

export class SimpleVectorStore {
  private documents: VectorDocument[] = [];

  async addDocuments(docs: VectorDocument[]) {
    if (docs.length === 0) return;
    
    // Use embedTexts for batch processing to reduce API calls
    const texts = docs.map(doc => doc.text);
    const embeddings = await embedTexts(texts);
    
    const docsWithEmbeddings = docs.map((doc, i) => ({
      ...doc,
      embedding: embeddings[i]
    }));
    
    this.documents.push(...docsWithEmbeddings);
  }

  async search(query: string, limit: number = 5): Promise<VectorDocument[]> {
    const queryEmbedding = await embedText(query);
    
    const results = this.documents
      .map(doc => ({
        doc,
        similarity: doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) : 0
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(r => r.doc);
      
    return results;
  }

  clear() {
    this.documents = [];
  }
}

export const vectorStore = new SimpleVectorStore();
