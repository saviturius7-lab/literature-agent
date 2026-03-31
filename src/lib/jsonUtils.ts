
/**
 * Professional JSON sanitization utility.
 * Handles common LLM errors like trailing commas, improper escaping, and markdown blocks.
 */
export function sanitizeJSON(text: string): string {
  if (!text) return "";
  
  let cleaned = text.trim();
  
  // 1. Remove markdown code blocks if present
  const jsonMatch = cleaned.match(/```json\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  } else {
    // Try to find the first '{' or '[' and last '}' or ']'
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    
    let start = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
      start = Math.min(firstBrace, firstBracket);
    } else {
      start = firstBrace !== -1 ? firstBrace : firstBracket;
    }
    
    let end = -1;
    if (lastBrace !== -1 && lastBracket !== -1) {
      end = Math.max(lastBrace, lastBracket);
    } else {
      end = lastBrace !== -1 ? lastBrace : lastBracket;
    }
    
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }

  // 2. Basic cleanup
  cleaned = cleaned
    .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""); // Remove comments (some LLMs add them)

  // 3. Handle literal newlines inside strings
  // LLMs often put real newlines inside JSON string values, which is invalid.
  // We try to find strings and escape their newlines.
  cleaned = cleaned.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
    return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  });

  // 4. Fix escaped characters
  // We want to ensure all backslashes are either part of a valid JSON escape sequence
  // or are themselves escaped.
  
  // Valid JSON escapes: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
  
  // First, let's handle the common case of unescaped newlines in strings
  // This is tricky because we don't want to replace newlines that are OUTSIDE of strings (e.g. between keys)
  // But LLMs often put literal newlines inside string values.
  
  // A simpler approach for "Bad escaped character":
  // Replace any backslash that is NOT followed by a valid escape character with a double backslash.
  // And specifically handle \uXXXX.
  
  const result = cleaned.replace(/\\/g, (match, offset, str) => {
    const nextChar = str[offset + 1];
    if (!nextChar) return '\\\\'; // Backslash at the very end
    
    // If it's a valid single-character escape, keep it
    if (/[\\\/bfnrtu"]/.test(nextChar)) {
      if (nextChar === 'u') {
        // Check for 4 hex digits
        const hex = str.slice(offset + 2, offset + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          return '\\'; // Valid unicode escape
        }
        return '\\\\'; // Invalid unicode escape, escape the backslash
      }
      return '\\'; // Valid escape
    }
    
    // If it's a single quote \', LLMs often do this. In JSON it should just be '
    if (nextChar === "'") {
      return ""; // We return empty so the result is just ' (the nextChar)
    }
    
    // Otherwise, it's an invalid escape character (like \p, \s, etc.)
    // We escape the backslash so it becomes a literal backslash in the JSON string
    return '\\\\';
  });

  return result.trim();
}

export function safeParseJSON<T>(text: string, fallback?: T): T {
  try {
    const sanitized = sanitizeJSON(text);
    return JSON.parse(sanitized) as T;
  } catch (e) {
    console.error("[JSON] Failed to parse sanitized JSON:", e);
    console.debug("[JSON] Original text:", text);
    if (fallback !== undefined) return fallback;
    throw e;
  }
}
