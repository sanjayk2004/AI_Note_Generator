"""
app.py - Main Flask Application
AI Study Notes Generator
-----------------------------------------
Updated to use Google Gemini API
Handles all routes:
- GET  /              → Main page
- POST /upload        → File upload & text extraction
- POST /generate      → AI content generation
- POST /export        → Export as PDF/DOCX/TXT
- GET  /download/<f>  → File download
- GET  /history       → Recent generations
- POST /clear-history → Clear history
- GET  /health        → Health check

FIX (History): Replaced Flask cookie-based session history with filesystem
storage. Flask cookie sessions are limited to ~4 KB; storing full AI-generated
content (10–80 KB) caused the cookie to silently overflow and be discarded by
the browser, so history was never persisted. The new approach writes one JSON
file per browser session to the GENERATED_FOLDER and stores only a small
session_id token in the cookie.
"""

import os
import uuid
import json
import logging
from datetime import datetime
from flask import (
    Flask, render_template, request,
    jsonify, send_file, session
)
from flask_cors import CORS
from werkzeug.utils import secure_filename

# ── Local Imports ──
from config import ActiveConfig
from utils.file_handlers import extract_text, validate_file
from utils.text_processor import (
    clean_text, validate_text,
    prepare_text_for_api, get_text_statistics
)
from utils.claude_api import generate_all, call_groq
from utils.exporter import export_content

# ─────────────────────────────────────────
# App Initialization
# ─────────────────────────────────────────

app = Flask(__name__)
app.config.from_object(ActiveConfig)
app.secret_key = ActiveConfig.SECRET_KEY

CORS(app)

# ── Logging Setup ──
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

# ── Ensure Required Directories Exist ──
os.makedirs(ActiveConfig.UPLOAD_FOLDER,    exist_ok=True)
os.makedirs(ActiveConfig.GENERATED_FOLDER, exist_ok=True)


# ─────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────

def allowed_file(filename: str) -> bool:
    """Check if uploaded file has an allowed extension."""
    return (
        '.' in filename and
        filename.rsplit('.', 1)[1].lower() in ActiveConfig.ALLOWED_EXTENSIONS
    )


# ── Filesystem-based history storage ──────────────────────────────────────────
# ROOT CAUSE FIX (History): Flask cookie sessions max out at ~4 KB.
# Storing full AI results (10–80 KB) in session['history'] silently overflows
# the cookie, which the browser discards, so history was never saved.
# Solution: keep only a small session_id in the cookie; write/read a JSON file
# per session in GENERATED_FOLDER. No new dependencies required.
# ──────────────────────────────────────────────────────────────────────────────

def _get_session_id() -> str:
    """Return (and create if missing) a stable session identifier stored in the cookie."""
    if 'session_id' not in session:
        session['session_id'] = uuid.uuid4().hex
        session.modified = True
    return session['session_id']


def _history_filepath(session_id: str) -> str:
    """Return the path of the history JSON file for this session."""
    # Use a safe filename: just hex characters, no path traversal possible.
    safe_sid = ''.join(c for c in session_id if c in 'abcdef0123456789')[:32]
    return os.path.join(ActiveConfig.GENERATED_FOLDER, f'history_{safe_sid}.json')


def get_history() -> list:
    """Read generation history from the filesystem (not the cookie)."""
    try:
        sid  = _get_session_id()
        path = _history_filepath(sid)
        if not os.path.exists(path):
            return []
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.warning(f"Could not read history file: {e}")
        return []


def save_to_history(entry: dict):
    """Write a generation entry to the filesystem history file."""
    try:
        sid     = _get_session_id()
        path    = _history_filepath(sid)
        history = get_history()
        history.insert(0, entry)
        history = history[:ActiveConfig.MAX_HISTORY_ITEMS]
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False)
        logger.info(f"✅ History saved to {path} ({len(history)} items)")
    except Exception as e:
        logger.error(f"❌ Could not save history: {e}")


def clear_history_file():
    """Delete the filesystem history file for the current session."""
    try:
        sid  = _get_session_id()
        path = _history_filepath(sid)
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        logger.warning(f"Could not clear history file: {e}")


def error_response(message: str, status_code: int = 400) -> tuple:
    """Return a standardized error JSON response."""
    logger.error(f"❌ Error {status_code}: {message}")
    return jsonify({"success": False, "error": message}), status_code


def success_response(data: dict, message: str = "Success") -> tuple:
    """Return a standardized success JSON response."""
    return jsonify({"success": True, "message": message, **data}), 200


# ─────────────────────────────────────────
# Routes
# ─────────────────────────────────────────

@app.route('/')
def index():
    """Render the main application page."""
    return render_template('index.html')


