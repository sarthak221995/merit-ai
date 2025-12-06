from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import List, Optional
import logging
import aiofiles
import uuid
import re
import os
import jwt 
from jwt import PyJWKClient
from pathlib import Path
from io import BytesIO # <--- ADDED for in-memory file conversion
# --- GTK3 Setup for Windows ---
# Try to add GTK3 to PATH if on Windows (required for WeasyPrint)
gtk3_path = r"C:\Program Files\GTK3-Runtime Win64\bin"
if os.path.exists(gtk3_path) and gtk3_path not in os.environ['PATH']:
    os.environ['PATH'] = gtk3_path + os.pathsep + os.environ['PATH']

try:
    from weasyprint import HTML
    from weasyprint.text.fonts import FontConfiguration
    WEASYPRINT_AVAILABLE = True
except OSError as e:
    logger.warning(f"WeasyPrint not available: {e}")
    WEASYPRINT_AVAILABLE = False
    class HTML:
        def __init__(self, string=None, **kwargs): pass
        def write_pdf(self, target=None, font_config=None): raise NotImplementedError("WeasyPrint not available")
    class FontConfiguration:
        pass


# --- Internal Imports ---
from .config import settings
from .agents.document_extractor import DocumentExtractor
from .agents.html_extract_and_convert import unified_processor
from .agents.html_modifier import HtmlModifier

logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Directories ---
UPLOAD_DIR = Path("uploads")
TEMPLATES_UPLOAD_DIR = Path("templates")
UPLOAD_DIR.mkdir(exist_ok=True)
TEMPLATES_UPLOAD_DIR.mkdir(exist_ok=True)

# --- Security Configuration ---
security = HTTPBearer()

# IMPORTANT: You must add this to your .env or config.py
CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL", getattr(settings, "CLERK_JWKS_URL", ""))

