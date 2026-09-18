import { NOTIFY_VOLUME_MAX, NOTIFY_VOLUME_MIN, type ToneId } from '@claude-history/shared';
import { useSettingsPage } from './context.ts';
import { Anchored, DefaultBadge, Explain, Field, GroupCard, RangeField, ToggleField } from './controls.tsx';
import { PlayButton, ToneSelect, VoiceSelect } from './soundControls.tsx';

/**
 * What happens when a session stops.
 *
 * Four groups, and the order between them is the order the words depend on each
 * other: what is announced at all, what it sounds like in general, what each
 * KIND sounds like — a row reading "General tone (Chime)" only means something
 * once you have met the thing it defers to — and finally the voice, which
 * follows the tone in time as well as on the page.
 *
 * `notifyEnabled` governs all four, so it is the first group's `master` — the
 * switch, and the one line saying what off means — and the other three are
 * merely marked `off`. That is the difference from the first cut of this page,
 * where it was one checkbox among nine and switching it off turned the other
 * eight into unreadable grey with nothing saying why.
 */
export function NotificationsArea() {
  const { settings: s, save } = useSettingsPage();
  const off = !s.notifyEnabled;

  return (
    <>
      <GroupCard
        id="notify-announce"
        master="notifyEnabled"
        masterHint="The card that floats in under the header, and the sound."
        offNote="Nothing rings and no card appears. The bell goes on counting and listing whatever stopped — this switch is about being interrupted, not about being told."
      >
        <ToggleField
          field="notifyInFront"
          disabled={off}
          hint="Off by default: the page in front of you is already saying it."
        />
      </GroupCard>

      <GroupCard id="notify-sound" inactive={off}>
        <Field id="set-notifyTone" badge={<DefaultBadge field="notifyTone" />}>
          <ToneSelect
            label="General tone"
            value={s.notifyTone}
            general={s.notifyTone}
            volume={s.notifyVolume}
            disabled={off}
            hint="What a stop rings with unless its own kind is given a tone below."
            onChange={(v) => save({ notifyTone: v as ToneId })}
          />
        </Field>
        {/* The play button belongs to the slider as much as to the dropdown: a
            loudness you cannot hear while you set it is one you set by guessing. */}
        <RangeField
          field="notifyVolume"
          min={NOTIFY_VOLUME_MIN}
          max={NOTIFY_VOLUME_MAX}
          step={5}
          unit="%"
          disabled={off}
          hint="0 is silence, and it silences the voice with it."
          after={<PlayButton tone={s.notifyTone} volume={s.notifyVolume} disabled={off} />}
        />
      </GroupCard>

      {/* A kind's tone belongs UNDER that kind's own switch. As two separate
          lists — which stops, then a list of tones — no row of the second one
          owned anything, and the reader had to hold both orders in their head
          to see that they matched. */}
      <GroupCard id="notify-kinds" inactive={off}>
        <ToggleField field="notifyOnNeedsYou" disabled={off} hint="A permission prompt, a question, a plan to approve.">
          <Anchored id="set-notifyToneNeedsYou" className="flex items-start gap-2">
            <ToneSelect
              label="Tone"
              inherit
              value={s.notifyToneNeedsYou}
              general={s.notifyTone}
              volume={s.notifyVolume}
              disabled={off || !s.notifyOnNeedsYou}
              onChange={(v) => save({ notifyToneNeedsYou: v })}
            />
            <DefaultBadge field="notifyToneNeedsYou" />
          </Anchored>
        </ToggleField>

        <ToggleField
          field="notifyOnFinished"
          disabled={off}
          hint="The turn is over — whether it ended well or with an error."
        >
          <Anchored id="set-notifyToneFinished" className="flex items-start gap-2">
            <ToneSelect
              label="Tone"
              inherit
              value={s.notifyToneFinished}
              general={s.notifyTone}
              volume={s.notifyVolume}
              disabled={off || !s.notifyOnFinished}
              onChange={(v) => save({ notifyToneFinished: v })}
            />
            <DefaultBadge field="notifyToneFinished" />
          </Anchored>
        </ToggleField>

        <Explain label="Why these two, and why one of them shouts">
          <p>
            <span className="text-[var(--text)]">Waiting for your decision</span> is the kind that wants something from
            you — the same fact the bell states by listing it first and the card by drawing it in amber — so it
            overrides the general tone by default rather than inheriting it. Two tones nobody had to configure are two
            tones you learn.
          </p>
          <p>
            The session in front of you is normally not announced at all: the page is already saying it, so the card and
            the tone are suppressed and the bell row is withdrawn on sight. <em>Announce the session on screen too</em>
            {' '}makes it ring like any other, for whoever looks away from the window without leaving it.
          </p>
        </Explain>
      </GroupCard>

      <GroupCard id="notify-voice" inactive={off}>
        <ToggleField
          field="notifyVoice"
          disabled={off}
          hint="Once the tone has finished, a voice says which of the two it was."
        >
          {/* No default marker on the voice, for the reason autoReloadCwd has
              none: its default is "whichever the browser picks", and a click
              that quietly un-chooses your voice is not a restore. The catalogue
              says so with `noDefault`, and the badge reads it. */}
          <Anchored id="set-notifyVoiceName">
            <VoiceSelect
              value={s.notifyVoiceName}
              volume={s.notifyVolume}
              disabled={off || !s.notifyVoice}
              onChange={(v) => save({ notifyVoiceName: v })}
            />
          </Anchored>
        </ToggleField>

        <Explain label="Why only some voices are offered">
          <p>
            Only voices installed on this machine are listed. The “Natural” ones Edge offers are synthesised on
            Microsoft's servers, so speaking with one would be a third automatic network call — and this app makes none
            it was not asked to make.
          </p>
          <p>
            It is off by default where the card and the tone are not, and the difference is what each one does to a
            room: a machine that dings at you unasked is a notification, and one that talks at you unasked is a fright.
          </p>
        </Explain>
      </GroupCard>
    </>
  );
}
