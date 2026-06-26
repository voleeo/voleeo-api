use super::*;
use git2::{AnnotatedCommit, Repository};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use voleeo_core::{GitChange, GitNodeKind};

fn setup() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    init(&path).unwrap();
    let repo = Repository::open(&path).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "Tester").unwrap();
    cfg.set_str("user.email", "t@e.st").unwrap();
    (dir, path)
}

fn write(path: &Path, name: &str, body: &str) {
    fs::write(path.join(name), body).unwrap();
}

#[test]
fn classify_maps_filenames_to_nodes() {
    assert_eq!(
        classify_path("req_ABC.yaml"),
        (GitNodeKind::Request, Some("ABC".into()))
    );
    assert_eq!(
        classify_path("folder_XY.yaml"),
        (GitNodeKind::Folder, Some("XY".into()))
    );
    assert_eq!(
        classify_path("workspace.yaml"),
        (GitNodeKind::Workspace, None)
    );
    assert_eq!(classify_path("jar_1.yaml").0, GitNodeKind::Jar);
    assert_eq!(classify_path("env_1.yaml").0, GitNodeKind::Env);
    assert_eq!(classify_path(".gitignore"), (GitNodeKind::Other, None));
}

#[test]
fn untracked_then_staged_then_committed() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\nname: A\n");

    let st = status(&path).unwrap();
    let f = st.files.iter().find(|f| f.path == "req_a.yaml").unwrap();
    assert_eq!(f.change, GitChange::Untracked);
    assert_eq!(f.node_kind, GitNodeKind::Request);
    assert_eq!(f.node_id.as_deref(), Some("a"));

    stage(&path, &["req_a.yaml".into()]).unwrap();
    let st = status(&path).unwrap();
    let f = st.files.iter().find(|f| f.staged).unwrap();
    assert_eq!(f.change, GitChange::Added);

    commit(&path, "add a", None).unwrap();
    assert!(status(&path).unwrap().files.is_empty());

    assert_eq!(log(&path, 10).unwrap().len(), 1);
    assert_eq!(log_for_path(&path, "req_a.yaml", 10).unwrap().len(), 1);
}

#[test]
fn changed_blobs_report_head_and_work() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\nname: A\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "add a", None).unwrap();

    // Modify an existing file and add a brand-new one.
    write(&path, "req_a.yaml", "id: a\nname: B\n");
    write(&path, "req_b.yaml", "id: b\nname: New\n");

    let blobs = changed_blobs(&path).unwrap();

    let a = blobs.iter().find(|b| b.path == "req_a.yaml").unwrap();
    assert_eq!(a.change, GitChange::Modified);
    assert!(a.head.as_deref().unwrap().contains("name: A"));
    assert!(a.work.as_deref().unwrap().contains("name: B"));

    let b = blobs.iter().find(|b| b.path == "req_b.yaml").unwrap();
    assert_eq!(b.change, GitChange::Added);
    assert!(b.head.is_none());
    assert!(b.work.as_deref().unwrap().contains("name: New"));
}

#[test]
fn unstage_and_discard_roundtrip() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    unstage(&path, &["req_a.yaml".into()]).unwrap();
    assert!(status(&path).unwrap().files.iter().all(|f| !f.staged));

    // Discard of an untracked file removes it.
    discard(&path, &["req_a.yaml".into()]).unwrap();
    assert!(!path.join("req_a.yaml").exists());
}

#[test]
fn repo_info_reports_repo_and_branch() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "init", None).unwrap();

    let info = repo_info(&path).unwrap();
    assert!(info.is_repo);
    assert!(info.has_author);
    assert!(info.branch.is_some());
    assert!(!info.has_remote);
}

#[test]
fn not_a_repo_when_uninitialized() {
    let dir = tempfile::tempdir().unwrap();
    let info = repo_info(dir.path()).unwrap();
    assert!(!info.is_repo);
}

