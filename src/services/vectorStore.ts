import { embedText } from "./gemini";

export interface VectorDocument {
  id: string;
  text: string;
  metadata: any;
  embedding?: number[];
  embeddingNorm?: number;
}

function vectorNorm(values: number[]): number {
  let sumSquares = 0;
  for (let i = 0; i < values.length; i++) {
    sumSquares += values[i] * values[i];
  }
  return Math.sqrt(sumSquares);
}

function cosineSimilarityWithNorms(a: number[], aNorm: number, b: number[], bNorm?: number): number {
  if (!aNorm) return 0;
  const resolvedBNorm = bNorm ?? vectorNorm(b);
  if (!resolvedBNorm) return 0;

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  return dotProduct / (aNorm * resolvedBNorm);
}

class MinHeap<T> {
  private heap: T[] = [];

  constructor(private compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.heap.length;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  push(value: T) {
    this.heap.push(value);
    this.bubbleUp(this.heap.length - 1);
  }

  replaceTop(value: T) {
    if (this.heap.length === 0) {
      this.heap[0] = value;
      return;
    }
    this.heap[0] = value;
    this.bubbleDown(0);
  }

  toSortedArrayDesc(): T[] {
    return [...this.heap].sort((a, b) => this.compare(b, a));
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[index], this.heap[parent]) >= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const left = (index * 2) + 1;
      const right = left + 1;

      if (left < length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

export class SimpleVectorStore {
  private documents: VectorDocument[] = [];

  async addDocuments(docs: VectorDocument[]) {
    const docsWithEmbeddings = await Promise.all(
      docs.map(async (doc) => {
        const embedding = await embedText(doc.text);
        return {
          ...doc,
          embedding,
          embeddingNorm: vectorNorm(embedding)
        };
      })
    );
    this.documents.push(...docsWithEmbeddings);
  }

  async search(query: string, limit: number = 5): Promise<VectorDocument[]> {
    if (limit <= 0 || this.documents.length === 0) return [];

    const queryEmbedding = await embedText(query);
    const queryNorm = vectorNorm(queryEmbedding);
    const topResults = new MinHeap<{ doc: VectorDocument; similarity: number }>((a, b) => a.similarity - b.similarity);

    for (const doc of this.documents) {
      const similarity = doc.embedding
        ? cosineSimilarityWithNorms(queryEmbedding, queryNorm, doc.embedding, doc.embeddingNorm)
        : 0;
      const candidate = { doc, similarity };

      if (topResults.size < limit) {
        topResults.push(candidate);
        continue;
      }

      const weakest = topResults.peek();
      if (weakest && similarity > weakest.similarity) {
        topResults.replaceTop(candidate);
      }
    }

    return topResults.toSortedArrayDesc().map(result => result.doc);
  }

  clear() {
    this.documents = [];
  }
}

export const vectorStore = new SimpleVectorStore();
