import { createHash } from 'node:crypto';
import type { RequestFacts, RequestShape, RequestTables } from '@claude-history/shared';
import { isRec, num, str, type RawLine } from './jsonl.ts';

const digest = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 12);

export interface RequestReader {
  /** Takes the line if it is one of the request lines, and says whether it was. */
  read(o: RawLine): boolean;
  /** The request an assistant line names in its `requestRef`. */
  of(requestRef: string | null): RequestFacts | null;
  tables(): RequestTables;
}

/**
 * The API requests a transcript records, since CLI 2.1.300: one `api-request`
 * line per request, written before the reply that answers it (whose
 * `requestRef` is its `id`, one to one per `message.id`), and the
 * `api-request-shape` lines its `shapeHash` points at, written once per shape.
 * `api-request-blob` lines are the messages themselves and are passed over.
 *
 * A request is delta-encoded against the one before it: `base` names it, `keep`
 * says how many of its messages were sent again and `tail` lists the ones
 * added. So a request with no `base` started a new chain, and one that kept
 * fewer messages than its base sent rewrote something earlier — the two facts
 * the cache cares about that no other line says.
 *
 * One reader for the parser and the enricher, so the two cannot read a request
 * differently: what they compare is `requestChanges` in `shared/src/requests.ts`.
 */
export function requestReader(): RequestReader {
  const facts = new Map<string, RequestFacts>();
  /** Messages each request sent: `keep + tail`. */
  const sent = new Map<string, number>();
  const shapes: Record<string, RequestShape> = {};
  const betas: Record<string, string[]> = {};

  const readRequest = (o: RawLine): void => {
    const id = str(o.id);
    if (!id) return;
    const params = isRec(o.params) ? o.params : {};
    const keep = num(o.keep) ?? 0;
    sent.set(id, keep + (Array.isArray(o.tail) ? o.tail.length : 0));
    const base = str(o.base);
    const baseSent = base ? sent.get(base) : undefined;
    const betaList = Array.isArray(params.betas) ? params.betas.map(String).sort() : [];
    const betasKey = betaList.length > 0 ? digest(betaList.join('\n')) : null;
    if (betasKey) betas[betasKey] ??= betaList;
    const thinking = isRec(params.thinking) ? params.thinking : null;
    const output = isRec(params.output_config) ? params.output_config : null;
    const cacheControl = Array.isArray(o.cacheControl)
      ? o.cacheControl
          .filter(isRec)
          .map((c) => {
            const v = isRec(c.value) ? c.value : {};
            // No `ttl` is the API's default, which is 5 minutes — written so
            // rather than guessed, since it is the default that might change.
            return [str(v.ttl) ?? 'default', str(v.scope)].filter(Boolean).join(' ');
          })
          .join(' · ')
      : '';
    facts.set(id, {
      id,
      at: str(o.timestamp),
      added: Array.isArray(o.tail) ? o.tail.length : 0,
      shapeHash: str(o.shapeHash),
      betasKey,
      effort: output ? str(output.effort) : null,
      thinking: thinking ? str(thinking.type) : null,
      thinkingDisplay: thinking ? str(thinking.display) : null,
      cacheControl,
      contextManagement: params.context_management === undefined ? null : JSON.stringify(params.context_management),
      newChain: base === null,
      // A base this file does not hold says nothing either way.
      rewritten: baseSent !== undefined && keep < baseSent,
    });
  };

  const readShape = (o: RawLine): void => {
    const hash = str(o.shapeHash);
    const shape = isRec(o.shape) ? o.shape : null;
    if (!hash || !shape || shapes[hash]) return;
    const system = shape.system;
    const systemText =
      typeof system === 'string'
        ? system
        : Array.isArray(system)
          ? system
              .filter(isRec)
              .map((b) => str(b.text) ?? '')
              .join('')
          : '';
    const tools = Array.isArray(shape.tools) ? shape.tools.filter(isRec) : [];
    shapes[hash] = {
      systemChars: systemText.length,
      systemHash: digest(JSON.stringify(system ?? null)),
      tools: tools.map((t) => str(t.name) ?? '?').sort(),
      toolsHash: digest(JSON.stringify(shape.tools ?? null)),
    };
  };

  return {
    read(o) {
      const type = str(o.type);
      if (type === 'api-request') readRequest(o);
      else if (type === 'api-request-shape') readShape(o);
      else return type === 'api-request-blob';
      return true;
    },
    of(requestRef) {
      return requestRef ? (facts.get(requestRef) ?? null) : null;
    },
    tables() {
      return { shapes, betas };
    },
  };
}