#[test]
fn merge_conflict_roundtrip() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "line1\nMIDDLE\nline3\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "base", None).unwrap();

    let repo = Repository::open(&path).unwrap();
    let base = repo.head().unwrap().peel_to_commit().unwrap();
    let main_branch = repo.head().unwrap().shorthand().unwrap().to_string();

    // Diverge on a feature branch.
    repo.branch("feature", &base, false).unwrap();

    // Commit on main.
    write(&path, "req_a.yaml", "line1\nFROM_MAIN\nline3\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "main edit", None).unwrap();
    let main_oid = repo.head().unwrap().target().unwrap();

    // Switch to feature and make a conflicting edit.
    repo.set_head("refs/heads/feature").unwrap();
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    write(&path, "req_a.yaml", "line1\nFROM_FEATURE\nline3\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "feature edit", None).unwrap();

    // Merge main into feature → conflict.
    let main_commit = repo.find_commit(main_oid).unwrap();
    let annotated: AnnotatedCommit = repo.find_annotated_commit(main_commit.id()).unwrap();
    repo.merge(&[&annotated], None, None).unwrap();
    assert!(repo.index().unwrap().has_conflicts());

    let conflicts = conflict_blobs(&path).unwrap();
    assert_eq!(conflicts.len(), 1);
    let c = &conflicts[0];
    assert_eq!(c.path, "req_a.yaml");
    assert!(c.ours.as_deref().unwrap().contains("FROM_FEATURE"));
    assert!(c.theirs.as_deref().unwrap().contains("FROM_MAIN"));
    assert!(c.base.as_deref().unwrap().contains("MIDDLE"));

    // Raw ours-vs-theirs patch for the "code diff" view: ours (FROM_FEATURE)
    // removed, theirs (FROM_MAIN) added, context preserved, no file preamble.
    let diff = conflict_diff_text(&path, "req_a.yaml").unwrap();
    assert!(diff.contains("@@"));
    assert!(diff.contains("-FROM_FEATURE"));
    assert!(diff.contains("+FROM_MAIN"));
    assert!(!diff.contains("diff --git"));

    resolve(&path, "req_a.yaml", "line1\nMERGED\nline3\n").unwrap();
    finish_merge(&path, "merge main", None).unwrap();

    // Reopen — the original handle's index is cached from before the resolve.
    let fresh = Repository::open(&path).unwrap();
    assert!(!fresh.index().unwrap().has_conflicts());
    let merged = fs::read_to_string(path.join("req_a.yaml")).unwrap();
    assert!(merged.contains("MERGED"));
    // Merge commit has two parents.
    let tip = fresh.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(tip.parent_count(), 2);
    let _ = main_branch;
}

#[test]
fn heal_merge_worktree_restores_ours_keeps_conflict() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "line1\nMIDDLE\nline3\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "base", None).unwrap();

    let repo = Repository::open(&path).unwrap();
    let base = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature", &base, false).unwrap();

    write(&path, "req_a.yaml", "line1\nFROM_MAIN\nline3\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "main edit", None).unwrap();
    let main_oid = repo.head().unwrap().target().unwrap();

    repo.set_head("refs/heads/feature").unwrap();
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    write(&path, "req_a.yaml", "line1\nFROM_FEATURE\nline3\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "feature edit", None).unwrap();

    let annotated = repo
        .find_annotated_commit(repo.find_commit(main_oid).unwrap().id())
        .unwrap();
    repo.merge(&[&annotated], None, None).unwrap();
    // The merge wrote conflict markers into the working file.
    assert!(fs::read_to_string(path.join("req_a.yaml"))
        .unwrap()
        .contains("<<<<<<<"));

    let healed = heal_merge_worktree(&path).unwrap();
    assert!(healed);

    // Working file is now the clean local ("ours") version — no markers.
    let restored = fs::read_to_string(path.join("req_a.yaml")).unwrap();
    assert!(!restored.contains("<<<<<<<"));
    assert!(restored.contains("FROM_FEATURE"));
    // …but the conflict is still live in the index for the resolver.
    let fresh = Repository::open(&path).unwrap();
    assert!(fresh.index().unwrap().has_conflicts());
    assert_eq!(conflict_blobs(&path).unwrap().len(), 1);
    // Idempotent + no-op once not merging is exercised by re-running.
    assert!(heal_merge_worktree(&path).unwrap());
}

#[test]
fn timestamp_only_change_is_hidden() {
    let (_d, path) = setup();
    write(
        &path,
        "req_a.yaml",
        "id: a\nname: A\nupdatedAt: 2026-01-01T00:00:00\n",
    );
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "init", None).unwrap();

    // Only updatedAt changed → not reported as a change.
    write(
        &path,
        "req_a.yaml",
        "id: a\nname: A\nupdatedAt: 2026-02-02T00:00:00\n",
    );
    assert!(
        status(&path).unwrap().files.is_empty(),
        "timestamp-only change should be hidden"
    );

    // Real content change → reported (even though updatedAt also differs).
    write(
        &path,
        "req_a.yaml",
        "id: a\nname: B\nupdatedAt: 2026-02-02T00:00:00\n",
    );
    assert!(
        !status(&path).unwrap().files.is_empty(),
        "content change shows"
    );
}

#[test]
fn gitignore_hidden_from_status_but_committed() {
    let (_d, path) = setup();
    write(&path, ".gitignore", ".DS_Store\n");
    write(&path, "req_a.yaml", "id: a\nname: A\n");

    // `.gitignore` never shows as a user-facing change…
    let st = status(&path).unwrap();
    assert!(st.files.iter().all(|f| f.path != ".gitignore"));
    assert_eq!(st.files.len(), 1);

    // …but committing the entity sweeps `.gitignore` into the commit, leaving the
    // worktree clean (no perpetually-dirty untracked file).
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "add a", None).unwrap();
    assert!(status(&path).unwrap().files.is_empty());
    assert_eq!(log_for_path(&path, ".gitignore", 10).unwrap().len(), 1);
}

