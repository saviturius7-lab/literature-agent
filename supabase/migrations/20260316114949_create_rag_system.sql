/*
  # RAG System for Literature Agent
  
  Creates vector storage for research papers to prevent hallucinations through grounded retrieval.
  
  ## New Tables
  
  ### `papers`
  - `id` (uuid, primary key) - Unique identifier for each paper
  - `title` (text) - Paper title
  - `summary` (text) - Paper abstract/summary
  - `authors` (jsonb) - Array of author names
  - `published` (timestamptz) - Publication date
  - `link` (text) - arXiv link
  - `citation` (text) - Full citation string
  - `embedding` (vector(768)) - Vector embedding for semantic search
  - `topic` (text) - Research topic this paper relates to
  - `created_at` (timestamptz) - When this record was created
  
  ### `research_sessions`
  - `id` (uuid, primary key) - Unique session identifier
  - `topic` (text) - Research topic
  - `hypothesis` (jsonb) - Generated hypothesis
  - `report` (jsonb) - Final research report
  - `created_at` (timestamptz) - Session creation time
  - `completed_at` (timestamptz, nullable) - Session completion time
  
  ### `paper_chunks`
  - `id` (uuid, primary key) - Unique chunk identifier
  - `paper_id` (uuid, foreign key) - Reference to parent paper
  - `content` (text) - Chunk text content
  - `embedding` (vector(768)) - Vector embedding for chunk
  - `chunk_index` (integer) - Order of chunk in paper
  
  ## Security
  
  - Enable RLS on all tables
  - Public read access for papers (research is public)
  - Authenticated users can manage their sessions
*/

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Papers table
CREATE TABLE IF NOT EXISTS papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text NOT NULL,
  authors jsonb DEFAULT '[]'::jsonb,
  published timestamptz NOT NULL,
  link text NOT NULL UNIQUE,
  citation text NOT NULL,
  embedding vector(768),
  topic text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Research sessions table
CREATE TABLE IF NOT EXISTS research_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  hypothesis jsonb DEFAULT '{}'::jsonb,
  report jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Paper chunks for fine-grained retrieval
CREATE TABLE IF NOT EXISTS paper_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid REFERENCES papers(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(768),
  chunk_index integer NOT NULL DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS papers_topic_idx ON papers(topic);
CREATE INDEX IF NOT EXISTS papers_embedding_idx ON papers USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS paper_chunks_paper_id_idx ON paper_chunks(paper_id);
CREATE INDEX IF NOT EXISTS paper_chunks_embedding_idx ON paper_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS research_sessions_topic_idx ON research_sessions(topic);

-- Enable RLS
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_chunks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for papers (public read, no write needed for now)
CREATE POLICY "Papers are publicly readable"
  ON papers
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert papers"
  ON papers
  FOR INSERT
  TO public
  WITH CHECK (true);

-- RLS Policies for research_sessions (public for this demo)
CREATE POLICY "Sessions are publicly readable"
  ON research_sessions
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can create sessions"
  ON research_sessions
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can update sessions"
  ON research_sessions
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- RLS Policies for paper_chunks
CREATE POLICY "Paper chunks are publicly readable"
  ON paper_chunks
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert paper chunks"
  ON paper_chunks
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Function to search similar papers
CREATE OR REPLACE FUNCTION search_similar_papers(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  summary text,
  authors jsonb,
  link text,
  citation text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    papers.id,
    papers.title,
    papers.summary,
    papers.authors,
    papers.link,
    papers.citation,
    1 - (papers.embedding <=> query_embedding) as similarity
  FROM papers
  WHERE papers.embedding IS NOT NULL
    AND 1 - (papers.embedding <=> query_embedding) > match_threshold
  ORDER BY papers.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;