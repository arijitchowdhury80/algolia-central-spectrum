import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface ComposerProps {
  disabled: boolean;
  onSend: (query: string) => void;
}

const MAX_HEIGHT_PX = 180;

/** Sticky-bottom composer. Auto-resizing textarea; Enter sends, Shift+Enter
 *  inserts a newline. Send button is disabled while streaming and meets the
 *  44px touch target. */
export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="flex items-end gap-2.5 rounded-ac-xl border border-ac-border bg-ac-surface p-2 shadow-ac-2 backdrop-blur-xl transition-colors duration-ac-fast ease-ac-ease focus-within:border-ac-accent"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="composer-input" className="sr-only">
        Ask a question
      </label>
      <textarea
        id="composer-input"
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a question..."
        className="min-h-[44px] max-h-[180px] flex-1 resize-none border-none bg-transparent px-2 py-2.5 text-ac-sm text-ac-text placeholder:text-ac-text-muted focus:outline-none disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="ac-glow-accent min-h-[44px] min-w-[44px] rounded-ac-full border-none bg-ac-accent px-5 font-ac-medium text-ac-text-on-accent transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-accent-hover disabled:opacity-45"
      >
        Send
      </button>
    </form>
  );
}
