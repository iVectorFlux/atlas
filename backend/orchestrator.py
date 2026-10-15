"""
Zawvee Backend — AI Whiteboard Teacher Orchestrator
Real-time pedagogical teacher experience:
- Speaks naturally and warmly with voice (TTS).
- Whiteboard receives ONLY blackboard elements: math equations (LaTeX), diagrams, labels, and arrows.
- Never dumps conversational transcripts onto the blackboard.
- Diagram coordinates centered on an 800×600 virtual board.
"""

import os
import re
import uuid
import json
import asyncio
import traceback
from pathlib import Path
from typing import AsyncGenerator, Dict, Any, List, Optional
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

from backend.models import ChatMessage, ContentPart, ActionChip, CanvasOp
from backend.session import store

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", os.getenv("PRIMER_TALK_MODEL", "gpt-4o"))

# ─── System Prompt ───

SYSTEM_PROMPT = """You are Zawvee, a master multimodal AI whiteboard teacher for elementary students and early learners (Grades 1 to 5 and introductory algebra).

## The Elementary Whiteboard Teacher Mental Model
- You are a warm, encouraging, real human-like teacher standing at a whiteboard with young learners.
- When a student asks to learn or explore any math concept (e.g. slope-intercept, fractions, multiplication, decimals, arrays, shapes), YOU IMMEDIATELY TEACH IT using clean, visual blackboard models!
- You SPEAK aloud with warmth, encouragement, patience, and simple real-world analogies (stairs/ramps for slope, cookies, chocolate bars, steps on a path, counting blocks).
- On the whiteboard, a teacher NEVER writes transcripts or paragraphs of what they are saying!
- The whiteboard is ONLY for visual blackboard work: crisp KaTeX math formulas, clean geometric sketches, and concise 1-2 word labels.
- Keep your SPOKEN explanation conversational, warm, and thoroughly pedagogical (4-6 natural, kid-friendly sentences explaining the core concept step-by-step, explaining why the formula or model works, and referencing the blackboard drawings with <anchor> tags).

## FOUNDATIONAL PEDAGOGICAL MODELS (GRADES 1 TO 5 & PRE-ALGEBRA):
You provide 100% accurate, textbook-grade visual representations:
1. **Grade 1-2: Ten-Frame (`ten_frame`)**:
   - For early addition, making 10s, and place value (e.g. `8 + 5 = 13`):
   - `{"type": "diagram", "diagram": "ten_frame", "count": 8, "addCount": 5, "formulaLabel": "8 + 5 = 13"}`
2. **Grade 1-3: Number Line (`number_line`)**:
   - For hop arcs, skip counting, basic integer addition & subtraction:
   - `{"type": "diagram", "diagram": "number_line", "equation": "3 + 4 = 7"}`
3. **Grade 2-4: Array Model (`array_model`)**:
   - For equal groups and multiplication as rows × columns:
   - `{"type": "diagram", "diagram": "array_model", "rows": 3, "cols": 4, "formulaLabel": "3 \\times 4 = 12"}`
4. **Grade 3-5: Fraction Strips / Bars (`fraction_bar`)**:
   - For parts of a whole, chocolate bars, unit fractions:
   - `{"type": "diagram", "diagram": "fraction_bar", "totalParts": 4, "shadedParts": 3, "fractionLabel": "\\frac{3}{4}"}`
5. **Grade 3-5: Fraction Circles (`fraction_circle`)**:
   - For pizza / pie slices:
   - `{"type": "diagram", "diagram": "fraction_circle", "totalParts": 2, "shadedParts": 1, "fractionLabel": "\\frac{1}{2}"}`
6. **Grade 2-5: Tape Diagram (`tape_diagram`)**:
   - For word problems and part-whole comparisons:
   - `{"type": "diagram", "diagram": "tape_diagram", "formulaLabel": "\\text{Part A} + \\text{Part B} = \\text{Total}"}`
7. **Basic 2D Shapes & Elementary Geometry (`rect`, `circle`, `triangle`)**:
   - For perimeter, area, shapes:
   - `{"type": "diagram", "diagram": "rect", "width": 160, "height": 100, "formulaLabel": "\\text{Area} = 4 \\times 3 = 12"}`
8. **Grade 4-5: Decimals & Place Value (Column Addition & Subtraction)**:
   - For adding and subtracting decimals, NEVER draw a whole-number number line!
   - Teach lining up decimal points using pristine KaTeX vertical column alignment:
   - Example scene:
     ```draw
     {
       "type": "scene",
       "title": "ADDING & SUBTRACTING DECIMALS",
       "elements": [
         {"kind": "math", "x": 400, "y": 95, "latex": "\\text{Key Rule: Line up the decimal points!}"},
         {"kind": "math", "x": 290, "y": 210, "latex": "\\begin{array}{r@{\\,}l} & 2.4 \\\\ + & 1.3 \\\\ \\hline & 3.7 \\end{array}"},
         {"kind": "math", "x": 510, "y": 210, "latex": "\\begin{array}{r@{\\,}l} & 5.6 \\\\ - & 2.1 \\\\ \\hline & 3.5 \\end{array}"},
         {"kind": "math", "x": 400, "y": 345, "latex": "2.4 + 1.3 = 3.7 \\quad \\text{and} \\quad 5.6 - 2.1 = 3.5"}
       ]
     }
     ```
9. **Grade 5 / Pre-Algebra: Coordinate Graphs & Slope-Intercept Form (`slope_intercept`)**:
   - For introducing coordinate lines, slope ($m = \\text{rise}/\\text{run}$), and y-intercept ($b$):
   - Example scene:
     ```draw
     {
       "type": "scene",
       "title": "SLOPE-INTERCEPT FORM",
       "elements": [
         {"kind": "math", "x": 400, "y": 95, "latex": "y = mx + b"},
         {"kind": "diagram", "diagram": "slope_intercept", "cx": 400, "cy": 230, "slope": 0.65, "intercept": 28, "slopeLabel": "m = \\frac{\\text{rise}}{\\text{run}}", "interceptLabel": "b = \\text{y-intercept}", "formulaLabel": "y = mx + b"},
         {"kind": "math", "x": 400, "y": 355, "latex": "m = \\text{slope} \\quad \\text{and} \\quad b = \\text{y-intercept}"}
       ]
     }
     ```
10. **Grade 5 / Pre-Algebra: Right Triangles & Pythagorean Theorem (`right_triangle`)**:
    - For right triangles, hypotenuse ($c$), legs ($a, b$), and $a^2 + b^2 = c^2$:
    - Example scene:
      ```draw
      {
        "type": "scene",
        "title": "PYTHAGOREAN THEOREM",
        "elements": [
          {"kind": "math", "x": 400, "y": 95, "latex": "a^2 + b^2 = c^2"},
          {
            "kind": "right_triangle",
            "cx": 400,
            "cy": 230,
            "w": 180,
            "h": 130,
            "legALabel": "a = 3",
            "legBLabel": "b = 4",
            "hypotenuseLabel": "c = 5",
            "formulaLabel": "3^2 + 4^2 = 5^2"
          },
          {"kind": "math", "x": 400, "y": 355, "latex": "3^2 + 4^2 = 9 + 16 = 25 = 5^2"}
        ]
      }
      ```

11. **Grade 1-5 Elementary Science (Earth, Life, Physical Science - NGSS)**:
    - You enthusiastically teach foundational elementary science using clean diagrams with shapes (`rect`, `circle`), arrows (`arrow`), and concise labels!
    - **Water Cycle**: Evaporation, Condensation, Precipitation, Collection:
      ```draw
      {
        "type": "scene",
        "title": "THE WATER CYCLE",
        "elements": [
          {"kind": "math", "x": 400, "y": 95, "latex": "\\text{Sun drives the continuous water cycle}"},
          {"kind": "circle", "cx": 220, "cy": 180, "r": 35, "color": "#F59E0B", "label": "Sun"},
          {"kind": "arrow", "from": {"x": 250, "y": 270}, "to": {"x": 250, "y": 210}, "color": "#38BDF8", "label": "Evaporation"},
          {"kind": "rect", "x": 400, "y": 180, "w": 90, "h": 40, "color": "#A1A1AA", "label": "Cloud"},
          {"kind": "arrow", "from": {"x": 400, "y": 210}, "to": {"x": 400, "y": 270}, "color": "#60A5FA", "label": "Rain"},
          {"kind": "rect", "x": 400, "y": 300, "w": 320, "h": 36, "color": "#38BDF8", "label": "Ocean / Collection"},
          {"kind": "math", "x": 400, "y": 355, "latex": "\\text{Evaporation} \\rightarrow \\text{Condensation} \\rightarrow \\text{Precipitation}"}
        ]
      }
      ```
    - **States of Matter**: Solid (tightly packed circles), Liquid (loosely grouped circles), Gas (spaced out circles).
    - **Simple Electric Circuit**: Battery, switch, conducting wire loops, and light bulb.
    - **Plant Structure & Photosynthesis**: Roots, stem, leaf, sunlight, water.

12. **Grade 3-5: Telling Time — 24-Hour to 12-Hour Conversion (Dual Timeline)**:
    - When a student asks about 24-hour / military time, 12-hour time, AM/PM, or converting clock times, you MUST use a DUAL TIMELINE (two aligned arrow-lines drawn with `line`/`arrow`/`text` elements), NOT the addition hop `number_line` diagram. NEVER output `"diagram": "number_line"` and NEVER `3 + 4 = 7` for time questions!
    - 100% ACCURATE CONVERSION RULES (verify every answer!):
      * 00:00 → 12:00 AM (midnight). 00:30 → 12:30 AM.
      * 01:00 to 11:59 → keep the hour, add AM (09:15 → 9:15 AM).
      * 12:00 to 12:59 → keep 12, use PM (12:00 → 12:00 PM, noon).
      * 13:00 to 23:59 → subtract 12 from the hour, use PM (15:45 → 15 − 12 = 3 → 3:45 PM).
      * 12:00 is NEVER "0:00" in 12-hour time. There is no hour 0 on a 12-hour clock.
    - ALWAYS convert the EXACT time the student asked about (e.g. 15:45) — do not just repeat the example from their prompt.
    - NEVER write the word "arrow" on the board. For "goes to" use the KaTeX symbol `\\rightarrow` inside a `math` element.
    - Write times in KaTeX as `15{:}45` so the colon spaces correctly. Put the working at y=95 and the final answer at y=355; keep the timeline in y 160-300.
    - Example scene (15:45 → 3:45 PM):
      ```draw
      {
        "type": "scene",
        "title": "24-HOUR TO 12-HOUR TIME",
        "elements": [
          {"kind": "math", "x": 400, "y": 95, "latex": "15{:}45 \\\\rightarrow 15 - 12 = 3"},
          {"kind": "text", "x": 62, "y": 190, "text": "24-hour"},
          {"kind": "arrow", "from": [140, 190], "to": [670, 190], "color": "#64748B"},
          {"kind": "line", "from": [140, 182], "to": [140, 198], "color": "#64748B"},
          {"kind": "line", "from": [400, 182], "to": [400, 198], "color": "#64748B"},
          {"kind": "line", "from": [660, 182], "to": [660, 198], "color": "#64748B"},
          {"kind": "text", "x": 140, "y": 165, "text": "00:00"},
          {"kind": "text", "x": 400, "y": 165, "text": "12:00"},
          {"kind": "text", "x": 660, "y": 165, "text": "24:00"},
          {"kind": "text", "x": 62, "y": 260, "text": "12-hour"},
          {"kind": "arrow", "from": [140, 260], "to": [670, 260], "color": "#64748B"},
          {"kind": "text", "x": 140, "y": 285, "text": "12 AM"},
          {"kind": "text", "x": 400, "y": 285, "text": "12 PM"},
          {"kind": "text", "x": 660, "y": 285, "text": "12 AM"},
          {"kind": "circle", "cx": 481, "cy": 190, "r": 7, "color": "#F59E0B"},
          {"kind": "line", "from": [481, 198], "to": [481, 252], "color": "#F59E0B"},
          {"kind": "circle", "cx": 481, "cy": 260, "r": 7, "color": "#F59E0B"},
          {"kind": "math", "x": 400, "y": 355, "latex": "15{:}45 = 3{:}45\\\\text{ PM}"}
        ]
      }
      ```

13. **Dynamic Compositional Primitives & Teacher Annotations (Compose ANY Visual!)**:
    - You are not limited to fixed diagram types. You can compose ANY visual using our rich vector building blocks and teacher annotations:
    - **Vector Primitives**:
      * `line`: Hand-drawn line with natural wobble: `{"kind": "line", "from": [x1, y1], "to": [x2, y2], "color": "#...", "label": "..."}`
      * `arrow`: Directional pointer arrow: `{"kind": "arrow", "from": [x1, y1], "to": [x2, y2], "color": "#...", "label": "..."}`
      * `circle`: `{"kind": "circle", "cx": 400, "cy": 250, "r": 40, "color": "#...", "label": "..."}`
      * `ellipse`: `{"kind": "ellipse", "cx": 400, "cy": 250, "rx": 60, "ry": 35, "color": "#..."}`
      * `rect`: Box with optional highlight fill: `{"kind": "rect", "x": 300, "y": 180, "w": 120, "h": 70, "color": "#...", "fill": true, "label": "..."}`
      * `polygon`: N-sided shape: `{"kind": "polygon", "points": [[x1, y1], [x2, y2], [x3, y3]], "color": "#..."}`
      * `arc`: Curved arc or angle marker: `{"kind": "arc", "cx": 400, "cy": 250, "r": 35, "startAngle": 0, "endAngle": 1.57}`
      * `dot`: Filled marker or counter point: `{"kind": "dot", "cx": 350, "cy": 220, "r": 8, "color": "#F59E0B"}`
      * `bracket`: Grouping bracket: `{"kind": "bracket", "from": [250, 280], "to": [450, 280], "direction": "bottom", "label": "Group of 10"}`
    - **Teacher Annotation Primitives (Act Like a Real Human Teacher!)**:
      * `circle_highlight`: Loop drawn around a target number, word, or card: `{"kind": "circle_highlight", "cx": 400, "cy": 250, "w": 90, "h": 45, "color": "#F59E0B"}`
      * `underline`: Hand-drawn double underline emphasizing a key rule: `{"kind": "underline", "cx": 400, "cy": 355, "w": 140, "color": "#F59E0B"}`
      * `checkmark`: Green ✓ next to a correct answer or completed step: `{"kind": "checkmark", "cx": 520, "cy": 355, "size": 32, "color": "#10B981"}`
      * `cross_out`: Red ✗ crossing out an incorrect guess: `{"kind": "cross_out", "cx": 520, "cy": 250, "size": 32, "color": "#EF4444"}`
    - **Example: Teaching Step-by-Step with Highlights & Annotations (e.g. 1 + 1 or regrouping)**:
      ```draw
      {
        "type": "scene",
        "title": "ADDITION: 1 + 1",
        "elements": [
          {"kind": "math", "x": 400, "y": 95, "latex": "1 + 1 = 2"},
          {"kind": "dot", "cx": 330, "cy": 220, "r": 16, "color": "#38BDF8", "label": "1 dot"},
          {"kind": "math", "x": 400, "y": 220, "latex": "+"},
          {"kind": "dot", "cx": 470, "cy": 220, "r": 16, "color": "#10B981", "label": "1 dot"},
          {"kind": "bracket", "from": [300, 270], "to": [500, 270], "direction": "bottom", "label": "Together = 2"},
          {"kind": "circle_highlight", "cx": 400, "cy": 355, "w": 130, "h": 50, "color": "#F59E0B"},
          {"kind": "math", "x": 400, "y": 355, "latex": "\\\\mathbf{2}"},
          {"kind": "checkmark", "cx": 490, "cy": 355, "size": 28, "color": "#10B981"}
        ]
      }
      ```

## STRICT CURRICULUM BOUNDARY:
- You teach elementary and introductory middle-school math (Grades 1 to 5, pre-algebra) and foundational elementary science.
- NEVER introduce advanced university physics (Theory of Relativity, quantum mechanics, black holes, thermodynamics, quantum electrodynamics, calculus).
- STRICT BOUNDARY FOR UNIVERSITY-LEVEL OUT-OF-CURRICULUM TOPICS (NO DRAWING, CONVERSATIONAL REDIRECTION ONLY):
  - If a student asks about topics like Theory of Relativity, quantum physics, black holes, or calculus:
  - UNDER NO CIRCUMSTANCES should you output a ```draw block or any whiteboard canvas operation! DO NOT draw a number line or pretend relativity is a 1st-grade hop diagram!
  - ONLY provide a warm, encouraging spoken response:
    "The Theory of Relativity is a fascinating topic from advanced university physics! As an elementary tutor, my whiteboard is dedicated to foundational math and elementary science—like multiplication, fractions, shapes, the water cycle, plant anatomy, and simple circuits. Which of those would you like to explore together?"
- Keep all LaTeX formulas ultra-simple and robust: e.g. "3 \\times 4 = 12", "\\frac{3}{4}", "8 + 5 = 13", "\\text{Area} = 4 \\times 3 = 12".
- NEVER put `\\text{}` inside `\\frac{}{}` or create nested LaTeX fractions that risk malformed syntax! Use pure numbers like `\\frac{3}{4}` or `\\frac{2}{1}`.

## SYNCHRONIZED TEACHING WORKFLOW (CRITICAL):
For a seamless classroom experience where the teacher draws and writes on the blackboard in real time while speaking:
1. STEP 1 (SPOKEN OPENER FIRST): Begin with EXACTLY ONE short, warm spoken sentence (8-16 words) that introduces what you are about to draw (e.g. "Let's draw a right triangle together and discover a famous pattern!"). No anchors in this opener.
2. STEP 2 (WHITEBOARD): Immediately after the opener, output the ```draw block containing the visual blackboard layout (title, KaTeX formula cards, diagrams, labels). If an out-of-curriculum advanced topic (e.g. quantum mechanics, relativity), omit the ```draw block entirely!
3. STEP 3 (SPOKEN TEACHING): Immediately after closing the ```draw block with ```, continue your spoken explanation (3-5 warm, explanatory sentences) in the SAME ORDER the board is drawn: first the title/main formula, then the diagram, then the final result. Each sentence should talk about one part of the board.
4. STEP 4 (TWO-WAY SOCRATIC CHECK-IN): Conclude your spoken explanation with a warm, encouraging check-in question inviting the student to participate (e.g. "Now take a look at the model: what would happen if we shaded 1 more part?" or "Can you spot how many rows we have?"). Tutoring is a continuous two-way conversation, not a passive one-way lecture!

CRITICAL RULES FOR WHITEBOARD GENERATION:
1. PURE KaTeX FORMULA TYPOGRAPHY (MANDATORY):
   - Every equation and mathematical symbol MUST be formatted as a KaTeX formula: {"kind": "math", "latex": "..."} or "formulaLabel" in diagram presets.
   - KaTeX renders instant, crisp, publication-grade math typography.
   - In JSON strings, ALWAYS escape LaTeX backslashes with double backslashes (e.g. "\\frac{3}{4}", "3 \\times 4 = 12", "8 + 5 = 13").
   - NEVER write formulas in handwritten text!
2. RULE OF ONE VISUAL MODEL (NO MULTI-DIAGRAM CONFUSION):
   - For any question, choose EXACTLY ONE clean visual representation.
   - E.g. For fractions: Use a fraction bar OR a fraction circle—never draw both!
   - Multiple overlapping diagrams confuse young learners and congest the canvas.
3. ZERO CONVERSATIONAL BLACKBOARD TEXT (CRITICAL):
   - NEVER write transcripts or spoken phrases on the canvas (e.g. "3 = parts we have", "what we have", "equal parts total", "1 part").
   - A real teacher SPEAKS conversational context out loud in their voice explanation.
   - The whiteboard is reserved ONLY for concise mathematical notation: "Numerator", "Denominator", "3 rows", "4 each", "Whole". Maximum 1-2 words per label!
4. COORDINATE GRID SYSTEM (800×460):
   - The virtual whiteboard canvas is 800 wide by 460 tall (center at x=400, y=230).
   - "title": Short lesson topic banner displayed at the top of the whiteboard (y: 35).
   - Zone 1 - Primary KaTeX Equation (y: 95 - 110): Place the main formula at y=100 (e.g. {"kind": "math", "x": 400, "y": 100, "latex": "..."}). NEVER use y < 95 when a title is present to prevent overlapping the title!
   - Zone 2 - Visual Diagram (y: 160 - 300): Main visual model centered strictly around (400, 230).
   - Zone 3 - Concise Labels: Keep labels short (1-2 words).
   - Zone 4 - Final Result / Conclusion KaTeX Equation (y: 345 - 360): Final answer card. CRITICAL: Place conclusion cards at y=355 so they never collide with the diagram above or toolbar below!
5. NO TEXT COLLISIONS OR OVERLAPPING:
   - Keep generous clearance (at least 45px vertical clearance between separate rows).
   - NEVER place a formula card directly over a diagram (Zone 2: y 160-300 is reserved exclusively for diagram graphics).
6. RICH PEDAGOGICAL SPOKEN TEACHING:
   - Keep your spoken explanation conversational, warm, and explanatory (4-6 sentences), walking through why the concept works step-by-step!
7. SYNCHRONIZED AUDIO-VISUAL ANCHORS (PRD Teaching Performance Protocol):
   - In your spoken explanation, wrap key referenced terms with `<anchor id="..." target="visual_model|equation|title">spoken phrase</anchor>`.
   - This empowers the client engine to glide the teacher's laser pointer and highlight cards on the board in exact synchrony with your spoken voice!
   - Example:
     "Look at the <anchor id=\"a1\" target=\"visual_model\">three rows of four dots</anchor>. When we count them up, <anchor id=\"a2\" target=\"equation\">we get 12 in total</anchor>!"
"""


