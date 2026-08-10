import type { ContentBlock } from '@claude-history/shared';
import { useEffect, useState } from 'react';

type ImageContentBlock = Extract<ContentBlock, { kind: 'image' }>;

/** Base64 encodes 3 bytes as 4 chars, minus whatever the '=' padding stands in for. */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * An image the user attached to a prompt, rendered straight from the base64 the
 * transcript carries. Clicking it opens a full-size overlay — a screenshot
 * pasted into a prompt is usually the whole point of that prompt, and a 16rem
 * thumbnail is not enough to read one.
 */
export function ImageBlock({ block }: { block: ImageContentBlock }) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomed]);

  if (!block.data) {
    return (
      <div className="my-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)]">
        🖼 image attachment (no image data in the transcript)
      </div>
    );
  }

  const src = `data:${block.mediaType ?? 'image/png'};base64,${block.data}`;
  const label = `${(block.mediaType ?? 'image').replace(/^image\//, '').toUpperCase()} · ${formatBytes(decodedBytes(block.data))}`;

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
        <img src={src} alt="Attachment" className="max-h-64 max-w-full rounded object-contain" />
      </button>
      <div className="mt-0.5 text-[10px] text-[var(--text-dim)]">🖼 {label}</div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          onClick={() => setZoomed(false)}
        >
          <img src={src} alt="Attachment" className="max-h-full max-w-full rounded shadow-xl" />
        </div>
      )}
    </div>
  );
}
