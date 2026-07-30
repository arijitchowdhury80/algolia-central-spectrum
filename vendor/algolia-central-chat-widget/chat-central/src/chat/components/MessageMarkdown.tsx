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
 * Supports: fenced code blocks, inline code, **bold**, ATX headings (#–######),
 * bullet/ordered lists, GFM tables, and [text](https://…) links (http/https only).
 * Anything else renders as plain text.
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
        <strong key={`${keyPrefix}-${i++}`} className="font-algolia-bold">
          {bold}
        </strong>,
      );
    } else if (code !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-${i++}`}
          className="rounded-algolia-sm bg-algolia-surface-2 px-1 py-0.5 font-algolia-mono text-algolia-xs text-algolia-text"
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
          className="text-algolia-link underline underline-offset-2"
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
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_ROW_RE = /^\|/;

/** Split a GFM table row into trimmed cell strings. */
function parseTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/** A separator row contains only dashes, colons, and pipes (e.g. `:---`, `---:`). */
function isTableSeparator(line: string): boolean {
  return parseTableRow(line).every((c) => /^:?-+:?$/.test(c) && c.length > 0);
}

function splitBlocks(text: string): string[] {
  return text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
}

type Run =
  | { kind: 'bullet' | 'ordered' | 'prose'; lines: string[] }
  | { kind: 'heading'; lines: string[]; level: number }
  | { kind: 'table'; lines: string[] };

function groupIntoRuns(block: string): Run[] {
  const runs: Run[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      // Each heading is always its own run — never merged.
      runs.push({ kind: 'heading', lines: [line], level: headingMatch[1].length });
      continue;
    }
    if (TABLE_ROW_RE.test(line)) {
      const last = runs[runs.length - 1];
      if (last && last.kind === 'table') {
        last.lines.push(line);
      } else {
        runs.push({ kind: 'table', lines: [line] });
      }
      continue;
    }
    const kind: 'bullet' | 'ordered' | 'prose' = BULLET_ITEM_RE.test(line)
      ? 'bullet'
      : ORDERED_ITEM_RE.test(line)
        ? 'ordered'
        : 'prose';
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.lines.push(line);
    } else {
      runs.push({ kind, lines: [line] });
    }
  }
  return runs;
}

const HEADING_SIZE_CLASS: Record<number, string> = {
  1: 'text-algolia-xl',
  2: 'text-algolia-lg',
  3: 'text-algolia-md',
  4: 'text-algolia-sm',
  5: 'text-algolia-sm',
  6: 'text-algolia-sm',
};

function renderRun(run: Run, keyPrefix: string): ReactNode {
  if (run.kind === 'table') {
    const rows = run.lines.map(parseTableRow);
    const headerRow = rows[0] ?? [];
    // Skip the separator row if present (typically the second line).
    const bodyStart = rows.length > 1 && isTableSeparator(run.lines[1]) ? 2 : 1;
    const bodyRows = rows.slice(bodyStart);
    return (
      <div key={keyPrefix} className="overflow-x-auto">
        <table className="w-full border-collapse text-algolia-sm text-algolia-text">
          <thead>
            <tr>
              {headerRow.map((cell, ci) => (
                <th
                  key={ci}
                  className="border border-algolia-border bg-algolia-surface-2 px-3 py-2 text-left font-algolia-bold"
                >
                  {renderInline(cell, `${keyPrefix}-h${ci}`)}
                </th>
              ))}
            </tr>
          </thead>
          {bodyRows.length > 0 && (
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-algolia-border px-3 py-2">
                      {renderInline(cell, `${keyPrefix}-r${ri}c${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    );
  }
  if (run.kind === 'heading') {
    const headingMatch = HEADING_RE.exec(run.lines[0]);
    const headingText = headingMatch ? headingMatch[2] : run.lines[0];
    const sizeClass = HEADING_SIZE_CLASS[run.level] ?? 'text-algolia-sm';
    return (
      <p
        key={keyPrefix}
        className={`m-0 break-words font-algolia-bold leading-ac-body text-algolia-text ${sizeClass}`}
      >
        {renderInline(headingText, keyPrefix)}
      </p>
    );
  }
  if (run.kind === 'prose') {
    return (
      <p
        key={keyPrefix}
        className="m-0 whitespace-pre-wrap break-words text-algolia-sm leading-ac-body text-algolia-text"
      >
        {renderInline(run.lines.join('\n'), keyPrefix)}
      </p>
    );
  }
  const itemRe = run.kind === 'bullet' ? BULLET_ITEM_RE : ORDERED_ITEM_RE;
  const ListTag = run.kind === 'bullet' ? 'ul' : 'ol';
  return (
    <ListTag
      key={keyPrefix}
      className={`m-0 space-y-3 py-1 pl-6 marker:font-algolia-bold marker:text-algolia-accent text-algolia-sm leading-ac-body text-algolia-text ${
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
            className="m-0 max-w-full overflow-x-auto rounded-algolia-sm border border-algolia-border bg-algolia-surface-2 p-3 font-algolia-mono text-algolia-xs leading-ac-body text-algolia-text"
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
