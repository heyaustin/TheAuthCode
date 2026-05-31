#!/usr/bin/env python3
# =====================================================================
# TheAuthCode -- backend.py
# ---------------------------------------------------------------------
# A self-contained, single-file Django application that stores the
# three per-professor leaderboards and returns the *already-sorted*
# data straight to the frontend.
#
# There is no login: players choose, from the verdict popup, whether to
# submit { persona, nickname, letter, score, granted, code }.
#
# Run it:
#     pip install "django>=4.2"
#     python backend.py runserver 0.0.0.0:8000   # start the API (table auto-creates)
#
# Quick self-check (no server needed):
#     python backend.py selftest
#
# It can ALSO serve the static frontend (index.html / style.css / app.js
# and the static/favicon/ folder) from this same directory, so you can open
# http://localhost:8000 and have the API on the same origin -- no CORS
# headaches. Cross-origin dev servers (e.g. VS Code Live Server) work too,
# because permissive CORS headers are added by the middleware below.
# =====================================================================

from django.core.wsgi import get_wsgi_application
import os
import re
import sys
import json
import mimetypes

import django
from django.conf import settings

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Personas understood by the API. The frontend uses the same three keys.
VALID_PERSONAS = {"strict", "easygoing", "lottery"}

# ---------------------------------------------------------------------
# 1. Configure Django entirely in-process (no settings.py / project dir).
# ---------------------------------------------------------------------
if not settings.configured:
    settings.configure(
        DEBUG=True,
        # Dev-only key. Replace before any real deployment.
        SECRET_KEY="theauthcode-dev-key-not-for-production",
        ALLOWED_HOSTS=["*"],
        ROOT_URLCONF=__name__,
        MIDDLEWARE=[
            __name__ + ".CorsMiddleware",
            "django.middleware.common.CommonMiddleware",
        ],
        # Registering THIS module as an app lets us define a model here.
        INSTALLED_APPS=[__name__],
        DATABASES={
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": os.path.join(BASE_DIR, "leaderboard.sqlite3"),
            }
        },
        DEFAULT_AUTO_FIELD="django.db.models.BigAutoField",
        USE_TZ=True,
    )
    django.setup()

from django.db import models                                         # noqa: E402
from django.http import JsonResponse, HttpResponse, Http404, HttpResponseNotAllowed  # noqa: E402
from django.urls import path                                         # noqa: E402
from django.views.decorators.csrf import csrf_exempt  # noqa: E402
from django.core.management import execute_from_command_line  # noqa: E402


# ---------------------------------------------------------------------
# 2. The single data model.
# ---------------------------------------------------------------------
class LeaderboardEntry(models.Model):
    persona = models.CharField(
        max_length=16,
        choices=[(p, p) for p in sorted(VALID_PERSONAS)],
        db_index=True,
    )
    nickname = models.CharField(max_length=24)
    letter = models.TextField(blank=True, default="")     # may be empty if the player opted out
    score = models.IntegerField(default=0, db_index=True)  # 0..100
    granted = models.BooleanField(default=False)
    code = models.CharField(max_length=32, blank=True, default="")  # auth-code id if granted
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = __name__
        # Highest score first; earlier submission breaks ties.
        ordering = ["-score", "created_at"]

    def as_dict(self, rank=None):
        return {
            "rank": rank,
            "nickname": self.nickname,
            "score": self.score,
            "granted": self.granted,
            "code": self.code if self.granted else "",
            "letter": self.letter,
            "created_at": self.created_at.isoformat(),
        }


# ---------------------------------------------------------------------
# 3. Permissive CORS + preflight handling (dev convenience).
# ---------------------------------------------------------------------
class CorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type"
        response["Access-Control-Max-Age"] = "86400"
        return response


