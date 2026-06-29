// A faithful read-only replica of the entry sidebar, driven live from the
// editor's sidebarPageConfig. The real sidebar is hydrated client-side by
// assets/dex-sidebar.js behind auth (overview/collections/license/credits/
// file-info sections); this mirrors that structure + copy so the operator sees
// the effect of every field change without publishing.

import { BUCKETS } from "../domain";

function joinList(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value ?? "").trim();
}

function creditNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item ?? "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function CreditRow({
  label,
  value,
  linksByPerson,
}: {
  label: string;
  value: unknown;
  linksByPerson?: Record<string, Array<{ label?: string; href?: string }>>;
}) {
  const text = joinList(value);
  const names = creditNames(value);
  return (
    <>
      <span className="dx-sbp-key">{label}</span>
      <span className={`dx-sbp-value ${text ? "" : "dx-sbp-empty"}`}>
        {names.length ? names.map((name, index) => {
          const links = (linksByPerson?.[name] || []).filter((row) => row.href?.trim());
          return (
            <span key={name}>
              {index ? ", " : ""}
              {links.length ? <a href={links[0].href} target="_blank" rel="noreferrer" title={links.map((row) => row.label || row.href).join(", ")}>{name} ↗</a> : name}
              {links.length > 1 ? <sup>+{links.length - 1}</sup> : null}
            </span>
          );
        }) : "—"}
      </span>
    </>
  );
}

export function SidebarPreview({ title, sidebar }: { title: string; sidebar: any }) {
  const sb = sidebar || {};
  const credits = sb.credits || {};
  const video = credits.video || {};
  const audio = credits.audio || {};
  const fileSpecs = sb.fileSpecs || sb.downloads?.fileSpecs || {};
  const metadata = sb.metadata || {};
  const downloads = sb.downloads || {};
  const bucketFolders: Record<string, { fileCount?: number }> =
    downloads.bucketFolders && typeof downloads.bucketFolders === "object" ? downloads.bucketFolders : {};
  const selected: string[] = Array.isArray(downloads.selectedBuckets)
    ? downloads.selectedBuckets
    : Array.isArray(sb.buckets)
      ? sb.buckets
      : [];
  const tags: string[] = Array.isArray(metadata.tags) ? metadata.tags : [];
  const artist = joinList(credits.artist);
  const linksByPerson = credits.linksByPerson && typeof credits.linksByPerson === "object"
    ? credits.linksByPerson
    : {};

  return (
    <aside className="dx-sidebar-preview" aria-label="Sidebar preview">
      <section className="dx-sbp-section">
        <div className="dx-sbp-title">Overview</div>
        <div className="dx-sbp-entry-title">{title || "Untitled"}</div>
        <div className="dx-sbp-lookup">#{sb.lookupNumber || "—"}</div>
      </section>

      <section className="dx-sbp-section">
        <div className="dx-sbp-title">Collections</div>
        <div className="dx-sbp-key">Available buckets</div>
        <div className="dx-sbp-buckets">
          {BUCKETS.map((b) => {
            const on = selected.includes(b);
            const count = bucketFolders[b]?.fileCount;
            return (
              <span key={b} className={`dx-sbp-bucket ${on ? "on" : ""}`}>
                {b}
                {on && typeof count === "number" && count > 0 ? <span className="dx-sbp-count">{count}</span> : null}
              </span>
            );
          })}
        </div>
      </section>

      <section className="dx-sbp-section">
        <div className="dx-sbp-title">License</div>
        <span className="dx-sbp-badge">CC&nbsp;BY&nbsp;4.0</span>
        <div className="dx-sbp-attr">
          {sb.attributionSentence
            ? sb.attributionSentence
            : `This work contains samples licensed under CC-BY 4.0 by Dex Digital Sample Library and ${artist || "—"}`}
        </div>
      </section>

      <section className="dx-sbp-section">
        <div className="dx-sbp-title">Credits</div>
        <div className="dx-sbp-grid">
          <CreditRow label="Artist" value={credits.artist} linksByPerson={linksByPerson} />
          {credits.artistAlt ? <CreditRow label="Alias" value={credits.artistAlt} /> : null}
          <CreditRow label="Instrument" value={credits.instruments} />
        </div>
        <div className="dx-sbp-group-title">Video</div>
        <div className="dx-sbp-grid">
          <CreditRow label="Dir" value={video.director} linksByPerson={linksByPerson} />
          <CreditRow label="Cin" value={video.cinematography} linksByPerson={linksByPerson} />
          <CreditRow label="Edit" value={video.editing} linksByPerson={linksByPerson} />
        </div>
        <div className="dx-sbp-group-title">Audio</div>
        <div className="dx-sbp-grid">
          <CreditRow label="Rec" value={audio.recording} linksByPerson={linksByPerson} />
          <CreditRow label="Mix" value={audio.mix} linksByPerson={linksByPerson} />
          <CreditRow label="Master" value={audio.master} linksByPerson={linksByPerson} />
        </div>
        <div className="dx-sbp-buckets" style={{ marginTop: 8 }}>
          <span className="dx-sbp-bucket on">{[credits.season, credits.year].filter(Boolean).join(" ") || "—"}</span>
          <span className="dx-sbp-bucket on">{credits.location || "—"}</span>
        </div>
      </section>

      <section className="dx-sbp-section">
        <div className="dx-sbp-title">File info</div>
        <div className="dx-sbp-grid">
          <CreditRow label="Bit depth" value={fileSpecs.bitDepth ? `${fileSpecs.bitDepth}-bit` : ""} />
          <CreditRow label="Sample rate" value={fileSpecs.sampleRate ? `${(fileSpecs.sampleRate / 1000).toString()} kHz` : ""} />
          <CreditRow label="Channels" value={fileSpecs.channels} />
          <CreditRow label="Length" value={metadata.sampleLength} />
        </div>
        {tags.length ? (
          <div className="dx-sbp-buckets" style={{ marginTop: 8 }}>
            {tags.map((t) => <span key={t} className="dx-sbp-bucket">{t}</span>)}
          </div>
        ) : null}
      </section>
    </aside>
  );
}
