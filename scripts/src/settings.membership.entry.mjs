(() => {
  const DEFAULT_TIERS = {
    S: {
      name: 'Steward',
      impact: 'Keeps the commons online and open.',
      month: 6.99,
      year: 69.99,
      currency: 'USD',
    },
    M: {
      name: 'Archivist',
      impact: 'Funds artist sessions, storage, and preservation.',
      month: 14.99,
      year: 149.99,
      currency: 'USD',
    },
    L: {
      name: 'Producer',
      impact: 'Underwrites new commissions and release velocity.',
      month: 24.99,
      year: 249.99,
      currency: 'USD',
    },
  };

  const STATUS_ORDER = ['none', 'active', 'trialing', 'past_due', 'unpaid', 'canceled_at_period_end', 'canceled'];

  const ENDPOINTS = {
    plans: '/me/billing/plans',
    plansLegacy: '/prices',
    summary: '/me/billing/summary',
    summaryLegacy: '/me/subscription',
    checkout: '/me/billing/checkout-session',
    checkoutLegacy: '/stripe/create-checkout-session',
    portal: '/me/billing/portal-session',
    invoices: '/me/invoices?limit=12',
    pause: '/me/billing/subscription/pause',
    resume: '/me/billing/subscription/resume',
  };

  const ALLOWED_INTERVALS = new Set(['month', 'year']);
  const DESKTOP_RAIL_BREAKPOINT = 980;
  const RAIL_VIEWPORT_GUTTER = 18;
  const RAIL_MIN_HEIGHT = 280;

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function txt(value, fallback = '') {
    const out = String(value == null ? '' : value).trim();
    return out || fallback;
  }

  function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampStatus(status) {
    const normalized = txt(status).toLowerCase();
    return STATUS_ORDER.includes(normalized) ? normalized : 'none';
  }

  function money(amount, currency = 'USD') {
    const normalized = toNumber(amount, null);
    if (!Number.isFinite(normalized)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: txt(currency, 'USD').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(normalized);
  }

  function dateFromUnixSeconds(seconds) {
    const n = toNumber(seconds, null);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Date(n * 1000).toLocaleDateString();
  }

  function statusLabel(status) {
    const s = clampStatus(status);
    if (s === 'none') return 'No active plan';
    if (s === 'trialing') return 'Trialing';
    if (s === 'past_due') return 'Past due';
    if (s === 'unpaid') return 'Payment required';
    if (s === 'canceled_at_period_end') return 'Canceling at period end';
    if (s === 'canceled') return 'Canceled';
    return 'Active';
  }

  function normalizePlans(raw) {
    const fallback = {
      currency: 'USD',
      defaultTier: 'S',
      coverFeesEnabled: true,
      plans: Object.entries(DEFAULT_TIERS).map(([tier, meta]) => ({
        tier,
        name: meta.name,
        impact: meta.impact,
        month: { amount: meta.month, currency: meta.currency },
        year: { amount: meta.year, currency: meta.currency },
      })),
    };

    if (!raw || typeof raw !== 'object') return fallback;

    const plans = Array.isArray(raw.plans) ? raw.plans : null;
    if (plans && plans.length > 0) {
      const normalizedPlans = plans
        .map((plan) => {
          const tier = txt(plan && plan.tier).toUpperCase();
          if (!DEFAULT_TIERS[tier]) return null;
          return {
            tier,
            name: txt(plan && plan.name, DEFAULT_TIERS[tier].name),
            impact: txt(plan && (plan.impact || plan.description), DEFAULT_TIERS[tier].impact),
            month: {
              amount: toNumber(plan && plan.month && plan.month.amount, DEFAULT_TIERS[tier].month),
              currency: txt(plan && plan.month && plan.month.currency, txt(raw.currency, DEFAULT_TIERS[tier].currency)).toUpperCase(),
            },
            year: {
              amount: toNumber(plan && plan.year && plan.year.amount, DEFAULT_TIERS[tier].year),
              currency: txt(plan && plan.year && plan.year.currency, txt(raw.currency, DEFAULT_TIERS[tier].currency)).toUpperCase(),
            },
          };
        })
        .filter(Boolean);

      if (normalizedPlans.length > 0) {
        return {
          currency: txt(raw.currency, 'USD').toUpperCase(),
          defaultTier: txt(raw.defaultTier, 'S').toUpperCase(),
          coverFeesEnabled: raw.coverFeesEnabled !== false,
          plans: normalizedPlans,
        };
      }
    }

    if (raw.month && raw.year) {
      const fallbackPlans = Object.keys(DEFAULT_TIERS).map((tier) => ({
        tier,
        name: DEFAULT_TIERS[tier].name,
        impact: DEFAULT_TIERS[tier].impact,
        month: { amount: toNumber(raw.month[tier], DEFAULT_TIERS[tier].month), currency: 'USD' },
        year: { amount: toNumber(raw.year[tier], DEFAULT_TIERS[tier].year), currency: 'USD' },
      }));
      return {
        currency: 'USD',
        defaultTier: txt(raw.defaultTier, 'S').toUpperCase(),
        coverFeesEnabled: true,
        plans: fallbackPlans,
      };
    }

    return fallback;
  }

  function extractLast4(value) {
    const digits = txt(value).replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : '';
  }

  function normalizeSummary(raw) {
    const summary = raw && typeof raw === 'object' ? raw : {};
    const status = clampStatus(summary.status || summary.subscription_status || 'none');
    const tier = txt(summary.tier || summary.plan_tier).toUpperCase();
    const interval = txt(summary.interval || summary.plan_interval).toLowerCase();

    const defaultPaymentMethod =
      summary.default_payment_method
      || (summary.invoice_settings && summary.invoice_settings.default_payment_method)
      || (summary.customer && summary.customer.invoice_settings && summary.customer.invoice_settings.default_payment_method)
      || null;

    const explicitHasDefault = summary.has_default_payment_method;
    const explicitOnFile = summary.payment_method_on_file;
    const explicitHasPayment = summary.has_payment_method;

    const defaultLast4 = extractLast4(
      summary.default_payment_method_last4
      || summary.payment_method_last4
      || summary.payment_last4
      || summary.card_last4
      || (defaultPaymentMethod && defaultPaymentMethod.last4)
      || (defaultPaymentMethod && defaultPaymentMethod.card && defaultPaymentMethod.card.last4)
      || (summary.invoice_preview && summary.invoice_preview.default_payment_method_last4)
      || ''
    );

    let hasDefault = null;
    if (explicitHasDefault === true || explicitOnFile === true || explicitHasPayment === true) {
      hasDefault = true;
    } else if (explicitHasDefault === false || explicitOnFile === false || explicitHasPayment === false) {
      hasDefault = false;
    } else if (typeof defaultPaymentMethod === 'string' && txt(defaultPaymentMethod)) {
      hasDefault = true;
    } else if (defaultPaymentMethod && typeof defaultPaymentMethod === 'object') {
      hasDefault = true;
    }

    return {
      status,
      tier: DEFAULT_TIERS[tier] ? tier : null,
      interval: ALLOWED_INTERVALS.has(interval) ? interval : null,
      currentPeriodEnd: toNumber(summary.current_period_end || summary.renewTs || 0, null),
      cancelAtPeriodEnd: Boolean(summary.cancel_at_period_end || status === 'canceled_at_period_end'),
      customerPortalEnabled: summary.customer_portal_enabled !== false,
      hasDefaultPaymentMethod: hasDefault,
      defaultPaymentLast4: defaultLast4 || null,
    };
  }

  function normalizeInvoiceStatus(status) {
    const s = txt(status).toLowerCase();
    if (!s) return 'unknown';
    if (s === 'paid') return 'paid';
    if (s === 'open') return 'open';
    if (s === 'draft') return 'draft';
    if (s === 'void') return 'void';
    if (s === 'uncollectible') return 'uncollectible';
    return s;
  }

  function normalizeInvoices(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const rows = Array.isArray(src.data) ? src.data : Array.isArray(src.invoices) ? src.invoices : [];
    return rows.map((invoice, index) => {
      const created = toNumber(invoice && invoice.created, null);
      const amountPaidCents = toNumber(invoice && invoice.amount_paid, null);
      const amountDueCents = toNumber(invoice && invoice.amount_due, null);
      const currency = txt(invoice && invoice.currency, 'USD').toUpperCase();
      const amountCents = Number.isFinite(amountPaidCents)
        ? amountPaidCents
        : Number.isFinite(amountDueCents)
          ? amountDueCents
          : null;

      return {
        id: txt(invoice && invoice.id, `invoice-${index + 1}`),
        number: txt(invoice && invoice.number, '—'),
        created,
        status: normalizeInvoiceStatus(invoice && invoice.status),
        currency,
        amountCents,
        hostedInvoiceUrl: txt(invoice && (invoice.hosted_invoice_url || invoice.hostedInvoiceUrl), ''),
        invoicePdfUrl: txt(invoice && (invoice.invoice_pdf || invoice.invoicePdfUrl), ''),
      };
    });
  }

  function isCompatFallbackStatus(status) {
    return status === 404 || status === 405 || status === 501;
  }

  async function resolveAccessToken() {
    try {
      if (window.DEX_AUTH && typeof window.DEX_AUTH.getAccessToken === 'function') {
        return await window.DEX_AUTH.getAccessToken();
      }
    } catch {}

    try {
      if (window.dexAuth && typeof window.dexAuth.getAccessToken === 'function') {
        return await window.dexAuth.getAccessToken();
      }
    } catch {}

    try {
      if (window.auth0Client && typeof window.auth0Client.getTokenSilently === 'function') {
        return await window.auth0Client.getTokenSilently();
      }
    } catch {}

    return null;
  }

  async function apiFetch(apiBase, endpoint, options = {}) {
    const base = txt(apiBase || '/api', '/api').replace(/\/+$/, '');
    const url = `${base}${endpoint}`;
    const token = await resolveAccessToken();

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Math.max(500, Number(options.timeoutMs || 12000));
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const headers = Object.assign({}, options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (controller && controller.signal.aborted) {
        const err = new Error(`Request timed out after ${timeoutMs}ms`);
        err.status = 408;
        throw err;
      }
      throw error;
    }

    if (timeoutId) clearTimeout(timeoutId);

    const rawText = await response.text().catch(() => '');
    let payload = {};
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const err = new Error(rawText || response.statusText || `HTTP ${response.status}`);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  function hasCurrentMembershipStatus(status) {
    const s = clampStatus(status);
    return (
      s === 'active'
      || s === 'trialing'
      || s === 'canceled_at_period_end'
      || s === 'past_due'
      || s === 'unpaid'
    );
  }

  function hasPortalDirtyState(summary) {
    if (!summary || typeof summary !== 'object') return false;
    if (hasCurrentMembershipStatus(summary.status)) return false;
    if (summary.hasDefaultPaymentMethod === true) return true;
    return Boolean(txt(summary.defaultPaymentLast4));
  }

  function deriveMembershipCtaModel(summary, tiersOpen) {
    const normalizedSummary = summary && typeof summary === 'object'
      ? summary
      : normalizeSummary(null);

    const status = clampStatus(normalizedSummary.status);
    const hasCurrentMembership = hasCurrentMembershipStatus(status);
    const portalManageAvailable = normalizedSummary.customerPortalEnabled !== false;
    const portalDirty = hasPortalDirtyState(normalizedSummary);
    const pauseResume = pauseResumeLabel(normalizedSummary);
    const allowComposer = !hasCurrentMembership || (status !== 'past_due' && status !== 'unpaid');

    const model = {
      status,
      hasCurrentMembership,
      portalDirty,
      portalManageAvailable,
      supportHeadingVisible: !hasCurrentMembership,
      supportHeadingText: 'Want to support?',
      primary: { label: 'View membership', mode: 'view-membership', visible: true },
      secondary: {
        label: 'Manage billing',
        mode: 'portal-manage',
        visible: !hasCurrentMembership && portalDirty && portalManageAvailable,
      },
      pauseResume,
      allowComposer,
      showComposerCheckout: Boolean(allowComposer && tiersOpen),
      composerCheckoutLabel: hasCurrentMembership ? 'Continue to checkout' : 'Start membership',
      showCoverFees: Boolean(allowComposer && tiersOpen),
    };

    if (hasCurrentMembership) {
      model.supportHeadingVisible = false;
      model.secondary.visible = portalManageAvailable;
      model.secondary.label = 'Manage billing';
      if (status === 'past_due' || status === 'unpaid') {
        model.primary = { label: 'Fix payment method', mode: 'portal-payment', visible: true };
      } else if (tiersOpen && allowComposer) {
        model.primary = { label: 'Cancel', mode: 'cancel-composer', visible: true };
      } else {
        model.primary = { label: 'Change plan', mode: 'view-membership', visible: true };
      }
    } else if (tiersOpen && allowComposer) {
      model.primary = { label: 'Cancel', mode: 'cancel-composer', visible: true };
    }

    model.ctaMode = txt(model.primary.mode, 'view-membership');
    return model;
  }

  function pauseResumeLabel(summary) {
    if (!summary) return null;
    const s = clampStatus(summary.status);
    if (s === 'active' || s === 'trialing') {
      if (summary.cancelAtPeriodEnd) return { label: 'Resume membership', mode: 'resume' };
      return { label: 'Pause at period end', mode: 'pause' };
    }
    if (s === 'canceled_at_period_end') return { label: 'Resume membership', mode: 'resume' };
    return null;
  }

  function paymentLabel(summary) {
    if (!summary) return '—';
    if (summary.defaultPaymentLast4) return `•••• ${summary.defaultPaymentLast4}`;
    if (summary.hasDefaultPaymentMethod === true) return 'On file in Customer Portal';
    if (summary.hasDefaultPaymentMethod === false) return 'None on file';
    if (summary.customerPortalEnabled) return 'Managed in Customer Portal';
    return 'None on file';
  }

  function planNameForSummary(summary, plansByTier) {
    if (!summary || !summary.tier || !plansByTier.has(summary.tier)) return 'No active plan';
    const plan = plansByTier.get(summary.tier);
    const interval = summary.interval === 'year' ? 'Annual' : 'Monthly';
    return `${plan.name} (${interval})`;
  }

  function resolveTierModel(plansByTier, tier) {
    const normalized = txt(tier).toUpperCase();
    if (plansByTier.has(normalized)) return plansByTier.get(normalized);
    return plansByTier.get('S') || plansByTier.values().next().value || null;
  }

  function normalizeTierValue(tier, fallback = 'S') {
    const normalized = txt(tier, fallback).toUpperCase();
    if (DEFAULT_TIERS[normalized]) return normalized;
    const fallbackNormalized = txt(fallback, '').toUpperCase();
    if (fallbackNormalized && DEFAULT_TIERS[fallbackNormalized]) return fallbackNormalized;
    return '';
  }

  function normalizeIntervalValue(interval, fallback = 'month') {
    const normalized = txt(interval, fallback).toLowerCase();
    if (ALLOWED_INTERVALS.has(normalized)) return normalized;
    const fallbackNormalized = txt(fallback, '').toLowerCase();
    if (ALLOWED_INTERVALS.has(fallbackNormalized)) return fallbackNormalized;
    return '';
  }

  function annualSavings(plan) {
    if (!plan) return { amount: 0, percent: 0 };
    const month = toNumber(plan.month && plan.month.amount, 0);
    const year = toNumber(plan.year && plan.year.amount, 0);
    if (!Number.isFinite(month) || !Number.isFinite(year) || month <= 0 || year <= 0) {
      return { amount: 0, percent: 0 };
    }
    const monthlyYear = month * 12;
    const savingsAmount = Math.max(0, monthlyYear - year);
    const percent = monthlyYear > 0 ? Math.round((savingsAmount / monthlyYear) * 100) : 0;
    return { amount: savingsAmount, percent };
  }

  function skeletonLedgerRows(count = 4) {
    let html = '';
    for (let i = 0; i < count; i += 1) {
      html += '<tr>'
        + '<td><span class="dx-memv3-skel" style="width:92px"></span></td>'
        + '<td><span class="dx-memv3-skel" style="width:110px"></span></td>'
        + '<td><span class="dx-memv3-skel" style="width:74px"></span></td>'
        + '<td><span class="dx-memv3-skel" style="width:80px"></span></td>'
        + '<td><span class="dx-memv3-skel" style="width:72px"></span></td>'
        + '</tr>';
    }
    return html;
  }

  class MembershipV3Controller {
    constructor(root, options = {}) {
      this.root = root;
      this.apiBase = txt(options.apiBase || '/api', '/api');
      this.returnPath = txt(options.returnPath || '/entry/settings#membership', '/entry/settings#membership');
      this.successPath = txt(options.successPath || '/entry/settings?thanks=1#membership', '/entry/settings?thanks=1#membership');
      this.interval = 'month';
      this.selectedTier = 'S';
      this.plans = normalizePlans(null);
      this.summary = normalizeSummary(null);
      this.invoices = [];
      this.invoiceState = 'loading';
      this.error = '';
      this.busy = false;
      this.tiersOpen = false;
      this.composerBaselineTier = 'S';
      this.composerBaselineInterval = 'month';
      this.composerBaselineCoverFees = false;
      this.hasComposerBaseline = false;
      this.mounted = false;
      this.cache = {};
      this.railSyncRaf = 0;
      this.viewSwapTimer = 0;
      this.resizeObserver = null;
      this.paneObserver = null;
      this.onViewportChange = this.queueRailSync.bind(this);
    }

    render() {
      this.root.innerHTML = ''
        + '<article class="card dx-memv3-card" id="dxMembershipV3Card" data-dx-fetch-state="loading" aria-busy="true">'
        + '  <header class="dx-memv3-header">'
        + '    <div>'
        + '      <h2>Membership &amp; billing</h2>'
        + '      <p class="note">Support Dex with a membership and keep the CC-BY archive open for everyone.</p>'
        + '    </div>'
        + '    <span class="dx-memv3-state-chip" id="dxMemV3StateChip">Loading…</span>'
        + '  </header>'
        + '  <div id="dxMemV3ViewSurface" class="dx-memv3-view-surface" data-dx-membership-view="summary">'
        + '    <section id="dxMemV3SummaryView" class="dx-memv3-view dx-memv3-view--summary">'
        + '      <section class="dx-memv3-status-grid">'
        + '        <div class="dx-memv3-status" aria-live="polite">'
        + '          <div class="dx-memv3-status-row"><span>Plan</span><strong id="dxMemV3Plan">Loading…</strong></div>'
        + '          <div class="dx-memv3-status-row"><span>Renews</span><strong id="dxMemV3Renew">—</strong></div>'
        + '          <div class="dx-memv3-status-row"><span>Payment method</span><strong id="dxMemV3Pay">—</strong></div>'
        + '          <div class="dx-memv3-status-row"><span>Cancellation</span><strong id="dxMemV3Cancel">None scheduled</strong></div>'
        + '        </div>'
        + '      </section>'
        + '      <section class="dx-memv3-plan-panel" data-dx-tier-panel>'
        + '        <h3 id="dxMemV3SupportHeading" class="dx-memv3-support-heading" hidden>Want to support?</h3>'
        + '        <div class="dx-memv3-actions">'
        + '          <button type="button" id="dxMemV3Primary" class="cta" data-dx-billing-cta-primary>View membership</button>'
        + '          <button type="button" id="dxMemV3Secondary" class="cta-primary" hidden>Manage billing</button>'
        + '          <button type="button" id="dxMemV3PauseResume" class="btn" hidden></button>'
        + '        </div>'
        + '      </section>'
        + '    </section>'
        + '    <section id="dxMemV3ComposerView" class="dx-memv3-view dx-memv3-view--composer" hidden aria-hidden="true">'
        + '      <section class="dx-memv3-plan-panel dx-memv3-plan-panel--composer">'
        + '        <div class="dx-memv3-back-row">'
        + '          <button type="button" id="dxMemV3Back" class="btn dx-memv3-back" aria-label="Back to membership overview">'
        + '            <span aria-hidden="true" class="dx-memv3-back-icon">←</span>'
        + '            <span>Back</span>'
        + '          </button>'
        + '        </div>'
        + '        <div id="dxMemV3TierComposer" class="dx-memv3-tier-composer" data-open="false" hidden>'
        + '          <header class="dx-memv3-plan-head">'
        + '            <h3>Choose your support tier</h3>'
        + '            <div class="dx-memv3-interval-shell">'
        + '              <div class="dx-memv3-interval" role="radiogroup" aria-label="Billing interval">'
        + '                <span class="dx-memv3-interval-thumb" aria-hidden="true"></span>'
        + '                <button type="button" data-interval="month" data-interval-index="0" aria-pressed="true">Monthly</button>'
        + '                <button type="button" data-interval="year" data-interval-index="1" aria-pressed="false">Annual</button>'
        + '              </div>'
        + '              <p id="dxMemV3AnnualHint" class="dx-memv3-annual-hint">Switch to annual for lower effective pricing.</p>'
        + '            </div>'
        + '          </header>'
        + '          <div class="dx-memv3-tier-grid" id="dxMemV3TierGrid"></div>'
        + '          <div class="dx-memv3-plan-summary">'
        + '            <p id="dxMemV3Selection" class="dx-memv3-selection">Selected: Steward · Monthly · $6.99</p>'
        + '            <label id="dxMemV3CoverWrap" class="dx-memv3-cover">'
        + '              <input id="dxMemV3Cover" type="checkbox" />'
        + '              <span>Cover fees (+2.9% + $0.30)</span>'
        + '            </label>'
        + '            <button type="button" id="dxMemV3ComposerCheckout" class="cta dx-memv3-composer-checkout">Start membership</button>'
        + '            <p class="note">Change interval, switch tiers, or cancel at period end anytime in Customer Portal.</p>'
        + '          </div>'
        + '        </div>'
        + '      </section>'
        + '    </section>'
        + '  </div>'
        + '  <p id="dxMemV3Error" class="dx-memv3-error" hidden></p>'
        + '</article>'
        + '<article class="card dx-memv3-card" id="dxBillingHistoryV3Card" data-dx-fetch-state="loading" aria-busy="true">'
        + '  <header class="dx-memv3-ledger-head">'
        + '    <h2>Billing history</h2>'
        + '    <p class="note">Recent invoices and receipts for this account.</p>'
        + '  </header>'
        + '  <div class="dx-memv3-ledger-wrap" data-dx-billing-ledger>'
        + '    <table class="dx-memv3-ledger">'
        + '      <thead>'
        + '        <tr><th>Date</th><th>Invoice</th><th>Status</th><th>Amount</th><th>Receipt</th></tr>'
        + '      </thead>'
        + '      <tbody id="dxMemV3LedgerBody">'
        +          skeletonLedgerRows(4)
        + '      </tbody>'
        + '    </table>'
        + '  </div>'
        + '  <p id="dxMemV3LedgerEmpty" class="dx-memv3-ledger-empty" hidden>No invoices yet.</p>'
        + '  <p id="dxMemV3LedgerError" class="dx-memv3-ledger-error" hidden>Invoices unavailable right now.</p>'
        + '  <div class="dx-memv3-ledger-actions">'
        + '    <button type="button" id="dxMemV3RefreshInvoices" class="btn" hidden>Retry</button>'
        + '    <button type="button" id="dxMemV3PortalHistory" class="btn">View all invoices in Customer Portal</button>'
        + '  </div>'
        + '</article>';

      this.cache = {
        membershipCard: $('#dxMembershipV3Card', this.root),
        billingCard: $('#dxBillingHistoryV3Card', this.root),
        viewSurface: $('#dxMemV3ViewSurface', this.root),
        summaryView: $('#dxMemV3SummaryView', this.root),
        composerView: $('#dxMemV3ComposerView', this.root),
        backBtn: $('#dxMemV3Back', this.root),
        stateChip: $('#dxMemV3StateChip', this.root),
        planEl: $('#dxMemV3Plan', this.root),
        renewEl: $('#dxMemV3Renew', this.root),
        payEl: $('#dxMemV3Pay', this.root),
        cancelEl: $('#dxMemV3Cancel', this.root),
        supportHeading: $('#dxMemV3SupportHeading', this.root),
        tierComposer: $('#dxMemV3TierComposer', this.root),
        annualHint: $('#dxMemV3AnnualHint', this.root),
        intervalButtons: $$('[data-interval]', this.root),
        tierGrid: $('#dxMemV3TierGrid', this.root),
        selection: $('#dxMemV3Selection', this.root),
        coverWrap: $('#dxMemV3CoverWrap', this.root),
        coverInput: $('#dxMemV3Cover', this.root),
        composerCheckoutBtn: $('#dxMemV3ComposerCheckout', this.root),
        primaryCta: $('#dxMemV3Primary', this.root),
        secondaryCta: $('#dxMemV3Secondary', this.root),
        pauseResumeBtn: $('#dxMemV3PauseResume', this.root),
        errorLine: $('#dxMemV3Error', this.root),
        ledgerBody: $('#dxMemV3LedgerBody', this.root),
        ledgerEmpty: $('#dxMemV3LedgerEmpty', this.root),
        ledgerError: $('#dxMemV3LedgerError', this.root),
        ledgerRetry: $('#dxMemV3RefreshInvoices', this.root),
        portalHistoryBtn: $('#dxMemV3PortalHistory', this.root),
      };

      this.root.setAttribute('data-dx-membership-rail', 'true');
      this.root.setAttribute('data-dx-membership-rail-scrollable', 'false');
      this.root.setAttribute('data-dx-membership-state', 'loading');
      this.root.setAttribute('data-dx-membership-cta-mode', 'view-membership');
      this.root.setAttribute('data-dx-interval', this.interval);
      this.root.setAttribute('data-dx-membership-view', 'summary');
      this.root.setAttribute('data-dx-tier-panel-open', this.tiersOpen ? 'true' : 'false');
      this.bindEvents();
      this.bindViewportObservers();
      this.renderTierCards();
      this.setTierComposerOpen(this.tiersOpen, { animate: false });
      this.renderSelection();
      this.queueRailSync();
    }

    setTierComposerOpen(nextOpen, options = {}) {
      this.tiersOpen = Boolean(nextOpen);
      if (this.cache.tierComposer instanceof HTMLElement) {
        this.cache.tierComposer.dataset.open = this.tiersOpen ? 'true' : 'false';
        this.cache.tierComposer.hidden = !this.tiersOpen;
        this.cache.tierComposer.setAttribute('aria-hidden', this.tiersOpen ? 'false' : 'true');
      }
      this.root.setAttribute('data-dx-tier-panel-open', this.tiersOpen ? 'true' : 'false');
      this.setMembershipView(this.tiersOpen ? 'composer' : 'summary', options);
      this.queueRailSync();
    }

    shouldReduceMotion() {
      if (typeof window.matchMedia !== 'function') return false;
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    }

    applyMembershipView(nextView) {
      const view = nextView === 'composer' ? 'composer' : 'summary';
      const summaryVisible = view !== 'composer';

      if (this.cache.summaryView instanceof HTMLElement) {
        this.cache.summaryView.hidden = !summaryVisible;
        this.cache.summaryView.setAttribute('aria-hidden', summaryVisible ? 'false' : 'true');
      }
      if (this.cache.composerView instanceof HTMLElement) {
        this.cache.composerView.hidden = summaryVisible;
        this.cache.composerView.setAttribute('aria-hidden', summaryVisible ? 'true' : 'false');
      }

      if (this.cache.viewSurface instanceof HTMLElement) {
        this.cache.viewSurface.setAttribute('data-dx-membership-view', view);
      }
      this.root.setAttribute('data-dx-membership-view', view);
    }

    setMembershipView(nextView, options = {}) {
      const view = nextView === 'composer' ? 'composer' : 'summary';
      const animate = options.animate !== false;
      const card = this.cache.membershipCard;
      const shouldAnimate = (
        animate
        && card instanceof HTMLElement
        && this.cache.viewSurface instanceof HTMLElement
        && !this.shouldReduceMotion()
      );

      if (this.viewSwapTimer) {
        clearTimeout(this.viewSwapTimer);
        this.viewSwapTimer = 0;
      }
      if (card instanceof HTMLElement) {
        card.classList.remove('dx-memv3-card--view-swapping');
      }

      if (!shouldAnimate) {
        this.applyMembershipView(view);
        return;
      }

      card.classList.add('dx-memv3-card--view-swapping');
      this.viewSwapTimer = window.setTimeout(() => {
        this.applyMembershipView(view);
        this.queueRailSync();
        requestAnimationFrame(() => {
          if (card instanceof HTMLElement) {
            card.classList.remove('dx-memv3-card--view-swapping');
          }
          this.queueRailSync();
        });
        this.viewSwapTimer = 0;
      }, 150);
    }

    readCoverFeesSelection() {
      if (!(this.cache.coverInput instanceof HTMLInputElement)) return false;
      return Boolean(this.cache.coverInput.checked);
    }

    writeCoverFeesSelection(nextValue) {
      if (!(this.cache.coverInput instanceof HTMLInputElement)) return;
      this.cache.coverInput.checked = Boolean(nextValue);
    }

    captureComposerBaseline() {
      this.composerBaselineTier = normalizeTierValue(this.selectedTier, 'S');
      this.composerBaselineInterval = normalizeIntervalValue(this.interval, 'month');
      this.composerBaselineCoverFees = this.readCoverFeesSelection();
      this.hasComposerBaseline = true;
    }

    syncComposerBaselineFromSummary() {
      const hasCurrentMembership = hasCurrentMembershipStatus(this.summary && this.summary.status);
      const summaryTier = hasCurrentMembership
        ? normalizeTierValue(this.summary && this.summary.tier, this.selectedTier)
        : normalizeTierValue(this.selectedTier, 'S');
      const summaryInterval = hasCurrentMembership
        ? normalizeIntervalValue(this.summary && this.summary.interval, this.interval)
        : normalizeIntervalValue(this.interval, 'month');

      this.composerBaselineTier = summaryTier;
      this.composerBaselineInterval = summaryInterval;
      this.composerBaselineCoverFees = this.readCoverFeesSelection();
      this.hasComposerBaseline = true;
    }

    restoreComposerFromBaseline() {
      if (!this.hasComposerBaseline) {
        this.captureComposerBaseline();
      }
      this.selectedTier = normalizeTierValue(this.composerBaselineTier, this.selectedTier || 'S');
      this.interval = normalizeIntervalValue(this.composerBaselineInterval, this.interval || 'month');
      this.writeCoverFeesSelection(this.composerBaselineCoverFees);
      this.updateTierVisuals();
      this.renderSelection();
    }

    setCardReady(card) {
      if (!(card instanceof HTMLElement)) return;
      card.setAttribute('data-dx-fetch-state', 'ready');
      card.removeAttribute('aria-busy');
    }

    setError(message) {
      this.error = txt(message);
      if (!(this.cache.errorLine instanceof HTMLElement)) return;
      const hasMessage = Boolean(this.error);
      this.cache.errorLine.hidden = !hasMessage;
      this.cache.errorLine.textContent = hasMessage ? this.error : '';
    }

    setBusy(nextBusy) {
      this.busy = Boolean(nextBusy);
      const controls = [
        this.cache.composerCheckoutBtn,
        this.cache.primaryCta,
        this.cache.secondaryCta,
        this.cache.pauseResumeBtn,
        this.cache.backBtn,
        this.cache.portalHistoryBtn,
        this.cache.ledgerRetry,
      ];
      controls.forEach((control) => {
        if (!(control instanceof HTMLButtonElement)) return;
        control.disabled = this.busy;
        control.setAttribute('data-billing-busy', this.busy ? 'true' : 'false');
      });
    }

    renderTierCards() {
      if (!(this.cache.tierGrid instanceof HTMLElement)) return;
      const plansByTier = new Map(this.plans.plans.map((plan) => [plan.tier, plan]));
      const cards = [];
      for (const tier of ['S', 'M', 'L']) {
        const plan = resolveTierModel(plansByTier, tier);
        if (!plan) continue;
        const monthAmount = money(plan.month.amount, plan.month.currency);
        const yearAmount = money(plan.year.amount, plan.year.currency);
        const savings = annualSavings(plan);
        const savingsCopy = savings.amount > 0
          ? `Save ${money(savings.amount, plan.year.currency)} / year${savings.percent > 0 ? ` (${savings.percent}%)` : ''}`
          : 'Best for sustained support';

        cards.push(
          '<button type="button" class="dx-memv3-tier"'
            + ` data-dx-tier="${tier}"`
            + ` data-tier="${tier}"`
            + ` aria-pressed="${String(this.selectedTier === tier)}"`
            + ` data-savings-percent="${String(savings.percent)}"`
            + ` data-savings-amount="${String(savings.amount)}"`
          + '>'
          + '  <span class="dx-memv3-tier-kicker">Support tier</span>'
          + `  <span class="dx-memv3-tier-name">${plan.name}</span>`
          + '  <span class="dx-memv3-tier-price-wrap">'
          + `    <span class="dx-memv3-tier-price" data-price-month="${String(plan.month.amount)}" data-price-year="${String(plan.year.amount)}" data-currency="${txt(plan.month.currency, 'USD')}">${monthAmount}</span>`
          + '    <span class="dx-memv3-tier-period">/ month</span>'
          + '  </span>'
          + `  <span class="dx-memv3-tier-impact">${plan.impact}</span>`
          + `  <span class="dx-memv3-tier-savings">${savingsCopy}</span>`
          + '</button>'
        );
      }

      this.cache.tierGrid.innerHTML = cards.join('');
    }

    updateTierVisuals() {
      const cards = $$('.dx-memv3-tier', this.root);
      cards.forEach((card) => {
        const tier = txt(card.getAttribute('data-tier')).toUpperCase();
        card.setAttribute('aria-pressed', String(tier === this.selectedTier));
      });

      cards.forEach((card) => {
        const price = $('.dx-memv3-tier-price', card);
        const period = $('.dx-memv3-tier-period', card);
        const priceMonth = toNumber(price && price.getAttribute('data-price-month'), null);
        const priceYear = toNumber(price && price.getAttribute('data-price-year'), null);
        const currency = txt(price && price.getAttribute('data-currency'), this.plans.currency || 'USD').toUpperCase();
        const amount = this.interval === 'year' ? priceYear : priceMonth;
        if (price instanceof HTMLElement) {
          price.textContent = money(amount, currency);
        }
        if (period instanceof HTMLElement) {
          period.textContent = this.interval === 'year' ? '/ year' : '/ month';
        }
      });

      this.root.setAttribute('data-dx-interval', this.interval);
      this.renderAnnualHint();
      this.queueRailSync();
    }

    renderAnnualHint() {
      if (!(this.cache.annualHint instanceof HTMLElement)) return;
      const plans = Array.isArray(this.plans && this.plans.plans) ? this.plans.plans : [];
      let bestPercent = 0;
      let bestAmount = 0;
      let bestCurrency = txt(this.plans && this.plans.currency, 'USD');

      plans.forEach((plan) => {
        const savings = annualSavings(plan);
        if (savings.percent > bestPercent || (savings.percent === bestPercent && savings.amount > bestAmount)) {
          bestPercent = savings.percent;
          bestAmount = savings.amount;
          bestCurrency = txt(plan && plan.year && plan.year.currency, bestCurrency).toUpperCase();
        }
      });

      if (bestPercent > 0 && bestAmount > 0) {
        if (this.interval === 'year') {
          this.cache.annualHint.textContent = `Annual savings applied: up to ${bestPercent}% (${money(bestAmount, bestCurrency)} / year).`;
        } else {
          this.cache.annualHint.textContent = `Switch to annual and save up to ${bestPercent}% (${money(bestAmount, bestCurrency)} / year).`;
        }
        return;
      }

      this.cache.annualHint.textContent = this.interval === 'year'
        ? 'Annual billing selected for sustained support.'
        : 'Annual billing rewards sustained support.';
    }

    renderSelection() {
      const plansByTier = new Map(this.plans.plans.map((plan) => [plan.tier, plan]));
      const selectedPlan = resolveTierModel(plansByTier, this.selectedTier);
      if (!(this.cache.selection instanceof HTMLElement) || !selectedPlan) return;

      const amount = this.interval === 'year' ? selectedPlan.year.amount : selectedPlan.month.amount;
      const currency = this.interval === 'year' ? selectedPlan.year.currency : selectedPlan.month.currency;
      const intervalLabel = this.interval === 'year' ? 'Annual' : 'Monthly';
      this.cache.selection.textContent = `Selected: ${selectedPlan.name} · ${intervalLabel} · ${money(amount, currency)}`;
      this.renderAnnualHint();
      this.queueRailSync();
    }

    renderSummary() {
      const plansByTier = new Map(this.plans.plans.map((plan) => [plan.tier, plan]));
      const ctaModel = deriveMembershipCtaModel(this.summary, this.tiersOpen);
      const status = ctaModel.status;
      const pauseResume = ctaModel.pauseResume;

      this.root.setAttribute('data-dx-membership-state', status);
      this.root.setAttribute('data-dx-membership-cta-mode', txt(ctaModel.ctaMode, 'view-membership'));

      if (this.cache.stateChip instanceof HTMLElement) {
        this.cache.stateChip.textContent = statusLabel(status);
      }
      if (this.cache.planEl instanceof HTMLElement) {
        this.cache.planEl.textContent = planNameForSummary(this.summary, plansByTier);
      }
      if (this.cache.renewEl instanceof HTMLElement) {
        this.cache.renewEl.textContent = dateFromUnixSeconds(this.summary.currentPeriodEnd);
      }
      if (this.cache.payEl instanceof HTMLElement) {
        this.cache.payEl.textContent = paymentLabel(this.summary);
      }
      if (this.cache.cancelEl instanceof HTMLElement) {
        this.cache.cancelEl.textContent = this.summary.cancelAtPeriodEnd
          ? `Ends ${dateFromUnixSeconds(this.summary.currentPeriodEnd)}`
          : 'None scheduled';
      }

      if (this.cache.supportHeading instanceof HTMLElement) {
        this.cache.supportHeading.hidden = !ctaModel.supportHeadingVisible;
        this.cache.supportHeading.textContent = ctaModel.supportHeadingText;
      }

      if (this.cache.primaryCta instanceof HTMLButtonElement) {
        this.cache.primaryCta.hidden = ctaModel.primary.visible === false;
        this.cache.primaryCta.textContent = ctaModel.primary.label;
        this.cache.primaryCta.dataset.action = ctaModel.primary.mode;
      }

      if (this.cache.secondaryCta instanceof HTMLButtonElement) {
        this.cache.secondaryCta.hidden = !ctaModel.secondary.visible;
        this.cache.secondaryCta.textContent = ctaModel.secondary.label;
        this.cache.secondaryCta.dataset.action = ctaModel.secondary.mode;
      }

      if (!ctaModel.allowComposer && this.tiersOpen) {
        this.setTierComposerOpen(false);
      }

      if (this.cache.composerCheckoutBtn instanceof HTMLButtonElement) {
        this.cache.composerCheckoutBtn.hidden = !ctaModel.showComposerCheckout;
        this.cache.composerCheckoutBtn.textContent = ctaModel.composerCheckoutLabel;
      }

      if (this.cache.coverWrap instanceof HTMLElement) {
        this.cache.coverWrap.hidden = !ctaModel.showCoverFees || this.plans.coverFeesEnabled === false;
      }

      if (this.cache.pauseResumeBtn instanceof HTMLButtonElement) {
        if (!pauseResume) {
          this.cache.pauseResumeBtn.hidden = true;
          this.cache.pauseResumeBtn.dataset.action = '';
        } else {
          this.cache.pauseResumeBtn.hidden = false;
          this.cache.pauseResumeBtn.textContent = pauseResume.label;
          this.cache.pauseResumeBtn.dataset.action = pauseResume.mode;
        }
      }

      this.updateTierVisuals();
      this.renderSelection();
      this.setCardReady(this.cache.membershipCard);
      this.queueRailSync();
    }

    renderInvoices() {
      const body = this.cache.ledgerBody;
      if (!(body instanceof HTMLElement)) return;

      if (this.invoiceState === 'loading') {
        body.innerHTML = skeletonLedgerRows(4);
        if (this.cache.ledgerEmpty instanceof HTMLElement) this.cache.ledgerEmpty.hidden = true;
        if (this.cache.ledgerError instanceof HTMLElement) this.cache.ledgerError.hidden = true;
        if (this.cache.ledgerRetry instanceof HTMLButtonElement) this.cache.ledgerRetry.hidden = true;
        return;
      }

      if (this.invoiceState === 'error') {
        body.innerHTML = '';
        if (this.cache.ledgerEmpty instanceof HTMLElement) this.cache.ledgerEmpty.hidden = true;
        if (this.cache.ledgerError instanceof HTMLElement) this.cache.ledgerError.hidden = false;
        if (this.cache.ledgerRetry instanceof HTMLButtonElement) this.cache.ledgerRetry.hidden = false;
        this.setCardReady(this.cache.billingCard);
        this.queueRailSync();
        return;
      }

      if (!this.invoices.length) {
        body.innerHTML = '';
        if (this.cache.ledgerEmpty instanceof HTMLElement) this.cache.ledgerEmpty.hidden = false;
        if (this.cache.ledgerError instanceof HTMLElement) this.cache.ledgerError.hidden = true;
        if (this.cache.ledgerRetry instanceof HTMLButtonElement) this.cache.ledgerRetry.hidden = true;
        this.setCardReady(this.cache.billingCard);
        this.queueRailSync();
        return;
      }

      body.innerHTML = this.invoices.map((invoice) => {
        const dateLabel = dateFromUnixSeconds(invoice.created);
        const status = normalizeInvoiceStatus(invoice.status);
        const amount = Number.isFinite(invoice.amountCents)
          ? money(invoice.amountCents / 100, invoice.currency)
          : '—';
        const receiptLinks = [];
        if (invoice.hostedInvoiceUrl) {
          receiptLinks.push(`<a href="${invoice.hostedInvoiceUrl}" target="_blank" rel="noopener noreferrer">View</a>`);
        }
        if (invoice.invoicePdfUrl) {
          receiptLinks.push(`<a href="${invoice.invoicePdfUrl}" target="_blank" rel="noopener noreferrer">PDF</a>`);
        }
        const receiptCell = receiptLinks.length ? receiptLinks.join('<span aria-hidden="true"> · </span>') : '—';

        return ''
          + '<tr>'
          + `  <td>${dateLabel}</td>`
          + `  <td>${txt(invoice.number, invoice.id)}</td>`
          + `  <td><span class="dx-memv3-ledger-status" data-dx-billing-row-status="${status}">${status.replace(/_/g, ' ')}</span></td>`
          + `  <td>${amount}</td>`
          + `  <td>${receiptCell}</td>`
          + '</tr>';
      }).join('');

      if (this.cache.ledgerEmpty instanceof HTMLElement) this.cache.ledgerEmpty.hidden = true;
      if (this.cache.ledgerError instanceof HTMLElement) this.cache.ledgerError.hidden = true;
      if (this.cache.ledgerRetry instanceof HTMLButtonElement) this.cache.ledgerRetry.hidden = true;
      this.setCardReady(this.cache.billingCard);
      this.queueRailSync();
    }

    syncRailViewportFit() {
      if (!(this.root instanceof HTMLElement)) return;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      if (viewportWidth < DESKTOP_RAIL_BREAKPOINT) {
        this.root.style.removeProperty('--dx-membership-rail-max-h');
        this.root.style.removeProperty('max-height');
        this.root.style.removeProperty('overflow-y');
        this.root.style.removeProperty('overflow-x');
        this.root.style.removeProperty('overscroll-behavior-y');
        this.root.setAttribute('data-dx-membership-rail-scrollable', 'false');
        return;
      }

      const rect = this.root.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const availableHeight = Math.max(RAIL_MIN_HEIGHT, Math.floor(viewportHeight - rect.top - RAIL_VIEWPORT_GUTTER));
      const shouldScroll = this.root.scrollHeight > availableHeight + 1;

      this.root.style.setProperty('--dx-membership-rail-max-h', `${availableHeight}px`);
      this.root.style.maxHeight = `${availableHeight}px`;
      this.root.style.overflowX = 'hidden';
      this.root.style.overflowY = shouldScroll ? 'auto' : 'visible';
      this.root.style.overscrollBehaviorY = shouldScroll ? 'contain' : 'auto';
      this.root.setAttribute('data-dx-membership-rail-scrollable', shouldScroll ? 'true' : 'false');
    }

    queueRailSync() {
      if (this.railSyncRaf) cancelAnimationFrame(this.railSyncRaf);
      this.railSyncRaf = requestAnimationFrame(() => {
        this.railSyncRaf = 0;
        this.syncRailViewportFit();
      });
    }

    bindViewportObservers() {
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      window.addEventListener('orientationchange', this.onViewportChange, { passive: true });
      document.addEventListener('visibilitychange', this.onViewportChange, { passive: true });
      window.addEventListener('hashchange', this.onViewportChange, { passive: true });

      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => this.queueRailSync());
        this.resizeObserver.observe(this.root);
        if (this.cache.membershipCard instanceof HTMLElement) this.resizeObserver.observe(this.cache.membershipCard);
        if (this.cache.billingCard instanceof HTMLElement) this.resizeObserver.observe(this.cache.billingCard);
      }

      const pane = this.root.closest('#pane-membership');
      if (pane && typeof MutationObserver === 'function') {
        this.paneObserver = new MutationObserver(() => this.queueRailSync());
        this.paneObserver.observe(pane, {
          attributes: true,
          attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'],
        });
      }
    }

    bindEvents() {
      this.cache.intervalButtons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.addEventListener('click', () => {
          const interval = txt(button.getAttribute('data-interval')).toLowerCase();
          if (!ALLOWED_INTERVALS.has(interval)) return;
          this.interval = interval;
          this.cache.intervalButtons.forEach((btn) => {
            if (!(btn instanceof HTMLButtonElement)) return;
            const isActive = txt(btn.getAttribute('data-interval')).toLowerCase() === this.interval;
            btn.setAttribute('aria-pressed', String(isActive));
          });
          this.updateTierVisuals();
          this.renderSelection();
        });
      });

      this.root.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const tierButton = target.closest('[data-tier]');
        if (!(tierButton instanceof HTMLButtonElement)) return;
        const tier = txt(tierButton.getAttribute('data-tier')).toUpperCase();
        if (!DEFAULT_TIERS[tier]) return;
        this.selectedTier = tier;
        this.updateTierVisuals();
        this.renderSelection();
      });

      if (this.cache.primaryCta instanceof HTMLButtonElement) {
        this.cache.primaryCta.addEventListener('click', async () => {
          if (this.busy) return;
          await this.handlePrimaryAction();
        });
      }

      if (this.cache.backBtn instanceof HTMLButtonElement) {
        this.cache.backBtn.addEventListener('click', () => {
          if (this.busy) return;
          this.restoreComposerFromBaseline();
          this.setTierComposerOpen(false);
          this.renderSummary();
          this.setError('');
        });
      }

      if (this.cache.composerCheckoutBtn instanceof HTMLButtonElement) {
        this.cache.composerCheckoutBtn.addEventListener('click', async () => {
          if (this.busy) return;
          await this.startCheckout();
        });
      }

      if (this.cache.secondaryCta instanceof HTMLButtonElement) {
        this.cache.secondaryCta.addEventListener('click', async () => {
          if (this.busy) return;
          await this.handlePortalFlow(this.cache.secondaryCta.dataset.action || 'portal-manage');
        });
      }

      if (this.cache.pauseResumeBtn instanceof HTMLButtonElement) {
        this.cache.pauseResumeBtn.addEventListener('click', async () => {
          if (this.busy) return;
          const action = txt(this.cache.pauseResumeBtn.dataset.action);
          if (!action) return;
          await this.handlePauseResume(action);
        });
      }

      if (this.cache.portalHistoryBtn instanceof HTMLButtonElement) {
        this.cache.portalHistoryBtn.addEventListener('click', async () => {
          if (this.busy) return;
          await this.handlePortalFlow('invoice_history');
        });
      }

      if (this.cache.ledgerRetry instanceof HTMLButtonElement) {
        this.cache.ledgerRetry.addEventListener('click', async () => {
          if (this.busy) return;
          await this.loadInvoices();
        });
      }
    }

    async handlePrimaryAction() {
      const mode = txt(this.cache.primaryCta && this.cache.primaryCta.dataset.action);
      if (!mode) return;

      if (mode === 'view-membership') {
        this.captureComposerBaseline();
        if (!this.tiersOpen) {
          this.setTierComposerOpen(true);
        }
        this.renderSummary();
        return;
      }

      if (mode === 'cancel-composer') {
        this.restoreComposerFromBaseline();
        this.setTierComposerOpen(false);
        this.renderSummary();
        this.setError('');
        return;
      }

      if (mode === 'portal-payment') {
        await this.handlePortalFlow('payment_method_update');
        return;
      }

      await this.startCheckout();
    }

    isSamePlanSelectionAsCurrentMembership() {
      if (!hasCurrentMembershipStatus(this.summary && this.summary.status)) return false;
      const currentTier = normalizeTierValue(this.summary && this.summary.tier, '');
      const currentInterval = normalizeIntervalValue(this.summary && this.summary.interval, '');
      const selectedTier = normalizeTierValue(this.selectedTier, '');
      const selectedInterval = normalizeIntervalValue(this.interval, '');
      if (!currentTier || !currentInterval || !selectedTier || !selectedInterval) return false;
      return currentTier === selectedTier && currentInterval === selectedInterval;
    }

    async startCheckout() {
      this.setError('');

      if (this.isSamePlanSelectionAsCurrentMembership()) {
        this.setError('Select a different tier or billing interval to change your plan.');
        return;
      }

      this.setBusy(true);

      const payload = {
        tier: this.selectedTier,
        interval: this.interval,
        coverFees: this.readCoverFeesSelection(),
        returnPath: this.returnPath,
        successUrl: new URL(this.successPath, window.location.origin).toString(),
        cancelUrl: new URL(this.returnPath, window.location.origin).toString(),
      };

      try {
        let session;
        try {
          session = await apiFetch(this.apiBase, ENDPOINTS.checkout, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (error) {
          if (!isCompatFallbackStatus(Number(error && error.status))) throw error;
          session = await apiFetch(this.apiBase, ENDPOINTS.checkoutLegacy, {
            method: 'POST',
            body: JSON.stringify({
              tier: this.selectedTier,
              interval: this.interval,
              coverFees: payload.coverFees,
              successUrl: payload.successUrl,
              cancelUrl: payload.cancelUrl,
              success_url: payload.successUrl,
              cancel_url: payload.cancelUrl,
            }),
          });
        }

        if (session && session.url) {
          window.location.href = String(session.url);
          return;
        }
        throw new Error('No checkout URL returned.');
      } catch (error) {
        this.setError('Could not start checkout right now. Please try again.');
        console.error('settings.membership.v3 checkout failed', error);
      } finally {
        this.setBusy(false);
      }
    }

    async handlePortalFlow(mode) {
      const flow = txt(mode);
      this.setBusy(true);
      this.setError('');
      try {
        const payload = {
          flow,
          returnPath: this.returnPath,
        };
        const session = await apiFetch(this.apiBase, ENDPOINTS.portal, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (session && session.url) {
          window.location.href = String(session.url);
          return;
        }
        throw new Error('No portal URL returned.');
      } catch (error) {
        this.setError('Could not open Customer Portal right now.');
        console.error('settings.membership.v3 portal failed', error);
      } finally {
        this.setBusy(false);
      }
    }

    async handlePauseResume(action) {
      const normalized = txt(action).toLowerCase();
      if (normalized !== 'pause' && normalized !== 'resume') return;
      this.setBusy(true);
      this.setError('');
      try {
        const endpoint = normalized === 'pause' ? ENDPOINTS.pause : ENDPOINTS.resume;
        await apiFetch(this.apiBase, endpoint, {
          method: 'POST',
          body: JSON.stringify({ returnPath: this.returnPath }),
        });
        await this.loadSummary();
      } catch (error) {
        this.setError(normalized === 'pause'
          ? 'Could not pause membership at period end.'
          : 'Could not resume membership.');
        console.error('settings.membership.v3 pause/resume failed', error);
      } finally {
        this.setBusy(false);
      }
    }

    async loadPlans() {
      try {
        const payload = await apiFetch(this.apiBase, ENDPOINTS.plans, { timeoutMs: 10000 });
        this.plans = normalizePlans(payload);
      } catch (error) {
        if (!isCompatFallbackStatus(Number(error && error.status))) {
          throw error;
        }
        const payload = await apiFetch(this.apiBase, ENDPOINTS.plansLegacy, { timeoutMs: 10000 });
        this.plans = normalizePlans(payload);
      }

      this.selectedTier = resolveTierModel(new Map(this.plans.plans.map((plan) => [plan.tier, plan])), this.plans.defaultTier)
        ? normalizeTierValue(this.plans.defaultTier, 'S')
        : 'S';
      if (!DEFAULT_TIERS[this.selectedTier]) this.selectedTier = 'S';
      this.renderTierCards();
      this.updateTierVisuals();
      this.renderSelection();
      this.syncComposerBaselineFromSummary();
    }

    async loadSummary() {
      try {
        const payload = await apiFetch(this.apiBase, ENDPOINTS.summary, { timeoutMs: 10000 });
        this.summary = normalizeSummary(payload);
      } catch (error) {
        if (!isCompatFallbackStatus(Number(error && error.status))) {
          throw error;
        }
        const payload = await apiFetch(this.apiBase, ENDPOINTS.summaryLegacy, { timeoutMs: 10000 });
        this.summary = normalizeSummary(payload);
      }

      const hasCurrentMembership = hasCurrentMembershipStatus(this.summary.status);
      if (hasCurrentMembership && !this.tiersOpen) {
        if (this.summary.tier && DEFAULT_TIERS[this.summary.tier]) {
          this.selectedTier = this.summary.tier;
        }
        if (this.summary.interval && ALLOWED_INTERVALS.has(this.summary.interval)) {
          this.interval = this.summary.interval;
        }
        this.updateTierVisuals();
        this.renderSelection();
      }

      this.syncComposerBaselineFromSummary();
      this.renderSummary();
    }

    async loadInvoices() {
      this.invoiceState = 'loading';
      this.renderInvoices();
      try {
        const payload = await apiFetch(this.apiBase, ENDPOINTS.invoices, { timeoutMs: 12000 });
        this.invoices = normalizeInvoices(payload);
        this.invoiceState = 'ready';
      } catch (error) {
        this.invoiceState = 'error';
        this.invoices = [];
        console.error('settings.membership.v3 invoices failed', error);
      }
      this.renderInvoices();
    }

    async mount() {
      this.render();
      this.mounted = true;

      try {
        await this.loadPlans();
      } catch (error) {
        this.setError('Could not load plans right now.');
        console.error('settings.membership.v3 plans failed', error);
      }

      try {
        await this.loadSummary();
      } catch (error) {
        this.summary = normalizeSummary(null);
        this.renderSummary();
        this.setError('Could not load billing status right now.');
        console.error('settings.membership.v3 summary failed', error);
      }

      await this.loadInvoices();

      this.setCardReady(this.cache.membershipCard);
      this.setCardReady(this.cache.billingCard);
      this.queueRailSync();

      const legacyPane = document.getElementById('dxLegacyMembershipPane');
      if (legacyPane instanceof HTMLElement) legacyPane.hidden = true;
      const asideBilling = document.getElementById('asideBilling');
      if (asideBilling instanceof HTMLElement) {
        const note = $('p.note', asideBilling);
        if (note) {
          note.textContent = 'Stripe handles payments securely. Manage cards, plans, and invoices in Customer Portal.';
        }
      }
    }
  }

  async function mountMembershipV3(options = {}) {
    const root = document.getElementById('dxMembershipV3Root');
    if (!(root instanceof HTMLElement)) return null;

    const existing = root.__dxMembershipV3Controller;
    if (existing instanceof MembershipV3Controller && existing.mounted) {
      return existing;
    }

    const settingsRoot = document.getElementById('dex-settings');
    const controller = new MembershipV3Controller(root, {
      apiBase: options.apiBase || txt(settingsRoot && settingsRoot.dataset && settingsRoot.dataset.api, '/api'),
      returnPath: options.returnPath || '/entry/settings#membership',
      successPath: options.successPath || '/entry/settings?thanks=1#membership',
    });

    root.__dxMembershipV3Controller = controller;
    await controller.mount();
    return controller;
  }

  window.__DX_SETTINGS_MEMBERSHIP_V3_ENABLED = true;
  window.__dxSettingsMembershipMount = mountMembershipV3;
})();
