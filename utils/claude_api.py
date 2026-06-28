"""
utils/claude_api.py - Groq AI Integration
AI Study Notes Generator
-----------------------------------------
Uses Groq API (100% Free)
- OpenAI-compatible API
- Super fast LPU inference
- 14,400 requests/day free
"""

import re
import json
import logging
import requests
import time

logger = logging.getLogger(__name__)

GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"


# ─────────────────────────────────────────
# Core Groq API Call
# ─────────────────────────────────────────
def truncate_prompt_for_tpm(prompt: str, max_chars: int = 12000) -> str:
    """Truncates the STUDY MATERIAL section inside a prompt to avoid TPM errors on smaller models."""
    for marker in ["STUDY MATERIAL:", "STUDY MATERIAL"]:
        if marker in prompt:
            parts = prompt.split(marker, 1)
            before = parts[0]
            after = parts[1]
            
            # Keep instructions at the end (e.g. Return ONLY the JSON:)
            end_marker = "Return ONLY the JSON:"
            if end_marker in after:
                sub_parts = after.split(end_marker, 1)
                material = sub_parts[0]
                json_instructions = sub_parts[1]
                truncated_material = material[:max_chars] + "\n[Text truncated to fit model token limits...]\n"
                return before + marker + truncated_material + end_marker + json_instructions
            
            truncated_material = after[:max_chars] + "\n[Text truncated to fit model token limits...]"
            return before + marker + truncated_material

    # Default fallback
    if len(prompt) > max_chars:
        return prompt[:max_chars] + "\n[Prompt truncated...]"
    return prompt


