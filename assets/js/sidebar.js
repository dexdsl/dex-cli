<!-- ─── Dex Sidebar: per-page Code Block ─── -->

<!-- A) Page-specific config – replace ONLY these values -->
<script>
    // Popup Pin Link Array Handler
    const pin = (name, links = []) =>
        `<span data-person="${name}" data-links='${JSON.stringify(links)}' style="position:relative; cursor:pointer;">
           ${name}<span class="person-pin"></span>
         </span>`;

    window.dexSidebarPageConfig = {
        lookupNumber: "ABCD-1234",
        buckets: ["A", "B", "C"], // which badges to fill
        specialEventImage:
            "/assets/img/ace3c685cb3b4b831032.png",
        attributionSentence: "YOUR ATTRIBUTION SENTENCE HERE",
        credits: {
            artist: pin("ARTIST NAME", [
                {
                    label: "More by this artist",
                    href: "/library?person=ARTIST%20NAME",
                },
                { label: "Official site", href: "https://artist-site.com" },
            ]),

            artistAlt: null, // stays plain text

            instruments: [
                pin("INSTRUMENT1", [
                    { label: "Instrument details", href: "/gear/instrument1" },
                ]),
                pin("INSTRUMENT2", [
                    { label: "Instrument details", href: "/gear/instrument2" },
                ]),
            ],

            video: {
                director: pin("VIDEO DIRECTOR", [
                    {
                        label: "All videos",
                        href: "/library?person=VIDEO%20DIRECTOR",
                    },
                    { label: "IMDb", href: "https://imdb.com/name/nm1234567" },
                ]),
                cinematography: pin("CINEMATOGRAPHY", [
                    { label: "Showreel", href: "https://cinema-pro.com" },
                ]),
                editing: pin("EDITING", [
                    { label: "Portfolio", href: "https://editor-site.com" },
                ]),
            },

            audio: {
                recording: pin("RECORDING ENGINEER", [
                    {
                        label: "Discography",
                        href: "/library?person=RECORDING%20ENGINEER",
                    },
                ]),
                mix: pin("MIX ENGINEER", [
                    { label: "Credits", href: "https://mix-pro.com" },
                ]),
                master: pin("MASTER ENGINEER", [
                    { label: "Credits", href: "https://master-engineer.com" },
                ]),
            },

            year: 2025,
            season: "S1",
            location: "LOCATION",
        },
        fileSpecs: {
            bitDepth: 24,
            sampleRate: 48000,
            channels: "stereo",
            staticSizes: {
                A: "SIZE A",
                B: "SIZE B",
                C: "SIZE C",
                D: "SIZE D",
                E: "SIZE E",
                X: "SIZE X",
            },
        },
        metadata: {
            sampleLength: "00:00:00",
            tags: ["TAG1", "TAG2"],
        },
    };
</script>

<!-- B) Sidebar container -->
<aside class="dex-sidebar">
    <section class="dex-overview"></section>
    <section class="dex-license"></section>
    <section class="dex-credits"></section>

    <!-- → REPLACED: Downloads / File Specs / Metadata merge into one dynamic card -->
    <section class="dex-file-info">
        <!-- tabs -->
        <div class="file-info-tabs" role="tablist">
            <button role="tab" data-tab="downloads" aria-selected="true">
                Download
            </button>
            <button role="tab" data-tab="file-specs" aria-selected="false">
                File Specs
            </button>
            <button role="tab" data-tab="metadata" aria-selected="false">
                Metadata
            </button>
        </div>
        <!-- panels -->
        <div class="file-info-panels">
            <div id="downloads" role="tabpanel"></div>
            <div id="file-specs" role="tabpanel" hidden></div>
            <div id="metadata" role="tabpanel" hidden></div>
        </div>
    </section>
</aside>

