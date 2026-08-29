import { type AppSettings, defaultSettings } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { api } from '../api/client.ts';
import { markUsageRead } from '../api/usageReason.ts';
import { useActiveSessionsGuard } from '../components/ActiveSessionsDialog.tsx';
import { ChangedView } from '../components/settings/ChangedView.tsx';
import { ClaudeArea } from '../components/settings/ClaudeArea.tsx';
import { SettingsContext } from '../components/settings/context.ts';
import { DangerArea } from '../components/settings/DangerArea.tsx';
import { DataArea } from '../components/settings/DataArea.tsx';
import { NotificationsArea } from '../components/settings/NotificationsArea.tsx';
import { RemoteAccessArea } from '../components/settings/RemoteAccessArea.tsx';
import { SettingsNav } from '../components/settings/SettingsNav.tsx';
import { SystemArea } from '../components/settings/SystemArea.tsx';
import { type AreaId, CHANGED_VIEW, DEFAULT_AREA, findArea, groupIdOf, resolveAnchor } from '../lib/settingsCatalog.ts';

/** Must match the `anchor-flash` animation in styles.css. */
const ANCHOR_FLASH_MS = 2_500;

const AREA_CONTENT: Record<AreaId, () => ReactElement> = {
  notifications: NotificationsArea,
  claude: ClaudeArea,
  access: RemoteAccessArea,
  data: DataArea,
  system: SystemArea,
  danger: DangerArea,
};