def call_groq(api_key: str, prompt: str, model: str = "llama-3.3-70b-versatile", max_tokens: int = 4096) -> str:
    """
    Call Groq API (OpenAI-compatible).
    """
    # Truncate prompt if using a low TPM model (like 8B or gemma) to prevent HTTP 413
    if model in ["llama-3.1-8b-instant", "gemma2-9b-it"]:
        prompt = truncate_prompt_for_tpm(prompt, max_chars=8000)
        # Estimate input tokens (average 3 characters per token to be conservative)
        input_tokens_estimate = len(prompt) // 3
        # Ensure that input_tokens + max_tokens is safely under the 6000 TPM limit
        max_tokens = min(max_tokens, max(1000, 5800 - input_tokens_estimate))

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json"
    }

    payload = {
        "model":       model,
        "messages": [
            {
                "role":    "system",
                "content": "You are an expert academic assistant and study notes generator. Always respond clearly, accurately and in the exact format requested."
            },
            {
                "role":    "user",
                "content": prompt
            }
        ],
        "max_tokens":  max_tokens,
        "temperature": 0.7
    }

    logger.info(f"Sending request to Groq API...")
    logger.info(f"Model: {model}")

    max_retries = 5
    retry_delay = 5
    for attempt in range(max_retries):
        try:
            response = requests.post(
                GROQ_BASE_URL,
                headers=headers,
                json=payload,
                timeout=120
            )

            logger.info(f"Response status: {response.status_code}")
            data = response.json()

            # ── Handle Rate Limit (429) ──
            if response.status_code == 429:
                error_info = data.get("error", {})
                message = error_info.get("message", "")
                logger.warning(f"Groq rate limit response message: {message}")
                
                # Check if it's a daily token limit (TPD)
                if "tokens per day" in message.lower() or "tpd" in message.lower() or "daily" in message.lower():
                    fallback_models = ["llama-3.1-8b-instant", "gemma2-9b-it"]
                    next_model = None
                    for fb in fallback_models:
                        if fb != model:
                            next_model = fb
                            break
                    if next_model:
                        logger.warning(f"Daily token limit (TPD) reached for model {model}. Falling back to {next_model}...")
                        return call_groq(api_key, prompt, model=next_model, max_tokens=max_tokens)
                
                sleep_time = retry_delay
                # Try to parse exact backoff time (case-insensitive, multi-format)
                match = re.search(r'(?:try again in|retry after|in) (\d+\.?\d*)s', message, re.IGNORECASE)
                if match:
                    sleep_time = float(match.group(1)) + 1.5 # Add 1.5s buffer
                
                if attempt == max_retries - 1:
                    # If we fail all retries, fall back to the robust 8B model
                    if model != "llama-3.1-8b-instant":
                        logger.warning(f"Failed after {max_retries} attempts on {model}. Falling back to llama-3.1-8b-instant...")
                        return call_groq(api_key, prompt, model="llama-3.1-8b-instant", max_tokens=max_tokens)
                    raise ValueError(f"Groq API rate limit exceeded (429) after {max_retries} attempts. Details: {message}")
                
                logger.warning(f"Rate limit (429) reached. Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                time.sleep(sleep_time)
                continue

            # ── Handle other errors ──
            if response.status_code != 200:
                error_msg = data.get("error", {}).get("message", str(data))
                logger.error(f"Groq API error: {error_msg}")
                raise ValueError(f"Groq API error ({response.status_code}): {error_msg}")

            # ── Extract response ──
            choices = data.get("choices", [])
            if not choices:
                raise ValueError("No choices in Groq response")

            text = choices[0].get("message", {}).get("content", "")
            if not text:
                raise ValueError("Empty response from Groq API")

            logger.info(f"✅ Groq responded: {len(text)} chars")
            return text.strip()

        except requests.exceptions.Timeout:
            if attempt == max_retries - 1:
                raise ValueError("Request timed out. Try again.")
            logger.warning(f"Request timeout. Retrying in 2s...")
            time.sleep(2)
        except requests.exceptions.ConnectionError:
            if attempt == max_retries - 1:
                raise ValueError("Cannot connect to Groq API. Check your internet.")
            logger.warning(f"Connection error. Retrying in 2s...")
            time.sleep(2)
        except ValueError:
            raise
        except Exception as e:
            if attempt == max_retries - 1:
                raise ValueError(f"Unexpected error: {str(e)}")
            logger.warning(f"Unexpected error: {str(e)}. Retrying in 2s...")
            time.sleep(2)


def clean_json_response(text: str) -> str:
    """Strip markdown code fences from JSON responses."""
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return text.strip()


def robust_json_loads(text: str) -> dict:
    """Robustly loads a JSON object from text, fixing common LLM syntax issues."""
    cleaned = clean_json_response(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Extract JSON object using regex
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        json_str = match.group()
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Try cleaning trailing commas in objects and arrays
            cleaned_str = re.sub(r',\s*([\]}])', r'\1', json_str)
            try:
                return json.loads(cleaned_str)
            except json.JSONDecodeError:
                pass
    raise ValueError("Failed to parse JSON")


# ─────────────────────────────────────────
# 1. SUMMARY GENERATION
# ─────────────────────────────────────────

def generate_summary(api_key: str, text: str, model: str) -> dict:
    """Generate short, medium, and detailed summaries in a single call."""

    prompt = f"""You are an expert academic summarizer. 
From the study material below, generate three types of summaries:
1. Short Summary: 3-5 sentences covering main highlights.
2. Medium Summary: 2-3 paragraphs covering main topics and conclusions.
3. Detailed Summary: 4-6 paragraphs covering all major topics and conclusions.

CRITICAL: Return ONLY a valid JSON object with the keys "short", "medium", and "detailed". Do not include any markdown, code blocks, or extra text.

Format:
{{
  "short": "Short summary content...",
  "medium": "Medium summary content...",
  "detailed": "Detailed summary content..."
}}

STUDY MATERIAL:
{text}

Return ONLY the JSON:"""

    response = call_groq(api_key, prompt, model, max_tokens=3000)

    try:
        data = robust_json_loads(response)
        logger.info("✅ Summaries generated in a single call")
        # Structure as expected by frontend: return {"short": {"content": "..."}, "medium": {"content": "..."}, "detailed": {"content": "..."}}
        return {
            "short": {"content": data.get("short", "") or data.get("content", "")},
            "medium": {"content": data.get("medium", "") or data.get("content", "")},
            "detailed": {"content": data.get("detailed", "") or data.get("content", "")}
        }
    except Exception as e:
        logger.error(f"Error parsing summary JSON: {e}")
        # Fallback to splitting legacy response if the model didn't return JSON
        return {
            "short": {"content": response},
            "medium": {"content": response},
            "detailed": {"content": response}
        }


# ─────────────────────────────────────────
# 2. STUDY NOTES GENERATION
# ─────────────────────────────────────────

def generate_study_notes(api_key: str, text: str, model: str) -> dict:
    """Generate comprehensive structured study notes."""

    prompt = f"""You are an expert academic tutor. Create comprehensive study notes from the material below.

Use these EXACT section headers (use ## for main headers):

## Topic Title
## Introduction
## Key Definitions
## Important Concepts
## Detailed Explanations
## Real-World Applications
## Advantages & Benefits
## Disadvantages & Limitations
## Summary & Conclusion

RULES:
- Use bullet points where appropriate
- Bold important terms using **term**
- Write at university student level

STUDY MATERIAL:
{text}

Generate the complete study notes now:"""

    response = call_groq(api_key, prompt, model, max_tokens=4096)
    return {"content": response}


# ─────────────────────────────────────────
# 3. FLASHCARD GENERATION
# ─────────────────────────────────────────

def generate_flashcards(api_key: str, text: str, model: str, count: int = 20) -> dict:
    """Generate flashcards as JSON."""

    prompt = f"""Generate exactly {count} flashcards from the study material below.

CRITICAL: Return ONLY valid JSON — no extra text, no markdown code blocks.

Format:
{{
  "flashcards": [
    {{"id": 1, "question": "What is X?", "answer": "X is..."}},
    {{"id": 2, "question": "Explain Y.", "answer": "Y means..."}}
  ]
}}

Requirements:
- Exactly {count} flashcards
- Cover ALL major topics
- Clear questions, concise answers (2-4 sentences)

STUDY MATERIAL:
{text}

Return ONLY the JSON:"""

    response = call_groq(api_key, prompt, model, max_tokens=4096)

    try:
        data = robust_json_loads(response)
        logger.info(f"✅ Flashcards: {len(data.get('flashcards', []))} cards")
        return data
    except Exception as e:
        logger.error(f"Error parsing flashcards JSON: {e}")
        return {"flashcards": [], "raw": response}


# ─────────────────────────────────────────
# 4. QUIZ GENERATION
# ─────────────────────────────────────────

def generate_quiz(api_key: str, text: str, model: str) -> dict:
    """Generate complete quiz."""

    prompt = f"""Generate a quiz from the study material below.

CRITICAL: Return ONLY valid JSON — no extra text, no markdown.

Create exactly:
- 10 Multiple Choice Questions (under the "mcq" key)
- 8 True/False Questions (under the "true_false" key)
- 8 Fill in the Blank Questions (under the "fill_blank" key)
- 8 Short Answer Questions (under the "short_answer" key)

IMPORTANT: You must fully populate each of these arrays with the requested number of unique questions. Do not return empty arrays or single-item lists. Keep all explanations and answers extremely concise (maximum 1 short sentence) to prevent output token truncation.



Format:
{{
  "mcq": [
    {{
      "id": 1,
      "question": "Question?",
      "options": {{"A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D"}},
      "correct_answer": "A",
      "explanation": "Why A is correct."
    }}
  ],
  "true_false": [
    {{"id": 1, "question": "Statement.", "correct_answer": true, "explanation": "Reason."}}
  ],
  "fill_blank": [
    {{"id": 1, "question": "The _____ does X.", "answer": "word", "explanation": "Reason."}}
  ],
  "short_answer": [
    {{"id": 1, "question": "Question?", "answer": "Model answer.", "explanation": "Key points."}}
  ]
}}

STUDY MATERIAL:
{text}

Return ONLY the JSON:"""

    response = call_groq(api_key, prompt, model, max_tokens=4096)

    try:
        data = robust_json_loads(response)
        logger.info("✅ Quiz JSON parsed")
        return data
    except Exception as e:
        logger.error(f"Error parsing quiz JSON: {e}")
        return {"mcq": [], "true_false": [], "fill_blank": [], "short_answer": [], "raw": response}


# ─────────────────────────────────────────
# 5. IMPORTANT QUESTIONS
# ─────────────────────────────────────────

def generate_important_questions(api_key: str, text: str, model: str) -> dict:
    """Generate exam questions by difficulty."""

    prompt = f"""Generate university exam questions from the study material below.

CRITICAL: Return ONLY valid JSON — no extra text, no markdown.

Create:
- 5 EASY questions (5 marks each)
- 5 MEDIUM questions (10 marks each)
- 5 HARD questions (15 marks each)

Format:
{{
  "easy": [
    {{"id": 1, "question": "Q?", "marks": 5, "hint": "Key points.", "sample_answer": "Answer."}}
  ],
  "medium": [
    {{"id": 1, "question": "Q?", "marks": 10, "hint": "Key points.", "sample_answer": "Answer."}}
  ],
  "hard": [
    {{"id": 1, "question": "Q?", "marks": 15, "hint": "Key points.", "sample_answer": "Answer."}}
  ]
}}

STUDY MATERIAL:
{text}

Return ONLY the JSON:"""

    response = call_groq(api_key, prompt, model, max_tokens=4096)

    try:
        data = robust_json_loads(response)
        logger.info("✅ Questions JSON parsed")
        return data
    except Exception as e:
        logger.error(f"Error parsing questions JSON: {e}")
        return {"easy": [], "medium": [], "hard": [], "raw": response}


# ─────────────────────────────────────────
# 6. CHEAT SHEET GENERATION
# ─────────────────────────────────────────

def generate_cheat_sheet(api_key: str, text: str, model: str) -> dict:
    """Generate concise cheat sheet."""

    prompt = f"""Create a one-page cheat sheet from the study material below.

Use these EXACT section headers:

## ⚡ Quick Reference — [Topic Name]
### 📌 Key Definitions
### 🔑 Core Concepts
### 📐 Formulas & Rules
### 👥 Important Names & Dates
### 💡 Must-Remember Points
### ⚠️ Common Mistakes to Avoid
### 🎯 Exam Tips

RULES:
- Ultra concise — bullet points only
- Bold all key terms **like this**
- Scannable in under 2 minutes

STUDY MATERIAL:
{text}

Generate the cheat sheet:"""

    response = call_groq(api_key, prompt, model, max_tokens=2048)
    return {"content": response}


# ─────────────────────────────────────────
# 7. KEY CONCEPTS EXTRACTION
# ─────────────────────────────────────────

def generate_key_concepts(api_key: str, text: str, model: str) -> dict:
    """Extract key concepts as JSON."""

    prompt = f"""Extract key information from the study material below.

CRITICAL: Return ONLY valid JSON — no extra text, no markdown.

Format:
{{
  "important_terms": [
    {{"term": "Term", "definition": "Definition"}}
  ],
  "key_people": [
    {{"name": "Name", "significance": "Why important"}}
  ],
  "important_dates": [
    {{"date": "Date", "event": "What happened"}}
  ],
  "formulas_rules": [
    {{"name": "Name", "formula": "Formula", "description": "Meaning"}}
  ],
  "keywords": ["word1", "word2", "word3"],
  "main_topics": ["Topic 1", "Topic 2"]
}}

Return empty arrays [] for categories with no items.

STUDY MATERIAL:
{text}

Return ONLY the JSON:"""

    response = call_groq(api_key, prompt, model, max_tokens=2048)

    try:
        data = robust_json_loads(response)
        logger.info("✅ Key concepts JSON parsed")
        return data
    except Exception as e:
        logger.error(f"Error parsing key concepts JSON: {e}")
        return {
            "important_terms": [],
            "key_people": [],
            "important_dates": [],
            "formulas_rules": [],
            "raw": response
        }


# ─────────────────────────────────────────
# MASTER GENERATION FUNCTION
# ─────────────────────────────────────────

def generate_all(api_key: str, text: str, model: str = "llama-3.3-70b-versatile", options: dict = None) -> dict:
    """Generate all study materials using Groq API."""

    if options is None:
        options = {
            "summary":             True,
            "study_notes":         True,
            "flashcards":          True,
            "quiz":                True,
            "important_questions": True,
            "cheat_sheet":         True,
            "key_concepts":        True
        }

    logger.info(f"Starting generation with Groq model: {model}")

    results = {}
    errors  = {}

    sections = [
        ("summary", lambda: generate_summary(api_key, text, model)),
        ("study_notes",         lambda: generate_study_notes(api_key, text, model)),
        ("flashcards",          lambda: generate_flashcards(api_key, text, model)),
        ("quiz",                lambda: generate_quiz(api_key, text, model)),
        ("important_questions", lambda: generate_important_questions(api_key, text, model)),
        ("cheat_sheet",         lambda: generate_cheat_sheet(api_key, text, model)),
        ("key_concepts",        lambda: generate_key_concepts(api_key, text, model)),
    ]

    for name, fn in sections:
        if not options.get(name, True):
            continue
        logger.info(f"🚀 Generating {name}...")
        try:
            results[name] = fn()
            logger.info(f"✅ {name} done")
        except Exception as e:
            errors[name]  = str(e)
            results[name] = None
            logger.error(f"❌ {name} failed: {e}")

    results["errors"] = list(errors.values()) if errors else []
    logger.info(f"✅ Generation complete. {len([k for k,v in results.items() if v and k != 'errors'])} sections.")
    return results
