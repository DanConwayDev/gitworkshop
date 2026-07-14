{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";

    # ngit-grasp provides the GRASP server binary used by the optional e2e
    # test harness (`pnpm test:e2e`, see e2e/README.md). Pinned to a specific
    # rev so the harness is reproducible — bump it intentionally. This matches
    # the pin used by ngit's own Rust test harness.
    ngit-grasp = {
      url = "git+https://gitnostr.com/npub15qydau2hjma6ngxkl2cyar74wzyjshvl65za5k5rl69264ar2exs5cyejr/ngit-grasp.git";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.rust-overlay.follows = "rust-overlay";
      inputs.flake-utils.follows = "flake-utils";
    };
  };

  outputs = { nixpkgs, flake-utils, ngit-grasp, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          config.android_sdk.accept_license = true;
        };
        # ngit-grasp's upstream derivation runs `cargo test` during the nix
        # build; several of those tests need ambient state (git in PATH, etc.)
        # and fail inside the build sandbox. We only want the binary for the
        # e2e harness, so disable the test phase.
        ngit-grasp-pkg =
          ngit-grasp.packages.${system}.default.overrideAttrs (_: {
            doCheck = false;
          });
        android-sdk = pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "36" ];
          # Android Gradle Plugin 8.13 defaults to Build Tools 35.0.0. Include
          # that version explicitly because the Nix SDK is immutable and Gradle
          # cannot install its default version at build time.
          buildToolsVersions = [ "35.0.0" "36.0.0" ];
        };
      in {
        devShell = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs
            pkgs.pnpm
            pkgs.jdk21
            android-sdk.androidsdk
            ngit-grasp-pkg
          ];
          # Point the e2e harness at the pinned ngit-grasp binary. Without this
          # the harness falls back to the sibling-clone heuristic
          # (../ngit-grasp/target/release/ngit-grasp), which is fine for local
          # dev but not reproducible in CI.
          shellHook = ''
            export NGIT_GRASP_BIN=${ngit-grasp-pkg}/bin/ngit-grasp
            export JAVA_HOME=${pkgs.jdk21}
            export ANDROID_HOME=${android-sdk.androidsdk}/libexec/android-sdk
            export ANDROID_SDK_ROOT="$ANDROID_HOME"
            # Capacitor only exposes telemetry as a per-machine CLI preference,
            # not a project config option. Enforce the opt-out whenever this
            # development shell is entered, once dependencies are installed.
            if [ -x node_modules/.bin/cap ]; then
              node_modules/.bin/cap telemetry off
            fi
            # AGP normally downloads aapt2 from Maven, but that binary is not
            # runnable on NixOS. Use the aapt2 packaged in the Nix SDK instead.
            export GRADLE_OPTS="''${GRADLE_OPTS:+$GRADLE_OPTS }-Dorg.gradle.project.android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/35.0.0/aapt2"

            if git rev-parse --git-dir >/dev/null 2>&1; then
              hooks_dir="$(git rev-parse --git-dir)/hooks"
              mkdir -p "$hooks_dir"
              hook="$hooks_dir/pre-push"
              if [ -f "$hook" ] && ! grep -q "gitworkshop generated pre-push hook" "$hook"; then
                echo "Leaving existing custom pre-push hook in place: $hook"
              else
                cat > "$hook" <<'EOF'
#!/bin/sh
# gitworkshop generated pre-push hook
set -eu

zero=0000000000000000000000000000000000000000
run_e2e=0

is_relevant_path() {
  case "$1" in
    e2e/*|vitest.e2e.config.ts|src/lib/git-*|src/lib/git-grasp-pool/*|src/lib/vendored/git-natural-api/*|src/hooks/useGitPool.ts|src/hooks/useGitExplorer.ts|src/pages/repo/RepoCodePage.tsx|src/components/MergePanel.tsx)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

check_range() {
  base="$1"
  tip="$2"
  for path in $(git diff --name-only "$base" "$tip"); do
    if is_relevant_path "$path"; then
      run_e2e=1
      return
    fi
  done
}

while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue

  if [ "$remote_sha" = "$zero" ]; then
    upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
    if [ -n "$upstream" ]; then
      base="$(git merge-base "$local_sha" "$upstream" 2>/dev/null || true)"
      if [ -n "$base" ]; then
        check_range "$base" "$local_sha"
      else
        run_e2e=1
      fi
    else
      run_e2e=1
    fi
  else
    check_range "$remote_sha" "$local_sha"
  fi
done

if [ "$run_e2e" -eq 0 ]; then
  echo "Skipping e2e pre-push: no git/GRASP/e2e paths changed."
  exit 0
fi

if command -v pnpm >/dev/null 2>&1 && pnpm --version >/dev/null 2>&1; then
  pnpm run pre-push
else
  npm run pre-push
fi
EOF
                chmod +x "$hook"
              fi
            fi
          '';
        };
      });
}