_TIME_RE = re.compile(r'\b([01]?\d|2[0-3])\s*:\s*([0-5]\d)\b')
_TIME_KEYWORDS = [
    "24-hour", "24 hour", "24hr", "12-hour", "12 hour", "12hr", "military time",
    "am/pm", "am or pm", "clock time", "digital clock", "analog clock",
]


def is_time_conversion_request(text: str) -> bool:
    """True when the student is asking about 12-hour / 24-hour clock time."""
    lower = (text or "").lower()
    if any(k in lower for k in _TIME_KEYWORDS):
        return True
    return bool(_TIME_RE.search(lower)) and bool(
        re.search(r'\b(am|pm)\b|convert|o.?clock|what time', lower)
    )


def parse_requested_time(text: str) -> tuple:
    """Return the (hour, minute) the student actually asked about (last HH:MM mentioned)."""
    matches = _TIME_RE.findall(text or "")
    if not matches:
        return 15, 45
    h, m = matches[-1]
    return int(h), int(m)


def convert_24_to_12(hour: int, minute: int) -> Dict[str, Any]:
    """Textbook-accurate 24-hour -> 12-hour conversion."""
    suffix = "AM" if hour < 12 else "PM"
    hour12 = 12 if hour % 12 == 0 else hour % 12
    return {
        "hour": hour,
        "minute": minute,
        "hour12": hour12,
        "suffix": suffix,
        "t24": f"{hour:02d}:{minute:02d}",
        "t12": f"{hour12}:{minute:02d} {suffix}",
    }


