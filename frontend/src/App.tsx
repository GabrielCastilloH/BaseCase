import { useState, useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import './App.css'
import SearchIcon from './assets/mag.png'
import {
  CaseRagChatRequest,
  CaseRagResponse,
  CaseRagRequest,
  CaseRagState,
  ClassificationInfo,
  DeepDiveMessage,
  DeepDiveState,
  LegalCase,
  SearchRagResponse,
  SearchResponse,
  SearchSynthesisState,
  SimilarCase,
  SimilarCasesResponse,
} from './types'

function categoryClass(cat: string): string {
  const c = cat.toLowerCase()
  if (c.includes('personal injury') || c.includes('personal_injury')) return 'injury'
  if (c.includes('employment') || c.includes('employment_labor')) return 'employment'
  if (c.includes('copyright')) return 'copyright'
  return 'default'
}

const PILL_CATEGORIES = [
  { label: 'Personal Injury', key: 'personal_injury',  cls: 'injury' },
  { label: 'Employment Law',  key: 'employment_labor', cls: 'employment' },
  { label: 'Copyright',       key: 'copyright',        cls: 'copyright' },
]

/** Max textarea height (px); beyond this, content scrolls inside the box */
const SEARCH_INPUT_MAX_HEIGHT_PX = 176
const EMPTY_RAG_STATE: CaseRagState = {
  loading: false,
  answer: null,
  error: null,
  expanded: false,
}

const EMPTY_SYNTHESIS_STATE: SearchSynthesisState = {
  loading: false,
  text: null,
  error: null,
  expanded: false,
}

function parseDimLine(line: string): { positive: boolean; label: string } {
  const positive = line.startsWith('(+)')
  const label = line.replace(/^\([+-]\)\s*/, '')
  return { positive, label }
}

// The 10 named SVD dimensions — must match backend _DIMENSION_HUMAN_NAMES order
const RADAR_N = 10
const RADAR_KEYWORDS = ['General','Official','Administrative','Ohio','Federal','New','Employment','Medical','Copyright','Slip'] as const
const RADAR_SHORT_LABELS = ['Gen. Lit.','Pubs','Admin','Ohio','Fed.','NY','Employ.','Medical','Copyright','Slip/Fall']
const RADAR_AXIS_LABELS  = ['Gen. Litigation','Publications','Admin/Agency','Ohio Trial','Fed. Summary','New York','Employment','Medical','Copyright','Slip & Fall']

function dimToRadarIdx(label: string): number {
  const clean = label.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return RADAR_KEYWORDS.findIndex(kw => clean.startsWith(kw))
}

function topIdxsFromLabels(dims: string[]): number[] {
  const out: number[] = []
  dims.forEach(dim => {
    const raw = dim.replace(/^\([+-]\)\s*/, '')
    const idx = dimToRadarIdx(raw)
    if (idx >= 0) out.push(idx)
  })
  return out
}

function RadarChart({ values, topIdxs, size, showLabels = false, overlayValues }: {
  values: number[]
  topIdxs: number[]
  size: number
  showLabels?: boolean
  overlayValues?: number[]
}): JSX.Element {
  const vbox = showLabels ? 120 : 100
  const cx = vbox / 2, cy = vbox / 2
  const r = showLabels ? 38 : 36
  const labelR = r * 1.32

  const angle = (i: number) => (i / RADAR_N) * 2 * Math.PI - Math.PI / 2
  const px = (i: number, v: number) => cx + v * r * Math.cos(angle(i))
  const py = (i: number, v: number) => cy + v * r * Math.sin(angle(i))

  const vals = Array.from({ length: RADAR_N }, (_, i) => values[i] ?? 0)
  const polyPts = vals.map((v, i) => `${px(i, v).toFixed(2)},${py(i, v).toFixed(2)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${vbox} ${vbox}`} width={size} height={size} className="radar-svg" overflow="visible" aria-hidden="true">
      {/* Background rings — dashed inner, solid outer */}
      {[0.25, 0.5, 0.75, 1].map(ring => (
        <polygon
          key={ring}
          points={Array.from({ length: RADAR_N }, (_, i) => `${px(i, ring).toFixed(2)},${py(i, ring).toFixed(2)}`).join(' ')}
          fill="none"
          stroke={ring === 1 ? '#c0b4ba' : '#e8e0e4'}
          strokeWidth={ring === 1 ? '0.7' : '0.4'}
          strokeDasharray={ring < 1 ? '2 2' : undefined}
        />
      ))}
      {/* Axis spokes */}
      {Array.from({ length: RADAR_N }, (_, i) => (
        <line key={i} x1={cx} y1={cy}
          x2={px(i, 1).toFixed(2)} y2={py(i, 1).toFixed(2)}
          stroke="#ddd4d9" strokeWidth="0.4"
        />
      ))}
      {/* Overlay polygon — query activations, dashed blue-grey */}
      {overlayValues && overlayValues.length >= RADAR_N && (() => {
        const oVals = Array.from({ length: RADAR_N }, (_, i) => overlayValues[i] ?? 0)
        const oPts = oVals.map((v, i) => `${px(i, v).toFixed(2)},${py(i, v).toFixed(2)}`).join(' ')
        return (
          <polygon
            points={oPts}
            fill="rgba(61,90,122,0.12)"
            stroke="rgba(61,90,122,0.5)"
            strokeWidth={showLabels ? '1.2' : '1.0'}
            strokeLinejoin="round"
            strokeDasharray="3 2"
          />
        )
      })()}
      {/* Data polygon */}
      <polygon
        points={polyPts}
        fill="rgba(133,57,83,0.16)"
        stroke="rgba(133,57,83,0.75)"
        strokeWidth={showLabels ? '1.5' : '1.2'}
        strokeLinejoin="round"
      />
      {/* Axis labels (query chart only) */}
      {showLabels && Array.from({ length: RADAR_N }, (_, i) => {
        const a = angle(i)
        const lx = cx + labelR * Math.cos(a)
        const ly = cy + labelR * Math.sin(a)
        const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'
        const baseline = Math.sin(a) > 0.3 ? 'hanging' : Math.sin(a) < -0.3 ? 'auto' : 'middle'
        const isTop = topIdxs.includes(i)
        return (
          <text key={i}
            x={lx.toFixed(2)} y={ly.toFixed(2)}
            textAnchor={anchor} dominantBaseline={baseline}
            fontSize="9.5" fontFamily="IBM Plex Mono, monospace"
            fill={isTop ? '#853953' : '#b0a0a8'}
            fontWeight={isTop ? '700' : '400'}
          >
            {RADAR_SHORT_LABELS[i]}
          </text>
        )
      })}
      {/* Top-dim accent dots */}
      {topIdxs.map((idx, j) => (
        <circle key={idx}
          cx={px(idx, vals[idx]).toFixed(2)}
          cy={py(idx, vals[idx]).toFixed(2)}
          r={j === 0 ? 3.5 : j === 1 ? 2.6 : 2}
          fill="#853953"
          opacity={j === 0 ? 1 : 0.65}
        >
          <title>{RADAR_AXIS_LABELS[idx]}</title>
        </circle>
      ))}
    </svg>
  )
}
const EMPTY_DEEP_DIVE_STATE: DeepDiveState = {
  open: false,
  loading: false,
  error: null,
  messages: [],
  draft: '',
  similarCases: [],
  similarLoading: false,
}

