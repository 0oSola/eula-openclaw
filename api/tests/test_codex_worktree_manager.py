import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

from app.services.codex_worktree_manager import CodexWorktreeError, CodexWorktreeManager


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.rstrip("\n")


def _make_repo(case_dir: Path) -> Path:
    repo = case_dir / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "codex@example.test")
    _git(repo, "config", "user.name", "Codex Test")
    (repo / "README.md").write_text("hello\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "initial")
    return repo


def test_create_worktree_uses_safe_branch_and_root():
    case_dir = _case_dir()
    repo = _make_repo(case_dir)
    manager = CodexWorktreeManager(worktree_root=case_dir / "worktrees", branch_prefix="codex/")

    created = manager.create_worktree(repo, "codex_sess_1")

    assert created.worktree_path == (case_dir / "worktrees" / "codex_sess_1").resolve()
    assert created.branch_name == "codex/codex_sess_1"
    assert (created.worktree_path / "README.md").read_text(encoding="utf-8") == "hello\n"
    assert _git(created.worktree_path, "branch", "--show-current") == "codex/codex_sess_1"


def test_create_worktree_rejects_path_traversal_session_id():
    case_dir = _case_dir()
    repo = _make_repo(case_dir)
    manager = CodexWorktreeManager(worktree_root=case_dir / "worktrees")

    with pytest.raises(CodexWorktreeError, match="Invalid Codex session id"):
        manager.create_worktree(repo, "..\\escape")


def test_diff_includes_tracked_and_untracked_changes():
    case_dir = _case_dir()
    repo = _make_repo(case_dir)
    manager = CodexWorktreeManager(worktree_root=case_dir / "worktrees")
    created = manager.create_worktree(repo, "codex_sess_diff")
    (created.worktree_path / "README.md").write_text("hello\ncodex\n", encoding="utf-8")
    (created.worktree_path / "new_file.txt").write_text("new content\n", encoding="utf-8")

    diff = manager.diff(created.worktree_path)

    assert diff.changed_files == ["README.md", "new_file.txt"]
    assert "README.md" in diff.stat
    assert "new_file.txt" in diff.stat
    assert "diff --git a/README.md b/README.md" in diff.patch
    assert "diff --git a/new_file.txt b/new_file.txt" in diff.patch
    assert _git(created.worktree_path, "status", "--porcelain").splitlines() == [
        " M README.md",
        "?? new_file.txt",
    ]


def test_apply_blocks_when_main_workspace_is_dirty():
    case_dir = _case_dir()
    repo = _make_repo(case_dir)
    manager = CodexWorktreeManager(worktree_root=case_dir / "worktrees")
    created = manager.create_worktree(repo, "codex_sess_apply_dirty")
    (created.worktree_path / "README.md").write_text("hello\nfrom worktree\n", encoding="utf-8")
    (repo / "dirty.txt").write_text("dirty\n", encoding="utf-8")

    with pytest.raises(CodexWorktreeError, match="main workspace has uncommitted changes"):
        manager.apply_patch_to_workspace(created.worktree_path, repo, confirm=True)


def test_apply_requires_confirmation_and_applies_after_check():
    case_dir = _case_dir()
    repo = _make_repo(case_dir)
    manager = CodexWorktreeManager(worktree_root=case_dir / "worktrees")
    created = manager.create_worktree(repo, "codex_sess_apply")
    (created.worktree_path / "README.md").write_text("hello\napplied\n", encoding="utf-8")

    with pytest.raises(CodexWorktreeError, match="explicit confirmation"):
        manager.apply_patch_to_workspace(created.worktree_path, repo, confirm=False)

    result = manager.apply_patch_to_workspace(created.worktree_path, repo, confirm=True)

    assert result.applied is True
    assert result.changed_files == ["README.md"]
    assert (repo / "README.md").read_text(encoding="utf-8") == "hello\napplied\n"
