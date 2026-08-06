import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/40 prose-pre:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
