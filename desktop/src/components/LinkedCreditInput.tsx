import { useState } from "react";
import { Link2, Plus, Trash2, X } from "lucide-react";

export type CreditLink = { label: string; href: string };
export type CreditLinksByPerson = Record<string, CreditLink[]>;

function normalizeLinks(value: CreditLinksByPerson): CreditLinksByPerson {
  const next: CreditLinksByPerson = {};
  for (const [person, rows] of Object.entries(value || {})) {
    next[person] = (rows || []).map((row) => ({
      label: String(row?.label || ""),
      href: String(row?.href || ""),
    }));
  }
  return next;
}

export function LinkedCreditInput({
  value,
  linksByPerson,
  onValueChange,
  onLinksChange,
  placeholder = "Add credit…",
  ariaLabel,
}: {
  value: string[];
  linksByPerson: CreditLinksByPerson;
  onValueChange: (next: string[]) => void;
  onLinksChange: (next: CreditLinksByPerson) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState("");
  const [openPerson, setOpenPerson] = useState("");
  const tokens = Array.isArray(value) ? value : [];

  function commit(raw: string) {
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...tokens];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onValueChange(next);
    setDraft("");
  }

  function removeAt(index: number) {
    const person = tokens[index];
    onValueChange(tokens.filter((_, itemIndex) => itemIndex !== index));
    if (openPerson === person) setOpenPerson("");
  }

  function setLinks(person: string, rows: CreditLink[]) {
    const next = normalizeLinks(linksByPerson);
    if (rows.length) next[person] = rows;
    else delete next[person];
    onLinksChange(next);
  }

  const rows = openPerson ? normalizeLinks(linksByPerson)[openPerson] || [] : [];

  return (
    <div className="linked-credit" aria-label={ariaLabel}>
      <div className="token-input linked-credit-input">
        {tokens.map((token, index) => {
          const linkCount = (linksByPerson?.[token] || []).filter((row) => row.href?.trim()).length;
          return (
            <span className={`token linked-credit-token ${openPerson === token ? "is-open" : ""}`} key={`${token}-${index}`}>
              <button
                type="button"
                className="linked-credit-open"
                aria-expanded={openPerson === token}
                onClick={() => setOpenPerson((current) => current === token ? "" : token)}
                title={`Edit links for ${token}`}
              >
                {token}
                <Link2 className="icon" />
                {linkCount ? <span className="linked-credit-count">{linkCount}</span> : null}
              </button>
              <button type="button" className="token-x" aria-label={`Remove ${token}`} onClick={() => removeAt(index)}>
                <X className="icon" />
              </button>
            </span>
          );
        })}
        <input
          className="token-field"
          value={draft}
          placeholder={tokens.length ? "" : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Backspace" && !draft && tokens.length) {
              removeAt(tokens.length - 1);
            }
          }}
          onBlur={() => commit(draft)}
        />
      </div>

      {openPerson ? (
        <div className="linked-credit-editor">
          <div className="linked-credit-editor-head">
            <div>
              <span>Credit links</span>
              <strong>{openPerson}</strong>
            </div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpenPerson("")}>Done</button>
          </div>
          <div className="linked-credit-rows">
            {rows.map((row, index) => (
              <div className="linked-credit-row" key={index}>
                <input
                  aria-label={`Link label ${index + 1} for ${openPerson}`}
                  placeholder="Website, Instagram, portfolio…"
                  value={row.label}
                  onChange={(event) => setLinks(openPerson, rows.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, label: event.target.value } : item))}
                />
                <input
                  aria-label={`Link URL ${index + 1} for ${openPerson}`}
                  placeholder="https://…"
                  value={row.href}
                  onChange={(event) => setLinks(openPerson, rows.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, href: event.target.value } : item))}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  aria-label={`Remove link ${index + 1} for ${openPerson}`}
                  onClick={() => setLinks(openPerson, rows.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 className="icon" />
                </button>
              </div>
            ))}
            {!rows.length ? <p className="muted">No links yet. Add a website, social profile, or portfolio for this credit.</p> : null}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setLinks(openPerson, [...rows, { label: "Website", href: "" }])}
          >
            <Plus className="icon" /> Add link
          </button>
        </div>
      ) : null}
    </div>
  );
}