# ---------------------------------------------------------------------
# 4. Helpers
# ---------------------------------------------------------------------
def _clean_text(value, max_len):
    """Coerce to str, strip control chars, collapse, and hard-truncate."""
    if value is None:
        return ""
    text = str(value)
    text = text.replace("\x00", "")
    # Strip other C0 control chars except tab/newline/carriage-return.
    text = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text.strip()[:max_len]


def _serialize_board(persona):
    qs = LeaderboardEntry.objects.filter(persona=persona)  # Meta.ordering already sorts by -score
    return [e.as_dict(rank=i + 1) for i, e in enumerate(qs)]


def _ensure_schema():
    """Create the leaderboard table on first use (no migration files needed)."""
    from django.db import connection
    table = LeaderboardEntry._meta.db_table
    if table not in connection.introspection.table_names():
        with connection.schema_editor() as schema_editor:
            schema_editor.create_model(LeaderboardEntry)


# ---------------------------------------------------------------------
# 5. Views
# ---------------------------------------------------------------------
def leaderboard_view(request, persona):
    """GET /api/leaderboard/<persona>/  ->  already-sorted leaderboard."""
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    persona = persona.lower()
    if persona not in VALID_PERSONAS:
        return JsonResponse({"ok": False, "error": "unknown persona"}, status=404)
    return JsonResponse(
        {"ok": True, "persona": persona, "entries": _serialize_board(persona)}
    )