def verify_clerk_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Middleware: Verifies the Clerk JWT sent in the Authorization header.
    """
    if not CLERK_JWKS_URL:
        if settings.DEBUG:
             logger.warning("⚠️ CLERK_JWKS_URL not set. Skipping verification (DEBUG ONLY).")
             return {"sub": "debug_user"}
        logger.error("CLERK_JWKS_URL is missing. Cannot verify tokens.")
        raise HTTPException(status_code=500, detail="Server authentication misconfigured")

    token = credentials.credentials
    
    try:
        jwks_client = PyJWKClient(CLERK_JWKS_URL)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_exp": True}
        )
        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid Token Attempt: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Auth Error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")

# --- Models ---
class ChatMessage(BaseModel):
    role: str = Field(..., description="user or ai")
    content: str

class ModifyRequest(BaseModel):
    html_code: str
    prompt: str
    history: List[ChatMessage] = Field(default_factory=list)
    extracted_data: Optional[str] = None # <--- ADDED: Allow frontend to send context

# --- Helper Functions ---
def preprocess_html_for_pdf(html_content: str) -> str:
    unsupported_properties = [
        r'backdrop-filter\s*:\s*[^;]+;',
        r'transform\s*:\s*translate[^;]+;',
        r'filter\s*:\s*blur[^;]+;',
        r'clip-path\s*:\s*[^;]+;',
        r'mix-blend-mode\s*:\s*[^;]+;',
    ]
    
    for prop in unsupported_properties:
        html_content = re.sub(prop, '', html_content, flags=re.IGNORECASE)
    
    print_css = """
    <style>
        @page { size: A4; margin: 0; }
        body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        * { box-sizing: border-box; }
    </style>
    """
    
    if '</head>' in html_content:
        html_content = html_content.replace('</head>', f'{print_css}</head>')
    elif '<body>' in html_content:
        html_content = html_content.replace('<body>', f'<body>{print_css}')
    else:
        html_content = print_css + html_content
    
    return html_content

# --- Routes ---

@app.get("/")
async def root():
    return {"app": settings.APP_NAME, "status": "ready", "mode": "HTML/CSS", "auth": "Enabled"}


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: dict = Depends(verify_clerk_token)
):
    """Extract text from uploaded file."""
    logger.info(f"📄 Upload request: {file.filename} by user {user.get('sub')}")

    allowed_ext = {".pdf", ".docx", ".doc", ".txt", ".pptx", ".xlsx", ".csv"}
    ext = Path(file.filename).suffix.lower()

    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail="Unsupported file format")

    try:
        file_bytes = await file.read()
        extractor = DocumentExtractor()
        result = await extractor.extract_from_bytes(file_bytes, file.filename)

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        return {
            "filename": file.filename,
            "success": True,
            "extracted_text": result["extracted_data"],
            "processing_time": result["execution_time"],
            "method": result["method"],
        }
    except Exception as e:
        logger.exception("❌ Error during upload processing")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process_html")
async def process_html(
    file: UploadFile = File(...),
    template_id: str = Form(...),
    user: dict = Depends(verify_clerk_token)
):
    """UNIFIED ENDPOINT: Takes Resume + Template ID -> Returns Filled HTML."""
    logger.info(f"⚙️ Processing HTML for user {user.get('sub')}")

    # --- FIX START: Handle .docx files for OpenAI ---
    # OpenAI's API does not accept .docx. We intercept them, extract text, 
    # and pass it as a .txt file instead.
    filename = file.filename.lower()
    if filename.endswith((".docx", ".doc")):
        logger.info(f"📄 Intercepted .docx: Converting {filename} to .txt for AI...")
        try:
            # 1. Read the file
            file_bytes = await file.read()
            
            # 2. Extract text using DocumentExtractor
            extractor = DocumentExtractor()
            result = await extractor.extract_from_bytes(file_bytes, file.filename)
            
            if not result.get("success"):
                return {"success": False, "error": f"Extraction failed: {result.get('error')}"}
            
            text_content = result["extracted_data"]
            
            # 3. Create a mock .txt file in memory
            # We wrap the text in a BytesIO object so it acts like a file
            new_file_obj = BytesIO(text_content.encode("utf-8"))
            
            # 4. Create a new UploadFile object with .txt extension
            # This tricks the unified_processor into thinking it received a text file
            new_filename = Path(file.filename).stem + ".txt"
            file = UploadFile(file=new_file_obj, filename=new_filename)
            
        except Exception as e:
            logger.error(f"Error pre-processing docx: {e}")
            return {"success": False, "error": f"Failed to convert docx: {str(e)}"}
    # --- FIX END ---

    result = await unified_processor.process(file, template_id, TEMPLATES_UPLOAD_DIR)
    
    if not result["success"]:
        return {"success": False, "error": result["error"]}
        
    return {
        "success": True,
        "html_code": result["html_code"],
        "extracted_data": result.get("extracted_data", "") # <--- ADDED: Return raw data
    }


@app.post("/generate-pdf")
async def generate_pdf(
    html_content: str = Form(...),
    user: dict = Depends(verify_clerk_token)
):
    """Converts HTML string to PDF using WeasyPrint."""
    try:
        output_filename = f"resume-{uuid.uuid4().hex[:8]}.pdf"
        output_path = UPLOAD_DIR / output_filename

        processed_html = preprocess_html_for_pdf(html_content)
        font_config = FontConfiguration()
        
        HTML(string=processed_html).write_pdf(output_path, font_config=font_config)
        
        return FileResponse(
            path=output_path,
            filename="resume.pdf",
            media_type="application/pdf"
        )
    except Exception as e:
        logger.error(f"PDF Generation Error: {e}", exc_info=True)
        raise HTTPException(500, detail=f"PDF Generation failed: {str(e)}")


@app.post("/modify-resume")
async def modify_resume(
    req: ModifyRequest,
    user: dict = Depends(verify_clerk_token)
):
    """AI Chat to modify the HTML code."""
    logger.info(f"🔄 Modify request from user {user.get('sub')}")
    
    try:
        # Include extracted data in the prompt context if available
        # This ensures the LLM knows about content that might have been skipped in the initial template
        enhanced_prompt = req.prompt
        if req.extracted_data:
            enhanced_prompt = f"CONTEXT FROM ORIGINAL RESUME:\n{req.extracted_data}\n\nUSER REQUEST:\n{req.prompt}"

        modifier = HtmlModifier()
        result = await modifier.modify_html(
            html_code=req.html_code,
            prompt=enhanced_prompt, # <--- CHANGED: Send context-aware prompt
            history=req.history
        )
        
        if result["success"]:
            return {
                "success": True, 
                "html_code": result["modified_html"],
                "reply_text": result["reply_text"]
            }
        else:
            raise HTTPException(500, detail=result.get("error"))
    
    except Exception as e:
        logger.error(f"❌ Modify endpoint error: {str(e)}", exc_info=True)
        raise HTTPException(500, detail=f"Modification failed: {str(e)}")


@app.get("/templates")
async def list_templates(
    user: dict = Depends(verify_clerk_token)
):
    """Lists available HTML templates."""
    templates = []
    for file_path in TEMPLATES_UPLOAD_DIR.glob("*.html"):
        templates.append({
            "id": file_path.stem, 
            "name": file_path.stem.replace("_", " ").title(),
            "filename": file_path.name
        })
    return {"templates": templates}


@app.post("/preview-pdf-bytes")
async def preview_pdf_bytes(
    html_content: str = Form(...),
    user: dict = Depends(verify_clerk_token)
):
    """Generates PDF but returns raw bytes for preview."""
    try:
        processed_html = preprocess_html_for_pdf(html_content)
        font_config = FontConfiguration()
        
        pdf_bytes = HTML(string=processed_html).write_pdf(font_config=font_config)
        
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=preview.pdf"}
        )
    except Exception as e:
        logger.error(f"PDF Preview Error: {e}", exc_info=True)
        raise HTTPException(500, detail=f"PDF Preview generation failed: {str(e)}")
    

@app.get("/templates/get-raw-code")
async def get_raw_template_code(
    filename: str,
    user: dict = Depends(verify_clerk_token)
):
    """Returns the rendered HTML of a template for preview."""
    file_path = TEMPLATES_UPLOAD_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Template not found")
        
    async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
        content = await f.read()
    
    return HTMLResponse(content=content)