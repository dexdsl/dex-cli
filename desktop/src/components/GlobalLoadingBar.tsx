import { useEffect, useState } from "react";
import { onRpcActivity, rpcActivityCount } from "../api";

// A thin Dex-gradient progress bar pinned to the top of the window that is
// visible whenever any RPC is in flight — so a click is never "blind".
export function GlobalLoadingBar() {
  const [active, setActive] = useState(rpcActivityCount() > 0);
  useEffect(() => onRpcActivity((count) => setActive(count > 0)), []);
  return (
    <div className={`dx-global-loader ${active ? "is-active" : ""}`} role="status" aria-live="polite" aria-hidden={!active}>
      <span className="dx-global-loader-fill" />
    </div>
  );
}