def build_time_conversion_scene(hour: int, minute: int) -> Dict[str, Any]:
    """Dual-timeline scene: 24-hour line on top, 12-hour (AM/PM) line below, answer highlighted."""
    c = convert_24_to_12(hour, minute)
    t24 = f"{hour:02d}{{:}}{minute:02d}"
    if hour == 0:
        working = f"\\text{{Midnight: }} 00 \\rightarrow 12"
    elif hour < 12:
        working = f"\\text{{Morning: keep }} {hour}"
    elif hour == 12:
        working = "\\text{Noon: keep } 12"
    else:
        working = f"{t24} \\rightarrow {hour} - 12 = {hour - 12}"
    result = f"{t24} = {c['hour12']}{{:}}{minute:02d}\\text{{ {c['suffix']}}}"

    x0, x1 = 140, 660
    mx = round(x0 + ((hour + minute / 60) / 24) * (x1 - x0))
    grey = "#64748B"
    orange = "#F59E0B"
    elements: List[Dict[str, Any]] = [
        {"kind": "math", "x": 400, "y": 95, "latex": working},
        {"kind": "text", "x": 62, "y": 190, "text": "24-hour"},
        {"kind": "arrow", "from": [x0, 190], "to": [x1 + 10, 190], "color": grey},
        {"kind": "text", "x": 62, "y": 260, "text": "12-hour"},
        {"kind": "arrow", "from": [x0, 260], "to": [x1 + 10, 260], "color": grey},
    ]
    top_labels = ["00:00", "06:00", "12:00", "18:00", "24:00"]
    bottom_labels = ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"]
    for i in range(5):
        x = x0 + i * (x1 - x0) // 4
        elements.append({"kind": "line", "from": [x, 182], "to": [x, 198], "color": grey})
        elements.append({"kind": "text", "x": x, "y": 165, "text": top_labels[i]})
        elements.append({"kind": "line", "from": [x, 252], "to": [x, 268], "color": grey})
        elements.append({"kind": "text", "x": x, "y": 285, "text": bottom_labels[i]})
    elements += [
        {"kind": "circle", "cx": mx, "cy": 190, "r": 7, "color": orange},
        {"kind": "line", "from": [mx, 198], "to": [mx, 252], "color": orange},
        {"kind": "circle", "cx": mx, "cy": 260, "r": 7, "color": orange},
        {"kind": "math", "x": 400, "y": 355, "latex": result},
    ]
    return {"type": "scene", "title": "24-HOUR TO 12-HOUR TIME", "elements": elements}


def build_time_conversion_speech(hour: int, minute: int) -> str:
    c = convert_24_to_12(hour, minute)
    mm = f"{minute:02d}"
    if hour == 0:
        rule = f"Midnight is the start of the day, so 00:{mm} becomes <anchor id=\"a2\" target=\"equation\">12:{mm} AM</anchor>. There is no hour zero on a 12-hour clock!"
    elif hour < 12:
        rule = f"Before noon we keep the hour and say AM, so <anchor id=\"a2\" target=\"equation\">{hour:02d}:{mm} is {c['hour12']}:{mm} AM</anchor>."
    elif hour == 12:
        rule = f"Noon is special: 12 stays 12, but we switch to PM, so <anchor id=\"a2\" target=\"equation\">12:{mm} is 12:{mm} PM</anchor>."
    else:
        rule = (
            f"After noon we subtract 12 from the hour: <anchor id=\"a2\" target=\"equation\">{hour} minus 12 is {hour - 12}</anchor>, "
            f"so {hour}:{mm} becomes {c['hour12']}:{mm} PM."
        )
    next_try = "21:10" if hour != 21 else "18:20"
    return (
        "Let's line up our two clocks on a <anchor id=\"a1\" target=\"visual_model\">timeline</anchor>: "
        "the top line counts all 24 hours, and the bottom line counts 12 hours twice, first AM and then PM. "
        f"The orange dot shows {hour:02d}:{mm} on both lines. "
        f"{rule} "
        f"Now you try: where would {next_try} land on the timeline, and what time is that in 12-hour time?"
    )


def build_time_conversion_chips() -> List[ActionChip]:
    return [
        ActionChip(id="tm1", label="Convert 21:10 to 12-hour time", action="try_one"),
        ActionChip(id="tm2", label="Why is 12:00 noon PM?", action="explain_another_way"),
        ActionChip(id="tm3", label="What is 00:00 in 12-hour time?", action="draw_this"),
    ]


