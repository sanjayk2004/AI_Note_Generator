# AI Study Notes Generator

## Overview
AI Study Notes Generator is a Flask-based AI-powered study assistant that accepts **PDF, DOCX, PPTX, and TXT** files, extracts their text, and generates structured study material using an LLM (Groq API/OpenAI-compatible endpoint). It also supports exporting generated content, maintains generation history, and provides study statistics.

---

# Features

- Upload PDF, DOCX, PPTX, and TXT files
- Automatic text extraction
- AI-generated:
  - Notes
  - Summaries
  - Flashcards
  - Important Questions
  - MCQs (where supported)
- Reading time & study time estimation
- Export generated content
- History management
- REST API endpoints
- CORS enabled
- File validation
- Health-check endpoint

---

# Technology Stack

## Backend
- Python
- Flask
- Flask-CORS

## AI
- Groq API (OpenAI-compatible)
- Config supports Gemini / Anthropic environment variables

## Document Processing
- pdfplumber
- PyPDF2
- python-docx
- python-pptx

## Export
- ReportLab
- Markdown
- Pillow

---

# Project Structure

```
app.py
config.py
requirements.txt
templates/
static/
utils/
uploads/
generated/
```

### Important Modules

- **app.py** – Main Flask application and routes
- **config.py** – Central configuration
- **utils/file_handlers.py** – Text extraction
- **utils/text_processor.py** – Cleaning, validation, statistics
- **utils/claude_api.py** – AI prompt generation and Groq integration
- **utils/exporter.py** – Export functionality

---

# Supported File Types

- PDF
- DOCX
- PPTX
- TXT

Maximum upload size: **16 MB**

---

# Application Workflow

1. User uploads a supported document.
2. Backend validates file.
3. Text is extracted.
4. Text is cleaned and analysed.
5. Prompt is sent to AI model.
6. Structured study material is generated.
7. Results are stored in history.
8. User may export generated content.

---

# API Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | Home page |
| POST | /upload | Upload document |
| POST | /generate | Generate AI content |
| POST | /export | Export output |
| GET | /download/<filename> | Download exported file |
| GET | /history | Fetch history |
| POST | /clear-history | Clear history |
| GET | /health | Health check |

---

# Installation

```bash
git clone <repository>
cd ai_study_notes
python -m venv .venv

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
```

Create a `.env` file with:

```env
SECRET_KEY=your_secret
GROQ_API_KEY=your_key
DEBUG=True
HOST=0.0.0.0
PORT=5000
```

Run:

```bash
python app.py
```

---

# Python Dependencies

- Flask==3.0.0
- Flask-CORS==4.0.0
- python-dotenv==1.0.0
- anthropic==0.7.1
- PyPDF2==3.0.1
- pdfplumber==0.10.3
- python-docx==0.8.11
- python-pptx==0.6.21
- Pillow==10.1.0
- reportlab==4.0.7
- markdown==3.5.1
- requests==2.31.0
- werkzeug==3.0.1
- gunicorn==21.2.0

---

# Configuration

- Upload folder: uploads/
- Generated folder: generated/
- History stored as JSON files
- Session-based history
- Allowed extensions: pdf, docx, pptx, txt

---

# Security

- Secure filenames
- File type validation
- Session-based history IDs
- Configurable secret key

---

# Future Improvements

- Authentication
- Cloud storage
- OCR for scanned PDFs
- Multiple AI providers
- User accounts
- Dark/Light themes
- Analytics dashboard

---

# License

For educational purposes unless otherwise specified.

Use this link to view the website: 
https://ai-note-generator-1.onrender.com/

