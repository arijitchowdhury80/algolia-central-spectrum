export interface StreamSource { title: string; url: string; source?: string }

export interface IncrementalStreamParser {
  push(chunk: string): { tokens: string[]; sources: StreamSource[]; error?: string };
  end(): { answer: string; sources: StreamSource[]; error?: string };
}

export function makeStreamParser(): IncrementalStreamParser {
  let buffer = "";
  let answer = "";
  let error: string | undefined;
  const sources: StreamSource[] = [];
  const seen = new Set<string>();

  function addSource(s: StreamSource) {
    const key = s.url || s.title;
    if (!key || seen.has(key)) return;
    seen.add(key);
    sources.push(s);
  }

  function consumeLine(line: string, tokens: string[]) {
    const t = line.trim();
    if (!t) return;
    const i = t.indexOf(":");
    if (i === -1) return;
    const prefix = t.slice(0, i);
    const payload = t.slice(i + 1);
    if (prefix === "0") {
      try { const text = JSON.parse(payload); answer += text; tokens.push(text); } catch { /* skip */ }
    } else if (prefix === "3") {
      try { error = JSON.parse(payload); } catch { error = payload; }
    } else if (prefix === "a" || prefix === "9") {
      try {
        const r = JSON.parse(payload).result;
        const hits = Array.isArray(r) ? r : (r?.hits ?? []);
        for (const h of hits) if (h && (h.url || h.title)) addSource({ title: h.title ?? "", url: h.url ?? "", source: h.source });
      } catch { /* skip */ }
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const tokens: string[] = [];
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        consumeLine(line, tokens);
      }
      // Also process the buffer if it contains a complete line (prefix:payload with valid JSON)
      if (buffer) {
        const i = buffer.indexOf(":");
        if (i !== -1) {
          const prefix = buffer.slice(0, i);
          const payload = buffer.slice(i + 1);
          try {
            // Try to parse the payload as JSON; if it succeeds, the line is complete
            if (prefix === "0") {
              JSON.parse(payload);
              consumeLine(buffer, tokens);
              buffer = "";
            } else if (prefix === "3") {
              JSON.parse(payload);
              consumeLine(buffer, tokens);
              buffer = "";
            } else if (prefix === "a" || prefix === "9") {
              JSON.parse(payload);
              consumeLine(buffer, tokens);
              buffer = "";
            }
          } catch {
            // payload is not complete JSON, keep buffering
          }
        }
      }
      return { tokens, sources: [...sources], error };
    },
    end() {
      if (buffer.trim()) consumeLine(buffer, []); // flush trailing line without newline
      buffer = "";
      return { answer, sources, error };
    },
  };
}
