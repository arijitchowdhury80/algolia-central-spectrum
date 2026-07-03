import { useState, type KeyboardEvent } from 'react';

export interface ComposerProps {
  disabled: boolean;
  onSend: (query: string) => void;
}

/** Sticky-bottom composer. Enter sends, Shift+Enter inserts a newline. Send
 *  button is disabled while streaming and meets the 44px touch target. */
export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');

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
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="composer-input" className="sr-only">
        Ask about Adobe Spectrum design or React code
      </label>
      <textarea
        id="composer-input"
        className="composer__input"
        placeholder="Ask about Adobe Spectrum design or React code..."
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="submit"
        className="composer__send"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
      >
        Send
      </button>
    </form>
  );
}