# ─────────────────────────────────────────
# File Upload Route
# ─────────────────────────────────────────

@app.route('/upload', methods=['POST'])
def upload_file():
    """
    Handle file upload and extract text.
    Accepts: PDF, DOCX, PPTX, TXT files
    Returns: Extracted text and statistics
    """
    try:
        if 'file' not in request.files:
            return error_response("No file provided in the request.")

        file = request.files['file']

        if not file or file.filename == '':
            return error_response("No file selected. Please choose a file to upload.")

        # ── Validate file ──
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)

        validation = validate_file(
            file.filename,
            file_size,
            ActiveConfig.MAX_CONTENT_LENGTH
        )

        if not validation['valid']:
            return error_response(validation['error'])

        # ── Save file temporarily ──
        filename    = secure_filename(file.filename)
        unique_name = f"{uuid.uuid4().hex}_{filename}"
        filepath    = os.path.join(ActiveConfig.UPLOAD_FOLDER, unique_name)
        file.save(filepath)
        logger.info(f"📁 File saved: {filepath}")

        # ── Extract text ──
        try:
            raw_text = extract_text(filepath)
        except Exception as e:
            os.remove(filepath)
            return error_response(f"Could not extract text: {str(e)}")

        # ── Clean & validate text ──
        cleaned_text    = clean_text(raw_text)
        text_validation = validate_text(
            cleaned_text,
            ActiveConfig.MIN_TEXT_LENGTH,
            ActiveConfig.MAX_TEXT_LENGTH
        )

        if not text_validation['valid']:
            os.remove(filepath)
            return error_response(text_validation['error'])

        # ── Get statistics ──
        stats = get_text_statistics(
            cleaned_text,
            ActiveConfig.WORDS_PER_MINUTE,
            ActiveConfig.STUDY_MULTIPLIER
        )

        # ── Truncate if needed ──
        prepared_text = prepare_text_for_api(cleaned_text, ActiveConfig.MAX_TEXT_LENGTH)

        # ── Clean up uploaded file ──
        os.remove(filepath)

        logger.info(f"✅ File processed: {stats['word_count']} words extracted")

        return success_response({
            "text":       prepared_text,
            "statistics": stats,
            "filename":   filename,
            "truncated":  text_validation.get('truncated', False)
        }, "File uploaded and text extracted successfully!")

    except Exception as e:
        logger.exception("Unexpected error in /upload")
        return error_response(f"Upload failed: {str(e)}", 500)


# ─────────────────────────────────────────
# Process Text Route (paste text manually)
# ─────────────────────────────────────────

@app.route('/process-text', methods=['POST'])
def process_text():
    """
    Process manually pasted text.
    Returns: Cleaned text and statistics
    """
    try:
        data = request.get_json()

        if not data or 'text' not in data:
            return error_response("No text provided.")

        raw_text = data['text']

        text_validation = validate_text(
            raw_text,
            ActiveConfig.MIN_TEXT_LENGTH,
            ActiveConfig.MAX_TEXT_LENGTH
        )

        if not text_validation['valid']:
            return error_response(text_validation['error'])

        cleaned_text  = clean_text(raw_text)
        prepared_text = prepare_text_for_api(cleaned_text, ActiveConfig.MAX_TEXT_LENGTH)

        stats = get_text_statistics(
            cleaned_text,
            ActiveConfig.WORDS_PER_MINUTE,
            ActiveConfig.STUDY_MULTIPLIER
        )

        return success_response({
            "text":       prepared_text,
            "statistics": stats,
            "truncated":  text_validation.get('truncated', False)
        }, "Text processed successfully!")

    except Exception as e:
        logger.exception("Unexpected error in /process-text")
        return error_response(f"Text processing failed: {str(e)}", 500)


# ─────────────────────────────────────────
# Generate Route
# ─────────────────────────────────────────

