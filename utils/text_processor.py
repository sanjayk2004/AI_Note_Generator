"""
utils/text_processor.py - Text Processing & Statistics
AI Study Notes Generator
-----------------------------------------
Handles:
- Text cleaning & normalization
- Word count calculation
- Reading time estimation
- Study time estimation
- Text chunking for large documents
- Text validation
"""

import re
import math
import logging

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────
# Text Cleaning
# ─────────────────────────────────────────

def clean_text(text: str) -> str:
    """
    Clean and normalize extracted text.
    Removes extra whitespace, special characters,
    and fixes common extraction artifacts.

    Args:
        text: Raw extracted text

    Returns:
        Cleaned text string
    """
    if not text:
        return ""

    # ── Remove null bytes & control characters ──
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

    # ── Fix multiple newlines (keep max 2) ──
    text = re.sub(r'\n{3,}', '\n\n', text)

    # ── Fix multiple spaces ──
    text = re.sub(r'[ \t]{2,}', ' ', text)

    # ── Remove lines with only special characters ──
    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        # Keep line if it has at least one alphanumeric character
        if stripped and re.search(r'[a-zA-Z0-9]', stripped):
            cleaned_lines.append(stripped)
        elif stripped == '':
            cleaned_lines.append('')

    text = '\n'.join(cleaned_lines)

    # ── Fix common PDF extraction artifacts ──
    text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)   # Fix hyphenated line breaks
    text = re.sub(r'\n([a-z])', r' \1', text)        # Join broken sentences

    # ── Strip leading/trailing whitespace ──
    text = text.strip()

    logger.info(f"✅ Text cleaned: {len(text)} characters")
    return text


# ─────────────────────────────────────────
# Text Validation
# ─────────────────────────────────────────

def validate_text(text: str, min_length: int = 50, max_length: int = 50000) -> dict:
    """
    Validate text before sending to Claude API.

    Args:
        text:       Input text to validate
        min_length: Minimum required characters
        max_length: Maximum allowed characters

    Returns:
        dict with 'valid' bool and 'error' message
    """
    if not text or not text.strip():
        return {
            "valid": False,
            "error": "No text provided. Please upload a file or paste some text."
        }

    text_length = len(text.strip())

    if text_length < min_length:
        return {
            "valid": False,
            "error": f"Text is too short ({text_length} characters). "
                     f"Please provide at least {min_length} characters."
        }

    if text_length > max_length:
        return {
            "valid": True,  # Still valid but will be truncated
            "error": None,
            "truncated": True,
            "original_length": text_length,
            "truncated_length": max_length
        }

    return {"valid": True, "error": None, "truncated": False}


# ─────────────────────────────────────────
# Reading Statistics
# ─────────────────────────────────────────

def calculate_word_count(text: str) -> int:
    """
    Calculate the number of words in text.

    Args:
        text: Input text

    Returns:
        Word count as integer
    """
    if not text:
        return 0

    # Split on whitespace and filter empty strings
    words = [w for w in text.split() if w.strip()]
    return len(words)


def calculate_reading_time(word_count: int, wpm: int = 200) -> dict:
    """
    Calculate estimated reading time.

    Args:
        word_count: Number of words
        wpm:        Words per minute (default: 200)

    Returns:
        dict with minutes and formatted string
    """
    if word_count == 0:
        return {"minutes": 0, "formatted": "0 min read"}

    total_minutes = word_count / wpm

    if total_minutes < 1:
        seconds = math.ceil(total_minutes * 60)
        return {
            "minutes": round(total_minutes, 1),
            "formatted": f"{seconds} sec read"
        }

    minutes = math.floor(total_minutes)
    seconds = math.ceil((total_minutes - minutes) * 60)

    if seconds >= 30:
        minutes += 1

    if minutes < 60:
        return {
            "minutes": minutes,
            "formatted": f"{minutes} min read"
        }

    hours = minutes // 60
    remaining_minutes = minutes % 60
    return {
        "minutes": minutes,
        "formatted": f"{hours}h {remaining_minutes}m read"
    }


