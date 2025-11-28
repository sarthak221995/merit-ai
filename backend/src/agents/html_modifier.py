from openai import AsyncOpenAI
from ..config import settings
import re
import logging
import json
import asyncio
from typing import List, Dict 

logger = logging.getLogger(__name__)

class HtmlModifier:
    def __init__(self):
        logger.info("Initializing HtmlModifier with OpenAI Direct API...")
        
        self.client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY
        )
        
        # GPT-4o is recommended for large HTML manipulation tasks
        # self.model_name = "gpt-3.5-turbo"
        self.model_name = "gpt-4.1"

        # System prompt stored as class attribute
        self.system_prompt = """
You are an expert HTML & Inline CSS resume modifier and conversational assistant.
Your primary task is to maintain and modify the HTML resume code according to a user's prompt.

RULES:
1. Always respond with a single JSON object.
2. The JSON object MUST contain two keys: "reply" (conversational text) and "modified_code" (the full HTML code).
3. If a modification is required (e.g., "change my email"), make the change in the HTML, set "modified_code" to the NEW code, and set "reply" to a polite confirmation.
4. If a modification is NOT required (e.g., "What skills should I add?"), do NOT change the code. Set "modified_code" to the ORIGINAL code and set "reply" to your advice.
5. **Critical:** Preserve all `style="..."` inline CSS attributes unless specifically asked to redesign the layout. Do not break the HTML structure.
6. Make ONLY the changes requested. Do not add extra content or restructure unnecessarily.

IMPORTANT FOR OVERLAPPING TEXT:
- If the user mentions text overlapping, overflowing, or layout issues:
  * Add appropriate margins, padding, or spacing
  * Use `overflow: hidden` or `text-overflow: ellipsis` if needed
  * Adjust widths, heights, or positioning
  * Ensure proper spacing between sections

STRICT OUTPUT RULE:
Return ONLY a JSON object with the keys "reply" and "modified_code". 
Do NOT include any other text, explanations, or markdown fences outside the JSON object.

Example response format:
{
  "reply": "I've updated your email address to the new one.",
  "modified_code": "<!DOCTYPE html><html>...</html>"
}
"""

    async def strip_fenced_code(self, text):
        """Remove markdown code fences from text."""
        text = re.sub(r"^```[a-zA-Z0-9_+-]*\s*\n", "", text)
        text = re.sub(r"\n```$", "", text)
        return text.strip()

    async def modify_html(self, html_code: str, prompt: str, history: List[Dict[str, str]] = None) -> dict:
        logger.info(f"🔄 Modifying HTML code with prompt: {prompt[:100]}...")
        
        # Build conversation history context
        history_text = ""
        if history:
            history_text = "Here is the conversation history that provides context for the request:\n"
            for msg in history[-5:]:  # Only last 5 messages to avoid token limits
                history_text += f"[{msg.role.upper()}]: {msg.content}\n"
            history_text += "\n"

        try:
            # Construct the full user message
            user_message_content = f"""
Here is the current HTML code you must modify (or return unchanged):

===== CODE START =====
{html_code}
===== CODE END =====

{history_text}

Here is the user's final and most recent request:
{prompt}

IMPORTANT:
Respond ONLY with a JSON object containing "reply" (conversational text) and "modified_code" (valid HTML).
"""
            
            logger.info("Sending request to OpenAI API...")

            # Prepare the API call coroutine
            # We use response_format={"type": "json_object"} to enforce valid JSON output
            api_coroutine = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_message_content}
                ],
                temperature=0.2,  # Low temperature for stability
                response_format={"type": "json_object"} 
            )
            
            # Execute with timeout
            response = await asyncio.wait_for(
                api_coroutine,
                timeout=120.0
            )
            
            # Extract content
            response_text = response.choices[0].message.content
            logger.info(f"AI response received. Length: {len(response_text)} chars")

            # -------------------------------------------------------
            # JSON Parsing (Retaining your robust defensive logic)
            # -------------------------------------------------------
            
            # Remove any markdown fences (just in case model ignores json_object enforcement)
            response_text = re.sub(r'^```json\s*', '', response_text)
            response_text = re.sub(r'^```\s*', '', response_text)
            response_text = re.sub(r'\s*```$', '', response_text)
            response_text = response_text.strip()
            
            try:
                response_json = json.loads(response_text)
            except json.JSONDecodeError as e:
                logger.warning(f"Standard JSON load failed: {e}. Attempting fallback parsing.")
                
                # Fallback: Try to extract reply and code separately using Regex
                reply_match = re.search(r'"reply"\s*:\s*"([^"]*(?:\\.[^"]*)*)"', response_text)
                code_match = re.search(r'"modified_code"\s*:\s*"([^"]*(?:\\.[^"]*)*)"', response_text, re.DOTALL)
                
                if reply_match and code_match:
                    response_json = {
                        "reply": reply_match.group(1),
                        "modified_code": code_match.group(1)
                    }
                else:
                    raise e # Re-raise if fallback fails

            # Extract the keys
            modified_html = response_json.get("modified_code", html_code)
            reply_text = response_json.get("reply", "I've processed your request.")
            
            # Clean the code content (in case the model wrapped the inner HTML in fences)
            modified_html = await self.strip_fenced_code(modified_html)
            
            # Validate that we got actual HTML back
            if not modified_html or len(modified_html) < 100:
                logger.error("Modified HTML is too short or empty")
                return {
                    "success": False,
                    "error": "AI returned invalid or empty HTML"
                }

            logger.info(f"✅ Modification complete. Reply: {reply_text[:100]}...")
            return {
                "success": True, 
                "modified_html": modified_html,
                "reply_text": reply_text
            }

        except asyncio.TimeoutError:
            logger.error("⏱️ AI request timed out after 120 seconds")
            return {
                "success": False,
                "error": "Request timed out. The resume might be too large or the request too complex."
            }
        
        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse JSON: {e}. Raw response: {response_text[:500]}")
            return {
                "success": False,
                "error": "AI returned invalid JSON format. Please try again."
            }

        except Exception as e:
            logger.error(f"❌ Modification failed: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"API communication failed: {str(e)}"
            }