<!-- C) Renderer – reads #dex-manifest + #dex-sidebar-config -->
<script>
    (async function () {
        // 1) Global config
        const g = document.getElementById("dex-sidebar-config");
        if (!g) return console.error("Missing #dex-sidebar-config");
        const globalCfg = JSON.parse(g.textContent);

        // 2) Page config
        const page = window.dexSidebarPageConfig;

        // 3) Manifest
        const m = document.getElementById("dex-manifest");
        if (!m) return console.error("Missing #dex-manifest");
        const manifest = JSON.parse(m.textContent);

        // 4) Merge
        const cfg = {
            license: globalCfg.license,
            attributionSentence: page.attributionSentence,
            credits: page.credits,
            downloads: {
                driveBase: "https://drive.google.com/uc?export=download&id=",
                formats: globalCfg.downloads.formats,
                audioFileIds: manifest.audio,
                videoFileIds: manifest.video,
            },
            fileSpecs: page.fileSpecs,
            metadata: page.metadata,
        };

        // 5) Helpers

        const ALL_BUCKETS = ["A", "B", "C", "D", "E", "X"];
        const SERIES_URLS = {
            dex: "url(\"https://dexdsl.org/assets/series/dex.png\")",
            index: "url(\"https://dexdsl.org/assets/series/index.png\")",
            dexfest: "url(\"https://dexdsl.org/assets/series/dexfest.png\")",
        };

        const normalizeBuckets = (pageBuckets) =>
            Array.isArray(pageBuckets) ? pageBuckets : [];

        const buildBucketsHtml = (pageBuckets) => {
            const selected = normalizeBuckets(pageBuckets);
            return ALL_BUCKETS.map((bucket) => {
                const cls = selected.includes(bucket)
                    ? "available"
                    : "unavailable";
                return `<span class="badge ${cls}">${bucket}</span>`;
            }).join("");
        };

        const normalizeSeries = (series) => {
            const raw = String(series || "dex").toLowerCase();
            const key = raw === "index" ? "index" : raw;
            if (key === "index") {
                return { seriesKey: "index", seriesUrl: SERIES_URLS.index };
            }
            if (key === "dexfest") {
                return { seriesKey: "dexfest", seriesUrl: SERIES_URLS.dexfest };
            }
            return { seriesKey: "dex", seriesUrl: SERIES_URLS.dex };
        };

        function randomizeTitle(txt) {
            const U = txt.toUpperCase();
            const r = Math.random();
            const count = r < 0.4 ? 0 : r < 0.8 ? 1 : 2;
            if (!count) return U;

            // exclude these chars from duplication
            const excluded = new Set([
                "L",
                "T",
                "I",
                "A",
                "W",
                "M",
                "K",
                "&",
                "V",
                "Y",
                "H",
                "?",
                "!",
                "@",
                "#",
                "$",
                "%",
                "-",
            ]);

            // build list of valid positions
            const letters = [...U]
                .map((c, i) => ({ c, i }))
                .filter((o) => /\S/.test(o.c) && !excluded.has(o.c));

            if (letters.length === 0) return U; // nothing left to duplicate

            const { c, i } =
                letters[Math.floor(Math.random() * letters.length)];
            return U.slice(0, i + 1) + c.repeat(count) + U.slice(i + 1);
        }

        function buildUrl(type, bucket, key) {
            const id =
                type === "audio"
                    ? cfg.downloads.audioFileIds[bucket][key]
                    : cfg.downloads.videoFileIds[bucket][key];
            return cfg.downloads.driveBase + encodeURIComponent(id);
        }
        function render(sel, title, html, noHeader = false) {
            const container = document.querySelector(sel);
            if (!container) return;
            const header = noHeader ? "" : `<h3>${randomizeTitle(title)}</h3>`;
            container.innerHTML = header + html;
        }
        function attach(type, selector) {
            const allBuckets = ALL_BUCKETS;
            document.querySelectorAll(selector).forEach((el) => {
                el.addEventListener("click", () => {
                    const okLabel = randomizeTitle("Download");
                    const cancelLabel = randomizeTitle("Cancel");
                    const titleLabel = randomizeTitle(
                        "Select bucket &  format",
                    );

                    const modal = document.createElement("div");
                    modal.className = "dex-modal";
                    modal.innerHTML = `
        <div class="dex-modal-content"
              style="max-width:30rem; word-wrap:break-word; font-family:var(--font-body);">
          <h4 style="margin:0; white-space:pre-wrap; text-align:left;">
            ${randomizeTitle("Select bucket")}<br>& ${randomizeTitle("format")}
          </h4>
         <p class="modal-body-copy"
            style="white-space:normal; margin-bottom:var(--space-3);">
           ${
               type === "audio"
                   ? "Select the category you need—A: Full Performance, B: Chunks by Texture, C: Phrases, D: Moments, E: Impulses, X: Extras—to pinpoint the exact clip for your score, sound design, or YouTube project. Files are delivered in WAV and MP3 under CC-BY 4.0; choose your bucket and format, then Download now."
                   : "Select the category you need—A: Full Performance, B: Chunks by Texture, C: Phrases, D: Moments, E: Impulses, X: Extras—to pinpoint the exact footage for your film, motion design, or YouTube channel. Clips are delivered in 1080p and 4K under CC-BY 4.0; choose your bucket and format, then Download now."
           }
         </p>
          <select class="bucket-select">
            ${allBuckets
                .map((b) => {
                    const hasAny = !!(
                        cfg.downloads[type + "FileIds"][b] &&
                        Object.keys(cfg.downloads[type + "FileIds"][b]).length
                    );
                    return `<option value="${b}" ${!hasAny ? "disabled" : ""}>
                         ${b}${!hasAny ? " (unavailable)" : ""}
                       </option>`;
                })
                .join("")}
          </select>
          <select class="format-select"></select>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);">
            <button class="confirm-btn">${okLabel}</button>
            <button class="cancel-btn">${cancelLabel}</button>
          </div>
        </div>
      `;
                    document.body.append(modal);

                    // get refs
                    const bucketSel = modal.querySelector(".bucket-select");
                    const formatSel = modal.querySelector(".format-select");

                    // helper to (re)populate formats for a given bucket
                    function populateFormats(bucket) {
                        formatSel.innerHTML = cfg.downloads.formats[type]
                            .map((f) => {
                                const available = !!(
                                    cfg.downloads[type + "FileIds"][bucket] &&
                                    cfg.downloads[type + "FileIds"][bucket][
                                        f.key
                                    ]
                                );
                                return `<option value="${f.key}" ${!available ? "disabled" : ""}>
                      ${f.label}${!available ? " (unavailable)" : ""}
                    </option>`;
                            })
                            .join("");
                    }

                    // initialize formats based on the first (enabled) bucket
                    const firstBucketOption = bucketSel.querySelector(
                        "option:not([disabled])",
                    );
                    if (firstBucketOption) {
                        const firstBucket = firstBucketOption.value;
                        bucketSel.value = firstBucket;
                        populateFormats(firstBucket);
                    } else {
                        formatSel.innerHTML = "";
                    }

                    // when bucket changes, re-populate formats
                    bucketSel.addEventListener("change", (e) => {
                        populateFormats(e.target.value);
                    });

                    // close when clicking outside content
                    modal.addEventListener("click", (e) => {
                        if (e.target === modal) modal.remove();
                    });
                    // cancel button
                    modal
                        .querySelector(".cancel-btn")
                        .addEventListener("click", () => {
                            modal.remove();
                        });
                    // confirm!
                    modal
                        .querySelector(".confirm-btn")
                        .addEventListener("click", () => {
                            const b = bucketSel.value;
                            const k = formatSel.value;
                            window.open(buildUrl(type, b, k), "_blank");
                            modal.remove();
                        });
                });
            });
        }

        // re-bind after initial render
        attach("audio", ".btn-audio");
        attach("video", ".btn-video");

        // overview
        const lookup = page.lookupNumber || "";
        const badgesHtml = buildBucketsHtml(page.buckets);
        const { seriesKey, seriesUrl } = normalizeSeries(page.series);

        document.querySelector(".dex-overview").innerHTML = `
           <div class="dex-overview-row">
             <div class="dex-overview-lookup">
               <div class="dex-overview-lookupValue">#${lookup}</div>
               <div class="dex-overview-lookupLabel">Lookup #</div>
             </div>
             <div class="dex-overview-series" data-series="${seriesKey}">
               <div class="dex-overview-seriesMark" style="--dex-series-url:${seriesUrl}"></div>
               <div class="dex-overview-seriesLabel">Series</div>
             </div>
             <div class="dex-overview-buckets">
               <div class="dex-overview-badges">${badgesHtml}</div>
               <div class="dex-overview-bucketsLabel">Buckets</div>
             </div>
           </div>
         `;

        // 6) License (press-kit SVG badge, attribution, copy + usage notes)
        render(
            ".dex-license",
            "License",
            `
  <a class="dex-license-badge"
     href="https://creativecommons.org/licenses/by/4.0/"
     target="_blank" rel="noopener">
    <!-- official CC BY 4.0 badge SVG from the press-kit -->
    <img src="https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by.svg"
         alt="Creative Commons Attribution 4.0"
         class="badge-by"/>
  </a>

  <p class="dex-attrib">
    This work contains samples licensed under CC-BY 4.0 by Dex Digital Sample Library and ${cfg.credits.artist}
  </p>

  <div class="dex-license-controls">
    <button type="button" class="license-btn copy-btn dx-button-element--primary" title="Copy attribution">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
</svg>
      <span class="copy-text">Copy</span>
    </button>
    <button type="button" class="license-btn usage-btn dx-button-element--primary"
            onclick="window.open('https://dexdsl.com/copyright','_blank')">
      Usage Notes
    </button>
  </div>
`,
        );

        // inline “Copied!” toast
        const copyBtn = document.querySelector(".dex-license .copy-btn");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                const txt = `This work contains samples licensed under CC-BY 4.0 by Dex Digital Sample Library and ${cfg.credits.artist}`;
                navigator.clipboard.writeText(txt);
                const span = copyBtn.querySelector(".copy-text");
                const orig = span.textContent;
                span.textContent = "Copied!";
                setTimeout(() => (span.textContent = orig), 2000);
            });
        }

        // 7) Credits
        render(
            ".dex-credits",
            "Credits",
            `
  <p><strong>${cfg.credits.artist}</strong>${
      cfg.credits.artistAlt ? `<br>${cfg.credits.artistAlt}` : ""
  }</p>
  <p>${cfg.credits.instruments.join(", ")}</p>
  <p><em>Video:</em> Dir:${cfg.credits.video.director}, Cin:${cfg.credits.video.cinematography}, Edit:${cfg.credits.video.editing}</p>
  <p><em>Audio:</em> Rec:${cfg.credits.audio.recording}, Mix:${cfg.credits.audio.mix}, Master:${cfg.credits.audio.master}</p>
  <div class="dex-badges">
    <span class="badge"><!--🏷--> ${cfg.credits.season} ${cfg.credits.year}</span>
    <span class="badge"><!--📍--> ${cfg.credits.location}</span>
  </div>
`,
        );

        // 8) Downloads
        // Downloads tab — no <h3>:
        render(
            "#downloads",
            "Download",
            `
    <p>Please choose the asset you’d like to download:</p>
    <button type="button" class="btn-audio dx-button-element--primary" aria-label="Download Audio">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
</svg>

      <span>${randomizeTitle("Audio Files")}</span>
    </button>
    <button type="button" class="btn-video dx-button-element--primary" aria-label="Download Video">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0 1 18 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 0 1 6 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
</svg>

      <span>${randomizeTitle("Video Files")}</span>
    </button>
  `,
            true,
        );

        // ← **ADD THESE** so your modal pops up
        attach("audio", "#downloads .btn-audio");
        attach("video", "#downloads .btn-video");

        // File Specs tab — no <h3>:
        render(
            "#file-specs",
            "File Specs",
            `
    <p>All files are provided with the following specs:</p>
    <div class="dex-badges">
      <span class="badge">🎚 ${cfg.fileSpecs.bitDepth}-bit</span>
      <span class="badge">🔊 ${cfg.fileSpecs.sampleRate} Hz</span>
      <span class="badge">🎧 ${cfg.fileSpecs.channels}</span>
    </div>
    <div class="dex-badges">
      ${Object.entries(cfg.fileSpecs.staticSizes)
          .map(([b, s]) => `<span class="badge">📁 ${b}: ${s}</span>`)
          .join("")}
    </div>
  `,
            true,
        );

        // Metadata tab — no <h3>:
        render(
            "#metadata",
            "Metadata",
            `
    <p>This sample contains the following metadata:</p>
    <div class="dex-badges">
      <span class="badge">⏱ Length: ${cfg.metadata.sampleLength}</span>
      <span class="badge">🏷 Tags: ${cfg.metadata.tags.join(", ")}</span>
    </div>
  `,
            true,
        );

        /*──────────────────────────────*/
        /*  Person PIN / Link-tree UI   */
        /*──────────────────────────────*/
        function initPersonPins() {
            document.querySelectorAll("[data-person]").forEach((holder) => {
                holder.style.cursor = "pointer";
                holder.addEventListener("click", (e) => {
                    e.stopPropagation();
                    // close any open popups
                    document
                        .querySelectorAll(".person-popup")
                        .forEach((p) => p.remove());

                    const links = JSON.parse(holder.getAttribute("data-links"));
                    // build popup
                    const pop = document.createElement("div");
                    pop.className = "person-popup";
                    pop.innerHTML = links
                        .map(
                            (l) =>
                                `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`,
                        )
                        .join("");
                    document.body.append(pop);

                    // position near click
                    pop.style.position = "absolute";
                    pop.style.left = e.pageX + 4 + "px";
                    pop.style.top = e.pageY + 4 + "px";

                    // clicking anywhere else closes it
                    setTimeout(() => {
                        document.addEventListener(
                            "click",
                            function handler(evt) {
                                if (!pop.contains(evt.target)) {
                                    pop.remove();
                                    document.removeEventListener(
                                        "click",
                                        handler,
                                    );
                                }
                            },
                        );
                    }, 0);
                });
            });
        }

        // ① Randomize all of your tab labels:
        document.querySelectorAll(".file-info-tabs button").forEach((btn) => {
            btn.textContent = randomizeTitle(btn.textContent);
        });

        // ② Now install your click listeners:
        document.querySelectorAll(".file-info-tabs button").forEach((btn) => {
            btn.addEventListener("click", () => {
                // toggle selected state
                document
                    .querySelectorAll(".file-info-tabs button")
                    .forEach((b) => b.setAttribute("aria-selected", "false"));
                btn.setAttribute("aria-selected", "true");
                // show/hide panels
                const target = btn.dataset.tab;
                document
                    .querySelectorAll(".file-info-panels > div")
                    .forEach((panel) => (panel.hidden = panel.id !== target));
            });
        });
    })();
</script>