def calculate_study_time(reading_minutes: int, multiplier: int = 3) -> dict:
    """
    Calculate estimated study time based on reading time.
    Study time is typically 3x reading time (review, notes, practice).

    Args:
        reading_minutes: Reading time in minutes
        multiplier:      Study time multiplier (default: 3)

    Returns:
        dict with minutes and formatted string
    """
    study_minutes = reading_minutes * multiplier

    if study_minutes < 60:
        return {
            "minutes": study_minutes,
            "formatted": f"{study_minutes} min"
        }

    hours = study_minutes // 60
    remaining = study_minutes % 60

    if remaining == 0:
        return {
            "minutes": study_minutes,
            "formatted": f"{hours} hour{'s' if hours > 1 else ''}"
        }

    return {
        "minutes": study_minutes,
        "formatted": f"{hours}h {remaining}m"
    }


def calculate_char_count(text: str) -> int:
    """
    Calculate character count (excluding spaces).

    Args:
        text: Input text

    Returns:
        Character count
    """
    return len(text.replace(" ", ""))


def get_text_statistics(text: str, wpm: int = 200, study_multiplier: int = 3) -> dict:
    """
    Get complete text statistics in one call.

    Args:
        text:             Input text
        wpm:              Words per minute reading speed
        study_multiplier: Study time multiplier

    Returns:
        dict with all statistics
    """
    cleaned = clean_text(text)
    word_count = calculate_word_count(cleaned)
    char_count = calculate_char_count(cleaned)
    reading = calculate_reading_time(word_count, wpm)
    study = calculate_study_time(reading["minutes"], study_multiplier)
    sentence_count = len(re.findall(r'[.!?]+', cleaned))
    paragraph_count = len([p for p in cleaned.split('\n\n') if p.strip()])

    stats = {
        "word_count":       word_count,
        "char_count":       char_count,
        "sentence_count":   sentence_count,
        "paragraph_count":  paragraph_count,
        "reading_time":     reading["formatted"],
        "reading_minutes":  reading["minutes"],
        "study_time":       study["formatted"],
        "study_minutes":    study["minutes"],
    }

    logger.info(f"📊 Stats: {word_count} words, {reading['formatted']} read, {study['formatted']} study")
    return stats


# ─────────────────────────────────────────
# Text Preparation for Claude API
# ─────────────────────────────────────────

def prepare_text_for_api(text: str, max_length: int = 50000) -> str:
    """
    Clean and truncate text for Claude API submission.
    Ensures text doesn't exceed token limits.

    Args:
        text:       Raw input text
        max_length: Maximum characters to send

    Returns:
        Cleaned, truncated text ready for API
    """
    # Clean first
    cleaned = clean_text(text)

    # Truncate if needed
    if len(cleaned) > max_length:
        # Try to truncate at a sentence boundary
        truncated = cleaned[:max_length]
        last_period = truncated.rfind('.')
        if last_period > max_length * 0.8:
            truncated = truncated[:last_period + 1]

        logger.warning(
            f"⚠️ Text truncated from {len(cleaned)} to {len(truncated)} chars"
        )
        return truncated

    return cleaned


# ─────────────────────────────────────────
# Text Chunking (for very large documents)
# ─────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = 10000, overlap: int = 500) -> list:
    """
    Split large text into overlapping chunks.
    Useful for processing very large documents.

    Args:
        text:       Input text
        chunk_size: Characters per chunk
        overlap:    Overlap between chunks

    Returns:
        List of text chunks
    """
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size

        # Try to break at sentence boundary
        if end < len(text):
            last_period = text.rfind('.', start, end)
            if last_period > start + chunk_size * 0.7:
                end = last_period + 1

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap

    logger.info(f"📦 Text split into {len(chunks)} chunks")
    return chunks
