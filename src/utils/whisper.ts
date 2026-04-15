import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import log from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Transcribe an audio file using the local Whisper CLI.
 * Falls back gracefully if Whisper is not installed.
 *
 * Requires: `whisper` CLI in PATH (pip install openai-whisper)
 * Or set CLAW_WHISPER_CMD to point to an alternative transcription tool.
 */
export async function transcribeAudio(audioPath: string): Promise<string | null> {
  const whisperCmd = process.env.CLAW_WHISPER_CMD ?? 'whisper';

  // Check that the audio file exists
  try {
    await fs.access(audioPath);
  } catch {
    return null;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-whisper-'));
  const outputPath = path.join(tmpDir, 'transcript.txt');

  try {
    await execFileAsync(whisperCmd, [
      audioPath,
      '--model', 'base',
      '--output_format', 'txt',
      '--output_dir', tmpDir,
      '--language', 'en',
      '--fp16', 'False',
    ], { timeout: 120_000 });

    // Whisper names the output file based on the input filename
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const whisperOutput = path.join(tmpDir, `${baseName}.txt`);

    let transcript: string;
    try {
      transcript = await fs.readFile(whisperOutput, 'utf-8');
    } catch {
      transcript = await fs.readFile(outputPath, 'utf-8');
    }

    return transcript.trim();
  } catch (err) {
    // Whisper not available — return null rather than crashing
    const message = (err as Error).message ?? '';
    if (message.includes('not found') || message.includes('ENOENT')) {
      log.warn('[Whisper] Whisper CLI not available. Audio transcription disabled.');
    } else {
      log.error('[Whisper] Transcription failed', { error: message });
    }
    return null;
  } finally {
    // Clean up temp dir
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
