import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewProps {
  content: string;
  className?: string;
  isUser?: boolean;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '', isUser = false }) => {
  if (isUser) {
    return <div className={`whitespace-pre-wrap ${className}`}>{content}</div>;
  }

  return (
    <div className={`markdown-content text-slate-800 text-xs sm:text-sm leading-relaxed space-y-2.5 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base sm:text-lg font-bold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm sm:text-base font-bold text-slate-900 mt-3.5 mb-2">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 mt-3 mb-1.5 text-blue-950 flex items-center gap-1.5">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-bold text-slate-800 mt-2 mb-1">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="leading-relaxed mb-2 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1 mb-2.5 marker:text-blue-500">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1 mb-2.5 marker:text-blue-600 font-medium">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-0.5">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-slate-700">
              {children}
            </em>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-blue-500 bg-blue-50/50 pl-3.5 py-1.5 my-2.5 rounded-r-lg text-slate-700 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3.5 border-slate-200" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 border border-slate-200 rounded-xl shadow-2xs bg-white">
              <table className="w-full text-left text-xs border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase text-[10px] tracking-wider">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-slate-100">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-slate-50/60 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="py-2.5 px-3 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="py-2.5 px-3 text-slate-700 align-top">
              {children}
            </td>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName && typeof children === 'string' && !children.includes('\n');
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-slate-100 text-blue-700 font-mono text-[11px] border border-slate-200/80">
                  {children}
                </code>
              );
            }
            return (
              <pre className="p-3 my-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto leading-normal">
                <code {...props}>{children}</code>
              </pre>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline font-medium inline-flex items-center gap-0.5"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
