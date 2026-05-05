// Pitch-based speaker gender detection.
// Used by Conversation (records audio) and Megaphone (parallel mic stream
// alongside SpeechRecognition, which doesn't expose raw audio).

export type Gender = "male" | "female" | "";

/** Autocorrelation F0 estimate in Hz, or 0 if signal is too quiet/unclear. */
export function detectPitch(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  let rmsVal = 0;
  for (let i = 0; i < SIZE; i++) rmsVal += buf[i] * buf[i];
  rmsVal = Math.sqrt(rmsVal / SIZE);
  if (rmsVal < 0.01) return 0;

  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 70);
  let bestCorr = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, SIZE - 1); lag++) {
    let corr = 0;
    for (let i = 0; i < SIZE - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestLag === 0) return 0;
  return sampleRate / bestLag;
}

/** Classify gender from collected pitch samples.
 *  - Octave correction: autocorrelation often locks onto the second harmonic;
 *    if the median lands above ~280 Hz we assume an octave error and halve.
 *  - Neutral zone 145–175 Hz returns "" so an ambiguous voice falls back to
 *    the user-profile preference instead of a random guess.
 */
export function classifyGender(pitches: number[]): Gender {
  if (pitches.length < 3) return "";

  const sorted = [...pitches].sort((a, b) => a - b);
  let median = sorted[Math.floor(sorted.length / 2)];

  if (median > 280) median = median / 2;

  if (median < 145) return "male";
  if (median > 175) return "female";
  return "";
}

export interface PitchAnalyzer {
  /** Stop collecting and return the classified gender. */
  finish: () => Gender;
  /** Stop and discard without classifying (no detection available). */
  cancel: () => void;
}

/** Start a parallel pitch analysis loop on a MediaStream. Caller owns the
 *  stream lifecycle — this only reads from it. Safe to call when the page
 *  already holds the mic via SpeechRecognition. */
export function startPitchAnalyzer(stream: MediaStream): PitchAnalyzer {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const samples: number[] = [];
  const buf = new Float32Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;
  let rafId = 0;

  const loop = () => {
    if (stopped) return;
    frame++;
    if (samples.length < 60 && frame % 6 === 0) {
      analyser.getFloatTimeDomainData(buf);
      const p = detectPitch(buf, ctx.sampleRate);
      if (p > 0) samples.push(p);
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    try { source.disconnect(); } catch {}
    try { ctx.close(); } catch {}
  };

  return {
    finish: () => {
      const g = classifyGender(samples);
      cleanup();
      return g;
    },
    cancel: () => {
      cleanup();
    },
  };
}
