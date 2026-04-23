import os
import getpass
from infosci_spark_client import LLMClient
from dotenv import load_dotenv

load_dotenv()

key = os.environ.get("SPARK_API_KEY")
if not key:
    key = getpass.getpass("SPARK_API_KEY: ")

client = LLMClient(api_key=key)


def _chat_or_none(prompt):
    try:
        response = client.chat(prompt, stream=False, show_thinking=False)
        content = response.get("content")
        if content is None:
            return None
        text = str(content).strip()
        return text or None
    except Exception:
        return None


def _safe_chat(prompt):
    text = _chat_or_none(prompt)
    if text is not None:
        return text
    return "Could not get a model response (LLMClientError). Try again later."


def rewrite_query_for_retrieval(user_query: str) -> str:
    """
    Rewrite user query into a retrieval-focused legal search string.
    Falls back to the original query if the rewrite fails.
    """
    q = (user_query or "").strip()
    if not q:
        return ""

    system = """
You rewrite legal user queries for retrieval only.

Rules:
- Preserve intent, facts, and legal issue.
- Improve searchability with concise legal terms and common synonyms.
- Do not invent facts, names, dates, or outcomes.
- Do not answer the question.
- Output one line only, plain text.
""".strip()

    prompt = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": f"Original user query:\n{q}\n\nRewritten retrieval query:",
        },
    ]
    rewritten = _chat_or_none(prompt)
    if not rewritten:
        return q
    return " ".join(rewritten.split())[:280] or q


def run_search_rag(user_query: str, cases: list) -> str:
    """Synthesize a top-level answer from the top retrieved cases (global RAG panel)."""
    q = (user_query or "").strip()
    if not q:
        return "No question was provided."
    if not cases:
        return "No cases were provided."

    context_parts = []
    for i, c in enumerate(cases, 1):
        name = (c.get("name") or "").strip() or "Unknown case"
        snippet = (c.get("snippet") or "").strip()
        entry = f"[{i}] {name}"
        if snippet:
            entry += f"\n{snippet}"
        context_parts.append(entry)
    context = "\n\n".join(context_parts)

    system = """
You are a legal search assistant. Given a user's legal question and a set of relevant court cases retrieved by a search engine, synthesize a concise answer.

Rules:
- Base your answer only on the provided case summaries.
- Cite cases by their bracketed number [1], [2], etc. when referencing them.
- Keep the answer to 3-5 sentences total.
- Do not invent facts, holdings, or legal outcomes not present in the summaries.
- End with exactly this sentence: "Note: This is general legal information, not legal advice."
""".strip()

    prompt = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": f"User question: {q}\n\nRetrieved cases:\n{context}\n\nSynthesize a brief answer:",
        },
    ]
    return _safe_chat(prompt)


def run_case_rag(user_query: str, case_context: str, case_name: str) -> str:
    q = (user_query or "").strip()
    ctx = (case_context or "").strip()
    name = (case_name or "").strip() or "Unknown case"

    if not q:
        return "No question was provided."
    if not ctx:
        return "No case text was provided; nothing to answer from."

    rag_system = f"""
You are a legal search assistant. Ground every claim in the opinion text below. Do not invent facts or holdings.

Case: {name}

Rules:
- Be concise. Each section should be 1-3 sentences max.
- Quote or closely paraphrase the opinion at least once.
- Label any inference that goes beyond what the text directly says.
- No personal legal advice.

Use exactly these Markdown headings:

## What the case says
1-2 sentences: what this case is about and its key holding, with one quote if possible.

## How it applies
1-3 sentences: the strongest connection to the user's question. Label inferences clearly.

## Limits
1 sentence: what this case does not cover or establish.

## Disclaimer
One sentence: informational only; not legal advice.
""".strip()

    prompt = [
        {"role": "system", "content": rag_system},
        {
            "role": "user",
            "content": f"User query:\n{q}\n\nOpinion text:\n\n{ctx}",
        },
    ]

    return _safe_chat(prompt)


def run_case_rag_chat(
    *,
    user_query: str,
    case_name: str,
    snippet: str,
    messages,
) -> str:
    q = (user_query or "").strip()
    name = (case_name or "").strip() or "Unknown case"
    snip = (snippet or "").strip()
    turns = list(messages or [])
    if not turns:
        return "No chat messages were provided."

    sanitized = []
    for m in turns:
        role = (m.get("role") or "").strip()
        content = (m.get("content") or "").strip()
        if role not in ("user", "assistant"):
            continue
        if not content:
            continue
        sanitized.append({"role": role, "content": content})
    if not sanitized:
        return "No valid chat messages were provided."

    context_block = snip if snip else "No excerpt was provided."
    rag_chat_system = f"""
You are a legal deep-dive assistant continuing an existing case-specific conversation.

Case caption: {name}
Original user query: {q}

Grounding context:
{context_block}

Rules:
- Continue the conversation naturally; do not restart from scratch.
- Ground statements in the provided case context/excerpt and conversation history.
- If support is weak, explicitly label inference vs direct support.
- Keep answers concise but useful for follow-up discussion.
- Do not give personal legal advice; this is informational only.
""".strip()

    prompt = [{"role": "system", "content": rag_chat_system}] + sanitized
    return _safe_chat(prompt)


