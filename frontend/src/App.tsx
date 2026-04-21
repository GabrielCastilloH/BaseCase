import { useState, useEffect, useRef } from 'react'
import './App.css'
import SearchIcon from './assets/mag.png'
import { CaseRagRequest, CaseRagResponse, CaseRagState, ClassificationInfo, LegalCase, SearchResponse } from './types'

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

function resultKey(c: LegalCase, idx: number): string {
  return `${c.case_name}::${idx}`
}

function App(): JSX.Element {
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [results, setResults] = useState<LegalCase[]>([])
  const [detectedCategory, setDetectedCategory] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [activatedDimensions, setActivatedDimensions] = useState<string[]>([])
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  const [classification, setClassification] = useState<ClassificationInfo | null>(null)
  const [ragByResult, setRagByResult] = useState<Record<string, CaseRagState>>({})
  const searchInputRef = useRef<HTMLTextAreaElement>(null)

  const fetchResults = async (q: string, categories: string[]): Promise<void> => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q)
    for (const c of categories) {
      params.append('category', c)
    }
    const response = await fetch(`/api/search?${params.toString()}`)
    const data: SearchResponse = await response.json()
    setResults(data.results)
    setRagByResult({})
    setDetectedCategory(data.detected_category)
    setConfidence(data.confidence)
    setActivatedDimensions(data.activated_dimensions ?? [])
    setClassification(data.classification ?? null)
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

  useEffect(() => { fetchResults('', []) }, [])

  useEffect(() => {
    const el = searchInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, SEARCH_INPUT_MAX_HEIGHT_PX)}px`
  }, [searchTerm])

  const handleSearch = (value: string): void => {
    setSearchTerm(value)
    fetchResults(value, activeCategories)
    if (!value.trim()) {
      setDetectedCategory(null)
      setActivatedDimensions([])
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
          {PILL_CATEGORIES.map(({ label, key, cls }) => (
            <span
              key={key}
              className={`pill pill-${cls}${activeCategories.includes(key) ? ' pill-active' : ''}`}
              onClick={() => handlePillClick(key)}
            >
              {label}
            </span>
          ))}
        </div>
        <p className="category-pills-hint">You can select multiple categories to mix results.</p>

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

        {detectedCategory && (
          <div className="detected-category-block">
            <p className="detected-category">
              {classification?.status === 'ambiguous' ? (
                <>Matched areas: <strong>{detectedCategory}</strong></>
              ) : classification?.status === 'user_selected' ? (
                <>Filtering by: <strong>{detectedCategory}</strong></>
              ) : classification?.status === 'browse' ? (
                <>Showing: <strong>{detectedCategory}</strong></>
              ) : (
                <>
                  Detected area: <strong>{detectedCategory}</strong>
                  {classification?.status === 'ok' && confidence !== null && (
                    <span className="confidence">
                      {' '}
                      — {(confidence * 100).toFixed(0)}% confidence
                    </span>
                  )}
                </>
              )}
            </p>
            {classification?.status === 'ambiguous' && classification.reason && (
              <p className="ambiguous-note">{classification.reason}</p>
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
            <span className="query-explainability-label">Strongest query themes (SVD, query only):</span>
            <ul className="query-explainability-list">
              {activatedDimensions.map((dim, j) => (
                <li key={j}>{dim}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="results-list">
          {results.map((c, i) => {
            const cat = categoryClass(c.category)
            const cardKey = resultKey(c, i)
            const ragState = ragByResult[cardKey] ?? EMPTY_RAG_STATE
            const hasGenerated = Boolean(ragState.answer || ragState.error)
            return (
              <div key={i} className={`result-card cat-${cat}`}>
                <div className="result-meta">
                  <span className={`category-badge badge-${cat}`}>{c.category.replace('_', ' ')}</span>
                  <span className="similarity-score">match: {(c.similarity * 100).toFixed(0)}%</span>
                </div>
                <h3 className="result-title">{c.case_name}</h3>
                {c.snippet_is_excerpt && (
                  <p className="snippet-excerpt-hint">Excerpt aligned to your search</p>
                )}
                <p className="result-snippet">{c.snippet}</p>
                {c.why && c.why.length > 0 && (
                  <div className="why-this-result">
                    <span className="why-label">Why this match? (shared latent themes)</span>
                    <ul className="why-list">
                      {c.why.map((line, k) => (
                        <li key={k}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="result-link">
                    view on CourtListener →
                  </a>
                )}
                <div className="rag-actions">
                  <button
                    type="button"
                    className="rag-btn"
                    disabled={ragState.loading || !searchTerm.trim()}
                    onClick={() => handleRunRag(c, i)}
                  >
                    {ragState.loading ? 'Generating...' : hasGenerated ? 'Regenerate' : 'Run RAG'}
                  </button>
                  {hasGenerated && (
                    <button
                      type="button"
                      className="rag-toggle-btn"
                      onClick={() => toggleRagPanel(c, i)}
                    >
                      {ragState.expanded ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
                {!searchTerm.trim() && (
                  <p className="rag-hint">Enter a query to run case-level RAG.</p>
                )}
                {ragState.expanded && (ragState.answer || ragState.error) && (
                  <div className="rag-panel" role="status" aria-live="polite">
                    {ragState.error ? (
                      <p className="rag-error">{ragState.error}</p>
                    ) : (
                      <pre className="rag-answer">{ragState.answer}</pre>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </>
  )
}

export default App
