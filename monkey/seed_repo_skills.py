"""Push curated repo skills into skills_store as [SKILL ...] cards.

Run: `python -m monkey.seed_repo_skills` — idempotent (re-saves bumps version).

Each entry in monkey/repo_skills.REPO_SKILLS becomes a learned skill so it can
be selected by `select_skills(user_message)` and injected into the system
prompt automatically when relevant.
"""
from __future__ import annotations
from monkey import repo_skills, skills_store


def main() -> None:
    seeded: list[str] = []
    skipped: list[str] = []
    for r in repo_skills.REPO_SKILLS:
        slug = f"repo-{r['name']}"
        existing = skills_store.get_learned(slug)
        desc = "[REPO] " + r["when_to_use"]
        if existing and existing.get("description") == desc:
            skipped.append(slug)
            continue
        skills_store.save_learned(
            name=slug,
            description=desc,
            triggers=r.get("triggers", []) + [r["name"], r["category"]],
            content=repo_skills.render_card(r),
            sources=[f"https://github.com/{r['repo']}"]
            if "/" in r["repo"] and " " not in r["repo"] else [],
        )
        seeded.append(slug)
    print(f"Seeded: {seeded}")
    print(f"Skipped: {skipped}")


if __name__ == "__main__":
    main()
