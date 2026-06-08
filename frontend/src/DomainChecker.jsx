import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import LZString from 'lz-string'
import './DomainChecker.css'

const DEFAULT_TLDS = ['.com', '.net', '.org', '.ai', '.io', '.co', '.app', '.dev']
const PORKBUN_SEARCH = 'https://porkbun.com/checkout/search?q='

const IC_LABELS = {
  '001': 'Chemicals', '002': 'Paints & Coatings', '003': 'Cosmetics & Cleaning',
  '004': 'Lubricants & Fuels', '005': 'Pharmaceuticals', '006': 'Metal Goods',
  '007': 'Machinery & Motors', '008': 'Hand Tools', '009': 'Electronics & Software',
  '010': 'Medical Devices', '011': 'Appliances & Lighting', '012': 'Vehicles',
  '013': 'Firearms', '014': 'Jewelry & Watches', '015': 'Musical Instruments',
  '016': 'Paper & Print', '017': 'Rubber & Plastics', '018': 'Leather Goods',
  '019': 'Building Materials', '020': 'Furniture', '021': 'Household Items',
  '022': 'Ropes & Fibers', '023': 'Yarns & Threads', '024': 'Textiles & Fabrics',
  '025': 'Clothing & Footwear', '026': 'Buttons & Ribbons', '027': 'Floor Coverings',
  '028': 'Games, Toys & Sports', '029': 'Meats & Processed Foods', '030': 'Baked Goods',
  '031': 'Agricultural & Fresh Foods', '032': 'Beverages (Non-Alcoholic)',
  '033': 'Alcoholic Beverages', '034': 'Tobacco', '035': 'Advertising & Business',
  '036': 'Financial & Real Estate', '037': 'Construction & Repair',
  '038': 'Telecommunications', '039': 'Transportation', '040': 'Material Treatment',
  '041': 'Education & Entertainment', '042': 'Computer & Tech Services',
  '043': 'Restaurants & Hotels', '044': 'Medical & Veterinary',
  '045': 'Legal & Security Services',
}

const IC_SHORT = {
  '001': 'Chemicals', '002': 'Paints', '003': 'Cosmetics',
  '004': 'Lubricants', '005': 'Pharma', '006': 'Metal',
  '007': 'Machinery', '008': 'Tools', '009': 'Electronics',
  '010': 'Medical', '011': 'Appliances', '012': 'Vehicles',
  '013': 'Firearms', '014': 'Jewelry', '015': 'Music',
  '016': 'Print', '017': 'Rubber', '018': 'Leather',
  '019': 'Building', '020': 'Furniture', '021': 'Household',
  '022': 'Fibers', '023': 'Yarns', '024': 'Textiles',
  '025': 'Clothing', '026': 'Notions', '027': 'Flooring',
  '028': 'Toys & Sports', '029': 'Foods', '030': 'Bakery',
  '031': 'Agriculture', '032': 'Beverages', '033': 'Alcohol',
  '034': 'Tobacco', '035': 'Advertising', '036': 'Finance',
  '037': 'Construction', '038': 'Telecom', '039': 'Transport',
  '040': 'Materials', '041': 'Education', '042': 'Tech & Software',
  '043': 'Hospitality', '044': 'Medical/Vet', '045': 'Legal',
}

const PANEL_COLORS = [
  '#0284c7', '#7c3aed', '#059669', '#ea580c',
  '#dc2626', '#ca8a04', '#2563eb', '#db2777',
  '#16a34a', '#c026d3',
]

