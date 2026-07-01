export interface AgentAction {
  tool: string;
  args: any;
}

export interface AgentFinal {
  type: 'final';
  content: string;
}

export type AgentResponse = AgentAction | AgentFinal;

export interface ParserOptions {
  strict?: boolean;
}

export class ParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParserError';
  }
}

export function parseAgentResponse(text: string, options: ParserOptions = { strict: true }): AgentResponse {
  let raw = text.trim();

  if (options.strict && (raw.startsWith('```') || !raw.startsWith('{'))) {
    throw new ParserError("Strict mode enabled: Output must be raw JSON object without markdown or conversational text.");
  }

  // Extraction from markdown if strict mode is disabled
  if (!options.strict) {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      raw = jsonMatch[1].trim();
    } else {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        raw = raw.substring(start, end + 1);
      }
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    // Light repair: remove trailing commas
    try {
      const repaired = raw.replace(/,\s*([\]}])/g, '$1');
      parsed = JSON.parse(repaired);
    } catch (e) {
      throw new ParserError(`Invalid JSON format: ${err.message}.`);
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ParserError("Root element must be a JSON object.");
  }

  if (Array.isArray(parsed)) {
    throw new ParserError("Cannot output an array. Emit exactly ONE action per turn.");
  }

  if (parsed.type === 'final') {
    if (!parsed.content || typeof parsed.content !== 'string') {
      throw new ParserError("Final response must include a 'content' string field.");
    }
    return { type: 'final', content: parsed.content };
  }

  if (parsed.tool) {
    if (typeof parsed.tool !== 'string') {
      throw new ParserError("'tool' field must be a string.");
    }
    if (parsed.args && typeof parsed.args !== 'object') {
      throw new ParserError("'args' field must be an object.");
    }
    return { tool: parsed.tool, args: parsed.args || {} };
  }

  throw new ParserError("Unrecognized format. Must contain 'tool' and 'args' OR 'type': 'final' and 'content'.");
}
