#!/usr/bin/env python3
"""PaddleOCR sidecar server for Mail Agent.

Listens on stdin/stdout for JSON-RPC-style messages.
Receives file paths, returns extracted text with confidence scores.
"""

import json
import sys
import os

def init_paddleocr():
    try:
        from paddleocr import PaddleOCR
        return PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
    except ImportError:
        return None

def ocr_file(ocr_engine, file_path: str) -> dict:
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.pdf':
        return ocr_pdf(ocr_engine, file_path)
    elif ext in ('.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp'):
        return ocr_image(ocr_engine, file_path)
    else:
        return {"error": f"Unsupported file type: {ext}"}

def ocr_image(ocr_engine, file_path: str) -> dict:
    result = ocr_engine.ocr(file_path, cls=True)
    lines = []
    for page in (result or []):
        for line in (page or []):
            if line and len(line) >= 2:
                text = line[1][0]
                confidence = line[1][1]
                bbox = line[0]
                lines.append({
                    "text": text,
                    "confidence": round(confidence, 4),
                    "bbox": bbox
                })

    full_text = "\n".join(l["text"] for l in lines)
    avg_confidence = sum(l["confidence"] for l in lines) / max(len(lines), 1)

    return {
        "text": full_text,
        "lines": lines,
        "confidence": round(avg_confidence, 4),
        "pages": 1
    }

def ocr_pdf(ocr_engine, file_path: str) -> dict:
    result = ocr_engine.ocr(file_path, cls=True)
    all_lines = []
    page_texts = []

    for page_idx, page in enumerate(result or []):
        page_lines = []
        for line in (page or []):
            if line and len(line) >= 2:
                text = line[1][0]
                confidence = line[1][1]
                page_lines.append({
                    "text": text,
                    "confidence": round(confidence, 4),
                    "page": page_idx + 1
                })
        all_lines.extend(page_lines)
        page_texts.append("\n".join(l["text"] for l in page_lines))

    full_text = "\n\n--- Page Break ---\n\n".join(page_texts)
    avg_confidence = sum(l["confidence"] for l in all_lines) / max(len(all_lines), 1)

    return {
        "text": full_text,
        "lines": all_lines,
        "confidence": round(avg_confidence, 4),
        "pages": len(result or [])
    }

def main():
    ocr_engine = init_paddleocr()

    if ocr_engine is None:
        startup_msg = {"type": "init", "status": "error",
                       "error": "PaddleOCR not installed. Run: pip install paddleocr paddlepaddle"}
    else:
        startup_msg = {"type": "init", "status": "ready"}

    sys.stdout.write(json.dumps(startup_msg) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = {"error": "Invalid JSON"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            continue

        request_id = request.get("id", None)
        file_path = request.get("file_path", "")

        if request.get("type") == "shutdown":
            break

        if ocr_engine is None:
            response = {"id": request_id, "error": "OCR engine not available"}
        else:
            result = ocr_file(ocr_engine, file_path)
            response = {"id": request_id, **result}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
