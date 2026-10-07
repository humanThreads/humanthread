export interface QdrantPoint {
  id: string;
  vector: {
    dense: number[];
    sparse: {
      indices: number[];
      values: number[];
    };
  };
  payload: Record<string, unknown>;
}

export interface QdrantSearchHit {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
}

export interface QdrantSearchResult {
  points: QdrantSearchHit[];
}

export interface QdrantClientLike {
  getCollections(): Promise<{ collections: Array<{ name: string }> }>;
  collectionExists(name: string): Promise<{ exists: boolean }>;
  createCollection(name: string, options: Record<string, unknown>): Promise<unknown>;
  getCollection(name: string): Promise<unknown>;
  updateCollection(name: string, options: Record<string, unknown>): Promise<unknown>;
  createPayloadIndex(name: string, options: Record<string, unknown>): Promise<unknown>;
  upsert(name: string, options: { wait: true; points: QdrantPoint[] }): Promise<unknown>;
  count(name: string, options?: Record<string, unknown>): Promise<{ count: number }>;
  query(name: string, options: Record<string, unknown>): Promise<QdrantSearchResult>;
  updateCollectionAliases(options: { actions: unknown[] }): Promise<unknown>;
  createSnapshot(name: string): Promise<{ name?: string; snapshot_name?: string }>;
  deleteCollection(name: string): Promise<unknown>;
}
