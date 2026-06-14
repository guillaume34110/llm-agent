"""Deterministic ASCII schematic renderer.

Input: a node/edge graph spec. Output: clean monospace ASCII using box-drawing
chars. The agent (LLM) describes the topology; the layout/geometry is done
here, so the result always passes structural lint by construction.

Generic — works for circuits, P&ID, network topology, plumbing, signal flow,
block diagrams, any 2-rail or column-stack schematic.
"""

import json
import re


def _safe_label(s) -> str:
    return re.sub(r"\s+", " ", str(s).strip()) or "?"


def _validate(spec):
    if not isinstance(spec, dict):
        return None, "spec must be a JSON object"
    nodes_in = spec.get("nodes")
    if not isinstance(nodes_in, list) or not nodes_in:
        return None, "nodes[] is required and must be non-empty"
    nodes = {}
    order = []
    for n in nodes_in:
        if not isinstance(n, dict):
            return None, "each node must be an object {id, label}"
        nid = str(n.get("id") or "").strip()
        if not nid:
            return None, "node missing 'id'"
        if nid in nodes:
            continue
        nodes[nid] = _safe_label(n.get("label") or nid)
        order.append(nid)
    edges = []
    for e in spec.get("edges") or []:
        if not isinstance(e, dict):
            continue
        a = str(e.get("from") or "").strip()
        b = str(e.get("to") or "").strip()
        if a and b:
            edges.append((a, b))
    top_rail = None
    bot_rail = None
    for r in spec.get("rails") or []:
        if not isinstance(r, dict):
            continue
        name = str(r.get("name") or "").strip()
        side = str(r.get("side") or "").strip().lower()
        if not name:
            continue
        if side == "top" and top_rail is None:
            top_rail = name
        elif side in ("bot", "bottom") and bot_rail is None:
            bot_rail = name
    rail_ids = {x for x in (top_rail, bot_rail) if x}
    groups_in = spec.get("groups")
    if isinstance(groups_in, list) and groups_in:
        seen = set()
        groups = []
        for g in groups_in:
            if not isinstance(g, list):
                continue
            col = []
            for nid in g:
                if isinstance(nid, str) and nid in nodes and nid not in seen:
                    col.append(nid)
                    seen.add(nid)
            if col:
                groups.append(col)
        for nid in order:
            if nid not in seen:
                groups.append([nid])
    else:
        groups = [[nid] for nid in order]
    title = str(spec.get("title") or "").strip() or None
    return {
        "title": title,
        "nodes": nodes,
        "edges": edges,
        "top_rail": top_rail,
        "bot_rail": bot_rail,
        "rail_ids": rail_ids,
        "groups": groups,
    }, None


