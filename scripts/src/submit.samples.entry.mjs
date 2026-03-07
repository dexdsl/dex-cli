import { animate } from 'framer-motion/dom';

(() => {
  if (typeof window === 'undefined') return;
  if (window.__dxSubmitSamplesRuntimeLoaded) {
    if (typeof window.__dxSubmitSamplesMount === 'function') {
      try {
        window.__dxSubmitSamplesMount();
      } catch {}
    }
    return;
  }
  window.__dxSubmitSamplesRuntimeLoaded = true;

  const FETCH_STATE_LOADING = 'loading';
  const FETCH_STATE_READY = 'ready';
  const FETCH_STATE_ERROR = 'error';
  const DX_MIN_SHEEN_MS = 120;
  const AUTH_TIMEOUT_MS = 3200;
  const TOKEN_TIMEOUT_MS = 2600;
  const SUBMIT_TIMEOUT_MS = 15000;
  const SUBMIT_QUOTA_VERIFY_TIMEOUT_MS = 8000;
  const SUBMIT_MIN_LOADING_MS = 420;
  const ACHIEVEMENTS_REFRESH_TIMEOUT_MS = 5000;
  const JSONP_TIMEOUT_MS = 8000;
  const PREFETCH_SWR_MS = 60000;
  const QUOTA_RETRY_DELAY_MS = 220;
  const DEFAULT_API = 'https://dex-api.spring-fog-8edd.workers.dev';
  const DEFAULT_WEBAPP_URL =
    'https://script.google.com/macros/s/AKfycbyh5TPML3_y5-j1QoOKfju_MayO1_0JErwvVkH3Eba195q_EmWGCEu3CdFFeohWes3Qzw/exec';
  const DEFAULT_WEEKLY_LIMIT = 4;
  const DEFAULT_FLOW = 'sample';
  const FLOW_SAMPLE = 'sample';
  const FLOW_CALL = 'call';
  const CALL_SCHEMA_URL = '/data/submit.call.schema.json';
  const CALLS_REGISTRY_URL = '/data/calls.registry.json';
  const LANE_IDS = new Set(['in-dex-a', 'in-dex-b', 'in-dex-c', 'mini-dex']);
  const SUBCALL_IDS = new Set(['a', 'b', 'c']);

  const DEFAULT_CALL_SCHEMA = {
    version: 1,
    lanes: [
      {
        id: 'in-dex-a',
        label: 'IN DEX A',
        helper: 'Commissioned performance/proposal calls.',
        fields: [
          {
            key: 'callSubcall',
            label: 'Subcall',
            type: 'select',
            required: true,
            options: [
              { value: 'a', label: 'A.a Talks + discussions' },
              { value: 'b', label: 'A.b Acts' },
              { value: 'c', label: 'A.c Vendors' },
            ],
          },
          {
            key: 'proposalFormat',
            label: 'Proposal format',
            type: 'select',
            required: true,
            options: [
              { value: 'talk', label: 'Talk / panel' },
              { value: 'act', label: 'Performance / act' },
              { value: 'vendor', label: 'Vendor / installation' },
            ],
          },
          { key: 'runtimeMinutes', label: 'Runtime minutes', type: 'number', required: false, min: 1, max: 180 },
          { key: 'availabilityWindow', label: 'Availability window', type: 'text', required: false, maxLength: 120 },
          { key: 'portfolioUrl', label: 'Portfolio URL', type: 'url', required: false, maxLength: 600 },
        ],
      },
      {
        id: 'in-dex-b',
        label: 'IN DEX B',
        helper: 'Culling/composite/edit-oriented contribution calls.',
        fields: [
          {
            key: 'proposalFormat',
            label: 'Proposal format',
            type: 'select',
            required: true,
            options: [
              { value: 'edit', label: 'Edit/composite proposal' },
              { value: 'cull', label: 'Cull + sequence proposal' },
            ],
          },
          { key: 'runtimeMinutes', label: 'Runtime minutes', type: 'number', required: true, min: 1, max: 240 },
          { key: 'availabilityWindow', label: 'Availability window', type: 'text', required: false, maxLength: 120 },
          { key: 'portfolioUrl', label: 'Portfolio URL', type: 'url', required: false, maxLength: 600 },
        ],
      },
      {
        id: 'in-dex-c',
        label: 'IN DEX C',
        helper: 'Community feedback, polls, and forum collaboration.',
        fields: [
          {
            key: 'proposalFormat',
            label: 'Contribution mode',
            type: 'select',
            required: true,
            options: [
              { value: 'poll', label: 'Poll contribution' },
              { value: 'forum', label: 'Forum moderation / response' },
              { value: 'feedback', label: 'Feedback thread' },
            ],
          },
          { key: 'availabilityWindow', label: 'Availability window', type: 'text', required: true, maxLength: 120 },
          { key: 'portfolioUrl', label: 'Reference URL', type: 'url', required: false, maxLength: 600 },
        ],
      },
      {
        id: 'mini-dex',
        label: 'MINI-DEX',
        helper: 'Short volunteer call entries with quick turnaround.',
        fields: [
          {
            key: 'proposalFormat',
            label: 'Contribution format',
            type: 'select',
            required: true,
            options: [
              { value: 'field-recording', label: 'Field recording' },
              { value: 'voice-note', label: 'Voice note / spoken' },
              { value: 'other', label: 'Other material' },
            ],
          },
          { key: 'runtimeMinutes', label: 'Runtime minutes', type: 'number', required: false, min: 1, max: 30 },
          { key: 'portfolioUrl', label: 'Reference URL', type: 'url', required: false, maxLength: 600 },
        ],
      },
    ],
    limits: {
      proposalFormat: 80,
      runtimeMinutes: 240,
      availabilityWindow: 120,
      portfolioUrl: 600,
      notes: 2000,
    },
  };

  const STEPS = [
    { key: 'intro', title: 'Program Brief', short: 'Brief' },
    { key: 'metadata', title: 'Submission Metadata', short: 'Meta' },
    { key: 'license', title: 'License Agreement', short: 'License' },
    { key: 'upload', title: 'Upload Link + Services', short: 'Upload' },
    { key: 'done', title: 'Submission Complete', short: 'Done' },
  ];

  const CATEGORY_OPTIONS = [
    '',
    'V - Voice + Body',
    'K - Keyboards',
    'B - Brass',
    'E - Electronics',
    'S - Strings',
    'W - Winds',
    'P - Percussion',
    'X - Other',
  ];

  const COLLECTION_OPTIONS = [
    { value: 'V', label: 'Video' },
    { value: 'A', label: 'Audio' },
    { value: 'AV', label: 'Audio-visual' },
    { value: 'O', label: 'Other' },
  ];

  const OUTPUT_OPTIONS = [
    { value: '1080p', label: '1080p video' },
    { value: '4K', label: '4K video' },
    { value: 'ste', label: 'Stereo audio' },
    { value: '4ch', label: '4-channel audio' },
  ];

  const SERVICE_OPTIONS = [
    {
      value: 'chop',
      label: 'Bucket chop',
      locked: true,
      tooltip: 'Formal section cuts into A/B/C/D/E/X buckets for lookup-ready release packaging.',
    },
    {
      value: 'credits',
      label: 'Dex credits roll',
      locked: true,
      tooltip: 'Adds standard Dex attribution card and contribution metadata for the public release.',
    },
    {
      value: 'render',
      label: '1080p/MP3 copies',
      locked: true,
      tooltip: 'Creates delivery renditions for preview and accessibility while preserving source masters.',
    },
    {
      value: 'grade',
      label: 'Color grading',
      tooltip: 'Shot-to-shot color balancing and tonal matching for publication consistency.',
    },
    {
      value: 'mix',
      label: 'Mixing',
      tooltip: 'Balance and cleanup pass across stems/channels for release-ready intelligibility.',
    },
    {
      value: 'master',
      label: 'Mastering',
      tooltip: 'Final loudness, spectral, and dynamics polish for distribution targets.',
    },
    {
      value: 'extra',
      label: 'Other edits (notes)',
      tooltip: 'Custom requests described in notes: alt cuts, trims, or direction-specific revisions.',
    },
  ];

  const LICENSE_OPTIONS = [
    {
      id: 'joint',
      label: 'Joint CC-BY 4.0',
      summary: 'Dex can transform a library-ready copy; you keep your original rights.',
      copy: `Joint CC-BY 4.0 License Agreement\n\nBy selecting Joint CC-BY 4.0, you grant Dex a perpetual, worldwide, non-exclusive license to transform, remix, and redistribute a library-ready copy of your submission under CC-BY 4.0. You retain full ownership of the original. Downstream users must attribute you as entered in Creator.\n\nFull legal code:\nhttps://creativecommons.org/licenses/by/4.0/legalcode`,
    },
    {
      id: 'cc-by',
      label: 'CC-BY 4.0 (submitter-only)',
      summary: 'Dex hosts the file as submitted, without transformations.',
      copy: `CC-BY 4.0 (Submitter-Only) License Agreement\n\nBy selecting CC-BY 4.0 (Submitter-Only), you license Dex to host your submission exactly as provided. You retain all rights. Downstream users may use and adapt under CC-BY with mandatory attribution.\n\nFull legal code:\nhttps://creativecommons.org/licenses/by/4.0/legalcode`,
    },
    {
      id: 'cc0',
      label: 'CC0 (Public Domain)',
      summary: 'Waives rights for unrestricted public-domain usage.',
      copy: `CC0 1.0 Universal Public Domain Dedication\n\nBy selecting CC0, you waive copyright and related rights worldwide. Dex and all users may use, modify, and distribute your file without attribution or restriction.\n\nFull text:\nhttps://creativecommons.org/publicdomain/zero/1.0/legalcode`,
    },
  ];

  const KEY_CENTER_OPTIONS = [
    'C',
    'C♯/D♭',
    'D',
    'D♯/E♭',
    'E',
    'F',
    'F♯/G♭',
    'G',
    'G♯/A♭',
    'A',
    'A♯/B♭',
    'B',
  ];

  const KEY_CENTER_24_TET_OPTIONS = [
    'C',
    'C quarter-sharp',
    'C♯/D♭',
    'D quarter-flat',
    'D',
    'D quarter-sharp',
    'D♯/E♭',
    'E quarter-flat',
    'E',
    'E quarter-sharp',
    'F',
    'F quarter-sharp',
    'F♯/G♭',
    'G quarter-flat',
    'G',
    'G quarter-sharp',
    'G♯/A♭',
    'A quarter-flat',
    'A',
    'A quarter-sharp',
    'A♯/B♭',
    'B quarter-flat',
    'B',
    'B quarter-sharp',
  ];

  const PITCH_SYSTEM_OPTIONS = [
    { value: '12-tet', label: '12-TET' },
    { value: '24-tet', label: '24-TET' },
    { value: 'ji', label: 'Just Intonation (JI)' },
    { value: 'atonal', label: 'Atonal' },
    { value: 'non-pitched', label: 'Non-pitched' },
  ];

  const PITCH_DESCRIPTOR_HINTS = {
    ji: 'Examples: 5/4 on C, 7/4 on D, 11-limit drone on A',
  };

  const TAG_HINT =
    'Met, Fre, Perc, Sus, Cle, Dis, Mono, Poly, Lou, Qui, Med, Bra, Exc, Sta, Sho, Lon, Oth, Ow, Mid, Hi, Spa';

  const STEP_GUIDANCE = {
    intro: 'Review the process and quality targets before you start.',
    metadata: 'Provide enough context for fast review and routing.',
    license: 'Choose your licensing mode and complete rights attestation before upload handoff.',
    upload: 'Paste a public link and select optional post-production.',
    done: 'Track status in your inbox submission timeline.',
  };

  const FIELD_GUIDANCE = {
    title: {
      title: 'Title guidance',
      body:
        'Use a searchable working title that names instrument and technique. This becomes part of review and timeline context.',
    },
    creator: {
      title: 'Creator guidance',
      body:
        'List credited performers exactly as they should appear publicly. Submission lookup performer token still comes from your account surname.',
    },
    callLane: {
      title: 'Call lane guidance',
      body: 'Choose the lane matching this proposal. Lane selection drives queue routing and reviewer context.',
    },
    callSubcall: {
      title: 'Subcall guidance',
      body: 'IN DEX A requires subcall selection (A.a, A.b, or A.c) so the proposal reaches the correct panel.',
    },
    proposalFormat: {
      title: 'Proposal format guidance',
      body: 'Specify the proposal format clearly to reduce follow-up cycles and speed assignment.',
    },
    runtimeMinutes: {
      title: 'Runtime guidance',
      body: 'When applicable, provide realistic runtime in minutes for scheduling and review planning.',
    },
    availabilityWindow: {
      title: 'Availability guidance',
      body: 'Share a clear availability window so call scheduling can proceed without additional back-and-forth.',
    },
    portfolioUrl: {
      title: 'Reference guidance',
      body: 'Optional but useful: add a relevant portfolio/reference link that helps adjudicators evaluate fit.',
    },
    callCycle: {
      title: 'Call cycle guidance',
      body: 'Cycle is prefilled from deep links when available. Keep it aligned with the active call window.',
    },
    category: {
      title: 'Category guidance',
      body: 'Choose the closest instrument family code. It sets the lookup instrument type prefix.',
    },
    instrument: {
      title: 'Instrument guidance',
      body:
        'Use specific instrument wording. The first three alphabetic letters become the instrument token in generated submission lookup.',
    },
    bpm: {
      title: 'Tempo guidance',
      body: 'Optional. Add BPM when pulse matters for catalog filtering and downstream production use.',
    },
    pitchSystem: {
      title: 'Pitch system guidance',
      body: 'Select 12-TET, 24-TET, JI, atonal, or non-pitched. This drives key-center serialization.',
    },
    pitchDescriptor: {
      title: 'Pitch descriptor guidance',
      body:
        'For 12-TET and 24-TET choose a root; for JI provide ratio/reference. Atonal and non-pitched skip descriptor.',
    },
    scaleQuality: {
      title: 'Scale quality guidance',
      body: 'Optional context like major, modal, maqam, raga, or other tonal system details.',
    },
    tags: {
      title: 'Tag guidance',
      body: 'Use concise comma-separated tags for articulation, dynamics, space, and usage cues.',
    },
    collectionType: {
      title: 'Collection type guidance',
      body:
        'Audio, Video, Audio-visual, or Other. Type plus year becomes the TypeYear suffix in generated lookup.',
    },
    outputTypes: {
      title: 'Output guidance',
      body:
        'Choose desired publish renditions. Keep this aligned with what your source actually supports to reduce revision loops.',
    },
    licenseType: {
      title: 'License guidance',
      body: 'Select the rights model before upload so publication and downstream usage are unambiguous.',
    },
    licenseConfirmed: {
      title: 'Agreement guidance',
      body: 'Confirm agreement before continuing. Unchecked state blocks progression to upload.',
    },
    rightsConfirmed: {
      title: 'Rights attestation guidance',
      body:
        'Confirm this submission is your own work or work you are authorized to represent, and is not a repost of third-party public-domain material.',
    },
    signatureName: {
      title: 'Digital signature guidance',
      body: 'Type your full name as a digital signature to confirm this legal acknowledgment.',
    },
    link: {
      title: 'Source link guidance',
      body:
        'Provide a stable public URL for source media. Access issues delay review and can move the submission to revision requested.',
    },
    services: {
      title: 'Dex services guidance',
      body:
        'Each service chip includes scope details on hover/focus. Locked defaults are always applied for standard ingest.',
    },
    notes: {
      title: 'Notes guidance',
      body:
        'Use notes for constraints, edit priorities, and context staff should see during review and timeline updates.',
    },
  };

  function createInitialMeta() {
    return {
      title: '',
      creator: '',
      category: '',
      instrument: '',
      bpm: '',
      pitchSystem: '12-tet',
      pitchDescriptor: '',
      keyCenter: '',
      scaleQuality: '',
      tags: '',
      collectionType: '',
      outputTypes: [],
      services: ['chop', 'credits', 'render'],
      notes: '',
      link: '',
    };
  }

  function createInitialCallMeta() {
    return {
      title: '',
      creator: '',
      link: '',
      notes: '',
      callLane: '',
      callSubcall: '',
      callCycle: '',
      proposalFormat: '',
      runtimeMinutes: '',
      availabilityWindow: '',
      portfolioUrl: '',
    };
  }

  function cloneMeta(meta) {
    if (!meta || typeof meta !== 'object') return {};
    return { ...meta };
  }

  function normalizeFlow(value) {
    const flow = text(value, '').toLowerCase();
    return flow === FLOW_CALL ? FLOW_CALL : FLOW_SAMPLE;
  }

  function normalizeLane(value) {
    const lane = text(value, '').toLowerCase();
    return LANE_IDS.has(lane) ? lane : '';
  }

  function normalizeSubcall(value) {
    const subcall = text(value, '').toLowerCase();
    return SUBCALL_IDS.has(subcall) ? subcall : '';
  }

  function deriveLaneFromCycle(value) {
    const cycle = text(value, '').toLowerCase();
    if (!cycle) return '';
    if (cycle.includes('mini-dex') || cycle.includes('minidex')) return 'mini-dex';
    const match = cycle.match(/in dex\\s*([abc])/i) || cycle.match(/^([abc])\\d{4}\\./i);
    if (match?.[1]) return normalizeLane(`in-dex-${String(match[1]).toLowerCase()}`);
    return '';
  }

  function normalizeCallRegistryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const lane = normalizeLane(entry.lane) || deriveLaneFromCycle(entry.cycleLabel) || deriveLaneFromCycle(entry.cycleCode);
    const status = text(entry.status, '').toLowerCase();
    if (!lane || (status !== 'active' && status !== 'past' && status !== 'draft')) return null;
    return {
      id: text(entry.id),
      lane,
      status,
      cycle: text(entry.cycleLabel || entry.cycleCode),
      sequence: number(entry.sequence, 0),
    };
  }

  function normalizeActiveCallsFromRegistry(payload) {
    const list = Array.isArray(payload?.calls)
      ? payload.calls.map((item) => normalizeCallRegistryEntry(item)).filter(Boolean)
      : [];
    const active = list.filter((item) => item.status === 'active');
    const activeId = text(payload?.activeCallId, '');
    if (activeId) {
      const picked = active.find((item) => item.id === activeId);
      if (picked) return [picked];
    }
    if (active.length <= 1) return active;
    return [...active].sort((left, right) => right.sequence - left.sequence).slice(0, 1);
  }

  function buildRouteFlowHref({ flow, lane = '', subcall = '', cycle = '', via = '' }) {
    const params = new URLSearchParams();
    params.set('flow', normalizeFlow(flow));
    const safeLane = normalizeLane(lane);
    const safeSubcall = normalizeSubcall(subcall);
    if (safeLane) params.set('lane', safeLane);
    if (safeSubcall && safeLane === 'in-dex-a') params.set('subcall', safeSubcall);
    if (text(cycle)) params.set('cycle', text(cycle));
    if (text(via)) params.set('via', text(via));
    return `/entry/submit/?${params.toString()}`;
  }

  function replaceRouteFlowQuery(input = {}) {
    try {
      const next = buildRouteFlowHref({
        flow: input.flow,
        lane: input.lane,
        subcall: input.subcall,
        cycle: input.cycle,
        via: input.via,
      });
      window.history.replaceState({}, '', next);
    } catch {}
  }

  function parseRouteFlowState() {
    try {
      const url = new URL(String(window.location.href || ''), window.location.origin);
      const flow = normalizeFlow(url.searchParams.get('flow'));
      return {
        flow,
        explicitFlow: url.searchParams.has('flow'),
        lane: normalizeLane(url.searchParams.get('lane')),
        subcall: normalizeSubcall(url.searchParams.get('subcall')),
        cycle: text(url.searchParams.get('cycle')),
        via: text(url.searchParams.get('via')),
      };
    } catch {
      return { flow: FLOW_SAMPLE, explicitFlow: false, lane: '', subcall: '', cycle: '', via: '' };
    }
  }

  function baseFlowDraft(flowKey) {
    if (flowKey === FLOW_CALL) {
      return {
        meta: createInitialCallMeta(),
        licenseType: 'joint',
        licenseConfirmed: false,
        rightsConfirmed: false,
        signatureName: '',
      };
    }
    return {
      meta: createInitialMeta(),
      licenseType: 'joint',
      licenseConfirmed: false,
      rightsConfirmed: false,
      signatureName: '',
    };
  }

  function getCallLaneSchema(laneId) {
    const safeLane = normalizeLane(laneId);
    const lanes = Array.isArray(state?.callSchema?.lanes) ? state.callSchema.lanes : DEFAULT_CALL_SCHEMA.lanes;
    return lanes.find((entry) => normalizeLane(entry?.id) === safeLane) || null;
  }

  function getFlowText() {
    return state?.flow === FLOW_CALL ? 'call' : 'sample';
  }

  function makeState(config) {
    const routeFlow = parseRouteFlowState();
    const sampleDraft = baseFlowDraft(FLOW_SAMPLE);
    const callDraft = baseFlowDraft(FLOW_CALL);
    if (routeFlow.lane) callDraft.meta.callLane = routeFlow.lane;
    if (routeFlow.subcall) callDraft.meta.callSubcall = routeFlow.subcall;
    if (routeFlow.cycle) callDraft.meta.callCycle = routeFlow.cycle;
    const startingFlow = routeFlow.flow === FLOW_CALL ? FLOW_CALL : FLOW_SAMPLE;
    const activeDraft = startingFlow === FLOW_CALL ? callDraft : sampleDraft;
    return {
      step: 0,
      prevProgress: 1 / STEPS.length,
      weeklyLimit: config.weeklyLimit,
      weeklyUsed: 0,
      quotaLeft: 0,
      quotaResolved: false,
      webappUrl: config.webappUrl,
      apiBase: config.apiBase,
      auth0Sub: '',
      authUser: null,
      profileDefaults: null,
      profileDefaultsLoaded: false,
      profileDefaultsAutoApplied: false,
      flow: startingFlow,
      pipelineChosen: !!routeFlow.explicitFlow,
      routeFlowExplicit: !!routeFlow.explicitFlow,
      routeFlowRequested: {
        flow: routeFlow.flow,
        lane: routeFlow.lane,
        subcall: routeFlow.subcall,
        cycle: routeFlow.cycle,
      },
      flowDrafts: {
        [FLOW_SAMPLE]: sampleDraft,
        [FLOW_CALL]: callDraft,
      },
      callSchema: DEFAULT_CALL_SCHEMA,
      callsRegistryLoaded: false,
      hasActiveCall: false,
      activeCallCount: 0,
      activeCallLanes: [],
      activeCallCycleByLane: {},
      callLaneLocked: false,
      hasShownInactiveRouteToast: false,
      via: routeFlow.via,
      meta: cloneMeta(activeDraft.meta),
      licenseType: activeDraft.licenseType,
      licenseConfirmed: activeDraft.licenseConfirmed,
      rightsConfirmed: activeDraft.rightsConfirmed,
      signatureName: activeDraft.signatureName,
      lastSubmissionRow: '000',
      lastSubmissionLookup: '',
      lastSubmissionId: '',
      focusedField: '',
      submitting: false,
      submitTicket: 0,
      submitError: '',
    };
  }

  function getFlowDraft(flowKey = DEFAULT_FLOW) {
    if (!state || !state.flowDrafts || typeof state.flowDrafts !== 'object') {
      return baseFlowDraft(flowKey);
    }
    const safeFlow = normalizeFlow(flowKey);
    const draft = state.flowDrafts[safeFlow];
    if (!draft || typeof draft !== 'object') {
      const fallback = baseFlowDraft(safeFlow);
      state.flowDrafts[safeFlow] = fallback;
      return fallback;
    }
    return draft;
  }

  function persistActiveFlowDraft() {
    if (!state) return;
    const safeFlow = normalizeFlow(state.flow);
    const draft = getFlowDraft(safeFlow);
    draft.meta = cloneMeta(state.meta);
    draft.licenseType = text(state.licenseType, 'joint');
    draft.licenseConfirmed = !!state.licenseConfirmed;
    draft.rightsConfirmed = !!state.rightsConfirmed;
    draft.signatureName = text(state.signatureName, '');
  }

  function applyFlowDraft(flowKey) {
    if (!state) return;
    const safeFlow = normalizeFlow(flowKey);
    const draft = getFlowDraft(safeFlow);
    state.flow = safeFlow;
    state.meta = cloneMeta(draft.meta);
    state.licenseType = text(draft.licenseType, 'joint');
    state.licenseConfirmed = !!draft.licenseConfirmed;
    state.rightsConfirmed = !!draft.rightsConfirmed;
    state.signatureName = text(draft.signatureName, '');
    state.submitError = '';
    state.focusedField = '';
    if (state.step > 3) state.step = 0;
    if (safeFlow === FLOW_CALL) {
      state.meta.callLane = normalizeLane(state.meta.callLane);
      state.meta.callSubcall = normalizeSubcall(state.meta.callSubcall);
    }
  }

  function setActiveFlow(flowKey, options = {}) {
    if (!state) return;
    const safeFlow = normalizeFlow(flowKey);
    const opts = options && typeof options === 'object' ? options : {};
    if (state.flow === safeFlow && !opts.force) return;
    persistActiveFlowDraft();
    applyFlowDraft(safeFlow);
    if (opts.resetStep !== false) state.step = 0;
    state.lastSubmissionRow = '000';
    state.lastSubmissionLookup = '';
    state.quotaResolved = false;
    state.weeklyUsed = 0;
    state.quotaLeft = 0;
    setQuotaSource('none');
    if (opts.refreshQuota !== false) {
      hydrateAuthAndQuota({ forceLive: true }).catch(() => {});
    }
    render();
  }

  async function loadCallSchema() {
    try {
      const response = await fetch(CALL_SCHEMA_URL, { method: 'GET' });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.lanes)) return;
      state.callSchema = {
        ...DEFAULT_CALL_SCHEMA,
        ...payload,
        lanes: payload.lanes,
      };
      if (state.__callsRegistryPayload) {
        applyCallsRegistryContract(state.__callsRegistryPayload, { announce: false, updateUrl: false });
      }
      if (state.flow === FLOW_CALL && state.step === 1) render();
    } catch {}
  }

  function getAvailableCallLanes() {
    const lanes = Array.isArray(state?.callSchema?.lanes) ? state.callSchema.lanes : DEFAULT_CALL_SCHEMA.lanes;
    if (!state?.hasActiveCall) return [];
    const activeSet = new Set(Array.isArray(state.activeCallLanes) ? state.activeCallLanes.map((lane) => normalizeLane(lane)).filter(Boolean) : []);
    return lanes.filter((lane) => activeSet.has(normalizeLane(lane?.id)));
  }

  function applyCallsRegistryContract(payload, options = {}) {
    if (!state) return;
    const opts = options && typeof options === 'object' ? options : {};
    const activeCalls = normalizeActiveCallsFromRegistry(payload);
    const cycleByLane = {};
    const laneOrder = [];
    activeCalls.forEach((entry) => {
      const lane = normalizeLane(entry.lane);
      if (!lane) return;
      if (!laneOrder.includes(lane)) laneOrder.push(lane);
      cycleByLane[lane] = text(entry.cycle);
    });

    state.__callsRegistryPayload = payload;
    state.callsRegistryLoaded = true;
    state.activeCallCount = activeCalls.length;
    state.hasActiveCall = activeCalls.length > 0;
    state.activeCallLanes = laneOrder;
    state.activeCallCycleByLane = cycleByLane;
    state.callLaneLocked = laneOrder.length === 1;

    if (!state.hasActiveCall) {
      state.meta.callLane = '';
      state.meta.callSubcall = '';
      state.meta.callCycle = '';
      state.callLaneLocked = false;

      if (!state.routeFlowExplicit) {
        state.pipelineChosen = true;
        if (state.flow !== FLOW_SAMPLE) applyFlowDraft(FLOW_SAMPLE);
      } else if (state.flow === FLOW_CALL) {
        if (!state.hasShownInactiveRouteToast && opts.announce !== false) {
          showToast('No active IN DEX call right now. Starting sample pipeline.', true);
          state.hasShownInactiveRouteToast = true;
        }
        state.pipelineChosen = true;
        applyFlowDraft(FLOW_SAMPLE);
        if (opts.updateUrl !== false) {
          replaceRouteFlowQuery({
            flow: FLOW_SAMPLE,
            via: text(state.via),
          });
        }
      }
      return;
    }

    const activeSet = new Set(laneOrder);
    const fallbackLane = laneOrder[0] || '';
    if (state.flow === FLOW_CALL) {
      let nextLane = normalizeLane(state.meta.callLane);
      if (state.callLaneLocked && fallbackLane) {
        nextLane = fallbackLane;
      } else if (!nextLane || !activeSet.has(nextLane)) {
        nextLane = fallbackLane;
      }

      const laneChanged = normalizeLane(state.meta.callLane) !== nextLane;
      state.meta.callLane = nextLane;
      if (nextLane !== 'in-dex-a') state.meta.callSubcall = '';
      if (cycleByLane[nextLane]) {
        state.meta.callCycle = cycleByLane[nextLane];
      }

      if (laneChanged && state.routeFlowExplicit && opts.announce !== false && !state.hasShownInactiveRouteToast) {
        showToast('Requested call lane is not active. Switched to the current active lane.', true);
        state.hasShownInactiveRouteToast = true;
      }

      if (opts.updateUrl !== false && nextLane) {
        replaceRouteFlowQuery({
          flow: FLOW_CALL,
          lane: nextLane,
          subcall: nextLane === 'in-dex-a' ? normalizeSubcall(state.meta.callSubcall) : '',
          cycle: text(state.meta.callCycle),
          via: text(state.via, 'call'),
        });
      }
    }
  }

  async function loadCallsRegistry() {
    try {
      const response = await fetch(CALLS_REGISTRY_URL, { method: 'GET' });
      if (!response.ok) {
        state.callsRegistryLoaded = true;
        state.hasActiveCall = false;
        state.activeCallCount = 0;
        return;
      }
      const payload = await response.json();
      applyCallsRegistryContract(payload, { announce: true, updateUrl: true });
      if (state.flow === FLOW_CALL && state.step === 1) render();
    } catch {
      state.callsRegistryLoaded = true;
      state.hasActiveCall = false;
      state.activeCallCount = 0;
    }
  }

  function flowDisplayLabel(flowKey) {
    const safeFlow = normalizeFlow(flowKey);
    return safeFlow === FLOW_CALL ? 'Call submission' : 'Sample submission';
  }

  function activeQuotaAction() {
    return state?.flow === FLOW_CALL ? 'quota_call' : 'quota';
  }

  function activeSubmitAction() {
    return state?.flow === FLOW_CALL ? 'submit_call' : 'submit';
  }

  let state = null;
  let liveRoot = null;
  let activeSubmitTooltipTarget = null;
  let lastQuotaFetchError = '';

  function text(value, fallback = '') {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizePitchSystem(value) {
    const normalized = text(value).toLowerCase();
    if (normalized === '24-tet') return '24-tet';
    if (normalized === 'ji') return 'ji';
    if (normalized === 'atonal') return 'atonal';
    if (normalized === 'non-pitched') return 'non-pitched';
    return '12-tet';
  }

  function serializePitchSelection(pitchSystem, pitchDescriptor) {
    const system = normalizePitchSystem(pitchSystem);
    const descriptor = text(pitchDescriptor);

    if (system === 'atonal') return 'Atonal';
    if (system === 'non-pitched') return 'Non-pitched';
    if (system === '24-tet') return descriptor ? `24-TET: ${descriptor}` : '24-TET';
    if (system === 'ji') return descriptor ? `JI: ${descriptor}` : 'JI';
    if (!descriptor) return '';
    return `12-TET: ${descriptor}`;
  }

  function isPitchRootDropdownSystem(pitchSystem) {
    return pitchSystem === '12-tet' || pitchSystem === '24-tet';
  }

  function getPitchRootOptions(pitchSystem) {
    if (pitchSystem === '24-tet') return KEY_CENTER_24_TET_OPTIONS;
    if (pitchSystem === '12-tet') return KEY_CENTER_OPTIONS;
    return [];
  }

  function normalizePitchDescriptorForSystem(pitchSystem, descriptor) {
    if (!isPitchRootDropdownSystem(pitchSystem)) return descriptor;
    const options = getPitchRootOptions(pitchSystem);
    const normalized = text(descriptor);
    return options.includes(normalized) ? normalized : '';
  }

  function syncLegacyPitchFields(meta) {
    if (!meta || typeof meta !== 'object') return '';
    meta.pitchSystem = normalizePitchSystem(meta.pitchSystem);
    if (meta.pitchSystem === 'atonal' || meta.pitchSystem === 'non-pitched') {
      meta.pitchDescriptor = '';
    }
    meta.keyCenter = serializePitchSelection(meta.pitchSystem, meta.pitchDescriptor);
    return meta.keyCenter;
  }

  function summarizePitch(meta) {
    if (!meta || typeof meta !== 'object') return 'Unspecified';
    const serialized = text(syncLegacyPitchFields(meta));
    return serialized || 'Unspecified';
  }

  function toLookupWord(value, length, fallback) {
    const letters = String(value || '').replace(/[^A-Za-z]/g, '');
    if (!letters) return fallback;
    const normalized = letters.slice(0, Math.max(1, length)).padEnd(length, 'X').slice(0, length);
    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
  }

  function parseCollectionTypeCode(value) {
    const raw = text(value, '').toUpperCase();
    if (raw === 'AV') return 'AV';
    if (raw === 'A' || raw.includes('AUDIO')) return 'A';
    if (raw === 'V' || raw.includes('VIDEO')) return 'V';
    return 'O';
  }

  function parseInstrumentTypeCode(value) {
    const raw = text(value, '').toUpperCase();
    const first = raw.match(/[A-Z]/)?.[0] || '';
    return ['K', 'B', 'E', 'S', 'W', 'P', 'V', 'X'].includes(first) ? first : 'X';
  }

  function parseSurnameCandidate(value) {
    const raw = text(value, '');
    if (!raw) return '';
    if (raw.includes(',')) return text(raw.split(',')[0], '');
    const parts = raw.split(/\s+/).filter(Boolean);
    return text(parts[parts.length - 1], '');
  }

  function resolveAuthSurname() {
    const preferred = state && state.authUser && typeof state.authUser === 'object'
      ? state.authUser
      : null;
    const user = preferred
      || (window.AUTH0_USER && typeof window.AUTH0_USER === 'object'
        ? window.AUTH0_USER
        : null);
    if (!user) return '';
    const direct = text(user.family_name || user.surname || user.last_name, '');
    if (direct) return direct;
    return parseSurnameCandidate(user.name || user.nickname || user.email || '');
  }

  function parsePerformerToken() {
    const surname = resolveAuthSurname();
    const letters = String(surname || '').replace(/[^A-Za-z]/g, '');
    if (!letters) return 'Un';
    const token = letters.slice(0, 2).padEnd(2, 'X');
    return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`;
  }

  function extractAuthSubject(candidate) {
    if (!candidate || typeof candidate !== 'object') return '';
    const subject = text(candidate.sub || candidate.user_id || candidate.email, '');
    return subject;
  }

  async function resolveAuthUser(timeoutMs = AUTH_TIMEOUT_MS) {
    if (window.AUTH0_USER && typeof window.AUTH0_USER === 'object') {
      const existingSub = extractAuthSubject(window.AUTH0_USER);
      if (existingSub) {
        window.auth0Sub = existingSub;
        if (state) state.auth0Sub = existingSub;
      }
      if (state) state.authUser = window.AUTH0_USER;
      return window.AUTH0_USER;
    }

    const runtimeCandidates = [
      window.DEX_AUTH,
      window.dexAuth,
      window.auth0,
    ].filter((candidate) => candidate && typeof candidate.getUser === 'function');

    for (const runtime of runtimeCandidates) {
      try {
        const candidate = runtime.getUser();
        const user = candidate && typeof candidate.then === 'function'
          ? await withTimeout(candidate, timeoutMs, null)
          : candidate;
        if (user && typeof user === 'object') {
          window.AUTH0_USER = user;
          const resolvedSub = extractAuthSubject(user);
          if (resolvedSub) {
            window.auth0Sub = resolvedSub;
            if (state) state.auth0Sub = resolvedSub;
          }
          if (state) state.authUser = user;
          return user;
        }
      } catch {}
    }

    return null;
  }

  function normalizeProfileCategoryCode(value) {
    const normalized = text(value).toUpperCase();
    return ['V', 'K', 'B', 'E', 'S', 'W', 'P', 'X'].includes(normalized) ? normalized : '';
  }

  function resolveSubmitCategoryValue(categoryCode, instrumentHint = '') {
    const code = normalizeProfileCategoryCode(categoryCode);
    const fromCode = code
      ? CATEGORY_OPTIONS.find((value) => text(value).toUpperCase().startsWith(`${code} -`))
      : '';
    if (fromCode) return fromCode;
    const inferred = inferProfileCategoryFromInstrument(instrumentHint);
    if (!inferred) return '';
    return CATEGORY_OPTIONS.find((value) => text(value).toUpperCase().startsWith(`${inferred} -`)) || '';
  }

  function inferProfileCategoryFromInstrument(value) {
    const normalized = text(value).toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('voice') || normalized.includes('vocal') || normalized.includes('vox') || normalized.includes('choir')) return 'V';
    if (normalized.includes('piano') || normalized.includes('organ') || normalized.includes('key')) return 'K';
    if (normalized.includes('trumpet') || normalized.includes('trombone') || normalized.includes('tuba') || normalized.includes('horn')) return 'B';
    if (normalized.includes('violin') || normalized.includes('viola') || normalized.includes('cello') || normalized.includes('bass') || normalized.includes('guitar') || normalized.includes('harp')) return 'S';
    if (normalized.includes('flute') || normalized.includes('clarinet') || normalized.includes('oboe') || normalized.includes('bassoon') || normalized.includes('sax')) return 'W';
    if (normalized.includes('percussion') || normalized.includes('drum') || normalized.includes('marimba') || normalized.includes('vibraphone')) return 'P';
    if (normalized.includes('electronic') || normalized.includes('synth') || normalized.includes('modular') || normalized.includes('field recording')) return 'E';
    return 'X';
  }

  function normalizeSubmitProfileDefaults(profile) {
    const payload = profile && typeof profile === 'object' ? profile : {};
    const submitDefaults = payload.submit_defaults && typeof payload.submit_defaults === 'object'
      ? payload.submit_defaults
      : {};
    const creator = text(submitDefaults.creator || payload.credit_name || payload.name, '');
    const instrument = text(submitDefaults.instrument || payload.instrument_primary || (Array.isArray(payload.instruments) ? payload.instruments[0] : ''), '');
    const category = normalizeProfileCategoryCode(
      submitDefaults.category || inferProfileCategoryFromInstrument(instrument),
    );

    return { creator, category, instrument };
  }

  function hasSubmitProfileDefaults() {
    const defaults = state?.profileDefaults;
    if (!defaults || typeof defaults !== 'object') return false;
    return Boolean(text(defaults.creator) || text(defaults.category) || text(defaults.instrument));
  }

  function getApiAuthRuntimes() {
    return [window.DEX_AUTH, window.dexAuth, window.auth0].filter(Boolean);
  }

  async function getApiAccessToken() {
    const runtimes = getApiAuthRuntimes();
    for (const runtime of runtimes) {
      if (!runtime || typeof runtime.getAccessToken !== 'function') continue;
      try {
        const maybe = runtime.getAccessToken();
        const token = maybe && typeof maybe.then === 'function' ? await maybe : maybe;
        const normalized = text(token, '');
        if (normalized) return normalized;
      } catch {}
    }
    return '';
  }

  async function fetchSubmitProfileDefaults() {
    if (!state || !text(state.apiBase)) return null;
    const token = await getApiAccessToken();
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    let response = null;
    try {
      response = await fetch(`${state.apiBase}/me/profile`, {
        method: 'GET',
        headers,
      });
    } catch {
      return null;
    }
    if (!response || !response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return null;
    return normalizeSubmitProfileDefaults(payload);
  }

  function applySubmitProfileDefaults(options = {}) {
    if (!state || !state.profileDefaults) return false;
    const defaults = state.profileDefaults;
    const force = !!options.force;
    let applied = false;

    if ((force || !text(state.meta.creator)) && text(defaults.creator)) {
      state.meta.creator = defaults.creator;
      applied = true;
    }
    if (force || !text(state.meta.category)) {
      const categoryValue = resolveSubmitCategoryValue(defaults.category, defaults.instrument);
      if (text(categoryValue)) {
        state.meta.category = categoryValue;
        applied = true;
      }
    }
    if ((force || !text(state.meta.instrument)) && text(defaults.instrument)) {
      state.meta.instrument = defaults.instrument;
      applied = true;
    }

    if (applied && options.announce !== false) {
      showToast('Profile defaults applied.');
    }
    return applied;
  }

  async function hydrateSubmitProfileDefaults(options = {}) {
    if (!state) return null;
    const force = !!options.force;
    if (state.profileDefaultsLoaded && !force) return state.profileDefaults;
    const defaults = await fetchSubmitProfileDefaults();
    state.profileDefaultsLoaded = true;
    if (defaults) state.profileDefaults = defaults;
    if (!state.profileDefaults) return null;

    if (!state.profileDefaultsAutoApplied) {
      const applied = applySubmitProfileDefaults({ force: false, announce: false });
      if (applied) state.profileDefaultsAutoApplied = true;
    }
    return state.profileDefaults;
  }

  function formatCounter(value) {
    const parsed = Number.parseInt(String(value || '0'), 10);
    const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    return String(safe).padStart(2, '0');
  }

  function buildGeneratedSubmissionLookup(counterValue) {
    const counter = formatCounter(counterValue);
    const instrumentType = parseInstrumentTypeCode(state?.meta?.category);
    const instrumentPrefix = toLookupWord(state?.meta?.instrument, 3, 'Unk');
    const performerToken = parsePerformerToken();
    const collectionType = parseCollectionTypeCode(state?.meta?.collectionType);
    const year = new Date().getFullYear();
    return `SUB${counter}-${instrumentType}.${instrumentPrefix} ${performerToken} ${collectionType}${year}`;
  }

  function resolveLookupFromSubmitResponse(response, rowNumber) {
    const value = response && typeof response === 'object' ? response : {};
    const lookup = text(
      value.effectiveLookupNumber
        || value.effective_lookup_number
        || value.finalLookupNumber
        || value.final_lookup_number
        || value.submissionLookupNumber
        || value.submission_lookup_number
        || value.finalLookupBase
        || value.final_lookup_base
        || value.submissionLookupGenerated
        || value.submission_lookup_generated
        || value.lookup,
      '',
    );
    return lookup || buildGeneratedSubmissionLookup(rowNumber);
  }

  function create(tag, className = '', value = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value) el.textContent = value;
    return el;
  }

  function withCanonicalZwnj(value) {
    const input = String(value ?? '');
    if (!input) return '';
    let output = '';
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = index > 0 ? input[index - 1] : '';
      const isDoubleLetter =
        previous &&
        /[A-Za-z]/.test(previous) &&
        /[A-Za-z]/.test(current) &&
        previous.toLowerCase() === current.toLowerCase();
      if (isDoubleLetter) output += '\u200C';
      output += current;
    }
    return output;
  }

  function createSidebarText(tag, className = '', value = '') {
    return create(tag, className, withCanonicalZwnj(value));
  }

  function setFocusedField(fieldKey = '') {
    const next = text(fieldKey);
    if (!state || state.focusedField === next) return;
    state.focusedField = next;
    refreshCommandPanel();
  }

  function bindFieldFocus(control, fieldKey) {
    if (!(control instanceof HTMLElement)) return;
    control.setAttribute('data-dx-focus-key', fieldKey);
    control.addEventListener('focus', () => {
      setFocusedField(fieldKey);
    });
    control.addEventListener('blur', () => {
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) {
          setFocusedField('');
          return;
        }
        if (!liveRoot?.contains(active)) {
          setFocusedField('');
          return;
        }
        if (!active.closest('[data-dx-focus-key]')) {
          setFocusedField('');
        }
      });
    });
  }

  function isReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  function toConfig(root) {
    const runtime =
      typeof window.__DX_SUBMIT_SAMPLES_CONFIG === 'object' && window.__DX_SUBMIT_SAMPLES_CONFIG
        ? window.__DX_SUBMIT_SAMPLES_CONFIG
        : {};

    const webappUrl = text(runtime.webappUrl || root?.dataset?.webappUrl || DEFAULT_WEBAPP_URL, DEFAULT_WEBAPP_URL);
    const weeklyLimitRaw = runtime.weeklyLimit ?? runtime.dailyLimit ?? root?.dataset?.weeklyLimit ?? root?.dataset?.dailyLimit ?? DEFAULT_WEEKLY_LIMIT;
    const weeklyLimit = Math.max(1, Math.min(99, Math.floor(number(weeklyLimitRaw, DEFAULT_WEEKLY_LIMIT))));
    const apiBase = text(runtime.apiBase || root?.dataset?.api || window.DEX_API_BASE_URL || window.DEX_API_ORIGIN || DEFAULT_API, DEFAULT_API).replace(/\/+$/, '');
    return { webappUrl, weeklyLimit, apiBase };
  }

  function setFetchState(root, fetchState) {
    root.setAttribute('data-dx-fetch-state', fetchState);
    if (fetchState === FETCH_STATE_LOADING) {
      root.setAttribute('aria-busy', 'true');
    } else {
      root.removeAttribute('aria-busy');
    }
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
  }

  function canUsePointerHoverTooltip() {
    try {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
      return true;
    }
  }

  function ensureSubmitTooltipLayer() {
    let layer = document.getElementById('dx-submit-tooltip-layer');
    if (layer instanceof HTMLElement) return layer;
    layer = document.createElement('div');
    layer.id = 'dx-submit-tooltip-layer';
    layer.setAttribute('role', 'tooltip');
    layer.setAttribute('aria-hidden', 'true');
    layer.hidden = true;
    document.body.appendChild(layer);
    return layer;
  }

  function hideSubmitTooltip() {
    activeSubmitTooltipTarget = null;
    const layer = document.getElementById('dx-submit-tooltip-layer');
    if (!(layer instanceof HTMLElement)) return;
    layer.hidden = true;
    layer.textContent = '';
    layer.setAttribute('aria-hidden', 'true');
  }

  function positionSubmitTooltip(layer, target) {
    if (!(layer instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const viewportPadding = 8;
    layer.style.left = '0px';
    layer.style.top = '0px';
    layer.style.maxWidth = `${Math.max(160, Math.min(280, window.innerWidth - viewportPadding * 2))}px`;

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = layer.getBoundingClientRect();

    let left = targetRect.right - tooltipRect.width;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding));

    let top = targetRect.bottom + 8;
    if (top + tooltipRect.height > window.innerHeight - viewportPadding) {
      top = targetRect.top - tooltipRect.height - 8;
    }
    top = Math.max(viewportPadding, top);

    layer.style.left = `${Math.round(left)}px`;
    layer.style.top = `${Math.round(top)}px`;
  }

  function showSubmitTooltip(target) {
    if (!(target instanceof HTMLElement)) return;
    const tooltip = text(target.getAttribute('data-dx-tooltip'));
    if (!tooltip) {
      hideSubmitTooltip();
      return;
    }
    const layer = ensureSubmitTooltipLayer();
    layer.textContent = tooltip;
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    positionSubmitTooltip(layer, target);
    activeSubmitTooltipTarget = target;
  }

  function resolveTooltipTarget(input) {
    if (!(input instanceof Element)) return null;
    const target = input.closest('[data-dx-tooltip]');
    if (!(target instanceof HTMLElement)) return null;
    if (!(liveRoot instanceof HTMLElement) || !liveRoot.contains(target)) return null;
    return target;
  }

  function bindSubmitTooltips(scope) {
    if (!(scope instanceof HTMLElement)) return;

    if (scope.__dxSubmitTooltipAbortController instanceof AbortController) {
      try {
        scope.__dxSubmitTooltipAbortController.abort();
      } catch {}
    }

    const controller = new AbortController();
    scope.__dxSubmitTooltipAbortController = controller;
    const options = { signal: controller.signal };
    const hoverEnabled = canUsePointerHoverTooltip();

    scope.querySelectorAll('[data-dx-tooltip]').forEach((node) => {
      if (node instanceof HTMLElement) {
        node.removeAttribute('title');
      }
    });

    if (hoverEnabled) {
      scope.addEventListener('pointerover', (event) => {
        const target = resolveTooltipTarget(event.target);
        if (!target) return;
        if (activeSubmitTooltipTarget === target) return;
        showSubmitTooltip(target);
      }, options);

      scope.addEventListener('pointerout', (event) => {
        if (!(activeSubmitTooltipTarget instanceof HTMLElement)) return;
        const next = resolveTooltipTarget(event.relatedTarget);
        if (next === activeSubmitTooltipTarget) return;
        if (next) {
          showSubmitTooltip(next);
          return;
        }
        hideSubmitTooltip();
      }, options);
    }

    scope.addEventListener('focusin', (event) => {
      const target = resolveTooltipTarget(event.target);
      if (!target) return;
      showSubmitTooltip(target);
    }, options);

    scope.addEventListener('focusout', (event) => {
      const next = resolveTooltipTarget(event.relatedTarget);
      if (next) {
        showSubmitTooltip(next);
        return;
      }
      hideSubmitTooltip();
    }, options);

    window.addEventListener('scroll', () => {
      if (activeSubmitTooltipTarget instanceof HTMLElement) {
        const layer = document.getElementById('dx-submit-tooltip-layer');
        if (layer instanceof HTMLElement && !layer.hidden) {
          positionSubmitTooltip(layer, activeSubmitTooltipTarget);
        }
      }
    }, { signal: controller.signal, passive: true });

    window.addEventListener('resize', () => {
      if (activeSubmitTooltipTarget instanceof HTMLElement) {
        const layer = document.getElementById('dx-submit-tooltip-layer');
        if (layer instanceof HTMLElement && !layer.hidden) {
          positionSubmitTooltip(layer, activeSubmitTooltipTarget);
        }
      }
    }, options);
  }

  async function finalizeFetchState(root, startTs, fetchState = FETCH_STATE_READY) {
    const elapsed = performance.now() - startTs;
    if (elapsed < DX_MIN_SHEEN_MS) {
      await delay(DX_MIN_SHEEN_MS - elapsed);
    }
    setFetchState(root, fetchState);
  }

  function parsePositiveInt(value, fallback = null) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  }

  function getPrefetchRuntime() {
    const runtime = window.__DX_PREFETCH;
    if (!runtime || typeof runtime.getFresh !== 'function' || typeof runtime.set !== 'function') return null;
    return runtime;
  }

  function getQuotaPrefetchKey(auth0Sub, flow = DEFAULT_FLOW) {
    const safeSub = text(auth0Sub, '');
    if (!safeSub) return '';
    const safeFlow = normalizeFlow(flow);
    return `quota:${safeFlow}:${safeSub}`;
  }

  function setQuotaSource(source) {
    if (!(liveRoot instanceof HTMLElement)) return;
    liveRoot.setAttribute('data-dx-quota-source', text(source, 'none'));
  }

  function parseQuotaPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const weeklyLimitRaw = parsePositiveInt(payload.weeklyLimit, null);
    const weeklyUsedRaw = parsePositiveInt(payload.weeklyUsed, null);
    const weeklyRemainingRaw = parsePositiveInt(payload.weeklyRemaining, null);
    if (weeklyLimitRaw === null && weeklyUsedRaw === null && weeklyRemainingRaw === null) return null;
    const weeklyLimit = Math.max(1, Math.min(99, weeklyLimitRaw ?? state?.weeklyLimit ?? DEFAULT_WEEKLY_LIMIT));
    const weeklyUsed = Math.max(0, weeklyUsedRaw ?? (weeklyRemainingRaw === null ? 0 : weeklyLimit - weeklyRemainingRaw));
    const weeklyRemaining = Math.max(0, Math.min(weeklyLimit, weeklyRemainingRaw ?? (weeklyLimit - weeklyUsed)));
    return {
      weeklyLimit,
      weeklyUsed,
      weeklyRemaining,
      weekStart: text(payload.weekStart, ''),
      weekEnd: text(payload.weekEnd, ''),
      updatedAt: text(payload.updatedAt, new Date().toISOString()),
    };
  }

  function applyQuotaPayload(quotaPayload) {
    if (!state || !quotaPayload) return false;
    const parsed = parseQuotaPayload(quotaPayload);
    if (!parsed) return false;
    state.weeklyLimit = parsed.weeklyLimit;
    state.weeklyUsed = parsed.weeklyUsed;
    state.quotaLeft = parsed.weeklyRemaining;
    state.quotaResolved = true;
    return true;
  }

  function readCachedQuota(auth0Sub, flow = DEFAULT_FLOW) {
    const prefetch = getPrefetchRuntime();
    const key = getQuotaPrefetchKey(auth0Sub, flow);
    if (!prefetch || !key) return null;
    const cached = prefetch.getFresh(key, PREFETCH_SWR_MS);
    if (!cached || !cached.payload) return null;
    return parseQuotaPayload(cached.payload);
  }

  function writeCachedQuota(auth0Sub, quotaPayload, flow = DEFAULT_FLOW) {
    const prefetch = getPrefetchRuntime();
    const key = getQuotaPrefetchKey(auth0Sub, flow);
    if (!prefetch || !key) return;
    const parsed = parseQuotaPayload(quotaPayload);
    if (!parsed) return;
    prefetch.set(key, parsed, { scope: auth0Sub });
  }

  function quotaSummaryText() {
    if (!state?.quotaResolved) {
      return state?.flow === FLOW_CALL
        ? 'Weekly call submissions available: checking your account quota…'
        : 'Weekly uploads available: checking your account quota…';
    }
    return state?.flow === FLOW_CALL
      ? `Weekly call submissions available: ${state.quotaLeft} / ${state.weeklyLimit}`
      : `Weekly uploads available: ${state.quotaLeft} / ${state.weeklyLimit}`;
  }

  function getQuotaLockReason() {
    if (!state) return '';
    if (!text(state.auth0Sub)) {
      return state.flow === FLOW_CALL
        ? 'Sign in required to verify weekly call submission quota.'
        : 'Sign in required to verify weekly upload quota.';
    }
    if (state.quotaResolved && state.quotaLeft <= 0) {
      return state.flow === FLOW_CALL
        ? `Weekly call submission limit reached (${state.weeklyLimit}/${state.weeklyLimit}).`
        : `Weekly upload limit reached (${state.weeklyLimit}/${state.weeklyLimit}).`;
    }
    return '';
  }

  function isQuotaLocked() {
    return Boolean(getQuotaLockReason());
  }

  function guardQuotaForProgression(showReason = true) {
    const reason = getQuotaLockReason();
    if (!reason) return true;
    if (showReason) showToast(reason, true);
    return false;
  }

  function releaseJsonpCallback(callbackName) {
    if (!callbackName) return;
    try {
      window[callbackName] = () => {};
    } catch {}
    window.setTimeout(() => {
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }, 180000);
  }

  async function jsonpRequest(url, params = {}, timeoutMs = JSONP_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const callbackName = `dxSubmitJsonp_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const script = document.createElement('script');
      let settled = false;
      let timer = 0;

      const cleanup = () => {
        if (timer) window.clearTimeout(timer);
        releaseJsonpCallback(callbackName);
        if (script.isConnected) script.remove();
      };

      const settle = (handler, payload) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(payload);
      };

      window[callbackName] = (payload) => {
        settle(resolve, payload);
      };

      const query = new URLSearchParams({ ...params, callback: callbackName });
      const separator = String(url).includes('?') ? '&' : '?';
      script.async = true;
      script.src = `${url}${separator}${query.toString()}`;
      script.addEventListener('error', () => settle(reject, new Error('JSONP request failed')));
      document.body.appendChild(script);

      timer = window.setTimeout(() => {
        settle(reject, new Error('JSONP request timeout'));
      }, Math.max(250, timeoutMs));
    });
  }

  async function refreshWeeklyQuotaFromSheet(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const forceLive = !!opts.forceLive;
    const useCache = opts.useCache !== false;
    const allowRetry = opts.allowRetry !== false;
    const timeoutMs = Math.max(500, Number(opts.timeoutMs || JSONP_TIMEOUT_MS));
    lastQuotaFetchError = '';
    if (!state || !text(state.webappUrl) || !text(state.auth0Sub)) {
      lastQuotaFetchError = 'missing auth identity or submit endpoint';
      setQuotaSource('none');
      return false;
    }
    const flow = normalizeFlow(state.flow);

    if (useCache && !forceLive) {
      const cached = readCachedQuota(state.auth0Sub, flow);
      if (cached && applyQuotaPayload(cached)) {
        setQuotaSource('cache');
        refreshQuotaCopy();
      }
    }

    const fetchLiveQuota = async () => {
      const response = await jsonpRequest(
        state.webappUrl,
        { action: activeQuotaAction(), auth0Sub: state.auth0Sub },
        timeoutMs,
      );
      const ok = applyQuotaPayload(response);
      if (!ok) {
        lastQuotaFetchError = 'quota response missing expected fields';
        return false;
      }
      writeCachedQuota(state.auth0Sub, response, flow);
      setQuotaSource('live');
      return true;
    };

    try {
      const liveOk = await fetchLiveQuota();
      if (liveOk) return true;
      if (!allowRetry) return false;
      await delay(QUOTA_RETRY_DELAY_MS + Math.floor(Math.random() * 140));
      return await fetchLiveQuota();
    } catch (error) {
      lastQuotaFetchError = text(error?.message, 'quota request failed');
      if (allowRetry) {
        try {
          await delay(QUOTA_RETRY_DELAY_MS + Math.floor(Math.random() * 140));
          return await fetchLiveQuota();
        } catch (retryError) {
          lastQuotaFetchError = text(retryError?.message, lastQuotaFetchError || 'quota retry failed');
        }
      }
      return Boolean(state.quotaResolved && !forceLive);
    }
  }

  function describeQuotaFailure() {
    const detail = text(lastQuotaFetchError, '');
    if (!detail) {
      return state?.flow === FLOW_CALL
        ? 'Could not verify weekly call-submission quota right now. Please retry in a moment.'
        : 'Could not verify weekly quota right now. Please retry in a moment.';
    }
    if (detail.toLowerCase().includes('timeout')) {
      return state?.flow === FLOW_CALL
        ? `Could not verify weekly call-submission quota right now. Timeout after ${SUBMIT_QUOTA_VERIFY_TIMEOUT_MS / 1000}s.`
        : `Could not verify weekly quota right now. Timeout after ${SUBMIT_QUOTA_VERIFY_TIMEOUT_MS / 1000}s.`;
    }
    return state?.flow === FLOW_CALL
      ? `Could not verify weekly call-submission quota right now. Detail: ${detail}.`
      : `Could not verify weekly quota right now. Detail: ${detail}.`;
  }

  function describeSubmitFailure(responsePayload, failureCode = '') {
    if (responsePayload && typeof responsePayload === 'object') {
      const payloadStatus = text(responsePayload.status, '');
      const payloadCode = text(responsePayload.code, '');
      const payloadMessage = text(responsePayload.message, '');
      const weeklyLimit = parsePositiveInt(responsePayload.weeklyLimit, null);
      const weeklyUsed = parsePositiveInt(responsePayload.weeklyUsed, null);
      if (payloadStatus === 'error' && payloadCode === 'weekly_limit_reached') {
        if (weeklyLimit !== null && weeklyUsed !== null) {
          return state?.flow === FLOW_CALL
            ? `Weekly call submission limit reached (${Math.min(weeklyUsed, weeklyLimit)}/${weeklyLimit}).`
            : `Weekly upload limit reached (${Math.min(weeklyUsed, weeklyLimit)}/${weeklyLimit}).`;
        }
        return state?.flow === FLOW_CALL ? 'Weekly call submission limit reached.' : 'Weekly upload limit reached.';
      }
      if (payloadMessage) return `Submission failed: ${payloadMessage}`;
      if (payloadCode) return `Submission failed: ${payloadCode}`;
    }

    if (failureCode === 'submit_timeout') {
      return `Submission request timed out (${SUBMIT_TIMEOUT_MS / 1000}s). No row was written.`;
    }
    if (failureCode === 'script_error') {
      return 'Submission request failed to load the GAS endpoint script.';
    }
    return 'Submission failed before completion. No row was written.';
  }

  function showToast(message, isError = false) {
    if (!(liveRoot instanceof HTMLElement)) return;
    const stack = liveRoot.querySelector('[data-dx-submit-toasts]');
    if (!(stack instanceof HTMLElement)) return;

    const item = create('p', 'dx-submit-toast', message);
    if (isError) item.classList.add('dx-submit-toast--error');
    stack.appendChild(item);

    if (!isReducedMotion()) {
      animate(
        item,
        { opacity: [0, 1], y: [10, 0] },
        { duration: 0.22, ease: 'easeOut' },
      );
    }

    window.setTimeout(() => {
      if (!item.isConnected) return;
      if (isReducedMotion()) {
        item.remove();
        return;
      }
      animate(item, { opacity: [1, 0], y: [0, -8] }, { duration: 0.18, ease: 'easeIn' }).finished.finally(() => {
        item.remove();
      });
    }, 2600);
  }

  async function resolveAccessTokenMaybe(timeoutMs = TOKEN_TIMEOUT_MS) {
    const auth = window.DEX_AUTH || window.dexAuth || null;
    if (!auth || typeof auth.getAccessToken !== 'function') return '';
    try {
      if (typeof auth.resolve === 'function') {
        await withTimeout(() => auth.resolve(Math.min(timeoutMs, 2400)), Math.min(timeoutMs, 2400), null);
      } else if (auth.ready && typeof auth.ready.then === 'function') {
        await withTimeout(auth.ready, Math.min(timeoutMs, 2400), null);
      }
    } catch {}
    const token = await withTimeout(() => auth.getAccessToken(), timeoutMs, '');
    return text(token, '');
  }

  async function refreshAchievementsAfterSubmit() {
    if (!state || !text(state.auth0Sub) || !text(state.apiBase)) return;
    const token = await resolveAccessTokenMaybe(Math.min(ACHIEVEMENTS_REFRESH_TIMEOUT_MS, 2400));
    if (!token) return;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = window.setTimeout(() => {
      if (controller) controller.abort();
    }, ACHIEVEMENTS_REFRESH_TIMEOUT_MS);

    try {
      const response = await fetch(`${state.apiBase}/me/achievements/summary`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${token}`,
          'x-dx-request-id': `submit_achv_${Date.now()}`,
        },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload || payload.ok !== true) return;
      const newly = Array.isArray(payload.newlyUnlocked) ? payload.newlyUnlocked : [];
      if (!newly.length) return;
      const firstId = text((newly[0] && newly[0].id) || newly[0], '');
      showToast(newly.length > 1 ? `New achievements unlocked (${newly.length})` : 'New achievement unlocked');
      try {
        if (firstId) {
          window.sessionStorage.setItem('dex:achievements:focus-badge', firstId);
        }
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('dx:achievements:updated', { detail: payload }));
        for (const item of newly) {
          const badgeId = text((item && item.id) || item, '');
          if (!badgeId) continue;
          window.dispatchEvent(new CustomEvent('dx:achievements:unlocked', { detail: { badgeId } }));
        }
      } catch {}
    } catch {
      // Ignore unlock-check errors; submission already succeeded.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function laneLabel(laneId) {
    const lane = getCallLaneSchema(laneId);
    if (lane && text(lane.label)) return text(lane.label);
    return text(laneId, 'call lane').toUpperCase();
  }

  function validateSampleMeta() {
    const required = ['title', 'creator', 'instrument', 'category', 'collectionType'];
    for (const key of required) {
      const value = state.meta[key];
      if (Array.isArray(value) ? value.length === 0 : !text(value)) {
        showToast(`Missing ${key}`, true);
        return false;
      }
    }
    return true;
  }

  function validateCallMeta() {
    if (!state.hasActiveCall) {
      showToast('No active call lane is currently open.', true);
      return false;
    }
    const lane = normalizeLane(state.meta.callLane);
    if (!lane) {
      showToast('Choose a call lane.', true);
      return false;
    }
    if (!Array.isArray(state.activeCallLanes) || !state.activeCallLanes.includes(lane)) {
      showToast('Selected call lane is not currently active.', true);
      return false;
    }
    if (!text(state.meta.title)) {
      showToast('Missing title', true);
      return false;
    }
    if (!text(state.meta.creator)) {
      showToast('Missing creator', true);
      return false;
    }

    const laneSchema = getCallLaneSchema(lane);
    const fields = Array.isArray(laneSchema?.fields) ? laneSchema.fields : [];
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      if (!field.required) continue;
      const fieldKey = text(field.key, '');
      if (!fieldKey) continue;
      const value = state.meta[fieldKey];
      if (!text(value)) {
        showToast(`Missing ${text(field.label, fieldKey)}`, true);
        return false;
      }
      if (text(field.type, '').toLowerCase() === 'number') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          showToast(`Invalid ${text(field.label, fieldKey)}`, true);
          return false;
        }
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
        const max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
        if (min !== null && parsed < min) {
          showToast(`${text(field.label, fieldKey)} must be at least ${min}.`, true);
          return false;
        }
        if (max !== null && parsed > max) {
          showToast(`${text(field.label, fieldKey)} must be at most ${max}.`, true);
          return false;
        }
      }
    }
    if (lane === 'in-dex-a' && !normalizeSubcall(state.meta.callSubcall)) {
      showToast('Choose an IN DEX A subcall.', true);
      return false;
    }
    return true;
  }

  function validateMeta() {
    return state.flow === FLOW_CALL ? validateCallMeta() : validateSampleMeta();
  }

  function toBadge(label, selected, onClick, disabled = false, options = null) {
    const button = create('button', 'dx-submit-badge', label);
    button.type = 'button';
    if (selected) button.classList.add('is-selected');
    if (disabled) {
      button.classList.add('is-disabled');
      button.disabled = true;
    }
    const badgeOptions = options && typeof options === 'object' ? options : {};
    const tooltip = text(badgeOptions.tooltip);
    if (tooltip) {
      button.setAttribute('data-dx-tooltip', tooltip);
      button.setAttribute('aria-label', `${label}. ${tooltip}`);
      button.removeAttribute('title');
    }
    if (text(badgeOptions.focusKey)) {
      bindFieldFocus(button, text(badgeOptions.focusKey));
    }
    if (typeof onClick === 'function' && !disabled) {
      button.addEventListener('click', onClick);
    }
    return button;
  }

  function wrapField(labelText, required = false) {
    const field = create('label', 'dx-submit-field');
    const label = create('span', 'dx-submit-field-label', `${labelText}${required ? ' *' : ''}`);
    field.appendChild(label);
    return field;
  }

  function buildProgressHeader() {
    const wrap = create('div', 'dx-submit-progress-wrap');
    wrap.setAttribute('data-dx-submit-progress', String(state.step));

    const row = create('div', 'dx-submit-progress-row');
    STEPS.forEach((step, index) => {
      const chip = create('button', 'dx-submit-step-chip', `${index + 1}. ${step.short}`);
      chip.type = 'button';
      chip.disabled = index > state.step;
      chip.setAttribute('data-step-key', step.key);
      if (index < state.step) chip.classList.add('is-done');
      if (index === state.step) chip.classList.add('is-active');
      chip.addEventListener('click', () => {
        if (index > state.step) return;
        state.step = index;
        render();
      });
      row.appendChild(chip);
    });

    const bar = create('div', 'dx-submit-progress-bar');
    const fill = create('span', 'dx-submit-progress-fill');
    fill.style.transform = `scaleX(${(state.step + 1) / STEPS.length})`;
    bar.appendChild(fill);

    wrap.append(row, bar);
    return wrap;
  }

  function choosePipeline(flowKey) {
    if (!state) return;
    if (normalizeFlow(flowKey) === FLOW_CALL && !state.hasActiveCall) {
      showToast('No active IN DEX call right now. Use Sample Submission.', true);
      state.pipelineChosen = true;
      setActiveFlow(FLOW_SAMPLE, {
        force: true,
        resetStep: true,
        refreshQuota: true,
      });
      return;
    }
    state.pipelineChosen = true;
    setActiveFlow(flowKey, {
      force: true,
      resetStep: true,
      refreshQuota: true,
    });
  }

  function buildFlowGateStep() {
    const section = create('section', 'dx-submit-stage-card dx-submit-gate-card');
    section.setAttribute('data-dx-submit-step', 'flow-gate');
    section.appendChild(create('p', 'dx-submit-kicker', 'Screen 0'));
    section.appendChild(create('h2', 'dx-submit-title', 'What are you submitting?'));
    section.appendChild(
      create(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        'Choose one pipeline to continue.',
      ),
    );

    const actions = create('div', 'dx-submit-stage-actions dx-submit-gate-actions');
    const sample = create(
      'button',
      'cta-btn dx-button-element dx-button-size--md dx-button-element--secondary',
      'Sample Submission',
    );
    sample.type = 'button';
    sample.addEventListener('click', () => {
      choosePipeline(FLOW_SAMPLE);
    });

    const call = create(
      'button',
      'cta-btn dx-button-element dx-button-size--md dx-button-element--primary',
      'IN DEX Call Submission',
    );
    call.type = 'button';
    if (!state.hasActiveCall) {
      call.disabled = true;
      call.classList.add('is-disabled');
    }
    call.addEventListener('click', () => {
      choosePipeline(FLOW_CALL);
    });

    actions.append(sample, call);
    section.appendChild(actions);
    if (!state.hasActiveCall) {
      section.appendChild(create(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        'No active IN DEX call is open right now. Sample Submission remains available.',
      ));
    }
    return section;
  }

  function buildIntroStep() {
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'intro');

    const isCallFlow = state.flow === FLOW_CALL;
    section.appendChild(create('p', 'dx-submit-kicker', 'Submission Program'));
    section.appendChild(
      create(
        'h2',
        'dx-submit-title',
        isCallFlow
          ? 'Join an IN DEX call. We track routing and decisions end-to-end.'
          : 'Share source media. We track the journey end-to-end.',
      ),
    );

    const lead = create(
      'p',
      'dx-submit-copy',
      isCallFlow
        ? 'Select your call lane, attach proposal context, and submit one link. Dex reviews within 7 days and posts timeline notes in Messages.'
        : 'Upload a public master-link and metadata. Dex reviews within 7 days, then routes to revision, acceptance, or release.',
    );
    section.appendChild(lead);

    if (isCallFlow) {
      const routePills = create('div', 'dx-submit-pill-group');
      const laneId = normalizeLane(state.meta.callLane);
      if (laneId) routePills.appendChild(create('span', 'dx-submit-pill dx-submit-pill--accent', laneLabel(laneId)));
      if (laneId === 'in-dex-a' && normalizeSubcall(state.meta.callSubcall)) {
        routePills.appendChild(create('span', 'dx-submit-pill', `Subcall ${String(state.meta.callSubcall).toUpperCase()}`));
      }
      if (text(state.meta.callCycle)) {
        routePills.appendChild(create('span', 'dx-submit-pill', text(state.meta.callCycle)));
      }
      if (routePills.childElementCount > 0) section.appendChild(routePills);
    }

    const list = create('ul', 'dx-submit-list');
    const introPoints = isCallFlow
      ? [
        'Sent: your call lane proposal + source link received.',
        'Received/Reviewing: staff validates fit for current call cycle.',
        'Accepted/Rejected: decision + note appears in your timeline.',
        'In library: release or follow-up links post when published.',
      ]
      : [
        'Sent: your source link + metadata received.',
        'Received/Reviewing: staff validates format and attribution.',
        'Accepted/Rejected: decision + note appears in your timeline.',
        'In library: final release links appear when published.',
      ];
    introPoints.forEach((item) => list.appendChild(create('li', 'dx-submit-list-item', item)));
    section.appendChild(list);

    const specs = create('div', 'dx-submit-pill-group');
    (isCallFlow
      ? ['Lane-specific review', 'Status updates in Messages', 'Original work only', 'One link per submission']
      : ['4K/24fps preferred', '48kHz / 24-bit WAV preferred', 'Original work only', 'Lower-res accepted']
    ).forEach((pill) => {
      specs.appendChild(create('span', 'dx-submit-pill', pill));
    });
    section.appendChild(specs);

    if (state.quotaResolved && state.quotaLeft <= 0) {
      section.appendChild(buildQuotaActionCard());
    }

    const footer = create('div', 'dx-submit-stage-actions');
    const switchFlow = create(
      'button',
      'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary',
      'Change pipeline',
    );
    switchFlow.type = 'button';
    switchFlow.addEventListener('click', () => {
      state.pipelineChosen = false;
      state.step = 0;
      render();
    });

    const quota = create(
      'p',
      'dx-submit-copy dx-submit-copy--compact',
      quotaSummaryText(),
    );
    quota.setAttribute('data-dx-submit-quota', 'true');
    const begin = create(
      'button',
      'cta-btn dx-button-element dx-button-size--md dx-button-element--primary',
      isCallFlow ? 'Begin call submission' : 'Begin',
    );
    begin.type = 'button';
    begin.setAttribute('data-dx-submit-begin', 'true');
    const quotaLocked = isQuotaLocked();
    begin.disabled = quotaLocked;
    begin.classList.toggle('is-disabled', quotaLocked);
    begin.setAttribute('aria-disabled', quotaLocked ? 'true' : 'false');
    begin.addEventListener('click', () => {
      if (!guardQuotaForProgression(true)) {
        refreshQuotaCopy();
        return;
      }
      state.step = 1;
      render();
    });
    footer.append(switchFlow, quota, begin);
    section.appendChild(footer);

    return section;
  }

  function buildQuotaActionCard() {
    const actionCard = create('article', 'dx-submit-action-card');
    actionCard.appendChild(create('p', 'dx-submit-action-kicker', 'Action required'));
    actionCard.appendChild(
      create(
        'p',
        'dx-submit-action-copy',
        state?.flow === FLOW_CALL
          ? 'Weekly call submission limit reached for this account.'
          : 'Weekly upload limit reached for this account.',
      ),
    );
    return actionCard;
  }

  function updateCallMetaValue(fieldKey, nextValue) {
    if (!state || !state.meta) return;
    state.meta[fieldKey] = nextValue;
    if (fieldKey === 'callLane') {
      const safeLane = normalizeLane(nextValue);
      state.meta.callLane = safeLane;
      const laneSchema = getCallLaneSchema(safeLane);
      const hasSubcall = Array.isArray(laneSchema?.fields)
        && laneSchema.fields.some((entry) => text(entry?.key) === 'callSubcall');
      if (!hasSubcall) state.meta.callSubcall = '';
      if (!safeLane) {
        state.meta.proposalFormat = '';
        state.meta.runtimeMinutes = '';
        state.meta.availabilityWindow = '';
        state.meta.portfolioUrl = '';
      }
      render();
    }
  }

  function buildCallDynamicField(fieldSchema) {
    const schema = fieldSchema && typeof fieldSchema === 'object' ? fieldSchema : {};
    const fieldKey = text(schema.key, '');
    if (!fieldKey) return null;
    const label = text(schema.label, fieldKey);
    const required = !!schema.required;
    const field = wrapField(label, required);
    const type = text(schema.type, 'text').toLowerCase();
    const currentValue = text(state.meta[fieldKey], '');

    if (type === 'select') {
      const select = create('select', 'dx-submit-input');
      const prompt = create('option', '', `Choose ${label.toLowerCase()}`);
      prompt.value = '';
      select.appendChild(prompt);
      const options = Array.isArray(schema.options) ? schema.options : [];
      options.forEach((entry) => {
        const value = text(entry?.value, '');
        if (!value) return;
        const option = create('option', '', text(entry?.label, value));
        option.value = value;
        select.appendChild(option);
      });
      select.value = currentValue;
      select.addEventListener('change', (event) => {
        updateCallMetaValue(fieldKey, event.target.value);
      });
      bindFieldFocus(select, fieldKey);
      field.appendChild(select);
      return field;
    }

    const input = create(type === 'number' ? 'input' : 'input', 'dx-submit-input');
    if (input instanceof HTMLInputElement) {
      input.type = type === 'url' ? 'url' : type === 'number' ? 'number' : 'text';
      if (Number.isFinite(Number(schema.maxLength))) input.maxLength = Math.max(1, Number(schema.maxLength));
      if (type === 'number') {
        if (Number.isFinite(Number(schema.min))) input.min = String(Math.floor(Number(schema.min)));
        if (Number.isFinite(Number(schema.max))) input.max = String(Math.floor(Number(schema.max)));
        input.step = '1';
      }
      input.value = currentValue;
      input.addEventListener('input', (event) => {
        updateCallMetaValue(fieldKey, event.target.value);
      });
      bindFieldFocus(input, fieldKey);
    }
    field.appendChild(input);
    return field;
  }

  function buildCallMetadataStep() {
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'metadata');

    section.appendChild(create('p', 'dx-submit-kicker', 'Step 2'));
    section.appendChild(create('h2', 'dx-submit-title', 'Call lane metadata for routing and review'));

    const grid = create('div', 'dx-submit-grid');

    const laneField = wrapField('Call lane', true);
    const laneGroup = create('div', 'dx-submit-badge-group');
    const lanes = getAvailableCallLanes();
    lanes.forEach((lane) => {
      const laneId = normalizeLane(lane?.id);
      if (!laneId) return;
      laneGroup.appendChild(
        toBadge(
          text(lane?.label, laneId),
          laneId === normalizeLane(state.meta.callLane),
          () => updateCallMetaValue('callLane', laneId),
          !!state.callLaneLocked,
          { focusKey: 'callLane' },
        ),
      );
    });
    laneField.appendChild(laneGroup);
    if (!lanes.length) {
      laneField.appendChild(create('p', 'dx-submit-copy dx-submit-copy--compact', 'No active call lanes are available right now.'));
    } else if (state.callLaneLocked && lanes.length === 1) {
      laneField.appendChild(create('p', 'dx-submit-copy dx-submit-copy--compact', `Locked to active lane: ${text(lanes[0]?.label, 'IN DEX')}.`));
    }
    grid.appendChild(laneField);

    const titleField = wrapField('Proposal title', true);
    const titleInput = create('input', 'dx-submit-input');
    titleInput.type = 'text';
    titleInput.maxLength = 100;
    titleInput.placeholder = 'Ex: dexFest panel proposal';
    titleInput.value = state.meta.title;
    titleInput.addEventListener('input', (event) => {
      state.meta.title = event.target.value;
    });
    bindFieldFocus(titleInput, 'title');
    titleField.appendChild(titleInput);
    grid.appendChild(titleField);

    const creatorField = wrapField('Proposer / creator', true);
    const creatorInput = create('input', 'dx-submit-input');
    creatorInput.type = 'text';
    creatorInput.maxLength = 2000;
    creatorInput.placeholder = 'Ex: Jane Doe';
    creatorInput.value = state.meta.creator;
    creatorInput.addEventListener('input', (event) => {
      state.meta.creator = event.target.value;
    });
    bindFieldFocus(creatorInput, 'creator');
    creatorField.appendChild(creatorInput);
    grid.appendChild(creatorField);

    const cycleField = wrapField('Call cycle');
    const cycleInput = create('input', 'dx-submit-input');
    cycleInput.type = 'text';
    cycleInput.maxLength = 120;
    cycleInput.placeholder = 'Ex: IN DEX A2024.4';
    cycleInput.value = text(state.meta.callCycle);
    if (state.callLaneLocked && !!text(state.meta.callCycle)) {
      cycleInput.readOnly = true;
      cycleInput.disabled = true;
      cycleInput.classList.add('is-disabled');
    }
    cycleInput.addEventListener('input', (event) => {
      state.meta.callCycle = event.target.value;
    });
    bindFieldFocus(cycleInput, 'callCycle');
    cycleField.appendChild(cycleInput);
    grid.appendChild(cycleField);

    const laneSchema = getCallLaneSchema(state.meta.callLane);
    if (laneSchema && text(laneSchema.helper)) {
      grid.appendChild(create('p', 'dx-submit-copy dx-submit-copy--compact', text(laneSchema.helper)));
    }
    const laneFields = Array.isArray(laneSchema?.fields) ? laneSchema.fields : [];
    laneFields.forEach((fieldSchema) => {
      const field = buildCallDynamicField(fieldSchema);
      if (field) grid.appendChild(field);
    });

    section.appendChild(grid);

    const actions = create('div', 'dx-submit-stage-actions');
    const back = create('button', 'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      state.step = 0;
      render();
    });

    const next = create('button', 'cta-btn dx-button-element dx-button-size--md dx-button-element--primary', 'Continue to license');
    next.type = 'button';
    next.addEventListener('click', () => {
      if (!guardQuotaForProgression(true)) return;
      if (!validateMeta()) return;
      state.step = 2;
      render();
    });

    actions.append(back, next);
    section.appendChild(actions);

    return section;
  }

  function buildMetadataStep() {
    if (state.flow === FLOW_CALL) return buildCallMetadataStep();
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'metadata');

    section.appendChild(create('p', 'dx-submit-kicker', 'Step 2'));
    section.appendChild(create('h2', 'dx-submit-title', 'Metadata that powers discoverability and review speed'));

    const defaultsWrap = create('div', 'dx-submit-stage-actions');
    const defaultsInfo = create(
      'p',
      'dx-submit-copy dx-submit-copy--compact',
      hasSubmitProfileDefaults()
        ? 'Profile defaults are available for creator/category/instrument.'
        : 'Add defaults in Settings > Contribution Profile to speed up repeat submissions.',
    );
    const defaultsApply = create(
      'button',
      'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary',
      'Apply profile defaults',
    );
    defaultsApply.type = 'button';
    defaultsApply.disabled = !hasSubmitProfileDefaults();
    defaultsApply.classList.toggle('is-disabled', !hasSubmitProfileDefaults());
    defaultsApply.addEventListener('click', () => {
      const applied = applySubmitProfileDefaults({ force: true, announce: true });
      if (applied) render();
    });
    defaultsWrap.append(defaultsInfo, defaultsApply);
    section.appendChild(defaultsWrap);

    const grid = create('div', 'dx-submit-grid');

    const titleField = wrapField('Proposed sample title', true);
    const titleInput = create('input', 'dx-submit-input');
    titleInput.type = 'text';
    titleInput.maxLength = 100;
    titleInput.placeholder = 'Ex: Prepared Trombone Long Tones';
    titleInput.value = state.meta.title;
    titleInput.addEventListener('input', (event) => {
      state.meta.title = event.target.value;
    });
    bindFieldFocus(titleInput, 'title');
    titleField.appendChild(titleInput);
    grid.appendChild(titleField);

    const creatorField = wrapField('Sample creator(s)', true);
    const creatorInput = create('input', 'dx-submit-input');
    creatorInput.type = 'text';
    creatorInput.maxLength = 2000;
    creatorInput.placeholder = 'Ex: Jane Doe, John Doe';
    creatorInput.value = state.meta.creator;
    creatorInput.addEventListener('input', (event) => {
      state.meta.creator = event.target.value;
    });
    bindFieldFocus(creatorInput, 'creator');
    creatorField.appendChild(creatorInput);
    grid.appendChild(creatorField);

    const categoryField = wrapField('Instrument category', true);
    const categorySelect = create('select', 'dx-submit-input');
    CATEGORY_OPTIONS.forEach((value) => {
      const option = create('option', '', value || 'Choose category');
      option.value = value;
      categorySelect.appendChild(option);
    });
    categorySelect.value = state.meta.category;
    categorySelect.addEventListener('change', (event) => {
      state.meta.category = event.target.value;
    });
    bindFieldFocus(categorySelect, 'category');
    categoryField.appendChild(categorySelect);
    grid.appendChild(categoryField);

    const instrumentField = wrapField('Instrument', true);
    const instrumentInput = create('input', 'dx-submit-input');
    instrumentInput.type = 'text';
    instrumentInput.maxLength = 120;
    instrumentInput.placeholder = 'Ex: Prepared Trombone';
    instrumentInput.value = state.meta.instrument;
    instrumentInput.addEventListener('input', (event) => {
      state.meta.instrument = event.target.value;
    });
    bindFieldFocus(instrumentInput, 'instrument');
    instrumentField.appendChild(instrumentInput);
    grid.appendChild(instrumentField);

    const bpmField = wrapField('BPM');
    const bpmInput = create('input', 'dx-submit-input');
    bpmInput.type = 'number';
    bpmInput.placeholder = '120';
    bpmInput.value = state.meta.bpm;
    bpmInput.addEventListener('input', (event) => {
      state.meta.bpm = event.target.value;
    });
    bindFieldFocus(bpmInput, 'bpm');
    bpmField.appendChild(bpmInput);
    grid.appendChild(bpmField);

    const currentPitchSystem = normalizePitchSystem(state.meta.pitchSystem);
    state.meta.pitchSystem = currentPitchSystem;
    state.meta.pitchDescriptor = normalizePitchDescriptorForSystem(currentPitchSystem, state.meta.pitchDescriptor);
    syncLegacyPitchFields(state.meta);

    const pitchSystemField = wrapField('Pitch system');
    const pitchSystemSelect = create('select', 'dx-submit-input');
    PITCH_SYSTEM_OPTIONS.forEach((entry) => {
      const option = create('option', '', entry.label);
      option.value = entry.value;
      pitchSystemSelect.appendChild(option);
    });
    pitchSystemSelect.value = currentPitchSystem;
    pitchSystemSelect.addEventListener('change', (event) => {
      state.meta.pitchSystem = normalizePitchSystem(event.target.value);
      state.meta.pitchDescriptor = normalizePitchDescriptorForSystem(state.meta.pitchSystem, state.meta.pitchDescriptor);
      if (state.meta.pitchSystem === 'atonal' || state.meta.pitchSystem === 'non-pitched') {
        state.meta.pitchDescriptor = '';
      }
      syncLegacyPitchFields(state.meta);
      render();
    });
    bindFieldFocus(pitchSystemSelect, 'pitchSystem');
    pitchSystemField.appendChild(pitchSystemSelect);
    grid.appendChild(pitchSystemField);

    if (isPitchRootDropdownSystem(currentPitchSystem)) {
      const keyField = wrapField('Pitch root');
      const keySelect = create('select', 'dx-submit-input');
      const emptyOption = create('option', '', 'Select pitch root');
      emptyOption.value = '';
      keySelect.appendChild(emptyOption);
      getPitchRootOptions(currentPitchSystem).forEach((value) => {
        const option = create('option', '', value);
        option.value = value;
        keySelect.appendChild(option);
      });
      keySelect.value = text(state.meta.pitchDescriptor);
      keySelect.addEventListener('change', (event) => {
        state.meta.pitchDescriptor = event.target.value;
        syncLegacyPitchFields(state.meta);
      });
      bindFieldFocus(keySelect, 'pitchDescriptor');
      keyField.appendChild(keySelect);
      grid.appendChild(keyField);
    } else if (currentPitchSystem === 'ji') {
      const descriptorField = wrapField('JI pitch descriptor');
      const hint = create('p', 'dx-submit-copy dx-submit-copy--compact', PITCH_DESCRIPTOR_HINTS.ji);
      const descriptorInput = create('input', 'dx-submit-input');
      descriptorInput.type = 'text';
      descriptorInput.maxLength = 120;
      descriptorInput.placeholder = 'Ex: 5/4 on C';
      descriptorInput.value = text(state.meta.pitchDescriptor);
      descriptorInput.addEventListener('input', (event) => {
        state.meta.pitchDescriptor = event.target.value;
        syncLegacyPitchFields(state.meta);
      });
      bindFieldFocus(descriptorInput, 'pitchDescriptor');
      descriptorField.append(hint, descriptorInput);
      grid.appendChild(descriptorField);
    } else {
      const quickField = wrapField('Pitch detail');
      quickField.appendChild(create('p', 'dx-submit-copy dx-submit-copy--compact', 'No key-center descriptor required for this pitch type.'));
      grid.appendChild(quickField);
    }

    const scaleField = wrapField('Scale quality');
    const scaleInput = create('input', 'dx-submit-input');
    scaleInput.type = 'text';
    scaleInput.maxLength = 50;
    scaleInput.placeholder = 'major, minor, modal, maqam, raga...';
    scaleInput.value = state.meta.scaleQuality;
    scaleInput.addEventListener('input', (event) => {
      state.meta.scaleQuality = event.target.value;
    });
    bindFieldFocus(scaleInput, 'scaleQuality');
    scaleField.appendChild(scaleInput);
    grid.appendChild(scaleField);

    const collectionField = wrapField('Collection type', true);
    const collectionGroup = create('div', 'dx-submit-badge-group');
    COLLECTION_OPTIONS.forEach((entry) => {
      collectionGroup.appendChild(
        toBadge(
          `${entry.value} - ${entry.label}`,
          state.meta.collectionType === entry.value,
          () => {
            state.meta.collectionType = entry.value;
            render();
          },
          false,
          { focusKey: 'collectionType' },
        ),
      );
    });
    collectionField.appendChild(collectionGroup);
    grid.appendChild(collectionField);

    const outputField = wrapField('Quality / output types');
    const outputGroup = create('div', 'dx-submit-badge-group');
    OUTPUT_OPTIONS.forEach((entry) => {
      const selected = state.meta.outputTypes.includes(entry.value);
      outputGroup.appendChild(
        toBadge(entry.label, selected, () => {
          if (selected) {
            state.meta.outputTypes = state.meta.outputTypes.filter((value) => value !== entry.value);
          } else {
            state.meta.outputTypes = [...state.meta.outputTypes, entry.value];
          }
          render();
        }, false, { focusKey: 'outputTypes' }),
      );
    });
    outputField.appendChild(outputGroup);
    grid.appendChild(outputField);

    const tagsField = wrapField('Tags');
    const tagsHint = create('p', 'dx-submit-copy dx-submit-copy--compact', `Tip: ${TAG_HINT}`);
    const tagsInput = create('input', 'dx-submit-input');
    tagsInput.type = 'text';
    tagsInput.placeholder = 'comma separated';
    tagsInput.value = state.meta.tags;
    tagsInput.addEventListener('input', (event) => {
      state.meta.tags = event.target.value;
    });
    bindFieldFocus(tagsInput, 'tags');
    tagsField.append(tagsHint, tagsInput);
    grid.appendChild(tagsField);

    section.appendChild(grid);

    const actions = create('div', 'dx-submit-stage-actions');
    const back = create('button', 'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      state.step = 0;
      render();
    });

    const next = create('button', 'cta-btn dx-button-element dx-button-size--md dx-button-element--primary', 'Continue to license');
    next.type = 'button';
    next.addEventListener('click', () => {
      if (!guardQuotaForProgression(true)) return;
      if (!validateMeta()) return;
      state.step = 2;
      render();
    });

    actions.append(back, next);
    section.appendChild(actions);

    return section;
  }

  function buildLicenseStep() {
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'license');

    section.appendChild(create('p', 'dx-submit-kicker', 'Step 3'));
    section.appendChild(create('h2', 'dx-submit-title', 'Choose rights model for publication and downstream usage'));

    const selected = LICENSE_OPTIONS.find((entry) => entry.id === state.licenseType) || LICENSE_OPTIONS[0];

    const optionGrid = create('div', 'dx-submit-license-options');
    LICENSE_OPTIONS.forEach((entry) => {
      const selectedOption = entry.id === state.licenseType;
      optionGrid.appendChild(
        toBadge(entry.label, selectedOption, () => {
          state.licenseType = entry.id;
          render();
        }, false, { focusKey: 'licenseType' }),
      );
    });
    section.appendChild(optionGrid);

    const summary = create('p', 'dx-submit-copy', selected.summary);
    section.appendChild(summary);

    const licenseCard = create('article', 'dx-submit-license-card');
    const pre = create('pre', 'dx-submit-license-pre', selected.copy);
    licenseCard.appendChild(pre);
    section.appendChild(licenseCard);

    const agree = create('label', 'dx-submit-checkbox');
    const checkbox = create('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!state.licenseConfirmed;
    checkbox.setAttribute('data-dx-submit-license-accept', 'true');
    checkbox.addEventListener('change', () => {
      state.licenseConfirmed = checkbox.checked;
    });
    bindFieldFocus(checkbox, 'licenseConfirmed');
    const agreeText = create('span', '', 'I reviewed and accept this license selection.');
    agree.append(checkbox, agreeText);
    section.appendChild(agree);

    const rights = create('label', 'dx-submit-checkbox');
    const rightsCheckbox = create('input');
    rightsCheckbox.type = 'checkbox';
    rightsCheckbox.checked = !!state.rightsConfirmed;
    rightsCheckbox.setAttribute('data-dx-submit-rights-ack', 'true');
    rightsCheckbox.addEventListener('change', () => {
      state.rightsConfirmed = rightsCheckbox.checked;
    });
    bindFieldFocus(rightsCheckbox, 'rightsConfirmed');
    const rightsText = create(
      'span',
      '',
      'I confirm this submission is my own original work, or work I am authorized to represent (for example, my band\'s own work), and is not a repost of third-party public-domain material.',
    );
    rights.append(rightsCheckbox, rightsText);
    section.appendChild(rights);

    const signatureField = wrapField('Digital signature (typed full name)', true);
    const signatureInput = create('input', 'dx-submit-input');
    signatureInput.type = 'text';
    signatureInput.maxLength = 140;
    signatureInput.autocomplete = 'name';
    signatureInput.placeholder = 'Type your full name';
    signatureInput.value = text(state.signatureName);
    signatureInput.setAttribute('data-dx-submit-license-signature', 'true');
    signatureInput.addEventListener('input', (event) => {
      state.signatureName = event.target.value;
    });
    bindFieldFocus(signatureInput, 'signatureName');
    signatureField.appendChild(signatureInput);
    section.appendChild(signatureField);

    const actions = create('div', 'dx-submit-stage-actions');
    const back = create('button', 'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      state.step = 1;
      render();
    });

    const next = create('button', 'cta-btn dx-button-element dx-button-size--md dx-button-element--primary', 'Continue to upload');
    next.type = 'button';
    next.addEventListener('click', () => {
      if (!guardQuotaForProgression(true)) return;
      if (!state.licenseConfirmed) {
        showToast('Please confirm license acceptance.', true);
        return;
      }
      if (!state.rightsConfirmed) {
        showToast('Please confirm ownership/representation acknowledgment.', true);
        return;
      }
      if (text(state.signatureName).length < 2) {
        showToast('Enter your full name as digital signature.', true);
        return;
      }
      state.step = 3;
      render();
    });

    actions.append(back, next);
    section.appendChild(actions);

    return section;
  }

  function buildCallUploadStep() {
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'upload');

    section.appendChild(create('p', 'dx-submit-kicker', 'Step 4'));
    section.appendChild(create('h2', 'dx-submit-title', 'Submit materials link and notes for this call lane'));

    const linkField = wrapField('Public materials link', true);
    const linkInput = create('input', 'dx-submit-input');
    linkInput.type = 'url';
    linkInput.placeholder = 'https://drive.google.com/...';
    linkInput.value = state.meta.link;
    linkInput.addEventListener('input', (event) => {
      state.meta.link = event.target.value;
    });
    bindFieldFocus(linkInput, 'link');
    linkField.appendChild(linkInput);
    section.appendChild(linkField);

    const notesField = wrapField('Notes for Dex team');
    const notesInput = create('textarea', 'dx-submit-input dx-submit-notes');
    notesInput.rows = 5;
    notesInput.placeholder = 'Any constraints, context, or timing notes for this call submission';
    notesInput.value = state.meta.notes;
    notesInput.addEventListener('input', (event) => {
      state.meta.notes = event.target.value;
    });
    bindFieldFocus(notesInput, 'notes');
    notesField.appendChild(notesInput);
    section.appendChild(notesField);

    if (text(state.submitError)) {
      section.appendChild(create('p', 'dx-submit-copy dx-submit-copy--compact', state.submitError));
    }

    const actions = create('div', 'dx-submit-stage-actions');
    const back = create('button', 'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      state.step = 2;
      render();
    });

    const submit = create('button', 'cta-btn dx-button-element dx-button-size--md dx-button-element--primary', state.submitting ? 'Submitting…' : 'Submit call');
    submit.type = 'button';
    submit.disabled = state.submitting;
    submit.addEventListener('click', () => {
      submitPayload();
    });

    actions.append(back, submit);
    section.appendChild(actions);

    return section;
  }

  function buildUploadStep() {
    if (state.flow === FLOW_CALL) return buildCallUploadStep();
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'upload');

    section.appendChild(create('p', 'dx-submit-kicker', 'Step 4'));
    section.appendChild(create('h2', 'dx-submit-title', 'Submit source link and optional post-production requests'));

    const linkField = wrapField('Public source link', true);
    const linkInput = create('input', 'dx-submit-input');
    linkInput.type = 'url';
    linkInput.placeholder = 'https://drive.google.com/...';
    linkInput.value = state.meta.link;
    linkInput.addEventListener('input', (event) => {
      state.meta.link = event.target.value;
    });
    bindFieldFocus(linkInput, 'link');
    linkField.appendChild(linkInput);
    section.appendChild(linkField);

    const serviceField = wrapField('Dex services');
    const services = create('div', 'dx-submit-badge-group');
    SERVICE_OPTIONS.forEach((entry) => {
      const selected = state.meta.services.includes(entry.value);
      services.appendChild(
        toBadge(entry.label, selected, () => {
          if (selected) {
            state.meta.services = state.meta.services.filter((value) => value !== entry.value);
          } else {
            state.meta.services = [...state.meta.services, entry.value];
          }
          render();
        }, entry.locked, { tooltip: entry.tooltip, focusKey: 'services' }),
      );
    });
    serviceField.appendChild(services);
    section.appendChild(serviceField);

    const notesField = wrapField('Notes for Dex team');
    const notesInput = create('textarea', 'dx-submit-input dx-submit-notes');
    notesInput.rows = 5;
    notesInput.placeholder = 'Any delivery constraints, context, or edit notes';
    notesInput.value = state.meta.notes;
    notesInput.addEventListener('input', (event) => {
      state.meta.notes = event.target.value;
    });
    bindFieldFocus(notesInput, 'notes');
    notesField.appendChild(notesInput);
    section.appendChild(notesField);

    if (text(state.submitError)) {
      section.appendChild(create('p', 'dx-submit-copy dx-submit-copy--compact', state.submitError));
    }

    const actions = create('div', 'dx-submit-stage-actions');
    const back = create('button', 'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      state.step = 2;
      render();
    });

    const submit = create('button', 'cta-btn dx-button-element dx-button-size--md dx-button-element--primary', state.submitting ? 'Submitting…' : 'Submit sample');
    submit.type = 'button';
    submit.disabled = state.submitting;
    submit.addEventListener('click', () => {
      submitPayload();
    });

    actions.append(back, submit);
    section.appendChild(actions);

    return section;
  }

  function buildDoneStep() {
    const section = create('section', 'dx-submit-stage-card');
    section.setAttribute('data-dx-submit-step', 'done');

    const isCallFlow = state.flow === FLOW_CALL;
    section.appendChild(create('p', 'dx-submit-kicker', isCallFlow ? 'Call submission sent' : 'Submission sent'));
    section.appendChild(
      create(
        'h2',
        'dx-submit-title',
        isCallFlow
          ? 'Call submission received. Timeline is now active.'
          : 'Submission received. Timeline is now active.',
      ),
    );

    const lookup = text(state.lastSubmissionLookup, buildGeneratedSubmissionLookup(state.lastSubmissionRow));

    const badgeRow = create('div', 'dx-submit-pill-group');
    if (lookup) {
      badgeRow.appendChild(create('span', 'dx-submit-pill dx-submit-pill--accent', lookup));
    }
    if (isCallFlow) {
      const lane = normalizeLane(state.meta.callLane);
      if (lane) badgeRow.appendChild(create('span', 'dx-submit-pill', laneLabel(lane)));
      if (lane === 'in-dex-a' && normalizeSubcall(state.meta.callSubcall)) {
        badgeRow.appendChild(create('span', 'dx-submit-pill', `Subcall ${String(state.meta.callSubcall).toUpperCase()}`));
      }
    }
    badgeRow.appendChild(create('span', 'dx-submit-pill', 'Pending review'));
    section.appendChild(badgeRow);

    section.appendChild(
      create(
        'p',
        'dx-submit-copy',
        isCallFlow
          ? 'Open Messages to follow sent/received/reviewing/accepted states, call notes, and publish links when released.'
          : 'Open Messages to follow sent/received/reviewing/accepted states, timeline notes, and publish links when released.',
      ),
    );

    const actions = create('div', 'dx-submit-stage-actions');
    const inbox = create(
      'a',
      'cta-btn dx-button-element dx-button-size--md dx-button-element--primary',
      isCallFlow ? 'Open call messages' : 'Open submission messages',
    );
    inbox.href = '/entry/messages/';

    const restart = create(
      'button',
      'cta-btn dx-button-element dx-button-size--sm dx-button-element--secondary',
      isCallFlow ? 'Start another call submission' : 'Start another submission',
    );
    restart.type = 'button';
    restart.addEventListener('click', () => {
      state.step = 0;
      const resetDraft = baseFlowDraft(state.flow);
      state.flowDrafts[state.flow] = resetDraft;
      state.meta = cloneMeta(resetDraft.meta);
      state.licenseType = resetDraft.licenseType;
      state.licenseConfirmed = resetDraft.licenseConfirmed;
      state.rightsConfirmed = resetDraft.rightsConfirmed;
      state.signatureName = resetDraft.signatureName;
      state.lastSubmissionId = '';
      state.lastSubmissionRow = '000';
      state.lastSubmissionLookup = '';
      render();
    });

    actions.append(inbox, restart);
    section.appendChild(actions);

    return section;
  }

  function buildStepContent() {
    if (!state.pipelineChosen) return buildFlowGateStep();
    if (state.step === 0) return buildIntroStep();
    if (state.step === 1) return buildMetadataStep();
    if (state.step === 2) return buildLicenseStep();
    if (state.step === 3) return buildUploadStep();
    return buildDoneStep();
  }

  function buildChecklist() {
    const list = create('ul', 'dx-submit-checklist');
    const checks = state.flow === FLOW_CALL
      ? [
        ['Title', text(state.meta.title).length > 0],
        ['Creator', text(state.meta.creator).length > 0],
        ['Call lane', text(state.meta.callLane).length > 0],
        ['Proposal format', text(state.meta.proposalFormat).length > 0],
        ['Source link', text(state.meta.link).length > 0],
      ]
      : [
        ['Title', text(state.meta.title).length > 0],
        ['Creator', text(state.meta.creator).length > 0],
        ['Category', text(state.meta.category).length > 0],
        ['Instrument', text(state.meta.instrument).length > 0],
        ['Collection type', text(state.meta.collectionType).length > 0],
      ];

    checks.forEach(([label, ok]) => {
      const item = createSidebarText('li', 'dx-submit-check-item', label);
      item.classList.add(ok ? 'is-done' : 'is-pending');
      list.appendChild(item);
    });

    return list;
  }

  function resolveFocusedGuidance() {
    if (!state.pipelineChosen) {
      return {
        title: 'Choose a pipeline',
        body: 'Pick Sample Submission for library entries, or IN DEX Call Submission for active call lanes.',
      };
    }
    const byField = FIELD_GUIDANCE[state.focusedField];
    if (byField) return byField;
    const stepKey = STEPS[state.step]?.key || 'intro';
    const callStepGuidance = {
      intro: 'Choose pipeline, lane context, and call cycle before beginning.',
      metadata: 'Provide lane-fit metadata so adjudication can route without clarification loops.',
      license: 'Rights acknowledgment and digital signature are required for call submissions.',
      upload: 'Submit one stable materials link plus notes for adjudicators.',
      done: 'Track call decisions and notes from your Messages timeline.',
    };
    return {
      title: `Step guidance: ${STEPS[state.step]?.title || 'Submission'}`,
      body: state.flow === FLOW_CALL ? callStepGuidance[stepKey] || '' : STEP_GUIDANCE[stepKey] || '',
    };
  }

  function buildCommandPanel() {
    const aside = create('aside', 'dx-submit-command dx-submit-surface');
    const isCallFlow = state.flow === FLOW_CALL;

    const cycle = create('section', 'dx-submit-command-card');
    cycle.append(
      createSidebarText('p', 'dx-submit-kicker', 'Review SLA'),
      createSidebarText('h3', 'dx-submit-command-title', isCallFlow ? 'Call review target: within 7 days' : 'Typical review within 7 days'),
      createSidebarText(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        `${quotaSummaryText()}. Status updates post to your inbox timeline with timestamps and notes.`,
      ),
    );

    const license = LICENSE_OPTIONS.find((entry) => entry.id === state.licenseType) || LICENSE_OPTIONS[0];
    const licenseCard = create('section', 'dx-submit-command-card');
    licenseCard.append(
      createSidebarText('p', 'dx-submit-kicker', 'License summary'),
      createSidebarText('h3', 'dx-submit-command-title', license.label),
      createSidebarText('p', 'dx-submit-copy dx-submit-copy--compact', license.summary),
    );

    const modeCard = create('section', 'dx-submit-command-card');
    if (isCallFlow) {
      const lane = normalizeLane(state.meta.callLane);
      const laneName = lane ? laneLabel(lane) : 'Select lane';
      modeCard.append(
        createSidebarText('p', 'dx-submit-kicker', 'Call lane'),
        createSidebarText('h3', 'dx-submit-command-title', laneName),
        createSidebarText(
          'p',
          'dx-submit-copy dx-submit-copy--compact',
          lane && lane === 'in-dex-a' && normalizeSubcall(state.meta.callSubcall)
            ? `Subcall ${String(state.meta.callSubcall).toUpperCase()} selected.`
            : 'Use lane-specific fields to clarify call fit.',
        ),
      );
    } else {
      modeCard.append(
        createSidebarText('p', 'dx-submit-kicker', 'Pitch profile'),
        createSidebarText('h3', 'dx-submit-command-title', summarizePitch(state.meta)),
        createSidebarText(
          'p',
          'dx-submit-copy dx-submit-copy--compact',
          'Use the pitch-root dropdown for 12-TET and 24-TET, or describe JI context. Atonal and non-pitched are first-class options.',
        ),
      );
    }

    const checklist = create('section', 'dx-submit-command-card');
    checklist.append(
      createSidebarText('p', 'dx-submit-kicker', 'Required fields'),
      buildChecklist(),
    );

    const quality = create('section', 'dx-submit-command-card');
    quality.append(
      createSidebarText('p', 'dx-submit-kicker', isCallFlow ? 'Call intake targets' : 'Capture targets'),
      createSidebarText(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        isCallFlow
          ? 'Use one stable link, clear format/runtime context, and notes staff can action immediately.'
          : 'Video: 3840×2160, H.265, 24fps. Audio: 48kHz, 24-bit WAV. Lower-res accepted.',
      ),
    );

    const guide = create('section', 'dx-submit-command-card');
    const focused = resolveFocusedGuidance();
    guide.append(
      createSidebarText('p', 'dx-submit-kicker', state.focusedField ? 'Focused field guidance' : 'Current step guidance'),
      createSidebarText('h3', 'dx-submit-command-title', focused.title),
      createSidebarText('p', 'dx-submit-copy dx-submit-copy--compact', focused.body),
    );

    aside.append(cycle, licenseCard, modeCard, checklist, quality, guide);
    return aside;
  }

  function buildFlowGateCommandPanel() {
    const aside = create('aside', 'dx-submit-command dx-submit-surface dx-submit-command--gate');

    const guide = create('section', 'dx-submit-command-card');
    guide.append(
      createSidebarText('p', 'dx-submit-kicker', 'Flow chooser'),
      createSidebarText('h3', 'dx-submit-command-title', 'Two pipelines'),
      createSidebarText(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        'Sample Submission is for catalog/library entries. IN DEX Call Submission is for active call lanes.',
      ),
    );

    const tracker = create('section', 'dx-submit-command-card');
    tracker.append(
      createSidebarText('p', 'dx-submit-kicker', 'Shared tracker'),
      createSidebarText('h3', 'dx-submit-command-title', 'One messages timeline'),
      createSidebarText(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        'Both pipelines route status updates to Messages with sent, received, reviewing, and decision states.',
      ),
    );

    aside.append(guide, tracker);
    return aside;
  }

  function refreshCommandPanel() {
    if (!(liveRoot instanceof HTMLElement) || !state) return;
    const current = liveRoot.querySelector('.dx-submit-command');
    if (!(current instanceof HTMLElement)) return;
    const next = state.pipelineChosen ? buildCommandPanel() : buildFlowGateCommandPanel();
    current.replaceWith(next);
  }

  function refreshQuotaCopy() {
    if (!(liveRoot instanceof HTMLElement) || !state) return;
    const quota = liveRoot.querySelector('[data-dx-submit-quota]');
    if (quota instanceof HTMLElement) {
      quota.textContent = quotaSummaryText();
    }
    const begin = liveRoot.querySelector('[data-dx-submit-begin]');
    if (begin instanceof HTMLButtonElement) {
      const quotaLocked = isQuotaLocked();
      begin.disabled = quotaLocked;
      begin.classList.toggle('is-disabled', quotaLocked);
      begin.setAttribute('aria-disabled', quotaLocked ? 'true' : 'false');
    }

    const intro = liveRoot.querySelector('[data-dx-submit-step="intro"]');
    if (intro instanceof HTMLElement) {
      const existingCard = intro.querySelector('.dx-submit-action-card');
      if (state.quotaResolved && state.quotaLeft <= 0) {
        if (!(existingCard instanceof HTMLElement)) {
          const footer = intro.querySelector('.dx-submit-stage-actions');
          const card = buildQuotaActionCard();
          if (footer instanceof HTMLElement) intro.insertBefore(card, footer);
          else intro.appendChild(card);
        }
      } else if (existingCard instanceof HTMLElement) {
        existingCard.remove();
      }
    }

    refreshCommandPanel();
  }

  function applySubmitBusyLock(root) {
    if (!(root instanceof HTMLElement) || !state) return;
    const submitting = !!state.submitting;
    if (submitting) {
      root.setAttribute('data-dx-submit-submitting', 'true');
      root.setAttribute('aria-busy', 'true');
    } else {
      root.removeAttribute('data-dx-submit-submitting');
      if (root.getAttribute('data-dx-fetch-state') !== FETCH_STATE_LOADING) {
        root.removeAttribute('aria-busy');
      }
      return;
    }

    root.querySelectorAll('button,input,select,textarea').forEach((node) => {
      if (
        node instanceof HTMLButtonElement
        || node instanceof HTMLInputElement
        || node instanceof HTMLSelectElement
        || node instanceof HTMLTextAreaElement
      ) {
        node.disabled = true;
      }
    });

    root.querySelectorAll('a').forEach((node) => {
      if (!(node instanceof HTMLAnchorElement)) return;
      node.setAttribute('aria-disabled', 'true');
      node.setAttribute('tabindex', '-1');
      node.classList.add('is-disabled');
    });
  }

  function buildLayout() {
    const pipelineChosen = !!state.pipelineChosen;
    const currentStep = pipelineChosen ? (STEPS[state.step]?.key || 'intro') : 'flow-gate';
    const shell = create('div', 'dx-submit-shell');
    shell.classList.toggle('is-flow-gate', !pipelineChosen);
    shell.setAttribute('data-dx-submit-shell', 'true');
    shell.setAttribute('data-dx-submit-current-step', currentStep);
    shell.setAttribute('data-dx-submit-pipeline-choice', pipelineChosen ? 'selected' : 'pending');
    shell.setAttribute('data-dx-submit-flow', normalizeFlow(state.flow));
    shell.setAttribute('data-dx-submit-lane', normalizeLane(state.meta?.callLane || ''));
    shell.setAttribute('data-dx-submit-has-active-call', state.hasActiveCall ? 'true' : 'false');
    shell.setAttribute('data-dx-submit-active-call-count', String(Math.max(0, Number(state.activeCallCount || 0))));
    if (normalizeSubcall(state.meta?.callSubcall || '')) {
      shell.setAttribute('data-dx-submit-subcall', normalizeSubcall(state.meta.callSubcall));
    }

    const main = create('section', 'dx-submit-main dx-submit-surface');
    const heading = create('header', 'dx-submit-heading');
    const isCallFlow = state.flow === FLOW_CALL;
    heading.append(
      create('p', 'dx-submit-kicker', pipelineChosen ? (isCallFlow ? 'Submit Calls' : 'Submit Samples') : 'Submit'),
      create('h1', 'dx-submit-heading-title', pipelineChosen ? 'Intake + Tracker' : 'Choose Pipeline'),
      create(
        'p',
        'dx-submit-copy dx-submit-copy--compact',
        pipelineChosen
          ? (
            isCallFlow
              ? 'Submit lane-ready call proposals. Follow status from sent to in-library in Messages.'
              : 'Upload once. Follow status from sent to in-library in Messages.'
          )
          : 'Pick the path that matches your submission. You can switch pipelines before sending.',
      ),
    );

    const stageWrap = create('div', 'dx-submit-stage');
    stageWrap.setAttribute('data-dx-submit-stage', currentStep);
    stageWrap.appendChild(buildStepContent());

    main.appendChild(heading);
    if (pipelineChosen) main.appendChild(buildProgressHeader());
    main.appendChild(stageWrap);

    shell.append(main, pipelineChosen ? buildCommandPanel() : buildFlowGateCommandPanel());
    return shell;
  }

  function applyMotion(root) {
    if (isReducedMotion()) return;

    const stageCard = root.querySelector('.dx-submit-stage-card');
    if (stageCard instanceof HTMLElement) {
      animate(stageCard, { opacity: [0, 1], y: [16, 0] }, { duration: 0.32, ease: 'easeOut' });
    }

    const commandCards = Array.from(root.querySelectorAll('.dx-submit-command-card'));
    commandCards.forEach((card, index) => {
      animate(card, { opacity: [0, 1], y: [10, 0] }, { duration: 0.24, delay: index * 0.03, ease: 'easeOut' });
    });

    const fill = root.querySelector('.dx-submit-progress-fill');
    if (fill instanceof HTMLElement) {
      const nextProgress = (state.step + 1) / STEPS.length;
      animate(
        fill,
        { transform: [`scaleX(${state.prevProgress})`, `scaleX(${nextProgress})`] },
        { duration: 0.28, ease: 'easeOut' },
      );
      state.prevProgress = nextProgress;
    }
  }

  function buildPayload() {
    const estimatedCounter = Math.max(1, Number(state.weeklyUsed || 0) + 1);
    const generatedLookup = buildGeneratedSubmissionLookup(estimatedCounter);
    const lane = normalizeLane(state.meta.callLane);
    const laneToCategory = {
      'in-dex-a': 'V - Voice + Body',
      'in-dex-b': 'E - Electronics',
      'in-dex-c': 'X - Other',
      'mini-dex': 'W - Winds',
    };
    const laneToInstrument = {
      'in-dex-a': 'Call Proposal',
      'in-dex-b': 'Composite Proposal',
      'in-dex-c': 'Community Contribution',
      'mini-dex': 'Field Recording',
    };

    if (state.flow === FLOW_CALL) {
      return {
        action: activeSubmitAction(),
        auth0Sub: text(state.auth0Sub),
        title: text(state.meta.title),
        creator: text(state.meta.creator),
        category: laneToCategory[lane] || 'X - Other',
        instrument: laneToInstrument[lane] || 'Call Submission',
        collectionType: 'O',
        license: text(state.licenseType, 'joint'),
        licenseAccepted: state.licenseConfirmed ? 'yes' : 'no',
        rightsAcknowledged: state.rightsConfirmed ? 'yes' : 'no',
        digitalSignatureName: text(state.signatureName),
        link: text(state.meta.link),
        notes: text(state.meta.notes),
        submissionYear: String(new Date().getFullYear()),
        performerToken: parsePerformerToken(),
        submissionLookupNumber: generatedLookup,
        finalLookupNumber: '',
        status: 'pending',
        sourceRoute: '/entry/submit',
        sourceType: 'call',
        submissionKind: 'call',
        callLane: lane,
        callSubcall: normalizeSubcall(state.meta.callSubcall),
        callCycle: text(state.meta.callCycle),
        proposalFormat: text(state.meta.proposalFormat),
        runtimeMinutes: text(state.meta.runtimeMinutes),
        availabilityWindow: text(state.meta.availabilityWindow),
        portfolioUrl: text(state.meta.portfolioUrl),
        clientRequestId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dxcall_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
      };
    }

    syncLegacyPitchFields(state.meta);
    return {
      action: activeSubmitAction(),
      auth0Sub: text(state.auth0Sub),
      title: text(state.meta.title),
      creator: text(state.meta.creator),
      category: text(state.meta.category),
      instrument: text(state.meta.instrument),
      bpm: text(state.meta.bpm),
      pitchSystem: text(state.meta.pitchSystem),
      pitchDescriptor: text(state.meta.pitchDescriptor),
      keyCenter: text(state.meta.keyCenter),
      scaleQuality: text(state.meta.scaleQuality),
      tags: text(state.meta.tags),
      collectionType: text(state.meta.collectionType),
      outputTypes: (Array.isArray(state.meta.outputTypes) ? state.meta.outputTypes : []).join(','),
      services: (Array.isArray(state.meta.services) ? state.meta.services : []).join(','),
      license: text(state.licenseType, 'joint'),
      licenseAccepted: state.licenseConfirmed ? 'yes' : 'no',
      rightsAcknowledged: state.rightsConfirmed ? 'yes' : 'no',
      digitalSignatureName: text(state.signatureName),
      link: text(state.meta.link),
      notes: text(state.meta.notes),
      submissionYear: String(new Date().getFullYear()),
      performerToken: parsePerformerToken(),
      submissionLookupNumber: generatedLookup,
      finalLookupNumber: '',
      status: 'pending',
      submissionKind: 'sample',
      sourceType: 'sample',
    };
  }

  async function submitPayload() {
    if (state.submitting) return;
    if (!text(state.meta.link)) {
      showToast('Missing link', true);
      return;
    }

    state.submitting = true;
    state.submitError = '';
    render();
    const submitStartTs = performance.now();

    const quotaVerified = await refreshWeeklyQuotaFromSheet({
      useCache: false,
      forceLive: true,
      allowRetry: false,
      timeoutMs: SUBMIT_QUOTA_VERIFY_TIMEOUT_MS,
    });
    if (!quotaVerified) {
      state.submitting = false;
      state.submitError = describeQuotaFailure();
      render();
      showToast(state.submitError, true);
      refreshQuotaCopy();
      return;
    }
    if (!guardQuotaForProgression(true)) {
      state.submitting = false;
      render();
      refreshQuotaCopy();
      return;
    }

    await resolveAuthUser(Math.min(AUTH_TIMEOUT_MS, 2200));
    const payload = buildPayload();
    const callbackName = `dxSubmitCallback_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const script = document.createElement('script');
    const ticket = Date.now();
    state.submitTicket = ticket;
    let settled = false;

    function cleanup() {
      releaseJsonpCallback(callbackName);
      if (script.isConnected) script.remove();
    }

    function onResolved(success, responsePayload = null, failureCode = '') {
      if (settled) return;
      settled = true;
      cleanup();

      const finish = () => {
        if (state.submitTicket !== ticket) return;
        state.submitting = false;

        if (success) {
          const rowNumber = responsePayload && typeof responsePayload === 'object'
            ? (responsePayload.row ?? responsePayload.sourceRow ?? '')
            : '';
          state.lastSubmissionId = responsePayload && typeof responsePayload === 'object'
            ? text(responsePayload.submissionId ?? responsePayload.submission_id, '')
            : '';
          if (state.lastSubmissionId) {
            window.__dxPendingSubmissionSid = state.lastSubmissionId;
            window.__dxPendingMessageThread = { kind: 'submission', sid: state.lastSubmissionId };
            try {
              window.sessionStorage.setItem('dex:messages:pending-submission-sid', state.lastSubmissionId);
              window.sessionStorage.setItem('dex:messages:pending-thread:v1', JSON.stringify({ kind: 'submission', sid: state.lastSubmissionId }));
            } catch {}
          }
          state.lastSubmissionRow = String(rowNumber || '').padStart(3, '0') || '000';
          state.lastSubmissionLookup = resolveLookupFromSubmitResponse(responsePayload, rowNumber || state.lastSubmissionRow);
          const payloadWeeklyLimit = parsePositiveInt(
            responsePayload && typeof responsePayload === 'object' ? responsePayload.weeklyLimit : null,
            null,
          );
          const payloadWeeklyRemaining = parsePositiveInt(
            responsePayload && typeof responsePayload === 'object' ? responsePayload.weeklyRemaining : null,
            null,
          );
          const payloadWeeklyUsed = parsePositiveInt(
            responsePayload && typeof responsePayload === 'object' ? responsePayload.weeklyUsed : null,
            null,
          );
          if (payloadWeeklyLimit !== null) {
            state.weeklyLimit = Math.max(1, Math.min(99, payloadWeeklyLimit));
          }
          if (payloadWeeklyRemaining !== null) {
            state.quotaLeft = Math.max(0, Math.min(state.weeklyLimit, payloadWeeklyRemaining));
            state.weeklyUsed = Math.max(0, state.weeklyLimit - state.quotaLeft);
          } else if (payloadWeeklyUsed !== null) {
            state.weeklyUsed = Math.max(0, payloadWeeklyUsed);
            state.quotaLeft = Math.max(0, state.weeklyLimit - state.weeklyUsed);
          } else {
            state.weeklyUsed += 1;
            state.quotaLeft = Math.max(0, state.weeklyLimit - state.weeklyUsed);
          }
          state.quotaResolved = true;
          state.step = 4;
          render();
          showToast(state.flow === FLOW_CALL ? 'Call submitted' : 'Submitted');
          void refreshAchievementsAfterSubmit();
        } else {
          state.submitError = describeSubmitFailure(responsePayload, failureCode);
          render();
          showToast(state.submitError, true);
        }
      };

      const elapsed = performance.now() - submitStartTs;
      const remaining = Math.max(0, SUBMIT_MIN_LOADING_MS - elapsed);
      if (remaining > 0) {
        window.setTimeout(finish, remaining);
      } else {
        finish();
      }
    }

    window[callbackName] = (response) => {
      if (response && response.status === 'ok') {
        onResolved(true, response);
      } else {
        onResolved(false, response, 'submit_rejected');
      }
    };

    script.async = true;
    script.src = `${state.webappUrl}?callback=${encodeURIComponent(callbackName)}&${new URLSearchParams(payload).toString()}`;
    script.addEventListener('error', () => onResolved(false, null, 'script_error'));
    document.body.appendChild(script);

    window.setTimeout(() => {
      if (!settled) onResolved(false, null, 'submit_timeout');
    }, SUBMIT_TIMEOUT_MS);
  }

  function syncRootFlowAttrs() {
    if (!(liveRoot instanceof HTMLElement) || !state) return;
    const flow = normalizeFlow(state.flow);
    const lane = normalizeLane(state.meta?.callLane || '');
    const subcall = normalizeSubcall(state.meta?.callSubcall || '');
    liveRoot.setAttribute('data-dx-submit-pipeline-choice', state.pipelineChosen ? 'selected' : 'pending');
    liveRoot.setAttribute('data-dx-submit-flow', flow);
    liveRoot.setAttribute('data-dx-submit-lane', lane);
    liveRoot.setAttribute('data-dx-submit-has-active-call', state.hasActiveCall ? 'true' : 'false');
    liveRoot.setAttribute('data-dx-submit-active-call-count', String(Math.max(0, Number(state.activeCallCount || 0))));
    if (subcall) liveRoot.setAttribute('data-dx-submit-subcall', subcall);
    else liveRoot.removeAttribute('data-dx-submit-subcall');
  }

  function render() {
    if (!(liveRoot instanceof HTMLElement) || !state) return;

    persistActiveFlowDraft();
    syncRootFlowAttrs();
    hideSubmitTooltip();
    liveRoot.innerHTML = '';
    liveRoot.appendChild(buildLayout());
    const toastStack = create('div', 'dx-submit-toast-stack');
    toastStack.setAttribute('data-dx-submit-toasts', 'true');
    liveRoot.appendChild(toastStack);
    applySubmitBusyLock(liveRoot);

    applyMotion(liveRoot);
    bindSubmitTooltips(liveRoot);
  }

  async function resolveAuth0Sub(timeoutMs = AUTH_TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (text(window.auth0Sub)) return text(window.auth0Sub);

      if (window.DEX_AUTH && typeof window.DEX_AUTH.getUser === 'function') {
        try {
          const user = await withTimeout(window.DEX_AUTH.getUser(), Math.min(timeoutMs, 1200), null);
          const subject = extractAuthSubject(user);
          if (subject) return subject;
        } catch {}
      }

      if (window.auth0 && typeof window.auth0.getUser === 'function') {
        try {
          const candidate = window.auth0.getUser();
          const user = candidate && typeof candidate.then === 'function' ? await candidate : candidate;
          const subject = extractAuthSubject(user);
          if (subject) return subject;
        } catch {}
      }

      if (window.AUTH0_USER && typeof window.AUTH0_USER === 'object') {
        const subject = extractAuthSubject(window.AUTH0_USER);
        if (subject) return subject;
      }

      await delay(100);
    }
    return '';
  }

  let quotaHydrationPromise = null;

  async function hydrateAuthAndQuota(options = {}) {
    if (!state) return false;
    const opts = options && typeof options === 'object' ? options : {};
    if (quotaHydrationPromise) return quotaHydrationPromise;

    quotaHydrationPromise = (async () => {
      const sub = await resolveAuth0Sub(AUTH_TIMEOUT_MS);
      if (!text(sub)) {
        // Keep the last known quota on transient auth races; only reset when nothing was resolved yet.
        if (!state.quotaResolved) {
          state.auth0Sub = '';
          setQuotaSource('none');
          refreshQuotaCopy();
        }
        return false;
      }
      if (state.auth0Sub !== sub) {
        state.auth0Sub = sub;
        window.auth0Sub = sub;
      }
      state.authUser = await resolveAuthUser(Math.min(AUTH_TIMEOUT_MS, 2200));
      await hydrateSubmitProfileDefaults({ force: !!opts.forceLive });
      const verified = await refreshWeeklyQuotaFromSheet({
        useCache: true,
        forceLive: !!opts.forceLive,
        allowRetry: true,
      });
      refreshQuotaCopy();
      return verified;
    })()
      .catch(() => false)
      .finally(() => {
        quotaHydrationPromise = null;
      });

    return quotaHydrationPromise;
  }

  async function mount(options = {}) {
    const root = document.getElementById('dex-submit');
    if (!(root instanceof HTMLElement)) return false;

    const force = !!options.force;
    if (root.getAttribute('data-dx-submit-booting') === 'true') return false;
    if (!force && root.getAttribute('data-dx-submit-mounted') === 'true') return true;

    root.setAttribute('data-dx-submit-booting', 'true');
    const startTs = performance.now();

    try {
      liveRoot = root;
      setFetchState(root, FETCH_STATE_LOADING);
      const config = toConfig(root);
      state = makeState(config);
      state.auth0Sub = text(window.auth0Sub, '');
      setQuotaSource('none');
      render();
      const schemaPromise = loadCallSchema().catch(() => {});
      const callsRegistryPromise = loadCallsRegistry().catch(() => {});
      await Promise.all([schemaPromise, callsRegistryPromise]);
      render();
      hydrateAuthAndQuota({ forceLive: false }).catch(() => {});
      await finalizeFetchState(root, startTs, FETCH_STATE_READY);
      root.setAttribute('data-dx-submit-mounted', 'true');
      return true;
    } catch (error) {
      root.innerHTML = '';
      const pane = create('section', 'dx-submit-main dx-submit-surface');
      pane.appendChild(create('h2', 'dx-submit-title', 'Submit page failed to load'));
      pane.appendChild(create('p', 'dx-submit-copy', text(error?.message, 'Unknown error')));
      root.appendChild(pane);
      await finalizeFetchState(root, startTs, FETCH_STATE_ERROR);
      return false;
    } finally {
      root.removeAttribute('data-dx-submit-booting');
    }
  }

  window.__dxSubmitSamplesMount = mount;

  document.addEventListener('dx:slotready', () => {
    mount().catch(() => {});
  });

  document.addEventListener('dex-auth:ready', () => {
    if (!state) return;
    hydrateAuthAndQuota({ forceLive: true }).catch(() => {});
  });

  window.addEventListener('dx:prefetch:update', (event) => {
    if (!state) return;
    const detail = event && typeof event.detail === 'object' ? event.detail : null;
    const key = text(detail?.key, '');
    if (!key || key !== getQuotaPrefetchKey(state.auth0Sub, state.flow)) return;
    const cached = readCachedQuota(state.auth0Sub, state.flow);
    if (!cached) return;
    if (applyQuotaPayload(cached)) {
      setQuotaSource('cache');
      refreshQuotaCopy();
    }
  });

  window.addEventListener('dx:profile:updated', (event) => {
    if (!state) return;
    const detail = event && typeof event.detail === 'object' ? event.detail : null;
    if (!detail) return;
    state.profileDefaults = normalizeSubmitProfileDefaults(detail);
    state.profileDefaultsLoaded = true;
    if (state.step === 1) {
      render();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        mount().catch(() => {});
      },
      { once: true },
    );
  } else {
    mount().catch(() => {});
  }
})();
