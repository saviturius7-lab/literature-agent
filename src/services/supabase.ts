import { createClient } from '@supabase/supabase-js';
import { Paper } from '../types';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface StoredPaper extends Paper {
  id?: string;
  embedding?: number[];
}

export const RAGService = {
  async storePaper(paper: Paper, embedding: number[], topic: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('papers')
        .upsert({
          title: paper.title,
          summary: paper.summary,
          authors: paper.authors,
          published: paper.published,
          link: paper.link,
          citation: paper.citation,
          embedding,
          topic
        }, {
          onConflict: 'link',
          ignoreDuplicates: false
        })
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('Error storing paper:', error);
        return null;
      }

      return data?.id || null;
    } catch (err) {
      console.error('Failed to store paper:', err);
      return null;
    }
  },

  async searchSimilarPapers(queryEmbedding: number[], matchThreshold: number = 0.5, matchCount: number = 10): Promise<StoredPaper[]> {
    try {
      const { data, error } = await supabase.rpc('search_similar_papers', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount
      });

      if (error) {
        console.error('Error searching papers:', error);
        return [];
      }

      return (data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        authors: item.authors,
        published: item.published || new Date().toISOString(),
        link: item.link,
        citation: item.citation,
        similarity: item.similarity
      }));
    } catch (err) {
      console.error('Failed to search papers:', err);
      return [];
    }
  },

  async getPapersByTopic(topic: string, limit: number = 20): Promise<StoredPaper[]> {
    try {
      const { data, error } = await supabase
        .from('papers')
        .select('*')
        .eq('topic', topic)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting papers by topic:', error);
        return [];
      }

      return (data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        authors: item.authors,
        published: item.published,
        link: item.link,
        citation: item.citation
      }));
    } catch (err) {
      console.error('Failed to get papers by topic:', err);
      return [];
    }
  },

  async createSession(topic: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('research_sessions')
        .insert({ topic })
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('Error creating session:', error);
        return null;
      }

      return data?.id || null;
    } catch (err) {
      console.error('Failed to create session:', err);
      return null;
    }
  },

  async updateSession(sessionId: string, updates: { hypothesis?: any; report?: any; completed?: boolean }): Promise<boolean> {
    try {
      const payload: any = {};

      if (updates.hypothesis) payload.hypothesis = updates.hypothesis;
      if (updates.report) payload.report = updates.report;
      if (updates.completed) payload.completed_at = new Date().toISOString();

      const { error } = await supabase
        .from('research_sessions')
        .update(payload)
        .eq('id', sessionId);

      if (error) {
        console.error('Error updating session:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Failed to update session:', err);
      return false;
    }
  }
};