function resultKey(c: LegalCase, idx: number): string {
  return `${c.case_name}::${idx}`
}

function App(): JSX.Element {
  const [useLlm, setUseLlm] = useState<boolean>(false)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [results, setResults] = useState<LegalCase[]>([])
  const [searchBusy, setSearchBusy] = useState<boolean>(false)
  const [searchSynthesis, setSearchSynthesis] = useState<SearchSynthesisState>(EMPTY_SYNTHESIS_STATE)
  const [rewriteActive, setRewriteActive] = useState<boolean>(false)
  const [queryUsedForRetrieval, setQueryUsedForRetrieval] = useState<string | null>(null)
  const synthesisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activatedDimensions, setActivatedDimensions] = useState<string[]>([])
  const [queryDimActivations, setQueryDimActivations] = useState<number[]>([])
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  const [classification, setClassification] = useState<ClassificationInfo | null>(null)
  const [ragByResult, setRagByResult] = useState<Record<string, CaseRagState>>({})
  const [deepDiveByResult, setDeepDiveByResult] = useState<Record<string, DeepDiveState>>({})
  const searchInputRef = useRef<HTMLTextAreaElement>(null)
  const deepDiveInputRef = useRef<HTMLTextAreaElement>(null)
  const deepDiveMessagesRef = useRef<HTMLDivElement>(null)
  const [activeDeepDiveKey, setActiveDeepDiveKey] = useState<string | null>(null)

  const fetchResults = async (
    q: string,
    categories: string[],
    opts?: { rewrite?: boolean },
  ): Promise<LegalCase[]> => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q)
    if (opts?.rewrite && q.trim()) params.set('rewrite', '1')
    for (const c of categories) params.append('category', c)
    setSearchBusy(true)
    try {
      const response = await fetch(`/api/search?${params.toString()}`)
      const data: SearchResponse = await response.json()
      setResults(data.results)
      setRagByResult({})
      setDeepDiveByResult({})
      setActiveDeepDiveKey(null)
      setActivatedDimensions(data.activated_dimensions ?? [])
      setQueryDimActivations(data.query_dim_activations ?? [])
      setClassification(data.classification ?? null)
      setQueryUsedForRetrieval(data.query_used_for_retrieval ?? null)
      setRewriteActive(Boolean(data.query_rewrite_applied))
      return data.results
    } finally {
      setSearchBusy(false)
    }
  }

  const triggerSynthesis = (q: string, cases: Array<{ name: string; snippet: string }>): void => {
    if (!useLlm || !q.trim() || cases.length === 0) return
    setSearchSynthesis({ loading: true, text: null, error: null, expanded: false })
    fetch('/api/search-rag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_query: q, cases }),
    })
      .then((r) => r.json())
      .then((d: SearchRagResponse) => {
        setSearchSynthesis({ loading: false, text: d.synthesis ?? null, error: d.error ?? null, expanded: false })
      })
      .catch(() => {
        setSearchSynthesis({ loading: false, text: null, error: 'Failed to generate AI summary.', expanded: false })
      })
  }

  const handleRunRag = async (c: LegalCase, idx: number): Promise<void> => {
    const key = resultKey(c, idx)
    setRagByResult((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? EMPTY_RAG_STATE), loading: true, error: null, expanded: true },
    }))

    try {
      const payload: CaseRagRequest = {
        user_query: searchTerm.trim(),
        case_name: c.case_name,
        case_idx: c.case_idx,
      }
      const response = await fetch('/api/case-rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data: CaseRagResponse = await response.json()
      if (!response.ok || !data.answer) {
        throw new Error(data.error ?? 'Could not generate response for this case.')
      }
      setRagByResult((prev) => ({
        ...prev,
        [key]: { loading: false, answer: data.answer ?? null, error: null, expanded: true },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not generate response for this case.'
      setRagByResult((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? EMPTY_RAG_STATE), loading: false, error: message, expanded: true },
      }))
    }
  }

  const toggleRagPanel = (c: LegalCase, idx: number): void => {
    const key = resultKey(c, idx)
    setRagByResult((prev) => {
      const current = prev[key]
      if (!current) return prev
      return { ...prev, [key]: { ...current, expanded: !current.expanded } }
    })
  }

  const openDeepDive = (c: LegalCase, idx: number): void => {
    const key = resultKey(c, idx)
    const ragState = ragByResult[key]
    if (!ragState?.answer) return
    setDeepDiveByResult((prev) => {
      const current = prev[key] ?? EMPTY_DEEP_DIVE_STATE
      const hasMessages = current.messages.length > 0
      const seededMessages: DeepDiveMessage[] = hasMessages
        ? current.messages
        : [{ role: 'assistant', content: ragState.answer ?? '' }]
      return {
        ...prev,
        [key]: {
          ...current,
          open: true,
          error: null,
          messages: seededMessages,
        },
      }
    })
    setActiveDeepDiveKey(key)
    document.body.style.overflow = 'hidden'

    const existingState = deepDiveByResult[key] ?? EMPTY_DEEP_DIVE_STATE
    if (existingState.similarCases.length === 0 && !existingState.similarLoading && c.case_idx != null) {
      setDeepDiveByResult((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? EMPTY_DEEP_DIVE_STATE), similarLoading: true },
      }))
      fetch(`/api/similar-cases?case_idx=${c.case_idx}&k=4`)
        .then((r) => r.json())
        .then((data: SimilarCasesResponse) => {
          setDeepDiveByResult((prev) => ({
            ...prev,
            [key]: { ...(prev[key] ?? EMPTY_DEEP_DIVE_STATE), similarCases: data.similar ?? [], similarLoading: false },
          }))
        })
        .catch(() => {
          setDeepDiveByResult((prev) => ({
            ...prev,
            [key]: { ...(prev[key] ?? EMPTY_DEEP_DIVE_STATE), similarLoading: false },
          }))
        })
    }
  }

  const closeDeepDive = (c: LegalCase, idx: number): void => {
    const key = resultKey(c, idx)
    setDeepDiveByResult((prev) => {
      const current = prev[key]
      if (!current) return prev
      return { ...prev, [key]: { ...current, open: false } }
    })
    setActiveDeepDiveKey((prev) => (prev === key ? null : prev))
    document.body.style.overflow = ''
  }

  const closeActiveDeepDive = (): void => {
    if (!activeDeepDiveKey) return
    setDeepDiveByResult((prev) => {
      const current = prev[activeDeepDiveKey]
      if (!current) return prev
      return { ...prev, [activeDeepDiveKey]: { ...current, open: false } }
    })
    setActiveDeepDiveKey(null)
    document.body.style.overflow = ''
  }

  const updateDeepDiveDraft = (c: LegalCase, idx: number, draft: string): void => {
    const key = resultKey(c, idx)
    setDeepDiveByResult((prev) => {
      const current = prev[key] ?? EMPTY_DEEP_DIVE_STATE
      return { ...prev, [key]: { ...current, draft } }
    })
  }

  const sendDeepDiveMessage = async (c: LegalCase, idx: number): Promise<void> => {
    const key = resultKey(c, idx)
    const current = deepDiveByResult[key] ?? EMPTY_DEEP_DIVE_STATE
    const text = current.draft.trim()
    if (!text || current.loading) return

    const nextMessages = [...current.messages, { role: 'user' as const, content: text }]
    setDeepDiveByResult((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? EMPTY_DEEP_DIVE_STATE),
        open: true,
        loading: true,
        error: null,
        draft: '',
        messages: nextMessages,
      },
    }))

    try {
      const payload: CaseRagChatRequest = {
        case_idx: c.case_idx,
        case_name: c.case_name,
        user_query: searchTerm.trim(),
        snippet: c.snippet,
        messages: nextMessages,
      }
      const response = await fetch('/api/case-rag-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data: CaseRagResponse = await response.json()
      if (!response.ok || !data.answer) {
        throw new Error(data.error ?? 'Could not continue deep-dive chat.')
      }
      setDeepDiveByResult((prev) => {
        const after = prev[key] ?? EMPTY_DEEP_DIVE_STATE
        return {
          ...prev,
          [key]: {
            ...after,
            loading: false,
            error: null,
            messages: [...after.messages, { role: 'assistant', content: data.answer ?? '' }],
          },
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not continue deep-dive chat.'
      setDeepDiveByResult((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? EMPTY_DEEP_DIVE_STATE),
          loading: false,
          error: message,
        },
      }))
    }
  }

  const activeDeepDiveContext = useMemo(() => {
    if (!activeDeepDiveKey) return null
    const idx = results.findIndex((c, i) => resultKey(c, i) === activeDeepDiveKey)
    if (idx < 0) return null
    return { caseItem: results[idx], idx }
  }, [activeDeepDiveKey, results])

  useEffect(() => {
    if (!activeDeepDiveContext) return
    const state = deepDiveByResult[activeDeepDiveKey ?? '']
    if (!state?.open) return
    deepDiveInputRef.current?.focus()
  }, [activeDeepDiveContext, activeDeepDiveKey, deepDiveByResult])

  useEffect(() => {
    const el = deepDiveMessagesRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeDeepDiveKey, deepDiveByResult])

  useEffect(() => {
    if (!activeDeepDiveKey) return
    const isOpen = deepDiveByResult[activeDeepDiveKey]?.open
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeActiveDeepDive()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeDeepDiveKey, deepDiveByResult])

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => setUseLlm(Boolean(d.use_llm)))
      .catch(() => {})
    fetchResults('', [])
  }, [])

  useEffect(() => {
    const el = searchInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, SEARCH_INPUT_MAX_HEIGHT_PX)}px`
  }, [searchTerm])

  const handleSearch = (value: string): void => {
    setRewriteActive(false)
    setQueryUsedForRetrieval(null)
    setSearchTerm(value)
    if (!value.trim()) {
      setActivatedDimensions([])
      setSearchSynthesis(EMPTY_SYNTHESIS_STATE)
      if (synthesisTimerRef.current) clearTimeout(synthesisTimerRef.current)
      fetchResults(value, activeCategories)
      return
    }
    fetchResults(value, activeCategories).then((fetchedResults) => {
      if (synthesisTimerRef.current) clearTimeout(synthesisTimerRef.current)
      if (fetchedResults.length === 0) return
      synthesisTimerRef.current = setTimeout(() => {
        triggerSynthesis(value, fetchedResults.slice(0, 5).map((r) => ({ name: r.case_name, snippet: r.snippet })))
      }, 5000)
    })
  }

  const runAiRewriteSearch = (): void => {
    const q = searchTerm.trim()
    if (!q || searchBusy) return
    fetchResults(searchTerm, activeCategories, { rewrite: !rewriteActive }).then((fetchedResults) => {
      if (synthesisTimerRef.current) clearTimeout(synthesisTimerRef.current)
      if (fetchedResults.length === 0) return
      synthesisTimerRef.current = setTimeout(() => {
        triggerSynthesis(q, fetchedResults.slice(0, 5).map((r) => ({ name: r.case_name, snippet: r.snippet })))
      }, 5000)
    })
  }

  const handlePillClick = (key: string): void => {
    const next = activeCategories.includes(key)
      ? activeCategories.filter((k) => k !== key)
      : [...activeCategories, key]
    setActiveCategories(next)
    fetchResults(searchTerm, next, { rewrite: rewriteActive && Boolean(searchTerm.trim()) }).then((fetchedResults) => {
      if (synthesisTimerRef.current) clearTimeout(synthesisTimerRef.current)
      if (!searchTerm.trim() || fetchedResults.length === 0) return
      synthesisTimerRef.current = setTimeout(() => {
        triggerSynthesis(searchTerm, fetchedResults.slice(0, 5).map((r) => ({ name: r.case_name, snippet: r.snippet })))
      }, 5000)
    })
  }

  return (
    <>
      <header className="site-header">
        <span className="site-title">BaseCase</span>
      </header>

      <main className="main-content">
        <div className="disclaimer-banner">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle', marginRight:'0.4rem', flexShrink:0}}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          This tool provides legal information only — not formal legal advice.
        </div>

        <div className="category-pills">
          {PILL_CATEGORIES.map(({ label, key, cls }) => {
            const candidate = classification?.candidates?.find((c) => c.key === key)
            const pct = candidate ? Math.round(candidate.score * 100) : null
            const isDetected = classification?.status === 'ok' && candidate != null &&
              classification.candidates[0]?.key === key
            return (
              <span
                key={key}
                className={[
                  'pill',
                  `pill-${cls}`,
                  activeCategories.includes(key) ? 'pill-active' : '',
                  isDetected && !activeCategories.includes(key) ? 'pill-detected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handlePillClick(key)}
              >
                {label}{pct !== null ? <span className="pill-pct"> ({pct}%)</span> : null}
              </span>
            )
          })}
        </div>

        <div className="search-row">
          <img src={SearchIcon} alt="" className="search-icon" />
          <textarea
            ref={searchInputRef}
            className="search-input"
            placeholder="Describe your legal situation…"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            onPaste={(e) => {
              setTimeout(() => handleSearch((e.target as HTMLTextAreaElement).value), 0)
            }}
            rows={1}
            autoFocus
            spellCheck
            aria-label="Describe your legal situation"
          />
        </div>
        {useLlm && (
          <div className="search-actions">
            <button
              type="button"
              className="rewrite-search-btn"
              onClick={runAiRewriteSearch}
              disabled={!searchTerm.trim() || searchBusy}
            >
              {searchBusy
                ? 'Searching...'
                : rewriteActive
                  ? 'Use Original Query'
                  : 'AI Rewrite Search'}
            </button>
            {searchTerm.trim() && (
              <p className="rewrite-note">
                Searching with {rewriteActive ? 'AI rewritten query' : 'original query'}:{' '}
                {queryUsedForRetrieval ?? searchTerm.trim()}
              </p>
            )}
          </div>
        )}

        {classification?.needs_user_category && searchTerm.trim() && (
          <div
            className={`classification-prompt${classification.status === 'no_match' ? ' classification-prompt-no-match' : ''}`}
            role="status"
          >
            <p className="classification-prompt-text">
              {classification.reason ??
                'Select one or more categories above to mix cases from those areas.'}
            </p>
          </div>
        )}

        {activatedDimensions.length > 0 && (
          <div className="query-explainability" aria-label="Query latent dimensions">
            <div className="dim-explainability-content">
              <span className="query-explainability-label">Strongest query themes:</span>
              <div className="dim-bars">
                {activatedDimensions.map((dim, j) => {
                  const { positive, label } = parseDimLine(dim)
                  return (
                    <div key={j} className={`dim-bar-row ${positive ? 'dim-pos' : 'dim-neg'}`}>
                      <span className="dim-sign">{positive ? '+' : '−'}</span>
                      <div className="dim-track">
                        <div className="dim-fill" style={{ width: `${100 - j * 28}%` }} />
                      </div>
                      <span className="dim-text">{label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <RadarChart values={queryDimActivations} topIdxs={topIdxsFromLabels(activatedDimensions)} size={115} showLabels />
          </div>
        )}

        {useLlm && searchTerm.trim() && results.length > 0 && (
          <div className="synthesis-banner">
            <div className="synthesis-header">
              <span className="synthesis-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                AI Legal Summary
              </span>
              {(searchSynthesis.text !== null || searchSynthesis.error !== null) ? (
                <button
                  type="button"
                  className="synthesis-toggle"
                  onClick={() => setSearchSynthesis((prev) => ({ ...prev, expanded: !prev.expanded }))}
                >
                  {searchSynthesis.expanded ? '▲ collapse' : '▼ expand'}
                </button>
              ) : (
                <span className="synthesis-loading-indicator">•••</span>
              )}
            </div>
            {!searchSynthesis.loading && searchSynthesis.expanded && (
              <div className="synthesis-body">
                {searchSynthesis.error && (
                  <p className="synthesis-error">{searchSynthesis.error}</p>
                )}
                {searchSynthesis.text && (
                  <p className="synthesis-text">{searchSynthesis.text}</p>
                )}
                <p className="synthesis-footnote">[n] refers to the nth result shown below</p>
              </div>
            )}
          </div>
        )}

        <div className="results-list">
          {results.map((c, i) => {
            const cat = categoryClass(c.category)
            const cardKey = resultKey(c, i)
            const ragState = ragByResult[cardKey] ?? EMPTY_RAG_STATE
            const diveState = deepDiveByResult[cardKey] ?? EMPTY_DEEP_DIVE_STATE
            const hasGenerated = Boolean(ragState.answer || ragState.error)
            return (
              <div
                key={i}
                className={`result-card cat-${cat}${diveState.open && activeDeepDiveKey === cardKey ? ' result-card-active-dive' : ''}`}
              >
                <div className="result-meta">
                  <span className={`category-badge badge-${cat}`}>{c.category.replace('_', ' ')}</span>
                  <span className="similarity-score">match: {(c.similarity * 100).toFixed(0)}%</span>
                </div>
                <h3 className="result-title">{c.case_name}</h3>

                <p className="result-snippet">{c.snippet}</p>
                {c.why && c.why.length > 0 && (
                  <div className="why-this-result">
                    <div className="dim-explainability-content">
                      <span className="why-label">Why this match?</span>
                      <div className="dim-bars dim-bars-sm">
                        {c.why.map((line, k) => {
                          const { positive, label } = parseDimLine(line)
                          return (
                            <div key={k} className={`dim-bar-row ${positive ? 'dim-pos' : 'dim-neg'}`}>
                              <span className="dim-sign">{positive ? '+' : '−'}</span>
                              <div className="dim-track">
                                <div className="dim-fill" style={{ width: `${100 - k * 25}%` }} />
                              </div>
                              <span className="dim-text">{label}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <RadarChart values={c.dim_activations ?? []} topIdxs={topIdxsFromLabels(c.why ?? [])} size={95} showLabels />
                  </div>
                )}
                <div className="rag-actions">
                  {useLlm && (
                    <button
                      type="button"
                      className="rag-btn"
                      disabled={ragState.loading || !searchTerm.trim()}
                      onClick={() => handleRunRag(c, i)}
                    >
                      {ragState.loading ? 'Generating...' : hasGenerated ? 'Regenerate' : 'Analyze Case'}
                    </button>
                  )}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="result-link">
                      see full case →
                    </a>
                  )}
                </div>
                {(ragState.answer || ragState.error) && (
                  <div className="case-analysis" role="status" aria-live="polite">
                    <div className="case-analysis-header" onClick={() => toggleRagPanel(c, i)}>
                      <span className="case-analysis-title">
                        <span className="case-analysis-chevron">{ragState.expanded ? '▼' : '▶'}</span>
                        AI Case Analysis
                      </span>
                      {ragState.answer && (
                        <button
                          type="button"
                          className="deep-dive-trigger"
                          onClick={(e) => {
                            e.stopPropagation()
                            diveState.open ? closeDeepDive(c, i) : openDeepDive(c, i)
                          }}
                        >
                          {diveState.open ? 'Close Deep Dive' : 'Deep Dive →'}
                        </button>
                      )}
                    </div>
                    {ragState.expanded && (
                      <div className="rag-panel">
                        {ragState.error ? (
                          <p className="rag-error">{ragState.error}</p>
                        ) : (
                          <div className="rag-answer">
                            <ReactMarkdown>{ragState.answer ?? ''}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {activeDeepDiveContext && activeDeepDiveKey && (deepDiveByResult[activeDeepDiveKey]?.open ?? false) && (() => {
          const { caseItem: c, idx } = activeDeepDiveContext
          const diveState = deepDiveByResult[activeDeepDiveKey] ?? EMPTY_DEEP_DIVE_STATE
          const cat = categoryClass(c.category)
          const topIdxs = topIdxsFromLabels(c.why ?? [])
          return (
            <div className="deep-dive-overlay" onClick={closeActiveDeepDive}>
              <div className="deep-dive-modal deep-dive-modal--two-panel" onClick={(e) => e.stopPropagation()}>

                {/* ── LEFT PANEL ─────────────────────────────────── */}
                <div className="dd-left-panel">

                  {/* Case Header */}
                  <div className="dd-case-header">
                    <div className="dd-case-header-top">
                      <span className={`category-badge badge-${cat} dd-category-badge`}>
                        {c.category.replace(/_/g, ' ')}
                      </span>
                      <span className="dd-similarity-badge">
                        {(c.similarity * 100).toFixed(0)}% match
                      </span>
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="dd-external-link"
                        >
                          See full opinion ↗
                        </a>
                      )}
                    </div>
                    <h2 className="dd-case-title">{c.case_name}</h2>
                  </div>

                  {/* Dual-Polygon Radar */}
                  <div className="dd-section dd-radar-section">
                    <span className="dd-section-label">Semantic Profile</span>
                    <div className="dd-radar-wrap">
                      <RadarChart
                        values={c.dim_activations ?? []}
                        topIdxs={topIdxs}
                        size={200}
                        showLabels
                        overlayValues={queryDimActivations}
                      />
                    </div>
                    <div className="dd-radar-legend">
                      <span className="dd-legend-case">&#8212; case</span>
                      <span className="dd-legend-query">&#8211; &#8211; query</span>
                    </div>
                  </div>

                  {/* Key Dimensions */}
                  {c.why && c.why.length > 0 && (
                    <div className="dd-section dd-dims-section">
                      <span className="dd-section-label">Key Dimensions</span>
                      <div className="dim-bars">
                        {c.why.map((line, k) => {
                          const { positive, label } = parseDimLine(line)
                          const dimIdx = dimToRadarIdx(label.replace(/\s*\([^)]*\)\s*$/, '').trim())
                          const barWidth = dimIdx >= 0 && c.dim_activations
                            ? Math.round((c.dim_activations[dimIdx] ?? 0) * 100)
                            : Math.max(0, 100 - k * 22)
                          return (
                            <div key={k} className={`dim-bar-row ${positive ? 'dim-pos' : 'dim-neg'}`}>
                              <span className="dim-sign">{positive ? '+' : '−'}</span>
                              <div className="dim-track">
                                <div className="dim-fill" style={{ width: `${barWidth}%` }} />
                              </div>
                              <span className="dim-text">{label}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Relevant Excerpt */}
                  <div className="dd-section dd-snippet-section">
                    <span className="dd-section-label">
                      Relevant Excerpt
                      {c.snippet_is_excerpt && <span className="dd-excerpt-hint"> · TF-IDF aligned</span>}
                    </span>
                    <blockquote className="dd-snippet-quote">{c.snippet}</blockquote>
                  </div>

                  {/* Similar Cases */}
                  <div className="dd-section dd-similar-section">
                    <span className="dd-section-label">Similar Cases</span>
                    {diveState.similarLoading && (
                      <p className="dd-similar-loading">Loading…</p>
                    )}
                    {!diveState.similarLoading && diveState.similarCases.length === 0 && (
                      <p className="dd-similar-empty">No similar cases found.</p>
                    )}
                    {diveState.similarCases.map((sc: SimilarCase) => (
                      <a
                        key={sc.case_idx}
                        href={sc.url || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`dd-similar-card${sc.url ? ' dd-similar-card--link' : ''}`}
                      >
                        <div className="dd-similar-name-row">
                          <span className="dd-similar-name">{sc.case_name}</span>
                          <span className="dd-similar-score">{(sc.similarity * 100).toFixed(0)}%</span>
                        </div>
                      </a>
                    ))}
                  </div>

                </div>

                {/* ── RIGHT PANEL ────────────────────────────────── */}
                <div className="dd-right-panel">

                  <div className="deep-dive-header">
                    <div className="deep-dive-header-info">
                      <span className="deep-dive-label">Deep Dive</span>
                      <span className="deep-dive-case-name">{c.case_name}</span>
                    </div>
                    <button type="button" className="deep-dive-close" onClick={closeActiveDeepDive}>✕</button>
                  </div>

                  <div className="deep-dive-messages" ref={deepDiveMessagesRef}>
                    {diveState.messages.map((m, mIdx) => (
                      <div
                        key={`${m.role}-${mIdx}`}
                        className={`deep-dive-bubble ${m.role === 'user' ? 'deep-dive-user' : 'deep-dive-assistant'}`}
                      >
                        {m.role === 'assistant'
                          ? <div className="deep-dive-md"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                          : m.content
                        }
                      </div>
                    ))}
                    {diveState.loading && (
                      <div className="deep-dive-bubble deep-dive-assistant deep-dive-thinking">Thinking…</div>
                    )}
                  </div>

                  {diveState.error && (
                    <p className="deep-dive-error">{diveState.error}</p>
                  )}

                  <div className="deep-dive-input-row">
                    <textarea
                      ref={deepDiveInputRef}
                      className="deep-dive-input"
                      value={diveState.draft}
                      placeholder="Ask a follow-up about this case… (Enter to send)"
                      onChange={(e) => updateDeepDiveDraft(c, idx, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendDeepDiveMessage(c, idx)
                        }
                      }}
                      rows={2}
                    />
                    <button
                      type="button"
                      className="deep-dive-send"
                      onClick={() => sendDeepDiveMessage(c, idx)}
                      disabled={Boolean(diveState.loading) || !diveState.draft.trim()}
                    >
                      Send
                    </button>
                  </div>

                </div>

              </div>
            </div>
          )
        })()}
      </main>
    </>
  )
}

export default App
