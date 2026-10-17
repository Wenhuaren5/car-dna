import {useEffect, useState} from 'react';
import {validateCount} from '../model/profile';

/**
 * Whole-number input with explicit range validation.
 *
 * The value that reaches the profile is always a valid integer inside the limits, so no screen
 * can store a negative or fractional travel frequency. While the text is invalid the input keeps
 * what the user typed and shows the reason instead of silently repairing it.
 */
export default function CountInput({label, value, limits, onChange, hint, testId, ariaLabel, disabled}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');

  useEffect(() => {
    setText(String(value));
    setError('');
  }, [value]);

  const handleChange = event => {
    const raw = event.target.value;
    setText(raw);
    const check = validateCount(raw, limits);
    setError(check.error);
    if (!check.error) onChange(check.value);
  };

  return (
    <label className="count-input">
      {label}
      <input
        type="number"
        inputMode="numeric"
        step="1"
        min={limits.min}
        max={limits.max}
        value={text}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-invalid={error ? 'true' : undefined}
        data-testid={testId}
        onChange={handleChange}
      />
      {error
        ? <em className="field-error" data-testid={testId ? `${testId}-error` : undefined}>{error}</em>
        : (hint ? <small className="field-hint">{hint}</small> : null)}
    </label>
  );
}
