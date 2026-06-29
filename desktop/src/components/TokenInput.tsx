import { useState } from "react";
import { X } from "lucide-react";

/** Chip/token editor for list-valued fields (artist, instruments, tags, …).
 * Replaces fragile comma-joined text: add with Enter/comma, remove with × or
 * Backspace on an empty input. Order is preserved. */
export function TokenInput({
  value,
  onChange,
  placeholder = "Add…",
  ariaLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState("");
  const tokens = Array.isArray(value) ? value : [];

  function commit(raw: string) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...tokens];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
    setDraft("");
  }

  function removeAt(index: number) {
    onChange(tokens.filter((_, i) => i !== index));
  }

  return (
    <div className="token-input" aria-label={ariaLabel}>
      {tokens.map((token, index) => (
        <span className="token" key={`${token}-${index}`}>
          {token}
          <button type="button" className="token-x" aria-label={`Remove ${token}`} onClick={() => removeAt(index)}>
            <X className="icon" />
          </button>
        </span>
      ))}
      <input
        className="token-field"
        value={draft}
        placeholder={tokens.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tokens.length) {
            removeAt(tokens.length - 1);
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