def _render(model) -> str:
    nodes = model["nodes"]
    edges = model["edges"]
    top_rail = model["top_rail"]
    bot_rail = model["bot_rail"]
    rail_ids = model["rail_ids"]
    groups = model["groups"]

    n_cols = len(groups)
    max_slots = max(len(g) for g in groups)

    # Column widths from box labels (uniform per column → predictable bridge endpoints).
    col_widths = []
    for col in groups:
        w = max(len(f"[ {nodes[nid]} ]") for nid in col)
        col_widths.append(max(w, 6))

    GUTTER = 4
    centers = []
    cursor = GUTTER
    for w in col_widths:
        centers.append(cursor + w // 2)
        cursor += w + GUTTER
    total_w = cursor

    slot_block = 4  # vert, box, vert, separator
    first_slot_top = 1 if top_rail else 0
    last_slot_bottom = first_slot_top + max_slots * slot_block - 2
    rail_bot_row = (last_slot_bottom + 1) if bot_rail else None
    total_rows = (rail_bot_row + 1) if bot_rail else (last_slot_bottom + 1)

    grid = [[" "] * total_w for _ in range(total_rows)]

    def put(r, c, ch):
        if 0 <= r < total_rows and 0 <= c < total_w:
            grid[r][c] = ch

    def put_str(r, c, s):
        for i, ch in enumerate(s):
            put(r, c + i, ch)

    # Rails
    if top_rail:
        prefix = f"{top_rail} "
        put_str(0, 0, prefix)
        wire_start = max(len(prefix), 0)
        wire_end = centers[-1] + 3
        for c in range(wire_start, wire_end + 1):
            put(0, c, "─")
        for ci, cx in enumerate(centers):
            # only place ┬ if this column will reach the rail (always true: every column connects)
            put(0, cx, "┬")
    if bot_rail:
        prefix = f"{bot_rail} "
        put_str(rail_bot_row, 0, prefix)
        wire_start = max(len(prefix), 0)
        wire_end = centers[-1] + 3
        for c in range(wire_start, wire_end + 1):
            put(rail_bot_row, c, "─")
        for ci, cx in enumerate(centers):
            put(rail_bot_row, cx, "┴")

    # Column verticals + boxes. The vertical wire only spans rows where it has a purpose:
    # - up to top rail if rail exists, else starts at this column's first box;
    # - down to bottom rail if rail exists, else ends at this column's last box.
    for ci, col in enumerate(groups):
        cx = centers[ci]
        first_box_row = first_slot_top + 1
        last_box_row = first_slot_top + (len(col) - 1) * slot_block + 1
        v_top = 1 if top_rail else first_box_row
        v_bot = (rail_bot_row - 1) if bot_rail else last_box_row
        for r in range(v_top, v_bot + 1):
            put(r, cx, "│")
        for k, nid in enumerate(col):
            box_row = first_slot_top + k * slot_block + 1
            label = nodes[nid]
            text = f"[ {label} ]"
            left = cx - len(text) // 2
            put_str(box_row, left, text)

    # Locate nodes
    where = {}
    for ci, col in enumerate(groups):
        for k, nid in enumerate(col):
            where[nid] = (ci, k)

    def bridge_row(slot_idx):
        # Separator row below `slot_idx` is at slot_idx*slot_block + 3 (rel to first_slot_top).
        # For the last slot, fall back to separator above; for the lone slot, use its bot vert.
        if max_slots == 1:
            return first_slot_top + 2  # bot vert of the only slot
        if slot_idx < max_slots - 1:
            return first_slot_top + slot_idx * slot_block + 3
        return first_slot_top + (slot_idx - 1) * slot_block + 3

    # Horizontal jumper edges (only inter-column, non-rail)
    for a, b in edges:
        if a in rail_ids or b in rail_ids:
            continue
        if a not in where or b not in where:
            continue
        ca, ka = where[a]
        cb_, kb = where[b]
        if ca == cb_:
            continue
        row = bridge_row(min(ka, kb))
        x_left = min(centers[ca], centers[cb_])
        x_right = max(centers[ca], centers[cb_])
        for c in range(x_left, x_right + 1):
            cur = grid[row][c]
            if c == x_left:
                if cur == "│":
                    put(row, c, "├")
                elif cur in "─├┤┬┴┼":
                    pass
                else:
                    put(row, c, "├")
            elif c == x_right:
                if cur == "│":
                    put(row, c, "┤")
                elif cur in "─├┤┬┴┼":
                    pass
                else:
                    put(row, c, "┤")
            else:
                if cur == "│":
                    put(row, c, "┼")
                elif cur == " ":
                    put(row, c, "─")

    lines = ["".join(row).rstrip() for row in grid]
    text = "\n".join(lines).rstrip("\n")
    return text


def render_ascii_schematic(spec) -> str:
    """Render a clean ASCII schematic from a graph spec. Returns the ASCII text
    (NOT wrapped in a rich block). On invalid input, returns an `ERREUR: …` string."""
    if isinstance(spec, str):
        try:
            spec = json.loads(spec)
        except Exception as e:
            return f"ERREUR: invalid schematic spec — JSON parse error: {e}"
    model, err = _validate(spec)
    if err:
        return f"ERREUR: invalid schematic spec — {err}"
    try:
        return _render(model)
    except Exception as e:
        return f"ERREUR: render failed: {e}"


if __name__ == "__main__":
    sample = {
        "title": "LM386 audio amp",
        "rails": [
            {"name": "VCC", "side": "top"},
            {"name": "GND", "side": "bottom"},
        ],
        "groups": [
            ["R1", "R2", "C3"],
            ["C1", "U1", "C2", "SPKR"],
        ],
        "nodes": [
            {"id": "R1", "label": "R1 10kΩ"},
            {"id": "R2", "label": "R2 10kΩ"},
            {"id": "C3", "label": "C3 220µF"},
            {"id": "C1", "label": "C1 10µF"},
            {"id": "U1", "label": "U1 LM386"},
            {"id": "C2", "label": "C2 22µF"},
            {"id": "SPKR", "label": "SPKR 8Ω"},
        ],
        "edges": [
            {"from": "R2", "to": "U1"},
        ],
    }
    print(render_ascii_schematic(sample))
