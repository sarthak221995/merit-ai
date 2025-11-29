from pydantic_settings import BaseSettings
from typing import List, Optional

class Settings(BaseSettings):
    APP_NAME: str = "ResumeForge"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    CORS_ORIGINS: List[str] = ["http://localhost", "http://localhost:3000", "https://resumegpt-frontend.vercel.app","https://merit-ai-zeta.vercel.app"]

    # OPENAI SETTINGS
    OPENAI_API_KEY: str
    
    # Token limits
    MAX_TOKENS_FOR_MODIFY: int = 16000  

    # AUTH
    CLERK_JWKS_URL: str
   
    class Config:
        env_file = ".env"
        extra = "ignore" # Ignore extra env vars

settings = Settings()