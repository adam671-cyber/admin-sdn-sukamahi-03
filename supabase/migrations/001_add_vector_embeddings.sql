-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns to mutasi tables (1536 dims for text-embedding-3-small)
ALTER TABLE mutasi_masuk ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE mutasi_keluar ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for vector similarity search (HNSW for better performance)
CREATE INDEX IF NOT EXISTS mutasi_masuk_embedding_idx ON mutasi_masuk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS mutasi_keluar_embedding_idx ON mutasi_keluar USING hnsw (embedding vector_cosine_ops);

-- RPC function for vector similarity search
CREATE OR REPLACE FUNCTION match_mutasi(
  query_embedding vector(1536),
  match_table text,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS SETOF record
LANGUAGE plpgsql
AS $$
DECLARE
  result record;
  sql text;
BEGIN
  -- Validate table name to prevent SQL injection
  IF match_table NOT IN ('mutasi_masuk', 'mutasi_keluar') THEN
    RAISE EXCEPTION 'Invalid table name: %', match_table;
  END IF;

  sql := format(
    'SELECT *, 1 - (embedding <=> $1) AS similarity
     FROM %I
     WHERE embedding IS NOT NULL
       AND 1 - (embedding <=> $1) > $2
     ORDER BY embedding <=> $1
     LIMIT $3',
    match_table
  );

  FOR result IN EXECUTE sql USING query_embedding, match_threshold, match_count LOOP
    RETURN NEXT result;
  END LOOP;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION match_mutasi(vector, text, float, int) TO authenticated;