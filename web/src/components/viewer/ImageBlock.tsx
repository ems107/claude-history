import type { ContentBlock } from '@claude-history/shared';
import { ZoomableImage } from './ZoomableImage.tsx';

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
 * transcript carries — the one kind of image whose bytes are in the payload, so
 * it needs no endpoint to show itself.
 */
export function ImageBlock({ block }: { block: ImageContentBlock }) {
  if (!block.data) {
    return (
      <div className="my-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)]">
        🖼 image attachment (no image data in the transcript)
      </div>
    );
  }

  const src = `data:${block.mediaType ?? 'image/png'};base64,${block.data}`;
  const label = `${(block.mediaType ?? 'image').replace(/^image\//, '').toUpperCase()} · ${formatBytes(decodedBytes(block.data))}`;

  return <ZoomableImage src={src} alt="Attachment" label={`🖼 ${label}`} />;
}
