import React, { useState, useRef, useEffect } from 'react'
import DomainChecker from './DomainChecker'
import './Generator.css'

const STYLES = [
  { value: 'auto',        label: 'Auto',              desc: 'Namelix picks the best style for your keywords each run' },
  { value: 'brandable',   label: 'Brandable Names',   desc: 'Invented words with a strong brand feel' },
  { value: 'evocative',   label: 'Evocative',         desc: 'Blended and portmanteau words that evoke feeling' },
  { value: 'multiword',   label: 'Compound Words',    desc: 'Two real words combined into one name' },
  { value: 'shortphrase', label: 'Short Phrase',      desc: 'Names with a rhythmic, memorable sound' },
  { value: 'spelling',    label: 'Alternate Spelling', desc: 'Familiar words with creative spelling tweaks' },
  { value: 'language',    label: 'Non-English Words', desc: 'Names inspired by non-English languages' },
  { value: 'dictionary',  label: 'Real Words',        desc: 'Real English dictionary words' },
]

const RANDOMNESS = [
  { value: 'low',    label: 'Low',    desc: 'Names stay close to your keywords' },
  { value: 'medium', label: 'Medium', desc: 'Balanced — recommended starting point' },
  { value: 'high',   label: 'High',   desc: 'Abstract — keywords loosely interpreted' },
]

const DEFAULT_TLDS = ['.com', '.net', '.org', '.ai', '.io', '.co', '.app', '.dev']

const GEN_API = import.meta.env.VITE_GEN_API ?? '/api/gen'

const SESSION_KEY = 'ngSession'
const DESC_MAX = 300

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

