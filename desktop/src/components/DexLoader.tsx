// Lifted wholesale from the site's account-route loader (.dx-route-loader):
// an indeterminate progress bar with a phase label + detail. Used as the
// loading/skeleton affordance across screens so clicks reveal a loader
// immediately instead of freezing.

export function DexLoader({ phase = "Loading", detail }: { phase?: string; detail?: string }) {
  return (
    <div className="dx-loader" role="status" aria-live="polite">
      <div className="dx-loader-inner">
        <div className="dx-loader-meta">
          <span className="dx-loader-phase">{phase}</span>
          {detail ? <span className="dx-loader-detail">{detail}</span> : null}
        </div>
        <div className="dx-loader-track">
          <span className="dx-loader-fill" />
        </div>
      </div>
    </div>
  );
}

// A list of shimmer rows to occupy layout while a panel's data loads.
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="dx-skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="dx-skeleton-row" key={index}>
          <span className="dx-skeleton-line w-60" />
          <span className="dx-skeleton-line w-40" />
        </div>
      ))}
    </div>
  );
}
