# OpenClaude — Claude-style startup (local fork)

Fork local em `C:\Users\gabdr\openclaude-fork` com estética de inicialização
parecida com o Claude Code CLI, mantendo o nome **OpenClaude**.

## O que mudou

- Splash pré-Ink: cena do Clawd (paisagem + rosto) em vez do logo gigante OPEN/CLAUDE
- Cores terracotta do Claude (`#D97757` / palette `sunset`)
- Peito do Clawd sem "OC"
- Texto: `Welcome to OpenClaude`

## Como usar

Já está no PATH via `npm link`. Basta:

```powershell
openclaude
```

## Rebuild / update

```powershell
cd C:\Users\gabdr\openclaude-fork
git pull   # se quiser atualizar do upstream (pode conflitar)
bun install
bun run build
npm link
```

## Voltar ao oficial

```powershell
npm unlink -g @gitlawb/openclaude
npm install -g @gitlawb/openclaude@latest
```

## Paleta

Dentro do OpenClaude: `/logo` → escolha **Sunset** (padrão deste fork).
