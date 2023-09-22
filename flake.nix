{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    gitignore = {
      url = "github:hercules-ci/gitignore.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self
    , nixpkgs
    , gitignore
    , flake-utils
    , ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        packageJSON = pkgs.lib.importJSON ./package.json;
        gitignoreSource = gitignore.lib.gitignoreSource;
      in
      {
        packages = rec {
          site-src = pkgs.mkYarnPackage rec {
            name = "${packageJSON.name}-site-${version}";
            version = packageJSON.version;
            src = gitignoreSource ./.;
            packageJson = "${src}/package.json";
            yarnLock = "${src}/yarn.lock";
            buildPhase = ''
              yarn --offline build
            '';
            distPhase = "true";
          };

          default = pkgs.writeShellApplication {
            name = packageJSON.name;
            runtimeInputs = [ site-src pkgs.nodejs ];
            text = ''
              node ${site-src}/libexec/${packageJSON.name}/deps/${packageJSON.name}/build
            '';
          };
        };

        devShell = pkgs.mkShell {
          buildInputs = [
            pkgs.gitlint
            pkgs.nodejs
            pkgs.yarn
          ];
          shellHook = ''
            # auto-install git hooks
            dot_git="$(git rev-parse --git-common-dir)"
            if [[ ! -d "$dot_git/hooks" ]]; then mkdir "$dot_git/hooks"; fi
            for hook in git_hooks/* ; do ln -sf "$(pwd)/$hook" "$dot_git/hooks/" ; done
          '';
        };
      }
    );
}