export default function Generator() {
  const [keywords, setKeywords] = useState('')
  const [description, setDescription] = useState('')
  const [style, setStyle] = useState('brandable')
  const [randomness, setRandomness] = useState('medium')
  const [count, setCount] = useState(1000)
  const [selectedTlds, setSelectedTlds] = useState(new Set(['.com', '.ai']))
  const [tldMode, setTldMode] = useState('and')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('10000')
  const [priorityInput, setPriorityInput] = useState('')
  const [names, setNames] = useState(null)
  const [streaming, setStreaming] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState(null)
  const [domainStreaming, setDomainStreaming] = useState(false)

  const abortRef = useRef(null)
  const namesRef = useRef([])
  const searchIdRef = useRef(null)
  const saveTimerRef = useRef(null)
  const domainCheckerRef = useRef(null)
  const streamingRef = useRef(false)
  const genPausedRef = useRef(false)
  const refillNamesRef = useRef(null)

  const anyStreaming = streaming || domainStreaming

  function toggleTld(tld) {
    setSelectedTlds(prev => {
      const next = new Set(prev)
      next.has(tld) ? next.delete(tld) : next.add(tld)
      return next
    })
  }

  // ── Session restore on mount ───────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return
    try {
      const d = JSON.parse(raw)
      if (d.names?.length) setNames(d.names)
      if (d.keywords)     setKeywords(d.keywords)
      if (d.description !== undefined) setDescription(d.description)
      if (d.style)        setStyle(d.style)
      if (d.randomness)   setRandomness(d.randomness)
      if (d.count)        setCount(d.count)
      if (d.selectedTlds?.length) setSelectedTlds(new Set(d.selectedTlds))
      if (d.tldMode)      setTldMode(d.tldMode)
      if (d.priceMin !== undefined) setPriceMin(d.priceMin)
      if (d.priceMax !== undefined) setPriceMax(d.priceMax)
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session auto-save (debounced 1 s) ─────────────────────────────────────
  useEffect(() => {
    if (names === null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          names, keywords, description, style, randomness, count,
          selectedTlds: [...selectedTlds], tldMode, priceMin, priceMax,
        }))
      } catch {}
    }, 1000)
  }, [names, keywords, description, style, randomness, count, selectedTlds, tldMode, priceMin, priceMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pause / Resume / Stop — controls both name gen and domain scan ─────────
  function handlePause() {
    setPaused(true)
    genPausedRef.current = true
    if (searchIdRef.current) {
      fetch(`${GEN_API}/pause/${searchIdRef.current}`, { method: 'POST' }).catch(() => {})
    }
    domainCheckerRef.current?.pause()
  }

  function handleResume() {
    setPaused(false)
    genPausedRef.current = false
    if (refillNamesRef.current !== null) {
      // names were deleted while paused — abort paused stream; refill effect will restart
      if (abortRef.current) abortRef.current.abort()
    } else {
      if (searchIdRef.current) {
        fetch(`${GEN_API}/resume/${searchIdRef.current}`, { method: 'POST' }).catch(() => {})
      }
    }
    domainCheckerRef.current?.resume()
  }

  function handleStop() {
    if (searchIdRef.current) {
      fetch(`${GEN_API}/resume/${searchIdRef.current}`, { method: 'POST' }).catch(() => {})
    }
    setPaused(false)
    genPausedRef.current = false
    refillNamesRef.current = null
    if (abortRef.current) abortRef.current.abort()
    domainCheckerRef.current?.stop()
  }

  // ── Priority submit ────────────────────────────────────────────────────────
  function handlePrioritySubmit() {
    if (!priorityInput.trim() || !selectedTlds.size) return
    const terms = [...new Set(priorityInput.trim().split(/[\s,]+/).filter(Boolean))]
    setNames(prev => [...new Set([...terms, ...(prev ?? [])])])
    domainCheckerRef.current?.submitPriority(terms)
    setPriorityInput('')
  }

  // ── Core generation logic ─────────────────────────────────────────────────
  async function startGeneration(existingNames) {
    if (!keywords.trim()) return
    if (existingNames.length >= count) return

    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    searchIdRef.current = crypto.randomUUID()

    namesRef.current = [...existingNames]
    setStreaming(true)
    streamingRef.current = true
    setPaused(false)
    genPausedRef.current = false
    setError(null)

    if (names === null) setNames([...existingNames])

    try {
      const res = await fetch(`${GEN_API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: keywords.trim(),
          description: description.trim(),
          style,
          randomness,
          count,
          search_id: searchIdRef.current,
          existing_names: existingNames,
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
          try {
            const obj = JSON.parse(t)
            if (obj.name) {
              namesRef.current = [...namesRef.current, obj.name]
              setNames([...namesRef.current])
            }
            if (obj.error) setError(obj.error)
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setStreaming(false)
      streamingRef.current = false
      setPaused(false)
      genPausedRef.current = false
    }
  }

  // When streaming ends, check if a refill was requested (names deleted while generator was active)
  useEffect(() => {
    if (streaming) return
    if (!refillNamesRef.current) return
    const refillNames = refillNamesRef.current
    refillNamesRef.current = null
    if (refillNames.length < count && keywords.trim()) {
      startGeneration(refillNames)
    }
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate ──────────────────────────────────────────────────────────────
  async function handleGenerate(e) {
    e.preventDefault()
    const existingNames = names ?? []
    if (!keywords.trim() || streaming) return
    if (existingNames.length >= count) return
    await startGeneration(existingNames)
  }

  const existingCount = names?.length ?? 0
  const atTarget = names !== null && !streaming && existingCount >= count
  const canGenerate = keywords.trim().length > 0 && !streaming && !atTarget

  const minVal = priceMin !== '' ? parseFloat(priceMin) : null
  const maxVal = priceMax !== '' ? parseFloat(priceMax) : null
  let rangeError = null
  if (minVal !== null && minVal < 0) rangeError = 'Min cannot be negative'
  else if (minVal !== null && maxVal !== null && maxVal < minVal) rangeError = 'Max must be ≥ min'

  const need = Math.max(0, count - existingCount)

  const selectedStyle = STYLES.find(s => s.value === style)
  const selectedRandomness = RANDOMNESS.find(r => r.value === randomness)
  const descLen = description.length
  const descGood   = descLen >= 100 && descLen <= 200
  const descOver   = descLen > 200  && descLen < 250
  const descDanger = descLen >= 250
  const descCounterMod = descGood ? ' desc-counter--good' : descOver ? ' desc-counter--warn' : descDanger ? ' desc-counter--danger' : ''
  const descInputMod   = descGood ? ' desc-ideal' : descOver ? ' desc-over' : descDanger ? ' desc-limit' : ''

  const tldHint = tldMode === 'or'
    ? 'Available if any selected extension is available'
    : 'Available only if all selected extensions are available'

  return (
    <div className="app">
      <form className="search-panel" onSubmit={handleGenerate}>

        <div className="field">
          <label htmlFor="keywords">Keywords</label>
          <input
            id="keywords"
            type="text"
            placeholder="e.g. alignment coordination communication"
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="field-label-row">
            <label htmlFor="description">
              Short Description
              <span className="field-optional"> — optional</span>
            </label>
            <span className={`desc-counter${descCounterMod}`}>
              {descLen}/{DESC_MAX}
            </span>
          </div>
          <input
            id="description"
            type="text"
            className={`desc-input${descInputMod}`}
            placeholder="e.g. Meeting prep tool that gives context about who you are meeting"
            value={description}
            maxLength={DESC_MAX}
            onChange={e => setDescription(e.target.value)}
          />
          <p className="mode-hint">100–200 chars advised for best results</p>
        </div>

        <div className="field">
          <label htmlFor="priority-input">
            Priority Check
            <span className="field-optional"> — optional</span>
          </label>
          <div className="priority-input-row">
            <input
              id="priority-input"
              type="text"
              placeholder="e.g. myname1 myname2 — press Enter to check these first"
              value={priorityInput}
              onChange={e => setPriorityInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePrioritySubmit() } }}
            />
            <button
              type="button"
              className="btn-priority"
              onClick={handlePrioritySubmit}
              disabled={!priorityInput.trim() || !selectedTlds.size}
            >
              Check First
            </button>
          </div>
          <p className="mode-hint">These names jump the queue — checked before the generated ones resume</p>
        </div>

        <div className="field">
          <label>Name Style</label>
          <div className="styles-grid">
            {STYLES.map(s => (
              <button
                key={s.value}
                type="button"
                className={`style-chip${style === s.value ? ' style-chip--active' : ''}`}
                onClick={() => setStyle(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mode-hint">{selectedStyle?.desc}</p>
        </div>

        <div className="field-row">
          <div className="field field-row--grow">
            <label>Generation Randomness</label>
            <div className="mode-toggle">
              {RANDOMNESS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  className={`mode-btn${randomness === r.value ? ' active' : ''}`}
                  onClick={() => setRandomness(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mode-hint">{selectedRandomness?.desc}</p>
          </div>
          <div className="field field-row--fixed">
            <label htmlFor="count">Target Name Count</label>
            <input
              id="count"
              type="number"
              min={1}
              value={count}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v)) setCount(Math.max(1, v))
              }}
              className="count-input"
            />
            {atTarget && <span className="count-hint count-hint--done">✓ Target reached</span>}
            {!atTarget && existingCount > 0 && <span className="count-hint">{existingCount} saved · {need} more</span>}
          </div>
        </div>

        <div className="field">
          <div className="tld-header">
            <label>Extensions</label>
            <div className="mode-toggle">
              <button
                type="button"
                className={`mode-btn${tldMode === 'or' ? ' active' : ''}`}
                onClick={() => setTldMode('or')}
              >
                ANY
              </button>
              <button
                type="button"
                className={`mode-btn${tldMode === 'and' ? ' active' : ''}`}
                onClick={() => setTldMode('and')}
              >
                ALL
              </button>
            </div>
          </div>
          <p className="mode-hint">{tldHint}</p>
          <div className="tld-grid">
            {DEFAULT_TLDS.map(tld => (
              <label key={tld} className="tld-chip">
                <input
                  type="checkbox"
                  checked={selectedTlds.has(tld)}
                  onChange={() => toggleTld(tld)}
                />
                {tld}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Price Range <span className="field-optional"> — optional</span></label>
          <div className="price-range">
            <div className="price-input">
              <span className="price-symbol">$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Min"
                value={fmtPriceInput(priceMin)}
                onChange={e => applyPriceChange(e, setPriceMin)}
              />
            </div>
            <span className="price-sep">—</span>
            <div className="price-input">
              <span className="price-symbol">$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Max"
                value={fmtPriceInput(priceMax)}
                onChange={e => applyPriceChange(e, setPriceMax)}
              />
            </div>
          </div>
          {rangeError && <p className="field-error">{rangeError}</p>}
        </div>

        <div className="search-actions">
          <button
            className="btn-search"
            type={anyStreaming ? 'button' : 'submit'}
            disabled={!anyStreaming && !canGenerate}
            onClick={anyStreaming ? (paused ? handleResume : handlePause) : undefined}
          >
            {anyStreaming
              ? (paused ? '▶ Resume' : '⏸ Pause')
              : atTarget ? 'At Target' : 'Find'}
          </button>
          <button
            className={`btn-stop${anyStreaming ? '' : ' btn-stop--hidden'}`}
            type="button"
            onClick={handleStop}
          >
            Stop
          </button>
        </div>

      </form>

      {error && <p className="error-msg">{error}</p>}

      <DomainChecker
        ref={domainCheckerRef}
        initialTerms={names ?? []}
        compact
        controlledTlds={selectedTlds}
        controlledTldMode={tldMode}
        controlledPriceMin={priceMin}
        controlledPriceMax={priceMax}
        onStreamingChange={setDomainStreaming}
        onStartOver={() => localStorage.removeItem(SESSION_KEY)}
        onDeleteBases={bases => {
          const basesSet = new Set(bases)
          const newNames = (streamingRef.current ? namesRef.current : (names ?? [])).filter(n => !basesSet.has(n))
          if (streamingRef.current) namesRef.current = [...newNames]
          setNames(newNames)
          if (streamingRef.current) {
            refillNamesRef.current = newNames
            if (!genPausedRef.current) {
              if (abortRef.current) abortRef.current.abort()
            }
          }
        }}
      />
    </div>
  )
}
