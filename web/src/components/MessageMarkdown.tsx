import { Fragment, type ReactNode } from 'react';

export interface MessageMarkdownProps {
  text: string;
}

interface TextSegment {
  type: 'text' | 'code-block';
  content: string;
  lang?: string;
}

/**
 * XSS-safe markdown-lite renderer. Deliberately hand-rolled instead of
 * dangerouslySetInnerHTML + a sanitizer: every node here is a real React
 * element built from parsed substrings, so there is no HTML-injection surface
 * to sanitize in the first place — safety by construction, not by scrubbing.
 * Supports: fenced code blocks, inline code, **bold**, and [text](https://…)
 * links (http/https only). Anything else renders as plain text.
 */
function splitCodeBlocks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code-block', content: match[2], lang: match[1] || undefined });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^[\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const [, bold, code, linkText, linkHref] = match;
    if (bold !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-${i++}`} className="font-ac-bold">
          {bold}
        </strong>,
      );
    } else if (code !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-${i++}`}
          className="rounded-ac-sm bg-ac-surface-2 px-1 py-0.5 font-ac-mono text-ac-xs text-ac-text"
        >
          {code}
        </code>,
      );
    } else if (linkText !== undefined && linkHref !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-${i++}`}
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ac-link underline underline-offset-2"
        >
          {linkText}
        </a>,
      );
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

const BULLET_ITEM_RE = /^[*-]\s+(.*)$/;
const ORDERED_ITEM_RE = /^\d+[.)]\s+(.*)$/;

/** A "block" is a paragraph or a run of consecutive list-item lines (bullet
 *  OR numbered — a Generic/Technical answer uses both shapes and both need
 *  real list styling, not just a preserved line break). */
function splitBlocks(text: string): string[] {
  return text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
}

function renderParagraphs(text: string, keyPrefix: string): ReactNode {
  return splitBlocks(text).map((block, pi) => {
    const lines = block.split('\n');
    const isBulletList = lines.every((line) => BULLET_ITEM_RE.test(line.trim()) || line.trim().length === 0);
    const isOrderedList =
      !isBulletList && lines.every((line) => ORDERED_ITEM_RE.test(line.trim()) || line.trim().length === 0);

    if (isBulletList || isOrderedList) {
      const itemRe = isBulletList ? BULLET_ITEM_RE : ORDERED_ITEM_RE;
      const ListTag = isBulletList ? 'ul' : 'ol';
      return (
        <ListTag
          key={`${keyPrefix}-l-${pi}`}
          className={`m-0 space-y-1 pl-5 text-ac-sm leading-ac-body text-ac-text ${
            isBulletList ? 'list-disc' : 'list-decimal'
          }`}
        >
          {lines
            .filter((line) => line.trim().length > 0)
            .map((line, li) => {
              const itemText = line.trim().replace(itemRe, '$1');
              return (
                <li key={`${keyPrefix}-l-${pi}-${li}`}>{renderInline(itemText, `${keyPrefix}-l-${pi}-${li}`)}</li>
              );
            })}
        </ListTag>
      );
    }

    return (
      <p
        key={`${keyPrefix}-p-${pi}`}
        className="m-0 whitespace-pre-wrap break-words text-ac-sm leading-ac-body text-ac-text"
      >
        {renderInline(block, `${keyPrefix}-p-${pi}`)}
      </p>
    );
  });
}

export function MessageMarkdown({ text }: MessageMarkdownProps) {
  const segments = splitCodeBlocks(text);
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) =>
        seg.type === 'code-block' ? (
          <pre
            key={i}
            className="m-0 max-w-full overflow-x-auto rounded-ac-sm border border-ac-border bg-ac-surface-2 p-3 font-ac-mono text-ac-xs leading-ac-body text-ac-text"
          >
            <code className="whitespace-pre">{seg.content.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          <Fragment key={i}>{renderParagraphs(seg.content, `seg-${i}`)}</Fragment>
        ),
      )}
    </div>
  );
}
