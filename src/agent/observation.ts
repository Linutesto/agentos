export interface Observation {
  status: 'success' | 'error';
  result?: any;
  error?: string;
  metadata?: {
    tool: string;
    durationMs: number;
  };
}

export function formatObservation(obs: Observation): string {
  // Always return compact JSON representation for observations
  // to ensure LLM parses it easily and context size is minimized
  return JSON.stringify(obs);
}
