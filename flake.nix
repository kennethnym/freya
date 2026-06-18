{
  description = "FREYA development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      lib = nixpkgs.lib;
      forEachSystem = lib.genAttrs systems;
      pkgsFor = forEachSystem (system: import nixpkgs { inherit system; });

      # App outputs are for long-running local tools and dev servers.
      appScripts = {
        expo = "expo";
        drizzle-studio = "drizzle-studio";
        freya-backend = "freya-backend";
        admin-dashboard = "admin-dashboard";
        agent-test-cli = "agent-test-cli";
      };

      # Check outputs are the CI-like validation commands run by `nix flake check`.
      checkCommands = {
        format-check = "bun run format:check";
        lint = "bun run lint";
        test = "bun run test";
      };

      # Dev-shell conveniences mirror the common app/check commands.
      shellScripts = appScripts // {
        freya-test = "test";
        lint = "lint";
        format-check = "format:check";
      };

      # node_modules is content-addressed. If bun.lock or package manifests
      # change, Nix will report the new hash to put here.
      nodeModulesHashes = {
        x86_64-linux = "sha256-apVZaFGf9OKpil1WdcQ1CJODsIdjLWlBBZErHg5mjZA=";
      };
      checkSystems = lib.attrNames nodeModulesHashes;

      # Dependency derivations only need the lockfile and workspace manifests,
      # so source-only edits do not force Bun to reinstall.
      dependencySource = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.fileFilter (file: file.name == "bun.lock" || file.name == "package.json") ./.;
      };

      # Checks run against a clean source tree, even when using `path:.`.
      # Without this filter, local node_modules can sneak into the Nix sandbox.
      projectSource = builtins.path {
        name = "freya-source";
        path = ./.;
        filter =
          path: type:
          let
            name = builtins.baseNameOf path;
          in
          !(type == "directory" && (name == ".git" || name == "node_modules")) && name != "result";
      };

      mkBunScriptCommands =
        pkgs: scripts:
        let
          mkBunScript =
            name: script:
            pkgs.writeShellApplication {
              inherit name;
              runtimeInputs = with pkgs; [
                bun
                git
              ];
              text = ''
                repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
                cd "$repo_root"
                exec bun run ${lib.escapeShellArg script} "$@"
              '';
            };
        in
        lib.mapAttrs mkBunScript scripts;
      mkBunApps =
        commands:
        lib.mapAttrs (name: command: {
          type = "app";
          program = "${command}/bin/${name}";
        }) commands;
      mkBunNodeModules =
        system: pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "freya-node-modules";
          version = "1";
          __structuredAttrs = true;

          src = dependencySource;
          nativeBuildInputs = with pkgs; [
            bun
            cacert
            nodejs
          ];

          SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
          GIT_SSL_CAINFO = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";

          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
          outputHash = nodeModulesHashes.${system};

          # `patchShebangs` embeds Nix store interpreters in package bins. The
          # check derivations also depend on bun/node, so this dependency blob
          # can safely drop those references after its hash is verified.
          unsafeDiscardReferences.out = true;

          dontConfigure = true;
          # Workspace package links are completed inside each check's source tree,
          # so they are intentionally dangling in this dependency-only output.
          dontFixup = true;

          buildPhase = ''
            runHook preBuild

            export HOME="$TMPDIR/home"
            mkdir -p "$HOME"

            # Keep the real workspace manifest for `--frozen-lockfile`, but
            # filter out frontend workspaces that do not participate in checks.
            # `--force` matters in the Nix sandbox: without it, Bun can accept
            # manifest-only cached packages and leave tool binaries missing.
            bun install \
              --force \
              --frozen-lockfile \
              --ignore-scripts \
              --backend copyfile \
              --filter freya \
              --filter '@freya/*' \
              --filter '@freya/backend' \
              --no-progress

            patchShebangs node_modules

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p "$out"

            # Keep the root install in the store; checks symlink this directly.
            cp -a node_modules "$out/node_modules"

            # Bun also creates per-workspace node_modules directories. These are
            # mostly relative symlinks, so checks copy the symlink entries into
            # their writable source tree instead of symlinking the directory.
            find apps packages -mindepth 2 -maxdepth 2 -type d -name node_modules -print |
              while IFS= read -r node_modules_dir; do
                mkdir -p "$out/$(dirname "$node_modules_dir")"
                cp -a "$node_modules_dir" "$out/$node_modules_dir"
              done

            runHook postInstall
          '';
        };
      mkBunCheck =
        pkgs: nodeModules: name: command:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "freya-${name}";
          version = "1";

          src = projectSource;
          nativeBuildInputs = with pkgs; [
            bun
            nodejs
          ];

          dontConfigure = true;

          buildPhase = ''
            runHook preBuild

            export HOME="$TMPDIR/home"
            mkdir -p "$HOME"

            # Root dependencies are read-only and shared across checks.
            ln -s "${nodeModules}/node_modules" node_modules

            # Workspace node_modules contain relative symlinks back to packages/
            # and apps/, so copy just those symlink entries into this source tree.
            for node_modules_dir in "${nodeModules}"/apps/*/node_modules "${nodeModules}"/packages/*/node_modules; do
              if [ -d "$node_modules_dir" ]; then
                relative_path="''${node_modules_dir#"${nodeModules}/"}"
                mkdir -p "$relative_path"
                cp -a "$node_modules_dir/." "$relative_path/"
              fi
            done

            ${command}

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p "$out"
            touch "$out/${name}"

            runHook postInstall
          '';
        };
    in
    {
      apps = forEachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        mkBunApps (mkBunScriptCommands pkgs appScripts)
      );

      checks = lib.genAttrs checkSystems (
        system:
        let
          pkgs = pkgsFor.${system};
          nodeModules = mkBunNodeModules system pkgs;
        in
        lib.mapAttrs (mkBunCheck pkgs nodeModules) checkCommands
      );

      devShells = forEachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
          bunScriptCommands = lib.attrValues (mkBunScriptCommands pkgs shellScripts);
          commonPackages = with pkgs; [
            bun
            git
            gh
            gnumake
            nixfmt
            nodejs
            openssl
            pkg-config
            postgresql
            python3
            watchman
          ];
          linuxPackages = with pkgs; [
            gcc
            inotify-tools
            tailscale
          ];
        in
        {
          default = pkgs.mkShell {
            packages =
              commonPackages ++ bunScriptCommands ++ pkgs.lib.optionals pkgs.stdenv.isLinux linuxPackages;

            SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";

            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"
            '';
          };
        }
      );

      formatter = forEachSystem (system: pkgsFor.${system}.nixfmt);
    };
}
