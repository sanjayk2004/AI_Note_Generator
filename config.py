"""
config.py - Central Configuration File
AI Study Notes Generator
-----------------------------------------
Using Groq API (100% Free)
- 14,400 requests/day FREE
- No credit card needed
- Super fast responses
- Get key: https://console.groq.com
"""

import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(BASE_DIR, '.env')
load_dotenv(dotenv_path=env_path, override=True)


class Config:

    # ── Flask ──
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG      = os.getenv('DEBUG', 'True').lower() == 'true'
    HOST       = os.getenv('HOST', '0.0.0.0')
    PORT       = int(os.getenv('PORT', 5000))

    # ── Folders ──
    UPLOAD_FOLDER      = 'uploads'
    GENERATED_FOLDER   = 'generated'
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB

    # ── Allowed File Types ──
    ALLOWED_EXTENSIONS = {'pdf', 'docx', 'pptx', 'txt'}

    # ── Text Processing ──
    MIN_TEXT_LENGTH  = 50
    MAX_TEXT_LENGTH  = 50000
    WORDS_PER_MINUTE = 200
    STUDY_MULTIPLIER = 2.5

    # ── History ──
    MAX_HISTORY_ITEMS = 10

    # ─────────────────────────────────────────
    # GROQ API CONFIG
    # 100% Free — No credit card needed!
    # Get free key at: https://console.groq.com
    # 14,400 requests/day on small models
    # ─────────────────────────────────────────
    GROQ_API_KEY  = os.getenv('GROQ_API_KEY', '')
    GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"

    # ─────────────────────────────────────────
    # GROQ FREE MODELS (pick one)
    # ─────────────────────────────────────────
    # "llama-3.3-70b-versatile"   ← BEST quality (1000 req/day)
    # "llama3-8b-8192"            ← Fastest (14400 req/day)
    # "llama3-70b-8192"           ← Great quality (1000 req/day)
    # "gemma2-9b-it"              ← Good balance (14400 req/day)
    # "mixtral-8x7b-32768"        ← Long context (1000 req/day)
    # ─────────────────────────────────────────
    GROQ_MODEL = os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')

    # ── Compatibility aliases ──
    ANTHROPIC_API_KEY  = os.getenv('ANTHROPIC_API_KEY', '')
    OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY', '')
    GEMINI_API_KEY     = os.getenv('GEMINI_API_KEY', '')
    CLAUDE_MODEL       = GROQ_MODEL
    DEFAULT_MODEL      = GROQ_MODEL
    GEMINI_MODEL       = GROQ_MODEL


ActiveConfig = Config
