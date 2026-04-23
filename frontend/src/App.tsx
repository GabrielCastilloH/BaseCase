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
  expanded: true,
}

function parseDimLine(line: string): { positive: boolean; label: string } {
  const positive = line.startsWith('(+)')
  const label = line.replace(/^\([+-]\)\s*/, '')
  return { positive, label }
}
const EMPTY_DEEP_DIVE_STATE: DeepDiveState = {
  open: false,
  loading: false,
  error: null,
  messages: [],
  draft: '',
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
  const originalQueryRef = useRef<string>('')
  const rewriteCacheRef = useRef<{ original: string; rewritten: string; ts: number } | null>(null)
  const [activatedDimensions, setActivatedDimensions] = useState<string[]>([])
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  const [classification, setClassification] = useState<ClassificationInfo | null>(null)
  const [ragByResult, setRagByResult] = useState<Record<string, CaseRagState>>({})
  const [deepDiveByResult, setDeepDiveByResult] = useState<Record<string, DeepDiveState>>({})
  const searchInputRef = useRef<HTMLTextAreaElement>(null)
  const deepDiveInputRef = useRef<HTMLTextAreaElement>(null)
  const deepDiveMessagesRef = useRef<HTMLDivElement>(null)
  const [activeDeepDiveKey, setActiveDeepDiveKey] = useState<string | null>(null)

  const fetchResults = async (q: string, categories: string[]): Promise<void> => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q)
    for (const c of categories) params.append('category', c)
    setSearchBusy(true)
    setSearchSynthesis(EMPTY_SYNTHESIS_STATE)
    try {
      const response = await fetch(`/api/search?${params.toString()}`)
      const data: SearchResponse = await response.json()
      setResults(data.results)
      setRagByResult({})
      setDeepDiveByResult({})
      setActiveDeepDiveKey(null)
      setActivatedDimensions(data.activated_dimensions ?? [])
      setClassification(data.classification ?? null)

      if (useLlm && q.trim() && data.results.length > 0) {
        setSearchSynthesis({ loading: true, text: null, error: null, expanded: true })
        const casesPayload = data.results.slice(0, 5).map((r) => ({
          name: r.case_name,
          snippet: r.snippet,
        }))
        fetch('/api/search-rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_query: q, cases: casesPayload }),
        })
          .then((r) => r.json())
          .then((d: SearchRagResponse) => {
            setSearchSynthesis({
              loading: false,
              text: d.synthesis ?? null,
              error: d.error ?? null,
              expanded: true,
            })
          })
          .catch(() => {
            setSearchSynthesis({
              loading: false,
              text: null,
              error: 'Failed to generate AI summary.',
              expanded: true,
            })
          })
      }
    } finally {
      setSearchBusy(false)
    }
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
  }

  const closeDeepDive = (c: LegalCase, idx: number): void => {
    const key = resultKey(c, idx)
    setDeepDiveByResult((prev) => {
      const current = prev[key]
      if (!current) return prev
      return { ...prev, [key]: { ...current, open: false } }
    })
    setActiveDeepDiveKey((prev) => (prev === key ? null : prev))
  }

  const closeActiveDeepDive = (): void => {
    if (!activeDeepDiveKey) return
    setDeepDiveByResult((prev) => {
      const current = prev[activeDeepDiveKey]
      if (!current) return prev
      return { ...prev, [activeDeepDiveKey]: { ...current, open: false } }
    })
    setActiveDeepDiveKey(null)
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
    if (rewriteActive) {
      setRewriteActive(false)
    }
    setSearchTerm(value)
    fetchResults(value, activeCategories)
    if (!value.trim()) setActivatedDimensions([])
  }

  const handleEnhanceToggle = async (): Promise<void> => {
    if (rewriteActive) {
      const orig = originalQueryRef.current
      setSearchTerm(orig)
      setRewriteActive(false)
      fetchResults(orig, activeCategories)
      return
    }

    const q = searchTerm.trim()
    if (!q || searchBusy) return

    const cache = rewriteCacheRef.current
    if (cache && cache.original === q && Date.now() - cache.ts < 60_000) {
      originalQueryRef.current = q
      setSearchTerm(cache.rewritten)
      setRewriteActive(true)
      fetchResults(cache.rewritten, activeCategories)
      return
    }

    originalQueryRef.current = q
    setSearchBusy(true)
    setSearchSynthesis(EMPTY_SYNTHESIS_STATE)
    try {
      const params = new URLSearchParams({ q, rewrite: '1' })
      for (const c of activeCategories) params.append('category', c)
      const response = await fetch(`/api/search?${params}`)
      const data: SearchResponse = await response.json()
      const rewritten = data.query_used_for_retrieval ?? q
      rewriteCacheRef.current = { original: q, rewritten, ts: Date.now() }
      setSearchTerm(rewritten)
      setRewriteActive(true)
      setResults(data.results)
      setRagByResult({})
      setDeepDiveByResult({})
      setActiveDeepDiveKey(null)
      setActivatedDimensions(data.activated_dimensions ?? [])
      setClassification(data.classification ?? null)

      if (useLlm && data.results.length > 0) {
        setSearchSynthesis({ loading: true, text: null, error: null, expanded: true })
        const casesPayload = data.results.slice(0, 5).map((r) => ({ name: r.case_name, snippet: r.snippet }))
        fetch('/api/search-rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_query: q, cases: casesPayload }),
        })
          .then((r) => r.json())
          .then((d: SearchRagResponse) => {
            setSearchSynthesis({ loading: false, text: d.synthesis ?? null, error: d.error ?? null, expanded: true })
          })
          .catch(() => {
            setSearchSynthesis({ loading: false, text: null, error: 'Failed to generate AI summary.', expanded: true })
          })
      }
    } finally {
      setSearchBusy(false)
    }
  }

  const handlePillClick = (key: string): void => {
    const next = activeCategories.includes(key)
      ? activeCategories.filter((k) => k !== key)
      : [...activeCategories, key]
    setActiveCategories(next)
    fetchResults(searchTerm, next)
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
          {useLlm && (
            <button
              type="button"
              className={`enhance-btn${rewriteActive ? ' enhance-btn-active' : ''}`}
              onClick={handleEnhanceToggle}
              disabled={!searchTerm.trim() || searchBusy}
              title={rewriteActive ? 'Switch back to original query' : 'Rewrite query with AI for better results'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              {rewriteActive ? 'AI Enhanced' : 'AI Enhance'}
            </button>
          )}
        </div>


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
            <span className="query-explainability-label">Strongest query themes (SVD):</span>
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
        )}

        {useLlm && searchTerm.trim() && (results.length > 0 || searchSynthesis.loading) && (
          <div className="synthesis-banner">
            <div className="synthesis-header">
              <span className="synthesis-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                AI Legal Summary
              </span>
              <button
                type="button"
                className="synthesis-toggle"
                onClick={() => setSearchSynthesis((prev) => ({ ...prev, expanded: !prev.expanded }))}
              >
                {searchSynthesis.expanded ? '▲ collapse' : '▼ expand'}
              </button>
            </div>
            {searchSynthesis.expanded && (
              <div className="synthesis-body">
                {searchSynthesis.loading && (
                  <p className="synthesis-loading">Synthesizing from retrieved cases…</p>
                )}
                {!searchSynthesis.loading && searchSynthesis.error && (
                  <p className="synthesis-error">{searchSynthesis.error}</p>
                )}
                {!searchSynthesis.loading && searchSynthesis.text && (
                  <p className="synthesis-text">{searchSynthesis.text}</p>
                )}
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
                  {useLlm && (
                    <button
                      type="button"
                      className="rag-btn rag-btn-meta"
                      disabled={ragState.loading || !searchTerm.trim()}
                      onClick={() => handleRunRag(c, i)}
                    >
                      {ragState.loading ? 'Generating...' : hasGenerated ? 'Regenerate' : 'Analyze Case'}
                    </button>
                  )}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="result-link result-link-meta">
                      see full case →
                    </a>
                  )}
                  <span className="similarity-score">match: {(c.similarity * 100).toFixed(0)}%</span>
                </div>
                <h3 className="result-title">{c.case_name}</h3>

                <p className="result-snippet">{c.snippet}</p>
                {c.why && c.why.length > 0 && (
                  <div className="why-this-result">
                    <span className="why-label">Why this match? (SVD latent themes)</span>
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
                )}
                {(ragState.answer || ragState.error) && (
                  <div className="case-analysis" role="status" aria-live="polite">
                    <div className="case-analysis-header" onClick={() => toggleRagPanel(c, i)}>
                      <span className="case-analysis-title">
                        <span className="case-analysis-chevron">{ragState.expanded ? '▼' : '▶'}</span>
                        Case Analysis
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
        {activeDeepDiveContext && activeDeepDiveKey && (deepDiveByResult[activeDeepDiveKey]?.open ?? false) && (
          <div className="deep-dive-overlay" onClick={closeActiveDeepDive}>
            <div className="deep-dive-modal" onClick={(e) => e.stopPropagation()}>
              <div className="deep-dive-header">
                <div className="deep-dive-header-info">
                  <span className="deep-dive-label">Deep Dive</span>
                  <span className="deep-dive-case-name">{activeDeepDiveContext.caseItem.case_name}</span>
                </div>
                <button type="button" className="deep-dive-close" onClick={closeActiveDeepDive}>✕</button>
              </div>

              <div className="deep-dive-messages" ref={deepDiveMessagesRef}>
                {(deepDiveByResult[activeDeepDiveKey]?.messages ?? []).map((m, mIdx) => (
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
                {deepDiveByResult[activeDeepDiveKey]?.loading && (
                  <div className="deep-dive-bubble deep-dive-assistant deep-dive-thinking">Thinking…</div>
                )}
              </div>

              {deepDiveByResult[activeDeepDiveKey]?.error && (
                <p className="deep-dive-error">{deepDiveByResult[activeDeepDiveKey]?.error}</p>
              )}

              <div className="deep-dive-input-row">
                <textarea
                  ref={deepDiveInputRef}
                  className="deep-dive-input"
                  value={deepDiveByResult[activeDeepDiveKey]?.draft ?? ''}
                  placeholder="Ask a follow-up about this case… (Enter to send)"
                  onChange={(e) => updateDeepDiveDraft(activeDeepDiveContext.caseItem, activeDeepDiveContext.idx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendDeepDiveMessage(activeDeepDiveContext.caseItem, activeDeepDiveContext.idx)
                    }
                  }}
                  rows={2}
                />
                <button
                  type="button"
                  className="deep-dive-send"
                  onClick={() => sendDeepDiveMessage(activeDeepDiveContext.caseItem, activeDeepDiveContext.idx)}
                  disabled={
                    Boolean(deepDiveByResult[activeDeepDiveKey]?.loading) ||
                    !(deepDiveByResult[activeDeepDiveKey]?.draft ?? '').trim()
                  }
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}

export default App