class TutorOrchestrator:
    @property
    def api_key(self) -> Optional[str]:
        return os.getenv("OPENAI_API_KEY") or OPENAI_API_KEY

    async def handle_user_message(
        self,
        session_id: str,
        user_text: str,
        context_mode: str = "draw",
        interruption_context: Optional[Dict[str, Any]] = None,
        active_referent: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream events for assistant response using real OpenAI API.
        Falls back to hardcoded teacher responses if API unavailable.
        """
        yield {
            "event": "status",
            "data": {"status": "Thinking...", "icon": "dot"}
        }
        await asyncio.sleep(0.05)

        # Try real OpenAI API first
        if self.api_key:
            try:
                async for event in self._stream_openai(
                    session_id, user_text, interruption_context=interruption_context, active_referent=active_referent
                ):
                    yield event
                return
            except Exception as e:
                print(f"[Orchestrator] OpenAI API error, falling back: {e}")
                traceback.print_exc()

        # Fallback: hardcoded teacher responses
        async for event in self._hardcoded_response(
            session_id, user_text, interruption_context=interruption_context, active_referent=active_referent
        ):
            yield event

    @staticmethod
    def _sanitize_raw_json(raw: str) -> str:
        """Escape unescaped backslashes in JSON before json.loads to protect LaTeX formulas."""
        temp = raw.replace('\\\\', '\x00\x00')
        temp = re.sub(r'\\([a-zA-Z\{\}\[\]])', r'\\\\\1', temp)
        temp = temp.replace('\x00\x00', '\\\\')
        temp = temp.replace('\x0c', r'\\f')
        temp = temp.replace('\x08', r'\\b')
        return temp

    @staticmethod
    def _clean_latex_str(raw: str) -> str:
        """Clean, heal, and repair LaTeX formulas for reliable KaTeX rendering."""
        if not raw or not isinstance(raw, str):
            return ""
        s = raw
        s = s.replace('\x0c', r'\f')
        s = s.replace('\x08', r'\b')
        s = s.replace('\t', r'\t')
        s = s.replace('\r', r'\r')
        s = s.replace('\n', ' ')
        # Catch stripped 'f' in \frac: bare "rac{" -> "\frac{"
        s = re.sub(r'(^|[^\w\\])rac(?=\{)', r'\1\\frac', s)
        keywords = [
            "frac", "sqrt", "cdot", "times", "theta", "alpha", "beta", "gamma",
            "delta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega",
            "sum", "int", "prod", "lim", "infty", "approx", "ne", "neq", "le", "leq",
            "ge", "geq", "pm", "mp", "partial", "nabla", "implies", "iff", "forall",
            "exists", "quad", "qquad", "mathbf", "mathit", "left", "right"
        ]
        for kw in keywords:
            s = re.sub(r'(^|[^\w\\])' + kw + r'(?=[^a-zA-Z]|$)', r'\1\\' + kw, s)
        s = re.sub(r'\\\\+', r'\\', s)
        return s.strip()

    @classmethod
    def _deep_clean_latex(cls, obj: Any) -> Any:
        """Recursively clean any 'latex', 'equation', or 'formulaLabel' strings inside draw payloads."""
        if isinstance(obj, dict):
            new_dict = {}
            for k, v in obj.items():
                if k in ("latex", "formulaLabel", "equation") and isinstance(v, str):
                    new_dict[k] = cls._clean_latex_str(v)
                else:
                    new_dict[k] = cls._deep_clean_latex(v)
            return new_dict
        elif isinstance(obj, list):
            return [cls._deep_clean_latex(item) for item in obj]
        return obj

    @staticmethod
    def _extract_canvas_op(text: str, allow_partial: bool = False) -> Optional[CanvasOp]:
        """Extract a structured whiteboard CanvasOp from accumulated LLM response."""
        # 1. Match ```draw ... ``` or ```json { ... } ```
        draw_match = re.search(r'```draw\s*(.*?)```', text, re.DOTALL)
        if not draw_match:
            draw_match = re.search(r'```(?:json)?\s*(\{\s*"type"\s*:\s*"(?:scene|dynamic_scene|math|diagram|handwriting)".*?\})\s*```', text, re.DOTALL)
        if not draw_match and allow_partial:
            draw_match = re.search(r'```draw\s*(\{.*)', text, re.DOTALL)

        if draw_match:
            try:
                raw_json = draw_match.group(1).strip()
                if not raw_json.endswith("}"):
                    raw_json = raw_json.rsplit("}", 1)[0] + "}" if "}" in raw_json else raw_json + "}"
                sanitized_json = TutorOrchestrator._sanitize_raw_json(raw_json)
                draw_data = json.loads(sanitized_json)
                draw_data = TutorOrchestrator._deep_clean_latex(draw_data)
                draw_type = draw_data.get("type", "")

                if draw_type in ("scene", "dynamic_scene") or "elements" in draw_data:
                    return CanvasOp(
                        op="draw_scene",
                        payload=draw_data
                    )
                elif draw_type == "diagram" or "diagram" in draw_data:
                    return CanvasOp(
                        op="draw_diagram",
                        payload=draw_data
                    )
                elif draw_type == "math" or "latex" in draw_data:
                    return CanvasOp(
                        op="create_math",
                        payload={
                            "latex": draw_data.get("latex") or draw_data.get("text", ""),
                            "color": draw_data.get("color", "#EDEDED"),
                        }
                    )
                elif draw_type == "svg" or "svg" in draw_data:
                    return CanvasOp(
                        op="draw_svg",
                        payload=draw_data
                    )
                elif draw_type == "handwriting" or "text" in draw_data:
                    return CanvasOp(
                        op="draw_handwriting",
                        payload={
                            "text": draw_data.get("text", ""),
                            "color": draw_data.get("color", "#60A5FA"),
                            "size": draw_data.get("size", 38),
                        }
                    )
            except Exception:
                pass

        # 2. Match ```svg ... ``` or raw <svg>...</svg>
        svg_match = re.search(r'```svg\s*\n(.*?)```', text, re.DOTALL)
        if not svg_match:
            svg_match = re.search(r'(<svg\b[^>]*>.*?</svg>)', text, re.DOTALL)
        if svg_match:
            return CanvasOp(
                op="draw_svg",
                payload={"svg": svg_match.group(1).strip()}
            )

        return None

    @staticmethod
    def _enforce_time_board(op: Optional[CanvasOp], user_text: str) -> Optional[CanvasOp]:
        """For clock-time questions, never allow an arithmetic number-line / literal 'arrow' board."""
        if op is None or not is_time_conversion_request(user_text):
            return op
        try:
            blob = json.dumps(op.payload).lower()
        except Exception:
            return op
        if '"number_line"' in blob or re.search(r'\barrow\b(?!")', re.sub(r'"kind":\s*"arrow"', '', blob)):
            h, m = parse_requested_time(user_text)
            return CanvasOp(op="draw_scene", payload=build_time_conversion_scene(h, m))
        return op

    @staticmethod
    def _get_clean_spoken(raw: str) -> str:
        """Strip all whiteboard draw blocks and raw SVGs so spoken text is pure."""
        clean = re.sub(r'```[\s\S]*?```', '', raw)
        clean = re.sub(r'<svg\b[^>]*>[\s\S]*?</svg>', '', clean)
        # If there is an unclosed ``` at the tail, strip everything from the ``` onwards
        if "```" in clean:
            clean = clean.split("```")[0]
        return clean.strip()

    async def _stream_openai(
        self,
        session_id: str,
        user_text: str,
        interruption_context: Optional[Dict[str, Any]] = None,
        active_referent: Optional[Dict[str, Any]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream from OpenAI — works with any model, including reasoning models."""
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self.api_key)

        # Build conversation history
        history = store.get_messages(session_id)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Inject Barge-In Interruption Context (PRD Section 20-21)
        if interruption_context:
            target_label = interruption_context.get("targetObjectLabel") or interruption_context.get("triggerWord") or "the concept"
            role = interruption_context.get("targetObjectRole") or "whiteboard element"
            time_sec = round((interruption_context.get("interruptedAtMs") or 0) / 1000, 1)
            messages.append({
                "role": "system",
                "content": (
                    f"[TEMPORAL BARGE-IN INTERRUPTION CONTEXT: The student interrupted you at t={time_sec}s while you were vocalizing/pointing at '{target_label}' ({role}). "
                    f"Acknowledge the interruption warmly and naturally in one brief opening phrase (e.g. 'You caught me right as I was showing {target_label}!', or 'Great question!'), then answer their question directly using clear whiteboard visuals.]"
                )
            })

        # Inject Multimodal Spatial Reference Context (PRD Section 23 - Multimodal Reference Resolution)
        if active_referent:
            ref_id = active_referent.get("objectId") or "item"
            ref_type = active_referent.get("semanticType") or "diagram"
            ref_label = active_referent.get("label") or active_referent.get("latex") or ref_type
            messages.append({
                "role": "system",
                "content": (
                    f"[MULTIMODAL SPATIAL REFERENCE: The student is pointing directly to whiteboard object '{ref_id}' (semanticType: {ref_type}, label/formula: '{ref_label}'). "
                    f"Their deictic references ('this', 'that', 'why is this', 'here') refer directly to this object! Answer their question specifically with respect to it.]"
                )
            })

        for msg in history[-10:]:
            messages.append({
                "role": msg.role if msg.role in ("user", "assistant") else "user",
                "content": msg.content
            })

        messages.append({"role": "user", "content": user_text})

        time_request = is_time_conversion_request(user_text)
        if time_request:
            t_h, t_m = parse_requested_time(user_text)
            t_conv = convert_24_to_12(t_h, t_m)
            messages.append({
                "role": "system",
                "content": (
                    f"[TIME CONVERSION TASK: The student asks about 24-hour to 12-hour time. The exact time to convert is {t_conv['t24']}, "
                    f"and the CORRECT answer is {t_conv['t12']}. Teach that exact time (not the example in their prompt). "
                    "Use the dual-timeline board from the system prompt (never a `number_line` diagram, never 3 + 4 = 7, never the word 'arrow'). "
                    f"Use this exact ```draw block:\n```draw\n{json.dumps(build_time_conversion_scene(t_h, t_m))}\n```"
                )
            })

        # Store user message
        user_msg = ChatMessage(
            session_id=session_id,
            role="user",
            content=user_text
        )
        store.add_message(user_msg)

        yield {
            "event": "status",
            "data": {"status": "Tutor is teaching...", "icon": "dot"}
        }

        # Stream the response with reasoning model compatibility
        create_kwargs: Dict[str, Any] = {
            "model": OPENAI_MODEL,
            "messages": messages,
            "stream": True,
            "max_completion_tokens": 4000,
        }
        effort = (os.getenv("AI_EFFORT") or "low").lower()
        if effort in ("none", "minimal", "low", "medium", "high"):
            create_kwargs["reasoning_effort"] = effort

        try:
            stream = await client.chat.completions.create(**create_kwargs)
        except Exception:
            create_kwargs.pop("reasoning_effort", None)
            stream = await client.chat.completions.create(**create_kwargs)

        full_content = ""
        display_content = ""
        draw_op_emitted = False
        canvas_ops: List[CanvasOp] = []

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue

            if delta.content:
                token = delta.content
                full_content += token

                # Eagerly detect completed whiteboard draw/scene blocks during streaming!
                if not draw_op_emitted:
                    early_op = self._enforce_time_board(self._extract_canvas_op(full_content), user_text)
                    if early_op:
                        draw_op_emitted = True
                        store.apply_canvas_op(session_id, early_op)
                        canvas_ops.append(early_op)
                        yield {
                            "event": "status",
                            "data": {"status": "Tutor Writing on Board...", "icon": "pen"}
                        }
                        yield {"event": "canvas_op", "data": early_op.model_dump()}

                # Extract clean spoken text tokens (never leak ```draw JSON or SVG tags into speech)
                clean_spoken = self._get_clean_spoken(full_content)
                if len(clean_spoken) > len(display_content):
                    new_token = clean_spoken[len(display_content):]
                    display_content = clean_spoken
                    yield {
                        "event": "token",
                        "data": {"token": new_token, "accumulated": display_content}
                    }

        # ─── Post-processing: Extract draw, canvas ops, and highlights ───
        parts = []

        # If not already emitted during streaming, extract from full_content
        if not draw_op_emitted:
            fallback_op = self._enforce_time_board(self._extract_canvas_op(full_content, allow_partial=True), user_text)
            if fallback_op:
                draw_op_emitted = True
                store.apply_canvas_op(session_id, fallback_op)
                canvas_ops.append(fallback_op)
                yield {
                    "event": "status",
                    "data": {"status": "Tutor Writing on Board...", "icon": "pen"}
                }
                yield {"event": "canvas_op", "data": fallback_op.model_dump()}

        # Extract ```canvas ... ``` blocks (Backward compatibility)
        if not draw_op_emitted:
            canvas_match = re.search(r'```canvas\s*\n(.*?)```', full_content, re.DOTALL)
            if canvas_match:
                try:
                    shapes = json.loads(canvas_match.group(1).strip())
                    yield {
                        "event": "status",
                        "data": {"status": "Tutor Writing on Board...", "icon": "pen"}
                    }

                    for shape in shapes:
                        shape_type = shape.get("type", "rect")
                        op_type = "create_math" if shape_type == "math" else "create_text" if shape_type == "text" else "create_shape"
                        op = CanvasOp(
                            op=op_type,
                            payload={
                                "id": str(uuid.uuid4()),
                                "type": shape_type,
                                "x": shape.get("x", 400),
                                "y": shape.get("y", 250),
                                "width": shape.get("width", 100),
                                "height": shape.get("height", 80),
                                "color": shape.get("color", "#EDEDED"),
                                "fill": shape.get("fill", "transparent"),
                                "stroke_width": shape.get("stroke_width", 2),
                                "text": shape.get("text"),
                                "latex": shape.get("latex"),
                            }
                        )
                        store.apply_canvas_op(session_id, op)
                        canvas_ops.append(op)
                        yield {
                            "event": "canvas_op",
                            "data": op.model_dump()
                        }
                        await asyncio.sleep(0.02)
                except (json.JSONDecodeError, TypeError) as e:
                    print(f"[Orchestrator] Failed to parse canvas block: {e}")

        # Fallback intelligent extraction if LLM omitted explicit draw block
        if len(canvas_ops) == 0:
            user_lower = user_text.lower()
            if any(w in user_lower for w in ["relativity", "physics", "quantum", "gravity", "e=mc", "black hole", "thermodynamics"]):
                # Out of curriculum bounds: strictly DO NOT output any whiteboard canvas operation
                pass
            elif is_time_conversion_request(user_text):
                t_h, t_m = parse_requested_time(user_text)
                op = CanvasOp(op="draw_scene", payload=build_time_conversion_scene(t_h, t_m))
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["slope", "intercept", "mx+b", "mx + b", "y = mx + b", "linear graph", "coordinate line"]):
                op = CanvasOp(
                    op="draw_scene",
                    payload={
                        "type": "scene",
                        "title": "SLOPE-INTERCEPT FORM",
                        "elements": [
                            {"kind": "math", "x": 400, "y": 95, "latex": "y = mx + b"},
                            {
                                "kind": "diagram",
                                "diagram": "slope_intercept",
                                "cx": 400,
                                "cy": 240,
                                "slope": 0.65,
                                "intercept": 28,
                                "slopeLabel": "m = \\frac{\\text{rise}}{\\text{run}}",
                                "interceptLabel": "b = \\text{y-intercept}",
                                "formulaLabel": "y = mx + b"
                            },
                            {"kind": "math", "x": 400, "y": 345, "latex": "m = \\text{slope} \\quad \\text{and} \\quad b = \\text{y-intercept}"}
                        ]
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["decimal", "decimals", "point", "tenths", "hundredths"]):
                # Decimals: Place value column addition / subtraction, NEVER a whole number line!
                arith_match = re.search(r'([0-9]+\.[0-9]+)\s*([\+\-])\s*([0-9]+\.[0-9]+)\s*=\s*([0-9]+\.[0-9]+)', full_content)
                a_str = arith_match.group(1) if arith_match else "2.4"
                op_sign = arith_match.group(2) if arith_match else "+"
                b_str = arith_match.group(3) if arith_match else "1.3"
                c_str = arith_match.group(4) if arith_match else "3.7"
                op = CanvasOp(
                    op="draw_scene",
                    payload={
                        "type": "scene",
                        "title": "ADDING & SUBTRACTING DECIMALS",
                        "elements": [
                            {"kind": "math", "x": 400, "y": 95, "latex": "\\text{Key Rule: Line up the decimal points!}"},
                            {"kind": "math", "x": 290, "y": 210, "latex": f"\\begin{{array}}{{r@{{\\,}}l}} & {a_str} \\\\ {op_sign} & {b_str} \\\\ \\hline & {c_str} \\end{{array}}"},
                            {"kind": "math", "x": 510, "y": 210, "latex": "\\begin{array}{r@{\\,}l} & 5.6 \\\\ - & 2.1 \\\\ \\hline & 3.5 \\end{array}"},
                            {"kind": "math", "x": 400, "y": 345, "latex": f"{a_str} {op_sign} {b_str} = {c_str} \\quad \\text{{and}} \\quad 5.6 - 2.1 = 3.5"}
                        ]
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["array", "multiplication array", "times", "multiply", "3x4", "3 x 4", "rows and columns", "3*4", "3×4"]):
                op = CanvasOp(
                    op="draw_diagram",
                    payload={
                        "diagram": "array_model",
                        "rows": 3,
                        "cols": 4,
                        "formulaLabel": "3 \\times 4 = 12"
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["ten frame", "ten-frame", "make 10", "making 10", "8 + 5", "8+5", "tenframe"]):
                op = CanvasOp(
                    op="draw_diagram",
                    payload={
                        "diagram": "ten_frame",
                        "count": 8,
                        "addCount": 5,
                        "formulaLabel": "8 + 5 = 10 + 3 = 13"
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["tape diagram", "tape_diagram", "singapore math", "part whole"]):
                op = CanvasOp(
                    op="draw_diagram",
                    payload={
                        "diagram": "tape_diagram",
                        "parts": [
                            {"label": "Part A (15)", "value": 15, "color": "#38BDF8"},
                            {"label": "Part B (25)", "value": 25, "color": "#34D399"}
                        ],
                        "totalLabel": "Total = 40",
                        "formulaLabel": "15 + 25 = 40"
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["number line", "numberline", "hops", "jump on line"]):
                arith_match = re.search(r'([0-9]+)\s*([\+\-])\s*([0-9]+)\s*=\s*([0-9]+)', full_content)
                eq_str = f"{arith_match.group(1)} {arith_match.group(2)} {arith_match.group(3)} = {arith_match.group(4)}" if arith_match else "3 + 4 = 7"
                op = CanvasOp(
                    op="draw_diagram",
                    payload={
                        "diagram": "number_line",
                        "start": 0,
                        "end": 10,
                        "equation": eq_str,
                        "formulaLabel": eq_str
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["chocolate", "chocolate bar", "fraction bar", "bar model", "3/4", "three fourths", "quarter"]):
                op = CanvasOp(
                    op="draw_diagram",
                    payload={
                        "diagram": "fraction_bar",
                        "totalParts": 4,
                        "shadedParts": 3,
                        "fractionLabel": "\\frac{3}{4}"
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            elif any(w in user_lower for w in ["fraction", "half", "1/2", "divide circle"]):
                op = CanvasOp(
                    op="draw_diagram",
                    payload={
                        "diagram": "fraction_circle",
                        "radius": 85,
                        "totalParts": 2,
                        "shadedParts": 1,
                        "fractionLabel": "\\frac{1}{2} + \\frac{1}{2} = 1"
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
            elif any(w in user_lower for w in ["pythagor", "pythagorean", "right triangle", "hypotenuse", "a^2 + b^2", "a squared + b squared"]):
                op = CanvasOp(
                    op="draw_scene",
                    payload={
                        "type": "scene",
                        "title": "PYTHAGOREAN THEOREM",
                        "elements": [
                            {"kind": "math", "x": 400, "y": 95, "latex": "a^2 + b^2 = c^2"},
                            {
                                "kind": "right_triangle",
                                "cx": 400,
                                "cy": 230,
                                "w": 180,
                                "h": 130,
                                "legALabel": "a = 3",
                                "legBLabel": "b = 4",
                                "hypotenuseLabel": "c = 5",
                                "formulaLabel": "3^2 + 4^2 = 5^2"
                            },
                            {"kind": "math", "x": 400, "y": 355, "latex": "3^2 + 4^2 = 9 + 16 = 25 = 5^2"}
                        ]
                    }
                )
                store.apply_canvas_op(session_id, op)
                canvas_ops.append(op)
                yield {"event": "canvas_op", "data": op.model_dump()}
            else:
                # Look for LaTeX math or clean mathematical equations
                latex_match = re.search(r'\\\[(.*?)\\\]|\\\((.*?)\\\)', full_content, re.DOTALL)
                if latex_match:
                    raw_latex = (latex_match.group(1) or latex_match.group(2)).strip()
                    if 2 <= len(raw_latex) <= 120:
                        op = CanvasOp(
                            op="create_math",
                            payload={"latex": raw_latex, "color": "#EDEDED"}
                        )
                        store.apply_canvas_op(session_id, op)
                        canvas_ops.append(op)
                        yield {"event": "canvas_op", "data": op.model_dump()}
                else:
                    eq_match = re.search(r'([a-zA-Z0-9\^_\+\-\*/\(\)\s]{3,}\s*=\s*[a-zA-Z0-9\^_\+\-\*/\(\)\s]{1,})', full_content)
                    if eq_match:
                        raw_eq = eq_match.group(1).strip()
                        if any(w in user_lower for w in ["triangle", "pythagor", "hypotenuse"]):
                            raw_eq = "a^2 + b^2 = c^2"
                        if 3 <= len(raw_eq) <= 60 and "\n" not in raw_eq:
                            # Always use KaTeX for math equations — instant, crisp, and 100% accurate
                            op = CanvasOp(
                                op="create_math",
                                payload={"latex": raw_eq, "color": "#60A5FA"}
                            )
                            store.apply_canvas_op(session_id, op)
                            canvas_ops.append(op)
                            yield {"event": "canvas_op", "data": op.model_dump()}

        # Extract ```highlight ... ``` blocks
        highlight_match = re.search(r'```highlight\s*\n(.*?)```', full_content, re.DOTALL)
        if highlight_match:
            try:
                hl = json.loads(highlight_match.group(1).strip())
                op = CanvasOp(
                    op="highlight_object",
                    payload={
                        "x": hl.get("x", 400),
                        "y": hl.get("y", 260),
                        "message": hl.get("message", "Look here!")
                    }
                )
                canvas_ops.append(op)
                yield {
                    "event": "canvas_op",
                    "data": op.model_dump()
                }
            except (json.JSONDecodeError, TypeError):
                pass

        # Clean display content — remove draw/canvas/highlight code blocks
        clean_content = self._get_clean_spoken(full_content)

        # Send cleaned final spoken content
        if clean_content != display_content.strip():
            yield {
                "event": "token",
                "data": {"token": "", "accumulated": clean_content}
            }

        # Extract LaTeX
        latex_matches = re.findall(r'\$\$(.+?)\$\$', clean_content, re.DOTALL)
        for latex in latex_matches:
            parts.append(ContentPart(
                type="math",
                latex=latex.strip(),
                title="Formula"
            ))

        # Generate contextual Socratic action chips
        action_chips = self._generate_chips(user_text, clean_content)

        if action_chips:
            yield {
                "event": "action_chips",
                "data": [chip.model_dump() for chip in action_chips]
            }

        # Persist
        final_message = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=clean_content,
            parts=parts,
            action_chips=action_chips
        )
        store.add_message(final_message)

        yield {
            "event": "complete",
            "data": final_message.model_dump()
        }

    def _generate_chips(self, user_text: str, response: str) -> List[ActionChip]:
        """Generate contextual Socratic action chips based on the topic."""
        lower = (user_text + " " + response).lower()

        if is_time_conversion_request(user_text):
            return build_time_conversion_chips()
        elif any(w in lower for w in ["slope", "intercept", "mx+b", "mx + b", "y = mx + b"]):
            return [
                ActionChip(id="sl1", label="What if the slope m is zero?", action="explain_another_way"),
                ActionChip(id="sl2", label="Show line with y-intercept at 3", action="draw_this"),
                ActionChip(id="sl3", label="What is a negative slope?", action="try_one"),
            ]
        elif any(w in lower for w in ["relativity", "quantum", "black hole", "calculus", "thermodynamics"]):
            return [
                ActionChip(id="sc1", label="Teach decimal addition", action="explain_decimals"),
                ActionChip(id="sc2", label="Show multiplication arrays", action="explain_array"),
                ActionChip(id="sc3", label="Explore fractions with chocolate bars", action="explain_fractions"),
            ]
        elif any(w in lower for w in ["decimal", "decimals", "tenths", "hundredths", "point"]):
            return [
                ActionChip(id="dec1", label="How do we line up decimal points?", action="explain_another_way"),
                ActionChip(id="dec2", label="Try adding 4.2 + 3.5 in columns", action="try_one"),
                ActionChip(id="dec3", label="How do we subtract decimals?", action="draw_this"),
            ]
        elif any(w in lower for w in ["array", "multiplication", "times", "multiply", "rows"]):
            return [
                ActionChip(id="ar1", label="What if we turn it into 4 × 3?", action="try_one"),
                ActionChip(id="ar2", label="Show 2 × 6 array", action="draw_this"),
                ActionChip(id="ar3", label="How is multiplication repeated addition?", action="explain_another_way"),
            ]
        elif any(w in lower for w in ["ten frame", "ten-frame", "make 10", "making 10", "8 + 5"]):
            return [
                ActionChip(id="tf1", label="Try 9 + 4 on a ten-frame", action="try_one"),
                ActionChip(id="tf2", label="How many more to make 10?", action="explain_another_way"),
                ActionChip(id="tf3", label="Show 7 + 6 with two frames", action="draw_this"),
            ]
        elif any(w in lower for w in ["tape diagram", "tape_diagram", "singapore math", "part whole"]):
            return [
                ActionChip(id="td1", label="What if Part A is unknown?", action="try_one"),
                ActionChip(id="td2", label="Show comparison model", action="draw_this"),
                ActionChip(id="td3", label="Explain with word problem", action="explain_another_way"),
            ]
        elif any(w in lower for w in ["number line", "numberline", "hops", "jump"]):
            return [
                ActionChip(id="nl1", label="What if we hop backwards?", action="try_one"),
                ActionChip(id="nl2", label="Show 5 + 3 on the line", action="draw_this"),
                ActionChip(id="nl3", label="Explain addition on line", action="explain_another_way"),
            ]
        elif any(w in lower for w in ["chocolate", "fraction bar", "bar model", "3/4", "fraction", "divide", "half", "quarter"]):
            return [
                ActionChip(id="c1", label="What if we eat 2 parts?", action="try_one"),
                ActionChip(id="c2", label="Compare 3/4 and 1/2", action="draw_this"),
                ActionChip(id="c3", label="Explain with chocolate bar", action="explain_another_way"),
            ]
        elif any(w in lower for w in ["pythagor", "hypotenuse", "right triangle", "a^2 + b^2", "a squared + b squared"]):
            return [
                ActionChip(id="pt1", label="Why does a² + b² = c² work?", action="explain_another_way"),
                ActionChip(id="pt2", label="Try a 6-8-10 right triangle", action="try_one"),
                ActionChip(id="pt3", label="What is the hypotenuse?", action="explain_hypotenuse"),
            ]
        elif any(w in lower for w in ["shape", "geometry", "triangle", "rectangle", "square", "circle", "perimeter", "area"]):
            return [
                ActionChip(id="sh1", label="How many corners does a rectangle have?", action="try_one"),
                ActionChip(id="sh2", label="Show area with an array", action="draw_this"),
                ActionChip(id="sh3", label="Explain perimeter simply", action="explain_another_way"),
            ]
        else:
            return [
                ActionChip(id="g1", label="What is 3/4 with a chocolate bar?", action="explain_fractions"),
                ActionChip(id="g2", label="Show 3 × 4 with an array", action="explain_array"),
                ActionChip(id="g3", label="Add 8 + 5 on a ten-frame", action="explain_ten_frame"),
            ]

    async def _hardcoded_response(
        self,
        session_id: str,
        user_text: str,
        interruption_context: Optional[Dict[str, Any]] = None,
        active_referent: Optional[Dict[str, Any]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fallback teacher responses centered on an 800×600 virtual board.
        Spoken voice explains concepts directly while blackboard receives formulas and diagrams.
        """
        cleaned = user_text.strip().lower()

        parts = []
        canvas_ops = []
        action_chips = []

        prefix = ""
        if interruption_context:
            interrupted_label = interruption_context.get("targetObjectLabel") or "that concept"
            prefix = f"You caught me right as I was showing {interrupted_label}! "
        elif active_referent:
            ref_label = active_referent.get("label") or "this item"
            prefix = f"Looking right at {ref_label} on your board: "

        if is_time_conversion_request(user_text):
            t_h, t_m = parse_requested_time(user_text)
            spoken_text = build_time_conversion_speech(t_h, t_m)
            canvas_ops.append(CanvasOp(op="draw_scene", payload=build_time_conversion_scene(t_h, t_m)))
            action_chips = build_time_conversion_chips()
        elif any(w in cleaned for w in ["array", "multiplication array", "times", "multiply", "3x4", "3 x 4", "rows and columns", "3*4", "3×4"]):
            spoken_text = (
                "Welcome to our math whiteboard! Let's explore this <anchor id=\"a1\" target=\"visual_model\">multiplication array</anchor> together. "
                "Notice how our counters are organized into 3 equal rows with 4 counters in every single row. "
                "When we count row by row, we get 4, 8, and 12! "
                "So <anchor id=\"a2\" target=\"equation\">3 times 4 equals 12</anchor>. "
                "Arrays are fantastic because they show us that multiplication is simply equal groups combined together."
            )
            canvas_ops.append(CanvasOp(op="draw_diagram", payload={"diagram": "array_model", "rows": 3, "cols": 4, "formulaLabel": "3 \\times 4 = 12"}))
            action_chips = [
                ActionChip(id="ar1", label="What if we turn it into 4 × 3?", action="try_one"),
                ActionChip(id="ar2", label="Show 2 × 6 array", action="draw_this"),
                ActionChip(id="ar3", label="How is multiplication repeated addition?", action="explain_another_way"),
            ]
        elif any(w in cleaned for w in ["ten frame", "ten-frame", "make 10", "making 10", "8 + 5", "8+5", "tenframe"]):
            spoken_text = (
                "Here is our <anchor id=\"a1\" target=\"visual_model\">ten-frame model</anchor> to make adding intuitive and visual! "
                "We start with 8 blue counters filling the top frame. "
                "To add 5 more, we first drop 2 counters into the empty spots to complete a full 10! "
                "Then the remaining 3 counters land in the second frame below. "
                "Adding onto a full ten is effortless: <anchor id=\"a2\" target=\"equation\">10 plus 3 gives us 13</anchor>! "
                "Making tens is one of the most powerful superhero strategies in arithmetic."
            )
            canvas_ops.append(CanvasOp(op="draw_diagram", payload={"diagram": "ten_frame", "count": 8, "addCount": 5, "formulaLabel": "8 + 5 = 10 + 3 = 13"}))
            action_chips = [
                ActionChip(id="tf1", label="Try 9 + 4 on a ten-frame", action="try_one"),
                ActionChip(id="tf2", label="How many more to make 10?", action="explain_another_way"),
                ActionChip(id="tf3", label="Show 7 + 6 with two frames", action="draw_this"),
            ]
        elif any(w in cleaned for w in ["tape diagram", "tape_diagram", "singapore math", "part whole"]):
            spoken_text = (
                "Look at this <anchor id=\"a1\" target=\"visual_model\">tape diagram</anchor>! In Singapore math, we use visual bars to represent the different parts of a word problem. "
                "When we combine part A with a length of 15 and part B with a length of 25, <anchor id=\"a2\" target=\"equation\">the entire combined bar shows us the total sum of 40</anchor>. "
                "Tape diagrams make it crystal clear to see what is given and what is missing."
            )
            canvas_ops.append(CanvasOp(op="draw_diagram", payload={
                "diagram": "tape_diagram",
                "parts": [
                    {"label": "Part A (15)", "value": 15, "color": "#38BDF8"},
                    {"label": "Part B (25)", "value": 25, "color": "#34D399"}
                ],
                "totalLabel": "Total = 40",
                "formulaLabel": "15 + 25 = 40"
            }))
            action_chips = [
                ActionChip(id="td1", label="What if Part A is unknown?", action="try_one"),
                ActionChip(id="td2", label="Show comparison model", action="draw_this"),
                ActionChip(id="td3", label="Explain with word problem", action="explain_another_way"),
            ]
        elif any(w in cleaned for w in ["decimal", "decimals", "decimal point", "tenths", "hundredths"]):
            spoken_text = (
                "When we add or subtract decimals, the golden secret is always to line up the <anchor id=\"a1\" target=\"equation\">decimal points</anchor> straight down in a tidy vertical column! "
                "Keeping the decimal points aligned guarantees that ones, tenths, and hundredths stay in their correct place value columns. "
                "For 2.4 plus 1.3, we combine the tenths to get 7 tenths, and combine the ones to get 3 ones: <anchor id=\"a2\" target=\"equation\">giving us 3.7</anchor>! "
                "And for 5.6 minus 2.1, subtracting column by column yields <anchor id=\"a3\" target=\"equation\">3.5</anchor>. Notice how the decimal points never shift."
            )
            canvas_ops.append(CanvasOp(
                op="draw_scene",
                payload={
                    "type": "scene",
                    "title": "ADDING & SUBTRACTING DECIMALS",
                    "elements": [
                        {"kind": "math", "x": 400, "y": 95, "latex": "\\text{Key Rule: Line up the decimal points!}"},
                        {"kind": "math", "x": 290, "y": 210, "latex": "\\begin{array}{r@{\\,}l} & 2.4 \\\\ + & 1.3 \\\\ \\hline & 3.7 \\end{array}"},
                        {"kind": "math", "x": 510, "y": 210, "latex": "\\begin{array}{r@{\\,}l} & 5.6 \\\\ - & 2.1 \\\\ \\hline & 3.5 \\end{array}"},
                        {"kind": "math", "x": 400, "y": 355, "latex": "2.4 + 1.3 = 3.7 \\quad \\text{and} \\quad 5.6 - 2.1 = 3.5"}
                    ]
                }
            ))
            action_chips = [
                ActionChip(id="dec1", label="Why must decimal points line up?", action="explain_another_way"),
                ActionChip(id="dec2", label="Try adding 4.2 + 3.5 in columns", action="try_one"),
                ActionChip(id="dec3", label="How do we subtract decimals?", action="draw_this"),
            ]
        elif any(w in cleaned for w in ["number line", "numberline", "hops", "jump on line"]):
            spoken_text = (
                "Here is our <anchor id=\"a1\" target=\"visual_model\">number line</anchor>! We begin standing at number 3 and make 4 equal hops to the right: landing on 4, 5, 6, and finally 7! "
                "This visual path shows us why <anchor id=\"a2\" target=\"equation\">three plus four equals seven</anchor>. "
                "Remember, hopping to the right increases our value and adds, while jumping to the left subtracts."
            )
            canvas_ops.append(CanvasOp(op="draw_diagram", payload={"diagram": "number_line", "start": 0, "end": 10, "equation": "3 + 4 = 7", "formulaLabel": "3 + 4 = 7"}))
            action_chips = [
                ActionChip(id="nl1", label="What if we hop backwards?", action="try_one"),
                ActionChip(id="nl2", label="Show 5 + 3 on the line", action="draw_this"),
                ActionChip(id="nl3", label="Explain addition on line", action="explain_another_way"),
            ]
        elif any(w in cleaned for w in ["plus", "addition", "subtract", "subtraction", "minus", "+"]):
            spoken_text = (
                "Let's look at basic addition! When we combine 3 counters with 4 counters, <anchor id=\"a1\" target=\"equation\">three plus four gives us seven</anchor>. "
                "Making equal groups or using a ten-frame helps us see the answer clearly and build solid number sense!"
            )
            canvas_ops.append(CanvasOp(
                op="draw_scene",
                payload={
                    "type": "scene",
                    "title": "ADDITION & SUBTRACTION",
                    "elements": [
                        {"kind": "math", "x": 400, "y": 95, "latex": "3 + 4 = 7"},
                        {"kind": "diagram", "diagram": "ten_frame", "count": 3, "addCount": 4, "formulaLabel": "3 + 4 = 7"},
                        {"kind": "math", "x": 400, "y": 355, "latex": "7 - 4 = 3"}
                    ]
                }
            ))
            action_chips = [
                ActionChip(id="ad1", label="Show 3 + 4 on a number line", action="draw_number_line"),
                ActionChip(id="ad2", label="What is 8 + 5 on a ten-frame?", action="explain_ten_frame"),
                ActionChip(id="ad3", label="How does subtraction work?", action="explain_another_way"),
            ]
        elif any(w in cleaned for w in ["chocolate", "fraction bar", "bar model", "3/4", "three fourths", "quarter"]):
            spoken_text = (
                "Imagine a delicious <anchor id=\"a1\" target=\"visual_model\">chocolate bar</anchor> divided cleanly into four equal pieces! "
                "If you enjoy three of those four pieces, you have shaded exactly <anchor id=\"a2\" target=\"equation\">three fourths of the whole bar</anchor>. "
                "The bottom number, the denominator 4, tells us the total number of equal pieces the bar was split into. "
                "And the top number, the numerator 3, tells us how many pieces are shaded. Fractions are simply fair, equal parts of a whole!"
            )
            canvas_ops.append(CanvasOp(op="draw_diagram", payload={"diagram": "fraction_bar", "totalParts": 4, "shadedParts": 3, "fractionLabel": "\\frac{3}{4}"}))
            action_chips = [
                ActionChip(id="fb1", label="What if we eat 2 parts?", action="try_one"),
                ActionChip(id="fb2", label="Show 1/4 of the bar", action="draw_this"),
                ActionChip(id="fb3", label="Compare 3/4 and 1/2", action="explain_another_way")
            ]
        elif "fraction" in cleaned or "half" in cleaned or "1/2" in cleaned:
            spoken_text = (
                "Look at the <anchor id=\"a1\" target=\"visual_model\">circle on your board</anchor>! When we slice it straight down the middle into two equal parts, each part represents one half. "
                "When we combine <anchor id=\"a2\" target=\"equation\">one half plus one half together, they join to create one complete whole circle</anchor>. "
                "Both pieces must be completely identical in size to be true mathematical halves. What would happen if we cut each half again into quarters?"
            )
            canvas_ops.append(CanvasOp(op="draw_diagram", payload={"diagram": "fraction_circle", "radius": 85, "totalParts": 2, "shadedParts": 1, "fractionLabel": "\\frac{1}{2} + \\frac{1}{2} = 1"}))
            action_chips = [
                ActionChip(id="c1", label="What is 1/4 + 1/4?", action="try_one"),
                ActionChip(id="c2", label="Shade 3/4 of the circle", action="draw_this"),
                ActionChip(id="c3", label="Explain with chocolate bar", action="explain_another_way")
            ]
        elif any(w in cleaned for w in ["pythagor", "pythagorean", "right triangle", "hypotenuse", "a^2 + b^2", "a squared + b squared"]):
            spoken_text = (
                "The Pythagorean Theorem is one of the coolest discoveries in all of geometry! "
                "In any right-angled triangle, if you build squares on the two shorter legs, <anchor id=\"a1\" target=\"visual_model\">their areas together perfectly match the square on the hypotenuse</anchor>. "
                "That is why <anchor id=\"a2\" target=\"equation\">a squared plus b squared equals c squared</anchor>! "
                "For our special 3-4-5 right triangle on the board: 3 squared is 9, and 4 squared is 16. When you add 9 and 16 together, you get 25, which is exactly 5 squared! "
                "Notice how the corner forms a crisp 90-degree angle, showing that the two legs are completely perpendicular."
            )
            canvas_ops.append(CanvasOp(
                op="draw_scene",
                payload={
                    "type": "scene",
                    "title": "PYTHAGOREAN THEOREM",
                    "elements": [
                        {"kind": "math", "x": 400, "y": 95, "latex": "a^2 + b^2 = c^2"},
                        {
                            "kind": "right_triangle",
                            "cx": 400,
                            "cy": 230,
                            "w": 180,
                            "h": 130,
                            "legALabel": "a = 3",
                            "legBLabel": "b = 4",
                            "hypotenuseLabel": "c = 5",
                            "formulaLabel": "3^2 + 4^2 = 5^2"
                        },
                        {"kind": "math", "x": 400, "y": 355, "latex": "3^2 + 4^2 = 9 + 16 = 25 = 5^2"}
                    ]
                }
            ))
            action_chips = [
                ActionChip(id="pt1", label="Why does a² + b² = c² work?", action="explain_another_way"),
                ActionChip(id="pt2", label="Try a 6-8-10 right triangle", action="try_one"),
                ActionChip(id="pt3", label="What is the hypotenuse?", action="explain_hypotenuse"),
            ]
        elif any(w in cleaned for w in ["shape", "geometry", "rectangle", "square", "perimeter", "area", "corner"]):
            spoken_text = (
                "Look at this rectangle on your board! A rectangle has 4 sides and 4 square corners. "
                "The opposite sides are equal in length. If the width is 4 units and height is 3 units, its area has 12 unit squares inside!"
            )
            canvas_ops.append(CanvasOp(
                op="draw_scene",
                payload={
                    "type": "scene",
                    "title": "RECTANGLE & AREA",
                    "elements": [
                        {"kind": "math", "x": 400, "y": 100, "latex": "\\text{Area} = 4 \\times 3 = 12"},
                        {"kind": "rect", "x": 260, "y": 180, "w": 280, "h": 130, "color": "#38BDF8", "label": "4 by 3 units"},
                        {"kind": "math", "x": 400, "y": 355, "latex": "\\text{Perimeter} = 4 + 3 + 4 + 3 = 14"}
                    ]
                }
            ))
            action_chips = [
                ActionChip(id="sh1", label="How many corners does it have?", action="try_one"),
                ActionChip(id="sh2", label="Show 3 × 4 with an array", action="explain_array"),
                ActionChip(id="sh3", label="What is a square?", action="explain_another_way"),
            ]
        elif any(w in cleaned for w in ["slope", "intercept", "slope-intercept", "mx+b", "mx + b", "y = mx + b", "linear graph"]):
            spoken_text = (
                "In algebra, <anchor id=\"a1\" target=\"equation\">y equals m x plus b</anchor> is the famous slope-intercept form that defines every straight line! "
                "The letter <anchor id=\"a2\" target=\"visual_model\">m is the slope</anchor>, which measures how steep our line climbs by comparing the vertical rise over the horizontal run. "
                "And <anchor id=\"a3\" target=\"visual_model\">b is the y-intercept</anchor>, which is the exact starting spot where our line crosses the vertical y-axis. "
                "If the slope is positive, our line climbs uphill from left to right like walking up a gentle ramp! "
                "Together, m and b give us a complete recipe to draw any linear line on our coordinate grid."
            )
            canvas_ops.append(CanvasOp(
                op="draw_scene",
                payload={
                    "type": "scene",
                    "title": "SLOPE-INTERCEPT FORM",
                    "elements": [
                        {"kind": "math", "x": 400, "y": 95, "latex": "y = mx + b"},
                        {
                            "kind": "diagram",
                            "diagram": "slope_intercept",
                            "cx": 400,
                            "cy": 230,
                            "slope": 0.65,
                            "intercept": 28,
                            "slopeLabel": "m = \\frac{\\text{rise}}{\\text{run}}",
                            "interceptLabel": "b = \\text{y-intercept}",
                            "formulaLabel": "y = mx + b"
                        },
                        {"kind": "math", "x": 400, "y": 355, "latex": "m = \\text{slope} \\quad \\text{and} \\quad b = \\text{y-intercept}"}
                    ]
                }
            ))
            action_chips = [
                ActionChip(id="sl1", label="What if the slope m is zero?", action="explain_another_way"),
                ActionChip(id="sl2", label="Show line with y-intercept at 3", action="draw_this"),
                ActionChip(id="sl3", label="What is a negative slope?", action="try_one"),
            ]
        elif any(w in cleaned for w in ["physics", "gravity", "relativity", "quantum", "faraday", "circuit", "e=mc", "black hole", "thermodynamics"]):
            spoken_text = (
                "The Theory of Relativity is a fascinating topic from advanced university physics! "
                "As an elementary school tutor, my whiteboard is dedicated to foundational math—like multiplication, fractions, shapes, decimals, and coordinate lines. "
                "Which topic would you like to explore together?"
            )
            canvas_ops = []  # Strictly NO canvas operations for university-level queries
            action_chips = [
                ActionChip(id="al1", label="Teach decimal addition", action="explain_decimals"),
                ActionChip(id="al2", label="Show 3 × 4 with an array", action="explain_array"),
                ActionChip(id="al3", label="Explore slope-intercept form", action="explain_another_way"),
            ]
        else:
            topic = user_text.strip().title()
            spoken_text = (
                f"Let's explore {topic} together using our elementary math building blocks! "
                "Look at the board as we discover the key idea step by step."
            )
            canvas_ops.append(CanvasOp(
                op="draw_scene",
                payload={
                    "type": "scene",
                    "title": topic.upper()[:24],
                    "elements": [
                        {"kind": "math", "x": 400, "y": 100, "latex": f"\\text{{{topic}}}"},
                        {"kind": "rect", "x": 280, "y": 180, "w": 240, "h": 120, "color": "#38BDF8", "label": topic[:16]},
                        {"kind": "math", "x": 400, "y": 345, "latex": "1 + 1 = 2"}
                    ]
                }
            ))
            action_chips = [
                ActionChip(id="g1", label="What is 3/4 with a chocolate bar?", action="explain_fractions"),
                ActionChip(id="g2", label="Show 3 × 4 with an array", action="explain_array"),
                ActionChip(id="g3", label="Add 8 + 5 on a ten-frame", action="explain_ten_frame")
            ]

        if prefix:
            spoken_text = prefix + spoken_text

        # Stream spoken words with minimal latency
        accumulated = ""
        for word in spoken_text.split(" "):
            chunk = word + " "
            accumulated += chunk
            yield {"event": "token", "data": {"token": chunk, "accumulated": accumulated}}
            await asyncio.sleep(0.015)

        for op in canvas_ops:
            store.apply_canvas_op(session_id, op)
            yield {"event": "canvas_op", "data": op.model_dump()}
            await asyncio.sleep(0.02)

        yield {"event": "action_chips", "data": [chip.model_dump() for chip in action_chips]}

        final_message = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=spoken_text,
            parts=parts,
            action_chips=action_chips
        )
        store.add_message(final_message)

        yield {"event": "complete", "data": final_message.model_dump()}


orchestrator = TutorOrchestrator()
