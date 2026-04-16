import { describe, it, expect } from 'vitest';
import { readSseLines } from '../../../src/llm/sse-reader.js';

/** Build a minimal Response from an array of SSE chunks (strings). */
function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** Collect all yielded lines from the async generator. */
async function collect(response: Response, signal?: AbortSignal): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readSseLines(response, signal)) {
    lines.push(line);
  }
  return lines;
}

describe('readSseLines', () => {
  it('yields data lines from a well-formed SSE response', async () => {
    const response = makeSseResponse(['data: hello\n\ndata: world\n\n']);
    const lines = await collect(response);
    expect(lines).toEqual(['hello', 'world']);
  });

  it('handles partial chunks split across multiple reads', async () => {
    const response = makeSseResponse([
      'data: fi',
      'rst\n\n',
      'data: second\n\n',
    ]);
    const lines = await collect(response);
    expect(lines).toEqual(['first', 'second']);
  });

  it('skips non-data lines (event:, id:, comment lines)', async () => {
    const response = makeSseResponse([
      'event: message\nid: 1\ndata: keep-this\n\n',
      ': this is a comment\ndata: also-keep\n\n',
    ]);
    const lines = await collect(response);
    expect(lines).toEqual(['keep-this', 'also-keep']);
  });

  it('does not yield [DONE] — callers break on it, generator still yields it as-is', async () => {
    const response = makeSseResponse(['data: token\n\ndata: [DONE]\n\n']);
    const lines = await collect(response);
    // The SSE reader yields raw data lines; callers decide when to stop on [DONE]
    expect(lines).toEqual(['token', '[DONE]']);
  });

  it('empty stream yields nothing', async () => {
    const response = makeSseResponse([]);
    const lines = await collect(response);
    expect(lines).toHaveLength(0);
  });

  it('throws AbortError when signal is aborted before reading starts', async () => {
    const controller = new AbortController();
    controller.abort();

    const response = makeSseResponse(['data: should-not-see\n\n']);
    await expect(collect(response, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('multiple data lines in one SSE event block are all yielded', async () => {
    // An SSE event can have multiple data: lines; each is yielded individually
    const response = makeSseResponse(['data: line1\ndata: line2\n\n']);
    const lines = await collect(response);
    expect(lines).toEqual(['line1', 'line2']);
  });

  it('strips trailing whitespace from data lines', async () => {
    const response = makeSseResponse(['data: hello   \n\n']);
    const lines = await collect(response);
    expect(lines).toEqual(['hello']);
  });

  it('flushes remaining buffer when stream ends without trailing blank line', async () => {
    // The last SSE event has only a single \n (not \n\n) — triggers the post-loop flush path
    const response = makeSseResponse(['data: first\n\ndata: last\n']);
    const lines = await collect(response);
    expect(lines).toContain('first');
    expect(lines).toContain('last');
  });
});
