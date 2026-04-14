/**
 * Shared SSE (Server-Sent Events) stream reader.
 *
 * Yields each `data:` line value from a streaming fetch Response.
 * Used by AnthropicProvider, OpenAIProvider, and ManifestProvider to parse
 * token streams without duplicating buffer-accumulation logic.
 *
 * The generator:
 *   - Handles partial chunks (a single read may split across event boundaries)
 *   - Respects an optional AbortSignal — throws AbortError when aborted
 *   - Releases the reader lock on completion or error
 */
export async function* readSseLines(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        throw new DOMException('Aborted by caller', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines (\n\n). Split on double-newline
      // to get complete events; keep the trailing incomplete fragment in buffer.
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          const trimmed = line.trimEnd();
          if (trimmed.startsWith('data: ')) {
            yield trimmed.slice(6);
          }
          // Skip event:, id:, retry:, and comment lines (starting with :)
        }
      }
    }

    // Flush any remaining buffer content (stream ended without trailing \n\n)
    for (const line of buffer.split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('data: ')) {
        yield trimmed.slice(6);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