#[test]
fn discard_volatile_changes_reverts_timestamp_only_edits() {
    let (_d, path) = setup();
    write(
        &path,
        "req_a.yaml",
        "id: a\nname: A\nupdatedAt: 2026-01-01T00:00:00\n",
    );
    write(&path, "req_b.yaml", "id: b\nname: B\n");
    stage_all(&path).unwrap();
    commit(&path, "init", None).unwrap();

    // req_a: only updatedAt churned (an edit-then-undo). req_b: real content change.
    write(
        &path,
        "req_a.yaml",
        "id: a\nname: A\nupdatedAt: 2099-12-31T00:00:00\n",
    );
    write(&path, "req_b.yaml", "id: b\nname: CHANGED\n");

    discard_volatile_changes(&path).unwrap();

    // req_a is reset to HEAD on disk — raw git sees it clean again.
    assert_eq!(
        fs::read_to_string(path.join("req_a.yaml")).unwrap(),
        "id: a\nname: A\nupdatedAt: 2026-01-01T00:00:00\n"
    );
    // req_b's real change is untouched.
    assert!(fs::read_to_string(path.join("req_b.yaml"))
        .unwrap()
        .contains("CHANGED"));
}

#[test]
fn stage_all_includes_new_files() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\n");
    write(&path, "folder_f.yaml", "id: f\n");
    stage_all(&path).unwrap();
    let st = status(&path).unwrap();
    assert!(st.files.iter().all(|f| f.staged));
    assert_eq!(st.files.len(), 2);
}

#[test]
fn revert_commit_undoes_modify_and_add() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\nname: A1\n");
    stage(&path, &["req_a.yaml".into()]).unwrap();
    commit(&path, "c1", None).unwrap();

    // c2 modifies req_a and adds req_b.
    write(&path, "req_a.yaml", "id: a\nname: A2\n");
    write(&path, "req_b.yaml", "id: b\nname: B\n");
    stage(&path, &["req_a.yaml".into(), "req_b.yaml".into()]).unwrap();
    commit(&path, "c2", None).unwrap();

    let c2 = log(&path, 10).unwrap()[0].id.clone();
    revert_commit_files(&path, &c2, None).unwrap();

    // req_a is back to its pre-c2 content; req_b (added by c2) is removed.
    assert_eq!(
        fs::read_to_string(path.join("req_a.yaml")).unwrap(),
        "id: a\nname: A1\n"
    );
    assert!(!path.join("req_b.yaml").exists());
}

#[test]
fn revert_commit_scoped_to_one_file() {
    let (_d, path) = setup();
    write(&path, "req_a.yaml", "id: a\nname: A1\n");
    write(&path, "req_b.yaml", "id: b\nname: B1\n");
    stage(&path, &["req_a.yaml".into(), "req_b.yaml".into()]).unwrap();
    commit(&path, "c1", None).unwrap();

    write(&path, "req_a.yaml", "id: a\nname: A2\n");
    write(&path, "req_b.yaml", "id: b\nname: B2\n");
    stage(&path, &["req_a.yaml".into(), "req_b.yaml".into()]).unwrap();
    commit(&path, "c2", None).unwrap();

    let c2 = log(&path, 10).unwrap()[0].id.clone();
    revert_commit_files(&path, &c2, Some("req_a.yaml")).unwrap();

    // Only req_a is reverted; req_b keeps its c2 content.
    assert_eq!(
        fs::read_to_string(path.join("req_a.yaml")).unwrap(),
        "id: a\nname: A1\n"
    );
    assert_eq!(
        fs::read_to_string(path.join("req_b.yaml")).unwrap(),
        "id: b\nname: B2\n"
    );
}
