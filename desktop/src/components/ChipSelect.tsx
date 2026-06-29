import { useState } from "react";

/** Single-select chips with an optional custom-value escape hatch (like the
 * "Someone else…" assignee pattern). The current value is always shown as a
 * chip even if it isn't one of the predefined options. */
export function ChipSelect({
  value,
  options,
  onChange,
  allowNone = false,
  allowCustom = true,
  customLabel = "Custom…",
}: {
  value: string;
  options: Array<string | { id: string; label: string }>;
  onChange: (next: string) => void;
  allowNone?: boolean;
  allowCustom?: boolean;
  customLabel?: string;
}) {
  const [custom, setCustom] = useState(false);
  const opts = options.map((o) => (typeof o === "string" ? { id: o, label: o } : o));
  const known = opts.some((o) => o.id === value);
  const showCustomInput = custom || (!!value && !known);

  return (
    <div className="meta-chips">
      {allowNone ? (
        <button type="button" className={`meta-chip ${!value ? "is-active" : ""}`} onClick={() => { setCustom(false); onChange(""); }}>None</button>
      ) : null}
      {opts.map((o) => (
        <button type="button" key={o.id} className={`meta-chip ${value === o.id ? "is-active" : ""}`} onClick={() => { setCustom(false); onChange(o.id); }}>
          {o.label}
        </button>
      ))}
      {allowCustom ? (
        showCustomInput ? (
          <input
            className="ws-input meta-custom"
            autoFocus={custom}
            value={known ? "" : value}
            placeholder="Custom…"
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => { if (!String(value || "").trim()) setCustom(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        ) : (
          <button type="button" className="meta-chip is-ghost" onClick={() => { setCustom(true); onChange(""); }}>{customLabel}</button>
        )
      ) : null}
    </div>
  );
}
