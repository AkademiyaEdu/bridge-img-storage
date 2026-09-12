{
  description = "Discord avatar sync dev shell";

  inputs = { nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable"; };

  outputs = { self, nixpkgs }:
    let
      systems =
        [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems
        (system: f (import nixpkgs { inherit system; }));
    in {
      devShells = forAllSystems (pkgs: {
        default = with pkgs; mkShell { packages = [ nodejs_26 pnpm git jq ]; };
      });
    };
}
