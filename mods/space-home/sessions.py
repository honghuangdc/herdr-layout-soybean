#!/usr/bin/env python3
"""Recent agent conversations for one folder: pi, codex, claude. Prints JSON."""
import json, os, sys, time

cwd = (sys.argv[1] if len(sys.argv) > 1 else "").rstrip("/")
home = os.path.expanduser("~")
limit, days = 30, 30
now = time.time()


def text_of(obj):
    msg = obj.get("message") or obj.get("payload") or obj
    if not isinstance(msg, dict):
        return None
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            c.get("text")
            for c in content
            if isinstance(c, dict) and c.get("type") in ("text", "input_text") and c.get("text")
        ]
        return "\n".join(parts) or None
    return None


def title(path, flavor):
    """First real user prompt of a session file."""
    try:
        with open(path, errors="ignore") as f:
            for i, line in enumerate(f):
                if i > 500:
                    break
                if '"user"' not in line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                kind = obj.get("type")
                msg = obj.get("message") or obj.get("payload") or {}
                role = msg.get("role") if isinstance(msg, dict) else None
                if not (kind == "user" or role == "user"):
                    continue
                body = text_of(obj)
                if not body:
                    continue
                body = " ".join(body.split())
                if not body or body.startswith(("<", "[", "# AGENTS")) or len(body) < 2:
                    continue
                return body[:110]
    except Exception:
        return None
    return None


def collect(dirp, flavor, agent):
    out = []
    if not dirp or not os.path.isdir(dirp):
        return out
    for name in os.listdir(dirp):
        if not name.endswith((".jsonl", ".json")):
            continue
        path = os.path.join(dirp, name)
        try:
            st = os.stat(path)
        except Exception:
            continue
        if now - st.st_mtime > days * 86400 or st.st_size < 200:
            continue
        ident = name.rsplit("_", 1)[-1] if agent == "pi" else name
        out.append({"agent": agent, "ms": int(st.st_mtime * 1000), "file": path, "id": ident[:-6] if ident.endswith(".jsonl") else ident})
    out.sort(key=lambda x: -x["ms"])
    for item in out[:12]:
        item["title"] = title(item["file"], flavor)
    return [x for x in out if x.get("title")][:10]


def variants(prefix):
    """pi and claude both flatten a path; they disagree on '.' — try both."""
    plain = cwd.lstrip("/").replace("/", "-")
    dotted = plain.replace(".", "-")
    return list({prefix + plain, prefix + dotted})


found = []
for d in variants("--") :
    found += collect(os.path.join(home, ".pi/agent/sessions", d + "--"), "pi", "pi")
for d in variants("-"):
    found += collect(os.path.join(home, ".claude/projects", d), "claude", "claude")

# codex keeps one tree per day; the folder is inside each rollout's first line.
root = os.path.join(home, ".codex/sessions")
recent = []
if os.path.isdir(root):
    for dirpath, _, names in os.walk(root):
        for name in names:
            if not (name.startswith("rollout-") and name.endswith(".jsonl")):
                continue
            path = os.path.join(dirpath, name)
            try:
                st = os.stat(path)
            except Exception:
                continue
            if now - st.st_mtime <= days * 86400:
                recent.append({"path": path, "ms": int(st.st_mtime * 1000)})
    recent.sort(key=lambda x: -x["ms"])
    for item in recent[:40]:
        try:
            with open(item["path"], errors="ignore") as f:
                head = f.read(4096)
        except Exception:
            continue
        if f'"cwd":"{cwd}"' not in head and f'"cwd": "{cwd}"' not in head:
            continue
        meta = head.split("\n", 1)[0]
        ident = ""
        try:
            ident = json.loads(meta).get("payload", {}).get("session_id") or ""
        except Exception:
            ident = os.path.basename(item["path"])[-42:-6]
        found.append({"agent": "codex", "ms": item["ms"], "file": item["path"], "id": ident})
        if len(found) > limit * 3:
            break
for item in found:
    if item["agent"] == "codex" and not item.get("title"):
        item["title"] = title(item["file"], "codex")

found = [x for x in found if x.get("title")]
found.sort(key=lambda x: -x["ms"])
for item in found:
    item.pop("file", None)
print(json.dumps(found[:limit]))