@csrf_exempt
def submit_view(request):
    """POST /api/submit/  body: {persona, nickname, letter, score, granted, code}."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "invalid JSON"}, status=400)

    persona = str(payload.get("persona", "")).lower()
    if persona not in VALID_PERSONAS:
        return JsonResponse({"ok": False, "error": "unknown persona"}, status=400)

    nickname = _clean_text(payload.get("nickname"), 24) or "Anonymous"

    # The player may opt out of sharing the letter text.
    letter = _clean_text(payload.get("letter"), 4000)

    try:
        score = int(payload.get("score"))
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "score must be an integer"}, status=400)
    score = max(0, min(100, score))

    granted = bool(payload.get("granted", False))
    code = _clean_text(payload.get("code"), 32) if granted else ""

    entry = LeaderboardEntry.objects.create(
        persona=persona,
        nickname=nickname,
        letter=letter,
        score=score,
        granted=granted,
        code=code,
    )

    # Work out where this entry landed so the UI can say "you're #N".
    rank = (
        LeaderboardEntry.objects.filter(persona=persona)
        .filter(models.Q(score__gt=score) | models.Q(score=score, created_at__lt=entry.created_at))
        .count()
        + 1
    )

    return JsonResponse({"ok": True, "id": entry.id, "rank": rank})


# ---- optional static-file serving so the whole thing runs from Django ----
_STATIC_IN_ROOT = {"index.html"}
_STATIC_IN_STATIC = {"app.js", "style.css"}


def _serve_file(rel_path):
    rel_path = rel_path.lstrip("/")
    full = os.path.normpath(os.path.join(BASE_DIR, rel_path))
    # Path-traversal guard: the resolved path must stay inside BASE_DIR.
    if not full.startswith(BASE_DIR) or not os.path.isfile(full):
        raise Http404("not found")
    ctype, _ = mimetypes.guess_type(full)
    with open(full, "rb") as fh:
        return HttpResponse(fh.read(), content_type=ctype or "application/octet-stream")


def index_view(request):
    if os.path.isfile(os.path.join(BASE_DIR, "index.html")):
        return _serve_file("index.html")
    return JsonResponse(
        {
            "ok": True,
            "service": "TheAuthCode leaderboard API",
            "endpoints": {
                "GET": "/api/leaderboard/<strict|easygoing|lottery>/",
                "POST": "/api/submit/",
            },
        }
    )


def static_view(request, asset):
    # Extract just the filename to support URLs like `/app.js` OR `/static/app.js`
    filename = os.path.basename(asset)

    if filename in _STATIC_IN_STATIC:
        return _serve_file(os.path.join("static", filename))
    elif filename in _STATIC_IN_ROOT:
        return _serve_file(filename)
    elif filename == "favicon.ico":
        # Handle the default browser request for /favicon.ico at the root
        return _serve_file(os.path.join("static", "favicon", filename))

    raise Http404("not found")


def favicon_view(request, sub):
    # Route /favicon/... explicitly to static/favicon/...
    return _serve_file(os.path.join("static", "favicon", sub))


urlpatterns = [
    path("", index_view),
    path("api/leaderboard/<str:persona>/", leaderboard_view),
    path("api/submit/", submit_view),
    path("favicon/<path:sub>", favicon_view),
    path("static/<path:asset>", static_view),  # e.g., <script src="static/app.js">
    path("<str:asset>", static_view),          # Legacy fallback for /index.html or /app.js
]


# ---------------------------------------------------------------------
# 6. Entry point (+ a no-server self-test).
# ---------------------------------------------------------------------
def _selftest():
    """Exercise the views end-to-end via Django's test client."""
    _ensure_schema()
    from django.test import Client

    LeaderboardEntry.objects.all().delete()
    c = Client()

    samples = [
        ("strict", "Ada", 91, True, "ABCD-2345"),
        ("strict", "Bao", 64, False, ""),
        ("strict", "Cleo", 88, True, "WXYZ-7788"),
        ("easygoing", "Dev", 47, True, "EAS1-0001"),
        ("lottery", "Eve", 12, False, ""),
        ("lottery", "Fei", 73, True, "LOT0-9999"),
    ]
    for persona, nick, score, granted, code in samples:
        r = c.post(
            "/api/submit/",
            data=json.dumps(
                {
                    "persona": persona,
                    "nickname": nick,
                    "letter": f"Dear professor, this is {nick}'s sincere request. 敬上",
                    "score": score,
                    "granted": granted,
                    "code": code,
                }
            ),
            content_type="application/json",
        )
        assert r.status_code == 200 and r.json()["ok"], (nick, r.status_code, r.content)

    # Strict board must come back sorted high->low.
    board = c.get("/api/leaderboard/strict/").json()["entries"]
    scores = [e["score"] for e in board]
    assert scores == sorted(scores, reverse=True), scores
    assert scores == [91, 88, 64], scores
    assert board[0]["rank"] == 1 and board[0]["nickname"] == "Ada"
    # Denied entries must not leak a code.
    assert board[2]["code"] == ""

    # Persona isolation: lottery board only has lottery entries.
    lottery = c.get("/api/leaderboard/lottery/").json()["entries"]
    assert [e["nickname"] for e in lottery] == ["Fei", "Eve"], lottery

    # Validation: bad persona / bad score are rejected.
    assert c.post("/api/submit/", data=json.dumps({"persona": "nope", "score": 5}),
                  content_type="application/json").status_code == 400
    assert c.post("/api/submit/", data=json.dumps({"persona": "strict", "score": "x"}),
                  content_type="application/json").status_code == 400
    assert c.get("/api/leaderboard/nope/").status_code == 404

    # Score clamping.
    c.post("/api/submit/", data=json.dumps(
        {"persona": "easygoing", "nickname": "Over", "score": 250, "granted": True, "code": "Z"}),
        content_type="application/json")
    eg = c.get("/api/leaderboard/easygoing/").json()["entries"]
    assert eg[0]["score"] == 100, eg

    print("selftest OK  (sorting, isolation, validation, clamping all pass)")


try:
    _ensure_schema()
except Exception as exc:
    sys.stderr.write(f"[backend] schema check skipped: {exc}\n")

application = get_wsgi_application()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        _selftest()
    else:
        # Make sure the table exists before serving (or running any command).
        # try:
        #     _ensure_schema()
        # except Exception as exc:  # pragma: no cover - surface but don't crash dispatch
        #     sys.stderr.write(f"[backend] schema check skipped: {exc}\n")
        execute_from_command_line(sys.argv)
