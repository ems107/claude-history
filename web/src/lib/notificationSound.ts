import type { AppSettings, StopKind, ToneChoice, ToneId } from '@claude-history/shared';
import { TONE_INHERIT, TONE_NONE } from '@claude-history/shared';

/**
 * The noise a stop makes: a synthesised tone, and optionally a voice saying which
 * of the two kinds it was.
 *
 * ## Why nothing here is a file
 *
 * There is no catalogue of tones inside a browser to pick from. The Notifications
 * API had a `sound` option in an early draft, no engine ever implemented it and
 * the spec dropped it; the only "native" sound a page can cause is the one
 * Windows plays over a system toast, which cannot be chosen and is not what this
 * app does anyway — the bell is drawn in the page. So a tone is either a file this
 * app ships or a shape it draws itself, and this is the second: six recipes of
 * oscillators and envelopes. No bytes shipped, no request made, nothing to
 * license, and nothing to go missing on somebody else's Windows.
 *
 * The ids and their labels are in `shared`, because the server validates the
 * setting and the dropdown draws it. **This is the only place a frequency is
 * written.**
 *
 * ## Why not a system notification instead
 *
 * `Notification` is secure-context only in Chrome, so it works on
 * `http://127.0.0.1` and NOT on `http://<lan-ip>:7433` — precisely the path
 * remote access exists to support (`docs/AI_REMOTE_ACCESS.md`). It is the same
 * trap `lib/tabs.ts` records for `crypto.randomUUID()`. `AudioContext` and
 * `speechSynthesis` carry no such gate: both work over plain HTTP, which is the
 * whole reason this feature is a sound rather than a toast.
 */

/** One oscillator: where it sits in the tone, how long it rings, how loud. */
interface Step {
  /** Hz. */
  freq: number;
  /** Seconds from the start of the tone. */
  at: number;
  /** Seconds. */
  dur: number;
  /** 0-1, before the master volume. */
  peak: number;
  /** `sine` unless something needs harmonics to survive a laptop speaker. */
  type?: OscillatorType;
}

/**
 * The six tones, written as notes rather than as numbers picked by hand:
 * everything here is an equal-tempered pitch, which is why two of them in
 * sequence sound like a chime and not like a fault.
 *
 * `knock` is the one exception to `sine`. It is deliberately low, and a sine at
 * 220 Hz is most of what a small speaker cannot reproduce — `triangle` keeps the
 * harmonics that make it audible at all on a laptop.
 */
const RECIPES: Record<Exclude<ToneId, typeof TONE_NONE>, readonly Step[]> = {
  // E5 -> B5. Gentle, and the default.
  chime: [
    { freq: 659.25, at: 0, dur: 0.18, peak: 0.5 },
    { freq: 987.77, at: 0.09, dur: 0.3, peak: 0.45 },
  ],
  // One A5, and out.
  blip: [{ freq: 880, at: 0, dur: 0.12, peak: 0.5 }],
  // E6 with its octave underneath at a whisper, which is what makes it read as a
  // bell being struck rather than as a beep.
  ping: [
    { freq: 1318.51, at: 0, dur: 0.5, peak: 0.38 },
    { freq: 2637.02, at: 0, dur: 0.18, peak: 0.1 },
  ],
  // C major, up.
  arp: [
    { freq: 523.25, at: 0, dur: 0.12, peak: 0.4 },
    { freq: 659.25, at: 0.075, dur: 0.12, peak: 0.4 },
    { freq: 783.99, at: 0.15, dur: 0.28, peak: 0.4 },
  ],
  // A3 -> F3, two soft knuckles on a door.
  knock: [
    { freq: 220, at: 0, dur: 0.12, peak: 0.55, type: 'triangle' },
    { freq: 174.61, at: 0.13, dur: 0.16, peak: 0.5, type: 'triangle' },
  ],
  // B5 -> F#5, said twice. A falling interval repeated is the one shape here that
  // sounds like it wants an answer, which is what `needs-you` is.
  alert: [
    { freq: 987.77, at: 0, dur: 0.1, peak: 0.5 },
    { freq: 739.99, at: 0.1, dur: 0.14, peak: 0.5 },
    { freq: 987.77, at: 0.28, dur: 0.1, peak: 0.5 },
    { freq: 739.99, at: 0.38, dur: 0.18, peak: 0.5 },
  ],
};

/** What the narrator says, in the CLI's own two categories. */
const PHRASES: Record<StopKind, string> = {
  'needs-you': 'Claude needs you',
  finished: 'Claude finished',
};

/**
 * One context for the page, made late.
 *
 * Late because an `AudioContext` is an audio thread, and a page whose owner has
 * the sound switched off should not be holding one. Nothing here creates it until
 * something is about to be heard, or the page is being primed for it.
 */
let ctx: AudioContext | null = null;
let unlockArmed = false;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    // A browser that refuses to make one at all. Everything below no-ops.
    return null;
  }
  return ctx;
}

function resume(c: AudioContext): void {
  if (c.state !== 'running') void c.resume().catch(() => {});
}