function TmPanel({ hits }) {
  const allCodes = []
  for (const h of hits) {
    for (const c of (h.international_codes || [])) {
      if (!allCodes.includes(c)) allCodes.push(c)
    }
  }
  allCodes.sort()
  const colorMap = Object.fromEntries(allCodes.map((c, i) => [c, PANEL_COLORS[i % PANEL_COLORS.length]]))

  if (hits.length === 0) return <div className="tm-panel-empty">No live trademark hits</div>

  return (
    <div className="tm-panel-cols">
      <div className="tm-panel-left">
        <div className="tm-panel-col-hdr">Industries</div>
        {allCodes.map(c => (
          <div key={c} className="tm-panel-ind-row">
            <span className="tm-panel-dot" style={{ background: colorMap[c] }} />
            <span className="tm-panel-ind-name">{IC_LABELS[c] || `IC ${c}`}</span>
          </div>
        ))}
      </div>
      <div className="tm-panel-sep" />
      <div className="tm-panel-right">
        <div className="tm-panel-col-hdr">Marks</div>
        {hits.map((h, i) => (
          <div key={i} className="tm-panel-mark-row">
            <div className="tm-panel-mark-inner">
              <div className="tm-panel-mark-name">{h.word_mark}</div>
              <div className="tm-panel-mark-dots">
                {(h.international_codes || []).map(c => (
                  <span key={c} className="tm-panel-dot" style={{ background: colorMap[c] }} />
                ))}
              </div>
            </div>
            {h.international_codes?.length > 0 && (
              <div className="tm-panel-mark-industries">
                {h.international_codes.map(c => IC_SHORT[c] || `IC ${c}`).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}


function parsePrice(priceStr) {
  const m = priceStr?.match(/\$([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0
}

function totalPrice(priceStr) {
  if (!priceStr) return 0
  return [...priceStr.matchAll(/\$([\d,]+(?:\.\d+)?)/g)]
    .reduce((sum, m) => sum + parseFloat(m[1].replace(/,/g, '')), 0)
}

function fmtPriceInput(raw) {
  if (!raw) return ''
  const [int, dec] = raw.split('.')
  const fmtInt = int ? Number(int).toLocaleString('en-US') : ''
  return dec !== undefined ? fmtInt + '.' + dec : fmtInt
}

function parsePriceInput(str) {
  let v = str.replace(/,/g, '').replace(/[^0-9.]/g, '')
  const dot = v.indexOf('.')
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '')
  return v
}

function applyPriceChange(e, setter) {
  const input = e.target
  const selStart = input.selectionStart
  const typed = input.value
  const newRaw = parsePriceInput(typed)
  const newFormatted = fmtPriceInput(newRaw)

  const rawCursor = selStart - (typed.slice(0, selStart).match(/,/g) || []).length

  let targetPos = newFormatted.length
  if (rawCursor === 0) {
    targetPos = 0
  } else {
    let digitsSeen = 0
    for (let i = 0; i < newFormatted.length; i++) {
      if (newFormatted[i] !== ',') digitsSeen++
      if (digitsSeen === rawCursor) { targetPos = i + 1; break }
    }
  }

  setter(newRaw)
  requestAnimationFrame(() => { input.setSelectionRange(targetPos, targetPos) })
}

function fmtGroupPrice(purchaseTotal, annualTotal, hasMissingPurchase, hasMissingAnnual) {
  const fmt = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (purchaseTotal > 0 && annualTotal > 0)
    return `${fmt(purchaseTotal)} + ${fmt(annualTotal)}/yr`
  if (purchaseTotal > 0)
    return fmt(purchaseTotal) + (hasMissingAnnual ? '+' : '')
  if (annualTotal > 0)
    return fmt(annualTotal) + (hasMissingPurchase ? '+' : '') + '/yr'
  return null
}

function groupResults(results, selectedTlds, tldMode, manualPrices = {}) {
  const tldList = [...selectedTlds]
  const map = new Map()

  for (const r of results) {
    const tld = tldList.find(t => r.domain.endsWith(t))
    const base = tld ? r.domain.slice(0, r.domain.length - tld.length) : r.domain
    if (!map.has(base)) map.set(base, [])
    map.get(base).push(r)
  }

  return [...map.entries()].map(([base, items]) => {
    const manualTaken = domain => manualPrices[domain] === '__taken__'
    const manualIsYr  = domain => !!(manualPrices[domain] && manualPrices[domain].includes('/yr'))

    const effectiveStatus = r => {
      if (manualTaken(r.domain)) return 'taken'
      if (r.status === 'unknown') {
        const m = manualPrices[r.domain]
        if (m && parsePrice(m) > 0) return 'for_sale'
      }
      return r.status
    }

    const ep = r => {
      if (manualTaken(r.domain)) return null
      if (r.price) return r.price
      const m = manualPrices[r.domain]
      return (m && parsePrice(m) > 0) ? m : null
    }

    const forSaleItems   = items.filter(i => effectiveStatus(i) === 'for_sale')
    const availableItems = items.filter(i => effectiveStatus(i) === 'available')
    const unknownItems   = items.filter(i => effectiveStatus(i) === 'unknown')
    const takenCount     = items.filter(i => effectiveStatus(i) === 'taken').length
    const hasManualTaken = items.some(i => manualTaken(i.domain))
    const hasRealTaken   = items.some(i => i.status === 'taken')

    const hasMissingPurchase = forSaleItems.some(i => !ep(i))
    const hasMissingAnnual   = availableItems.some(i => !i.price)
    const hasManualPrice     = items.some(i => !i.price && ep(i))
    const purchaseTotal = forSaleItems.reduce((s, i) => {
      const p = ep(i)
      return (p && !manualIsYr(i.domain)) ? s + parsePrice(p) : s
    }, 0)
    const annualTotal = availableItems.filter(i => i.price).reduce((s, i) => s + parsePrice(i.price), 0)
      + forSaleItems.reduce((s, i) => {
          const p = ep(i)
          return (p && manualIsYr(i.domain)) ? s + parsePrice(p) : s
        }, 0)
    const anyPriced = purchaseTotal > 0 || annualTotal > 0
    const meta = { hasManualPrice, hasManualTaken, hasRealTaken }

    if (tldMode === 'and') {
      if (takenCount > 0) return { base, status: 'unavailable', price: null, items, ...meta }
      if (availableItems.length === tldList.length) {
        return {
          base, status: 'available',
          price: anyPriced ? fmtGroupPrice(purchaseTotal, annualTotal, hasMissingPurchase, hasMissingAnnual) : null,
          items, ...meta,
        }
      }
      if (unknownItems.length > 0) {
        const knownPrice = anyPriced ? fmtGroupPrice(purchaseTotal, annualTotal, hasMissingPurchase, hasMissingAnnual) : null
        return { base, status: 'unknown', price: knownPrice, items, ...meta }
      }
      if (hasMissingPurchase) {
        const knownPrice = anyPriced ? fmtGroupPrice(purchaseTotal, annualTotal, true, hasMissingAnnual) : null
        return { base, status: 'for_sale', price: knownPrice, items, ...meta }
      }
      return {
        base, status: 'available',
        price: anyPriced ? fmtGroupPrice(purchaseTotal, annualTotal, false, hasMissingAnnual) : null,
        items, ...meta,
      }
    }

    const hasKnownAcquirable = availableItems.length > 0 || forSaleItems.some(i => ep(i))
    if (hasKnownAcquirable) {
      return {
        base, status: 'available',
        price: anyPriced ? fmtGroupPrice(purchaseTotal, annualTotal, hasMissingPurchase, hasMissingAnnual) : null,
        items, ...meta,
      }
    }
    if (hasMissingPurchase) {
      return { base, status: 'for_sale', price: null, items, ...meta }
    }
    if (unknownItems.length > 0) {
      return { base, status: 'unknown', price: null, items, ...meta }
    }
    return { base, status: 'unavailable', price: null, items, ...meta }
  })
}

function sortGroups(groups, priceMin, priceMax, trademarks, priceSortDir, statusGrouped, tmSortFirst) {
  const minVal = priceMin !== '' ? parseFloat(priceMin) : null
  const maxVal = priceMax !== '' ? parseFloat(priceMax) : null
  const hasRange = minVal !== null || maxVal !== null

  function tmTier(g) {
    const tm = trademarks.get(g.base)
    if (!tm || tm.status !== 'done') return 0
    if (tm.result.verdict === 'review') return 1
    if (tm.result.verdict === 'conflict') return 2
    return 0
  }

  function priceVal(g) { return g.price === null ? Infinity : totalPrice(g.price) }

  function statusTier(g) {
    if (g.status === 'available') return 0
    if (g.status === 'for_sale') return 1
    if (g.status === 'unknown') return 2
    return 3
  }

  function acquirableTier(g) {
    if (g.status === 'available' || g.status === 'for_sale') return 0
    if (g.status === 'unknown') return 1
    return 2
  }

  function section(g) {
    if (g.status === 'unavailable') return 2
    if (!hasRange) return 0
    if ((g.status === 'for_sale' || g.status === 'unknown') && g.price === null) return 0
    const p = totalPrice(g.price)
    const inRange = p > 0 && (minVal === null || p >= minVal) && (maxVal === null || p <= maxVal)
    return inRange ? 0 : 1
  }

  function sortPrice(pa, pb, dir) {
    if (pa === pb) return 0
    if (pa === Infinity) return 1
    if (pb === Infinity) return -1
    return dir === 'asc' ? pa - pb : pb - pa
  }

  return [...groups].sort((a, b) => {
    const secDiff = section(a) - section(b)
    if (secDiff !== 0) return secDiff
    if (a.status === 'unavailable') return a.base.localeCompare(b.base)

    const tierDiff = statusGrouped
      ? statusTier(a) - statusTier(b)
      : acquirableTier(a) - acquirableTier(b)
    if (tierDiff !== 0) return tierDiff

    const tmDiff = tmTier(a) - tmTier(b)
    if (tmSortFirst && tmDiff !== 0) return tmDiff

    if (priceSortDir) {
      const pd = sortPrice(priceVal(a), priceVal(b), priceSortDir)
      if (pd !== 0) return pd
    }

    if (tmDiff !== 0) return tmDiff
    return a.base.localeCompare(b.base)
  })
}

const DOMAIN_API = import.meta.env.VITE_DOMAIN_API ?? '/api/domain'

const SESSION_KEY = 'dsSession'

function serializeSession(s) {
  return {
    v: 1,
    at: new Date().toISOString(),
    results: s.results ?? [],
    manualPrices: s.manualPrices,
    trademarks: [...s.trademarks.entries()],
    terms: s.terms,
    selectedTlds: [...s.selectedTlds],
    tldMode: s.tldMode,
    priceMin: s.priceMin,
    priceMax: s.priceMax,
    priceSortDir: s.priceSortDir,
    statusGrouped: s.statusGrouped,
    tmSortFirst: s.tmSortFirst,
    visibleStatuses: [...s.visibleStatuses],
    expanded: [...s.expanded],
    confirmBeforeDelete: s.confirmBeforeDelete,
  }
}

function deserializeSession(d) {
  return {
    ...d,
    trademarks: new Map(d.trademarks ?? []),
    selectedTlds: new Set(d.selectedTlds ?? []),
    visibleStatuses: new Set(d.visibleStatuses ?? ['available', 'for_sale', 'unknown', 'unavailable']),
    expanded: new Set(d.expanded ?? []),
  }
}

function downloadChecklist(results) {
  const today = new Date().toISOString().slice(0, 10)

  const flagged = results
    .filter(r => r.status === 'unknown' || r.status === 'for_sale')
    .map(r => {
      const url = r.purchase_url || ''
      let priority, note
      if (r.status === 'unknown') {
        priority = 1
        note = 'Status is Unknown — verify on GoDaddy whether this domain can actually be purchased'
      } else if (!r.price) {
        priority = 2
        if (url.includes('atom.com'))     note = 'Atom marketplace listing, no price shown — verify the listing is live and get a price'
        else if (url.includes('sedo'))    note = 'Sedo listing, no price shown — verify listing is active and get a price'
        else if (url.includes('godaddy')) note = 'GoDaddy/Afternic listing, no price shown — check if a buy-now price is listed or if it\'s inquiry-only'
        else                               note = 'No price shown — verify listing is active and check for a price'
      } else {
        priority = 3
        if (url.includes('hugedomains')) note = `Listed at ${r.price} on HugeDomains — confirm this price is still current (they fluctuate)`
        else                              note = `Listed at ${r.price} — verify the price is correct`
      }
      return { priority, domain: r.domain, note, url }
    })
    .sort((a, b) => a.priority - b.priority || a.domain.localeCompare(b.domain))

  const sections = [
    { label: 'HIGH — cannot confirm purchasable', items: flagged.filter(x => x.priority === 1) },
    { label: 'MEDIUM — no price, verify listing is active', items: flagged.filter(x => x.priority === 2) },
    { label: 'LOW — price shown, verify it\'s current', items: flagged.filter(x => x.priority === 3) },
  ]

  const lines = [`DOMAIN REVIEW CHECKLIST — ${today}`, '']
  for (const { label, items } of sections) {
    if (!items.length) continue
    lines.push(`${label} (${items.length}):`)
    for (const x of items) {
      lines.push(`  ${x.domain}`)
      lines.push(`    → ${x.note}`)
      if (x.url) lines.push(`    → ${x.url}`)
    }
    lines.push('')
  }
  if (!flagged.length) lines.push('No domains flagged for review.')

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `domain-review-${today}.txt`,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadCsv(results) {
  const header = 'Domain,Status,Price,Purchase URL'
  const rows = results.map(r =>
    [r.domain, r.status, r.price ?? '', r.purchase_url ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'domain-search.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const DomainChecker = forwardRef(function DomainChecker({
  initialTerms,
  compact = false,
  controlledTlds,
  controlledTldMode,
  controlledPriceMin,
  controlledPriceMax,
  onStreamingChange,
  onStartOver,
  onDeleteBases,
}, ref) {
  const [terms, setTerms] = useState('')
  const [selectedTlds, setSelectedTlds] = useState(new Set(['.com', '.ai']))
  const [tldMode, setTldMode] = useState('and')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [trademarks, setTrademarks] = useState(new Map())
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('10000')
  const [openTmTooltip, setOpenTmTooltip] = useState(null)
  const [priceSortDir, setPriceSortDir] = useState('asc')
  const [statusGrouped, setStatusGrouped] = useState(false)
  const [tmSortFirst, setTmSortFirst] = useState(false)
  const [visibleStatuses, setVisibleStatuses] = useState(new Set(['available', 'for_sale', 'unknown', 'unavailable']))
  const [manualPrices, setManualPrices] = useState({})
  const [draftPrices, setDraftPrices] = useState({})
  const [confirmBeforeDelete, setConfirmBeforeDelete] = useState(false)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [priorityInput, setPriorityInput] = useState('')

  const pendingRef = useRef([])
  const flushedRef = useRef([])
  const timerRef = useRef(null)
  const abortRef = useRef(null)
  const pausedRef = useRef(false)
  const searchIdRef = useRef(null)
  const autoCheckedRef = useRef(new Set())
  const seenDomainsRef = useRef(new Set())
  const deletedBasesRef = useRef(new Set())
  const deleteMenuRef = useRef(null)
  const saveTimerRef = useRef(null)
  const autoSearchPendingRef = useRef(false)
  const initialTermsRef = useRef(initialTerms)
  const priorityQueueRef = useRef([])
  const termsRef = useRef(terms)

  const priceMinRef = useRef(priceMin)
  const priceMaxRef = useRef(priceMax)
  const selectedTldsRef = useRef(selectedTlds)
  const tldModeRef = useRef(tldMode)

  // In compact mode, use controlled values from Generator; otherwise use internal state
  const activeTlds = compact ? (controlledTlds ?? new Set()) : selectedTlds
  const activeTldMode = compact ? (controlledTldMode ?? 'and') : tldMode
  const activePriceMin = compact ? (controlledPriceMin ?? '') : priceMin
  const activePriceMax = compact ? (controlledPriceMax ?? '10000') : priceMax

  useEffect(() => { priceMinRef.current = activePriceMin }, [activePriceMin])
  useEffect(() => { priceMaxRef.current = activePriceMax }, [activePriceMax])
  useEffect(() => { selectedTldsRef.current = activeTlds }, [activeTlds])
  useEffect(() => { tldModeRef.current = activeTldMode }, [activeTldMode])
  useEffect(() => { initialTermsRef.current = initialTerms }, [initialTerms])
  useEffect(() => { termsRef.current = terms }, [terms])

  // Notify Generator whenever domain streaming state changes
  useEffect(() => { onStreamingChange?.(streaming) }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  // Expose controls for Generator to drive both streams together
  useImperativeHandle(ref, () => ({
    submitPriority(priorityTerms) {
      if (!priorityTerms.length || !selectedTldsRef.current.size) return
      if (pausedRef.current) {
        priorityQueueRef.current = [...new Set([...priorityTerms, ...priorityQueueRef.current])]
        return
      }
      autoSearchPendingRef.current = false
      const allTerms = [...new Set([...priorityTerms, ...(initialTermsRef.current ?? [])])]
      runSearch(allTerms)
    },
    pause()  { handlePause() },
    resume() { handleResume() },
    stop()   { handleStop() },
  }))

  // Restore session from localStorage on mount
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return
    try {
      const d = deserializeSession(JSON.parse(LZString.decompress(raw) ?? raw))
      if (d.results?.length) {
        setResults(d.results)
        autoCheckedRef.current = new Set(d.trademarks.keys())
      }
      setManualPrices(d.manualPrices ?? {})
      if (d.trademarks.size) setTrademarks(d.trademarks)
      if (d.terms) setTerms(d.terms)
      if (d.selectedTlds.size) setSelectedTlds(d.selectedTlds)
      if (d.tldMode) setTldMode(d.tldMode)
      setPriceMin(d.priceMin ?? '')
      setPriceMax(d.priceMax ?? '10000')
      if (d.priceSortDir !== undefined) setPriceSortDir(d.priceSortDir)
      if (d.statusGrouped !== undefined) setStatusGrouped(d.statusGrouped)
      if (d.tmSortFirst !== undefined) setTmSortFirst(d.tmSortFirst)
      if (d.visibleStatuses.size) setVisibleStatuses(d.visibleStatuses)
      if (d.expanded.size) setExpanded(d.expanded)
      if (d.confirmBeforeDelete !== undefined) setConfirmBeforeDelete(d.confirmBeforeDelete)
    } catch (e) {
      console.warn('Failed to restore session:', e)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save session to localStorage (debounced 1s)
  useEffect(() => {
    if (results === null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(SESSION_KEY, LZString.compress(JSON.stringify(
          serializeSession({ results, manualPrices, trademarks, terms, selectedTlds, tldMode, priceMin, priceMax, priceSortDir, statusGrouped, tmSortFirst, visibleStatuses, expanded, confirmBeforeDelete })
        )))
      } catch {}
    }, 1000)
  }, [results, manualPrices, trademarks, terms, selectedTlds, tldMode, priceMin, priceMax, priceSortDir, statusGrouped, tmSortFirst, visibleStatuses, expanded, confirmBeforeDelete]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close delete menu on outside click
  useEffect(() => {
    if (!showDeleteMenu) return
    function close(e) { if (!deleteMenuRef.current?.contains(e.target)) setShowDeleteMenu(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showDeleteMenu])

  useEffect(() => {
    if (!openTmTooltip) return
    function close() { setOpenTmTooltip(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openTmTooltip])

  // Auto-run TM checks for all available and for_sale groups as results arrive
  useEffect(() => {
    if (!results) return
    const groups = groupResults(results, selectedTldsRef.current, tldModeRef.current)
    for (const g of groups) {
      if (g.status === 'unavailable') continue
      if (autoCheckedRef.current.has(g.base)) continue
      if (trademarks.has(g.base)) continue
      autoCheckedRef.current.add(g.base)
      handleTrademarkCheck(g.base)
    }
  }, [results]) // eslint-disable-line react-hooks/exhaustive-deps

  // When initialTerms changes (passed from Generator via "Check Domains →"), auto-search
  useEffect(() => {
    if (!initialTerms?.length) return
    setTerms(initialTerms.join(' '))
    autoSearchPendingRef.current = true
  }, [initialTerms]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fire auto-search once terms state has updated from initialTerms.
  // If the scan is already running, hold off — it will trigger again when streaming ends.
  useEffect(() => {
    if (!autoSearchPendingRef.current) return
    if (streaming) return
    const inputTerms = [...new Set(terms.split(/[\s,]+/).filter(Boolean))]
    if (!inputTerms.length) return
    autoSearchPendingRef.current = false
    runSearch(inputTerms)
  }, [terms, streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTld(tld) {
    setSelectedTlds(prev => {
      const next = new Set(prev)
      next.has(tld) ? next.delete(tld) : next.add(tld)
      return next
    })
  }

  function toggleStatus(status) {
    setVisibleStatuses(prev => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }

  function toggleExpand(base) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(base) ? next.delete(base) : next.add(base)
      return next
    })
  }

  function handleManualPriceChange(domain, e) {
    const input = e.target
    const raw = input.value
    const cursorPos = input.selectionStart

    const rawNoPrefix = raw.startsWith('$') ? raw.slice(1) : raw
    if (/^t(a(k(e(n?)?)?)?)?$/i.test(rawNoPrefix.trim())) {
      setDraftPrices(prev => ({ ...prev, [domain]: rawNoPrefix }))
      return
    }

    const digitsBefore = raw.slice(0, cursorPos).replace(/[^0-9.]/g, '').length

    let v = raw.startsWith('$') ? raw.slice(1) : raw

    let suffix = ''
    const slashIdx = v.indexOf('/')
    if (slashIdx !== -1) {
      const after = v.slice(slashIdx + 1)
      if (/^y?r?$/.test(after)) {
        suffix = '/' + after
        v = v.slice(0, slashIdx)
      } else {
        v = v.slice(0, slashIdx)
      }
    }

    const dotIdx = v.indexOf('.')
    let intPart, decPart
    if (dotIdx !== -1) {
      intPart = v.slice(0, dotIdx).replace(/\D/g, '')
      decPart = v.slice(dotIdx + 1).replace(/\D/g, '').slice(0, 2)
    } else {
      intPart = v.replace(/\D/g, '')
      decPart = null
    }

    const intFormatted = intPart ? Number(intPart).toLocaleString('en-US') : ''

    if (!intFormatted && decPart === null && !suffix) {
      setDraftPrices(prev => ({ ...prev, [domain]: raw === '$' ? '$' : '' }))
      return
    }

    const newVal = '$' + intFormatted + (decPart !== null ? '.' + decPart : '') + suffix
    setDraftPrices(prev => ({ ...prev, [domain]: newVal }))

    requestAnimationFrame(() => {
      if (!input.isConnected) return
      let count = 0, pos = 1
      for (let i = 0; i < newVal.length; i++) {
        if (/[0-9.]/.test(newVal[i])) {
          count++
          if (count === digitsBefore) { pos = i + 1; break }
        }
      }
      if (digitsBefore === 0) pos = 1
      const yrStart = newVal.indexOf('/')
      if (yrStart !== -1 && pos > yrStart) pos = yrStart
      input.setSelectionRange(pos, pos)
    })
  }

  function handleManualPriceBlur(domain, val) {
    setDraftPrices(prev => { const n = { ...prev }; delete n[domain]; return n })

    if (val.trim().toLowerCase() === 'taken') {
      setManualPrices(prev => ({ ...prev, [domain]: '__taken__' }))
      return
    }

    let v = val.trim()
    if (v.startsWith('$')) v = v.slice(1).trim()

    let hasYr = false
    if (v.endsWith('/yr')) {
      hasYr = true
      v = v.slice(0, -3).trim()
    } else if (/\//.test(v) || /[a-zA-Z]/.test(v)) {
      setManualPrices(prev => { const n = { ...prev }; delete n[domain]; return n })
      return
    }

    const num = parseFloat(v.replace(/,/g, ''))
    if (!v || isNaN(num) || num <= 0) {
      setManualPrices(prev => { const n = { ...prev }; delete n[domain]; return n })
      return
    }

    const formatted = '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (hasYr ? '/yr' : '')
    setManualPrices(prev => ({ ...prev, [domain]: formatted }))
  }

  async function handleTrademarkCheck(base) {
    setTrademarks(prev => new Map(prev).set(base, { status: 'loading' }))
    try {
      const res = await fetch(`${DOMAIN_API}/trademark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: base }),
      })
      const data = await res.json()
      setTrademarks(prev => new Map(prev).set(base, { status: 'done', result: data }))
    } catch {
      setTrademarks(prev => new Map(prev).set(base, { status: 'error' }))
    }
  }

  function deleteByBases(bases) {
    const basesSet = new Set(bases)
    const tldList = [...selectedTldsRef.current]
    const getBase = domain => {
      const tld = tldList.find(t => domain.endsWith(t))
      return tld ? domain.slice(0, domain.length - tld.length) : domain
    }
    onDeleteBases?.(bases)
    for (const b of bases) deletedBasesRef.current.add(b)
    pendingRef.current = pendingRef.current.filter(r => !basesSet.has(getBase(r.domain)))
    flushedRef.current = flushedRef.current.filter(r => !basesSet.has(getBase(r.domain)))
    setResults(prev => (prev ?? []).filter(r => !basesSet.has(getBase(r.domain))))
    setManualPrices(prev => {
      const next = { ...prev }
      for (const d of Object.keys(next)) if (basesSet.has(getBase(d))) delete next[d]
      return next
    })
    setTrademarks(prev => {
      const next = new Map(prev)
      for (const b of basesSet) { next.delete(b); autoCheckedRef.current.delete(b) }
      return next
    })
    setExpanded(prev => {
      const next = new Set(prev)
      for (const b of basesSet) next.delete(b)
      return next
    })
  }

  function handleDeleteGroup(base) {
    if (confirmBeforeDelete && !window.confirm(`Remove "${base}" from results?`)) return
    deleteByBases([base])
  }

  function handleBulkDelete(type) {
    setShowDeleteMenu(false)
    if (!groups) return
    if (type === 'all') {
      if (confirmBeforeDelete && !window.confirm('Start over? This clears everything.')) return
      onStartOver?.()
      localStorage.removeItem('dsSession')
      window.location.reload()
      return
    }
    let bases
    if (type === 'conflict')
      bases = groups.filter(g => trademarks.get(g.base)?.result?.verdict === 'conflict').map(g => g.base)
    else if (type === 'review')
      bases = groups.filter(g => trademarks.get(g.base)?.result?.verdict === 'review').map(g => g.base)
    else if (type === 'taken')
      bases = groups.filter(g => g.status === 'unavailable').map(g => g.base)
    else if (type === 'unknown')
      bases = groups.filter(g => g.status === 'unknown').map(g => g.base)
    else if (type === 'inquiry')
      bases = groups.filter(g => g.status === 'for_sale').map(g => g.base)
    if (!bases?.length) return
    if (confirmBeforeDelete && !window.confirm(`Delete ${bases.length} group${bases.length > 1 ? 's' : ''}?`)) return
    deleteByBases(bases)
  }

  function handlePause() {
    pausedRef.current = true
    setPaused(true)
    if (pendingRef.current.length > 0) {
      const batch = [...pendingRef.current]
      pendingRef.current = []
      const novel = batch.filter(r => !seenDomainsRef.current.has(r.domain))
      novel.forEach(r => seenDomainsRef.current.add(r.domain))
      flushedRef.current = [...flushedRef.current, ...novel]
      setResults([...flushedRef.current])
    }
    if (searchIdRef.current) {
      fetch(`${DOMAIN_API}/pause/${searchIdRef.current}`, { method: 'POST' }).catch(() => {})
    }
  }

  function handleResume() {
    pausedRef.current = false
    setPaused(false)
    const queued = priorityQueueRef.current
    if (queued.length > 0) {
      priorityQueueRef.current = []
      const baseTerms = termsRef.current.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
      const allTerms = [...new Set([...queued, ...baseTerms])]
      runSearch(allTerms)
    } else {
      if (searchIdRef.current) {
        fetch(`${DOMAIN_API}/resume/${searchIdRef.current}`, { method: 'POST' }).catch(() => {})
      }
    }
  }

  function handleStop() {
    if (searchIdRef.current) {
      fetch(`${DOMAIN_API}/resume/${searchIdRef.current}`, { method: 'POST' }).catch(() => {})
    }
    pausedRef.current = false
    if (abortRef.current) abortRef.current.abort()
  }

  // Core search logic — called both from form submit and auto-search
  async function runSearch(inputTerms) {
    if (!inputTerms.length || !selectedTldsRef.current.size) return

    if (abortRef.current) abortRef.current.abort()
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }

    const existingResults = results ?? []
    const skipDomains = existingResults.map(r => r.domain).filter(Boolean)
    pendingRef.current = []
    flushedRef.current = [...existingResults]
    seenDomainsRef.current = new Set(skipDomains)
    deletedBasesRef.current = new Set()
    pausedRef.current = false
    searchIdRef.current = crypto.randomUUID()
    const myRunId = searchIdRef.current

    setLoading(true)
    setStreaming(true)
    setPaused(false)
    setError(null)
    setResults(prev => prev ?? [])
    setOpenTmTooltip(null)
    setDraftPrices({})

    abortRef.current = new AbortController()

    timerRef.current = setInterval(() => {
      if (pausedRef.current) return
      if (pendingRef.current.length > 0) {
        const batch = [...pendingRef.current]
        pendingRef.current = []
        const tldKeys = [...selectedTldsRef.current]
        const getB = d => { const t = tldKeys.find(k => d.endsWith(k)); return t ? d.slice(0, d.length - t.length) : d }
        const novel = batch.filter(r => !seenDomainsRef.current.has(r.domain) && !deletedBasesRef.current.has(getB(r.domain)))
        novel.forEach(r => seenDomainsRef.current.add(r.domain))
        flushedRef.current = [...flushedRef.current, ...novel]
        setResults([...flushedRef.current])
      }
    }, 2500)

    try {
      const res = await fetch(`${DOMAIN_API}/search/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terms: inputTerms,
          tlds: [...selectedTldsRef.current],
          tld_mode: tldModeRef.current,
          search_id: searchIdRef.current,
          skip_domains: skipDomains,
        }),
        signal: abortRef.current.signal,
      })
      if (!res.ok) {
        const detail = await res.json().then(d => d.detail).catch(() => res.statusText)
        throw new Error(detail)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          const t = line.trim()
          if (!t) continue
          try { pendingRef.current.push(JSON.parse(t)) } catch {}
        }
      }
      if (buf.trim()) {
        try { pendingRef.current.push(JSON.parse(buf.trim())) } catch {}
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      // If a newer runSearch has already taken over, don't corrupt its refs/state
      if (searchIdRef.current !== myRunId) return

      clearInterval(timerRef.current)
      timerRef.current = null
      pausedRef.current = false

      const remaining = [...pendingRef.current]
      pendingRef.current = []
      const tldKeys = [...selectedTldsRef.current]
      const getB = d => { const t = tldKeys.find(k => d.endsWith(k)); return t ? d.slice(0, d.length - t.length) : d }
      const novelRemaining = remaining.filter(r => !seenDomainsRef.current.has(r.domain) && !deletedBasesRef.current.has(getB(r.domain)))
      const allResults = [...flushedRef.current, ...novelRemaining]
      flushedRef.current = []

      setResults([...allResults])
      setStreaming(false)
      setPaused(false)
      setLoading(false)

      const minV = priceMinRef.current !== '' ? parseFloat(priceMinRef.current) : null
      const maxV = priceMaxRef.current !== '' ? parseFloat(priceMaxRef.current) : null
      if (minV !== null || maxV !== null) {
        const rawGroups = groupResults(allResults, selectedTldsRef.current, tldModeRef.current)
        for (const g of rawGroups) {
          if (g.status === 'available') {
            const p = g.price !== null ? totalPrice(g.price) : null
            const inRange = p !== null &&
              (minV === null || p >= minV) &&
              (maxV === null || p <= maxV)
            if (inRange && !autoCheckedRef.current.has(g.base)) {
              autoCheckedRef.current.add(g.base)
              handleTrademarkCheck(g.base)
            }
          }
        }
      }
    }
  }

  function handlePrioritySubmit() {
    const priorityTerms = [...new Set(priorityInput.trim().split(/[\s,]+/).filter(Boolean))]
    if (!priorityTerms.length || !selectedTldsRef.current.size) return
    setPriorityInput('')
    const baseTerms = terms.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
    const allTerms = [...new Set([...priorityTerms, ...baseTerms])]
    runSearch(allTerms)
  }

  function handleSearch(e) {
    e.preventDefault()
    const inputTerms = [...new Set(terms.split(/[\s,]+/).map(k => k.trim()).filter(Boolean))]
    runSearch(inputTerms)
  }

  const minVal = activePriceMin !== '' ? parseFloat(activePriceMin) : null
  const maxVal = activePriceMax !== '' ? parseFloat(activePriceMax) : null
  let rangeError = null
  if (minVal !== null && minVal < 0) rangeError = 'Min cannot be negative'
  else if (minVal !== null && maxVal !== null && maxVal < minVal) rangeError = 'Max must be ≥ min'

  const canSearch = terms.trim().length > 0 && activeTlds.size > 0 && !loading && !rangeError

  const modeHint = activeTldMode === 'or'
    ? 'Available if any selected extension is available'
    : 'Available only if all selected extensions are available'

  const rawGroups = results ? groupResults(results, activeTlds, activeTldMode, manualPrices) : null
  const groups = rawGroups ? sortGroups(rawGroups, activePriceMin, activePriceMax, trademarks, priceSortDir, statusGrouped, tmSortFirst) : null
  const displayGroups = groups ? groups.filter(g => visibleStatuses.has(g.status)) : null

  const hasRange = minVal !== null || maxVal !== null
  function isInRange(g) {
    if (!hasRange) return false
    if (g.status === 'unavailable') return false
    if ((g.status === 'for_sale' || g.status === 'unknown') && g.price === null) return true
    const p = g.price !== null ? totalPrice(g.price) : null
    return p !== null && p > 0 &&
      (minVal === null || p >= minVal) &&
      (maxVal === null || p <= maxVal)
  }
  function meetsCriteria(g) {
    if (g.status === 'unavailable') return false
    return !hasRange || isInRange(g)
  }

  const tmClearCount = groups ? groups.filter(g => {
    if (!meetsCriteria(g)) return false
    const tm = trademarks.get(g.base)
    return !tm || tm.status !== 'done' || tm.result.verdict === 'clear'
  }).length : 0

  const meetsCriteriaCount = groups ? groups.filter(g => meetsCriteria(g)).length : 0

  const resultsSection = groups !== null ? (
        <div>
          <div className="results-header">
            <h2>
              {tmClearCount} TM clear
              {' · '}{meetsCriteriaCount} meets criteria
              {' · '}{groups.length} reviewed
            </h2>
            {results.length > 0 && (
              <div className="results-actions">
                <div className="delete-menu-wrap" ref={deleteMenuRef}>
                  <button className="btn-csv btn-delete-trigger" onClick={() => setShowDeleteMenu(v => !v)}>
                    Delete ▾
                  </button>
                  {showDeleteMenu && (
                    <div className="delete-menu">
                      <button onClick={() => handleBulkDelete('conflict')}>Delete all TM Conflict</button>
                      <button onClick={() => handleBulkDelete('review')}>Delete all TM Review</button>
                      <button onClick={() => handleBulkDelete('taken')}>Delete all Taken</button>
                      <button onClick={() => handleBulkDelete('unknown')}>Delete all Unknown</button>
                      <button onClick={() => handleBulkDelete('inquiry')}>Delete all Price Inquiry</button>
                      <hr />
                      <button className="delete-menu-danger" onClick={() => handleBulkDelete('all')}>Start Over</button>
                    </div>
                  )}
                </div>
                <label className="confirm-toggle" title="Ask for confirmation before deleting">
                  <input type="checkbox" checked={confirmBeforeDelete} onChange={e => setConfirmBeforeDelete(e.target.checked)} />
                  Confirm
                </label>
                <button className="btn-csv" onClick={() => downloadChecklist(results)}>
                  Review Checklist
                </button>
                <button className="btn-csv" onClick={() => downloadCsv(results)}>
                  Download CSV
                </button>
              </div>
            )}
          </div>

          {trademarks.size > 0 && (
            <p className="tm-disclaimer">Federal trademarks only · Not legal advice</p>
          )}
          <div className="filter-chips">
            {[
              { status: 'available',   label: 'Buy Now' },
              { status: 'for_sale',    label: 'Price Inquiry' },
              { status: 'unknown',     label: 'Unknown' },
              { status: 'unavailable', label: 'Taken' },
            ].map(({ status, label }) => (
              <button
                key={status}
                className={`filter-chip filter-chip--${status}${visibleStatuses.has(status) ? ' filter-chip--on' : ' filter-chip--off'}`}
                onClick={() => toggleStatus(status)}
              >
                {label}
              </button>
            ))}
          </div>
          {displayGroups.length === 0 ? (
            <p className="state-msg">{streaming ? 'Checking domains…' : 'No results returned.'}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>
                      Status
                      <span
                        className="status-group-toggle"
                        onClick={() => setStatusGrouped(v => !v)}
                        title={statusGrouped ? 'Buy Now and Price Inquiry separated' : 'Buy Now and Price Inquiry merged'}
                      >
                        {statusGrouped ? '■' : '—'}
                      </span>
                    </th>
                    <th
                      className="th-sortable"
                      onClick={() => setPriceSortDir(d => d === null ? 'asc' : d === 'asc' ? 'desc' : null)}
                    >
                      Price
                      <span className={`sort-icon${priceSortDir ? ' sort-icon--active' : ''}`}>
                        {priceSortDir === 'asc' ? '▲' : priceSortDir === 'desc' ? '▼' : '▴▾'}
                      </span>
                    </th>
                    <th
                      className="th-sortable"
                      onClick={() => setTmSortFirst(v => !v)}
                      title={tmSortFirst ? 'Sorted by TM verdict then price' : 'Sort by TM verdict'}
                    >
                      Trademark
                      <span className={`sort-icon${tmSortFirst ? ' sort-icon--active' : ''}`}>
                        {tmSortFirst ? '▲' : '▴▾'}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayGroups.map((g, idx) => {
                    const tm = trademarks.get(g.base)
                    const inRange = isInRange(g)
                    const prevInRange = idx > 0 && isInRange(displayGroups[idx - 1])
                    const prev = idx > 0 ? displayGroups[idx - 1] : null
                    const showRangeDivider = hasRange && !inRange && g.status !== 'unavailable' && (idx === 0 || prevInRange)
                    const showTakenDivider = g.status === 'unavailable' && prev && prev.status !== 'unavailable'
                    return (
                    <React.Fragment key={g.base}>
                      {showRangeDivider && (
                        <tr className="range-divider">
                          <td colSpan={4}>outside price range</td>
                        </tr>
                      )}
                      {showTakenDivider && (
                        <tr className="taken-divider">
                          <td colSpan={4}>taken</td>
                        </tr>
                      )}
                      <tr
                        className={`group-row${expanded.has(g.base) ? ' group-row--open' : ''}${inRange ? ' group-row--in-range' : ''}`}
                        onClick={() => toggleExpand(g.base)}
                      >
                        <td className="group-base">
                          {g.base}
                          <button
                            className="btn-delete-group"
                            onClick={e => { e.stopPropagation(); handleDeleteGroup(g.base) }}
                            title="Remove this group"
                          >×</button>
                        </td>
                        <td>
                          <span className={`badge badge-${g.status}`}>
                            {g.status === 'available' ? (g.hasManualPrice ? 'Buy Now*' : 'Buy Now')
                              : g.status === 'for_sale' ? 'Price Inquiry'
                              : g.status === 'unknown' ? 'Unknown'
                              : (g.hasManualTaken && !g.hasRealTaken) ? 'Taken*'
                              : 'Taken'}
                          </span>
                        </td>
                        <td>{g.price ?? '—'}</td>
                        <td>
                          <div className="group-actions">
                          {!tm || tm.status === 'idle' ? (
                              <button
                                className="btn-tm"
                                onClick={e => { e.stopPropagation(); handleTrademarkCheck(g.base) }}
                              >
                                Check TM
                              </button>
                            ) : tm.status === 'loading' ? (
                              <span className="tm-checking"><span className="spinner" />Checking…</span>
                            ) : tm.status === 'done' ? (
                              <div className="tm-panel-wrap" onClick={e => e.stopPropagation()}>
                                <span
                                  className={`badge-tm badge-tm--${tm.result.verdict} badge-tm--click`}
                                  onClick={() => setOpenTmTooltip(prev => prev === g.base ? null : g.base)}
                                >
                                  {tm.result.verdict === 'clear' ? 'TM Clear' : tm.result.verdict === 'review' ? 'TM Review' : 'TM Conflict'}
                                </span>
                                {openTmTooltip === g.base && (
                                  <div className="tm-panel">
                                    <TmPanel hits={tm.result.hits} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="tm-error">TM Error</span>
                            )}
                          <span className="expand-icon">
                            {expanded.has(g.base) ? '▲' : '▼'}
                          </span>
                          </div>
                        </td>
                      </tr>
                      {expanded.has(g.base) && g.items.map(r => {
                          const isTakenStar = manualPrices[r.domain] === '__taken__'
                          const manualP = !isTakenStar && manualPrices[r.domain] && parsePrice(manualPrices[r.domain]) > 0 ? manualPrices[r.domain] : null
                          const ep = r.price ?? manualP
                          const isBuy = r.status === 'available' || ((r.status === 'for_sale' || r.status === 'unknown') && ep)
                          const isManual = !r.price && ep
                          const isTaken = r.status !== 'available' && r.status !== 'for_sale' && r.status !== 'unknown'
                          const showInput = !isTakenStar && (
                            (r.status === 'for_sale' && !r.price) ||
                            (r.status === 'unknown')
                          )
                          const badgeClass = isTakenStar ? 'badge-unavailable'
                            : isBuy ? 'badge-available'
                            : r.status === 'for_sale' ? 'badge-for_sale'
                            : r.status === 'unknown' ? 'badge-unknown'
                            : 'badge-unavailable'
                          const badgeText = isTakenStar ? 'Taken*'
                            : isBuy ? (isManual ? 'Buy Now*' : 'Buy Now')
                            : r.status === 'for_sale' ? 'Price Inquiry'
                            : r.status === 'unknown' ? 'Unknown'
                            : 'Taken'
                          return (
                            <tr key={r.domain} className="detail-row">
                              <td className="detail-domain">{r.domain}</td>
                              <td>
                                <span
                                  className={`badge ${badgeClass}`}
                                  title={isManual && !isTakenStar ? 'Price manually entered' : isTakenStar ? 'Manually marked taken' : undefined}
                                >
                                  {badgeText}
                                </span>
                              </td>
                              <td>
                                {isTakenStar ? (
                                  <button
                                    className="manual-price-reset"
                                    onClick={e => { e.stopPropagation(); setManualPrices(prev => { const n = { ...prev }; delete n[r.domain]; return n }) }}
                                  >
                                    undo
                                  </button>
                                ) : showInput ? (
                                  <input
                                    className="manual-price-input"
                                    type="text"
                                    placeholder={r.status === 'unknown' ? 'price or "taken"' : 'e.g. 7,295'}
                                    value={draftPrices[r.domain] ?? manualPrices[r.domain] ?? ''}
                                    onChange={e => handleManualPriceChange(r.domain, e)}
                                    onFocus={e => {
                                      e.stopPropagation()
                                      if (draftPrices[r.domain] === undefined) {
                                        const committed = manualPrices[r.domain]
                                        const initVal = (committed && committed !== '__taken__') ? committed : '$'
                                        setDraftPrices(prev => ({ ...prev, [r.domain]: initVal }))
                                        if (!committed || committed === '__taken__') {
                                          setTimeout(() => e.target.setSelectionRange(1, 1), 0)
                                        }
                                      }
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); toggleExpand(g.base) } }}
                                    onBlur={e => handleManualPriceBlur(r.domain, e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                  />
                                ) : (
                                  ep ?? '—'
                                )}
                              </td>
                              <td>
                                {!isTakenStar && !isTaken && r.purchase_url
                                  ? <a href={r.purchase_url} target="_blank" rel="noreferrer">
                                      {isBuy ? 'Buy →' : r.status === 'unknown' ? 'Check →' : 'Inquire →'}
                                    </a>
                                  : '—'}
                              </td>
                            </tr>
                          )
                        })}
                    </React.Fragment>
                    )
                  })}
                  {streaming && (
                    <tr className="streaming-row">
                      <td colSpan={4}>
                        {paused
                          ? '⏸ Paused — click Resume to continue'
                          : <><span className="spinner" /> Checking more domains…</>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
  ) : null

  if (compact) {
    return (
      <>
        {error && <p className="error-msg">{error}</p>}
        {resultsSection}
      </>
    )
  }

  return (
    <div className="app">
      <form className="search-panel" onSubmit={handleSearch}>
        <div className="field">
          <label htmlFor="terms">Domain terms</label>
          <input
            id="terms"
            type="text"
            placeholder="e.g. combindex capitalcircuit"
            value={terms}
            onChange={e => setTerms(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="tld-header">
            <label>Extensions</label>
            <div className="mode-toggle">
              <button type="button" className={`mode-btn${activeTldMode === 'or' ? ' active' : ''}`} onClick={() => setTldMode('or')}>ANY</button>
              <button type="button" className={`mode-btn${activeTldMode === 'and' ? ' active' : ''}`} onClick={() => setTldMode('and')}>ALL</button>
            </div>
          </div>
          <p className="mode-hint">{modeHint}</p>
          <div className="tld-grid">
            {DEFAULT_TLDS.map(tld => (
              <label key={tld} className="tld-chip">
                <input type="checkbox" checked={activeTlds.has(tld)} onChange={() => toggleTld(tld)} />
                {tld}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Price range <span className="field-optional">(optional)</span></label>
          <div className="price-range">
            <div className="price-input">
              <span className="price-symbol">$</span>
              <input type="text" inputMode="decimal" placeholder="Min" value={fmtPriceInput(priceMin)} onChange={e => applyPriceChange(e, setPriceMin)} />
            </div>
            <span className="price-sep">—</span>
            <div className="price-input">
              <span className="price-symbol">$</span>
              <input type="text" inputMode="decimal" placeholder="Max" value={fmtPriceInput(priceMax)} onChange={e => applyPriceChange(e, setPriceMax)} />
            </div>
          </div>
          {rangeError && <p className="field-error">{rangeError}</p>}
        </div>

        <div className="field">
          <div className="tld-header">
            <label>Priority Check <span className="field-optional"> — optional</span></label>
          </div>
          <div className="priority-input-row">
            <input
              type="text"
              placeholder="e.g. myname1 myname2 — press Enter"
              value={priorityInput}
              onChange={e => setPriorityInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePrioritySubmit() } }}
            />
            <button
              type="button"
              className="btn-priority"
              onClick={handlePrioritySubmit}
              disabled={!priorityInput.trim() || !activeTlds.size}
            >
              Check First
            </button>
          </div>
          <p className="mode-hint">These names jump the queue — checked before others resume</p>
        </div>

        <div className="search-actions">
          <button
            className="btn-search"
            type={streaming ? 'button' : 'submit'}
            disabled={!streaming && !canSearch}
            onClick={streaming ? (paused ? handleResume : handlePause) : undefined}
          >
            {streaming
              ? (paused ? '▶ Resume' : '⏸ Pause')
              : (loading ? <><span className="spinner" />Searching…</> : 'Search')}
          </button>
          <button
            className={`btn-stop${streaming ? '' : ' btn-stop--hidden'}`}
            type="button"
            onClick={handleStop}
          >
            Stop
          </button>
        </div>
      </form>

      {error && <p className="error-msg">{error}</p>}
      {resultsSection}
    </div>
  )
})

export default DomainChecker