@app.route('/generate', methods=['POST'])
def generate():
    """
    Generate all AI study materials from text.
    Uses Google Gemini API.
    Returns: Summary, notes, flashcards, quiz, etc.
    """
    try:
        data = request.get_json()

        if not data or 'text' not in data:
            return error_response("No text provided for generation.")

        text = data['text'].strip()

        if not text:
            return error_response("Text is empty. Please provide content to generate notes from.")

        # ── Check Gemini API key ──
        api_key = ActiveConfig.GROQ_API_KEY
        if not api_key:
            return error_response(
                "Gemini API key not configured. "
                "Please add your GEMINI_API_KEY to the .env file. "
                "Get a free key at: https://aistudio.google.com"
            )

        # ── Get model ──
        model = ActiveConfig.GROQ_MODEL

        # ── Options ──
        options = data.get('options', {
            "summary":             True,
            "study_notes":         True,
            "flashcards":          True,
            "quiz":                True,
            "important_questions": True,
            "cheat_sheet":         True,
            "key_concepts":        True
        })

        # ── Get text statistics ──
        stats = get_text_statistics(text)

        logger.info(f"🚀 Starting generation for {stats['word_count']} words using {model}...")

        # ── Call Gemini API ──
        results = generate_all(api_key, text, model, options)

        # ── Log results ──
        logger.info(f"📦 Results keys: {list(results.keys())}")
        for key, val in results.items():
            if key != 'errors':
                if val is None:
                    logger.warning(f"❌ {key}: None")
                else:
                    logger.info(f"✅ {key}: generated")

        if results.get('errors'):
            logger.warning(f"⚠️ Errors: {results['errors']}")

        # ── Save to history ──
        history_entry = {
            "id":         uuid.uuid4().hex[:8],
            "timestamp":  datetime.now().strftime("%Y-%m-%d %H:%M"),
            "word_count": stats['word_count'],
            "preview":    text[:100] + "..." if len(text) > 100 else text,
            "sections":   [k for k in results.keys() if k != 'errors'],
            "data":       results
        }
        save_to_history(history_entry)

        logger.info(f"✅ Generation complete!")

        return success_response({
            "results":    results,
            "statistics": stats,
            "history_id": history_entry["id"]
        }, "Study materials generated successfully!")

    except ValueError as e:
        return error_response(str(e), 400)
    except Exception as e:
        logger.exception("Unexpected error in /generate")
        return error_response(f"Generation failed: {str(e)}", 500)


# ─────────────────────────────────────────
# Export Route
# ─────────────────────────────────────────

@app.route('/export', methods=['POST'])
def export():
    """
    Export generated content as PDF, DOCX, or TXT.
    Returns: Download URL for the exported file
    """
    try:
        data = request.get_json()

        if not data:
            return error_response("No data provided.")

        content       = data.get('content', {})
        export_format = data.get('format', 'pdf').lower()

        if not content:
            return error_response("No content to export.")

        if export_format not in ['pdf', 'docx', 'txt']:
            return error_response("Invalid export format. Choose: pdf, docx, or txt")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename  = f"study_notes_{timestamp}.{export_format}"

        filepath = export_content(
            content,
            export_format,
            ActiveConfig.GENERATED_FOLDER,
            filename
        )

        logger.info(f"✅ Exported: {filepath}")

        return success_response({
            "filename":     filename,
            "download_url": f"/download/{filename}",
            "format":       export_format
        }, f"File exported as {export_format.upper()} successfully!")

    except Exception as e:
        logger.exception("Unexpected error in /export")
        return error_response(f"Export failed: {str(e)}", 500)


# ─────────────────────────────────────────
# Download Route
# ─────────────────────────────────────────

@app.route('/download/<filename>')
def download(filename: str):
    """Serve a generated file for download."""
    try:
        safe_name = secure_filename(filename)
        filepath  = os.path.join(ActiveConfig.GENERATED_FOLDER, safe_name)

        if not os.path.exists(filepath):
            return error_response("File not found or has expired.", 404)

        mime_types = {
            'pdf':  'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'txt':  'text/plain'
        }
        ext       = safe_name.rsplit('.', 1)[-1].lower()
        mime_type = mime_types.get(ext, 'application/octet-stream')

        return send_file(
            filepath,
            mimetype=mime_type,
            as_attachment=True,
            download_name=safe_name
        )

    except Exception as e:
        logger.exception("Error in /download")
        return error_response(f"Download failed: {str(e)}", 500)


# ─────────────────────────────────────────
# History Routes
# ─────────────────────────────────────────

@app.route('/history', methods=['GET'])
def history():
    """Return the last N generation history items."""
    try:
        items = get_history()
        preview_items = [
            {
                "id":         item["id"],
                "timestamp":  item["timestamp"],
                "word_count": item["word_count"],
                "preview":    item["preview"],
                "sections":   item["sections"]
            }
            for item in items
        ]
        return success_response({"history": preview_items})
    except Exception as e:
        return error_response(f"Could not retrieve history: {str(e)}", 500)


@app.route('/history/<history_id>', methods=['GET'])
def get_history_item(history_id: str):
    """Return full data for a specific history item."""
    try:
        items = get_history()
        item  = next((i for i in items if i["id"] == history_id), None)
        if not item:
            return error_response("History item not found.", 404)
        return success_response({"item": item})
    except Exception as e:
        return error_response(f"Could not retrieve history item: {str(e)}", 500)


@app.route('/clear-history', methods=['POST'])
def clear_history():
    """Clear all generation history (removes the filesystem history file)."""
    try:
        clear_history_file()
        return success_response({}, "History cleared successfully!")
    except Exception as e:
        return error_response(f"Could not clear history: {str(e)}", 500)


