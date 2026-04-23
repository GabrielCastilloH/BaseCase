export interface LegalCase {
  case_idx?: number
  case_name: string
  category: string
  similarity: number
  snippet: string
  url: string
  /** True when snippet is a TF-IDF-aligned excerpt from the opinion, not a prefix */
  snippet_is_excerpt?: boolean
  /** SVD latent dimensions activated for this query (explainability) */
  why?: string[]
}

/** Classifier + routing; `needs_user_category` prompts pills for low_confidence and no_match */
export interface ClassificationInfo {
  status:
    | 'ok'
    | 'ambiguous'
    | 'low_confidence'
    | 'no_match'
    | 'browse'
    | 'user_selected'
  needs_user_category: boolean
  reason: string | null
  candidates: Array<{ key: string; label: string; score: number }>
}

export interface SearchResponse {
  results: LegalCase[]
  detected_category: string | null
  confidence: number | null
  /** Top latent semantic dimensions for the query (SVD explainability) */
  activated_dimensions?: string[]
  classification?: ClassificationInfo
  query_used_for_retrieval?: string
  query_rewrite_applied?: boolean
}

export interface CaseRagRequest {
  user_query: string
  case_name: string
  case_idx?: number
}

export interface CaseRagResponse {
  answer?: string
  case_name?: string
  error?: string
}

export interface CaseRagState {
  loading: boolean
  answer: string | null
  error: string | null
  expanded: boolean
}

export interface DeepDiveMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CaseRagChatRequest {
  case_idx?: number
  case_name?: string
  user_query: string
  snippet?: string
  messages: DeepDiveMessage[]
}

export interface DeepDiveState {
  open: boolean
  loading: boolean
  error: string | null
  messages: DeepDiveMessage[]
  draft: string
}