/**
 * Make sure the page is ALLOWED to make a noise, before it needs to.
 *
 * An `AudioContext` is born `suspended` until the page has been interacted with,
 * and a session stopping is by definition not an interaction — so the first tone
 * of the day would be scheduled into a context that never runs, and lost in
 * silence. Nothing can be done about that from inside the notification; it has to
 * be done from inside a gesture, earlier.
 *
 * So it is called from two directions: by the announcer when it learns the sound
 * is on, and by the play buttons in Settings — which are themselves a click, so
 * they go on to make the context in `playTone` and it is born running.
 * Idempotent, and free after the first time.
 *
 * **It touches no context of its own, and that is the point.** Making one here
 * would make it `suspended` (no gesture has happened yet, by construction) and
 * the `resume()` that followed would be refused — which Chrome reports as a
 * console warning, on every page load, for an audio thread nobody had asked for.
 * Made inside the gesture instead, a context is born `running` and there is
 * nothing to resume.
 */
export function primeAudio(): void {
  if (unlockArmed) return;
  unlockArmed = true;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    const c = context();
    if (c) resume(c);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** How long a tone lasts, in ms — what the narrator waits for. */
function toneLength(id: ToneId): number {
  if (id === TONE_NONE) return 0;
  return Math.max(...RECIPES[id].map((s) => s.at + s.dur)) * 1000;
}

/**
 * Play one tone. Answers how long it will last in ms, so a caller can queue
 * something behind it.
 *
 * **Every step gets an envelope**, and that is not polish: an oscillator started
 * and stopped at full gain clicks at both ends, and the click is louder than the
 * note. The attack is 5 ms — short enough to still read as percussive — and the
 * decay is exponential because that is how anything struck behaves. It ends at
 * 0.0001 rather than 0 because `exponentialRampToValueAtTime` cannot be given a
 * target of zero at all.
 */
export function playTone(id: ToneId, volume: number): number {
  if (id === TONE_NONE || volume <= 0) return 0;
  const c = context();
  if (!c) return 0;
  resume(c);
  const master = c.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume / 100));
  master.connect(c.destination);
  // A hair in the future: scheduling at exactly `currentTime` can land inside a
  // block the engine has already rendered, which swallows the attack.
  const t0 = c.currentTime + 0.01;
  for (const step of RECIPES[id]) {
    const osc = c.createOscillator();
    osc.type = step.type ?? 'sine';
    osc.frequency.value = step.freq;
    const gain = c.createGain();
    const start = t0 + step.at;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(step.peak, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + step.dur + 0.02);
  }
  return toneLength(id);
}

/**
 * Say something out loud, with a voice installed on this machine.
 *
 * **Local voices only** — see `localVoices`. A name that no longer matches
 * anything falls through to whatever the browser would have picked, because a
 * voice being uninstalled is not a reason to go silent.
 */
export function speak(text: string, voiceName: string, volume: number): void {
  const synth = window.speechSynthesis;
  if (!synth || volume <= 0) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = Math.min(1, Math.max(0, volume / 100));
  const voice = voiceName ? synth.getVoices().find((v) => v.name === voiceName && v.localService) : undefined;
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

/**
 * The voices this machine can speak with, and only those.
 *
 * **`localService` is a network rule, not a preference.** Edge lists "Natural"
 * voices that are synthesised on Microsoft's servers: speaking with one would be
 * a third automatic network call, which `CLAUDE.md` forbids outright. Filtering
 * here rather than at the dropdown means nothing downstream has to remember.
 *
 * `getVoices()` answers an empty list on the first call in Chrome and fills it
 * asynchronously, so waiting for `voiceschanged` is the normal path and not an
 * error case. The timeout is for a browser that never fires it and has no voices
 * either — an empty list is a true answer there.
 */
export function localVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const local = () => synth.getVoices().filter((v) => v.localService);
  const ready = local();
  if (ready.length > 0) return Promise.resolve(ready);
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      window.clearTimeout(timer);
      resolve(local());
    };
    timer = window.setTimeout(done, 2000);
    synth.addEventListener('voiceschanged', done);
  });
}

/** Which tone a per-kind choice actually means. */
export function resolveTone(choice: ToneChoice, general: ToneId): ToneId {
  return choice === TONE_INHERIT ? general : choice;
}

/**
 * Announce one stop: its tone, and then the sentence.
 *
 * **The voice goes BEHIND the tone, not over it.** Two sounds at once are one
 * noise, and the tone is the half that carries across a room — so the phrase is
 * queued for the moment the tone has finished ringing, which `playTone` answers
 * with. A silent tone means no wait at all.
 */
export function announceStop(kind: StopKind, settings: AppSettings): void {
  const tone = resolveTone(
    kind === 'needs-you' ? settings.notifyToneNeedsYou : settings.notifyToneFinished,
    settings.notifyTone,
  );
  const length = playTone(tone, settings.notifyVolume);
  if (!settings.notifyVoice) return;
  const say = () => speak(PHRASES[kind], settings.notifyVoiceName, settings.notifyVolume);
  if (length === 0) say();
  else window.setTimeout(say, length);
}