/**
 * The settings page: a rail, and one area at a time.
 *
 * It was 1461 lines and ten `<Section>`s in a single 672 px column — every kind
 * of thing this app can be told, plus everything it can be asked to do, plus
 * everything it merely reports, stacked in one scroll with no map. This file is
 * the shell alone now: which area is showing, what a save does, and where a deep
 * link lands. The areas live in `components/settings/`, and what exists at all
 * lives in `lib/settingsCatalog.ts`.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const dev = meta.data?.devInstance ?? false;
  const guard = useActiveSessionsGuard();
  const [note, setNote] = useState<string | null>(null);
  // The panel scrolls, not the window, and a deep link has to be told which
  // element that is before it can wait for the area to mount.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  const params = useParams();
  const { hash } = useLocation();
  /** The one route that is a list rather than an area. */
  const changedView = params.area === CHANGED_VIEW.id;
  /**
   * Which area is on screen, and the hash gets a say.
   *
   * `/settings#backups` is a bookmark and a README link, and it names a row in
   * an area the path does not: without this it rendered the DEFAULT area and
   * then looked for an element that was in a different one — landing you on
   * Notifications with nothing said. The path still wins when it names an area,
   * so `/settings/data#backups` is unaffected and no navigation ever happens
   * behind your back.
   */
  const area: AreaId = findArea(params.area ?? '')?.id ?? resolveAnchor(hash)?.area ?? DEFAULT_AREA;

  /**
   * The block the reader has clicked — nothing, until they do.
   *
   * Stored WITH the area it belongs to rather than reset by an effect: switching
   * area then makes the previous mark irrelevant on the render that switches,
   * with no second pass and no ordering to get wrong against the anchor effect
   * below, which selects on arrival.
   */
  const [mark, setMark] = useState<{ area: AreaId; id: string | null }>({ area, id: null });
  const selected = mark.area === area ? mark.id : null;
  const select = useCallback((id: string | null) => setMark({ area, id }), [area]);
  const flashed = useAnchor(scroller, !!data, select);

  if (!data) return <div className="p-8 text-[var(--text-dim)]">Loading settings…</div>;

  const save = (patch: Partial<AppSettings>) => {
    void api
      .saveSettings(patch)
      .then((r) => {
        queryClient.setQueryData(['settings'], { ...data, settings: r.settings });
        markUsageRead('widget-settings');
        void queryClient.invalidateQueries({ queryKey: ['usage'] });
        void queryClient.invalidateQueries({ queryKey: ['autoReload'] });
        // The hidden-folder option changes what the browsing views contain.
        for (const key of ['sessions', 'projects', 'prompts']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
        setNote(null);
      })
      .catch((e: unknown) => {
        // Two of these can be refused — `chatEnabled` and `chatMode`, while the
        // app is running Claude — and the refusal is a dialog with the sessions
        // in it. Saving again is what happens if they are closed from there.
        if (guard.refused(e, () => save(patch))) return;
        setNote(e instanceof Error ? e.message : String(e));
      });
  };

  const info = changedView ? CHANGED_VIEW : findArea(area);
  const Content = changedView ? ChangedView : AREA_CONTENT[area];

  return (
    <SettingsContext.Provider
      value={{ settings: data.settings, defaults: defaultSettings(dev), meta: data, dev, save, flashed, selected, select }}
    >
      <div className="flex h-full">
        <SettingsNav area={changedView ? null : area} />
        {/* One delegated click for the whole panel, the way the conversation
            does it: the block you clicked, or null for the space beside them,
            which is what deselecting is. Controls inside a block are not
            excluded — clicking a switch is clicking its block, and the ring
            then says where you just were. */}
        <div
          ref={setScroller}
          onClick={(e) =>
            select((e.target as Element).closest('[data-settings-group]')?.getAttribute('data-settings-group') ?? null)
          }
          className="min-w-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-5xl space-y-4 px-6 py-5">
            <header>
              <h1 className="text-lg font-semibold">{info?.title}</h1>
              <p className="text-xs text-[var(--text-dim)]">{info?.blurb}</p>
            </header>
            {/* A refused save, said once and at the top rather than beside
                whichever control happened to ask. */}
            {note && <p className="rounded border border-red-500/40 px-2 py-1.5 text-xs text-red-300">{note}</p>}
            <Content />
          </div>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}

/**
 * Landing on `#something`: scroll to it, and mark it for a moment.
 *
 * Scrolling alone leaves you looking at a wall of settings with no clue which
 * one you were sent to, which is what the flash answers. The id may name a group
 * (`#backups`, from a bookmark or the README) or a single row
 * (`#set-notifyVolume`, from the search box) — `resolveAnchor` takes either, and
 * the route has already put the right area on screen by the time this runs.
 *
 * Keyed on the navigation's own key as well as the hash, so following the same
 * link twice flashes again; never on the settings object, which changes on every
 * save and would yank the page back mid-edit.
 *
 * **And the link LEAVES its block selected**, the way arriving at a message does
 * in the viewer. The flash answers "which row" and then gets out of the way,
 * which is right for an animation and wrong as the only record: a minute after
 * arriving from the search, the page should still be pointing at what you came
 * for. `onArrive` is held in a ref so that a caller which is a new function on
 * every render cannot re-fire the scroll.
 */
function useAnchor(
  scroller: HTMLElement | null,
  loaded: boolean,
  onArrive: (groupId: string | null) => void,
): string | null {
  const { hash, key: navigationKey } = useLocation();
  const [flashed, setFlashed] = useState<string | null>(null);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  useEffect(() => {
    if (!hash || !loaded || !scroller) return;
    const target = resolveAnchor(hash);
    if (!target) return;
    // A frame later: the area that owns this id may have been mounted by the
    // very navigation that carried the hash, and an element that does not exist
    // yet cannot be scrolled to.
    const raf = requestAnimationFrame(() => {
      document.getElementById(target.id)?.scrollIntoView({ block: 'start' });
      setFlashed(target.id);
      arrive.current(groupIdOf(target.id));
    });
    // Dropped once the animation is over, so the class does not linger and
    // replay on the next unrelated re-render.
    const timer = setTimeout(() => setFlashed(null), ANCHOR_FLASH_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [hash, navigationKey, loaded, scroller]);
  return flashed;
}
