import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * An image small enough to sit in the flow, and a click away from being read.
 *
 * Both places that show a picture want the same two things — a thumbnail that
 * cannot break the column, and full size on demand — and they get their bytes
 * from different places: a prompt's attachment carries its own base64, a file on
 * disk comes off an endpoint. So the zoom lives here and the `src` is the
 * caller's business.
 *
 * A screenshot is usually the whole point of the message carrying it, and a
 * 16rem thumbnail is not enough to read one.
 */
export function ZoomableImage({
  src,
  alt,
  label,
  onError,
  size = 'thumb',
}: {
  src: string;
  alt: string;
  /** The line under the thumbnail — type and size, when the caller knows them. */
  label?: ReactNode;
  onError?: () => void;
  /**
   * `thumb` sits in the flow of a conversation, where 16rem is as much as a
   * message may spend on one picture. `fill` is for a panel opened to look at
   * this and nothing else, and a 4K screenshot shrunk to a thumbnail there is
   * the panel refusing to use the room it took.
   */
  size?: 'thumb' | 'fill';
}) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomed]);

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="block max-w-full cursor-zoom-in rounded border border-[var(--border)] p-0 hover:border-[var(--text-dim)]"
        title="Click to view full size"
      >
        {/* max-w-full on the button too: it shrink-wraps its content, so without
            it the image's own max-w-full resolves against a box as wide as the
            image and a 1498px screenshot overflows the column. */}
        <img
          src={src}
          alt={alt}
          onError={onError}
          className={`max-w-full rounded object-contain ${size === 'fill' ? 'max-h-[78vh]' : 'max-h-64'}`}
        />
      </button>
      {/* `data-chrome`: an attachment in a bubble puts this line inside a
          marking box, and "PNG · 120 KB" is something we wrote rather than
          something anybody said. The find bar's walk and the formatted copy
          both cut it out. */}
      {label && (
        <div data-chrome className="mt-0.5 text-[10px] text-[var(--text-dim)]">
          {label}
        </div>
      )}

      {/* Portalled: `inset-0` must mean the viewport, and inside a thread
          carrying a `zoom` it would mean the zoomed coordinate space instead —
          a full-screen overlay that covers neither the whole screen nor the
          image at its own scale. */}
      {zoomed &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
            onClick={() => setZoomed(false)}
          >
            <img src={src} alt={alt} className="max-h-full max-w-full rounded shadow-xl" />
          </div>,
          document.body,
        )}
    </div>
  );
}
