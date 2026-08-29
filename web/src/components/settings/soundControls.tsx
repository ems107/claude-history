import {
  NOTIFICATION_TONES,
  TONE_INHERIT,
  TONE_NONE,
  type ToneChoice,
  type ToneId,
} from '@claude-history/shared';
import { useEffect, useState } from 'react';
import { localVoices, playTone, primeAudio, resolveTone, speak } from '../../lib/notificationSound.ts';
import { actionClass } from '../controlClass.ts';
import { selectClass } from './controls.tsx';

/**
 * The two controls that make a noise, and the words that go with them.
 *
 * Their own file because the explanations are long — why the play button is not
 * decoration, why `Silent` is drawn apart from the sounds, why only locally
 * installed voices are ever offered — and in the notifications area those
 * comments would bury the structure they belong to.
 */

/** The catalogue's own word for a tone — what the "general tone" option shows. */
export const toneLabel = (id: ToneId): string => NOTIFICATION_TONES.find((t) => t.id === id)?.label ?? id;

/** The same, for a value that may be the deferral rather than a tone. */
export const toneChoiceText = (v: ToneChoice): string => (v === TONE_INHERIT ? 'general tone' : v);

/**
 * A notification tone, with something that plays it.
 *
 * **The play button is not decoration.** A list of names for sounds nobody has
 * heard is not a choice, and these are drawn by an oscillator rather than taken
 * from a folder, so there is nowhere else to go and listen to them. It earns its
 * place twice over: a browser refuses to make a noise until something on the
 * page has been clicked, and a session stopping is not a click — so this is also
 * the gesture that unlocks the audio for the whole page (see `primeAudio`).
 *
 * `inherit` is offered only where a kind can defer to the general tone, and it
 * names the tone it currently resolves to rather than a position on the page.
 * "Same as above" was both unclear and a lie the moment anything moved between
 * the two — and the general tone has nothing above it to defer to anyway.
 *
 * **`Silent` is drawn apart from the sounds**, because it is not one and a list
 * of seven names says it is. It says so in words — `No tone (Silent)`, which
 * reads the same open or closed — and in italics, the typographic convention for
 * an entry that is an annotation rather than one of the things being listed.
 *
 * **Two styles inside one line is not on the table**: an `<option>`'s content
 * model is text, so no `<strong>` or `<em>` survives inside it, and a bold "No
 * tone" beside a light "(Silent)" would mean replacing the native `<select>`
 * with a listbox of our own — keyboard, focus, escape and ARIA included — and
 * this one dropdown then looking unlike the page's other two. The italic is what
 * a native option will actually honour; where a browser will not, the words are
 * still the words, which is why they carry the meaning and the style only
 * underlines it. An `<optgroup>` was tried here first and read worse: a lone
 * group heading under six bare options is a break in the list rather than a mark
 * on one entry, and it is invisible in the closed select anyway.
 */
export function ToneSelect({
  label,
  value,
  general,
  volume,
  disabled,
  inherit,
  hint,
  onChange,
}: {
  label: string;
  value: ToneChoice;
  /** The general tone, which is what `inherit` resolves to — and plays as. */
  general: ToneId;
  volume: number;
  disabled?: boolean;
  inherit?: boolean;
  hint?: string;
  onChange: (v: ToneChoice) => void;
}) {
  const resolved = resolveTone(value, general);
  const silent = resolved === TONE_NONE || volume <= 0;
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span>{label}</span>
          <select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value as ToneChoice)}
            className={selectClass}
          >
            {inherit && <option value={TONE_INHERIT}>General tone ({toneLabel(general)})</option>}
            {NOTIFICATION_TONES.filter((t) => t.id !== TONE_NONE).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value={TONE_NONE} className="italic">
              No tone (Silent)
            </option>
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || silent}
          onClick={() => {
            primeAudio();
            playTone(resolved, volume);
          }}
          // A disabled button that does not say why is a button that looks broken.
          title={volume <= 0 ? 'The volume is 0' : silent ? 'Silent — there is nothing to play' : 'Play it'}
          aria-label="Play the tone"
          className={actionClass}
        >
          ▶
        </button>
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">{hint}</p>}
    </div>
  );
}

/**
 * Which installed voice speaks, and a button to hear it.
 *
 * **Only local voices are listed, and that is a network rule rather than a
 * taste**: Edge offers "Natural" voices that are synthesised on Microsoft's
 * servers, so speaking with one would be a third automatic network call. The
 * filter itself lives in `localVoices`; this only draws what it answers.
 *
 * The list is asked for once, on the way in, because `getVoices()` comes back
 * empty on the first call and fills asynchronously — so an empty dropdown here
 * would be the normal case rather than the broken one. A saved voice that is no
 * longer installed is still listed, said so: it is what the setting holds, and
 * hiding it would leave the field looking empty and the sound unexplained.
 */
export function VoiceSelect({
  value,
  volume,
  disabled,
  onChange,
}: {
  value: string;
  volume: number;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  useEffect(() => {
    let alive = true;
    void localVoices().then((list) => {
      if (alive) setVoices(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  const missing = value !== '' && voices !== null && !voices.some((v) => v.name === value);
  return (
    <div className={`space-y-1 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Voice</span>
          <select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={selectClass}
          >
            <option value="">System default</option>
            {missing && <option value={value}>{value} (not installed)</option>}
            {(voices ?? []).map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || volume <= 0}
          onClick={() => speak('Claude needs you', value, volume)}
          title={volume <= 0 ? 'The volume is 0' : 'Say it'}
          className={actionClass}
        >
          Test
        </button>
      </div>
      {voices !== null && voices.length === 0 && (
        <p className="text-[11px] text-[var(--text-dim)]">
          No voices are installed on this machine, so nothing here can speak. Windows adds them under Time &amp;
          language → Speech.
        </p>
      )}
    </div>
  );
}

