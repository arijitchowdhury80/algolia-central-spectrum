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
 * Supports: fenced code blocks, inline code, **bold**, [text](https://…)
 * links, and bare https:// URLs (auto-linked). http/https only. Anything else
 * renders as plain text.
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

// Order matters: the markdown-link alternative must precede the bare-URL one so
// `[text](url)` is captured as a link, not as a bare URL.
const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^[\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()[\]]+)/g;

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
    const [, bold, code, linkText, linkHref, bareUrl] = match;
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
    } else if (bareUrl !== undefined) {
      // Auto-link a bare URL. Keep trailing sentence punctuation (e.g. the
      // period in "…Picker.html.") OUT of the href, rendered as plain text.
      const trailing = (bareUrl.match(/[.,;:!?]+$/) ?? [''])[0];
      const href = bareUrl.slice(0, bareUrl.length - trailing.length);
      nodes.push(
        <a
          key={`${keyPrefix}-${i++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ac-link underline underline-offset-2 break-all"
        >
          {href}
        </a>,
      );
      if (trailing) nodes.push(trailing);
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
/** ATX heading, 1–6 hashes. Observed on production 2026-07-30: answers routinely
 *  emit `### Key Features`, and with no rule for it the line fell through to the
 *  prose path and rendered the hashes literally. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** A "block" is separated from its neighbors by a blank line. A block is NOT
 *  itself guaranteed to be pure prose or a pure list — a real answer
 *  routinely writes an intro sentence and a numbered list in the SAME block
 *  ("Here's the process:\n1. Do X\n2. Do Y", one newline, no blank line
 *  before the list starts). Classifying by the WHOLE block (the previous
 *  approach) meant one non-list line anywhere in the block sent the entire
 *  block — intro AND list — to the plain-paragraph path, silently dropping
 *  list styling on real numbered answers. Fixed by grouping consecutive
 *  same-kind lines into RUNS within a block, not classifying the block as a
 *  single unit. */
function splitBlocks(text: string): string[] {
  return text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
}

export type Run = { kind: 'bullet' | 'ordered' | 'prose' | 'heading'; lines: string[] };

export function groupIntoRuns(block: string): Run[] {
  const runs: Run[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const kind: Run['kind'] = HEADING_RE.test(line)
      ? 'heading'
      : BULLET_ITEM_RE.test(line)
        ? 'bullet'
        : ORDERED_ITEM_RE.test(line)
          ? 'ordered'
          : 'prose';
    const last = runs[runs.length - 1];
    // Headings never merge: two consecutive heading lines are two headings, not
    // one two-line heading, unlike list items which accumulate into one list.
    if (last && last.kind === kind && kind !== 'heading') {
      last.lines.push(line);
    } else {
      runs.push({ kind, lines: [line] });
    }
  }
  return runs;
}

function renderRun(run: Run, keyPrefix: string): ReactNode {
  if (run.kind === 'heading') {
    const [, hashes, content] = run.lines[0].match(HEADING_RE) as RegExpMatchArray;
    // An answer is already inside a message bubble, so its headings are section
    // labels — one weight down from a page heading, and flat across levels 3-6
    // (a model's `###` and `####` mean the same thing in a chat answer).
    const size = hashes.length <= 2 ? 'text-ac-base' : 'text-ac-sm';
    return (
      <p key={keyPrefix} className={`m-0 pt-1 font-ac-bold leading-ac-heading text-ac-text ${size}`}>
        {renderInline(content, keyPrefix)}
      </p>
    );
  }
  if (run.kind === 'prose') {
    return (
      <p key={keyPrefix} className="m-0 whitespace-pre-wrap break-words text-ac-sm leading-ac-body text-ac-text">
        {renderInline(run.lines.join('\n'), keyPrefix)}
      </p>
    );
  }
  const itemRe = run.kind === 'bullet' ? BULLET_ITEM_RE : ORDERED_ITEM_RE;
  const ListTag = run.kind === 'bullet' ? 'ul' : 'ol';
  return (
    <ListTag
      key={keyPrefix}
      className={`m-0 space-y-3 py-1 pl-6 marker:font-ac-bold marker:text-ac-accent text-ac-sm leading-ac-body text-ac-text ${
        run.kind === 'bullet' ? 'list-disc' : 'list-decimal'
      }`}
    >
      {run.lines.map((line, li) => {
        const itemText = line.replace(itemRe, '$1');
        return <li key={`${keyPrefix}-${li}`}>{renderInline(itemText, `${keyPrefix}-${li}`)}</li>;
      })}
    </ListTag>
  );
}

function renderParagraphs(text: string, keyPrefix: string): ReactNode {
  return splitBlocks(text).map((block, pi) =>
    groupIntoRuns(block).map((run, ri) => renderRun(run, `${keyPrefix}-b${pi}-r${ri}`)),
  );
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
