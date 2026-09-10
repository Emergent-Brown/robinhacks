#!/usr/bin/env node
/** Local speech only. Authored text lives in narration.json; measured assets live in output/. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runFile = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '../..');
const sourcePath = join(scriptDirectory, 'narration.json');
const defaultOutput = join(projectDirectory, 'output/playwright/walkthrough');
const sampleRateHz = 48_000;

function parseArguments(argv) {
  const options = { outputDirectory: defaultOutput, force: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--force') options.force = true;
    else if (flag === '--output-dir') {
      const destination = argv[++index];
      if (!destination || destination.startsWith('--'))
        throw new Error('--output-dir requires a directory path.');
      options.outputDirectory = resolve(destination);
    } else throw new Error('Unsupported argument. Run with --help for accepted options.');
  }
  return options;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateSource(plan) {
  if (!Array.isArray(plan.segments) || plan.segments.length === 0)
    throw new Error('The authored narration must contain at least one segment.');
  if (
    typeof plan.voice?.name !== 'string' ||
    !plan.voice.name.trim() ||
    !Number.isInteger(plan.voice.rateWordsPerMinute) ||
    plan.voice.rateWordsPerMinute < 80 ||
    plan.voice.rateWordsPerMinute > 260
  )
    throw new Error('The narration source needs an installed voice and a rate from 80 to 260 WPM.');
  const identifiers = new Set();
  for (const segment of plan.segments) {
    if (
      typeof segment.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(segment.id) ||
      identifiers.has(segment.id)
    )
      throw new Error('Each narration segment needs a unique filename-safe ID.');
    if (typeof segment.narration !== 'string' || !segment.narration.trim())
      throw new Error(`Segment ${segment.id} has no narration.`);
    identifiers.add(segment.id);
  }
}

async function requireTool(command, args) {
  try {
    await runFile(command, args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        `${command} is not installed or is absent from PATH. macOS provides say; install ffmpeg to obtain ffmpeg and ffprobe.`,
      );
    throw new Error(`Unable to run ${command}. Check its installation and host permissions.`);
  }
}

async function duration(path) {
  const { stdout } = await runFile(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { timeout: 15_000, maxBuffer: 1024 * 1024 },
  );
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(
      'The speech export contains no audio. macOS say can return success inside a restricted sandbox while writing only a header. Run with permission to access the local macOS speech service; no cloud service is required.',
    );
  return seconds;
}

async function reusableAudio(segment, audioDirectory, previousVoice, voice) {
  if (
    previousVoice?.name !== voice.name ||
    previousVoice?.rateWordsPerMinute !== voice.rateWordsPerMinute
  )
    return null;
  const transcript = await readOptional(join(audioDirectory, `${segment.id}.txt`));
  if (transcript?.trim() !== segment.narration.trim()) return null;
  try {
    const [aiffSeconds, wavSeconds] = await Promise.all([
      duration(join(audioDirectory, `${segment.id}.aiff`)),
      duration(join(audioDirectory, `${segment.id}.wav`)),
    ]);
    return Math.abs(aiffSeconds - wavSeconds) < 0.05 ? wavSeconds : null;
  } catch {
    return null;
  }
}

async function generateSegment(segment, audioDirectory, voice) {
  const staging = await mkdtemp(join(audioDirectory, '.generating-'));
  const textPath = join(staging, `${segment.id}.txt`);
  const aiffPath = join(staging, `${segment.id}.aiff`);
  const wavPath = join(staging, `${segment.id}.wav`);
  try {
    await writeFile(textPath, `${segment.narration}\n`);
    await runFile(
      'say',
      ['-v', voice.name, '-r', String(voice.rateWordsPerMinute), '-o', aiffPath, '-f', textPath],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    // Validate before conversion so an empty speech export cannot replace a valid recording.
    await duration(aiffPath);
    await runFile(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        aiffPath,
        '-c:a',
        'pcm_s16le',
        '-ar',
        String(sampleRateHz),
        '-ac',
        '1',
        wavPath,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const seconds = await duration(wavPath);
    // Existing files are replaced only after this segment's complete audio passes validation.
    for (const suffix of ['aiff', 'wav', 'txt'])
      await rename(
        join(staging, `${segment.id}.${suffix}`),
        join(audioDirectory, `${segment.id}.${suffix}`),
      );
    return seconds;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function writeOutput(path, text) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node scripts/walkthrough/generate-audio.mjs [--output-dir <directory>] [--force]\n\nReads scripts/walkthrough/narration.json. Uses only installed macOS say, ffmpeg and ffprobe.\nDefault output: output/playwright/walkthrough.\nExisting valid audio is reused when its text and voice settings match. --force regenerates every segment.\nWrites audio/<id>.aiff, .wav and .txt, measured narration-plan.json, audio-durations.json and narration-transcript.txt.',
    );
    return;
  }
  if (process.platform !== 'darwin')
    throw new Error('Local Samantha narration requires macOS and its installed say command.');
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  validateSource(source);
  await requireTool('say', ['-v', '?']);
  await requireTool('ffmpeg', ['-version']);
  await requireTool('ffprobe', ['-version']);
  const audioDirectory = join(options.outputDirectory, 'audio');
  await mkdir(audioDirectory, { recursive: true });
  const outputPlanPath = join(options.outputDirectory, 'narration-plan.json');
  const previousText = await readOptional(outputPlanPath);
  let previousPlan = null;
  try {
    previousPlan = previousText ? JSON.parse(previousText) : null;
  } catch {
    /* Invalid metadata requires fresh verified exports. */
  }
  const segments = [];
  const durations = {};
  for (const segment of source.segments) {
    const cached = options.force
      ? null
      : await reusableAudio(segment, audioDirectory, previousPlan?.voice, source.voice);
    const seconds = cached ?? (await generateSegment(segment, audioDirectory, source.voice));
    const rounded = Number(seconds.toFixed(3));
    durations[segment.id] = rounded;
    segments.push({ ...segment, durationSeconds: rounded, audioPath: `audio/${segment.id}.wav` });
    console.log(
      `${cached === null ? 'Generated' : 'Reused'} ${segment.id}: ${rounded.toFixed(3)} s`,
    );
  }
  const wordCount = source.segments.reduce(
    (count, segment) =>
      count + (segment.narration.match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu) ?? []).length,
    0,
  );
  const totalSeconds = Number(
    Object.values(durations)
      .reduce((sum, value) => sum + value, 0)
      .toFixed(3),
  );
  const outputPlan = { ...source, segments, wordCount, measuredNarrationSeconds: totalSeconds };
  const report = {
    voice: source.voice.name,
    rateWordsPerMinute: source.voice.rateWordsPerMinute,
    sampleRateHz,
    channels: 1,
    segments: durations,
    totalSeconds,
  };
  await writeOutput(outputPlanPath, `${JSON.stringify(outputPlan, null, 2)}\n`);
  await writeOutput(
    join(options.outputDirectory, 'audio-durations.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeOutput(
    join(options.outputDirectory, 'narration-transcript.txt'),
    `${source.segments.map((segment) => segment.narration).join('\n\n')}\n`,
  );
  console.log(
    `Ready: ${segments.length} segments, ${wordCount} words, ${totalSeconds.toFixed(3)} seconds of local narration.`,
  );
}

main().catch((error) => {
  console.error(`Narration generation stopped: ${error.message}`);
  process.exitCode = 1;
});
