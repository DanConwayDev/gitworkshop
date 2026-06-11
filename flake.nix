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
        pkgs = nixpkgs.legacyPackages.${system};
        # ngit-grasp's upstream derivation runs `cargo test` during the nix
        # build; several of those tests need ambient state (git in PATH, etc.)
        # and fail inside the build sandbox. We only want the binary for the
        # e2e harness, so disable the test phase.
        ngit-grasp-pkg =
          ngit-grasp.packages.${system}.default.overrideAttrs (_: {
            doCheck = false;
          });
      in {
        devShell = pkgs.mkShell {
          buildInputs = [ pkgs.nodejs pkgs.pnpm ngit-grasp-pkg ];
          # Point the e2e harness at the pinned ngit-grasp binary. Without this
          # the harness falls back to the sibling-clone heuristic
          # (../ngit-grasp/target/release/ngit-grasp), which is fine for local
          # dev but not reproducible in CI.
          shellHook = ''
            export NGIT_GRASP_BIN=${ngit-grasp-pkg}/bin/ngit-grasp
          '';
        };
      });
}
