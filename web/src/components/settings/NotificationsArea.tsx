import { NOTIFY_VOLUME_MAX, NOTIFY_VOLUME_MIN, type ToneId } from '@claude-history/shared';
import { Anchored, DefaultBadge, Explain, Field, GroupCard, NumberField, ToggleField } from './controls.tsx';
import { useSettingsPage } from './context.ts';
import { ToneSelect, VoiceSelect, toneChoiceText } from './soundControls.tsx';

/**
 * What happens when a session stops.
 *
 * Four groups, and the order between them is the order the words depend on each
 * other: what is announced, what it sounds like in general, what each KIND
 * sounds like — a row reading "General tone (Chime)" only means something once
 * you have met the thing it defers to — and finally the voice, which follows the
 * tone in time as well as on the page.
 */
export function NotificationsArea() {
  const { settings: s, save } = useSettingsPage();
  // With the feature off none of its settings do anything, so grey them all out
  // rather than leave controls that look live and are not.
  const off = !s.notifyEnabled;

  return (
    <>
      <GroupCard id="notify-announce">
        <ToggleField
          field="notifyEnabled"
          hint="The card that floats in under the header, and the sound. The bell keeps its list either way — this switch is about being interrupted, not about being told."
        />
        <ToggleField
          field="notifyInFront"
          disabled={off}
          hint="By default the session in front of you is never announced — the page is already saying it. This makes it ring and raise its card like any other."
        />
      </GroupCard>

      <GroupCard id="notify-sound">
        <Field id="set-notifyTone" badge={<DefaultBadge field="notifyTone" />}>
          <ToneSelect
            label="General tone"
            value={s.notifyTone}
            general={s.notifyTone}
            volume={s.notifyVolume}
            disabled={off}
            hint="What a notification rings with unless it is given a tone of its own below."
            onChange={(v) => save({ notifyTone: v as ToneId })}
          />
        </Field>
        <NumberField
          field="notifyVolume"
          before="Volume"
          after="%"
          min={NOTIFY_VOLUME_MIN}
          max={NOTIFY_VOLUME_MAX}
          step={5}
          disabled={off}
          note="0 is silence, and it silences the voice with it."
        />
      </GroupCard>

      {/* A kind's tone belongs UNDER that kind's own switch. As two separate
          lists — which stops, then a list of tones — no row of the second one
          owned anything, and the reader had to hold both orders in their head
          to see that they matched. */}
      <GroupCard id="notify-kinds">
        <ToggleField
          field="notifyOnNeedsYou"
          disabled={off}
          hint="A permission prompt, a question, a plan to approve — whatever the CLI put on screen and is now sitting on."
        >
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
            <DefaultBadge field="notifyToneNeedsYou" format={toneChoiceText} />
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
            <DefaultBadge field="notifyToneFinished" format={toneChoiceText} />
          </Anchored>
        </ToggleField>
      </GroupCard>

      <GroupCard id="notify-voice">
        <ToggleField
          field="notifyVoice"
          disabled={off}
          hint="Once the tone has finished, a voice says which of the two it was."
        />
        {/* No default marker on the voice, for the reason autoReloadCwd has
            none: its default is "whichever the browser picks", and a click that
            quietly un-chooses your voice is not a restore. The catalogue says so
            with `noDefault`, and the badge reads it. */}
        <Field id="set-notifyVoiceName">
          <div className="ml-6">
            <VoiceSelect
              value={s.notifyVoiceName}
              volume={s.notifyVolume}
              disabled={off || !s.notifyVoice}
              onChange={(v) => save({ notifyVoiceName: v })}
            />
          </div>
        </Field>
        <Explain label="Why only some voices are offered">
          <p>
            Only voices installed on this machine are listed. The “Natural” ones Edge offers are synthesised on
            Microsoft's servers, so speaking with one would be a third automatic network call — and this app makes none
            it was not asked to make.
          </p>
        </Explain>
      </GroupCard>
    </>
  );
}
