const SAMPLE_QUESTIONS = [
  'When should I use a ComboBox vs a Picker?',
  'Build a controlled ComboBox in React Spectrum S2',
  'How do I show a loading indicator?',
  'Date range input in React with i18n',
];

export interface EmptyStateProps {
  onPick: (question: string) => void;
}

/** Hero prompt + 4 sample-question chips + a one-line trust statement. Shown
 *  only before the first turn — complexity appears after the first send. */
export function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h1 className="empty-state__hero">Ask about Adobe Spectrum design + React code</h1>
      <div className="empty-state__samples">
        {SAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            className="empty-state__chip"
            onClick={() => onPick(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <p className="empty-state__trust">
        Grounded in Adobe Spectrum docs &mdash; answers cite their source.
      </p>
    </div>
  );
}