# ─────────────────────────────────────────
# Chat Route
# ─────────────────────────────────────────

@app.route('/chat', methods=['POST'])
def chat():
    """
    Handle chat conversation based on the context of the study material.
    """
    try:
        data = request.get_json()
        if not data or 'message' not in data:
            return error_response("No message provided.")

        message = data['message'].strip()
        context = data.get('context', '').strip()
        history = data.get('history', [])

        if not message:
            return error_response("Message cannot be empty.")

        api_key = ActiveConfig.GROQ_API_KEY
        if not api_key:
            return error_response(
                "Gemini/Groq API key not configured. "
                "Please add your GEMINI_API_KEY to the .env file."
            )

        model = ActiveConfig.GROQ_MODEL

        # ── Direct Groq API call — bypasses call_groq() which has a hardcoded
        #    study-only system prompt that cannot be overridden from outside. ──
        import requests as _requests

        # Build system prompt
        if context:
            system_content = (
                "You are StudyAI, a friendly and knowledgeable AI assistant. "
                "You can answer ANYTHING the user asks — greetings, general knowledge, "
                "coding, math, science, opinions, jokes, or anything else. "
                "Study material is provided below ONLY as extra context for study-related questions. "
                "If the user says hi, hello, good morning, or any greeting — respond warmly and naturally, "
                "do NOT mention study material. "
                "Never say you are limited to the study material. "
                "Format educational answers in Markdown. Keep casual replies plain and short.\n\n"
                f"[Study Material for reference]\n{context[:6000]}"
            )
        else:
            system_content = (
                "You are StudyAI, a friendly and knowledgeable AI assistant. "
                "Answer ANYTHING the user asks — greetings, general knowledge, "
                "coding, math, science, opinions, or anything else. "
                "If the user greets you, respond warmly and naturally. "
                "Format educational answers in Markdown. Keep casual replies plain and short."
            )

        # Build messages array with history
        messages = [{"role": "system", "content": system_content}]
        for turn in history[-10:]:
            role = turn.get('role', 'user')
            api_role = "assistant" if role == 'ai' else "user"
            content = turn.get('content', '')
            if content:
                messages.append({"role": api_role, "content": content})
        messages.append({"role": "user", "content": message})

        groq_response = _requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": 1024,
                "temperature": 0.7
            },
            timeout=30
        )
        groq_response.raise_for_status()
        groq_data = groq_response.json()
        response_text = groq_data["choices"][0]["message"]["content"]

        return success_response({"response": response_text}, "Message processed successfully!")

    except Exception as e:
        logger.exception("Unexpected error in /chat")
        return error_response(f"Chat failed: {str(e)}", 500)


@app.route('/sw.js')
def service_worker():
    """
    Serve the service worker from the root domain context.
    FIX (SW): Service workers must NOT be cached by the browser HTTP cache,
    otherwise browsers serve a stale sw.js and the SW never updates.
    Cache-Control: no-cache forces the browser to revalidate sw.js on every load.
    """
    response = send_file(
        os.path.join(app.root_path, 'static', 'js', 'sw.js'),
        mimetype='application/javascript'
    )
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma']        = 'no-cache'
    response.headers['Expires']       = '0'
    return response


# ─────────────────────────────────────────
# Health Check Route
# ─────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        "status":    "healthy",
        "timestamp": datetime.now().isoformat(),
        "model":     ActiveConfig.GROQ_MODEL,
        "api_key":   "configured" if ActiveConfig.GROQ_API_KEY else "missing"
    }), 200


# ─────────────────────────────────────────
# Error Handlers
# ─────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "Route not found."}), 404


@app.errorhandler(413)
def file_too_large(e):
    return jsonify({"success": False, "error": "File too large. Maximum size is 16MB."}), 413


@app.errorhandler(500)
def server_error(e):
    return jsonify({"success": False, "error": "Internal server error. Please try again."}), 500


# ─────────────────────────────────────────
# Run Application
# ─────────────────────────────────────────

if __name__ == '__main__':
    print("\n" + "=" * 50)
    print("STARTING - AI Study Notes Generator")
    print("=" * 50)
    print(f"URL:   http://localhost:{ActiveConfig.PORT}")
    print(f"Model: {ActiveConfig.GROQ_MODEL}")
    print(f"API:   {'Configured' if ActiveConfig.GROQ_API_KEY else 'Missing!'}")
    print("=" * 50 + "\n")

    app.run(
        host=ActiveConfig.HOST,
        port=ActiveConfig.PORT,
        debug=ActiveConfig.DEBUG,
        use_reloader=False
    )